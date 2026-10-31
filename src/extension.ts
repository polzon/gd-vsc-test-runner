import * as vscode from 'vscode';
import { getDetailedCoverage } from './coverage/coverageStore';
import { getConfiguredGodotPath } from './godot/configuration';
import { resolveGodot } from './godot/godotResolver';
import { RunOrchestrator } from './testing/runOrchestrator';
import { TestTree } from './testing/testTree';

/** Exposed to the extension's own integration tests. */
export interface ExtensionApi {
    controller: vscode.TestController;
    tree: TestTree;
}

/**
 * Activation is triggered by the project.godot activation event (see package.json). VS Code ORs
 * activation events, so the second condition — a visible GDScript file — is checked here.
 */
export async function activate(
    context: vscode.ExtensionContext,
): Promise<ExtensionApi | undefined> {
    if (!(await hasGdscriptFile())) {
        return undefined;
    }

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
    const coverageProfile = controller.createRunProfile(
        'Run with Coverage',
        vscode.TestRunProfileKind.Coverage,
        (request, token) => orchestrator.run(request, token, { coverage: true }),
    );
    coverageProfile.loadDetailedCoverage = (_run, fileCoverage) =>
        Promise.resolve(getDetailedCoverage(fileCoverage));

    context.subscriptions.push(output, controller, tree);
    void tree.discover();
    return { controller, tree };
}

export function deactivate(): void {}

/** True when a GDScript file is visible in the workspace (respects files.exclude). */
async function hasGdscriptFile(): Promise<boolean> {
    const found = await vscode.workspace.findFiles('**/*.gd', undefined, 1);
    return found.length > 0;
}

function logGodotResolution(log: (message: string) => void): void {
    const result = resolveGodot(getConfiguredGodotPath());
    if (result.ok) {
        log(`Godot resolved (${result.godot.source}): ${result.godot.path}`);
        log(`Godot version: ${result.godot.version}`);
    } else {
        log(`Godot resolution failed [${result.error.code}]: ${result.error.message}`);
    }
}
