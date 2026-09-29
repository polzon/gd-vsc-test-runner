import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { gdunit4Adapter } from '../adapters/gdunit4Adapter';
import { resolveGodot } from '../godot/godotResolver';
import { runGodot } from '../godot/runGodot';

const DEMO_PROJECT = path.resolve(__dirname, '../../src/demo/gdunit4-adapter-demo');
const SUITE_FILE = path.join(DEMO_PROJECT, 'test', 'test_example_test.gd');

/**
 * End-to-end: build args → run the real Godot + GdUnit4 → parse stdout.
 * Requires `godot` on PATH (present in the development environment) and opens a Godot window briefly.
 */
suite('GdUnit4 run against the demo project', function () {
    this.timeout(120_000);

    function godotPath(): string {
        const result = resolveGodot(undefined);
        assert.ok(result.ok, 'godot must be on PATH');
        return result.godot.path;
    }

    async function run(excludeTests: { file: string; name: string }[] = []) {
        const args = gdunit4Adapter.buildRunArgs({ projectRoot: DEMO_PROJECT, includeFiles: [SUITE_FILE], excludeTests });
        const result = await runGodot(godotPath(), args, { cwd: DEMO_PROJECT });
        return { ...result, results: gdunit4Adapter.parseResults(result.stdout, DEMO_PROJECT) };
    }

    test('reports the passing and failing demo tests', async () => {
        const { exitCode, results } = await run();
        assert.strictEqual(exitCode, 100, 'GdUnit4 exits with 100 when tests fail');
        const byName = new Map(results.map((r) => [r.name, r]));
        assert.strictEqual(byName.get('test_success')?.status, 'passed');
        assert.strictEqual(byName.get('test_failure')?.status, 'failed');
        assert.strictEqual(byName.get('test_failure')?.file, SUITE_FILE);
        assert.match(byName.get('test_failure')?.message ?? '', /This is supposed to fail\./);
    });

    test('runs a single test by excluding its siblings', async () => {
        const { exitCode, results } = await run([{ file: SUITE_FILE, name: 'test_failure' }]);
        assert.strictEqual(exitCode, 0);
        assert.deepStrictEqual(results.map((r) => [r.name, r.status]), [['test_success', 'passed']]);
    });

    test('does not write reports into the project', () => {
        const reports = path.join(DEMO_PROJECT, 'reports');
        const entries = fs.existsSync(reports) ? fs.readdirSync(reports) : [];
        assert.ok(!entries.some((e) => e !== 'report_1'), `unexpected reports: ${entries.join(', ')}`);
    });
});
