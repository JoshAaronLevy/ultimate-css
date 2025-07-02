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

        const selectorStart = col - 1 + sel.indexOf(classMatch[0]) + 1; // +1 skips the dot
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
