import * as assert from 'assert';
import { gdunit4Adapter } from '../adapters/gdunit4Adapter';

suite('GdUnit4 Adapter', () => {
    test('Check expected identity', () => {
        assert.strictEqual(gdunit4Adapter.id, 'gdunit4');
        assert.strictEqual(gdunit4Adapter.displayName, 'GDUnit 4 Adapter');
    });

    test('Detect valid tests', () => {
        const EXAMPLE_FILES: string[] = ["test_mytest.gd"];
        assert.ok(gdunit4Adapter.discovery.fileFilter.match(EXAMPLE_FILES[0]));
    });
});
