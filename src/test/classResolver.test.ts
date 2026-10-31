import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { baseTarget, GdScriptClassResolver } from '../godot/classResolver';

function project(files: Record<string, string>): string {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'class-resolver-'));
    for (const [relative, content] of Object.entries(files)) {
        const file = path.join(root, relative);
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, content);
    }
    return root;
}

suite('GdScriptClassResolver', () => {
    test('reads a direct base class, an inline class_name base and a path base', () => {
        assert.strictEqual(baseTarget('extends Node\n'), 'Node');
        assert.strictEqual(baseTarget('class_name Foo extends Bar\n'), 'Bar');
        assert.strictEqual(baseTarget('@abstract class_name Foo\nextends Bar\n'), 'Bar');
        assert.strictEqual(baseTarget('extends "res://base.gd"\n'), 'res://base.gd');
        assert.strictEqual(baseTarget('extends Node # comment\n'), 'Node');
        assert.strictEqual(baseTarget('func f():\n\tpass\n'), undefined);
    });

    test('follows class_name declarations through several levels', async () => {
        const root = project({
            'test/base.gd': 'class_name Base\nextends GdUnitTestSuite\n',
            'test/middle.gd': '@abstract class_name Middle\nextends Base\n',
            'test/test_leaf.gd': 'extends Middle\n',
        });
        const file = path.join(root, 'test', 'test_leaf.gd');
        const chain = await new GdScriptClassResolver(root).lineage('extends Middle\n', file);
        assert.deepStrictEqual(chain, ['Middle', 'Base', 'GdUnitTestSuite']);
    });

    test('follows path-based extends', async () => {
        const root = project({
            'base.gd': 'extends GdUnitTestSuite\n',
            'test/test_leaf.gd': 'extends "res://base.gd"\n',
        });
        const file = path.join(root, 'test', 'test_leaf.gd');
        const chain = await new GdScriptClassResolver(root).lineage(
            'extends "res://base.gd"\n',
            file,
        );
        assert.deepStrictEqual(chain, ['res://base.gd', 'GdUnitTestSuite']);
    });

    test('stops at root classes, missing declarations and cycles', async () => {
        const root = project({
            'test/a.gd': 'class_name A\nextends B\n',
            'test/b.gd': 'class_name B\nextends A\n',
        });
        const resolver = new GdScriptClassResolver(root);
        assert.deepStrictEqual(
            await resolver.lineage('extends Node\n', path.join(root, 'test', 'a.gd')),
            ['Node'],
        );
        assert.deepStrictEqual(
            await resolver.lineage('extends Unknown\n', path.join(root, 'test', 'a.gd')),
            ['Unknown'],
        );
        assert.deepStrictEqual(
            await resolver.lineage('extends A\n', path.join(root, 'test', 'a.gd')),
            ['A', 'B'],
        );
    });

    test('finds the file declaring a class_name', async () => {
        const root = project({ 'test/utils/base.gd': '@abstract class_name Base\nextends Node\n' });
        const resolver = new GdScriptClassResolver(root);
        assert.strictEqual(
            await resolver.find('Base'),
            path.join(root, 'test', 'utils', 'base.gd'),
        );
        assert.strictEqual(await resolver.find('Missing'), undefined);
    });

    test('keeps path-based targets inside the project', async () => {
        const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'class-resolver-outside-'));
        try {
            const root = path.join(parent, 'project');
            const testDir = path.join(root, 'test');
            fs.mkdirSync(testDir, { recursive: true });
            const outside = path.join(parent, 'outside.gd');
            fs.writeFileSync(outside, 'extends GdUnitTestSuite\n');
            const file = path.join(testDir, 'test_leaf.gd');

            const resolver = new GdScriptClassResolver(root);
            assert.deepStrictEqual(await resolver.lineage('extends "../outside.gd"\n', file), [
                '../outside.gd',
            ]);
            assert.deepStrictEqual(
                await resolver.lineage('extends "res://../outside.gd"\n', file),
                ['res://../outside.gd'],
            );
            assert.deepStrictEqual(await resolver.lineage(`extends "${outside}"\n`, file), [
                outside,
            ]);
        } finally {
            fs.rmSync(parent, { recursive: true, force: true });
        }
    });

    test('keeps symlinked targets inside the project', async () => {
        const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'class-resolver-link-'));
        try {
            const root = path.join(parent, 'project');
            const testDir = path.join(root, 'test');
            const outside = path.join(parent, 'outside');
            fs.mkdirSync(testDir, { recursive: true });
            fs.mkdirSync(outside, { recursive: true });
            fs.writeFileSync(path.join(outside, 'base.gd'), 'extends GdUnitTestSuite\n');
            fs.symlinkSync(
                outside,
                path.join(root, 'linked'),
                process.platform === 'win32' ? 'junction' : 'dir',
            );
            const file = path.join(testDir, 'test_leaf.gd');

            const resolver = new GdScriptClassResolver(root);
            assert.deepStrictEqual(
                await resolver.lineage('extends "res://linked/base.gd"\n', file),
                ['res://linked/base.gd'],
            );
        } finally {
            fs.rmSync(parent, { recursive: true, force: true });
        }
    });

    test('picks up class_name declarations added after the index was built', async () => {
        const root = project({ 'test/test_leaf.gd': 'extends Later\n' });
        const resolver = new GdScriptClassResolver(root);
        assert.strictEqual(await resolver.find('Later'), undefined);

        fs.writeFileSync(path.join(root, 'test', 'later.gd'), 'class_name Later\nextends Node\n');
        resolver.invalidate();
        assert.strictEqual(await resolver.find('Later'), path.join(root, 'test', 'later.gd'));
    });

    test('forgets a moved class_name when invalidated', async () => {
        const root = project({
            'test/old.gd': 'class_name Moved\nextends Node\n',
            'test/new.gd': 'extends Node\n',
        });
        const resolver = new GdScriptClassResolver(root);
        assert.strictEqual(await resolver.find('Moved'), path.join(root, 'test', 'old.gd'));

        fs.writeFileSync(path.join(root, 'test', 'old.gd'), 'extends Node\n');
        fs.writeFileSync(path.join(root, 'test', 'new.gd'), 'class_name Moved\nextends Node\n');
        resolver.invalidate();
        assert.strictEqual(await resolver.find('Moved'), path.join(root, 'test', 'new.gd'));
    });
});
