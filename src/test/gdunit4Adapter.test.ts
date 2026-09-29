import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { gdunit4Adapter } from '../adapters/gdunit4Adapter';
import { parseDuration } from '../adapters/gdunit4Output';

const PROJECT_ROOT = path.resolve('/proj');
const DEMO_PROJECT = path.resolve(__dirname, '../../src/demo/gdunit4-adapter-demo');
/** Real stdout captured from running the demo project's suite with GdUnit4 6.2.1. */
const CAPTURED_OUTPUT = fs.readFileSync(path.resolve(__dirname, '../../src/test/fixtures/gdunit4-output.txt'), 'utf-8');

const SUITE = [
    'extends GdUnitTestSuite',
    '',
    '',
    'func test_success():',
    '\tassert_bool(true).is_true()',
    '',
    '',
    'func helper():',
    '\tpass',
    '',
    'static func test_static() -> void:',
    '\tvar x := 1',
    '',
    '\tassert_int(x).is_equal(1)',
    '',
].join('\n');

suite('GdUnit4 Adapter', () => {
    test('Check expected identity', () => {
        assert.strictEqual(gdunit4Adapter.id, 'gdunit4');
        assert.strictEqual(gdunit4Adapter.displayName, 'GDUnit 4 Adapter');
    });

    test('file filter targets test_*.gd files', () => {
        assert.strictEqual(gdunit4Adapter.discovery.fileFilter, '**/test_*.gd');
    });

    test('discovers top-level test_ functions with their body ranges', () => {
        const cases = gdunit4Adapter.discovery.parseTestCases(SUITE);
        assert.deepStrictEqual(cases, [
            {
                name: 'test_success',
                range: { startLine: 3, startCharacter: 0, endLine: 4, endCharacter: 28 },
            },
            {
                name: 'test_static',
                range: { startLine: 10, startCharacter: 0, endLine: 13, endCharacter: 26 },
            },
        ]);
    });

    test('ignores files that do not extend GdUnitTestSuite', () => {
        const cases = gdunit4Adapter.discovery.parseTestCases('extends Node\n\nfunc test_x():\n\tpass\n');
        assert.deepStrictEqual(cases, []);
    });

    test('accepts class_name and path-based extends', () => {
        const byClassName = 'class_name MyTest extends GdUnitTestSuite\nfunc test_a():\n\tpass\n';
        const byPath = 'extends "res://addons/gdUnit4/src/GdUnitTestSuite.gd"\nfunc test_b():\n\tpass\n';
        assert.strictEqual(gdunit4Adapter.discovery.parseTestCases(byClassName)[0].name, 'test_a');
        assert.strictEqual(gdunit4Adapter.discovery.parseTestCases(byPath)[0].name, 'test_b');
    });

    test('ignores indented (inner-class) test functions', () => {
        const content = 'extends GdUnitTestSuite\nclass Inner:\n\tfunc test_inner():\n\t\tpass\n';
        assert.deepStrictEqual(gdunit4Adapter.discovery.parseTestCases(content), []);
    });

    test('detects the addon and its version in the demo project', async () => {
        assert.strictEqual(await gdunit4Adapter.detect(DEMO_PROJECT), true);
        assert.strictEqual(await gdunit4Adapter.detectVersion(DEMO_PROJECT), '6.2.1');
    });

    test('does not detect the addon in an empty directory', async () => {
        const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'gdunit4-detect-'));
        try {
            assert.strictEqual(await gdunit4Adapter.detect(empty), false);
            assert.strictEqual(await gdunit4Adapter.detectVersion(empty), undefined);
        } finally {
            fs.rmSync(empty, { recursive: true, force: true });
        }
    });

    test('buildRunArgs adds included files and ignores excluded tests as res:// paths', () => {
        const args = gdunit4Adapter.buildRunArgs({
            projectRoot: PROJECT_ROOT,
            includeFiles: [path.join(PROJECT_ROOT, 'test', 'test_a.gd')],
            excludeTests: [{ file: path.join(PROJECT_ROOT, 'test', 'test_a.gd'), name: 'test_skip_me' }],
        });
        assert.deepStrictEqual(args.slice(0, 7), [
            '--path', PROJECT_ROOT, '-s', '-d', '--remote-debug', 'tcp://127.0.0.1:0',
            'res://addons/gdUnit4/bin/GdUnitCmdTool.gd',
        ]);
        assert.ok(args.includes('-c'), 'continues past failures');
        assert.deepStrictEqual(args.slice(-4), ['-a', 'res://test/test_a.gd', '-i', 'res://test/test_a.gd:test_skip_me']);
    });

    test('buildRunArgs runs the whole project except addons when no files are given', () => {
        const args = gdunit4Adapter.buildRunArgs({ projectRoot: PROJECT_ROOT, includeFiles: [], excludeTests: [] });
        assert.deepStrictEqual(args.slice(-4), ['-a', 'res://', '-i', 'res://addons']);
    });

    test('buildRunArgs rejects files outside the project', () => {
        assert.throws(() => gdunit4Adapter.buildRunArgs({
            projectRoot: PROJECT_ROOT,
            includeFiles: [path.resolve('/elsewhere/test_x.gd')],
            excludeTests: [],
        }));
    });

    test('parses results from real GdUnit4 console output', () => {
        const results = gdunit4Adapter.parseResults(CAPTURED_OUTPUT, PROJECT_ROOT);
        const file = path.join(PROJECT_ROOT, 'test', 'test_example_test.gd');
        assert.deepStrictEqual(results, [
            { name: 'test_success', file, status: 'passed', duration: 29 },
            {
                name: 'test_failure',
                file,
                status: 'failed',
                duration: 29,
                location: { file, line: 9 },
                message: "Expecting: 'true' but is 'false'\nAdditional info:\nThis is supposed to fail.",
            },
        ]);
    });

    test('parses skipped, flaky and retried statuses', () => {
        const output = [
            '  res://t/test_a.gd > test_one SKIPPED 0ms',
            '  Report:',
            '    This test is skipped!',
            '  Reason: not ready',
            '  res://t/test_a.gd > test_two FLAKY (2 retries) 1s 5ms',
            '  res://t/test_a.gd > test_three FAILED (retry 3) 12ms',
            'Statistics: 3 test cases | 0 errors | 1 failures | 1 flaky | 1 skipped | 0 orphans | FAILED 1s',
        ].join('\r\n');
        const results = gdunit4Adapter.parseResults(output, PROJECT_ROOT);
        assert.deepStrictEqual(results.map((r) => [r.name, r.status, r.duration]), [
            ['test_one', 'skipped', 0],
            ['test_two', 'passed', 1005],
            ['test_three', 'failed', 12],
        ]);
        assert.strictEqual(results[0].message, 'This test is skipped!\nReason: not ready');
        assert.strictEqual(results[2].message, undefined);
    });

    test('suite finalize() reports are not attributed to the last test', () => {
        const output = [
            '  res://t/test_a.gd > test_one PASSED 1ms',
            '',
            '  test_a > finalize()',
            '  Report:',
            '    orphan nodes detected',
            'Statistics: 1 test cases | 0 errors | 0 failures | 0 flaky | 0 skipped | 1 orphans | WARNING 1ms',
        ].join('\n');
        const [result] = gdunit4Adapter.parseResults(output, PROJECT_ROOT);
        assert.strictEqual(result.status, 'passed');
        assert.strictEqual(result.message, undefined);
    });

    test('parseDuration handles every GdUnit4 elapsed format', () => {
        assert.strictEqual(parseDuration('29ms'), 29);
        assert.strictEqual(parseDuration('1s 234ms'), 1234);
        assert.strictEqual(parseDuration('2min 3s 4ms'), 123004);
        assert.strictEqual(parseDuration('1h 0min 0s 1ms'), 3600001);
        assert.strictEqual(parseDuration(''), undefined);
    });
});
