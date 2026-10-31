import * as assert from 'assert';
import { gdunit4Adapter } from '../../adapters/gdunit4';

suite('GdUnit4 Adapter', () => {
    test('Check expected identity', () => {
        assert.strictEqual(gdunit4Adapter.id, 'gdunit4');
        assert.strictEqual(gdunit4Adapter.displayName, 'GDUnit 4 Adapter');
    });

    test('file filter targets test_*.gd files', () => {
        assert.strictEqual(gdunit4Adapter.discovery.fileFilter, '**/test_*.gd');
    });
});
