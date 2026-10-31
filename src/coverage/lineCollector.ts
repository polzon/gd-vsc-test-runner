import { DebuggerMessage } from '../godot/debuggerServer';
import { VariantValue } from '../godot/variant';

/** The part of the debugger connection the collector needs. */
export interface LineCollectorConnection {
    waitForConnection(): Promise<void>;
    send(command: string, data: VariantValue[], threadId?: number): void;
    onMessage(listener: (message: DebuggerMessage) => void): () => void;
    onClose(listener: () => void): () => void;
}

const MAIN_THREAD_ID = 1;

interface StackFrame {
    file: string;
    line: number;
}

/** Frame 0 of a `stack_dump` is the line that broke. */
function topFrame(data: VariantValue[]): StackFrame | undefined {
    if (data.length < 4 || typeof data[1] !== 'string' || typeof data[2] !== 'number') {
        return undefined;
    }
    return { file: data[1], line: data[2] };
}

/**
 * Set a breakpoint on every executable line, then remove each one after its first hit.
 * Resolves when the connection closes, with the hit lines per `res://` file.
 */
export async function collectLineHits(
    connection: LineCollectorConnection,
    targets: ReadonlyMap<string, readonly number[]>,
): Promise<Map<string, Set<number>>> {
    const hits = new Map<string, Set<number>>();
    for (const file of targets.keys()) {
        hits.set(file, new Set());
    }

    let threadId = MAIN_THREAD_ID;
    const removeMessageListener = connection.onMessage((message) => {
        if (message.command === 'debug_enter') {
            const reason = message.data[1];
            const reported = message.data[3];
            threadId = typeof reported === 'number' ? reported : message.threadId;
            if (reason === 'Breakpoint') {
                connection.send('get_stack_dump', [], threadId);
            }
            connection.send('continue', [], threadId);
            return;
        }
        if (message.command !== 'stack_dump') {
            return;
        }
        const frame = topFrame(message.data);
        const fileHits = frame && hits.get(frame.file);
        if (!frame || !fileHits) {
            return;
        }
        fileHits.add(frame.line);
        connection.send('breakpoint', [frame.file, frame.line, false], threadId);
    });

    let removeCloseListener = (): void => {};
    const closed = new Promise<void>((resolve) => {
        removeCloseListener = connection.onClose(() => resolve());
    });

    try {
        await connection.waitForConnection();
    } catch {
        removeMessageListener();
        removeCloseListener();
        return hits;
    }

    for (const [file, lines] of targets) {
        for (const line of lines) {
            connection.send('breakpoint', [file, line, true], MAIN_THREAD_ID);
        }
    }

    await closed;
    removeMessageListener();
    removeCloseListener();
    return hits;
}
