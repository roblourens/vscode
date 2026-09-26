/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable, DisposableStore } from '../../../../../../base/common/lifecycle.js';
import { autorun } from '../../../../../../base/common/observable.js';
import { IAgentHostEnablementService } from '../../../../../../platform/agentHost/common/agentHostEnablementService.js';
import { IAgentHostService } from '../../../../../../platform/agentHost/common/agentService.js';
import { AgentHostMcpServers, AgentHostMcpServersConfigKey } from '../../../../../../platform/agentHost/common/agentHostSchema.js';
import { IWorkbenchContribution } from '../../../../../../workbench/common/contributions.js';
import { IMcpWorkbenchService } from '../../../../mcp/common/mcpTypes.js';
import { IWorkbenchEnvironmentService } from '../../../../../services/environment/common/environmentService.js';
import { IWorkbenchLocalMcpServer, LocalMcpServerScope } from '../../../../../services/mcp/common/mcpWorkbenchManagementService.js';
import { AgentHostRootConfigForwarder, type IForwardedRootConfigKey } from './agentHostRootConfigForwarder.js';

/**
 * Host user-profile MCP (`User/mcp.json` locally, remote-user `mcp.json` in a
 * remote window) that should be published on the agent host's root `mcpServers`
 * map so every session sees it at create time — including sessions started by a
 * remote client before this window messages them (#338096).
 */
export function collectHostUserMcpServersForRootConfig(
	servers: readonly IWorkbenchLocalMcpServer[],
	windowRemoteAuthority: string | null,
): AgentHostMcpServers {
	const expectedScope = windowRemoteAuthority ? LocalMcpServerScope.RemoteUser : LocalMcpServerScope.User;
	const result: AgentHostMcpServers = {};
	for (const server of servers) {
		if (server.scope === expectedScope) {
			result[server.name] = server.config;
		}
	}
	return result;
}

function asMcpServersMap(value: unknown): AgentHostMcpServers {
	return value && typeof value === 'object' && !Array.isArray(value)
		? { ...value as AgentHostMcpServers }
		: {};
}

/**
 * Forwards this window's host-machine user MCP into the connected agent host's
 * root `mcpServers` config. Copilot and Codex already seed every session from
 * that map; Claude merges it at startup. Gated on Agent Host runtime
 * availability. The schema-gate / hydration-retry / loop-guard machinery lives
 * in {@link AgentHostRootConfigForwarder}.
 *
 * Only user / remote-user profile servers are forwarded: workspace `.mcp.json`
 * is runtime-discovered per session, and Copilot-home is runtime-discovered by
 * the local Copilot SDK. Remote windows forward remote-user MCP (the host's
 * `mcp.json`) rather than the laptop's user profile.
 */
export class AgentHostMcpServersContribution extends Disposable implements IWorkbenchContribution {
	static readonly ID = 'workbench.contrib.agentHostMcpServers';

	private readonly _forwarder: AgentHostRootConfigForwarder;
	private readonly _windowRemoteAuthority: string | null;
	private _managedServerNames = new Set<string>();

	constructor(
		@IAgentHostService private readonly _agentHostService: IAgentHostService,
		@IAgentHostEnablementService private readonly _agentHostEnablementService: IAgentHostEnablementService,
		@IMcpWorkbenchService private readonly _mcpWorkbenchService: IMcpWorkbenchService,
		@IWorkbenchEnvironmentService environmentService: IWorkbenchEnvironmentService,
	) {
		super();
		this._windowRemoteAuthority = environmentService.remoteAuthority ?? null;

		const keys: readonly IForwardedRootConfigKey[] = [
			{
				key: AgentHostMcpServersConfigKey,
				computeValue: () => this._computeHostMcpServers(),
				registerTriggers: (store: DisposableStore, push: () => void) => {
					store.add(this._mcpWorkbenchService.onChange(() => push()));
				},
			},
		];
		this._forwarder = this._register(new AgentHostRootConfigForwarder(keys, this._agentHostService));

		this._register(autorun(reader => {
			if (this._agentHostEnablementService.enabled.read(reader)) {
				this._forwarder.start();
			} else {
				this._forwarder.stop();
			}
		}));
	}

	private async _computeHostMcpServers(): Promise<AgentHostMcpServers> {
		await this._mcpWorkbenchService.whenInitialLocalMcpServersLoaded;
		const forwarded = collectHostUserMcpServersForRootConfig(
			this._mcpWorkbenchService.getEnabledLocalMcpServers(),
			this._windowRemoteAuthority,
		);
		const rootState = this._agentHostService.rootState.value;
		const existing = !rootState || rootState instanceof Error
			? {}
			: asMcpServersMap(rootState.config?.values[AgentHostMcpServersConfigKey]);
		for (const name of this._managedServerNames) {
			if (!Object.prototype.hasOwnProperty.call(forwarded, name)) {
				delete existing[name];
			}
		}
		this._managedServerNames = new Set(Object.keys(forwarded));
		return { ...existing, ...forwarded };
	}
}
