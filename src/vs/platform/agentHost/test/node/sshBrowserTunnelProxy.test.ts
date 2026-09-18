/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import * as net from 'net';
import { VSBuffer } from '../../../../base/common/buffer.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';
import { NullLogService } from '../../../log/common/log.js';
import { createSshBrowserTunnelProxy, createSshTunnelConnectFn, type ISshForwardOutChannel, type ISshForwardOutClient } from '../../node/sshBrowserTunnelProxy.js';

class FakeSshClient implements ISshForwardOutClient {
	forwardOutCalls: { dstIP: string; dstPort: number }[] = [];
	hang = false;
	failWith: Error | undefined;

	constructor(
		private readonly connectHost: string,
		private readonly connectPort: number,
	) { }

	forwardOut(_srcIP: string, _srcPort: number, dstIP: string, dstPort: number, callback: (err: Error | undefined, channel: ISshForwardOutChannel) => void): this {
		this.forwardOutCalls.push({ dstIP, dstPort });
		if (this.hang) {
			return this;
		}
		if (this.failWith) {
			callback(this.failWith, undefined as unknown as ISshForwardOutChannel);
			return this;
		}
		const socket = net.createConnection({ host: this.connectHost, port: this.connectPort });
		const channel = socket as unknown as ISshForwardOutChannel;
		channel.close = () => socket.destroy();
		socket.once('connect', () => callback(undefined, channel));
		socket.once('error', err => callback(err, undefined as unknown as ISshForwardOutChannel));
		return this;
	}
}

suite('sshBrowserTunnelProxy', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();

	async function listenEchoServer(): Promise<{ port: number; close: () => void }> {
		const server = net.createServer(socket => {
			socket.pipe(socket);
		});
		await new Promise<void>((resolve, reject) => {
			server.once('error', reject);
			server.listen(0, '127.0.0.1', () => resolve());
		});
		const address = server.address();
		assert.ok(address && typeof address === 'object');
		return {
			port: address.port,
			close: () => server.close(),
		};
	}

	test('createSshTunnelConnectFn forwards bytes over SSH forwardOut', async () => {
		const echo = await listenEchoServer();
		store.add({ dispose: echo.close });
		const client = new FakeSshClient('127.0.0.1', echo.port);
		const connect = createSshTunnelConnectFn(client, new NullLogService());
		const protocol = await connect('127.0.0.1', echo.port);
		store.add({ dispose: () => protocol.dispose() });

		const received: Buffer[] = [];
		protocol.getSocket().onData(data => received.push(Buffer.from(data.buffer)));
		protocol.getSocket().write(VSBuffer.fromString('ping'));

		await new Promise<void>((resolve, reject) => {
			const timeout = setTimeout(() => reject(new Error('timed out waiting for echo')), 2000);
			const check = () => {
				if (Buffer.concat(received).toString().includes('ping')) {
					clearTimeout(timeout);
					resolve();
				}
			};
			protocol.getSocket().onData(() => check());
			check();
		});

		assert.deepStrictEqual(client.forwardOutCalls, [{ dstIP: '127.0.0.1', dstPort: echo.port }]);
	});

	test('createSshTunnelConnectFn times out when forwardOut never settles', async () => {
		const client = new FakeSshClient('127.0.0.1', 1);
		client.hang = true;
		const connect = createSshTunnelConnectFn(client, new NullLogService(), 20);
		await assert.rejects(() => connect('127.0.0.1', 3000), /timed out after 20ms/);
	});

	test('createSshTunnelConnectFn rejects when forwardOut fails', async () => {
		const client = new FakeSshClient('127.0.0.1', 1);
		client.failWith = new Error('administratively prohibited');
		const connect = createSshTunnelConnectFn(client, new NullLogService());
		await assert.rejects(() => connect('10.0.0.1', 80), /administratively prohibited/);
	});

	test('createSshBrowserTunnelProxy starts a loopback HTTPS proxy', async () => {
		const echo = await listenEchoServer();
		store.add({ dispose: echo.close });
		const client = new FakeSshClient('127.0.0.1', echo.port);
		const { proxy, info } = await createSshBrowserTunnelProxy(client, new NullLogService());
		store.add(proxy);

		assert.match(info.url, /^https:\/\/127\.0\.0\.1:\d+$/);
		assert.ok(info.credentials.username);
		assert.ok(info.credentials.password);
		assert.match(info.certFingerprint, /^sha256\//);
		assert.strictEqual(info.port, Number(new URL(info.url).port));
	});
});
