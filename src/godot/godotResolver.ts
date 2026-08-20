import { spawnSync } from 'child_process';
import { existsSync } from 'fs';
import * as path from 'path';

export interface ResolvedGodot {
    path: string;
    version: string;
    source: 'setting' | 'path';
}

export type GodotResolutionError =
    | { code: 'not-found'; message: string }
    | { code: 'version-failed'; message: string };

export type GodotResolutionResult =
    | { ok: true; godot: ResolvedGodot }
    | { ok: false; error: GodotResolutionError };

export type GodotProbeResult =
    | { ok: true; version: string }
    | { ok: false; message: string };

/**
 * Runs `<executable> --version` and captures the version string.
 * Injectable so tests can avoid spawning a real Godot process.
 */
export type GodotProbe = (executable: string) => GodotProbeResult;

function defaultProbe(executable: string): GodotProbeResult {
    const result = spawnSync(executable, ['--version'], { encoding: 'utf-8' });
    if (result.error) {
        return { ok: false, message: `Failed to execute '${executable}': ${result.error.message}` };
    }
    if (result.status !== 0) {
        return { ok: false, message: `'${executable} --version' exited with code ${result.status}.` };
    }
    const version = (result.stdout ?? '').trim();
    if (version === '') {
        return { ok: false, message: `'${executable} --version' produced no output.` };
    }
    return { ok: true, version };
}

function executableName(): string {
    return process.platform === 'win32' ? 'godot.exe' : 'godot';
}

function isExecutableFile(candidate: string): boolean {
    return existsSync(candidate);
}

/**
 * Resolve the Godot executable.
 *
 * Precedence:
 *   1. An explicit configured path (non-empty), which must already exist.
 *   2. Otherwise, the first `godot` on `PATH` that reports a version.
 *
 * A configured path that does not exist is reported as an error (we do not
 * silently fall back to PATH, to avoid masking user misconfiguration).
 */
export function resolveGodot(
    configuredPath: string | undefined,
    probe: GodotProbe = defaultProbe,
): GodotResolutionResult {
    const explicit = configuredPath?.trim();
    if (explicit) {
        if (!isExecutableFile(explicit)) {
            return {
                ok: false,
                error: { code: 'not-found', message: `Configured Godot executable not found: ${explicit}` },
            };
        }
        const result = probe(explicit);
        if (!result.ok) {
            return { ok: false, error: { code: 'version-failed', message: result.message } };
        }
        return { ok: true, godot: { path: explicit, version: result.version, source: 'setting' } };
    }

    const name = executableName();
    const dirs = (process.env.PATH ?? '').split(path.delimiter).filter((d) => d.length > 0);
    for (const dir of dirs) {
        const candidate = path.join(dir, name);
        if (!isExecutableFile(candidate)) {
            continue;
        }
        const result = probe(candidate);
        if (result.ok) {
            return { ok: true, godot: { path: candidate, version: result.version, source: 'path' } };
        }
    }
    return { ok: false, error: { code: 'not-found', message: `Godot executable ('${name}') not found on PATH.` } };
}
