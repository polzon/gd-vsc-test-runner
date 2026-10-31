import { closingBracket, defaultStart, splitTopLevel } from '../../godot/scriptScan';

/** Top-level elements of an array literal, or undefined when the value is not a literal. */
function arrayElements(expression: string): string[] | undefined {
    const text = expression.trim();
    if (!text.startsWith('[')) {
        return undefined;
    }
    const close = closingBracket(text, 0);
    if (close === -1) {
        return undefined;
    }
    const inner = text.slice(1, close);
    if (inner.trim() === '') {
        return [];
    }
    return splitTopLevel(inner, ',')
        .map((element) => element.trim())
        .filter((element) => element !== '');
}

function normalizeCommas(text: string): string {
    let out = '';
    let quote: string | undefined;
    let escaped = false;
    for (let i = 0; i < text.length; i++) {
        const ch = text[i];
        if (quote) {
            out += ch;
            if (escaped) {
                escaped = false;
            } else if (ch === '\\') {
                escaped = true;
            } else if (ch === quote) {
                quote = undefined;
            }
            continue;
        }
        if (ch === '"' || ch === "'") {
            quote = ch;
            out += ch;
            continue;
        }
        if (ch !== ',') {
            out += ch;
            continue;
        }
        out += ch;
        let next = i + 1;
        while (next < text.length && /\s/.test(text[next])) {
            next++;
        }
        if (next < text.length && text[next] !== ']' && text[next] !== ')') {
            out += ' ';
        }
        i = next - 1;
    }
    return out.trim();
}

/**
 * Rebuild the text GdUnit4 prints for a parameter set: outer brackets and quotes
 * normalized, with one space after commas as its parameter parser writes them.
 */
function parameterCaseText(element: string): string {
    let text = element.replace(/\r?\n/g, '').trim();
    if (text.startsWith('[')) {
        const close = closingBracket(text, 0);
        if (close === text.length - 1) {
            text = text.slice(1, -1);
        }
    }
    text = text.replace(/"/g, "'");
    return normalizeCommas(text);
}

/**
 * Parameter sets from the inline `_test_parameters` default value of a declaration.
 * `source` starts at the declaration's first line; `open` is the index of its `(`.
 */
export function inlineParameterSets(source: string, open: number): string[] | undefined {
    const close = closingBracket(source, open);
    if (close === -1) {
        return undefined;
    }
    for (const arg of splitTopLevel(source.slice(open + 1, close), ',')) {
        const name = /^\s*([A-Za-z_]\w*)/.exec(arg)?.[1];
        if (name !== 'test_parameters' && name !== '_test_parameters') {
            continue;
        }
        const start = defaultStart(arg);
        if (start === -1) {
            return undefined;
        }
        return arrayElements(arg.slice(start))?.map(parameterCaseText);
    }
    return undefined;
}
