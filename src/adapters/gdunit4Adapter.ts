import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { toResPath } from '../godot/resPath';
import { parseGdUnit4Output } from './gdunit4Output';
import {
    DiscoveryRules,
    RunRequestInfo,
    TestCaseDescriptor,
    TestFrameworkAdapter,
    TestResult,
} from './types';

const ADDON_DIR = path.join('addons', 'gdUnit4');
const CMD_TOOL = 'res://addons/gdUnit4/bin/GdUnitCmdTool.gd';

/** Reports go to a temp dir so runs don't litter the user's project with `res://reports/report_N`. */
const REPORT_DIR = path.join(os.tmpdir(), 'gdscript-test-runner', 'gdunit4-reports');

/** `extends GdUnitTestSuite`, optionally after `class_name X`, or extending the suite script by path. */
const EXTENDS_TEST_SUITE =
    /^(?:class_name\s+\w+\s+)?extends\s+(?:GdUnitTestSuite\b|["'][^"']*GdUnitTestSuite\.gd["'])/m;

/** A top-level `func test_*(` declaration. */
const TEST_FUNC = /^(?:static\s+)?func\s+(test_\w+)\s*\(/;

function parseTestCases(content: string): TestCaseDescriptor[] {
    if (!EXTENDS_TEST_SUITE.test(content)) {
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
        cases.push({
            name: match[1],
            range: { startLine: index, startCharacter: 0, endLine, endCharacter: lines[endLine].length },
        });
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
        '--path', projectRoot,
        '-s', '-d',
        '--remote-debug', 'tcp://127.0.0.1:0',
        CMD_TOOL,
        '-c',
        '-rd', REPORT_DIR,
    ];
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
