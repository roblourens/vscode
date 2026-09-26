/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { Emitter, Event } from '../../../../../../base/common/event.js';
import { DisposableStore } from '../../../../../../base/common/lifecycle.js';
import { constObservable } from '../../../../../../base/common/observable.js';
import { URI } from '../../../../../../base/common/uri.js';
import { mock } from '../../../../../../base/test/common/mock.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../../base/test/common/utils.js';
import { IAgentHostEnablementService } from '../../../../../../platform/agentHost/common/agentHostEnablementService.js';
import { IAgentHostService } from '../../../../../../platform/agentHost/common/agentService.js';
import { AgentHostMcpServersConfigKey } from '../../../../../../platform/agentHost/common/agentHostSchema.js';
import { IAgentSubscription } from '../../../../../../platform/agentHost/common/state/agentSubscription.js';
import type { ClientAnnotationsAction, INotification, IRootConfigChangedAction, SessionAction, TerminalAction } from '../../../../../../platform/agentHost/common/state/sessionActions.js';
import type { ConfigPropertySchema, RootState } from '../../../../../../platform/agentHost/common/state/sessionState.js';
import { McpServerType } from '../../../../../../platform/mcp/common/mcpPlatformTypes.js';
import { TestInstantiationService } from '../../../../../../platform/instantiation/test/common/instantiationServiceMock.js';
import { IMcpWorkbenchService } from '../../../../mcp/common/mcpTypes.js';
import { IWorkbenchEnvironmentService } from '../../../../../services/environment/common/environmentService.js';
import { IWorkbenchLocalMcpServer, LocalMcpServerScope } from '../../../../../services/mcp/common/mcpWorkbenchManagementService.js';
import { AgentHostMcpServersContribution, collectHostUserMcpServersForRootConfig } from '../../../browser/agentSessions/agentHost/agentHostMcpServersContribution.js';

class MockAgentHostService extends mock<IAgentHostService>() {
	declare readonly _serviceBrand: undefined;

	private readonly _onAgentHostStart = new Emitter<void>();
	override readonly onAgentHostStart = this._onAgentHostStart.event;
	override readonly onAgentHostExit = Event.None;
	override readonly onDidAction = Event.None;
	override readonly onDidNotification: Event<INotification> = Event.None;

	public dispatchedActions: { channel: string; action: SessionAction | TerminalAction | ClientAnnotationsAction | IRootConfigChangedAction }[] = [];

	override dispatch(channel: string, action: SessionAction | TerminalAction | ClientAnnotationsAction | IRootConfigChangedAction): void {
		this.dispatchedActions.push({ channel, action });
	}

	private _rootStateValue: RootState | undefined = undefined;
	private readonly _rootStateOnDidChange = new Emitter<RootState>();
	override readonly rootState: IAgentSubscription<RootState> = (() => {
		const self = this;
		return {
			get value() { return self._rootStateValue; },
			get verifiedValue() { return self._rootStateValue; },
			onDidChange: this._rootStateOnDidChange.event,
			onWillApplyAction: Event.None,
			onDidApplyAction: Event.None,
		};
	})();

	setRootState(state: RootState): void {
		this._rootStateValue = state;
		this._rootStateOnDidChange.fire(state);
	}

	dispose(): void {
		this._onAgentHostStart.dispose();
		this._rootStateOnDidChange.dispose();
	}
}

function makeRootStateWithSchema(properties: Record<string, ConfigPropertySchema>, values: Record<string, unknown> = {}): RootState {
	return {
		agents: [],
		config: {
			schema: { type: 'object', properties },
			values,
		},
	};
}

const mcpServersSchema: Record<string, ConfigPropertySchema> = {
	[AgentHostMcpServersConfigKey]: { type: 'object', title: 'MCP Servers' },
};

async function flush(): Promise<void> {
	await Promise.resolve();
	await Promise.resolve();
	await Promise.resolve();
}

function makeLocalServer(name: string, scope: LocalMcpServerScope, command: string): IWorkbenchLocalMcpServer {
	return {
		name,
		scope,
		config: { type: McpServerType.LOCAL, command },
		mcpResource: URI.file(`/mcp/${scope}/${name}.json`),
		source: 'local',
		id: `${scope}.${name}`,
	};
}

function setup(disposables: DisposableStore, options: {
	servers: readonly IWorkbenchLocalMcpServer[];
	remoteAuthority?: string;
	onChange?: Event<undefined>;
}) {
	const instantiationService = disposables.add(new TestInstantiationService());
	const agentHostService = new MockAgentHostService();
	disposables.add({ dispose: () => agentHostService.dispose() });
	const onChange = options.onChange ?? Event.None;
	instantiationService.stub(IAgentHostService, agentHostService);
	instantiationService.stub(IAgentHostEnablementService, { _serviceBrand: undefined, enabled: constObservable(true), managedSandboxEnforced: constObservable(false) });
	instantiationService.stub(IMcpWorkbenchService, {
		local: [],
		onChange,
		whenInitialLocalMcpServersLoaded: Promise.resolve(),
		getEnabledLocalMcpServers: () => options.servers,
	} as Partial<IMcpWorkbenchService> as IMcpWorkbenchService);
	instantiationService.stub(IWorkbenchEnvironmentService, { remoteAuthority: options.remoteAuthority } as Partial<IWorkbenchEnvironmentService> as IWorkbenchEnvironmentService);
	disposables.add(instantiationService.createInstance(AgentHostMcpServersContribution));
	return { agentHostService };
}

suite('collectHostUserMcpServersForRootConfig', () => {

	test('forwards local user MCP on the host window and remote-user MCP from a remote window', () => {
		const notion = makeLocalServer('notion', LocalMcpServerScope.User, 'npx');
		const hostNotion = makeLocalServer('notion', LocalMcpServerScope.RemoteUser, 'npx-host');
		const workspace = makeLocalServer('workspace', LocalMcpServerScope.Workspace, 'ws');

		assert.deepStrictEqual(collectHostUserMcpServersForRootConfig([notion, hostNotion, workspace], null), {
			notion: { type: McpServerType.LOCAL, command: 'npx' },
		});
		assert.deepStrictEqual(collectHostUserMcpServersForRootConfig([notion, hostNotion, workspace], 'ssh-remote+devbox'), {
			notion: { type: McpServerType.LOCAL, command: 'npx-host' },
		});
	});
});

suite('AgentHostMcpServersContribution', () => {

	const disposables = new DisposableStore();

	teardown(() => disposables.clear());
	ensureNoDisposablesAreLeakedInTestSuite();

	test('forwards host user MCP into root config once the schema advertises mcpServers', async () => {
		const { agentHostService } = setup(disposables, {
			servers: [makeLocalServer('notion', LocalMcpServerScope.User, 'npx')],
		});
		agentHostService.setRootState(makeRootStateWithSchema(mcpServersSchema, {
			[AgentHostMcpServersConfigKey]: { operator: { type: McpServerType.LOCAL, command: 'operator' } },
		}));
		await flush();

		assert.strictEqual(agentHostService.dispatchedActions.length, 1);
		assert.deepStrictEqual((agentHostService.dispatchedActions[0].action as IRootConfigChangedAction).config, {
			[AgentHostMcpServersConfigKey]: {
				operator: { type: McpServerType.LOCAL, command: 'operator' },
				notion: { type: McpServerType.LOCAL, command: 'npx' },
			},
		});
	});

	test('forwards remote-user MCP when the window is attached to a remote host', async () => {
		const { agentHostService } = setup(disposables, {
			remoteAuthority: 'ssh-remote+devbox',
			servers: [
				makeLocalServer('laptop', LocalMcpServerScope.User, 'laptop'),
				makeLocalServer('notion', LocalMcpServerScope.RemoteUser, 'host-notion'),
			],
		});
		agentHostService.setRootState(makeRootStateWithSchema(mcpServersSchema));
		await flush();

		assert.deepStrictEqual((agentHostService.dispatchedActions[0].action as IRootConfigChangedAction).config, {
			[AgentHostMcpServersConfigKey]: {
				notion: { type: McpServerType.LOCAL, command: 'host-notion' },
			},
		});
	});
});
