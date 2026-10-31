import * as fs from 'fs';
import * as path from 'path';

export const PROJECT_ROOT = path.resolve('/proj');

export const SUITE = [
    'extends GdUnitTestSuite',
    '',
    '',
    'func test_success():',
    '\tassert_bool(true).is_true()',
    '',
    '',
    'func helper():',
    '\tpass',
    '',
    'static func test_static() -> void:',
    '\tvar x := 1',
    '',
    '\tassert_int(x).is_equal(1)',
    '',
].join('\n');

/** Real stdout captured from running the demo project's suite with GdUnit4 6.2.1. */
export const CAPTURED_OUTPUT = fs.readFileSync(
    path.resolve(__dirname, '../../../src/test/fixtures/gdunit4-output.txt'),
    'utf-8',
);
