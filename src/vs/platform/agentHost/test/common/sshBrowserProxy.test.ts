/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { URI } from '../../../../base/common/uri.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';
import { remoteAgentHostSessionTypeId } from '../../common/agentHostSessionType.js';
import { agentHostAuthority } from '../../common/agentHostUri.js';
import { RemoteAgentHostConnectionStatus, RemoteAgentHostEntryType, type IRemoteAgentHostConnectionInfo, type IRemoteAgentHostEntry } from '../../common/remoteAgentHostService.js';
import { getSshBrowserProxyAddress } from '../../common/sshBrowserProxy.js';

suite('getSshBrowserProxyAddress', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	const sshAddress = 'ssh:box1';
	const sshAuthority = agentHostAuthority(sshAddress);
	const sshConnection: IRemoteAgentHostConnectionInfo = {
		address: sshAddress,
		name: 'box1',
		status: RemoteAgentHostConnectionStatus.connected,
	};
	const sshEntry: IRemoteAgentHostEntry = {
		name: 'box1',
		connection: {
			type: RemoteAgentHostEntryType.SSH,
			address: sshAddress,
			hostName: 'box1.example.com',
		},
	};

	test('resolves an SSH-backed remote session to the connection address', () => {
		const session = URI.parse(`${remoteAgentHostSessionTypeId(sshAuthority, 'copilot')}:/session-1`);
		assert.strictEqual(
			getSshBrowserProxyAddress(session, [sshConnection], address => address === sshAddress ? sshEntry : undefined),
			sshAddress,
		);
	});

	test('ignores local sessions and missing resources', () => {
		assert.deepStrictEqual({
			local: getSshBrowserProxyAddress(URI.parse('agent-host-copilot:/session-1'), [sshConnection], () => sshEntry),
			missing: getSshBrowserProxyAddress(undefined, [sshConnection], () => sshEntry),
		}, {
			local: undefined,
			missing: undefined,
		});
	});

	test('ignores non-SSH remote hosts', () => {
		const tunnelAddress = 'tunnel:abc';
		const tunnelAuthority = agentHostAuthority(tunnelAddress);
		const session = URI.parse(`${remoteAgentHostSessionTypeId(tunnelAuthority, 'copilot')}:/session-1`);
		const connection: IRemoteAgentHostConnectionInfo = {
			address: tunnelAddress,
			name: 'My Tunnel',
			status: RemoteAgentHostConnectionStatus.connected,
		};
		const entry: IRemoteAgentHostEntry = {
			name: 'My Tunnel',
			connection: {
				type: RemoteAgentHostEntryType.Tunnel,
				tunnelId: 'abc',
				clusterId: 'use',
			},
		};

		assert.strictEqual(
			getSshBrowserProxyAddress(session, [connection], address => address === tunnelAddress ? entry : undefined),
			undefined,
		);
	});
});
