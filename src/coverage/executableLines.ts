/**
 * Lines where the GDScript compiler can emit a line breakpoint. It writes a newline for each
 * statement's start line in a function body, plus `elif` lines and `match` branch patterns.
 * A breakpoint on any other line never fires.
 */

type BlockKind = 'func' | 'class' | 'match' | 'block';

interface LogicalLine {
    /** 1-based line of the first physical line of the statement. */
    start: number;
    indent: number;
    code: string;
}

interface ScanState {
    depth: number;
    triple?: string;
}

const TAB_WIDTH = 4;

function indentOf(line: string): number {
    let width = 0;
    for (const char of line) {
        if (char === ' ') {
            width += 1;
        } else if (char === '\t') {
            width += TAB_WIDTH;
        } else {
            break;
        }
    }
    return width;
}

/**
 * Walk one physical line, tracking brackets, strings and line continuation, and return the line
 * with string bodies removed so keywords, comments and a trailing colon can be recognized.
 */
function scanLine(raw: string, state: ScanState): { code: string; continues: boolean } {
    let code = '';
    let i = 0;
    while (i < raw.length) {
        if (state.triple) {
            if (raw.startsWith(state.triple, i)) {
                state.triple = undefined;
                code += '""';
                i += 3;
                continue;
            }
            i += 1;
            continue;
        }
        const char = raw[i];
        if (char === '#') {
            break;
        }
        if (char === '"' || char === "'") {
            const triple = char.repeat(3);
            if (raw.startsWith(triple, i)) {
                state.triple = triple;
                i += 3;
                continue;
            }
            i += 1;
            while (i < raw.length) {
                if (raw[i] === '\\') {
                    i += 2;
                } else if (raw[i] === char) {
                    i += 1;
                    break;
                } else {
                    i += 1;
                }
            }
            code += '""';
            continue;
        }
        if (char === '(' || char === '[' || char === '{') {
            state.depth += 1;
        } else if (char === ')' || char === ']' || char === '}') {
            state.depth = Math.max(0, state.depth - 1);
        }
        code += char;
        i += 1;
    }
    return { code, continues: code.trimEnd().endsWith('\\') };
}

function logicalLines(source: string): LogicalLine[] {
    const lines = source.split(/\r?\n/);
    const state: ScanState = { depth: 0 };
    const logical: LogicalLine[] = [];
    let current: LogicalLine | undefined;

    for (let i = 0; i < lines.length; i++) {
        const raw = lines[i];
        current ??= { start: i + 1, indent: indentOf(raw), code: '' };
        const scanned = scanLine(raw, state);
        current.code += `${current.code.length > 0 ? ' ' : ''}${scanned.code}`;
        if (state.triple || state.depth > 0 || scanned.continues) {
            continue;
        }
        logical.push(current);
        current = undefined;
    }
    if (current) {
        logical.push(current);
    }
    return logical;
}

function headerKind(code: string): BlockKind {
    if (/(^|\s)func\b/.test(code)) {
        return 'func';
    }
    if (/^class\b/.test(code)) {
        return 'class';
    }
    if (/^match\b/.test(code)) {
        return 'match';
    }
    return 'block';
}

/**
 * Executable lines of a GDScript source, 1-based, in source order.
 * Counts statement starts inside function bodies (including lambdas and inner-class methods),
 * `elif` lines and `match` patterns. Skips class-level declarations, `else:`, annotations,
 * continued lines and strings.
 */
export function executableLines(source: string): number[] {
    const executable: number[] = [];
    const blocks: { indent: number; kind: BlockKind }[] = [];

    for (const line of logicalLines(source)) {
        const code = line.code.trim();
        if (code.length === 0) {
            continue;
        }
        while (blocks.length > 0 && line.indent <= blocks[blocks.length - 1].indent) {
            blocks.pop();
        }
        const insideFunction = blocks.some((block) => block.kind === 'func');
        const isElse = /^else\s*:/.test(code);
        const isAnnotation = code.startsWith('@');
        if (insideFunction && !isElse && !isAnnotation) {
            executable.push(line.start);
        }
        if (code.endsWith(':')) {
            blocks.push({ indent: line.indent, kind: headerKind(code) });
        }
    }
    return executable;
}
