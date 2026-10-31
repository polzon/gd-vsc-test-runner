import * as assert from 'assert';
import * as path from 'path';
import * as vscode from 'vscode';
import { getDetailedCoverage } from '../coverage/coverageStore';
import type { ExtensionApi } from '../extension';
import { RunOrchestrator } from '../testing/runOrchestrator';

const DEMO_PROJECT = path.resolve(__dirname, '../../src/demo/gdunit4-adapter-demo');
const SUITE_FILE = path.join(DEMO_PROJECT, 'test', 'test_example_test.gd');
const CALCULATOR_TEST = path.join(DEMO_PROJECT, 'test', 'test_calculator.gd');
const CALCULATOR_SCRIPT = path.join(DEMO_PROJECT, 'src', 'calculator.gd');

type Outcome = 'started' | 'passed' | 'failed' | 'errored' | 'skipped';

/** Records what the orchestrator publishes, keyed by TestItem label. */
function recordingController() {
    const outcomes = new Map<string, Outcome>();
    const messages = new Map<string, vscode.TestMessage>();
    const coverages: vscode.FileCoverage[] = [];
    const set =
        (outcome: Outcome) =>
        (item: vscode.TestItem, message?: vscode.TestMessage | readonly vscode.TestMessage[]) => {
            outcomes.set(item.label, outcome);
            if (message) {
                messages.set(
                    item.label,
                    Array.isArray(message) ? message[0] : (message as vscode.TestMessage),
                );
            }
        };
    const run = {
        started: set('started'),
        passed: set('passed'),
        failed: set('failed'),
        errored: set('errored'),
        skipped: set('skipped'),
        enqueued: () => {},
        appendOutput: () => {},
        addCoverage: (coverage: vscode.FileCoverage) => coverages.push(coverage),
        end: () => {},
    } as unknown as vscode.TestRun;
    return { controller: { createTestRun: () => run }, outcomes, messages, coverages };
}

/**
 * Runs inside the Extension Development Host with the demo Godot project opened
 * (see .vscode-test.mjs).
 */
suite('Extension (demo project)', function () {
    this.timeout(120_000);
    let api: ExtensionApi;

    suiteSetup(async () => {
        const extension = vscode.extensions.getExtension<ExtensionApi>(
            'polzon.gdscript-test-runner',
        );
        assert.ok(extension, 'extension is installed in the test host');
        const activated = await extension.activate();
        assert.ok(activated, 'extension activates in the demo Godot project');
        api = activated;
        await api.tree.discover();
    });

    test('discovers the demo suites and their test cases, ignoring addon suites', async () => {
        const files = api.tree.fileItems();
        assert.deepStrictEqual(
            files.map((f) => f.uri?.fsPath.toLowerCase()).sort(),
            [CALCULATOR_TEST.toLowerCase(), SUITE_FILE.toLowerCase()].sort(),
        );

        const topLevel: vscode.TestItem[] = [];
        api.controller.items.forEach((item) => topLevel.push(item));
        assert.deepStrictEqual(
            topLevel.map((item) => item.label),
            ['test'],
        );
        const fileItem = topLevel[0].children.get(vscode.Uri.file(SUITE_FILE).toString());
        assert.ok(fileItem);

        await api.tree.ensureResolved();
        const names: string[] = [];
        fileItem.children.forEach((child) => names.push(child.label));
        assert.deepStrictEqual(names.sort(), ['test_failure', 'test_success']);
        assert.strictEqual(api.tree.findTest(SUITE_FILE, 'test_success')?.range?.start.line, 3);
    });

    test('discovers each inline parameter set as its own test', async () => {
        await api.tree.ensureResolved();
        const calculator = api.tree
            .fileItems()
            .find((item) => item.uri?.fsPath === CALCULATOR_TEST);
        assert.ok(calculator);
        const names: string[] = [];
        calculator.children.forEach((child) => names.push(child.label));
        assert.deepStrictEqual(names.sort(), [
            'test_describe_positive',
            'test_rank_positive:0 (1)',
            'test_rank_positive:1 (2)',
            'test_rank_positive:2 (3)',
            'test_rank_zero',
        ]);
    });

    test('refreshing keeps existing items instead of recreating them', async () => {
        const before = api.tree.findTest(SUITE_FILE, 'test_success');
        assert.ok(before);
        await Promise.all([api.tree.refresh(), api.tree.refresh()]);
        assert.strictEqual(api.controller.items.size, 1);
        assert.strictEqual(api.tree.fileItems().length, 2);
        assert.ok(api.tree.findTest(SUITE_FILE, 'test_success'));
        assert.ok(api.tree.findTest(CALCULATOR_TEST, 'test_rank_zero'));
    });

    test('runs the whole project and publishes results', async () => {
        const recorder = recordingController();
        const orchestrator = new RunOrchestrator(recorder.controller, api.tree, () => {});
        await orchestrator.run(
            new vscode.TestRunRequest(),
            new vscode.CancellationTokenSource().token,
        );

        assert.strictEqual(
            recorder.outcomes.get('test_success'),
            'passed',
            String(recorder.messages.get('test_success')?.message),
        );
        assert.strictEqual(recorder.outcomes.get('test_failure'), 'failed');
        const failure = recorder.messages.get('test_failure');
        assert.match(String(failure?.message), /This is supposed to fail\./);
        assert.strictEqual(failure?.location?.range.start.line, 9);
        assert.strictEqual(recorder.outcomes.get('test_describe_positive'), 'passed');
        assert.strictEqual(recorder.outcomes.get('test_rank_zero'), 'passed');
        for (const name of [
            'test_rank_positive:0 (1)',
            'test_rank_positive:1 (2)',
            'test_rank_positive:2 (3)',
        ]) {
            assert.strictEqual(recorder.outcomes.get(name), 'passed', name);
        }
        assert.deepStrictEqual(
            [...recorder.outcomes.entries()].filter(([, outcome]) => outcome === 'errored'),
            [],
        );
    });

    test('runs only the requested test', async () => {
        const recorder = recordingController();
        const orchestrator = new RunOrchestrator(recorder.controller, api.tree, () => {});
        const item = api.tree.findTest(SUITE_FILE, 'test_success');
        assert.ok(item);
        await orchestrator.run(
            new vscode.TestRunRequest([item]),
            new vscode.CancellationTokenSource().token,
        );

        assert.deepStrictEqual(
            [...recorder.outcomes.entries()],
            [['test_success', 'passed']],
            String(recorder.messages.get('test_success')?.message),
        );
    });

    test('runs one parameter set of a parameterized test', async () => {
        const recorder = recordingController();
        const orchestrator = new RunOrchestrator(recorder.controller, api.tree, () => {});
        const item = api.tree.findTest(CALCULATOR_TEST, 'test_rank_positive:2 (3)');
        assert.ok(item);
        await orchestrator.run(
            new vscode.TestRunRequest([item]),
            new vscode.CancellationTokenSource().token,
        );

        assert.deepStrictEqual(
            [...recorder.outcomes.entries()],
            [['test_rank_positive:2 (3)', 'passed']],
        );
    });

    test('a coverage run reports taken and untaken lines', async () => {
        const recorder = recordingController();
        const orchestrator = new RunOrchestrator(recorder.controller, api.tree, () => {});
        const item = api.tree.findTest(CALCULATOR_TEST, 'test_describe_positive');
        assert.ok(item);
        await orchestrator.run(
            new vscode.TestRunRequest([item]),
            new vscode.CancellationTokenSource().token,
            { coverage: true },
        );

        assert.strictEqual(recorder.outcomes.get('test_describe_positive'), 'passed');
        const coverage = recorder.coverages.find((entry) => entry.uri.fsPath === CALCULATOR_SCRIPT);
        assert.ok(coverage, 'calculator.gd is in the coverage report');
        const lines = (executed: boolean): number[] =>
            getDetailedCoverage(coverage)
                .filter((detail) => detail.executed === executed)
                .map((detail) => (detail.location as vscode.Range).start.line + 1);
        assert.ok(lines(true).includes(6), `covered: ${lines(true).join(', ')}`);
        assert.ok(lines(false).includes(8), `uncovered: ${lines(false).join(', ')}`);
    });
});
