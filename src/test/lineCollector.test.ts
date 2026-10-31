import * as assert from 'assert';
import { DebuggerMessage } from '../godot/debuggerServer';
import { collectLineHits, LineCollectorConnection } from '../coverage/lineCollector';
import { VariantValue } from '../godot/variant';

interface Sent {
    command: string;
    data: VariantValue[];
    threadId: number | undefined;
}

class FakeConnection implements LineCollectorConnection {
    readonly sent: Sent[] = [];
    private readonly messageListeners = new Set<(message: DebuggerMessage) => void>();
    private readonly closeListeners = new Set<() => void>();

    constructor(private readonly connects = true) {}

    waitForConnection(): Promise<void> {
        return this.connects
            ? Promise.resolve()
            : Promise.reject(new Error('Godot debugger did not connect'));
    }

    send(command: string, data: VariantValue[], threadId?: number): void {
        this.sent.push({ command, data, threadId });
    }

    onMessage(listener: (message: DebuggerMessage) => void): () => void {
        this.messageListeners.add(listener);
        return () => this.messageListeners.delete(listener);
    }

    onClose(listener: () => void): () => void {
        this.closeListeners.add(listener);
        return () => this.closeListeners.delete(listener);
    }

    emit(command: string, data: VariantValue[], threadId = 1): void {
        for (const listener of [...this.messageListeners]) {
            listener({ command, threadId, data });
        }
    }

    close(): void {
        for (const listener of [...this.closeListeners]) {
            listener();
        }
        this.closeListeners.clear();
    }
}

const untilStarted = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

suite('Coverage line collector', () => {
    const targets = new Map([
        ['res://a.gd', [3, 5]],
        ['res://b.gd', [7]],
    ]);

    test('sets breakpoints, records frame 0 and removes each hit breakpoint', async () => {
        const connection = new FakeConnection();
        const collecting = collectLineHits(connection, targets);
        await untilStarted();

        assert.deepStrictEqual(
            connection.sent.map((s) => [s.command, s.threadId, s.data]),
            [
                ['breakpoint', 1, ['res://a.gd', 3, true]],
                ['breakpoint', 1, ['res://a.gd', 5, true]],
                ['breakpoint', 1, ['res://b.gd', 7, true]],
            ],
        );

        connection.emit('debug_enter', [true, 'Breakpoint', true, 1]);
        assert.deepStrictEqual(
            connection.sent.slice(-2).map((s) => s.command),
            ['get_stack_dump', 'continue'],
        );

        connection.emit('stack_dump', [6, 'res://a.gd', 3, 'branch', 'res://b.gd', 7, 'name']);
        assert.deepStrictEqual(connection.sent.at(-1), {
            command: 'breakpoint',
            data: ['res://a.gd', 3, false],
            threadId: 1,
        });

        connection.emit('debug_enter', [true, 'Error', true, 1]);
        assert.strictEqual(connection.sent.at(-1)?.command, 'continue');

        const beforeUnknown = connection.sent.length;
        connection.emit('stack_dump', [3, 'res://unknown.gd', 1, 'f']);
        assert.strictEqual(connection.sent.length, beforeUnknown);

        connection.close();
        const hits = await collecting;
        assert.deepStrictEqual([...(hits.get('res://a.gd') ?? [])], [3]);
        assert.deepStrictEqual([...(hits.get('res://b.gd') ?? [])], []);
    });

    test('records a hit the scanner missed and tolerates repeat hits', async () => {
        const connection = new FakeConnection();
        const collecting = collectLineHits(connection, targets);
        await untilStarted();

        connection.emit('debug_enter', [true, 'Breakpoint', true, 1]);
        connection.emit('stack_dump', [3, 'res://a.gd', 9, 'f']);
        connection.emit('stack_dump', [3, 'res://a.gd', 9, 'f']);

        connection.close();
        const hits = await collecting;
        assert.deepStrictEqual([...(hits.get('res://a.gd') ?? [])], [9]);
    });

    test('returns empty hits when Godot never connects', async () => {
        const connection = new FakeConnection(false);
        const hits = await collectLineHits(connection, targets);
        assert.deepStrictEqual([...(hits.get('res://a.gd') ?? [])], []);
        assert.strictEqual(connection.sent.length, 0);
    });
});
