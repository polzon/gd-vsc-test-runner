import { fromResPath } from '../godot/resPath';
import { SourceLocation, TestResult, TestStatus } from './types';

// Strips CSI escape sequences (colors, cursor movement) emitted by GdUnit4's console writer.
const ANSI_ESCAPE = /\u001b\[[0-9;?]*[A-Za-z]/g;

/** `  res://test/test_x.gd > test_name PASSED 12ms` (detailed console reporter format). */
const TEST_LINE = /^\s*(res:\/\/\S+?\.gd) > (.+?) (STARTED|PASSED|FAILED|SKIPPED|WARNING|FLAKY)\b[^\d]*(.*)$/;

/** Lines that close the report block following a test result. */
const BLOCK_TERMINATORS = [/^Statistics:/, /^Run Test Suite:/, /^Overall Summary:/, /^\S+ > finalize\(\)/];

/** `at 'test_name' in res://test/test_x.gd:10` stack-trace entries. */
const STACK_FRAME = /\s*at '[^']*' in (res:\/\/[^\s:]+):(\d+)/g;

const STATUS_MAP: Record<string, TestStatus | undefined> = {
    PASSED: 'passed',
    FLAKY: 'passed',
    WARNING: 'passed',
    FAILED: 'failed',
    SKIPPED: 'skipped',
};

interface PendingResult {
    result: TestResult;
    reportLines: string[];
}

/** Parse the stdout of `GdUnitCmdTool.gd` into per-test results. */
export function parseGdUnit4Output(rawOutput: string, projectRoot: string): TestResult[] {
    const results = new Map<string, TestResult>();
    let pending: PendingResult | undefined;

    const flush = (): void => {
        if (pending) {
            finalizeReport(pending, projectRoot);
            const { result } = pending;
            results.set(`${result.file}::${result.name}`, result);
            pending = undefined;
        }
    };

    for (const line of rawOutput.replace(ANSI_ESCAPE, '').split(/\r?\n/)) {
        const match = TEST_LINE.exec(line);
        if (match) {
            flush();
            const [, resPath, name, statusWord, rest] = match;
            const status = STATUS_MAP[statusWord];
            if (status) {
                const result: TestResult = { name, file: fromResPath(projectRoot, resPath), status };
                const duration = parseDuration(rest);
                if (duration !== undefined) {
                    result.duration = duration;
                }
                pending = { result, reportLines: [] };
            }
            continue;
        }
        if (BLOCK_TERMINATORS.some((re) => re.test(line.trim()))) {
            flush();
            continue;
        }
        pending?.reportLines.push(line);
    }
    flush();
    return [...results.values()];
}

function finalizeReport(pending: PendingResult, projectRoot: string): void {
    const { result } = pending;
    if (result.status === 'passed' && !pending.reportLines.some((l) => l.trim() !== '')) {
        return;
    }
    let text = pending.reportLines
        .filter((l) => l.trim() !== 'Report:')
        .join('\n');

    const location = firstStackFrame(text, projectRoot);
    if (location) {
        result.location = location;
    }
    text = text.replace(STACK_FRAME, '');

    const message = text
        .split('\n')
        .map((l) => l.trim())
        .filter((l) => l !== '')
        .join('\n');
    if (message !== '') {
        result.message = message;
    }
}

function firstStackFrame(text: string, projectRoot: string): SourceLocation | undefined {
    STACK_FRAME.lastIndex = 0;
    const frame = STACK_FRAME.exec(text);
    STACK_FRAME.lastIndex = 0;
    if (!frame) {
        return undefined;
    }
    const file = fromResPath(projectRoot, frame[1]);
    return file ? { file, line: Math.max(0, Number(frame[2]) - 1) } : undefined;
}

const DURATION_UNITS: Record<string, number> = { h: 3_600_000, min: 60_000, s: 1_000, ms: 1 };

/** Parse GdUnit4 elapsed-time strings such as `29ms`, `1s 234ms` or `2min 3s 4ms`. */
export function parseDuration(text: string): number | undefined {
    let total = 0;
    let matched = false;
    for (const [, amount, unit] of text.matchAll(/(\d+)(h|min|ms|s)\b/g)) {
        total += Number(amount) * DURATION_UNITS[unit];
        matched = true;
    }
    return matched ? total : undefined;
}
