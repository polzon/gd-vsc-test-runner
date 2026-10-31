import * as assert from 'assert';
import * as net from 'net';
import { DebuggerMessage, DebuggerServer } from '../godot/debuggerServer';
import { decodeVariant, encodeVariant, VariantValue } from '../godot/variant';

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

function frame(value: VariantValue): Buffer {
    const payload = encodeVariant(value);
    const out = Buffer.alloc(4 + payload.length);
    out.writeUInt32LE(payload.length, 0);
    payload.copy(out, 4);
    return out;
}

/** Collects the frames a fake Godot client receives from the server. */
function readFrames(client: net.Socket): VariantValue[] {
    const received: VariantValue[] = [];
    let buffer = Buffer.alloc(0);
    client.on('data', (chunk) => {
        buffer = Buffer.concat([buffer, chunk]);
        while (buffer.length >= 4) {
            const size = buffer.readUInt32LE(0);
            if (buffer.length < 4 + size) {
                return;
            }
            received.push(decodeVariant(buffer.subarray(4, 4 + size)));
            buffer = buffer.subarray(4 + size);
        }
    });
    return received;
}

async function open(): Promise<{
    server: DebuggerServer;
    client: net.Socket;
    port: number;
    logs: string[];
}> {
    const logs: string[] = [];
    const server = new DebuggerServer((message) => logs.push(message));
    const port = await server.listen();
    const client = net.connect(port, '127.0.0.1');
    await new Promise<void>((resolve, reject) => {
        client.once('connect', resolve);
        client.once('error', reject);
    });
    await server.waitForConnection();
    return { server, client, port, logs };
}

suite('Godot debugger server', () => {
    const servers: DebuggerServer[] = [];
    const clients: net.Socket[] = [];

    teardown(() => {
        clients.splice(0).forEach((client) => client.destroy());
        servers.splice(0).forEach((server) => server.close());
    });

    test('reassembles split packets and splits merged ones', async () => {
        const { server, client } = await open();
        servers.push(server);
        clients.push(client);
        const messages: DebuggerMessage[] = [];
        server.onMessage((message) => messages.push(message));

        const first = frame(['stack_dump', 1, [true, 'Breakpoint', true, 1]]);
        client.write(first.subarray(0, 2));
        await delay(20);
        assert.strictEqual(messages.length, 0);
        client.write(first.subarray(2));
        client.write(Buffer.concat([frame(['continue', 1, []]), frame(['continue', 1, []])]));
        await delay(50);

        assert.deepStrictEqual(
            messages.map((m) => m.command),
            ['stack_dump', 'continue', 'continue'],
        );
        assert.deepStrictEqual(messages[0].data, [true, 'Breakpoint', true, 1]);
        assert.strictEqual(messages[0].threadId, 1);
    });

    test('drops an undecodable packet once and keeps reading', async () => {
        const { server, client, logs } = await open();
        servers.push(server);
        clients.push(client);
        const messages: DebuggerMessage[] = [];
        server.onMessage((message) => messages.push(message));

        const badPayload = Buffer.from('180000000000000000000000', 'hex');
        const bad = Buffer.alloc(4 + badPayload.length);
        bad.writeUInt32LE(badPayload.length, 0);
        badPayload.copy(bad, 4);
        client.write(bad);
        client.write(frame(['continue', 1, []]));
        await delay(50);

        assert.deepStrictEqual(
            messages.map((m) => m.command),
            ['continue'],
        );
        assert.strictEqual(logs.filter((l) => l.includes('Dropping undecodable')).length, 1);
    });

    test('sends commands to the connected client', async () => {
        const { server, client } = await open();
        servers.push(server);
        clients.push(client);
        const received = readFrames(client);

        server.send('breakpoint', ['res://test.gd', 5, true]);
        await delay(50);

        assert.deepStrictEqual(received, [['breakpoint', 1, ['res://test.gd', 5, true]]]);
    });

    test('emits close when the connection ends', async () => {
        const { server, client } = await open();
        servers.push(server);
        clients.push(client);
        let closed = false;
        server.onClose(() => {
            closed = true;
        });

        client.end();
        await delay(100);
        assert.strictEqual(closed, true);
    });

    test('closing before a connection rejects waiters', async () => {
        const server = new DebuggerServer(() => {});
        servers.push(server);
        await server.listen();
        const waiting = server.waitForConnection();
        server.close();
        await assert.rejects(waiting, /did not connect/);
    });
});
