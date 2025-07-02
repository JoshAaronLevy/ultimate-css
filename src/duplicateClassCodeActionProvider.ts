/* eslint-disable curly */
import * as vscode from 'vscode';
import { CSSClass } from './models/types';

export class DuplicateClassCodeActionProvider implements vscode.CodeActionProvider {
  constructor(private duplicates: Record<string, CSSClass[]>) { }

  provideCodeActions(
    document: vscode.TextDocument,
    range: vscode.Range,
    context: vscode.CodeActionContext,
    _token: vscode.CancellationToken
  ): vscode.CodeAction[] {
    const actions: vscode.CodeAction[] = [];

    for (const diagnostic of context.diagnostics) {
      if (!diagnostic.message.startsWith('Duplicate class:')) continue;

      const match = diagnostic.message.match(/Duplicate class: "(.+?)"/);
      if (!match) continue;

      const className = match[1];
      const instances = this.duplicates[className] || [];

      for (const instance of instances) {
        if (instance.file.fsPath === document.uri.fsPath && instance.range.start.line === diagnostic.range.start.line) {
          continue;
        }

        const action = new vscode.CodeAction(
          `Go to ${vscode.workspace.asRelativePath(instance.file.fsPath)}:${instance.range.start.line + 1}`,
          vscode.CodeActionKind.QuickFix
        );

        action.command = {
          title: 'Open File',
          command: 'vscode.open',
          arguments: [
            instance.file,
            <vscode.TextDocumentShowOptions>{ selection: instance.range }
          ]
        };

        action.diagnostics = [diagnostic];
        action.isPreferred = true;

        actions.push(action);
      }
    }

    return actions;
  }
}
