import * as assert from 'assert';
import * as path from 'path';
import { fromResPath, toResPath } from '../godot/resPath';
import { buildRunPlan } from '../testing/runPlan';

const A = '/proj/test_a.gd';
const B = '/proj/test_b.gd';
const KNOWN = [
    { file: A, name: 'test_1' },
    { file: A, name: 'test_2' },
    { file: B, name: 'test_3' },
];

suite('buildRunPlan', () => {
    test('runs every known file when nothing is selected', () => {
        const plan = buildRunPlan(KNOWN, undefined, []);
        assert.deepStrictEqual(plan.includeFiles, [A, B]);
        assert.deepStrictEqual(plan.excludeTests, []);
        assert.deepStrictEqual(plan.tests, KNOWN);
    });

    test('a single test includes its file and excludes its siblings', () => {
        const plan = buildRunPlan(KNOWN, [{ file: A, test: 'test_2' }], []);
        assert.deepStrictEqual(plan.includeFiles, [A]);
        assert.deepStrictEqual(plan.excludeTests, [{ file: A, name: 'test_1' }]);
        assert.deepStrictEqual(plan.tests, [{ file: A, name: 'test_2' }]);
    });

    test('exclusions remove tests and whole files', () => {
        const plan = buildRunPlan(KNOWN, undefined, [{ file: A, test: 'test_1' }, { file: B }]);
        assert.deepStrictEqual(plan.includeFiles, [A]);
        assert.deepStrictEqual(plan.excludeTests, [{ file: A, name: 'test_1' }]);
        assert.deepStrictEqual(plan.tests, [{ file: A, name: 'test_2' }]);
    });

    test('an empty selection yields an empty plan', () => {
        const plan = buildRunPlan(KNOWN, [{ file: '/proj/other.gd' }], []);
        assert.deepStrictEqual(plan, { includeFiles: [], excludeTests: [], tests: [] });
    });
});

suite('resPath', () => {
    const root = path.resolve('/proj');

    test('round-trips files inside the project', () => {
        const file = path.join(root, 'test', 'unit', 'test_a.gd');
        assert.strictEqual(toResPath(root, file), 'res://test/unit/test_a.gd');
        assert.strictEqual(fromResPath(root, 'res://test/unit/test_a.gd'), file);
    });

    test('rejects paths outside the project or without res://', () => {
        assert.strictEqual(toResPath(root, path.resolve('/other/test_a.gd')), undefined);
        assert.strictEqual(fromResPath(root, 'user://save.dat'), undefined);
    });
});
