/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../../../base/common/lifecycle.js';
import { IWorkbenchContribution, registerWorkbenchContribution2, WorkbenchPhase } from '../../../../../../workbench/common/contributions.js';
import { isAgentHostProvider } from '../../../../../common/agentHostSessionsProvider.js';
import { IChatViewFactory } from '../../../../../services/chatView/browser/chatViewFactory.js';
import { ISessionsProvidersService } from '../../../../../services/sessions/browser/sessionsProvidersService.js';
import { AgentHostChatModelPicker } from './agentHostChatModelPicker.js';
import { AgentHostChatView, AGENT_HOST_REACT_CHAT_RENDERER_ID } from './agentHostChatView.js';

class AgentHostChatRendererContribution extends Disposable implements IWorkbenchContribution {

	static readonly ID = 'sessions.contrib.agentHostChatRenderer';

	constructor(
		@IChatViewFactory chatViewFactory: IChatViewFactory,
		@ISessionsProvidersService sessionsProvidersService: ISessionsProvidersService,
	) {
		super();
		this._register(chatViewFactory.registerRenderer({
			id: AGENT_HOST_REACT_CHAT_RENDERER_ID,
			canRender: (session, chat, kind) => {
				const provider = sessionsProvidersService.getProvider(session.providerId);
				return kind === 'chat'
					&& chat !== undefined
					&& provider !== undefined
					&& isAgentHostProvider(provider)
					&& provider.canAcquireChatClient(session.sessionId, chat.resource);
			},
			createNewChatView: () => {
				throw new Error('The Agent Host renderer does not render new-session views');
			},
			createChatView: (session, chat, instantiationService) => {
				const provider = sessionsProvidersService.getProvider(session.providerId);
				if (!provider || !isAgentHostProvider(provider)) {
					throw new Error(`No Agent Host provider is registered for '${session.providerId}'`);
				}
				const client = provider.acquireChatClient(session.sessionId, chat.resource);
				if (!client) {
					throw new Error(`The Agent Host chat '${chat.resource.toString()}' is not available`);
				}
				const modelPicker = instantiationService.createInstance(AgentHostChatModelPicker, provider, session, chat);
				try {
					return instantiationService.createInstance(AgentHostChatView, client, modelPicker);
				} catch (error) {
					modelPicker.dispose();
					client.dispose();
					throw error;
				}
			},
		}));
	}
}

registerWorkbenchContribution2(AgentHostChatRendererContribution.ID, AgentHostChatRendererContribution, WorkbenchPhase.BlockRestore);
