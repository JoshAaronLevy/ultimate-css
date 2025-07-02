import * as vscode from 'vscode';
import * as fs from 'fs/promises';
import postcss from 'postcss';
import postcssScss from 'postcss-scss';

interface CSSClass {
  name: string;
  file: vscode.Uri;
  range: vscode.Range;
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
        // eslint-disable-next-line curly
        if (!classMatch) continue;

        const className = classMatch[1];
        const line = rule.source?.start?.line || 0;
        const col = rule.source?.start?.column || 0;

        const selectorStart = col - 1 + sel.indexOf(classMatch[0]) + 1;
        const range = new vscode.Range(
          new vscode.Position(line - 1, selectorStart),
          new vscode.Position(line - 1, selectorStart + className.length)
        );

        if (!classMap[uri.fsPath]) {
          classMap[uri.fsPath] = [];
        }

        classMap[uri.fsPath].push({
          name: className,
          file: uri,
          range
        });
      }
    });
  }

  return classMap;
}

export function findDuplicates(classMap: Record<string, CSSClass[]>): Record<string, CSSClass[]> {
  const seen = new Map<string, CSSClass[]>();
  const duplicates: Record<string, CSSClass[]> = {};

  for (const entries of Object.values(classMap)) {
    for (const cssClass of entries) {
      const existing = seen.get(cssClass.name) || [];
      existing.push(cssClass);
      seen.set(cssClass.name, existing);
    }
  }

  for (const [name, items] of seen.entries()) {
    if (items.length > 1) {
      duplicates[name] = items;
    }
  }

  return duplicates;
}

export async function findUnusedClasses(
  classMap: Record<string, CSSClass[]>,
  htmlUris: vscode.Uri[]
): Promise<CSSClass[]> {
  const used = new Set<string>();

  for (const uri of htmlUris) {
    const content = await fs.readFile(uri.fsPath, 'utf-8');

    const regexList = [
      /class\s*=\s*"([^"]+)"/g,
      /className\s*=\s*"([^"]+)"/g,
      /className\s*=\s*`([^`]+)`/g,
      /className\s*=\s*\{\s*"([^"]+)"\s*\}/g
    ];

    for (const regex of regexList) {
      let match;
      while ((match = regex.exec(content)) !== null) {
        const classes = match[1].split(/\s+/);
        classes.forEach(cls => used.add(cls));
      }
    }
  }

  const unused: CSSClass[] = [];
  for (const entries of Object.values(classMap)) {
    for (const cssClass of entries) {
      if (!used.has(cssClass.name)) {
        unused.push(cssClass);
      }
    }
  }

  return unused;
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
            // Find the line number and column
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
                `Class "${className}" is not defined in any CSS file.`,
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
