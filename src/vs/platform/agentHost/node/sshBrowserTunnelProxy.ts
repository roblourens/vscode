/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { raceTimeout } from '../../../base/common/async.js';
import { VSBuffer } from '../../../base/common/buffer.js';
import { Emitter, Event } from '../../../base/common/event.js';
import { Disposable, IDisposable, toDisposable } from '../../../base/common/lifecycle.js';
import { ISocket, SocketCloseEvent, SocketCloseEventType, SocketDiagnosticsEventType } from '../../../base/parts/ipc/common/ipc.net.js';
import { ILogService } from '../../log/common/log.js';
import { ITunnelConnectFn, TunnelProxy } from '../../tunnel/node/tunnelProxy.js';
import { ITunnelProxyInfo } from '../../tunnel/common/tunnelProxy.js';

/**
 * Maximum time to wait for SSH `forwardOut` when opening a browser tunnel.
 * A silently dead SSH client can leave the callback unfired; bounding this
 * surfaces a clean failure so the browser shows a load error instead of hanging.
 */
export const SSH_BROWSER_FORWARD_TIMEOUT_MS = 15_000;

/**
 * Minimal ssh2 client surface needed to open a `direct-tcpip` channel.
 */
export interface ISshForwardOutClient {
	forwardOut(srcIP: string, srcPort: number, dstIP: string, dstPort: number, callback: (err: Error | undefined, channel: ISshForwardOutChannel) => void): unknown;
}

/**
 * Minimal duplex SSH channel used as the upstream of a browser tunnel.
 */
export interface ISshForwardOutChannel extends NodeJS.ReadWriteStream {
	close(): void;
}

/**
 * Builds a {@link ITunnelConnectFn} that opens an SSH `direct-tcpip` channel
 * to the requested host:port on the remote machine.
 */
export function createSshTunnelConnectFn(
	client: ISshForwardOutClient,
	logService: ILogService,
	timeoutMs: number = SSH_BROWSER_FORWARD_TIMEOUT_MS,
): ITunnelConnectFn {
	return async (host, port) => {
		const channel = await raceTimeout(openForwardOutChannel(client, host, port), timeoutMs);
		if (!channel) {
			throw new Error(`SSH browser tunnel to ${host}:${port} timed out after ${timeoutMs}ms`);
		}
		logService.trace(`[SSHBrowserTunnelProxy] Opened forward to ${host}:${port}`);
		return streamTunnelProtocol(channel);
	};
}

/**
 * Starts a loopback HTTPS {@link TunnelProxy} whose upstream is SSH `forwardOut`.
 */
export async function createSshBrowserTunnelProxy(
	client: ISshForwardOutClient,
	logService: ILogService,
	timeoutMs: number = SSH_BROWSER_FORWARD_TIMEOUT_MS,
): Promise<{ proxy: TunnelProxy; info: ITunnelProxyInfo }> {
	const proxy = new TunnelProxy(createSshTunnelConnectFn(client, logService, timeoutMs), logService);
	const info = await proxy.start();
	return { proxy, info };
}

function openForwardOutChannel(client: ISshForwardOutClient, dstHost: string, dstPort: number): Promise<ISshForwardOutChannel> {
	return new Promise((resolve, reject) => {
		client.forwardOut('127.0.0.1', 0, dstHost, dstPort, (err, channel) => {
			if (err) {
				reject(err);
				return;
			}
			resolve(channel);
		});
	});
}

/**
 * Adapts an SSH channel (or any Node duplex) to the protocol-like shape
 * {@link TunnelProxy} expects from vscode-remote tunnels.
 */
export function streamTunnelProtocol(stream: ISshForwardOutChannel): { getSocket(): ISocket; readEntireBuffer(): VSBuffer; dispose(): void } {
	const socket = new StreamSocket(stream);
	return {
		getSocket: () => socket,
		readEntireBuffer: () => VSBuffer.alloc(0),
		dispose: () => socket.dispose(),
	};
}

class StreamSocket extends Disposable implements ISocket {

	private readonly _onClose = this._register(new Emitter<SocketCloseEvent>());

	constructor(
		private readonly _stream: ISshForwardOutChannel,
	) {
		super();
		this._register(Event.fromNodeEventEmitter(this._stream, 'close')(() => {
			this._onClose.fire({ type: SocketCloseEventType.NodeSocketCloseEvent, hadError: false, error: undefined });
		}));
		this._register(toDisposable(() => {
			try {
				this._stream.end();
				this._stream.close();
			} catch {
				// Channel may already be closed.
			}
		}));
	}

	onData(listener: (e: VSBuffer) => void): IDisposable {
		return Event.fromNodeEventEmitter<Buffer | string>(this._stream, 'data')(data => {
			listener(VSBuffer.wrap(typeof data === 'string' ? Buffer.from(data) : data));
		});
	}

	onClose(listener: (e: SocketCloseEvent) => void): IDisposable {
		return this._onClose.event(listener);
	}

	onEnd(listener: () => void): IDisposable {
		return Event.fromNodeEventEmitter(this._stream, 'end')(listener);
	}

	write(buffer: VSBuffer): void {
		this._stream.write(buffer.buffer);
	}

	end(): void {
		this._stream.end();
	}

	async drain(): Promise<void> {
		if (this._stream.writableNeedDrain) {
			await Event.toPromise(Event.fromNodeEventEmitter(this._stream, 'drain'));
		}
	}

	traceSocketEvent(_type: SocketDiagnosticsEventType, _data?: unknown): void {
		// SSH channels are not on the vscode-remote diagnostic bus.
	}
}
