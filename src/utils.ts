/* eslint-disable curly */
import * as vscode from 'vscode';
import * as fs from 'fs/promises';
import postcss from 'postcss';
import { CSSClass } from './models/types';

function isLineIgnored(document: vscode.TextDocument, lineNumber: number): boolean {
  const lineText = document.lineAt(lineNumber).text;
  return lineText.includes('ultimate-css-ignore-line');
}

function isFileIgnored(document: vscode.TextDocument): boolean {
  const firstLine = document.lineAt(0).text;
  return firstLine.includes('ultimate-css-ignore-file');
}

export async function getAllCSSClasses(uris: vscode.Uri[]): Promise<Record<string, CSSClass[]>> {
  const classMap: Record<string, CSSClass[]> = {};

  for (const uri of uris) {
    if (!uri.fsPath.endsWith('.css')) continue;

    try {
      const content = await fs.readFile(uri.fsPath, 'utf-8');
      const root = postcss().process(content, { from: undefined }).root;

      root.walkRules(rule => {
        // ✅ Skip anything inside @keyframes
        if (rule.parent?.type === 'atrule' && rule.parent.name === 'keyframes') return;

        // ✅ Only include rules with .class selectors
        const selectors = rule.selector?.split(',').map(s => s.trim()).filter(Boolean) || [];
        if (selectors.length === 0 || !selectors.every(sel => sel.startsWith('.'))) return;

        const compositeSelector = selectors.sort().join(',');

        let current: any = rule;
        let mediaQuery: string | null = null;
        while (current?.parent) {
          if (current.parent.type === 'atrule' && current.parent.name === 'media') {
            mediaQuery = `@media ${current.parent.params}`;
            break;
          }
          current = current.parent;
        }

        const blockStart = rule.source?.start?.line || 0;
        const blockEnd = rule.source?.end?.line || 0;

        const range = new vscode.Range(
          new vscode.Position(blockStart - 1, 0),
          new vscode.Position(blockEnd - 1, 1000)
        );

        const ruleId = `${uri.fsPath}-${blockStart}-${blockEnd}`;

        if (!classMap[uri.fsPath]) {
          classMap[uri.fsPath] = [];
        }

        const alreadySeen = classMap[uri.fsPath].some(c =>
          c.name === compositeSelector &&
          c.range.start.line === range.start.line &&
          c.range.end.line === range.end.line
        );

        if (!alreadySeen) {
          classMap[uri.fsPath].push({
            name: compositeSelector,
            file: uri,
            range,
            mediaQuery,
            selector: compositeSelector,
            ruleId
          } as any);
        }
      });      
    } catch (err) {
      console.error(`[Ultimate CSS] Failed to parse ${uri.fsPath}:`, err);
    }
  }

  return classMap;
}

export function findDuplicates(classMap: Record<string, CSSClass[]>): Record<string, CSSClass[]> {
  const seen: Record<string, CSSClass[]> = {};

  for (const file in classMap) {
    for (const cssClass of classMap[file]) {
      const key = `${cssClass.name}__media:${cssClass.mediaQuery ?? 'none'}`;
      if (!seen[key]) {
        seen[key] = [];
      }
      seen[key].push(cssClass);
    }
  }

  const duplicates: Record<string, CSSClass[]> = {};
  for (const [key, instances] of Object.entries(seen)) {
    if (instances.length > 1) {
      const compositeSelector = key.split('__media:')[0];
      duplicates[compositeSelector] = instances;
    }
  }

  return duplicates;
}

export async function findUnusedClasses(
  classMap: Record<string, CSSClass[]>,
  codeUris: vscode.Uri[],
  skip: Set<string>
): Promise<Record<string, vscode.Diagnostic[]>> {
  const usedClasses = new Set<string>();

  for (const uri of codeUris) {
    const content = await fs.readFile(uri.fsPath, 'utf-8');
    const matches = [...content.matchAll(/class(Name)?=["'`]{1}([^"'`]+)["'`]{1}/g)];

    for (const match of matches) {
      const classes = match[2].split(/\s+/);
      for (const cls of classes) usedClasses.add(cls.trim());
    }
  }

  const diagnostics: Record<string, vscode.Diagnostic[]> = {};

  for (const [filePath, classInstances] of Object.entries(classMap)) {
    const fileUri = vscode.Uri.file(filePath);
    const doc = await vscode.workspace.openTextDocument(fileUri);
    if (isFileIgnored(doc)) continue;

    for (const cls of classInstances) {
      const selectorParts = cls.name.split(','); // split composite
      const line = cls.range.start.line;

      for (const part of selectorParts) {
        const className = part.replace(/^\./, '').trim();
        if (!usedClasses.has(className) && !skip.has(className)) {
          if (isLineIgnored(doc, line)) continue;

          const diagnostic = new vscode.Diagnostic(
            cls.range,
            `Unused class: "${className}"`,
            vscode.DiagnosticSeverity.Warning
          );
          diagnostic.source = 'Ultimate CSS';

          if (!diagnostics[filePath]) diagnostics[filePath] = [];
          diagnostics[filePath].push(diagnostic);
        }
      }
    }
  }

  return diagnostics;
}

export async function findUndefinedClasses(
  classMap: Record<string, CSSClass[]>,
  codeUris: vscode.Uri[]
): Promise<Record<string, vscode.Diagnostic[]>> {
  const definedClassParts = new Set<string>();
  for (const classGroup of Object.values(classMap).flat()) {
    const parts = classGroup.name.split(',').map(s => s.replace(/^\./, '').trim());
    parts.forEach(p => definedClassParts.add(p));
  }

  const diagnosticsByFile: Record<string, vscode.Diagnostic[]> = {};

  for (const uri of codeUris) {
    const doc = await vscode.workspace.openTextDocument(uri);
    if (isFileIgnored(doc)) continue;

    const content = doc.getText();
    const lines = content.split('\n');

    const regexList = [
      /class(Name)?\s*=\s*"([^"]+)"/g,
      /class(Name)?\s*=\s*`([^`]+)`/g,
      /class(Name)?\s*=\s*\{\s*"([^"]+)"\s*\}/g
    ];

    for (const regex of regexList) {
      let match;
      while ((match = regex.exec(content)) !== null) {
        const classList = match[2]?.split(/\s+/) || match[3]?.split(/\s+/) || [];
        const index = match.index;
        const before = content.slice(0, index);
        const line = before.split('\n').length - 1;
        const col = lines[line]?.indexOf(classList[0]) ?? 0;

        if (isLineIgnored(doc, line)) continue;

        for (const className of classList) {
          if (!definedClassParts.has(className)) {
            const range = new vscode.Range(
              new vscode.Position(line, col),
              new vscode.Position(line, col + className.length)
            );

            if (!diagnosticsByFile[uri.fsPath]) diagnosticsByFile[uri.fsPath] = [];

            diagnosticsByFile[uri.fsPath].push(
              new vscode.Diagnostic(
                range,
                `Class "${className}" is not defined in any CSS file. (from Ultimate CSS)`,
                vscode.DiagnosticSeverity.Warning
              )
            );
          }
        }
      }
    }
  }

  return diagnosticsByFile;
}
