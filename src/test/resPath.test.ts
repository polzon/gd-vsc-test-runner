import * as assert from 'assert';
import * as path from 'path';
import { fromResPath, toResPath } from '../godot/resPath';

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
