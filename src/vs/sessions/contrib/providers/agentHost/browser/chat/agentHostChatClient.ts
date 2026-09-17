/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable, DisposableStore, IDisposable, IReference } from '../../../../../../base/common/lifecycle.js';
import { basename } from '../../../../../../base/common/resources.js';
import { StopWatch } from '../../../../../../base/common/stopwatch.js';
import { URI } from '../../../../../../base/common/uri.js';
import { generateUuid } from '../../../../../../base/common/uuid.js';
import { localize } from '../../../../../../nls.js';
import { IAgentConnection } from '../../../../../../platform/agentHost/common/agentService.js';
import { cancelAgentHostTurn, submitAgentHostTurn } from '../../../../../../platform/agentHost/common/agentHostTurnSubmission.js';
import { IAgentSubscription } from '../../../../../../platform/agentHost/common/state/agentSubscription.js';
import { ActionType } from '../../../../../../platform/agentHost/common/state/sessionActions.js';
import { ChatInputAnswer, ChatInputResponseKind, ChatInteractivity, ChatState, Message, MessageAttachment, MessageAttachmentKind, MessageKind, MessageResourceAttachment, PendingMessageKind, SessionState, StateComponents, ToolCallCancellationReason, ToolCallConfirmationReason } from '../../../../../../platform/agentHost/common/state/sessionState.js';
import { AgentHostChatClientSnapshot, IAgentHostChatClient } from '../../../../../common/agentHostSessionsProvider.js';

export interface IAgentHostChatClientOptions {
	readonly connection: IAgentConnection;
	readonly sessionResource: URI;
	readonly chatResource: URI;
	readonly createMessage: (text: string, attachments: readonly MessageAttachment[] | undefined) => Message;
	readonly prepareSend?: () => Promise<void>;
	readonly sessionSubscription?: IReference<IAgentSubscription<SessionState>>;
	readonly chatSubscription?: IReference<IAgentSubscription<ChatState>>;
}

export class AgentHostChatClient extends Disposable implements IAgentHostChatClient {

	readonly sessionResource: URI;
	readonly chatResource: URI;

	private readonly _connection: IAgentConnection;
	private readonly _sessionSubscription;
	private readonly _chatSubscription;
	private readonly _createMessage: IAgentHostChatClientOptions['createMessage'];
	private readonly _prepareSend: IAgentHostChatClientOptions['prepareSend'];
	private readonly _turnStopWatches = new Map<string, StopWatch>();
	private _lastSessionState: SessionState | Error | undefined;
	private _lastChatState: ChatState | Error | undefined;
	private _lastSnapshot: AgentHostChatClientSnapshot = { status: 'loading' };
	private _loadingOlderTurns: Promise<void> | undefined;

	constructor(options: IAgentHostChatClientOptions) {
		super();
		this._connection = options.connection;
		this.sessionResource = options.sessionResource;
		this.chatResource = options.chatResource;
		this._createMessage = options.createMessage;
		this._prepareSend = options.prepareSend;
		this._sessionSubscription = this._register(options.sessionSubscription ?? options.connection.getSubscription(StateComponents.Session, options.sessionResource, AgentHostChatClient.name));
		this._chatSubscription = this._register(options.chatSubscription ?? options.connection.getSubscription(StateComponents.Chat, options.chatResource, AgentHostChatClient.name));
		this._register(this._chatSubscription.object.onDidChange(state => {
			for (const turnId of this._turnStopWatches.keys()) {
				if (state.activeTurn?.id !== turnId) {
					this._turnStopWatches.delete(turnId);
				}
			}
		}));
	}

	getSnapshot(): AgentHostChatClientSnapshot {
		const session = this._sessionSubscription.object.value;
		const chat = this._chatSubscription.object.value;
		if (session === this._lastSessionState && chat === this._lastChatState) {
			return this._lastSnapshot;
		}
		this._lastSessionState = session;
		this._lastChatState = chat;
		if (session instanceof Error) {
			return this._lastSnapshot = { status: 'error', error: session };
		}
		if (chat instanceof Error) {
			return this._lastSnapshot = { status: 'error', error: chat };
		}
		if (!session || !chat) {
			return this._lastSnapshot = { status: 'loading' };
		}
		return this._lastSnapshot = { status: 'ready', session, chat };
	}

	subscribe(listener: () => void): IDisposable {
		const store = new DisposableStore();
		store.add(this._sessionSubscription.object.onDidChange(listener));
		store.add(this._chatSubscription.object.onDidChange(listener));
		if (this._sessionSubscription.object.onDidError) {
			store.add(this._sessionSubscription.object.onDidError(listener));
		}
		if (this._chatSubscription.object.onDidError) {
			store.add(this._chatSubscription.object.onDidError(listener));
		}
		return store;
	}

	async send(text: string, attachments?: readonly MessageAttachment[]): Promise<void> {
		await this._prepareSend?.();
		const snapshot = this.getSnapshot();
		if (snapshot.status !== 'ready') {
			throw snapshot.status === 'error' ? snapshot.error : new Error(localize('agentHostChat.stillLoading', "Agent Host chat is still loading"));
		}
		if (snapshot.chat.interactivity !== undefined && snapshot.chat.interactivity !== ChatInteractivity.Full) {
			throw new Error(localize('agentHostChat.readOnly', "This Agent Host chat is read-only"));
		}

		const createdMessage = this._createMessage(text, attachments ?? snapshot.chat.draft?.attachments);
		const message: Message = {
			...createdMessage,
			model: snapshot.chat.draft?.model ?? createdMessage.model,
			agent: snapshot.chat.draft?.agent ?? createdMessage.agent,
		};
		if (snapshot.chat.activeTurn) {
			this.setPendingMessage(PendingMessageKind.Queued, generateUuid(), message);
			return;
		}

		const turnId = generateUuid();
		this._turnStopWatches.set(turnId, StopWatch.create(false));
		submitAgentHostTurn(this._connection, this.chatResource, {
			turnId,
			startedAt: new Date().toISOString(),
			message,
		});
	}

	cancel(): void {
		const snapshot = this.getSnapshot();
		const turnId = snapshot.status === 'ready' ? snapshot.chat.activeTurn?.id : undefined;
		if (!turnId) {
			return;
		}
		cancelAgentHostTurn(this._connection, this.chatResource, turnId, this._turnStopWatches.get(turnId)?.elapsed() ?? 0);
		this._turnStopWatches.delete(turnId);
	}

	resume(turnId: string): void {
		this._connection.dispatch(this.chatResource.toString(), { type: ActionType.ChatTurnResume, turnId });
	}

	setDraft(draft: Message | undefined): void {
		this._connection.dispatch(this.chatResource.toString(), { type: ActionType.ChatDraftChanged, draft });
	}

	attachResources(resources: readonly URI[]): void {
		const snapshot = this.getSnapshot();
		if (snapshot.status !== 'ready') {
			return;
		}
		const draft = snapshot.chat.draft ?? this._createMessage('', undefined);
		const resourceAttachments: MessageResourceAttachment[] = resources.map(resource => ({
			type: MessageAttachmentKind.Resource,
			label: basename(resource),
			uri: this._connection.resourceUris.toAgentHost(resource).toString(),
		}));
		const attachments: MessageAttachment[] = [
			...(draft.attachments ?? []),
			...resourceAttachments,
		];
		this.setDraft({ ...draft, attachments });
	}

	setPendingMessage(kind: PendingMessageKind, id: string, message: Message): void {
		this._connection.dispatch(this.chatResource.toString(), { type: ActionType.ChatPendingMessageSet, kind, id, message });
	}

	removePendingMessage(kind: PendingMessageKind, id: string): void {
		this._connection.dispatch(this.chatResource.toString(), { type: ActionType.ChatPendingMessageRemoved, kind, id });
	}

	reorderQueuedMessages(order: readonly string[]): void {
		this._connection.dispatch(this.chatResource.toString(), { type: ActionType.ChatQueuedMessagesReordered, order: [...order] });
	}

	truncate(turnId?: string): void {
		this._connection.dispatch(this.chatResource.toString(), { type: ActionType.ChatTruncated, turnId });
	}

	confirmToolCall(turnId: string, toolCallId: string, approved: boolean, selectedOptionId?: string): void {
		this._connection.dispatch(this.chatResource.toString(), approved ? {
			type: ActionType.ChatToolCallConfirmed,
			turnId,
			toolCallId,
			approved: true,
			confirmed: ToolCallConfirmationReason.UserAction,
			selectedOptionId,
		} : {
			type: ActionType.ChatToolCallConfirmed,
			turnId,
			toolCallId,
			approved: false,
			reason: ToolCallCancellationReason.Denied,
			selectedOptionId,
		});
	}

	confirmToolResult(turnId: string, toolCallId: string, approved: boolean): void {
		this._connection.dispatch(this.chatResource.toString(), {
			type: ActionType.ChatToolCallResultConfirmed,
			turnId,
			toolCallId,
			approved,
		});
	}

	setInputAnswer(requestId: string, questionId: string, answer: ChatInputAnswer | undefined): void {
		this._connection.dispatch(this.chatResource.toString(), {
			type: ActionType.ChatInputAnswerChanged,
			requestId,
			questionId,
			answer,
		});
	}

	completeInput(requestId: string, response: ChatInputResponseKind, answers?: Readonly<Record<string, ChatInputAnswer>>): void {
		this._connection.dispatch(this.chatResource.toString(), {
			type: ActionType.ChatInputCompleted,
			requestId,
			response,
			answers: answers ? { ...answers } : undefined,
		});
	}

	loadOlderTurns(): Promise<void> {
		if (this._loadingOlderTurns) {
			return this._loadingOlderTurns;
		}
		const snapshot = this.getSnapshot();
		if (snapshot.status !== 'ready' || !snapshot.chat.turnsNextCursor) {
			return Promise.resolve();
		}
		const operation = this._connection.fetchTurns({
			channel: this.chatResource.toString(),
			cursor: snapshot.chat.turnsNextCursor,
		}).then(() => undefined);
		this._loadingOlderTurns = operation;
		const clearOperation = () => {
			if (this._loadingOlderTurns === operation) {
				this._loadingOlderTurns = undefined;
			}
		};
		void operation.then(clearOperation, clearOperation);
		return operation;
	}

	override dispose(): void {
		this._turnStopWatches.clear();
		super.dispose();
	}
}

export function createUserMessage(text: string, attachments: readonly MessageAttachment[] | undefined, model: Message['model'], agent: Message['agent']): Message {
	return {
		text,
		origin: { kind: MessageKind.User },
		...(attachments?.length ? { attachments: [...attachments] } : {}),
		...(model ? { model } : {}),
		...(agent ? { agent } : {}),
	};
}
