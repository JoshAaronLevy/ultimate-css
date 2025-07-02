/* eslint-disable curly */
import * as vscode from 'vscode';
import { getAllCSSClasses, findDuplicates } from './utils';

export class DuplicateClassCodeActionProvider implements vscode.CodeActionProvider {
  static readonly providedCodeActionKinds = [vscode.CodeActionKind.QuickFix];

  async provideCodeActions(
    document: vscode.TextDocument,
    range: vscode.Range,
    context: vscode.CodeActionContext,
    _token: vscode.CancellationToken
  ): Promise<vscode.CodeAction[]> {
    const actions: vscode.CodeAction[] = [];

    const cssFiles = await vscode.workspace.findFiles('**/*.{css,scss}');
    const classMap = await getAllCSSClasses(cssFiles);
    const duplicates = findDuplicates(classMap);

    for (const diagnostic of context.diagnostics) {
      if (!diagnostic.message.startsWith('Duplicate class:')) continue;

      const match = diagnostic.message.match(/Duplicate class: "(.+?)"/);
      if (!match) continue;

      const className = match[1];
      const instances = duplicates[className] || [];

      for (const instance of instances) {
        if (
          instance.file.fsPath === document.uri.fsPath &&
          instance.range.start.line === diagnostic.range.start.line
        ) {
          const ignoreLineAction = new vscode.CodeAction(
            'Ignore duplicate for this line',
            vscode.CodeActionKind.QuickFix
          );
          ignoreLineAction.edit = new vscode.WorkspaceEdit();
          ignoreLineAction.edit.insert(
            document.uri,
            new vscode.Position(diagnostic.range.start.line, Number.MAX_SAFE_INTEGER),
            ' // ultimate-css-ignore-line'
          );
          ignoreLineAction.diagnostics = [diagnostic];

          const ignoreFileAction = new vscode.CodeAction(
            'Ignore all Ultimate CSS warnings for this file',
            vscode.CodeActionKind.QuickFix
          );
          ignoreFileAction.edit = new vscode.WorkspaceEdit();
          ignoreFileAction.edit.insert(
            document.uri,
            new vscode.Position(0, 0),
            '/* ultimate-css-ignore-file */\n'
          );
          ignoreFileAction.diagnostics = [diagnostic];

          actions.push(ignoreLineAction, ignoreFileAction);
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
