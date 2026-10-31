/** Index of the bracket that closes the one at `openIndex`, respecting strings and comments. */
export function closingBracket(text: string, openIndex: number): number {
    const open = text[openIndex];
    const close = open === '(' ? ')' : open === '[' ? ']' : '}';
    let depth = 0;
    let quote: string | undefined;
    let escaped = false;
    for (let i = openIndex; i < text.length; i++) {
        const ch = text[i];
        if (quote) {
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
            continue;
        }
        if (ch === '#') {
            const newline = text.indexOf('\n', i);
            if (newline === -1) {
                return -1;
            }
            i = newline;
            continue;
        }
        if (ch === open) {
            depth++;
        } else if (ch === close && --depth === 0) {
            return i;
        }
    }
    return -1;
}

/** Split on `separator` where it is not inside brackets, braces or a string. */
export function splitTopLevel(text: string, separator: string): string[] {
    const parts: string[] = [];
    let depth = 0;
    let quote: string | undefined;
    let escaped = false;
    let start = 0;
    for (let i = 0; i < text.length; i++) {
        const ch = text[i];
        if (quote) {
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
            continue;
        }
        if (ch === '#') {
            const newline = text.indexOf('\n', i);
            if (newline === -1) {
                break;
            }
            i = newline;
            continue;
        }
        if (ch === '(' || ch === '[' || ch === '{') {
            depth++;
        } else if (ch === ')' || ch === ']' || ch === '}') {
            depth--;
        } else if (ch === separator && depth === 0) {
            parts.push(text.slice(start, i));
            start = i + 1;
        }
    }
    parts.push(text.slice(start));
    return parts;
}

/** Index just past the `:=` or `=` that introduces a parameter's default value. */
export function defaultStart(arg: string): number {
    let depth = 0;
    let quote: string | undefined;
    let escaped = false;
    for (let i = 0; i < arg.length; i++) {
        const ch = arg[i];
        if (quote) {
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
            continue;
        }
        if (ch === '(' || ch === '[' || ch === '{') {
            depth++;
        } else if (ch === ')' || ch === ']' || ch === '}') {
            depth--;
        } else if (depth === 0 && ch === ':' && arg[i + 1] === '=') {
            return i + 2;
        } else if (depth === 0 && ch === '=') {
            return i + 1;
        }
    }
    return -1;
}
