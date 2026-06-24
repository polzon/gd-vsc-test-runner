import * as assert from 'assert';

// You can import and use all API from the 'vscode' module
// as well as import your extension to test it
import * as vscode from 'vscode';
import * as ext from '../extension';

suite('Extension Test Suite', () => {
	vscode.window.showInformationMessage('Start all tests.');

	suiteSetup(async () => {
		const ext = vscode.extensions.getExtension('polzon.gdscript-test-runner');
		await ext?.activate();
	});

	test('Sample test', () => {
		assert.strictEqual(-1, [1, 2, 3].indexOf(5));
		assert.strictEqual(-1, [1, 2, 3].indexOf(0));
	});

	test('Check debug channel exists', () => {
		ext.setupOutputChannel();
		var output = ext.getOutputChannel();

		assert.ok(output, 'output should be defined');
		assert.strictEqual(typeof output, 'object', 'output should be an object');
	});
});
