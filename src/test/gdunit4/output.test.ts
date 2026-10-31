import * as assert from 'assert';
import * as path from 'path';
import { gdunit4Adapter } from '../../adapters/gdunit4';
import { parseDuration } from '../../adapters/gdunit4/output';
import { CAPTURED_OUTPUT, PROJECT_ROOT } from './fixtures';

suite('GdUnit4 output', () => {
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
                message:
                    "Expecting: 'true' but is 'false'\nAdditional info:\nThis is supposed to fail.",
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
            'Statistics: 3 test cases | 0 errors | 1 failures | 1 flaky | 1 skipped | ' +
                '0 orphans | FAILED 1s',
        ].join('\r\n');
        const results = gdunit4Adapter.parseResults(output, PROJECT_ROOT);
        assert.deepStrictEqual(
            results.map((r) => [r.name, r.status, r.duration]),
            [
                ['test_one', 'skipped', 0],
                ['test_two', 'passed', 1005],
                ['test_three', 'failed', 12],
            ],
        );
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
            'Statistics: 1 test cases | 0 errors | 0 failures | 0 flaky | 0 skipped | ' +
                '1 orphans | WARNING 1ms',
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
