import * as assert from 'assert';
import { decodeVariant, encodeVariant, VariantValue } from '../godot/variant';

/** A real `debug_enter` payload captured from Godot 4.7.2 during the coverage spike. */
const DEBUG_ENTER_HEX =
    '1c00000003000000040000000b00000064656275675f656e74657200' +
    '0200000001000000' +
    '1c00000004000000' +
    '0100000001000000' +
    '040000000a000000427265616b706f696e740000' +
    '0100000001000000' +
    '0200000001000000';

function hex(value: string): Buffer {
    return Buffer.from(value.replace(/\s+/g, ''), 'hex');
}

suite('Godot Variant encoding', () => {
    test('round-trips primitive values', () => {
        const values: VariantValue[] = [
            null,
            true,
            false,
            0,
            42,
            -42,
            0x7fffffff,
            -0x80000000,
            0x7fffffff + 1,
            -0x80000000 - 1,
            1.5,
            0.1,
            -2.25,
            '',
            'test_success',
            'res://test/test_example_test.gd',
            'naïve ✓',
        ];
        for (const value of values) {
            assert.deepStrictEqual(decodeVariant(encodeVariant(value)), value);
        }
    });

    test('round-trips nested arrays and dictionaries', () => {
        const value: VariantValue = [
            'breakpoint',
            1,
            ['res://script.gd', 12, true],
            new Map<VariantValue, VariantValue>([
                ['line', 12],
                [3, ['a', 'b']],
            ]),
        ];
        assert.deepStrictEqual(decodeVariant(encodeVariant(value)), value);
    });

    test('decodes a real debug_enter packet and re-encodes it byte for byte', () => {
        const payload = hex(DEBUG_ENTER_HEX);
        const decoded = decodeVariant(payload);
        assert.deepStrictEqual(decoded, ['debug_enter', 1, [true, 'Breakpoint', true, 1]]);
        assert.deepStrictEqual(encodeVariant(decoded), payload);
    });

    test('pads strings and packed byte arrays to four bytes', () => {
        assert.deepStrictEqual(encodeVariant('abc'), hex('040000000300000061626300'));
        const packed = hex('1d00000003000000010203' + '00');
        assert.deepStrictEqual(decodeVariant(packed), [1, 2, 3]);
    });

    test('decodes packed arrays the debugger can send', () => {
        assert.deepStrictEqual(decodeVariant(hex('1e00000002000000ffffffff05000000')), [-1, 5]);
        assert.deepStrictEqual(decodeVariant(hex('2100000001000000000000000000f83f')), [1.5]);
        assert.deepStrictEqual(
            decodeVariant(hex('22000000 02000000 01000000 61000000 02000000 62630000')),
            ['a', 'bc'],
        );
    });

    test('skips a typed array element type before the elements', () => {
        const typed = hex(
            '1c000100' + '02000000' + '02000000' + '02000000 05000000' + '02000000 07000000',
        );
        assert.deepStrictEqual(decodeVariant(typed), [5, 7]);
    });

    test('rejects truncated, trailing and unsupported data', () => {
        assert.throws(() => decodeVariant(hex('020000000500')), /Truncated/);
        assert.throws(() => decodeVariant(hex('0200000005000000ff')), /trailing/);
        assert.throws(() => decodeVariant(hex('1800000000000000')), /Unsupported Variant type/);
    });
});
