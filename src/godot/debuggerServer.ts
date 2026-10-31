import * as net from 'net';
import { decodeVariant, encodeVariant, VariantValue } from './variant';

/** One Godot debugger message: `[command, threadId, data]`. */
export interface DebuggerMessage {
    command: string;
    threadId: number;
    data: VariantValue[];
}

export type DebuggerMessageListener = (message: DebuggerMessage) => void;

/** Godot rejects packets larger than this (`RemoteDebuggerPeerTCP::get_max_message_size`). */
const MAX_PACKET_SIZE = 8 << 20;

/** A little-endian length prefix followed by one encoded Variant. */
function frame(payload: Buffer): Buffer {
    const out = Buffer.alloc(4 + payload.length);
    out.writeUInt32LE(payload.length, 0);
    payload.copy(out, 4);
    return out;
}

function toMessage(value: VariantValue): DebuggerMessage | undefined {
    if (!Array.isArray(value) || value.length !== 3) {
        return undefined;
    }
    const [command, threadId, data] = value;
    if (typeof command !== 'string' || typeof threadId !== 'number' || !Array.isArray(data)) {
        return undefined;
    }
    return { command, threadId, data };
}

/**
 * Listens for the Godot remote debugger's outgoing connection, splits the TCP stream into
 * Variant packets, and sends commands back. Only one connection is kept.
 */
export class DebuggerServer {
    private server?: net.Server;
    private socket?: net.Socket;
    private buffer: Buffer<ArrayBufferLike> = Buffer.alloc(0);
    private readonly messageListeners = new Set<DebuggerMessageListener>();
    private readonly closeListeners = new Set<() => void>();
    private connectionWaiters: {
        resolve: () => void;
        reject: (error: Error) => void;
    }[] = [];
    private disposed = false;
    private closeEmitted = false;
    private decodeErrorLogged = false;
    private connectedOnce = false;
    private closeTimer?: NodeJS.Timeout;

    constructor(private readonly log: (message: string) => void) {}

    /** True once Godot has connected at least once. */
    get hasConnected(): boolean {
        return this.connectedOnce;
    }

    /** Bind to a free local port. Call before spawning Godot. */
    listen(): Promise<number> {
        return new Promise((resolve, reject) => {
            const server = net.createServer((socket) => this.accept(socket));
            server.once('error', reject);
            server.listen(0, '127.0.0.1', () => {
                server.removeListener('error', reject);
                server.on('error', (error) => this.log(`Debugger server error: ${error.message}`));
                this.server = server;
                const address = server.address();
                if (typeof address === 'object' && address) {
                    resolve(address.port);
                } else {
                    reject(new Error('Debugger server has no port'));
                }
            });
        });
    }

    /** Resolve once Godot is connected; reject if the server closes first. */
    waitForConnection(): Promise<void> {
        if (this.socket && !this.socket.destroyed) {
            return Promise.resolve();
        }
        if (this.disposed) {
            return Promise.reject(new Error('Debugger server closed before Godot connected'));
        }
        return new Promise((resolve, reject) => {
            this.connectionWaiters.push({ resolve, reject });
        });
    }

    onMessage(listener: DebuggerMessageListener): () => void {
        this.messageListeners.add(listener);
        return () => this.messageListeners.delete(listener);
    }

    /** Fires when the connection closes or the server is closed. */
    onClose(listener: () => void): () => void {
        if (this.closeEmitted) {
            listener();
            return () => {};
        }
        this.closeListeners.add(listener);
        return () => this.closeListeners.delete(listener);
    }

    send(command: string, data: VariantValue[], threadId = 1): void {
        if (!this.socket || this.socket.destroyed) {
            return;
        }
        try {
            this.socket.write(frame(encodeVariant([command, threadId, data])));
        } catch (error) {
            this.log(
                `Failed to send '${command}': ${error instanceof Error ? error.message : error}`,
            );
        }
    }

    /** Stop listening and close the connection, draining anything already in flight. */
    close(): void {
        if (this.disposed) {
            return;
        }
        this.disposed = true;
        this.server?.close();
        this.server = undefined;
        const socket = this.socket;
        if (!socket || socket.destroyed) {
            this.rejectConnectionWaiters();
            this.finishClose();
            return;
        }
        socket.end();
        this.closeTimer = setTimeout(() => socket.destroy(), 250);
    }

    private accept(socket: net.Socket): void {
        if (this.socket || this.disposed) {
            socket.destroy();
            return;
        }
        socket.setNoDelay(true);
        this.socket = socket;
        this.connectedOnce = true;
        socket.on('data', (chunk) => this.onData(chunk));
        socket.on('error', (error) => this.log(`Debugger connection error: ${error.message}`));
        socket.on('close', () => this.onSocketClose());
        this.log('Debugger connected');
        this.connectionWaiters.splice(0).forEach((waiter) => waiter.resolve());
    }

    private onData(chunk: Buffer): void {
        this.buffer = this.buffer.length === 0 ? chunk : Buffer.concat([this.buffer, chunk]);
        while (this.buffer.length >= 4) {
            const size = this.buffer.readUInt32LE(0);
            if (size > MAX_PACKET_SIZE) {
                this.log(`Debugger sent an oversized packet (${size} bytes); closing`);
                this.socket?.destroy();
                return;
            }
            if (this.buffer.length < 4 + size) {
                return;
            }
            const payload = this.buffer.subarray(4, 4 + size);
            this.buffer = this.buffer.subarray(4 + size);
            this.dispatch(payload);
        }
    }

    private dispatch(payload: Buffer): void {
        let value: VariantValue;
        try {
            value = decodeVariant(payload);
        } catch (error) {
            if (!this.decodeErrorLogged) {
                this.decodeErrorLogged = true;
                const detail = error instanceof Error ? error.message : String(error);
                this.log(`Dropping undecodable debugger packet: ${detail}`);
            }
            return;
        }
        const message = toMessage(value);
        if (!message) {
            if (!this.decodeErrorLogged) {
                this.decodeErrorLogged = true;
                this.log('Dropping malformed debugger packet (not [command, thread, data])');
            }
            return;
        }
        for (const listener of [...this.messageListeners]) {
            listener(message);
        }
    }

    private onSocketClose(): void {
        if (this.closeTimer) {
            clearTimeout(this.closeTimer);
            this.closeTimer = undefined;
        }
        this.socket = undefined;
        this.buffer = Buffer.alloc(0);
        this.rejectConnectionWaiters();
        this.finishClose();
    }

    private rejectConnectionWaiters(): void {
        this.connectionWaiters
            .splice(0)
            .forEach((waiter) => waiter.reject(new Error('Godot debugger did not connect')));
    }

    private finishClose(): void {
        if (this.closeEmitted) {
            return;
        }
        this.closeEmitted = true;
        for (const listener of [...this.closeListeners]) {
            listener();
        }
        this.closeListeners.clear();
    }
}
