import * as vscode from 'vscode';
import {
	getAllCSSClasses,
	findDuplicates,
	findUnusedClasses,
	findUndefinedClasses
} from './utils';

export async function activate(context: vscode.ExtensionContext) {
	console.log('🔥 Ultimate CSS extension activated!');
	const diagnostics = vscode.languages.createDiagnosticCollection('ultimate-css');
	context.subscriptions.push(diagnostics);

	const updateDiagnostics = async () => {
		const cssFiles = await vscode.workspace.findFiles('**/*.{css,scss}');
		const codeFiles = await vscode.workspace.findFiles('**/*.{html,js,jsx,ts,tsx}');

		const classMap = await getAllCSSClasses(cssFiles);
		const duplicates = findDuplicates(classMap);
		const unused = await findUnusedClasses(classMap, codeFiles);
		const undefinedClassDiagnostics = await findUndefinedClasses(classMap, codeFiles);

		diagnostics.clear();

		for (const [filePath, classList] of Object.entries(classMap)) {
			const uri = vscode.Uri.file(filePath);
			const fileDiagnostics: vscode.Diagnostic[] = [];

			for (const cssClass of classList) {
				const isDuplicate = Object.values(duplicates)
					.flat()
					.some(c => c.name === cssClass.name && c.file.fsPath !== cssClass.file.fsPath);

				if (isDuplicate) {
					fileDiagnostics.push(
						new vscode.Diagnostic(
							cssClass.range,
							`Duplicate class: "${cssClass.name}"`,
							vscode.DiagnosticSeverity.Error
						)
					);
				}

				const isUnused = !isDuplicate && unused.some(
					u => u.name === cssClass.name && u.file.fsPath === cssClass.file.fsPath
				);

				if (isUnused) {
					fileDiagnostics.push(
						new vscode.Diagnostic(
							cssClass.range,
							`Unused class: "${cssClass.name}"`,
							vscode.DiagnosticSeverity.Warning
						)
					);
				}
			}

			diagnostics.set(uri, fileDiagnostics);
		}

		for (const [filePath, diags] of Object.entries(undefinedClassDiagnostics)) {
			const uri = vscode.Uri.file(filePath);
			const existing = diagnostics.get(uri) ?? [];
			diagnostics.set(uri, [...existing, ...diags]);
		}
	};

	context.subscriptions.push(
		vscode.commands.registerCommand('ultimate-css.runDiagnostics', () => {
			updateDiagnostics();
		})
	);

	updateDiagnostics();

	const watcher = vscode.workspace.createFileSystemWatcher('**/*.{css,scss,html,js,jsx,ts,tsx}');
	watcher.onDidChange(updateDiagnostics);
	watcher.onDidCreate(updateDiagnostics);
	watcher.onDidDelete(updateDiagnostics);
	context.subscriptions.push(watcher);
}
