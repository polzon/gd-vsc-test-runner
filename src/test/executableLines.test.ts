import * as assert from 'assert';
import { executableLines } from '../coverage/executableLines';

function lines(...parts: string[]): string {
    return parts.join('\n');
}

suite('GDScript executable lines', () => {
    test('if/elif/else keeps the branches but not else', () => {
        const source = lines(
            'extends Node',
            '',
            'func branch(x):',
            '    if x > 0:',
            '        print("positive")',
            '    elif x == 0:',
            '        print("zero")',
            '    else:',
            '        print("negative")',
            '    return x',
        );
        assert.deepStrictEqual(executableLines(source), [4, 5, 6, 7, 9, 10]);
    });

    test('counts match patterns and their bodies', () => {
        const source = lines(
            'func name(v):',
            '    match v:',
            '        0:',
            '            return "zero"',
            '        1, 2:',
            '            return "small"',
            '        _:',
            '            return "other"',
        );
        assert.deepStrictEqual(executableLines(source), [2, 3, 4, 5, 6, 7, 8]);
    });

    test('includes lambda bodies and inner-class method bodies', () => {
        const source = lines(
            'class Helper:',
            '    func run():',
            '        var f = func(x):',
            '            return x + 1',
            '        return f',
        );
        assert.deepStrictEqual(executableLines(source), [3, 4, 5]);
    });

    test('skips continued lines and lines inside brackets', () => {
        const source = lines(
            'func multi():',
            '    var value = call(',
            '        "a # b",',
            '        "c: d",',
            '    )',
            '    var text = "value: with # hash"',
            '    var joined = "a" + \\',
            '        "b"',
            '    return value',
        );
        assert.deepStrictEqual(executableLines(source), [2, 6, 7, 9]);
    });

    test('skips lines inside triple-quoted strings', () => {
        const source = lines(
            'func strings():',
            '    var doc = """',
            '    fake()',
            '    # not a comment',
            '    """',
            '    return doc',
        );
        assert.deepStrictEqual(executableLines(source), [2, 6]);
    });

    test('skips annotations and class-level declarations', () => {
        const source = lines(
            '@tool',
            'extends Node',
            '',
            'var member = 1',
            '',
            'func annotated():',
            '    @warning_ignore("unused")',
            '    var x = 1',
            '    return x',
        );
        assert.deepStrictEqual(executableLines(source), [8, 9]);
    });

    test('marks a multi-line function signature at its body, not its header', () => {
        const source = lines(
            'func long_signature(',
            '    a,',
            '    b,',
            ') -> void:',
            '    return',
        );
        assert.deepStrictEqual(executableLines(source), [5]);
    });
});
