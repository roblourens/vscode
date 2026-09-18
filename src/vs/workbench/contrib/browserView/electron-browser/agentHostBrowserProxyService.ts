/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { URI } from '../../../../base/common/uri.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { IRemoteAgentHostService } from '../../../../platform/agentHost/common/remoteAgentHostService.js';
import { getSshBrowserProxyAddress } from '../../../../platform/agentHost/common/sshBrowserProxy.js';
import { ISSHRemoteAgentHostService } from '../../../../platform/agentHost/common/sshRemoteAgentHost.js';
import { ITunnelProxyInfo } from '../../../../platform/tunnel/common/tunnelProxy.js';
import { IWorkbenchEnvironmentService } from '../../../services/environment/common/environmentService.js';
import { IBrowserViewWorkbenchService } from '../common/browserView.js';
import { BrowserRemoteProxyEnabledSettingId } from './browserViewWorkbenchService.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';

export const IAgentHostBrowserProxyService = createDecorator<IAgentHostBrowserProxyService>('agentHostBrowserProxyService');

/**
 * Starts the integrated-browser remote proxy for Agents-window SSH sessions.
 *
 * Remote SSH editor windows already proxy through vscode-remote. A remote
 * Agent Host session in the Agents window has no `remoteAuthority`, so that
 * path never starts and localhost/file-server URLs resolve on the client.
 */
export interface IAgentHostBrowserProxyService {
	readonly _serviceBrand: undefined;

	/**
	 * Ensure browser traffic for {@link sessionResource} is proxied through
	 * its SSH Agent Host connection when applicable.
	 *
	 * @returns `true` when a remote proxy is in use for this session.
	 */
	ensureProxyForSession(sessionResource: URI | undefined): Promise<boolean>;
}

export class AgentHostBrowserProxyService implements IAgentHostBrowserProxyService {
	declare readonly _serviceBrand: undefined;

	constructor(
		@IWorkbenchEnvironmentService private readonly _environmentService: IWorkbenchEnvironmentService,
		@IConfigurationService private readonly _configurationService: IConfigurationService,
		@IRemoteAgentHostService private readonly _remoteAgentHostService: IRemoteAgentHostService,
		@ISSHRemoteAgentHostService private readonly _sshRemoteAgentHostService: ISSHRemoteAgentHostService,
		@IBrowserViewWorkbenchService private readonly _browserViewService: IBrowserViewWorkbenchService,
		@ILogService private readonly _logService: ILogService,
	) { }

	async ensureProxyForSession(sessionResource: URI | undefined): Promise<boolean> {
		if (!this._configurationService.getValue<boolean>(BrowserRemoteProxyEnabledSettingId)) {
			return false;
		}

		// vscode-remote windows already host the tunnel proxy in the local ext host.
		if (this._environmentService.remoteAuthority) {
			return this._browserViewService.willUseRemoteProxy(sessionResource?.toString());
		}

		const address = getSshBrowserProxyAddress(
			sessionResource,
			this._remoteAgentHostService.connections,
			address => this._remoteAgentHostService.getEntryByAddress(address),
		);
		if (!address || !sessionResource) {
			return false;
		}

		try {
			const info = await this._sshRemoteAgentHostService.startBrowserProxy(address);
			await this._browserViewService.setSessionRemoteProxyInfo(sessionResource.toString(), info);
			this._logService.info(`[AgentHostBrowserProxy] Proxied browser traffic for ${sessionResource.toString()} through ${address}`);
			return true;
		} catch (err) {
			this._logService.error(`[AgentHostBrowserProxy] Failed to start SSH browser proxy for ${address}:`, err);
			return false;
		}
	}
}

export class NullAgentHostBrowserProxyService implements IAgentHostBrowserProxyService {
	declare readonly _serviceBrand: undefined;

	async ensureProxyForSession(_sessionResource: URI | undefined): Promise<boolean> {
		return false;
	}
}
