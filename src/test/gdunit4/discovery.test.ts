import * as assert from 'assert';
import * as path from 'path';
import { gdunit4Adapter } from '../../adapters/gdunit4';
import { withTempProject } from '../helpers/tempDir';
import { SUITE } from './fixtures';

suite('GdUnit4 discovery', () => {
    test('discovers top-level test_ functions with their body ranges', async () => {
        const cases = await gdunit4Adapter.discovery.parseTestCases(SUITE);
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

    test('discovers each inline parameter set as its own test', async () => {
        const content = [
            'extends GdUnitTestSuite',
            '',
            'func test_even(',
            '\tvalue: int,',
            '\t_test_parameters := [',
            '\t\t[2, "two"],',
            '\t\t[4, "four"],',
            '\t]',
            ') -> void:',
            '\tassert_int(value % 2).is_equal(0)',
        ].join('\n');
        const cases = await gdunit4Adapter.discovery.parseTestCases(content);
        assert.deepStrictEqual(
            cases.map((c) => [c.name, c.label, c.parentName, c.runName]),
            [
                ["test_even:0 (2, 'two')", "2, 'two'", 'test_even', 'test_even'],
                ["test_even:1 (4, 'four')", "4, 'four'", 'test_even', 'test_even'],
            ],
        );
    });

    test('normalizes compact parameter sets like GdUnit4 prints them', async () => {
        const content = [
            'extends GdUnitTestSuite',
            '',
            'func test_pair(',
            '\tleft: int,',
            '\tright: int,',
            '\t_test_parameters := [[1,2],[3,4]],',
            ') -> void:',
            '\tassert_bool(true).is_true()',
        ].join('\n');
        const cases = await gdunit4Adapter.discovery.parseTestCases(content);
        assert.deepStrictEqual(
            cases.map((c) => c.name),
            ['test_pair:0 (1, 2)', 'test_pair:1 (3, 4)'],
        );
    });

    test('leaves a parameter source it cannot evaluate as one test', async () => {
        const content = [
            'extends GdUnitTestSuite',
            'const CASES := [[1], [2]]',
            '',
            'func test_from_property(',
            '\tvalue: int,',
            '\t_test_parameters := CASES,',
            ') -> void:',
            '\tassert_int(value).is_greater(0)',
        ].join('\n');
        const cases = await gdunit4Adapter.discovery.parseTestCases(content);
        assert.deepStrictEqual(
            cases.map((c) => [c.name, c.runName]),
            [['test_from_property', undefined]],
        );
    });

    test('ignores files that do not extend GdUnitTestSuite', async () => {
        const cases = await gdunit4Adapter.discovery.parseTestCases(
            'extends Node\n\nfunc test_x():\n\tpass\n',
        );
        assert.deepStrictEqual(cases, []);
    });

    test('accepts class_name and path-based extends', async () => {
        const byClassName = 'class_name MyTest extends GdUnitTestSuite\nfunc test_a():\n\tpass\n';
        const byPath =
            'extends "res://addons/gdUnit4/src/GdUnitTestSuite.gd"\nfunc test_b():\n\tpass\n';
        assert.strictEqual(
            (await gdunit4Adapter.discovery.parseTestCases(byClassName))[0].name,
            'test_a',
        );
        assert.strictEqual(
            (await gdunit4Adapter.discovery.parseTestCases(byPath))[0].name,
            'test_b',
        );
    });

    test('ignores indented (inner-class) test functions', async () => {
        const content = 'extends GdUnitTestSuite\nclass Inner:\n\tfunc test_inner():\n\t\tpass\n';
        assert.deepStrictEqual(await gdunit4Adapter.discovery.parseTestCases(content), []);
    });

    test('follows extends through project classes to GdUnitTestSuite', async () => {
        const content = 'extends GdTestSuiteExtended\n\nfunc test_x():\n\tpass\n';
        await withTempProject(
            'gdunit4-inherit-',
            {
                'test/utils/gd_test_suite_extended.gd':
                    '@abstract class_name GdTestSuiteExtended\nextends GdUnitTestSuite\n',
                'test/test_inherited.gd': content,
            },
            async (project) => {
                const cases = await gdunit4Adapter.discovery.parseTestCases(content, {
                    projectRoot: project,
                    file: path.join(project, 'test', 'test_inherited.gd'),
                });
                assert.deepStrictEqual(
                    cases.map((c) => c.name),
                    ['test_x'],
                );
            },
        );
    });
});
