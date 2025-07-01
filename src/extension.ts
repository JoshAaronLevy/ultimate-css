import * as vscode from 'vscode';
import { getAllCSSClasses, findDuplicates, findUnusedClasses } from './utils';

export function activate(context: vscode.ExtensionContext) {
	const diagnosticCollection = vscode.languages.createDiagnosticCollection('ultimateCSS');

	if (vscode.workspace.workspaceFolders) {
		const folder = vscode.workspace.workspaceFolders[0].uri.fsPath;

		vscode.workspace.findFiles('**/*.{css,scss}').then(async (cssUris) => {
			const classMap = await getAllCSSClasses(cssUris);
			const duplicates = findDuplicates(classMap);

			vscode.workspace.findFiles('**/*.html').then(async (htmlUris) => {
				const unused = await findUnusedClasses(classMap, htmlUris);

				const diagnostics: vscode.Diagnostic[] = [];

				for (const [file, classes] of Object.entries(duplicates)) {
					for (const cls of classes) {
						diagnostics.push({
							severity: vscode.DiagnosticSeverity.Error,
							message: `Duplicate class: "${cls.name}"`,
							range: cls.range,
							source: 'Ultimate CSS',
						});
					}
				}

				for (const unusedClass of unused) {
					diagnostics.push({
						severity: vscode.DiagnosticSeverity.Warning,
						message: `Unused class: "${unusedClass.name}"`,
						range: unusedClass.range,
						source: 'Ultimate CSS',
					});
				}

				cssUris.forEach((uri) => {
					const uriDiagnostics = diagnostics.filter(d => d.range.start.line < 10000 && d.range.start.character < 10000); // crude filter
					diagnosticCollection.set(uri, uriDiagnostics);
				});
			});
		});
	}
}
