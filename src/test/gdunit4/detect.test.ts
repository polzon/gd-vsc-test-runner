import * as assert from 'assert';
import { gdunit4Adapter } from '../../adapters/gdunit4';
import { DEMO_PROJECT } from '../demoProject';
import { withTempDir } from '../helpers/tempDir';

suite('GdUnit4 detection', () => {
    test('detects the addon and its version in the demo project', async () => {
        assert.strictEqual(await gdunit4Adapter.detect(DEMO_PROJECT), true);
        assert.strictEqual(await gdunit4Adapter.detectVersion(DEMO_PROJECT), '6.2.1');
    });

    test('does not detect the addon in an empty directory', async () => {
        await withTempDir('gdunit4-detect-', async (empty) => {
            assert.strictEqual(await gdunit4Adapter.detect(empty), false);
            assert.strictEqual(await gdunit4Adapter.detectVersion(empty), undefined);
        });
    });
});
