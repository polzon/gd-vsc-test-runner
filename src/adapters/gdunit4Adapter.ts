import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { baseTarget, classResolver } from '../godot/classResolver';
import { toResPath } from '../godot/resPath';
import { parseGdUnit4Output } from './gdunit4Output';
import {
    DiscoveryContext,
    DiscoveryRules,
    RunRequestInfo,
    TestCaseDescriptor,
    TestFrameworkAdapter,
    TestResult,
} from './types';

const ADDON_DIR = path.join('addons', 'gdUnit4');
const CMD_TOOL = 'res://addons/gdUnit4/bin/GdUnitCmdTool.gd';

/**
 * Reports go to a temp dir so runs don't litter the user's project with
 * `res://reports/report_N`.
 */
const REPORT_DIR = path.join(os.tmpdir(), 'gdscript-test-runner', 'gdunit4-reports');

const SUITE_CLASS = 'GdUnitTestSuite';

/** A top-level `func test_*(` declaration. */
const TEST_FUNC = /^(?:static\s+)?func\s+(test_\w+)\s*\(/;

function isSuiteTarget(target: string): boolean {
    return target === SUITE_CLASS || target.endsWith(`/${SUITE_CLASS}.gd`);
}

async function extendsTestSuite(content: string, context?: DiscoveryContext): Promise<boolean> {
    const target = baseTarget(content);
    if (!target) {
        return false;
    }
    if (isSuiteTarget(target)) {
        return true;
    }
    if (!context) {
        return false;
    }
    const lineage = await classResolver(context.projectRoot).lineage(content, context.file);
    return lineage.some(isSuiteTarget);
}

/** Index of the bracket that closes the one at `openIndex`, respecting strings and comments. */
function closingBracket(text: string, openIndex: number): number {
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
function splitTopLevel(text: string, separator: string): string[] {
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
function defaultStart(arg: string): number {
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

/** Parameter sets from an inline `_test_parameters` default value. */
function inlineParameterSets(lines: string[], startLine: number): string[] | undefined {
    const rest = lines.slice(startLine).join('\n');
    const declaration = TEST_FUNC.exec(lines[startLine]);
    if (!declaration) {
        return undefined;
    }
    const open = declaration[0].length - 1;
    const close = closingBracket(rest, open);
    if (close === -1) {
        return undefined;
    }
    for (const arg of splitTopLevel(rest.slice(open + 1, close), ',')) {
        const name = /^\s*([A-Za-z_]\w*)/.exec(arg)?.[1];
        if (name !== 'test_parameters' && name !== '_test_parameters') {
            continue;
        }
        const start = defaultStart(arg);
        if (start === -1) {
            return undefined;
        }
        const elements = arrayElements(arg.slice(start));
        return elements?.map(parameterCaseText);
    }
    return undefined;
}

async function parseTestCases(
    content: string,
    context?: DiscoveryContext,
): Promise<TestCaseDescriptor[]> {
    if (!(await extendsTestSuite(content, context))) {
        return [];
    }
    const lines = content.split(/\r?\n/);
    const cases: TestCaseDescriptor[] = [];
    lines.forEach((line, index) => {
        const match = TEST_FUNC.exec(line);
        if (!match) {
            return;
        }
        const endLine = lastBodyLine(lines, index);
        const range = {
            startLine: index,
            startCharacter: 0,
            endLine,
            endCharacter: lines[endLine].length,
        };
        const parameters = inlineParameterSets(lines, index);
        if (parameters && parameters.length > 0) {
            parameters.forEach((parameter, parameterIndex) => {
                cases.push({
                    name: `${match[1]}:${parameterIndex} (${parameter})`,
                    label: parameter,
                    parentName: match[1],
                    runName: match[1],
                    range,
                });
            });
            return;
        }
        cases.push({ name: match[1], range });
    });
    return cases;
}

/** The last non-blank line of the indented block that follows the declaration at `start`. */
function lastBodyLine(lines: string[], start: number): number {
    let last = start;
    for (let i = start + 1; i < lines.length; i++) {
        const line = lines[i];
        if (line.trim() === '') {
            continue;
        }
        if (!/^\s/.test(line)) {
            break;
        }
        last = i;
    }
    return last;
}

const discovery: DiscoveryRules = {
    fileFilter: '**/test_*.gd',
    parseTestCases,
    invalidate(projectRoot: string): void {
        classResolver(projectRoot).invalidate();
    },
};

async function pathExists(target: string): Promise<boolean> {
    try {
        await fs.access(target);
        return true;
    } catch {
        return false;
    }
}

async function detect(projectRoot: string): Promise<boolean> {
    return pathExists(path.join(projectRoot, ADDON_DIR, 'bin', 'GdUnitCmdTool.gd'));
}

async function detectVersion(projectRoot: string): Promise<string | undefined> {
    try {
        const config = await fs.readFile(path.join(projectRoot, ADDON_DIR, 'plugin.cfg'), 'utf-8');
        return /^version\s*=\s*"([^"]+)"/m.exec(config)?.[1];
    } catch {
        return undefined;
    }
}

function requireResPath(projectRoot: string, file: string): string {
    const resPath = toResPath(projectRoot, file);
    if (!resPath) {
        throw new Error(`Test file is outside the Godot project '${projectRoot}': ${file}`);
    }
    return resPath;
}

/**
 * Mirrors the invocation in GdUnit4's `runtest.cmd/.sh`: non-headless (GdUnit4 rejects headless by
 * default) with `--remote-debug` pointed at an unbound port to suppress the interactive debugger.
 */
function buildRunArgs(request: RunRequestInfo): string[] {
    const { projectRoot } = request;
    const args = [
        '--path',
        projectRoot,
        '-s',
        '-d',
        '--remote-debug',
        request.debuggerUri ?? 'tcp://127.0.0.1:0',
    ];
    if (request.debuggerUri) {
        // Runtime script errors must not pause a coverage run.
        args.push('--ignore-error-breaks');
    }
    args.push(CMD_TOOL, '-c', '-rd', REPORT_DIR);
    if (request.includeFiles.length === 0) {
        // Everything except the addons themselves (gdUnit4 ships its own test suites).
        args.push('-a', 'res://', '-i', 'res://addons');
    }
    for (const file of request.includeFiles) {
        args.push('-a', requireResPath(projectRoot, file));
    }
    for (const test of request.excludeTests) {
        args.push('-i', `${requireResPath(projectRoot, test.file)}:${test.name}`);
    }
    return args;
}

function parseResults(rawOutput: string, projectRoot: string): TestResult[] {
    return parseGdUnit4Output(rawOutput, projectRoot);
}

export const gdunit4Adapter: TestFrameworkAdapter = {
    id: 'gdunit4',
    displayName: 'GDUnit 4 Adapter',
    discovery,
    detect,
    detectVersion,
    buildRunArgs,
    parseResults,
};
