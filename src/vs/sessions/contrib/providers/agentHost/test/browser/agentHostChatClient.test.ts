/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { Emitter, Event } from '../../../../../../base/common/event.js';
import { Disposable, IReference } from '../../../../../../base/common/lifecycle.js';
import { URI } from '../../../../../../base/common/uri.js';
import { mock } from '../../../../../../base/test/common/mock.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../../base/test/common/utils.js';
import { IAgentConnection } from '../../../../../../platform/agentHost/common/agentService.js';
import { identityAgentHostResourceUriMapper } from '../../../../../../platform/agentHost/common/agentHostUri.js';
import { IAgentSubscription } from '../../../../../../platform/agentHost/common/state/agentSubscription.js';
import { ActionType } from '../../../../../../platform/agentHost/common/state/sessionActions.js';
import { ChatInteractivity, ChatState, MessageAttachmentKind, MessageKind, SessionLifecycle, SessionState, SessionStatus } from '../../../../../../platform/agentHost/common/state/sessionState.js';
import { FetchTurnsParams, FetchTurnsResult } from '../../../../../../platform/agentHost/common/state/protocol/commands.js';
import { AgentHostChatClient, createUserMessage } from '../../browser/chat/agentHostChatClient.js';

class TestSubscription<T> extends Disposable implements IAgentSubscription<T> {
	private readonly _onDidChange = this._register(new Emitter<T>());
	readonly onDidChange = this._onDidChange.event;
	readonly onWillApplyAction = Event.None;
	readonly onDidApplyAction = Event.None;
	verifiedValue: T | undefined;

	constructor(public value: T | Error | undefined) {
		super();
		this.verifiedValue = value instanceof Error ? undefined : value;
	}

	set(value: T): void {
		this.value = value;
		this.verifiedValue = value;
		this._onDidChange.fire(value);
	}
}

function reference<T>(object: T): IReference<T> {
	return { object, dispose: () => { } };
}

class TestConnection extends mock<IAgentConnection>() {
	override readonly resourceUris = identityAgentHostResourceUriMapper;
	readonly dispatched: { readonly channel: string; readonly action: Parameters<IAgentConnection['dispatch']>[1] }[] = [];
	readonly fetched: FetchTurnsParams[] = [];

	override dispatch(channel: string, action: Parameters<IAgentConnection['dispatch']>[1]): void {
		this.dispatched.push({ channel, action });
	}

	override async fetchTurns(params: FetchTurnsParams): Promise<FetchTurnsResult> {
		this.fetched.push(params);
		return {};
	}
}

suite('AgentHostChatClient', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();

	const sessionResource = URI.parse('ahp-session:/session');
	const chatResource = URI.parse('ahp-session:/session/chat');

	function createSession(): SessionState {
		return {
			provider: 'test',
			title: 'Test',
			status: SessionStatus.Idle,
			lifecycle: SessionLifecycle.Ready,
			activeClients: [],
			chats: [],
			defaultChat: chatResource.toString(),
		};
	}

	function createChat(): ChatState {
		return {
			resource: chatResource.toString(),
			title: 'Chat',
			status: SessionStatus.Idle,
			modifiedAt: new Date(0).toISOString(),
			turns: [],
		};
	}

	function createClient(connection: TestConnection, session: TestSubscription<SessionState>, chat: TestSubscription<ChatState>, prepareSend?: () => Promise<void>): AgentHostChatClient {
		store.add(session);
		store.add(chat);
		return store.add(new AgentHostChatClient({
			connection,
			sessionResource,
			chatResource,
			sessionSubscription: reference(session),
			chatSubscription: reference(chat),
			createMessage: (text, attachments) => createUserMessage(text, attachments, undefined, undefined),
			prepareSend,
		}));
	}

	test('exposes stable snapshots and dispatches turns against the chat channel', async () => {
		const connection = new TestConnection();
		const session = new TestSubscription(createSession());
		const chat = new TestSubscription(createChat());
		const client = createClient(connection, session, chat);

		const firstSnapshot = client.getSnapshot();
		assert.strictEqual(client.getSnapshot(), firstSnapshot);

		await client.send('hello');

		assert.deepStrictEqual(connection.dispatched.map(entry => ({
			channel: entry.channel,
			type: entry.action.type,
			text: entry.action.type === ActionType.ChatTurnStarted ? entry.action.message.text : undefined,
			origin: entry.action.type === ActionType.ChatTurnStarted ? entry.action.message.origin.kind : undefined,
		})), [{
			channel: chatResource.toString(),
			type: ActionType.ChatTurnStarted,
			text: 'hello',
			origin: MessageKind.User,
		}]);
	});

	test('queues while a turn is active, attaches resources, and loads older turns once', async () => {
		const connection = new TestConnection();
		const session = new TestSubscription(createSession());
		const initialChat = createChat();
		const chat = new TestSubscription<ChatState>({
			...initialChat,
			turnsNextCursor: 'cursor',
			activeTurn: {
				id: 'active',
				startedAt: new Date(0).toISOString(),
				message: createUserMessage('active', undefined, undefined, undefined),
				responseParts: [],
				usage: undefined,
			},
		});
		const client = createClient(connection, session, chat);

		await client.send('next');
		client.attachResources([URI.file('folder/file.ts')]);
		await Promise.all([client.loadOlderTurns(), client.loadOlderTurns()]);

		const draftAction = connection.dispatched[1]?.action;
		const attachment = draftAction?.type === ActionType.ChatDraftChanged
			? draftAction.draft?.attachments?.[0]
			: undefined;
		assert.deepStrictEqual({
			actionTypes: connection.dispatched.map(entry => entry.action.type),
			attachedUri: attachment?.type === MessageAttachmentKind.Resource
				? attachment.uri
				: undefined,
			fetched: connection.fetched,
		}, {
			actionTypes: [ActionType.ChatPendingMessageSet, ActionType.ChatDraftChanged],
			attachedUri: URI.file('folder/file.ts').toString(),
			fetched: [{ channel: chatResource.toString(), cursor: 'cursor' }],
		});
	});

	test('rejects sends to read-only chats', async () => {
		const connection = new TestConnection();
		const session = new TestSubscription(createSession());
		const chat = new TestSubscription<ChatState>({
			...createChat(),
			interactivity: ChatInteractivity.ReadOnly,
		});
		const client = createClient(connection, session, chat);

		await assert.rejects(client.send('hello'), /read-only/);
		assert.deepStrictEqual(connection.dispatched, []);
	});

	test('does not dispatch when preparing a send fails', async () => {
		const connection = new TestConnection();
		const session = new TestSubscription(createSession());
		const chat = new TestSubscription(createChat());
		const client = createClient(connection, session, chat, async () => {
			throw new Error('preparation failed');
		});

		await assert.rejects(client.send('hello'), /preparation failed/);
		assert.deepStrictEqual(connection.dispatched, []);
	});

	test('cancels a started turn through the shared turn submission path', async () => {
		const connection = new TestConnection();
		const session = new TestSubscription(createSession());
		const chat = new TestSubscription(createChat());
		const client = createClient(connection, session, chat);

		await client.send('hello');
		const started = connection.dispatched[0]?.action;
		assert.ok(started?.type === ActionType.ChatTurnStarted);
		chat.set({
			...createChat(),
			activeTurn: {
				id: started.turnId,
				startedAt: started.startedAt,
				message: started.message,
				responseParts: [],
				usage: undefined,
			},
		});
		client.cancel();

		const cancelled = connection.dispatched[1]?.action;
		assert.deepStrictEqual({
			type: cancelled?.type,
			turnId: cancelled?.type === ActionType.ChatTurnCancelled ? cancelled.turnId : undefined,
			hasValidDuration: cancelled?.type === ActionType.ChatTurnCancelled
				? Number.isFinite(cancelled.duration) && cancelled.duration >= 0
				: false,
		}, {
			type: ActionType.ChatTurnCancelled,
			turnId: started.turnId,
			hasValidDuration: true,
		});
	});
});
