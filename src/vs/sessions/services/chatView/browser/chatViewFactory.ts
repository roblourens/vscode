/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IDisposable } from '../../../../base/common/lifecycle.js';
import { createDecorator, IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { AbstractChatView, ChatViewKind, IChatViewOptions } from '../../../browser/parts/chatView.js';
import { IChat } from '../../sessions/common/session.js';
import { IActiveSession } from '../../sessions/common/sessionsManagement.js';

export const IChatViewFactory = createDecorator<IChatViewFactory>('chatViewFactory');
export const LEGACY_CHAT_VIEW_RENDERER_ID = 'legacy';

export interface IChatViewRenderer {
	readonly id: string;
	canRender(session: IActiveSession, chat: IChat | undefined, kind: ChatViewKind): boolean;
	createNewChatView(isNewChatInSession: boolean, options: IChatViewOptions, instantiationService: IInstantiationService): AbstractChatView;
	createChatView(session: IActiveSession, chat: IChat, instantiationService: IInstantiationService): AbstractChatView;
}

/**
 * Creates {@link AbstractChatView} instances for the {@link SessionsPart}
 * internal grid. The factory lives in the services layer so that core
 * (`sessions/browser/`) can instantiate chat views without depending on the
 * concrete view implementations, which live in `sessions/contrib/chat/`.
 */
export interface IChatViewFactory {

	readonly _serviceBrand: undefined;

	registerRenderer(renderer: IChatViewRenderer): IDisposable;
	getRendererId(session: IActiveSession, chat: IChat | undefined, kind: ChatViewKind): string;

	/**
	 * Creates a "new chat" view that lets the user pick a workspace and
	 * start a new chat. This is the view the grid is seeded with on startup.
	 */
	createNewChatView(session: IActiveSession | undefined, chat: IChat | undefined, isNewChatInSession: boolean, options: IChatViewOptions, instantiationService?: IInstantiationService): AbstractChatView;

	/**
	 * Creates a chat view that hosts a chat widget for an active session.
	 */
	createChatView(session: IActiveSession, chat: IChat | undefined, instantiationService?: IInstantiationService): AbstractChatView;
}
