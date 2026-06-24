// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';

var output: vscode.OutputChannel;

// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {

	// Use the console to output diagnostic information (console.log) and errors (console.error)
	// This line of code will only be executed once when your extension is activated
	console.log('Congratulations, your extension "gdscript-test-runner" is now active!');

	// The command has been defined in the package.json file
	// Now provide the implementation of the command with registerCommand
	// The commandId parameter must match the command field in package.json
	const disposable = vscode.commands.registerCommand('gdscript-test-runner.helloWorld', () => {
		// The code you place here will be executed every time your command is executed
		// Display a message box to the user
		vscode.window.showInformationMessage('Hello World from gdscript-test-runner!');
	});

	setupOutputChannel();
	output.appendLine('GDScript Test Runner activated.');

	context.subscriptions.push(disposable);
}

// This method is called when your extension is deactivated
export function deactivate() { }


export function setupOutputChannel(): void {
	output = vscode.window.createOutputChannel('GDScript Test Runner');
}


export function getOutputChannel(): vscode.OutputChannel {
	return output;
}
