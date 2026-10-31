import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { gdunit4Adapter } from '../adapters/gdunit4Adapter';
import { executableLines } from '../coverage/executableLines';
import { collectLineHits } from '../coverage/lineCollector';
import { DebuggerServer } from '../godot/debuggerServer';
import { resolveGodot } from '../godot/godotResolver';
import { runGodot } from '../godot/runGodot';

const DEMO_PROJECT = path.resolve(__dirname, '../../src/demo/gdunit4-adapter-demo');
const CALCULATOR = path.join(DEMO_PROJECT, 'src', 'calculator.gd');
const CALCULATOR_RES = 'res://src/calculator.gd';
const CALCULATOR_TEST = path.join(DEMO_PROJECT, 'test', 'test_calculator.gd');

/**
 * End-to-end coverage: listen, run the tests with the debugger pointed at us, collect the
 * breakpoints the tests hit. Requires `godot` on PATH and opens a Godot window briefly.
 */
suite('Coverage run against the demo project', function () {
    this.timeout(120_000);

    test('reports the taken branch and leaves the other branch uncovered', async () => {
        const godot = resolveGodot(undefined);
        assert.ok(godot.ok, 'godot must be on PATH');

        const source = fs.readFileSync(CALCULATOR, 'utf-8');
        const executable = executableLines(source);
        assert.ok(executable.includes(5), `executable lines: ${executable.join(', ')}`);
        assert.ok(executable.includes(8), `executable lines: ${executable.join(', ')}`);
        assert.ok(executable.includes(16), `executable lines: ${executable.join(', ')}`);
        assert.ok(executable.includes(18), `executable lines: ${executable.join(', ')}`);

        const server = new DebuggerServer(() => {});
        const port = await server.listen();
        const collecting = collectLineHits(server, new Map([[CALCULATOR_RES, executable]]));
        try {
            const args = gdunit4Adapter.buildRunArgs({
                projectRoot: DEMO_PROJECT,
                includeFiles: [CALCULATOR_TEST],
                excludeTests: [],
                debuggerUri: `tcp://127.0.0.1:${port}`,
            });
            const result = await runGodot(godot.godot.path, args, { cwd: DEMO_PROJECT });
            server.close();
            const hits = await collecting;
            const covered = hits.get(CALCULATOR_RES) ?? new Set<number>();

            assert.strictEqual(result.exitCode, 0, result.stdout);
            assert.ok(covered.has(6), `covered: ${[...covered].join(', ')}`);
            assert.ok(covered.has(14), `covered: ${[...covered].join(', ')}`);
            assert.ok(!covered.has(8), `covered: ${[...covered].join(', ')}`);
            assert.ok(!covered.has(16), `covered: ${[...covered].join(', ')}`);
            assert.ok(!covered.has(18), `covered: ${[...covered].join(', ')}`);
        } finally {
            server.close();
        }
    });
});
