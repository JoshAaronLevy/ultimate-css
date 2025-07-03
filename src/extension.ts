import * as vscode from 'vscode';
import {
	getAllCSSClasses,
	findDuplicates,
	findUnusedClasses,
	findUndefinedClasses
} from './utils';
import { DuplicateClassCodeActionProvider } from './duplicateClassCodeActionProvider';
import { IgnoreClassCodeActionProvider } from './ignoreClassCodeActionProvider';

let diagnostics: vscode.DiagnosticCollection;

export const updateDiagnostics = async () => {
	const cssFiles = await vscode.workspace.findFiles('**/*.{css,scss}');
	const codeFiles = await vscode.workspace.findFiles('**/*.{html,js,jsx,ts,tsx}');

	const classMap = await getAllCSSClasses(cssFiles);
	const duplicates = await findDuplicates(classMap);

	const duplicateClassNames = new Set(
		Object.values(duplicates).flat().map(d => d.name)
	);

	const unused = await findUnusedClasses(classMap, codeFiles, duplicateClassNames);
	const undefinedClassDiagnostics = await findUndefinedClasses(classMap, codeFiles);

	diagnostics.clear();
	const diagnosticsMap: Record<string, vscode.Diagnostic[]> = {};

	for (const [className, instances] of Object.entries(duplicates)) {
		for (const cssClass of instances) {
			const uri = cssClass.file;
			const range = cssClass.range;

			const otherLocations = instances
				.filter(entry => entry.file.fsPath !== uri.fsPath || entry.range.start.line !== range.start.line)
				.map(entry => {
					const relPath = vscode.workspace.asRelativePath(entry.file.fsPath);
					return `${relPath}:${entry.range.start.line + 1}`;
				})
				.join('\n');

			const message = `Duplicate class: "${className}"\nAlso defined in:\n${otherLocations}\n\n(from Ultimate CSS)`;

			const diagnostic = new vscode.Diagnostic(
				range,
				message,
				vscode.DiagnosticSeverity.Error
			);
			diagnostic.source = 'Ultimate CSS';
			diagnostic.code = 'duplicate-class';

			if (!diagnosticsMap[uri.fsPath]) {
				diagnosticsMap[uri.fsPath] = [];
			}
			diagnosticsMap[uri.fsPath].push(diagnostic);
		}
	}

	for (const [filePath, diags] of Object.entries(unused)) {
		const existing = diagnosticsMap[filePath] ?? [];
		diagnosticsMap[filePath] = [...existing, ...diags];
	}

	for (const [filePath, diags] of Object.entries(diagnosticsMap)) {
		diagnostics.set(vscode.Uri.file(filePath), diags);
	}

	for (const [filePath, diags] of Object.entries(undefinedClassDiagnostics)) {
		const uri = vscode.Uri.file(filePath);
		const existing = diagnostics.get(uri) ?? [];
		diagnostics.set(uri, [...existing, ...diags]);
	}
};

export async function activate(context: vscode.ExtensionContext) {
	console.log('🔥 Ultimate CSS extension activated!');
	diagnostics = vscode.languages.createDiagnosticCollection('ultimate-css');
	context.subscriptions.push(diagnostics);

	context.subscriptions.push(
		vscode.commands.registerCommand('ultimate-css.refreshDiagnostics', () => {
			setTimeout(() => updateDiagnostics(), 100);
		})
	);

	context.subscriptions.push(
		vscode.commands.registerCommand('ultimate-css.applyIgnoreAndRefresh', async (uri: vscode.Uri) => {
			const doc = await vscode.workspace.openTextDocument(uri);
			await vscode.window.showTextDocument(doc, { preview: true, preserveFocus: true });

			setTimeout(() => updateDiagnostics(), 100);
		})
	);

	updateDiagnostics();

	const watcher = vscode.workspace.createFileSystemWatcher('**/*.{css,scss,html,js,jsx,ts,tsx}');
	watcher.onDidChange(updateDiagnostics);
	watcher.onDidCreate(updateDiagnostics);
	watcher.onDidDelete(updateDiagnostics);
	context.subscriptions.push(watcher);

	context.subscriptions.push(
		vscode.languages.registerCodeActionsProvider(
			[{ language: 'css' }, { language: 'scss' }],
			new DuplicateClassCodeActionProvider(),
			{ providedCodeActionKinds: [vscode.CodeActionKind.QuickFix] }
		)
	);

	context.subscriptions.push(
		vscode.languages.registerCodeActionsProvider(
			[
				{ language: 'css' },
				{ language: 'scss' },
				{ language: 'html' },
				{ language: 'javascript' },
				{ language: 'typescript' },
				{ language: 'javascriptreact' },
				{ language: 'typescriptreact' }
			],
			new IgnoreClassCodeActionProvider(),
			{ providedCodeActionKinds: [vscode.CodeActionKind.QuickFix] }
		)
	);
};
