import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { GodotProbe, resolveGodot } from '../godot/godotResolver';

const okProbe: GodotProbe = () => ({ ok: true, version: '9.9.9.test' });

suite('resolveGodot', () => {
    test('returns not-found for a non-existent explicit path', () => {
        const result = resolveGodot(path.join('C:\\does\\not\\exist', 'godot.exe'), okProbe);
        assert.strictEqual(result.ok, false);
        if (!result.ok) {
            assert.strictEqual(result.error.code, 'not-found');
        }
    });

    test('resolves an explicit path and reports its probed version', () => {
        const tmp = path.join(os.tmpdir(), `fake-godot-${Date.now()}.exe`);
        fs.writeFileSync(tmp, '');
        try {
            const result = resolveGodot(tmp, okProbe);
            assert.strictEqual(result.ok, true);
            if (result.ok) {
                assert.strictEqual(result.godot.path, tmp);
                assert.strictEqual(result.godot.version, '9.9.9.test');
                assert.strictEqual(result.godot.source, 'setting');
            }
        } finally {
            fs.unlinkSync(tmp);
        }
    });

    test('returns version-failed when the probe fails on an existing path', () => {
        const tmp = path.join(os.tmpdir(), `fake-godot-${Date.now()}.exe`);
        fs.writeFileSync(tmp, '');
        try {
            const result = resolveGodot(tmp, () => ({ ok: false, message: 'boom' }));
            assert.strictEqual(result.ok, false);
            if (!result.ok) {
                assert.strictEqual(result.error.code, 'version-failed');
            }
        } finally {
            fs.unlinkSync(tmp);
        }
    });

    test('falls back to PATH when no explicit path is configured', () => {
        // Requires `godot` on PATH; present in the development environment.
        const result = resolveGodot(undefined);
        assert.strictEqual(result.ok, true);
        if (result.ok) {
            assert.strictEqual(result.godot.source, 'path');
            assert.match(result.godot.version, /^\d+\.\d+/);
        }
    });
});
