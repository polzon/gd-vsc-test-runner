import { spawn } from 'child_process';

export interface GodotProcessResult {
    /** Exit code, or undefined when the process was killed or failed to start. */
    exitCode: number | undefined;
    stdout: string;
    /** Set when the process could not be started. */
    spawnError?: Error;
}

export interface GodotProcessOptions {
    cwd: string;
    /** Receives stdout and stderr chunks as they arrive. */
    onOutput?: (chunk: string) => void;
    /** Kills the process when aborted. */
    signal?: AbortSignal;
}

/** Run the Godot executable to completion, collecting stdout. */
export function runGodot(executable: string, args: string[], options: GodotProcessOptions): Promise<GodotProcessResult> {
    return new Promise((resolve) => {
        let stdout = '';
        const child = spawn(executable, args, { cwd: options.cwd, windowsHide: true });

        const onAbort = (): void => {
            child.kill();
        };
        options.signal?.addEventListener('abort', onAbort, { once: true });

        child.stdout.setEncoding('utf-8');
        child.stderr.setEncoding('utf-8');
        child.stdout.on('data', (chunk: string) => {
            stdout += chunk;
            options.onOutput?.(chunk);
        });
        child.stderr.on('data', (chunk: string) => options.onOutput?.(chunk));

        child.on('error', (spawnError) => {
            options.signal?.removeEventListener('abort', onAbort);
            resolve({ exitCode: undefined, stdout, spawnError });
        });
        child.on('close', (code) => {
            options.signal?.removeEventListener('abort', onAbort);
            resolve({ exitCode: code ?? undefined, stdout });
        });
    });
}
