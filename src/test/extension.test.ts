import * as assert from 'assert';
import * as path from 'path';
import * as vscode from 'vscode';
import type { ExtensionApi } from '../extension';
import { RunOrchestrator } from '../testing/runOrchestrator';

const DEMO_PROJECT = path.resolve(__dirname, '../../src/demo/gdunit4-adapter-demo');
const SUITE_FILE = path.join(DEMO_PROJECT, 'test', 'test_example_test.gd');

type Outcome = 'started' | 'passed' | 'failed' | 'errored' | 'skipped';

/** Records what the orchestrator publishes, keyed by TestItem label. */
function recordingController() {
    const outcomes = new Map<string, Outcome>();
    const messages = new Map<string, vscode.TestMessage>();
    const set = (outcome: Outcome) => (item: vscode.TestItem, message?: vscode.TestMessage | readonly vscode.TestMessage[]) => {
        outcomes.set(item.label, outcome);
        if (message) {
            messages.set(item.label, Array.isArray(message) ? message[0] : message as vscode.TestMessage);
        }
    };
    const run = {
        started: set('started'), passed: set('passed'), failed: set('failed'),
        errored: set('errored'), skipped: set('skipped'), enqueued: () => { },
        appendOutput: () => { }, end: () => { },
    } as unknown as vscode.TestRun;
    return { controller: { createTestRun: () => run }, outcomes, messages };
}

/** Runs inside the Extension Development Host with the demo Godot project opened (see .vscode-test.mjs). */
suite('Extension (demo project)', function () {
    this.timeout(120_000);
    let api: ExtensionApi;

    suiteSetup(async () => {
        const extension = vscode.extensions.getExtension<ExtensionApi>('polzon.gdscript-test-runner');
        assert.ok(extension, 'extension is installed in the test host');
        api = await extension.activate();
        await api.tree.discover();
    });

    test('discovers the demo suite and its test cases, ignoring addon suites', async () => {
        const files: vscode.TestItem[] = [];
        api.controller.items.forEach((item) => files.push(item));
        assert.deepStrictEqual(files.map((f) => f.uri?.fsPath.toLowerCase()), [SUITE_FILE.toLowerCase()]);

        await api.tree.ensureResolved();
        const names: string[] = [];
        files[0].children.forEach((child) => names.push(child.label));
        assert.deepStrictEqual(names.sort(), ['test_failure', 'test_success']);
        assert.strictEqual(api.tree.findTest(SUITE_FILE, 'test_success')?.range?.start.line, 3);
    });

    test('refreshing keeps existing items instead of recreating them', async () => {
        const before = api.tree.findTest(SUITE_FILE, 'test_success');
        assert.ok(before);
        await Promise.all([api.tree.refresh(), api.tree.refresh()]);
        const fileItem = api.controller.items.get(vscode.Uri.file(SUITE_FILE).toString());
        assert.strictEqual(api.controller.items.size, 1);
        assert.strictEqual(fileItem?.children.size, 2);
        assert.ok(api.tree.findTest(SUITE_FILE, 'test_success'));
    });

    test('runs the whole project and publishes results', async () => {
        const recorder = recordingController();
        const orchestrator = new RunOrchestrator(recorder.controller, api.tree, () => { });
        await orchestrator.run(new vscode.TestRunRequest(), new vscode.CancellationTokenSource().token);

        assert.strictEqual(recorder.outcomes.get('test_success'), 'passed',
            String(recorder.messages.get('test_success')?.message));
        assert.strictEqual(recorder.outcomes.get('test_failure'), 'failed');
        const failure = recorder.messages.get('test_failure');
        assert.match(String(failure?.message), /This is supposed to fail\./);
        assert.strictEqual(failure?.location?.range.start.line, 9);
    });

    test('runs only the requested test', async () => {
        const recorder = recordingController();
        const orchestrator = new RunOrchestrator(recorder.controller, api.tree, () => { });
        const item = api.tree.findTest(SUITE_FILE, 'test_success');
        assert.ok(item);
        await orchestrator.run(new vscode.TestRunRequest([item]), new vscode.CancellationTokenSource().token);

        assert.deepStrictEqual([...recorder.outcomes.entries()], [['test_success', 'passed']],
            String(recorder.messages.get('test_success')?.message));
    });
});
