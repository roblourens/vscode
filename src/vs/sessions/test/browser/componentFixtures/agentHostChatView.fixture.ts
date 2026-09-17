/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as dom from '../../../../base/browser/dom.js';
import { Emitter, Event } from '../../../../base/common/event.js';
import { IDisposable } from '../../../../base/common/lifecycle.js';
import { observableValue } from '../../../../base/common/observable.js';
import { URI } from '../../../../base/common/uri.js';
import { mock, upcastPartial } from '../../../../base/test/common/mock.js';
import { ChatInputAnswer, ChatInputResponseKind, ConfirmationOptionKind } from '../../../../platform/agentHost/common/state/protocol/channels-chat/state.js';
import { ChatInputQuestionKind, ChatInteractivity, ChatState, MessageKind, ResponsePartKind, SessionLifecycle, SessionState, SessionStatus, ToolCallConfirmationReason, ToolCallStatus, Turn, TurnState, type ResponsePart } from '../../../../platform/agentHost/common/state/sessionState.js';
import { IContextViewService } from '../../../../platform/contextview/browser/contextView.js';
import { ContextViewService } from '../../../../platform/contextview/browser/contextViewService.js';
import { ExtensionIdentifier } from '../../../../platform/extensions/common/extensions.js';
import { ILabelService } from '../../../../platform/label/common/label.js';
import { ILayoutService } from '../../../../platform/layout/browser/layoutService.js';
import { IMarkdownRendererService, MarkdownRendererService } from '../../../../platform/markdown/browser/markdownRenderer.js';
import { IProductService } from '../../../../platform/product/common/productService.js';
import { IUpdateService, State as UpdateState } from '../../../../platform/update/common/update.js';
import { IUriIdentityService } from '../../../../platform/uriIdentity/common/uriIdentity.js';
// eslint-disable-next-line local/code-import-patterns
import { ChatAgentLocation } from '../../../../workbench/contrib/chat/common/constants.js';
// eslint-disable-next-line local/code-import-patterns
import { ILanguageModelChatMetadataAndIdentifier, ILanguageModelsService } from '../../../../workbench/contrib/chat/common/languageModels.js';
import { ComponentFixtureAdditionalTheme, ComponentFixtureContext, createEditorServices, defineComponentFixture, defineThemedFixtureGroup, registerWorkbenchServices } from '../../../../workbench/test/browser/componentFixtures/fixtureUtils.js';
import { TestProductService } from '../../../../workbench/test/common/workbenchTestServices.js';
import { ChatEntitlement, IChatEntitlementService } from '../../../../workbench/services/chat/common/chatEntitlementService.js';
import { AgentHostChatClientSnapshot, IAgentHostChatClient, IAgentHostChatClientReference } from '../../../common/agentHostSessionsProvider.js';
import { ChatModelSource, IChat, SessionStatus as ViewSessionStatus } from '../../../services/sessions/common/session.js';
import { IActiveSession } from '../../../services/sessions/common/sessionsManagement.js';
import { ISessionsProvider } from '../../../services/sessions/common/sessionsProvider.js';
// eslint-disable-next-line local/code-import-patterns
import { AgentHostChatModelPicker } from '../../../contrib/providers/agentHost/browser/chat/agentHostChatModelPicker.js';
// eslint-disable-next-line local/code-import-patterns
import { AgentHostChatView } from '../../../contrib/providers/agentHost/browser/chat/agentHostChatView.js';

const sessionResource = URI.parse('ahp-mock:/renderer');
const chatResource = URI.parse('ahp-mock:/renderer/chat');
const fixtureModel: ILanguageModelChatMetadataAndIdentifier = {
	identifier: 'mock/gpt-5',
	metadata: {
		extension: new ExtensionIdentifier('vscode.mock-agent-host'),
		name: 'GPT-5',
		id: 'gpt-5',
		vendor: 'mock',
		version: '1',
		family: 'gpt-5',
		maxInputTokens: 128_000,
		maxOutputTokens: 16_000,
		isDefaultForLocation: { [ChatAgentLocation.Chat]: true },
		isUserSelectable: true,
		capabilities: { agentMode: true, toolCalling: true },
	},
};

class FixtureChatClient extends mock<IAgentHostChatClient>() {
	override readonly sessionResource = sessionResource;
	override readonly chatResource = chatResource;
	private readonly _onDidChange = new Emitter<void>();

	constructor(private snapshot: AgentHostChatClientSnapshot) {
		super();
	}

	override getSnapshot(): AgentHostChatClientSnapshot {
		return this.snapshot;
	}

	override subscribe(listener: () => void): IDisposable {
		return this._onDidChange.event(listener);
	}

	override async send(): Promise<void> { }
	override cancel(): void { }
	override setDraft(): void { }
	override async loadOlderTurns(): Promise<void> { }

	override setInputAnswer(requestId: string, questionId: string, answer: ChatInputAnswer | undefined): void {
		this._updateInputRequest(requestId, request => {
			const answers = { ...request.answers };
			if (answer === undefined) {
				delete answers[questionId];
			} else {
				answers[questionId] = answer;
			}
			return { ...request, answers };
		});
	}

	override completeInput(requestId: string, response: ChatInputResponseKind, answers?: Readonly<Record<string, ChatInputAnswer>>): void {
		this._updateInputRequest(requestId, request => ({ ...request, answers: answers ? { ...answers } : request.answers }), response);
	}

	dispose(): void {
		this._onDidChange.dispose();
	}

	private _updateInputRequest(requestId: string, updateRequest: (request: Extract<ResponsePart, { kind: ResponsePartKind.InputRequest }>['request']) => Extract<ResponsePart, { kind: ResponsePartKind.InputRequest }>['request'], response?: ChatInputResponseKind): void {
		if (this.snapshot.status !== 'ready' || !this.snapshot.chat.activeTurn) {
			return;
		}
		const activeTurn = this.snapshot.chat.activeTurn;
		const responseParts = activeTurn.responseParts.map(part => part.kind === ResponsePartKind.InputRequest && part.request.id === requestId
			? { ...part, request: updateRequest(part.request), response }
			: part);
		this.snapshot = {
			...this.snapshot,
			chat: {
				...this.snapshot.chat,
				activeTurn: { ...activeTurn, responseParts },
			},
		};
		this._onDidChange.fire();
	}
}

function createSession(): SessionState {
	return {
		provider: 'mock',
		title: 'Agent Host renderer',
		status: SessionStatus.Idle,
		lifecycle: SessionLifecycle.Ready,
		activeClients: [],
		chats: [],
		defaultChat: chatResource.toString(),
	};
}

function createTurn(id: string, question: string, answer: string): Turn {
	return {
		id,
		message: {
			text: question,
			origin: { kind: MessageKind.User },
		},
		responseParts: [{
			kind: ResponsePartKind.Markdown,
			id: `${id}-response`,
			content: answer,
		}],
		state: TurnState.Complete,
		usage: undefined,
	};
}

function createResponseTurn(id: string, question: string, responseParts: ResponsePart[], state = TurnState.Complete): Turn {
	return {
		id,
		message: {
			text: question,
			origin: { kind: MessageKind.User },
		},
		responseParts,
		state,
		usage: undefined,
	};
}

function createActiveTurn(id: string, question: string, responseParts: ResponsePart[]): NonNullable<ChatState['activeTurn']> {
	return {
		id,
		startedAt: new Date(0).toISOString(),
		message: {
			text: question,
			origin: { kind: MessageKind.User },
		},
		responseParts,
		usage: undefined,
	};
}

function createCompletedTool(toolCallId: string, displayName: string, invocationMessage: string, pastTenseMessage: string, intention: string, success = true): ResponsePart {
	return {
		kind: ResponsePartKind.ToolCall,
		toolCall: {
			status: ToolCallStatus.Completed,
			toolCallId,
			toolName: toolCallId,
			displayName,
			invocationMessage,
			intention,
			confirmed: ToolCallConfirmationReason.NotNeeded,
			success,
			pastTenseMessage,
			...(success ? {} : { error: { message: 'The command exited with code 1.' } }),
		},
	};
}

function createChat(overrides: Partial<ChatState> = {}): ChatState {
	return {
		resource: chatResource.toString(),
		title: 'Renderer prototype',
		status: SessionStatus.Idle,
		modifiedAt: new Date(0).toISOString(),
		turns: [
			createTurn(
				'turn-1',
				'Rebuild this conversation view around Agent Host state.',
				'I created a **protocol-native renderer** with:\n\n- React and TypeScript\n- virtualized completed turns\n- a Monaco-based composer\n- direct Agent Host actions',
			),
			createTurn(
				'turn-2',
				'How is state managed?',
				'The renderer subscribes to raw `SessionState` and `ChatState` snapshots. It does not mirror protocol state into another store.',
			),
		],
		...overrides,
	};
}

async function renderChat(context: ComponentFixtureContext, chat: ChatState, height = 620, width = 720, openSelect = false): Promise<void> {
	context.container.classList.add('interactive-session');
	context.container.style.position = 'relative';
	context.container.style.width = `${width}px`;
	context.container.style.height = `${height}px`;
	context.container.style.fontFamily = 'var(--vscode-font-family, "Segoe WPC", "Segoe UI", sans-serif)';
	context.container.style.fontSize = 'var(--vscode-fontSize-body1)';

	const instantiationService = createEditorServices(context.disposableStore, {
		colorTheme: context.theme,
		additionalServices: reg => {
			registerWorkbenchServices(reg);
			reg.define(IMarkdownRendererService, MarkdownRendererService);
			reg.defineInstance(IProductService, TestProductService);
			reg.defineInstance(IUpdateService, upcastPartial<IUpdateService>({ state: UpdateState.Uninitialized }));
			reg.defineInstance(IUriIdentityService, new class extends mock<IUriIdentityService>() { }());
			reg.defineInstance(IChatEntitlementService, upcastPartial<IChatEntitlementService>({
				entitlement: ChatEntitlement.Pro,
				onDidChangeEntitlement: Event.None,
				onDidChangeQuotaExceeded: Event.None,
				onDidChangeQuotaRemaining: Event.None,
				onDidChangeUsageBasedBilling: Event.None,
				onDidChangeSentiment: Event.None,
				onDidChangeAnonymous: Event.None,
				quotas: {},
				sentiment: { completed: true },
				anonymous: false,
			}));
			reg.defineInstance(ILabelService, new class extends mock<ILabelService>() {
				override getUriLabel(uri: URI): string {
					return uri.path;
				}
			}());
			reg.defineInstance(ILanguageModelsService, new class extends mock<ILanguageModelsService>() {
				override readonly onDidChangeLanguageModels = Event.None;
				override readonly onDidChangeModelVisibility = Event.None;
				override getLanguageModelIds(): string[] {
					return [fixtureModel.identifier];
				}
				override getRecentlyUsedModelIds(): string[] {
					return [];
				}
				override getPinnedModelIds(): string[] {
					return [];
				}
				override isModelHidden(): boolean {
					return false;
				}
				override getModelsControlManifest() {
					return { free: {}, paid: {} };
				}
				override lookupLanguageModel(modelId: string) {
					return modelId === fixtureModel.identifier ? fixtureModel.metadata : undefined;
				}
				override getVendors() {
					return [];
				}
			}());
		},
	});
	instantiationService.set(ILayoutService, new class extends mock<ILayoutService>() {
		override readonly mainContainer = context.container;
		override readonly activeContainer = context.container;
		override readonly onDidLayoutContainer = Event.None;
		override getContainer(): HTMLElement {
			return context.container;
		}
	}());
	const contextViewService = context.disposableStore.add(instantiationService.createInstance(ContextViewService));
	instantiationService.set(IContextViewService, contextViewService);
	const pickerChat = new class extends mock<IChat>() {
		override readonly resource = chatResource;
		override readonly status = observableValue(this, ViewSessionStatus.Completed);
		override readonly modelId = observableValue<string | undefined>(this, fixtureModel.identifier);
		override readonly modelSource = observableValue<ChatModelSource | undefined>(this, ChatModelSource.Chosen);
	}();
	const pickerSession = new class extends mock<IActiveSession>() {
		override readonly sessionId = 'fixture-session';
	}();
	const pickerProvider = new class extends mock<ISessionsProvider>() {
		override readonly id = 'fixture-agent-host';
		override readonly onDidChangeModels = Event.None;
		override getModelsSnapshot(_sessionId: string, desiredModelId?: string) {
			return {
				models: [fixtureModel],
				desiredModelResolution: desiredModelId === fixtureModel.identifier
					? { kind: 'available' as const, model: fixtureModel }
					: { kind: 'notRequested' as const },
				modelTarget: 'agent-host-mock',
			};
		}
		override getModelPickerOptions() {
			return {
				useGroupedModelPicker: false,
				showFeatured: false,
				showUnavailableFeatured: false,
				showManageModelsAction: false,
				showAutoModel: true,
			};
		}
		override setModel(_sessionId: string, _chatResource: URI, modelId: string, source: ChatModelSource): void {
			pickerChat.modelId.set(modelId, undefined);
			pickerChat.modelSource.set(source, undefined);
		}
	}();
	const modelPicker = instantiationService.createInstance(AgentHostChatModelPicker, pickerProvider, pickerSession, pickerChat);
	const client = new FixtureChatClient({ status: 'ready', session: createSession(), chat });
	const reference: IAgentHostChatClientReference = {
		object: client,
		dispose: () => client.dispose(),
	};
	const view = context.disposableStore.add(instantiationService.createInstance(AgentHostChatView, reference, modelPicker));

	context.container.appendChild(view.element);
	view.layout(width, height, 0, 0);
	if (openSelect) {
		const targetWindow = dom.getWindow(context.container);
		await new Promise<void>(resolve => targetWindow.requestAnimationFrame(() => resolve()));
		await targetWindow.document.fonts.ready;
		const select = context.container.querySelector<HTMLElement>('.monaco-select-box');
		if (!select) {
			throw new Error('Expected the structured-input select to render.');
		}
		select.click();
	}
}

const screenshotFixture = (chat: ChatState, height?: number, width?: number, additionalThemes?: readonly ComponentFixtureAdditionalTheme[], openSelect = false) => defineComponentFixture({
	labels: { kind: 'screenshot' },
	additionalThemes,
	render: context => renderChat(context, chat, height, width, openSelect),
});

export default defineThemedFixtureGroup({ path: 'sessions/' }, {
	Completed: screenshotFixture(createChat()),
	StreamingAndQueued: screenshotFixture(createChat({
		status: SessionStatus.InProgress,
		activeTurn: {
			id: 'turn-3',
			startedAt: new Date(0).toISOString(),
			message: {
				text: 'Show the active response separately from history.',
				origin: { kind: MessageKind.User },
			},
			responseParts: [{
				kind: ResponsePartKind.Markdown,
				id: 'turn-3-response',
				content: 'The active turn remains outside the virtualized history while streaming...',
			}],
			usage: undefined,
		},
		queuedMessages: [{
			id: 'queued-1',
			message: {
				text: 'Also verify queued messages.',
				origin: { kind: MessageKind.User },
			},
		}],
	})),
	ToolCalls: screenshotFixture(createChat({
		turns: [createResponseTurn('tools', 'Inspect the renderer, update the implementation, and validate it.', [
			{ kind: ResponsePartKind.Markdown, id: 'tools-intro', content: 'I worked through the relevant implementation and validation surfaces.' },
			createCompletedTool('search-files', 'Search Files', 'Searching the workspace', 'Searched the workspace for Agent Host renderer entry points', 'Locate the renderer, protocol types, and focused tests.'),
			createCompletedTool('edit-files', 'Edit Files', 'Updating the renderer', 'Updated the renderer and fixture scenarios', 'Keep the changes isolated to the Agent Host chat path.'),
			createCompletedTool('run-tests', 'Run Tests', 'Running focused tests', 'Passed 57 focused Sessions tests', 'Verify the client, renderer selection, and interaction behavior.'),
			{ kind: ResponsePartKind.Markdown, id: 'tools-summary', content: '**Validation complete.** The focused tests and visual fixtures pass.' },
		])],
	}), 760),
	ToolConfirmation: screenshotFixture(createChat({
		status: SessionStatus.InputNeeded,
		turns: [],
		activeTurn: createActiveTurn('confirmation', 'Run the formatter and update the generated fixture metadata.', [
			{ kind: ResponsePartKind.Markdown, id: 'confirmation-intro', content: 'I need permission before running this command.' },
			{
				kind: ResponsePartKind.ToolCall,
				toolCall: {
					status: ToolCallStatus.PendingConfirmation,
					toolCallId: 'run-formatter',
					toolName: 'run_in_terminal',
					displayName: 'Run Formatter',
					invocationMessage: 'Run `npm run eslint` on the changed renderer files',
					intention: 'Check formatting and localization before capturing screenshots.',
					options: [
						{ id: 'allow-once', label: 'Allow Once', kind: ConfirmationOptionKind.Approve },
						{ id: 'allow-session', label: 'Allow for This Session', kind: ConfirmationOptionKind.Approve },
						{ id: 'deny', label: 'Deny', kind: ConfirmationOptionKind.Deny, group: 1 },
					],
				},
			},
		]),
	}), 680),
	ResultReview: screenshotFixture(createChat({
		status: SessionStatus.InputNeeded,
		turns: [],
		activeTurn: createActiveTurn('result-review', 'Prepare the workspace changes but let me review them before applying.', [
			{
				kind: ResponsePartKind.ToolCall,
				toolCall: {
					status: ToolCallStatus.PendingResultConfirmation,
					toolCallId: 'apply-patch',
					toolName: 'apply_patch',
					displayName: 'Apply Patch',
					invocationMessage: 'Prepare renderer updates',
					intention: 'Update tool presentation and add representative visual fixtures.',
					confirmed: ToolCallConfirmationReason.UserAction,
					success: true,
					pastTenseMessage: 'Prepared changes to 3 renderer files',
				},
			},
		]),
	})),
	StructuredInput: screenshotFixture(createChat({
		status: SessionStatus.InputNeeded,
		turns: [],
		activeTurn: createActiveTurn('input-request', 'Set up a release validation run.', [
			{ kind: ResponsePartKind.Markdown, id: 'input-intro', content: 'Before I start, I need a few choices for the validation run.' },
			{
				kind: ResponsePartKind.InputRequest,
				request: {
					id: 'validation-options',
					message: 'Configure Validation',
					questions: [
						{
							kind: ChatInputQuestionKind.Text,
							id: 'branch',
							title: 'Branch',
							message: 'Branch or commit to validate',
							defaultValue: 'feature/agent-host-renderer',
							required: true,
						},
						{
							kind: ChatInputQuestionKind.SingleSelect,
							id: 'platform',
							title: 'Platform',
							message: 'Choose the primary validation platform',
							options: [
								{ id: 'windows', label: 'Windows', recommended: true },
								{ id: 'macos', label: 'macOS' },
								{ id: 'linux', label: 'Linux' },
							],
							required: true,
						},
						{
							kind: ChatInputQuestionKind.Boolean,
							id: 'screenshots',
							title: 'Capture Screenshots',
							message: 'Save screenshots with the validation report',
							defaultValue: true,
						},
					],
				},
			},
		]),
	}), 780),
	OpenStructuredInputSelect: screenshotFixture(createChat({
		status: SessionStatus.InputNeeded,
		turns: [],
		activeTurn: createActiveTurn('open-select', 'Choose a validation platform.', [{
			kind: ResponsePartKind.InputRequest,
			request: {
				id: 'open-select-options',
				message: 'Configure Validation',
				questions: [{
					kind: ChatInputQuestionKind.SingleSelect,
					id: 'platform',
					title: 'Platform',
					message: 'Choose the primary validation platform',
					options: [
						{ id: 'windows', label: 'Windows', recommended: true },
						{ id: 'macos', label: 'macOS' },
						{ id: 'linux', label: 'Linux' },
					],
					required: true,
				}],
			},
		}]),
	}), 760, 720, undefined, true),
	NarrowToolConfirmation: screenshotFixture(createChat({
		status: SessionStatus.InputNeeded,
		turns: [],
		activeTurn: createActiveTurn('narrow-confirmation', 'Run a focused validation command with a deliberately long description.', [
			{
				kind: ResponsePartKind.ToolCall,
				toolCall: {
					status: ToolCallStatus.PendingConfirmation,
					toolCallId: 'run-narrow-validation',
					toolName: 'run_in_terminal',
					displayName: 'Run Focused Renderer Validation',
					invocationMessage: 'Run the targeted renderer validation and component fixture checks',
					intention: 'Verify long tool names, descriptions, and actions remain readable in a narrow Agents window.',
					options: [
						{ id: 'allow-once', label: 'Allow Once', kind: ConfirmationOptionKind.Approve },
						{ id: 'allow-session', label: 'Allow for This Session', kind: ConfirmationOptionKind.Approve },
						{ id: 'deny', label: 'Deny', kind: ConfirmationOptionKind.Deny, group: 1 },
					],
				},
			},
		]),
	}), 720, 360),
	HighContrastStructuredInput: screenshotFixture(createChat({
		status: SessionStatus.InputNeeded,
		turns: [],
		activeTurn: createActiveTurn('high-contrast-input', 'Configure validation in high contrast.', [{
			kind: ResponsePartKind.InputRequest,
			request: {
				id: 'high-contrast-options',
				message: 'Configure Validation',
				questions: [
					{
						kind: ChatInputQuestionKind.Text,
						id: 'branch',
						title: 'Branch',
						message: 'Branch or commit to validate',
						defaultValue: 'feature/agent-host-renderer',
						required: true,
					},
					{
						kind: ChatInputQuestionKind.SingleSelect,
						id: 'platform',
						title: 'Platform',
						message: 'Choose the primary validation platform',
						options: [
							{ id: 'windows', label: 'Windows', recommended: true },
							{ id: 'macos', label: 'macOS' },
							{ id: 'linux', label: 'Linux' },
						],
						required: true,
					},
				],
			},
		}]),
	}), 680, 720, ['darkHighContrast', 'lightHighContrast']),
	FailureRecovery: screenshotFixture(createChat({
		status: SessionStatus.Error,
		turns: [],
		activeTurn: createActiveTurn('failure', 'Run the complete validation suite.', [
			{ kind: ResponsePartKind.Reasoning, id: 'failure-reasoning', content: 'The focused checks passed, so I am expanding validation to the complete suite.' },
			{ kind: ResponsePartKind.SystemNotification, content: 'Background validation completed with one failure.' },
			createCompletedTool('full-validation', 'Run Tests', 'Running the complete validation suite', 'The complete validation suite failed', 'Check for regressions outside the focused renderer tests.', false),
			{
				kind: ResponsePartKind.Error,
				error: {
					errorType: 'ValidationError',
					message: 'A flaky integration test failed after the renderer checks completed.',
				},
				resumable: true,
			},
		]),
	}), 720),
	ReadOnly: screenshotFixture(createChat({
		interactivity: ChatInteractivity.ReadOnly,
	})),
	Empty: screenshotFixture(createChat({
		turns: [],
	})),
});
