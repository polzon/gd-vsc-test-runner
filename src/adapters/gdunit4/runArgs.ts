import * as os from 'os';
import * as path from 'path';
import { toResPath } from '../../godot/resPath';
import { RunRequestInfo } from '../types';

const CMD_TOOL = 'res://addons/gdUnit4/bin/GdUnitCmdTool.gd';

/**
 * Reports go to a temp dir so runs don't litter the user's project with
 * `res://reports/report_N`.
 */
const REPORT_DIR = path.join(os.tmpdir(), 'gdscript-test-runner', 'gdunit4-reports');

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
export function buildRunArgs(request: RunRequestInfo): string[] {
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
