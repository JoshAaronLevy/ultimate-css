/* eslint-disable curly */
import * as vscode from 'vscode';
import * as fs from 'fs/promises';
import postcss from 'postcss';
import postcssScss from 'postcss-scss';
import { CSSClass } from './models/types';

export async function getAllCSSClasses(uris: vscode.Uri[]): Promise<Record<string, CSSClass[]>> {
  const classMap: Record<string, CSSClass[]> = {};

  for (const uri of uris) {
    const content = await fs.readFile(uri.fsPath, 'utf-8');
    const root = postcss().process(content, { syntax: postcssScss }).root;

    root.walkRules(rule => {
      const selectors = rule.selector?.split(',') || [];

      for (const sel of selectors) {
        const trimmed = sel.trim();
        const classMatch = trimmed.match(/^\.([\w-]+)/);
        if (!classMatch) continue;

        const className = classMatch[1];
        const line = rule.source?.start?.line || 0;
        const col = rule.source?.start?.column || 0;

        const selectorStart = col - 1 + sel.indexOf(classMatch[0]) + 1;
        const range = new vscode.Range(
          new vscode.Position(line - 1, selectorStart),
          new vscode.Position(line - 1, selectorStart + className.length)
        );

        const blockText = rule.toString().trim(); // Capture full CSS rule

        if (!classMap[uri.fsPath]) {
          classMap[uri.fsPath] = [];
        }

        classMap[uri.fsPath].push({
          name: className,
          file: uri,
          range,
          blockText
        });
      }
    });
  }

  return classMap;
}

export function findDuplicates(classMap: Record<string, CSSClass[]>): Record<string, CSSClass[]> {
  const nameToInstances = new Map<string, CSSClass[]>();
  const duplicates: Record<string, CSSClass[]> = {};

  for (const entries of Object.values(classMap)) {
    for (const cssClass of entries) {
      const existing = nameToInstances.get(cssClass.name) || [];
      existing.push(cssClass);
      nameToInstances.set(cssClass.name, existing);
    }
  }

  for (const [className, instances] of nameToInstances.entries()) {
    if (instances.length > 1) {
      duplicates[className] = instances;
    }
  }

  return duplicates;
}

export async function findUnusedClasses(
  classMap: Record<string, CSSClass[]>,
  codeFiles: vscode.Uri[],
  skip: Set<string> = new Set()
) {
  const usedClasses = new Set<string>();

  for (const file of codeFiles) {
    const doc = await vscode.workspace.openTextDocument(file);
    const text = doc.getText();
    const matches = text.match(/class(Name)?=["'`{][^"'`}]+["'`}]?/g);

    if (matches) {
      for (const match of matches) {
        const classes = match
          .replace(/class(Name)?=["'`{]/, '')
          .replace(/["'`}]/, '')
          .split(/\s+/);
        for (const cls of classes) {
          usedClasses.add(cls.trim());
        }
      }
    }
  }

  const diagnostics: { [key: string]: vscode.Diagnostic[] } = {};

  for (const [filePath, classes] of Object.entries(classMap)) {
    for (const clsObj of classes) {
      const cls = clsObj.name; // ✅ use correct property

      if (!usedClasses.has(cls) && !skip.has(cls)) {
        const fileUri = vscode.Uri.file(filePath);
        const doc = await vscode.workspace.openTextDocument(fileUri);
        const text = doc.getText();
        const index = text.indexOf(`.${cls}`);

        if (index !== -1) {
          const pos = doc.positionAt(index);
          const range = new vscode.Range(pos, pos.translate(0, cls.length + 1));

          const diagnostic = new vscode.Diagnostic(
            range,
            `Unused class: "${cls}"`,
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
  const definedClassNames = new Set(
    Object.values(classMap).flat().map(cls => cls.name)
  );

  const diagnosticsByFile: Record<string, vscode.Diagnostic[]> = {};

  for (const uri of codeUris) {
    const content = await fs.readFile(uri.fsPath, 'utf-8');

    const regexList = [
      /class(Name)?\s*=\s*"([^"]+)"/g,
      /class(Name)?\s*=\s*`([^`]+)`/g,
      /class(Name)?\s*=\s*\{\s*"([^"]+)"\s*\}/g
    ];

    const lines = content.split('\n');

    for (const regex of regexList) {
      let match;
      while ((match = regex.exec(content)) !== null) {
        const allClasses = match[2]?.split(/\s+/) || match[3]?.split(/\s+/) || [];
        const index = match.index;

        for (const className of allClasses) {
          if (!definedClassNames.has(className)) {
            const before = content.slice(0, index);
            const lineNum = before.split('\n').length - 1;
            const col = lines[lineNum].indexOf(className);

            const range = new vscode.Range(
              new vscode.Position(lineNum, col),
              new vscode.Position(lineNum, col + className.length)
            );

            if (!diagnosticsByFile[uri.fsPath]) {
              diagnosticsByFile[uri.fsPath] = [];
            }

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
