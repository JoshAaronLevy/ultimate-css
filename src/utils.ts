/* eslint-disable curly */
import * as vscode from 'vscode';
import * as fs from 'fs/promises';
import postcss from 'postcss';
import postcssScss from 'postcss-scss';
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

        const blockText = rule.toString().trim();

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

export async function findDuplicates(classMap: Record<string, CSSClass[]>): Promise<Record<string, CSSClass[]>> {
  const nameToInstances = new Map<string, CSSClass[]>();
  const duplicates: Record<string, CSSClass[]> = {};

  for (const entries of Object.values(classMap)) {
    for (const cssClass of entries) {
      const existing = nameToInstances.get(cssClass.name) || [];
      existing.push(cssClass);
      nameToInstances.set(cssClass.name, existing);
    }
  }

  const checkDuplicates = async () => {
    for (const [className, instances] of nameToInstances.entries()) {
      if (instances.length > 1) {
        const filteredInstances: CSSClass[] = [];

        for (const instance of instances) {
          let doc: vscode.TextDocument;
          try {
            doc = await vscode.workspace.openTextDocument(instance.file);
          } catch {
            continue;
          }

          if (isFileIgnored(doc)) continue;

          const lineAbove = instance.range.start.line - 1;
          if (lineAbove >= 0 && isLineIgnored(doc, lineAbove)) continue;

          filteredInstances.push(instance);
        }

        if (filteredInstances.length > 1) {
          duplicates[className] = filteredInstances;
        }
      }
    }

    return duplicates;
  };

  return checkDuplicates() as unknown as Record<string, CSSClass[]>;
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
    const fileUri = vscode.Uri.file(filePath);
    const doc = await vscode.workspace.openTextDocument(fileUri);

    if (isFileIgnored(doc)) continue;

    for (const clsObj of classes) {
      const cls = clsObj.name;

      const lineNum = clsObj.range.start.line;
      if (!usedClasses.has(cls) && !skip.has(cls)) {
        if (isLineIgnored(doc, lineNum)) continue;

        const diagnostic = new vscode.Diagnostic(
          clsObj.range,
          `Unused class: "${cls}"`,
          vscode.DiagnosticSeverity.Warning
        );
        diagnostic.source = 'Ultimate CSS';

        if (!diagnostics[filePath]) diagnostics[filePath] = [];
        diagnostics[filePath].push(diagnostic);
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
    const doc = await vscode.workspace.openTextDocument(uri);
    const content = doc.getText();
    const lines = content.split('\n');

    if (isFileIgnored(doc)) continue;

    const regexList = [
      /class(Name)?\s*=\s*"([^"]+)"/g,
      /class(Name)?\s*=\s*`([^`]+)`/g,
      /class(Name)?\s*=\s*\{\s*"([^"]+)"\s*\}/g
    ];

    for (const regex of regexList) {
      let match;
      while ((match = regex.exec(content)) !== null) {
        const allClasses = match[2]?.split(/\s+/) || match[3]?.split(/\s+/) || [];
        const index = match.index;

        const before = content.slice(0, index);
        const lineNum = before.split('\n').length - 1;
        const col = lines[lineNum]?.indexOf(allClasses[0]) ?? 0;

        if (isLineIgnored(doc, lineNum)) continue;

        for (const className of allClasses) {
          if (!definedClassNames.has(className)) {
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
