/* eslint-disable curly */
import * as vscode from 'vscode';
import { getAllCSSClasses, findDuplicates } from './utils';
// noinspection ES6UnusedImports
import { updateDiagnostics } from './extension';

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
    const duplicates = await findDuplicates(classMap);

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
          const edit1 = new vscode.WorkspaceEdit();
          edit1.insert(
            document.uri,
            new vscode.Position(diagnostic.range.start.line, 0),
            '/* ultimate-css-ignore-line */\n'
          );
          ignoreLineAction.edit = edit1;
          ignoreLineAction.diagnostics = [diagnostic];

          // 🟢 Trigger update after edit
          ignoreLineAction.command = {
            title: 'Refresh diagnostics',
            command: 'ultimate-css.refreshDiagnostics',
          };

          const ignoreFileAction = new vscode.CodeAction(
            'Ignore all Ultimate CSS warnings for this file',
            vscode.CodeActionKind.QuickFix
          );
          const edit2 = new vscode.WorkspaceEdit();
          edit2.insert(
            document.uri,
            new vscode.Position(0, 0),
            '/* ultimate-css-ignore-file */\n'
          );
          ignoreFileAction.edit = edit2;
          ignoreFileAction.diagnostics = [diagnostic];
          ignoreFileAction.command = {
            title: 'Refresh diagnostics',
            command: 'ultimate-css.refreshDiagnostics',
          };

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
