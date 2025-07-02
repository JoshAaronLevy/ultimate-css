import * as vscode from 'vscode';

export class IgnoreClassCodeActionProvider implements vscode.CodeActionProvider {
  static readonly providedCodeActionKinds = [
    vscode.CodeActionKind.QuickFix
  ];

  provideCodeActions(document: vscode.TextDocument, range: vscode.Range): vscode.CodeAction[] {
    const line = range.start.line;

    const ignoreLineAction = new vscode.CodeAction('Ignore for this line', vscode.CodeActionKind.QuickFix);
    ignoreLineAction.edit = new vscode.WorkspaceEdit();
    ignoreLineAction.edit.insert(document.uri, new vscode.Position(line, Number.MAX_SAFE_INTEGER), ' // ultimate-css-ignore-line');

    const ignoreFileAction = new vscode.CodeAction('Ignore for entire file', vscode.CodeActionKind.QuickFix);
    ignoreFileAction.edit = new vscode.WorkspaceEdit();
    ignoreFileAction.edit.insert(document.uri, new vscode.Position(0, 0), '/* ultimate-css-ignore-file */\n');

    return [ignoreLineAction, ignoreFileAction];
  }
}
