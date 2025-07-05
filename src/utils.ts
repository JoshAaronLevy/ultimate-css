/* eslint-disable curly */
import * as vscode from 'vscode';
import * as fs from 'fs/promises';
import postcss from 'postcss';
import { CSSClass } from './models/types';

const IGNORED_DEFINED_CLASS_PATTERNS: (string | RegExp)[] = [
  /^fa[srbld]$/,
  /^fa-/
];

function isLineIgnored(document: vscode.TextDocument, lineNumber: number): boolean {
  const lineText = document.lineAt(lineNumber).text;
  return lineText.includes('ultimate-css-ignore-line');
}

function isFileIgnored(document: vscode.TextDocument): boolean {
  const firstLine = document.lineAt(0).text;
  return firstLine.includes('ultimate-css-ignore-file');
}

function stripPseudoSelectorsAndDot(selector: string): string {
  return selector
    .replace(/^\./, '')
    .replace(/:[:]?[\w()-]+/g, '')
    .trim();
}

export async function getAllCSSClasses(uris: vscode.Uri[]): Promise<Record<string, CSSClass[]>> {
  const classMap: Record<string, CSSClass[]> = {};

  for (const uri of uris) {
    if (!uri.fsPath.endsWith('.css')) continue;

    try {
      const content = await fs.readFile(uri.fsPath, 'utf-8');
      const root = postcss().process(content, { from: undefined }).root;

      root.walkRules(rule => {
        if (rule.parent?.type === 'atrule' && rule.parent.name === 'keyframes') return;

        const selectors = rule.selector?.split(',').map(s => s.trim()).filter(Boolean) || [];
        if (selectors.length === 0 || !selectors.every(sel => sel.includes('.'))) return;

        const compositeSelector = selectors.sort().join(',');

        const cleanedSelector = selectors
          .map(sel =>
            sel
              .split(/\s+/)
              .map(part => stripPseudoSelectorsAndDot(part))
              .filter(Boolean)
              .map(name => `.${name}`)
              .join(' ')
          )
          .sort()
          .join(',');

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
          c.name === cleanedSelector &&
          c.range.start.line === range.start.line &&
          c.range.end.line === range.end.line
        );

        if (!alreadySeen) {
          classMap[uri.fsPath].push({
            name: cleanedSelector,
            file: uri,
            range,
            mediaQuery,
            selector: compositeSelector,
            ruleId
          } as CSSClass);
        }
      });
    } catch (err) {
      console.error(`[Ultimate CSS] Failed to parse ${uri.fsPath}:`, err);
    }
  }

  return classMap;
}

export function findDuplicates(classMap: Record<string, CSSClass[]>): Record<string, CSSClass[]> {
  const selectorMap = new Map<string, CSSClass[]>();

  for (const file in classMap) {
    for (const cssClass of classMap[file]) {
      const key = `${cssClass.selector}__media:${cssClass.mediaQuery ?? 'none'}`; // use original selector!
      if (!selectorMap.has(key)) {
        selectorMap.set(key, []);
      }
      selectorMap.get(key)!.push(cssClass);
    }
  }

  const duplicates: Record<string, CSSClass[]> = {};
  for (const [key, entries] of selectorMap.entries()) {
    const uniqueByLocation = new Set(entries.map(e => `${e.file.fsPath}:${e.range.start.line}-${e.range.end.line}`));
    if (uniqueByLocation.size > 1) {
      const selector = key.split('__media:')[0];
      duplicates[selector] = entries;
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

    const classMatches = [...content.matchAll(/class(Name)?=["'`]{1}([^"'`]+)["'`]{1}/g)];
    for (const match of classMatches) {
      const classes = match[2].split(/\s+/);
      for (const cls of classes) usedClasses.add(cls.trim());
    }

    const ngClassObjMatches = [...content.matchAll(/\[ngClass\]\s*=\s*["'`]{1}\{([^"'`]+)\}["'`]{1}/g)];
    for (const match of ngClassObjMatches) {
      const raw = match[1];
      const classMatches = [...raw.matchAll(/'([^']+)'/g)];
      for (const classMatch of classMatches) {
        usedClasses.add(classMatch[1]);
      }
    }

    const ngClassArrayMatches = [...content.matchAll(/\[ngClass\]\s*=\s*["'`]{1}\[([^"'`]+)\]["'`]{1}/g)];
    for (const match of ngClassArrayMatches) {
      const raw = match[1];
      const classMatches = [...raw.matchAll(/'([^']+)'/g)];
      for (const classMatch of classMatches) {
        usedClasses.add(classMatch[1]);
      }
    }

    const attrMatches = [...content.matchAll(/\b\w+\s*=\s*["'`]([^"'`]+)["'`]/g)];
    for (const match of attrMatches) {
      const values = match[1].split(/\s+/).map(s => s.trim()).filter(Boolean);
      for (const val of values) {
        usedClasses.add(val);
      }
    }
  }

  const diagnostics: Record<string, vscode.Diagnostic[]> = {};

  for (const [filePath, classInstances] of Object.entries(classMap)) {
    const fileUri = vscode.Uri.file(filePath);
    const doc = await vscode.workspace.openTextDocument(fileUri);
    if (isFileIgnored(doc)) continue;

    for (const cls of classInstances) {
      const selectorParts = cls.name.split(',');
      const line = cls.range.start.line;

      for (const part of selectorParts) {
        const classNamesInSelector = part
          .split(/\s+/)
          .filter(sel => sel.startsWith('.'))
          .map(sel => stripPseudoSelectorsAndDot(sel))
          .filter(Boolean);

        const allUnused = classNamesInSelector.every(className =>
          !usedClasses.has(className) && !skip.has(className)
        );

        if (allUnused && classNamesInSelector.length > 0) {
          if (isLineIgnored(doc, line)) continue;

          const diagnostic = new vscode.Diagnostic(
            cls.range,
            `Unused class: "${cls.selector}"`,
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
    const parts = classGroup.name
      .split(',')
      .flatMap(s =>
        s.split(/\s+/)
          .filter(sel => sel.startsWith('.'))
          .map(sel => stripPseudoSelectorsAndDot(sel))
      );
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
          const clean = className.trim();

          const isIgnored = IGNORED_DEFINED_CLASS_PATTERNS.some(p =>
            typeof p === 'string' ? p === clean : p.test(clean)
          );

          if (!definedClassParts.has(clean) && !isIgnored) {
            const range = new vscode.Range(
              new vscode.Position(line, col),
              new vscode.Position(line, col + clean.length)
            );

            if (!diagnosticsByFile[uri.fsPath]) diagnosticsByFile[uri.fsPath] = [];

            diagnosticsByFile[uri.fsPath].push(
              new vscode.Diagnostic(
                range,
                `Class "${clean}" is not defined in any CSS file. (from Ultimate CSS)`,
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
