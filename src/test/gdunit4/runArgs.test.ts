import * as assert from 'assert';
import * as path from 'path';
import { gdunit4Adapter } from '../../adapters/gdunit4';
import { PROJECT_ROOT } from './fixtures';

suite('GdUnit4 run arguments', () => {
    test('buildRunArgs adds included files and ignores excluded tests as res:// paths', () => {
        const args = gdunit4Adapter.buildRunArgs({
            projectRoot: PROJECT_ROOT,
            includeFiles: [path.join(PROJECT_ROOT, 'test', 'test_a.gd')],
            excludeTests: [
                { file: path.join(PROJECT_ROOT, 'test', 'test_a.gd'), name: 'test_skip_me' },
            ],
        });
        assert.deepStrictEqual(args.slice(0, 7), [
            '--path',
            PROJECT_ROOT,
            '-s',
            '-d',
            '--remote-debug',
            'tcp://127.0.0.1:0',
            'res://addons/gdUnit4/bin/GdUnitCmdTool.gd',
        ]);
        assert.ok(args.includes('-c'), 'continues past failures');
        assert.deepStrictEqual(args.slice(-4), [
            '-a',
            'res://test/test_a.gd',
            '-i',
            'res://test/test_a.gd:test_skip_me',
        ]);
    });

    test('buildRunArgs uses the coverage debugger URI and ignores error breaks', () => {
        const args = gdunit4Adapter.buildRunArgs({
            projectRoot: PROJECT_ROOT,
            includeFiles: [],
            excludeTests: [],
            debuggerUri: 'tcp://127.0.0.1:4321',
        });
        assert.deepStrictEqual(args.slice(0, 8), [
            '--path',
            PROJECT_ROOT,
            '-s',
            '-d',
            '--remote-debug',
            'tcp://127.0.0.1:4321',
            '--ignore-error-breaks',
            'res://addons/gdUnit4/bin/GdUnitCmdTool.gd',
        ]);
    });

    test('buildRunArgs runs the whole project except addons when no files are given', () => {
        const args = gdunit4Adapter.buildRunArgs({
            projectRoot: PROJECT_ROOT,
            includeFiles: [],
            excludeTests: [],
        });
        assert.deepStrictEqual(args.slice(-4), ['-a', 'res://', '-i', 'res://addons']);
    });

    test('buildRunArgs rejects files outside the project', () => {
        assert.throws(() =>
            gdunit4Adapter.buildRunArgs({
                projectRoot: PROJECT_ROOT,
                includeFiles: [path.resolve('/elsewhere/test_x.gd')],
                excludeTests: [],
            }),
        );
    });
});
