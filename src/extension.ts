import * as vscode from 'vscode';
import { getConfiguredGodotPath } from './godot/configuration';
import { resolveGodot } from './godot/godotResolver';
import { RunOrchestrator } from './testing/runOrchestrator';
import { TestTree } from './testing/testTree';

/** Exposed to the extension's own integration tests. */
export interface ExtensionApi {
	controller: vscode.TestController;
	tree: TestTree;
}

export function activate(context: vscode.ExtensionContext): ExtensionApi {
	const output = vscode.window.createOutputChannel('GDScript Test Runner');
	const log = (message: string): void => output.appendLine(message);
	log('GDScript Test Runner activated.');
	logGodotResolution(log);

	const controller = vscode.tests.createTestController('gdscriptTestRunner', 'GDScript Tests');
	const tree = new TestTree(controller, log);
	const orchestrator = new RunOrchestrator(controller, tree, log);
	controller.createRunProfile(
		'Run',
		vscode.TestRunProfileKind.Run,
		(request, token) => orchestrator.run(request, token),
		true,
	);

	context.subscriptions.push(output, controller, tree);
	void tree.discover();
	return { controller, tree };
}

export function deactivate(): void { }

function logGodotResolution(log: (message: string) => void): void {
	const result = resolveGodot(getConfiguredGodotPath());
	if (result.ok) {
		log(`Godot resolved (${result.godot.source}): ${result.godot.path}`);
		log(`Godot version: ${result.godot.version}`);
	} else {
		log(`Godot resolution failed [${result.error.code}]: ${result.error.message}`);
	}
}
