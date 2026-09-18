/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { URI } from '../../../../../base/common/uri.js';
import { upcastPartial } from '../../../../../base/test/common/mock.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { remoteAgentHostSessionTypeId } from '../../../../../platform/agentHost/common/agentHostSessionType.js';
import { agentHostAuthority } from '../../../../../platform/agentHost/common/agentHostUri.js';
import { IRemoteAgentHostService, RemoteAgentHostConnectionStatus, RemoteAgentHostEntryType, type IRemoteAgentHostConnectionInfo, type IRemoteAgentHostEntry } from '../../../../../platform/agentHost/common/remoteAgentHostService.js';
import { ISSHRemoteAgentHostService } from '../../../../../platform/agentHost/common/sshRemoteAgentHost.js';
import { TestConfigurationService } from '../../../../../platform/configuration/test/common/testConfigurationService.js';
import { NullLogService } from '../../../../../platform/log/common/log.js';
import { ITunnelProxyInfo } from '../../../../../platform/tunnel/common/tunnelProxy.js';
import { IWorkbenchEnvironmentService } from '../../../../services/environment/common/environmentService.js';
import { IBrowserViewWorkbenchService } from '../../common/browserView.js';
import { AgentHostBrowserProxyService } from '../../electron-browser/agentHostBrowserProxyService.js';
import { BrowserRemoteProxyEnabledSettingId } from '../../electron-browser/browserViewWorkbenchService.js';

suite('AgentHostBrowserProxyService', () => {
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
	const proxyInfo: ITunnelProxyInfo = {
		url: 'https://127.0.0.1:9443',
		host: '127.0.0.1',
		port: 9443,
		credentials: { username: 'u', password: 'p' },
		certFingerprint: 'sha256/abc',
	};

	function createService(options?: {
		remoteAuthority?: string;
		proxyEnabled?: boolean;
		startBrowserProxy?: (address: string) => Promise<ITunnelProxyInfo>;
		setSessionRemoteProxyInfo?: (sessionId: string, info: ITunnelProxyInfo | undefined) => Promise<void>;
	}): AgentHostBrowserProxyService {
		const configService = new TestConfigurationService();
		configService.setUserConfiguration(BrowserRemoteProxyEnabledSettingId, options?.proxyEnabled ?? true);
		return new AgentHostBrowserProxyService(
			upcastPartial<IWorkbenchEnvironmentService>({ remoteAuthority: options?.remoteAuthority }),
			configService,
			upcastPartial<IRemoteAgentHostService>({
				connections: [sshConnection],
				getEntryByAddress: (address: string) => address === sshAddress ? sshEntry : undefined,
			}),
			upcastPartial<ISSHRemoteAgentHostService>({
				startBrowserProxy: options?.startBrowserProxy ?? (async () => proxyInfo),
			}),
			upcastPartial<IBrowserViewWorkbenchService>({
				willUseRemoteProxy: () => !!options?.remoteAuthority,
				setSessionRemoteProxyInfo: options?.setSessionRemoteProxyInfo ?? (async () => { }),
			}),
			new NullLogService(),
		);
	}

	test('starts an SSH proxy for a remote Agents-window session', async () => {
		const started: string[] = [];
		const applied: { sessionId: string; url: string }[] = [];
		const service = createService({
			startBrowserProxy: async address => {
				started.push(address);
				return proxyInfo;
			},
			setSessionRemoteProxyInfo: async (sessionId, info) => {
				applied.push({ sessionId, url: info?.url ?? '' });
			},
		});
		const session = URI.parse(`${remoteAgentHostSessionTypeId(sshAuthority, 'copilot')}:/session-1`);

		assert.strictEqual(await service.ensureProxyForSession(session), true);
		assert.deepStrictEqual({ started, applied }, {
			started: [sshAddress],
			applied: [{ sessionId: session.toString(), url: proxyInfo.url }],
		});
	});

	test('skips local sessions and vscode-remote windows', async () => {
		let startCount = 0;
		const service = createService({
			startBrowserProxy: async () => {
				startCount++;
				return proxyInfo;
			},
		});
		const vscodeRemote = createService({
			remoteAuthority: 'ssh-remote+box1',
			startBrowserProxy: async () => {
				startCount++;
				return proxyInfo;
			},
		});

		assert.deepStrictEqual({
			local: await service.ensureProxyForSession(URI.parse('agent-host-copilot:/session-1')),
			missing: await service.ensureProxyForSession(undefined),
			vscodeRemote: await vscodeRemote.ensureProxyForSession(URI.parse(`${remoteAgentHostSessionTypeId(sshAuthority, 'copilot')}:/session-1`)),
			startCount,
		}, {
			local: false,
			missing: false,
			vscodeRemote: true,
			startCount: 0,
		});
	});

	test('skips when the remote proxy setting is disabled', async () => {
		let startCount = 0;
		const service = createService({
			proxyEnabled: false,
			startBrowserProxy: async () => {
				startCount++;
				return proxyInfo;
			},
		});
		const session = URI.parse(`${remoteAgentHostSessionTypeId(sshAuthority, 'copilot')}:/session-1`);

		assert.deepStrictEqual({
			proxied: await service.ensureProxyForSession(session),
			startCount,
		}, {
			proxied: false,
			startCount: 0,
		});
	});
});
