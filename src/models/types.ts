import * as vscode from 'vscode';

export interface CSSClass {
  name: string;
  file: vscode.Uri;
  range: vscode.Range;
  blockText: string;
};