import * as assert from 'assert';
import { mockAdapter } from '../adapters/mockAdapter';

suite('mockAdapter', () => {
    test('exposes expected identity', () => {
        assert.strictEqual(mockAdapter.id, 'mock');
        assert.strictEqual(mockAdapter.displayName, 'Mock Adapter');
    });

    test('detects itself in any workspace', async () => {
        assert.strictEqual(await mockAdapter.detect('/any/path'), true);
        assert.strictEqual(await mockAdapter.detectVersion('/any/path'), '0.0.0-mock');
    });

    test('discovery returns the fixed set of test cases', () => {
        const cases = mockAdapter.discovery.parseTestCases('ignored');
        assert.strictEqual(cases.length, 3);
        assert.strictEqual(cases[0].name, 'test_addition');
        assert.strictEqual(cases[1].name, 'test_subtraction');
        assert.strictEqual(cases[2].name, 'test_multiplication');
    });

    test('parseResults returns the fixed set and returns copies', () => {
        const first = mockAdapter.parseResults('ignored', '/proj');
        assert.strictEqual(first.length, 3);
        assert.strictEqual(first[1].status, 'failed');
        assert.strictEqual(first[1].message, 'expected 5, got 4');

        // Mutation of a returned result must not corrupt the shared fixture.
        first[0].name = 'corrupted';
        const second = mockAdapter.parseResults('ignored', '/proj');
        assert.strictEqual(second[0].name, 'test_addition');
    });

    test('buildRunArgs maps include files and exclude tests', () => {
        const args = mockAdapter.buildRunArgs({
            projectRoot: '/proj',
            includeFiles: ['/proj/test_1.gd', '/proj/test_2.gd'],
            excludeTests: [{ file: '/proj/test_1.gd', name: 'test_addition' }],
        });
        assert.deepStrictEqual(args, [
            '--file', '/proj/test_1.gd',
            '--file', '/proj/test_2.gd',
            '--exclude', '/proj/test_1.gd:test_addition',
        ]);
    });
});
