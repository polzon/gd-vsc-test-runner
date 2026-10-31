import * as assert from 'assert';
import { buildRunPlan } from '../testExplorer/runPlan';

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

    test('selecting one parameter set runs the whole function', () => {
        const known = [
            { file: A, name: 'test_p:0 (1)', runName: 'test_p' },
            { file: A, name: 'test_p:1 (2)', runName: 'test_p' },
            { file: A, name: 'test_1' },
        ];
        const plan = buildRunPlan(known, [{ file: A, test: 'test_p:0 (1)' }], []);
        assert.deepStrictEqual(plan.includeFiles, [A]);
        assert.deepStrictEqual(plan.tests, [known[0]]);
        assert.deepStrictEqual(plan.excludeTests, [{ file: A, name: 'test_1' }]);
    });

    test('ignores a parameterized function by its base name', () => {
        const known = [
            { file: A, name: 'test_p:0 (1)', runName: 'test_p' },
            { file: A, name: 'test_p:1 (2)', runName: 'test_p' },
            { file: A, name: 'test_1' },
        ];
        const plan = buildRunPlan(known, [{ file: A, test: 'test_1' }], []);
        assert.deepStrictEqual(plan.tests, [known[2]]);
        assert.deepStrictEqual(plan.excludeTests, [{ file: A, name: 'test_p' }]);
    });
});
