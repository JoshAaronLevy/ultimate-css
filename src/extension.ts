/* eslint-disable curly */
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
let debounceTimer: NodeJS.Timeout | null = null;

const scheduleDiagnosticsUpdate = () => {
	if (debounceTimer) {
		clearTimeout(debounceTimer);
	}
	debounceTimer = setTimeout(() => updateDiagnostics(diagnostics), 500);
};

export const updateDiagnostics = async (diagnostics: vscode.DiagnosticCollection) => {
	console.log('[Ultimate CSS] Running updateDiagnostics...');

	const exclude = '**/{dist,node_modules}/**';
	const cssFiles = await vscode.workspace.findFiles('**/*.css', exclude);
	const codeFiles = await vscode.workspace.findFiles('**/*.{html,js,jsx,ts,tsx}', exclude);

	console.log(`[Ultimate CSS] Matched ${cssFiles.length} CSS files`);
	console.log(`[Ultimate CSS] Matched ${codeFiles.length} code files`);

	const classMap = await getAllCSSClasses(cssFiles);
	console.log('[Ultimate CSS] Found classMap files:', Object.keys(classMap).length);

	const duplicates = await findDuplicates(classMap);
	console.log('[Ultimate CSS] Found duplicate classes:', Object.keys(duplicates).length);

	const duplicateClassNames = new Set(
		Object.values(duplicates).flat().map(d => d.name)
	);

	const unused = await findUnusedClasses(classMap, codeFiles, duplicateClassNames);
	console.log('[Ultimate CSS] Found unused class diagnostics for files:', Object.keys(unused).length);

	const undefinedClassDiagnostics = await findUndefinedClasses(classMap, codeFiles);
	console.log('[Ultimate CSS] Found undefined class diagnostics for files:', Object.keys(undefinedClassDiagnostics).length);

	diagnostics.clear();
	const diagnosticsMap: Record<string, vscode.Diagnostic[]> = {};

	for (const [className, instances] of Object.entries(duplicates)) {
		for (const cssClass of instances) {
			const uri = cssClass.file;
			const range = cssClass.range;

			const otherLocations = instances
				.filter(entry =>
					entry.file.fsPath !== uri.fsPath ||
					entry.range.start.line !== range.start.line
				)
				.map(entry => {
					const relPath = vscode.workspace.asRelativePath(entry.file.fsPath);
					return `${relPath}:${entry.range.start.line + 1}`;
				});

			if (otherLocations.length === 0) continue;

			const message = `Duplicate class: "${className}"\nAlso defined in:\n${otherLocations.join('\n')}\n\n(from Ultimate CSS)`;

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
		const uri = vscode.Uri.file(filePath);
		diagnostics.set(uri, diags);
		console.log(`[Ultimate CSS] Set ${diags.length} diagnostics on ${filePath}`);
	}

	for (const [filePath, diags] of Object.entries(undefinedClassDiagnostics)) {
		const uri = vscode.Uri.file(filePath);
		const existing = diagnostics.get(uri) ?? [];
		diagnostics.set(uri, [...existing, ...diags]);
		console.log(`[Ultimate CSS] Appended ${diags.length} undefined diagnostics to ${filePath}`);
	}
};

export async function activate(context: vscode.ExtensionContext) {
	console.log('🔥 Ultimate CSS extension activated!');
	diagnostics = vscode.languages.createDiagnosticCollection('ultimate-css');
	context.subscriptions.push(diagnostics);

	context.subscriptions.push(
		vscode.commands.registerCommand('ultimate-css.refreshDiagnostics', () => {
			scheduleDiagnosticsUpdate();
		})
	);

	context.subscriptions.push(
		vscode.commands.registerCommand('ultimate-css.applyIgnoreAndRefresh', async (uri: vscode.Uri) => {
			const doc = await vscode.workspace.openTextDocument(uri);
			await vscode.window.showTextDocument(doc, { preview: true, preserveFocus: true });
			scheduleDiagnosticsUpdate();
		})
	);

	await updateDiagnostics(diagnostics);

	const watcher = vscode.workspace.createFileSystemWatcher('**/*.{css,html,js,jsx,ts,tsx}');
	watcher.onDidChange(() => scheduleDiagnosticsUpdate());
	watcher.onDidCreate(() => scheduleDiagnosticsUpdate());
	watcher.onDidDelete(() => scheduleDiagnosticsUpdate());
	context.subscriptions.push(watcher);

	vscode.workspace.onDidOpenTextDocument(() => scheduleDiagnosticsUpdate());
	vscode.workspace.onDidSaveTextDocument(() => scheduleDiagnosticsUpdate());

	context.subscriptions.push(
		vscode.languages.registerCodeActionsProvider(
			[{ language: 'css' }],
			new DuplicateClassCodeActionProvider(),
			{ providedCodeActionKinds: [vscode.CodeActionKind.QuickFix] }
		)
	);

	context.subscriptions.push(
		vscode.languages.registerCodeActionsProvider(
			[
				{ language: 'css' },
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
}
