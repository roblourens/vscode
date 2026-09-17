/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as React from '../../../../../browser/browserRuntime.js';
import { createRoot, type Root, useVirtualizer } from '../../../../../browser/browserRuntime.js';
import { getWindow } from '../../../../../../base/browser/dom.js';
import { status } from '../../../../../../base/browser/ui/aria/aria.js';
import { Button } from '../../../../../../base/browser/ui/button/button.js';
import { InputBox, MessageType } from '../../../../../../base/browser/ui/inputbox/inputBox.js';
import { ISelectOptionItem, SelectBox } from '../../../../../../base/browser/ui/selectBox/selectBox.js';
import { Checkbox } from '../../../../../../base/browser/ui/toggle/toggle.js';
import { RunOnceScheduler } from '../../../../../../base/common/async.js';
import { Codicon } from '../../../../../../base/common/codicons.js';
import { getErrorMessage } from '../../../../../../base/common/errors.js';
import { KeyCode } from '../../../../../../base/common/keyCodes.js';
import { DisposableStore } from '../../../../../../base/common/lifecycle.js';
import { observableValue } from '../../../../../../base/common/observable.js';
import { ThemeIcon } from '../../../../../../base/common/themables.js';
import { URI } from '../../../../../../base/common/uri.js';
import { ICodeEditor } from '../../../../../../editor/browser/editorBrowser.js';
import { CodeEditorWidget } from '../../../../../../editor/browser/widget/codeEditor/codeEditorWidget.js';
import { IEditorOptions } from '../../../../../../editor/common/config/editorOptions.js';
import { IModelService } from '../../../../../../editor/common/services/model.js';
import { IAccessibilityService } from '../../../../../../platform/accessibility/common/accessibility.js';
import { IConfigurationService } from '../../../../../../platform/configuration/common/configuration.js';
import { IContextViewService } from '../../../../../../platform/contextview/browser/contextView.js';
import { IInstantiationService } from '../../../../../../platform/instantiation/common/instantiation.js';
import { ChatInputAnswer, ChatInputAnswerState, ChatInputAnswerValueKind, ChatInputQuestion, ChatInputQuestionKind, ChatInputRequest, ChatInputResponseKind, ChatInteractivity, ChatState, ResponsePart, ResponsePartKind, StringOrMarkdown, ToolCallStatus, Turn } from '../../../../../../platform/agentHost/common/state/sessionState.js';
import { defaultButtonStyles, defaultCheckboxStyles, defaultInputBoxStyles, defaultSelectBoxStyles } from '../../../../../../platform/theme/browser/defaultStyles.js';
import { localize } from '../../../../../../nls.js';
import { ChatContentMarkdownRenderer } from '../../../../../../workbench/contrib/chat/browser/widget/chatContentMarkdownRenderer.js';
import { getSimpleCodeEditorWidgetOptions, getSimpleEditorOptions } from '../../../../../../workbench/contrib/codeEditor/browser/simpleEditorOptions.js';
import { IChat, ISession } from '../../../../../services/sessions/common/session.js';
import { AbstractChatView } from '../../../../../browser/parts/chatView.js';
import { IAgentHostChatClient, IAgentHostChatClientReference } from '../../../../../common/agentHostSessionsProvider.js';
import { createUserMessage } from './agentHostChatClient.js';
import { AgentHostChatModelPicker } from './agentHostChatModelPicker.js';
import './agentHostChatView.css';

const RENDERER_ID = 'agentHostReact';
const promptControlSelector = 'button, [role="button"], [role="checkbox"], input, select';

interface AgentHostChatAppProps {
	readonly client: IAgentHostChatClient;
	readonly modelPicker: AgentHostChatModelPicker | undefined;
	readonly markdownRenderer: ChatContentMarkdownRenderer;
	readonly instantiationService: IInstantiationService;
	readonly modelService: IModelService;
	readonly configurationService: IConfigurationService;
	readonly contextViewService: IContextViewService;
	readonly accessibilityService: IAccessibilityService;
	readonly onEditorCreated: (editor: ICodeEditor | undefined) => void;
	readonly onTranscriptCreated: (transcript: HTMLElement | undefined, canInteract: boolean) => void;
	readonly onPromptCreated: (prompt: HTMLElement | undefined) => void;
}

function useScreenReaderOptimized(accessibilityService: IAccessibilityService): boolean {
	return React.useSyncExternalStore(
		React.useCallback(listener => {
			const subscription = accessibilityService.onDidChangeScreenReaderOptimized(listener);
			return () => subscription.dispose();
		}, [accessibilityService]),
		React.useCallback(() => accessibilityService.isScreenReaderOptimized(), [accessibilityService]),
	);
}

interface VSCodeButtonProps {
	readonly label: string;
	readonly title?: string;
	readonly secondary?: boolean;
	readonly enabled?: boolean;
	readonly icon?: ThemeIcon;
	readonly onClick: () => void;
}

function VSCodeButton({ label, title, secondary, enabled = true, icon, onClick }: VSCodeButtonProps): React.JSX.Element {
	const containerRef = React.useRef<HTMLSpanElement>(null);
	React.useEffect(() => {
		const container = containerRef.current;
		if (!container) {
			return;
		}
		const store = new DisposableStore();
		const button = store.add(new Button(container, { ...defaultButtonStyles, secondary, title: title ?? label, ariaLabel: label }));
		button.label = icon ? '' : label;
		if (icon) {
			button.icon = icon;
		}
		button.enabled = enabled;
		store.add(button.onDidClick(onClick));
		return () => store.dispose();
	}, [enabled, icon, label, onClick, secondary, title]);
	return <span className={`agent-host-chat-button${icon ? ' agent-host-chat-icon-button' : ''}`} ref={containerRef} />;
}

interface VSCodeInputBoxProps {
	readonly ariaLabel: string;
	readonly enabled: boolean;
	readonly instantiationService: IInstantiationService;
	readonly contextViewService: IContextViewService;
	readonly max?: number;
	readonly maxLength?: number;
	readonly min?: number;
	readonly minLength?: number;
	readonly placeholder?: string;
	readonly step?: number;
	readonly type?: string;
	readonly value: string;
	readonly validationMessage?: (value: string) => string | undefined;
	readonly onChange: (value: string) => void;
}

function VSCodeInputBox({ ariaLabel, enabled, instantiationService, contextViewService, max, maxLength, min, minLength, placeholder, step, type, value, validationMessage, onChange }: VSCodeInputBoxProps): React.JSX.Element {
	const containerRef = React.useRef<HTMLDivElement>(null);
	const inputRef = React.useRef<InputBox>();
	const onChangeRef = React.useRef(onChange);
	onChangeRef.current = onChange;

	React.useEffect(() => {
		const container = containerRef.current;
		if (!container) {
			return;
		}
		const store = new DisposableStore();
		const input = store.add(instantiationService.createInstance(InputBox, container, contextViewService, {
			ariaLabel,
			placeholder,
			type,
			inputBoxStyles: defaultInputBoxStyles,
			validationOptions: validationMessage ? {
				validation: value => {
					const message = validationMessage(value);
					return message ? { content: message, type: MessageType.ERROR } : null;
				},
			} : undefined,
		}));
		inputRef.current = input;
		if (min !== undefined) {
			input.inputElement.min = String(min);
		}
		if (max !== undefined) {
			input.inputElement.max = String(max);
		}
		if (minLength !== undefined) {
			input.inputElement.minLength = minLength;
		}
		if (maxLength !== undefined) {
			input.inputElement.maxLength = maxLength;
		}
		if (step !== undefined) {
			input.inputElement.step = String(step);
		}
		input.value = value;
		input.setEnabled(enabled);
		store.add(input.onDidChange(newValue => onChangeRef.current(newValue)));
		return () => {
			inputRef.current = undefined;
			store.dispose();
		};
	}, [ariaLabel, contextViewService, instantiationService, max, maxLength, min, minLength, placeholder, step, type, validationMessage]);

	React.useEffect(() => {
		const input = inputRef.current;
		if (input && !input.hasFocus() && input.value !== value) {
			input.value = value;
		}
	}, [value]);

	React.useEffect(() => inputRef.current?.setEnabled(enabled), [enabled]);

	return <div className="agent-host-chat-input-box" ref={containerRef} />;
}

interface VSCodeSelectBoxProps {
	readonly ariaLabel: string;
	readonly enabled: boolean;
	readonly instantiationService: IInstantiationService;
	readonly contextViewService: IContextViewService;
	readonly options: readonly { readonly id: string; readonly label: string }[];
	readonly placeholder: string;
	readonly value: string | undefined;
	readonly onChange: (value: string) => void;
}

function VSCodeSelectBox({ ariaLabel, enabled, instantiationService, contextViewService, options, placeholder, value, onChange }: VSCodeSelectBoxProps): React.JSX.Element {
	const containerRef = React.useRef<HTMLDivElement>(null);
	const selectRef = React.useRef<SelectBox>();
	const onChangeRef = React.useRef(onChange);
	onChangeRef.current = onChange;
	const optionsKey = options.map(option => `${option.id}\0${option.label}`).join('\0');
	const selectedIndex = Math.max(0, options.findIndex(option => option.id === value) + 1);

	React.useEffect(() => {
		const container = containerRef.current;
		if (!container) {
			return;
		}
		const store = new DisposableStore();
		const selectOptions: ISelectOptionItem[] = [
			{ text: placeholder, isDisabled: true },
			...options.map(option => ({ text: option.label })),
		];
		const select = store.add(instantiationService.createInstance(
			SelectBox,
			selectOptions,
			selectedIndex,
			contextViewService,
			defaultSelectBoxStyles,
			{ ariaLabel, useCustomDrawn: true },
		));
		selectRef.current = select;
		select.render(container);
		select.setEnabled(enabled);
		store.add(select.onDidSelect(event => {
			const option = options[event.index - 1];
			if (option) {
				onChangeRef.current(option.id);
			}
		}));
		return () => {
			selectRef.current = undefined;
			store.dispose();
		};
	}, [ariaLabel, contextViewService, instantiationService, optionsKey, placeholder]);

	React.useEffect(() => selectRef.current?.select(selectedIndex), [selectedIndex]);
	React.useEffect(() => selectRef.current?.setEnabled(enabled), [enabled]);

	return <div className="agent-host-chat-select-box" ref={containerRef} />;
}

interface VSCodeCheckboxProps {
	readonly ariaLabel?: string;
	readonly checked: boolean;
	readonly enabled: boolean;
	readonly instantiationService: IInstantiationService;
	readonly label: string;
	readonly required?: boolean;
	readonly onChange: (checked: boolean) => void;
}

function VSCodeCheckbox({ ariaLabel, checked, enabled, instantiationService, label, required, onChange }: VSCodeCheckboxProps): React.JSX.Element {
	const containerRef = React.useRef<HTMLSpanElement>(null);
	const checkboxRef = React.useRef<Checkbox>();
	const onChangeRef = React.useRef(onChange);
	onChangeRef.current = onChange;

	React.useEffect(() => {
		const container = containerRef.current;
		if (!container) {
			return;
		}
		const store = new DisposableStore();
		const checkbox = store.add(instantiationService.createInstance(Checkbox, ariaLabel ?? label, checked, { ...defaultCheckboxStyles, size: 16 }));
		checkboxRef.current = checkbox;
		container.appendChild(checkbox.domNode);
		if (!enabled) {
			checkbox.disable();
		}
		store.add(checkbox.onChange(() => onChangeRef.current(checkbox.checked)));
		return () => {
			checkboxRef.current = undefined;
			store.dispose();
		};
	}, [ariaLabel, instantiationService, label]);

	React.useEffect(() => {
		const checkbox = checkboxRef.current;
		if (checkbox && checkbox.checked !== checked) {
			checkbox.checked = checked;
		}
	}, [checked]);

	React.useEffect(() => {
		if (enabled) {
			checkboxRef.current?.enable();
		} else {
			checkboxRef.current?.disable();
		}
	}, [enabled]);

	const toggleFromLabel = React.useCallback(() => {
		const checkbox = checkboxRef.current;
		if (!checkbox || !enabled) {
			return;
		}
		checkbox.checked = !checkbox.checked;
		onChangeRef.current(checkbox.checked);
	}, [enabled]);

	return <span className={`agent-host-chat-checkbox-row${enabled ? '' : ' disabled'}`}>
		<span className="agent-host-chat-checkbox" ref={containerRef} />
		<span className="agent-host-chat-checkbox-label" onClick={toggleFromLabel}>
			{label}{required && <span className="agent-host-chat-required" aria-hidden="true"> *</span>}
		</span>
	</span>;
}

function Markdown({ content, renderer }: { readonly content: string; readonly renderer: ChatContentMarkdownRenderer }): React.JSX.Element {
	const containerRef = React.useRef<HTMLDivElement>(null);
	React.useLayoutEffect(() => {
		const container = containerRef.current;
		if (!container) {
			return;
		}
		const rendered = renderer.render({ value: content });
		container.replaceChildren(rendered.element);
		return () => rendered.dispose();
	}, [content, renderer]);
	return <div className="agent-host-chat-markdown" ref={containerRef} />;
}

function stringify(content: StringOrMarkdown | undefined): string {
	return typeof content === 'string' ? content : content?.markdown ?? '';
}

function toolCallStatusLabel(toolCall: Extract<ResponsePart, { kind: ResponsePartKind.ToolCall }>['toolCall']): string {
	switch (toolCall.status) {
		case ToolCallStatus.Streaming:
			return localize('agentHostChat.tool.preparing', "Preparing");
		case ToolCallStatus.PendingConfirmation:
			return localize('agentHostChat.tool.approvalRequired', "Approval Required");
		case ToolCallStatus.Running:
			return localize('agentHostChat.tool.running', "Running");
		case ToolCallStatus.AuthRequired:
			return localize('agentHostChat.tool.authenticationRequired', "Authentication Required");
		case ToolCallStatus.PendingResultConfirmation:
			return localize('agentHostChat.tool.reviewRequired', "Review Required");
		case ToolCallStatus.Completed:
			return toolCall.success
				? localize('agentHostChat.tool.completed', "Completed")
				: localize('agentHostChat.tool.failed', "Failed");
		case ToolCallStatus.Cancelled:
			return localize('agentHostChat.tool.cancelled', "Cancelled");
		default:
			return localize('agentHostChat.tool.inProgress', "In Progress");
	}
}

function toolCallIcon(toolCall: Extract<ResponsePart, { kind: ResponsePartKind.ToolCall }>['toolCall']): ThemeIcon {
	if (toolCall.status === ToolCallStatus.Streaming || toolCall.status === ToolCallStatus.Running) {
		return ThemeIcon.modify(Codicon.loading, 'spin');
	}
	if (toolCall.status === ToolCallStatus.Cancelled) {
		return Codicon.circleSlash;
	}
	if (toolCall.status === ToolCallStatus.Completed && !toolCall.success) {
		return Codicon.error;
	}

	const identity = `${toolCall.toolName} ${toolCall.displayName}`.toLowerCase();
	if (identity.includes('terminal') || identity.includes('command')) {
		return Codicon.terminal;
	}
	if (identity.includes('search') || identity.includes('find')) {
		return Codicon.search;
	}
	if (identity.includes('edit') || identity.includes('patch') || identity.includes('write')) {
		return Codicon.edit;
	}
	if (identity.includes('test')) {
		return Codicon.beaker;
	}
	if (identity.includes('browser')) {
		return Codicon.globe;
	}
	return Codicon.tools;
}

function isBlockingResponsePart(part: ResponsePart): boolean {
	return (part.kind === ResponsePartKind.ToolCall
		&& (part.toolCall.status === ToolCallStatus.PendingConfirmation || part.toolCall.status === ToolCallStatus.PendingResultConfirmation))
		|| (part.kind === ResponsePartKind.InputRequest && part.response === undefined);
}

function blockingResponseParts(chat: ChatState): readonly ResponsePart[] {
	return chat.activeTurn?.responseParts.filter(isBlockingResponsePart) ?? [];
}

function hasBlockingPrompt(chat: ChatState): boolean {
	return (chat.interactivity === undefined || chat.interactivity === ChatInteractivity.Full)
		&& blockingResponseParts(chat).length > 0;
}

function ToolCallPart({ part, turnId, client, markdownRenderer, canInteract }: { readonly part: Extract<ResponsePart, { kind: ResponsePartKind.ToolCall }>; readonly turnId: string; readonly client: IAgentHostChatClient; readonly markdownRenderer: ChatContentMarkdownRenderer; readonly canInteract: boolean }): React.JSX.Element {
	const toolCall = part.toolCall;
	const message = 'pastTenseMessage' in toolCall ? toolCall.pastTenseMessage : toolCall.invocationMessage;
	const visualStatus = toolCall.status === ToolCallStatus.Completed && !toolCall.success ? 'failed' : toolCall.status;
	const confirm = React.useCallback((approved: boolean, selectedOptionId?: string) => {
		client.confirmToolCall(turnId, toolCall.toolCallId, approved, selectedOptionId);
	}, [client, toolCall.toolCallId, turnId]);
	const confirmResult = React.useCallback((approved: boolean) => {
		client.confirmToolResult(turnId, toolCall.toolCallId, approved);
	}, [client, toolCall.toolCallId, turnId]);
	const isConfirmation = toolCall.status === ToolCallStatus.PendingConfirmation || toolCall.status === ToolCallStatus.PendingResultConfirmation;

	if (!isConfirmation) {
		const label = localize('agentHostChat.toolProgressLabel', "{0}: {1}", toolCall.displayName, toolCallStatusLabel(toolCall));
		return (
			<div className="agent-host-chat-tool-progress" data-status={visualStatus} role="group" aria-label={label}>
				<span className={ThemeIcon.asClassName(toolCallIcon(toolCall))} aria-hidden="true" />
				<div className="agent-host-chat-tool-progress-content">
					<span className="agent-host-chat-tool-name">{toolCall.displayName}</span>
					{message && <Markdown content={stringify(message)} renderer={markdownRenderer} />}
					{'error' in toolCall && toolCall.error && <div className="agent-host-chat-tool-error">{toolCall.error.message}</div>}
				</div>
			</div>
		);
	}

	return (
		<div className="agent-host-chat-tool-confirmation" role="group" aria-label={toolCall.displayName}>
			<div className="agent-host-chat-tool-header">
				<div className="agent-host-chat-tool-title">
					<span className={ThemeIcon.asClassName(Codicon.tools)} aria-hidden="true" />
					<span className="agent-host-chat-tool-heading">{toolCall.displayName}</span>
				</div>
				<div className="agent-host-chat-tool-status" data-status={visualStatus}>{toolCallStatusLabel(toolCall)}</div>
			</div>
			<div className="agent-host-chat-confirmation-body">
				{message && <Markdown content={stringify(message)} renderer={markdownRenderer} />}
				{toolCall.intention && <div className="agent-host-chat-secondary">{toolCall.intention}</div>}
			</div>
			{canInteract && toolCall.status === ToolCallStatus.PendingConfirmation && (
				<div className="agent-host-chat-actions">
					{toolCall.options?.length ? toolCall.options.map(option => (
						<VSCodeButton
							key={option.id}
							label={option.label}
							secondary={option.kind !== 'approve'}
							onClick={() => confirm(option.kind === 'approve', option.id)}
						/>
					)) : <>
						<VSCodeButton label={localize('agentHostChat.allow', "Allow")} onClick={() => confirm(true)} />
						<VSCodeButton label={localize('agentHostChat.deny', "Deny")} secondary onClick={() => confirm(false)} />
					</>}
				</div>
			)}
			{canInteract && toolCall.status === ToolCallStatus.PendingResultConfirmation && (
				<div className="agent-host-chat-actions">
					<VSCodeButton label={localize('agentHostChat.acceptResult', "Accept")} onClick={() => confirmResult(true)} />
					<VSCodeButton label={localize('agentHostChat.rejectResult', "Reject")} secondary onClick={() => confirmResult(false)} />
				</div>
			)}
		</div>
	);
}

function answerForQuestion(question: ChatInputQuestion, value: string | boolean | string[]): ChatInputAnswer | undefined {
	switch (question.kind) {
		case ChatInputQuestionKind.Boolean:
			return { state: ChatInputAnswerState.Draft, value: { kind: ChatInputAnswerValueKind.Boolean, value: Boolean(value) } };
		case ChatInputQuestionKind.Number:
		case ChatInputQuestionKind.Integer:
			if (value === '') {
				return undefined;
			}
			return { state: ChatInputAnswerState.Draft, value: { kind: ChatInputAnswerValueKind.Number, value: Number(value) } };
		case ChatInputQuestionKind.SingleSelect:
			return { state: ChatInputAnswerState.Draft, value: { kind: ChatInputAnswerValueKind.Selected, value: String(value) } };
		case ChatInputQuestionKind.MultiSelect:
			return { state: ChatInputAnswerState.Draft, value: { kind: ChatInputAnswerValueKind.SelectedMany, value: Array.isArray(value) ? value : [String(value)] } };
		default:
			return { state: ChatInputAnswerState.Draft, value: { kind: ChatInputAnswerValueKind.Text, value: String(value) } };
	}
}

function defaultAnswerForQuestion(question: ChatInputQuestion): ChatInputAnswer | undefined {
	switch (question.kind) {
		case ChatInputQuestionKind.Text:
			return question.defaultValue === undefined ? undefined : answerForQuestion(question, question.defaultValue);
		case ChatInputQuestionKind.Number:
		case ChatInputQuestionKind.Integer:
			return question.defaultValue === undefined ? undefined : answerForQuestion(question, String(question.defaultValue));
		case ChatInputQuestionKind.Boolean:
			return answerForQuestion(question, question.defaultValue ?? false);
		case ChatInputQuestionKind.SingleSelect: {
			const recommended = question.options.find(option => option.recommended);
			return recommended ? answerForQuestion(question, recommended.id) : undefined;
		}
		case ChatInputQuestionKind.MultiSelect:
			return answerForQuestion(question, question.options.filter(option => option.recommended).map(option => option.id));
	}
}

function selectedAnswerForQuestion(question: Extract<ChatInputQuestion, { kind: ChatInputQuestionKind.SingleSelect | ChatInputQuestionKind.MultiSelect }>, value: string | string[], freeformValue: string): ChatInputAnswer {
	const freeformValues = freeformValue ? [freeformValue] : undefined;
	return question.kind === ChatInputQuestionKind.SingleSelect
		? {
			state: ChatInputAnswerState.Draft,
			value: { kind: ChatInputAnswerValueKind.Selected, value: String(value), freeformValues },
		}
		: {
			state: ChatInputAnswerState.Draft,
			value: { kind: ChatInputAnswerValueKind.SelectedMany, value: Array.isArray(value) ? value : [value], freeformValues },
		};
}

function answerForRequestQuestion(request: ChatInputRequest, question: ChatInputQuestion): ChatInputAnswer | undefined {
	return request.answers?.[question.id] ?? defaultAnswerForQuestion(question);
}

function freeformValueForQuestion(request: ChatInputRequest, question: ChatInputQuestion): string {
	const answer = answerForRequestQuestion(request, question);
	if (!answer || answer.state === ChatInputAnswerState.Skipped) {
		return '';
	}
	return answer.value.kind === ChatInputAnswerValueKind.Selected || answer.value.kind === ChatInputAnswerValueKind.SelectedMany
		? answer.value.freeformValues?.[0] ?? ''
		: '';
}

function valueForQuestion(request: ChatInputRequest, question: ChatInputQuestion): string | boolean | string[] {
	const answer = answerForRequestQuestion(request, question);
	if (answer && answer.state !== ChatInputAnswerState.Skipped) {
		switch (answer.value.kind) {
			case ChatInputAnswerValueKind.Text:
			case ChatInputAnswerValueKind.Selected:
				return answer.value.value;
			case ChatInputAnswerValueKind.Number:
				return String(answer.value.value);
			case ChatInputAnswerValueKind.Boolean:
				return answer.value.value;
			case ChatInputAnswerValueKind.SelectedMany:
				return answer.value.value;
		}
	}

	switch (question.kind) {
		case ChatInputQuestionKind.Text:
		case ChatInputQuestionKind.Number:
		case ChatInputQuestionKind.Integer:
		case ChatInputQuestionKind.SingleSelect:
			return '';
		case ChatInputQuestionKind.Boolean:
			return false;
		case ChatInputQuestionKind.MultiSelect:
			return [];
	}
}

function validateQuestionAnswer(question: ChatInputQuestion, answer: ChatInputAnswer | undefined): string | undefined {
	if (!answer || answer.state === ChatInputAnswerState.Skipped) {
		return question.required ? localize('agentHostChat.inputFieldRequired', "This field is required") : undefined;
	}

	switch (question.kind) {
		case ChatInputQuestionKind.Text: {
			const value = answer.value.kind === ChatInputAnswerValueKind.Text ? answer.value.value : '';
			if (question.required && !value) {
				return localize('agentHostChat.inputFieldRequired', "This field is required");
			}
			if (question.min !== undefined && value.length < question.min) {
				return localize('agentHostChat.inputMinLength', "Minimum length is {0}", question.min);
			}
			if (question.max !== undefined && value.length > question.max) {
				return localize('agentHostChat.inputMaxLength', "Maximum length is {0}", question.max);
			}
			switch (question.format) {
				case 'email':
					if (value && !value.includes('@')) {
						return localize('agentHostChat.inputEmail', "Enter a valid email address");
					}
					break;
				case 'uri':
					if (value && !URL.canParse(value)) {
						return localize('agentHostChat.inputUri', "Enter a valid URI");
					}
					break;
				case 'date':
					if (value && (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(new Date(value).getTime()))) {
						return localize('agentHostChat.inputDate', "Enter a valid date");
					}
					break;
				case 'date-time':
					if (value && Number.isNaN(new Date(value).getTime())) {
						return localize('agentHostChat.inputDateTime', "Enter a valid date and time");
					}
					break;
			}
			return undefined;
		}
		case ChatInputQuestionKind.Number:
		case ChatInputQuestionKind.Integer: {
			const value = answer.value.kind === ChatInputAnswerValueKind.Number ? answer.value.value : Number.NaN;
			if (!Number.isFinite(value)) {
				return localize('agentHostChat.inputNumber', "Enter a valid number");
			}
			if (question.kind === ChatInputQuestionKind.Integer && !Number.isInteger(value)) {
				return localize('agentHostChat.inputInteger', "Enter a valid integer");
			}
			if (question.min !== undefined && value < question.min) {
				return localize('agentHostChat.inputMinimum', "Minimum value is {0}", question.min);
			}
			if (question.max !== undefined && value > question.max) {
				return localize('agentHostChat.inputMaximum', "Maximum value is {0}", question.max);
			}
			return undefined;
		}
		case ChatInputQuestionKind.Boolean:
			return undefined;
		case ChatInputQuestionKind.SingleSelect: {
			const value = answer.value.kind === ChatInputAnswerValueKind.Selected ? answer.value.value : '';
			const hasFreeformValue = question.allowFreeformInput && answer.value.kind === ChatInputAnswerValueKind.Selected && answer.value.freeformValues?.some(value => !!value);
			const hasValidSelection = question.options.some(option => option.id === value);
			return question.required && !hasValidSelection && !hasFreeformValue ? localize('agentHostChat.inputFieldRequired', "This field is required") : undefined;
		}
		case ChatInputQuestionKind.MultiSelect: {
			const values = answer.value.kind === ChatInputAnswerValueKind.SelectedMany ? answer.value.value : [];
			const freeformCount = question.allowFreeformInput && answer.value.kind === ChatInputAnswerValueKind.SelectedMany ? answer.value.freeformValues?.filter(value => !!value).length ?? 0 : 0;
			const valueCount = values.length + freeformCount;
			if (question.required && valueCount === 0) {
				return localize('agentHostChat.inputFieldRequired', "This field is required");
			}
			if (question.min !== undefined && valueCount < question.min) {
				return localize('agentHostChat.inputMinSelections', "Select at least {0}", question.min);
			}
			if (question.max !== undefined && valueCount > question.max) {
				return localize('agentHostChat.inputMaxSelections', "Select no more than {0}", question.max);
			}
			return undefined;
		}
	}
}

function submittedAnswers(request: ChatInputRequest): Readonly<Record<string, ChatInputAnswer>> {
	const answers: Record<string, ChatInputAnswer> = {};
	for (const question of request.questions ?? []) {
		const answer = answerForRequestQuestion(request, question);
		if (answer) {
			answers[question.id] = answer.state === ChatInputAnswerState.Skipped
				? answer
				: { ...answer, state: ChatInputAnswerState.Submitted };
		}
	}
	return answers;
}

function inputAnswerText(request: ChatInputRequest, question: ChatInputQuestion): string {
	const answer = answerForRequestQuestion(request, question);
	if (!answer) {
		return localize('agentHostChat.accessible.unanswered', "Unanswered");
	}
	if (answer.state === ChatInputAnswerState.Skipped) {
		return localize('agentHostChat.accessible.skipped', "Skipped");
	}
	switch (answer.value.kind) {
		case ChatInputAnswerValueKind.Text:
		case ChatInputAnswerValueKind.Selected:
			return [answer.value.value, ...(answer.value.kind === ChatInputAnswerValueKind.Selected ? answer.value.freeformValues ?? [] : [])].filter(value => !!value).join(', ');
		case ChatInputAnswerValueKind.Number:
		case ChatInputAnswerValueKind.Boolean:
			return String(answer.value.value);
		case ChatInputAnswerValueKind.SelectedMany:
			return [...answer.value.value, ...(answer.value.freeformValues ?? [])].filter(value => !!value).join(', ');
	}
}

function accessibleResponsePartLines(part: ResponsePart): readonly string[] {
	const kind: string = part.kind;
	switch (part.kind) {
		case ResponsePartKind.Markdown:
			return [stringify(part.content)];
		case ResponsePartKind.Reasoning:
			return [localize('agentHostChat.accessible.reasoning', "Reasoning:"), stringify(part.content)];
		case ResponsePartKind.ToolCall: {
			const message = part.toolCall.status === ToolCallStatus.Completed ? part.toolCall.pastTenseMessage : part.toolCall.invocationMessage;
			return [
				localize('agentHostChat.accessible.tool', "Tool: {0} ({1})", part.toolCall.displayName, toolCallStatusLabel(part.toolCall)),
				...(message ? [stringify(message)] : []),
				...('error' in part.toolCall && part.toolCall.error ? [part.toolCall.error.message] : []),
			];
		}
		case ResponsePartKind.InputRequest:
			return [
				part.response
					? localize('agentHostChat.accessible.inputComplete', "Input request: {0}", part.response)
					: localize('agentHostChat.accessible.inputPending', "Input requested"),
				...(part.request.message ? [part.request.message] : []),
				...(part.request.questions ?? []).map(question => localize(
					'agentHostChat.accessible.questionAnswer',
					"{0}: {1}",
					question.title ?? question.message,
					inputAnswerText(part.request, question),
				)),
			];
		case ResponsePartKind.Error:
			return [localize('agentHostChat.accessible.error', "Error: {0}", part.error.message)];
		case ResponsePartKind.SystemNotification:
			return [localize('agentHostChat.accessible.notification', "Notification: {0}", stringify(part.content))];
		case ResponsePartKind.ContentRef:
			return [localize('agentHostChat.accessible.externalContent', "Referenced external content")];
		default:
			return [localize('agentHostChat.accessible.unsupported', "Unsupported response type: {0}", kind)];
	}
}

function accessibleTurnLines(turn: Pick<Turn, 'message' | 'responseParts'>): readonly string[] {
	return [
		localize('agentHostChat.accessible.you', "You:"),
		turn.message.text,
		localize('agentHostChat.accessible.agent', "Agent:"),
		...turn.responseParts.flatMap(accessibleResponsePartLines),
		'',
	];
}

function buildAccessibleChatContent(chat: ChatState): string {
	return [
		chat.title,
		'',
		...chat.turns.flatMap(accessibleTurnLines),
		...(chat.activeTurn ? accessibleTurnLines(chat.activeTurn) : []),
		...(chat.queuedMessages?.flatMap(message => [
			localize('agentHostChat.accessible.queued', "Queued:"),
			message.message.text,
			'',
		]) ?? []),
	].join('\n').trimEnd();
}

function InputQuestion({ request, question, client, canInteract, instantiationService, contextViewService, showValidation }: { readonly request: ChatInputRequest; readonly question: ChatInputQuestion; readonly client: IAgentHostChatClient; readonly canInteract: boolean; readonly instantiationService: IInstantiationService; readonly contextViewService: IContextViewService; readonly showValidation: boolean }): React.JSX.Element {
	const update = (value: string | boolean | string[]) => client.setInputAnswer(request.id, question.id, answerForQuestion(question, value));
	const id = `agent-host-input-${request.id}-${question.id}`;
	const value = valueForQuestion(request, question);
	const freeformValue = freeformValueForQuestion(request, question);
	const validationMessage = showValidation ? validateQuestionAnswer(question, answerForRequestQuestion(request, question)) : undefined;
	const label = question.title ?? question.message;
	const ariaLabel = question.required ? localize('agentHostChat.requiredAriaLabel', "{0}, required", label) : label;
	const validateInput = React.useCallback((input: string) => validateQuestionAnswer(question, answerForQuestion(question, input)), [question]);
	let control: React.JSX.Element;
	switch (question.kind) {
		case ChatInputQuestionKind.Boolean:
			control = <VSCodeCheckbox ariaLabel={ariaLabel} checked={Boolean(value)} enabled={canInteract} instantiationService={instantiationService} label={label} required={question.required} onChange={update} />;
			break;
		case ChatInputQuestionKind.SingleSelect:
			control = <div className="agent-host-chat-select-controls">
				<VSCodeSelectBox
					ariaLabel={ariaLabel}
					enabled={canInteract}
					instantiationService={instantiationService}
					contextViewService={contextViewService}
					options={question.options}
					placeholder={localize('agentHostChat.chooseOption', "Choose an option")}
					value={typeof value === 'string' && value ? value : undefined}
					onChange={selected => client.setInputAnswer(request.id, question.id, selectedAnswerForQuestion(question, selected, freeformValue))}
				/>
				{question.allowFreeformInput && <VSCodeInputBox
					ariaLabel={localize('agentHostChat.customAnswerAriaLabel', "Custom answer for {0}", label)}
					enabled={canInteract}
					instantiationService={instantiationService}
					contextViewService={contextViewService}
					placeholder={localize('agentHostChat.customAnswer', "Or enter a custom answer")}
					value={freeformValue}
					onChange={customValue => client.setInputAnswer(request.id, question.id, selectedAnswerForQuestion(question, typeof value === 'string' ? value : '', customValue))}
				/>}
			</div>;
			break;
		case ChatInputQuestionKind.MultiSelect:
			control = <div className="agent-host-chat-multi-select" role="group" aria-labelledby={id}>
				{question.options.map(option => {
					const selected = Array.isArray(value) && value.includes(option.id);
					return <VSCodeCheckbox
						key={option.id}
						checked={selected}
						enabled={canInteract}
						instantiationService={instantiationService}
						label={option.label}
						onChange={checked => client.setInputAnswer(request.id, question.id, selectedAnswerForQuestion(
							question,
							checked
								? [...(Array.isArray(value) ? value : []), option.id]
								: (Array.isArray(value) ? value : []).filter(id => id !== option.id),
							freeformValue,
						))}
					/>;
				})}
				{question.allowFreeformInput && <VSCodeInputBox
					ariaLabel={localize('agentHostChat.customAnswerAriaLabel', "Custom answer for {0}", label)}
					enabled={canInteract}
					instantiationService={instantiationService}
					contextViewService={contextViewService}
					placeholder={localize('agentHostChat.customAnswer', "Or enter a custom answer")}
					value={freeformValue}
					onChange={customValue => client.setInputAnswer(request.id, question.id, selectedAnswerForQuestion(question, Array.isArray(value) ? value : [], customValue))}
				/>}
			</div>;
			break;
		case ChatInputQuestionKind.Number:
		case ChatInputQuestionKind.Integer:
			control = <VSCodeInputBox ariaLabel={ariaLabel} enabled={canInteract} instantiationService={instantiationService} contextViewService={contextViewService} min={question.min} max={question.max} step={question.kind === ChatInputQuestionKind.Integer ? 1 : undefined} type="number" value={String(value)} validationMessage={showValidation ? validateInput : undefined} onChange={update} />;
			break;
		default:
			control = <VSCodeInputBox ariaLabel={ariaLabel} enabled={canInteract} instantiationService={instantiationService} contextViewService={contextViewService} minLength={question.min} maxLength={question.max} type={question.format === 'uri' ? 'url' : question.format === 'date-time' ? 'datetime-local' : question.format} value={String(value)} validationMessage={showValidation ? validateInput : undefined} onChange={update} />;
			break;
	}
	if (question.kind === ChatInputQuestionKind.Boolean) {
		return (
			<div className="agent-host-chat-question agent-host-chat-boolean-question" data-invalid={validationMessage ? 'true' : undefined}>
				{control}
				{question.title && <div className="agent-host-chat-secondary">{question.message}</div>}
				{validationMessage && <div className="agent-host-chat-validation" role="alert">{validationMessage}</div>}
			</div>
		);
	}
	return (
		<div className="agent-host-chat-question" data-invalid={validationMessage ? 'true' : undefined}>
			<div id={id} className="agent-host-chat-question-label">{label}{question.required && <span className="agent-host-chat-required" aria-hidden="true"> *</span>}</div>
			{question.title && <div className="agent-host-chat-secondary">{question.message}</div>}
			{control}
			{validationMessage && <div className="agent-host-chat-validation" role="alert">{validationMessage}</div>}
		</div>
	);
}

function InputRequestPart({ request, response, client, canInteract, instantiationService, contextViewService }: { readonly request: ChatInputRequest; readonly response: ChatInputResponseKind | undefined; readonly client: IAgentHostChatClient; readonly canInteract: boolean; readonly instantiationService: IInstantiationService; readonly contextViewService: IContextViewService }): React.JSX.Element {
	const [showValidation, setShowValidation] = React.useState(false);
	const requestRef = React.useRef<HTMLDivElement>(null);
	const validationMessages = React.useMemo(
		() => (request.questions ?? []).map(question => validateQuestionAnswer(question, answerForRequestQuestion(request, question))).filter(message => message !== undefined),
		[request],
	);
	const accept = React.useCallback(() => {
		const firstValidationMessage = validationMessages[0];
		if (firstValidationMessage) {
			setShowValidation(true);
			status(firstValidationMessage);
			return;
		}
		client.completeInput(request.id, ChatInputResponseKind.Accept, submittedAnswers(request));
	}, [client, request, validationMessages]);
	const decline = React.useCallback(() => client.completeInput(request.id, ChatInputResponseKind.Decline), [client, request.id]);
	React.useEffect(() => {
		if (!showValidation) {
			return;
		}
		requestRef.current?.querySelector<HTMLElement>('[data-invalid="true"] input, [data-invalid="true"] [role="checkbox"], [data-invalid="true"] .monaco-select-box')?.focus();
	}, [showValidation]);
	if (response) {
		const result = response === ChatInputResponseKind.Accept
			? { icon: Codicon.check, label: localize('agentHostChat.inputProvided', "Input Provided") }
			: response === ChatInputResponseKind.Decline
				? { icon: Codicon.close, label: localize('agentHostChat.inputDeclined', "Input Declined") }
				: { icon: Codicon.circleSlash, label: localize('agentHostChat.inputCancelled', "Input Cancelled") };
		return <div className="agent-host-chat-input-result">
			<span className={ThemeIcon.asClassName(result.icon)} aria-hidden="true" />
			<span>{result.label}</span>
		</div>;
	}
	return (
		<div className="agent-host-chat-input-request" ref={requestRef} role="group" aria-label={localize('agentHostChat.inputRequest', "Agent input request")}>
			{request.message && <div className="agent-host-chat-tool-heading">{request.message}</div>}
			<div className="agent-host-chat-input-request-body">
				{request.questions?.map(question => <InputQuestion key={question.id} request={request} question={question} client={client} canInteract={canInteract} instantiationService={instantiationService} contextViewService={contextViewService} showValidation={showValidation} />)}
			</div>
			{canInteract && <div className="agent-host-chat-actions">
				<VSCodeButton label={localize('agentHostChat.continue', "Continue")} onClick={accept} />
				<VSCodeButton label={localize('agentHostChat.decline', "Decline")} secondary onClick={decline} />
			</div>}
		</div>
	);
}

function ResponseParts({ parts, turnId, client, markdownRenderer, instantiationService, contextViewService, canInteract, deferredParts = [] }: { readonly parts: readonly ResponsePart[]; readonly turnId: string; readonly client: IAgentHostChatClient; readonly markdownRenderer: ChatContentMarkdownRenderer; readonly instantiationService: IInstantiationService; readonly contextViewService: IContextViewService; readonly canInteract: boolean; readonly deferredParts?: readonly ResponsePart[] }): React.JSX.Element {
	return <>
		{parts.map((part, index) => {
			const kind: string = part.kind;
			if (deferredParts.includes(part)) {
				if (part !== deferredParts[deferredParts.length - 1]) {
					return null;
				}
				const label = deferredParts.length > 1
					? localize('agentHostChat.requestsPending', "{0} requests pending", deferredParts.length)
					: part.kind === ResponsePartKind.ToolCall
						? localize('agentHostChat.confirmationPending', "1 confirmation pending")
						: localize('agentHostChat.inputPending', "Input requested");
				return <div key={index} className="agent-host-chat-deferred-prompt">{label}</div>;
			}
			switch (part.kind) {
				case ResponsePartKind.Markdown:
					return <Markdown key={part.id} content={part.content} renderer={markdownRenderer} />;
				case ResponsePartKind.Reasoning:
					return <details key={part.id} className="agent-host-chat-reasoning"><summary>{localize('agentHostChat.reasoning', "Reasoning")}</summary><Markdown content={part.content} renderer={markdownRenderer} /></details>;
				case ResponsePartKind.ToolCall:
					return <ToolCallPart key={part.toolCall.toolCallId} part={part} turnId={turnId} client={client} markdownRenderer={markdownRenderer} canInteract={canInteract} />;
				case ResponsePartKind.InputRequest:
					return <InputRequestPart key={part.request.id} request={part.request} response={part.response} client={client} canInteract={canInteract} instantiationService={instantiationService} contextViewService={contextViewService} />;
				case ResponsePartKind.Error:
					return <div key={index} className="agent-host-chat-error">
						<div>{part.error.message}</div>
						{canInteract && part.resumable && <VSCodeButton label={localize('agentHostChat.resume', "Resume")} secondary onClick={() => client.resume(turnId)} />}
					</div>;
				case ResponsePartKind.SystemNotification:
					return <div key={index} className="agent-host-chat-notification">{stringify(part.content)}</div>;
				case ResponsePartKind.ContentRef:
					return <div key={index} className="agent-host-chat-secondary">{localize('agentHostChat.externalContent', "Referenced content")}</div>;
				default:
					return <div key={index} className="agent-host-chat-error">{localize('agentHostChat.unsupportedResponsePart', "Unsupported response type: {0}", kind)}</div>;
			}
		})}
	</>;
}

function TurnView({ turn, client, markdownRenderer, instantiationService, contextViewService, canInteract, deferredParts }: { readonly turn: Pick<Turn, 'id' | 'message' | 'responseParts'>; readonly client: IAgentHostChatClient; readonly markdownRenderer: ChatContentMarkdownRenderer; readonly instantiationService: IInstantiationService; readonly contextViewService: IContextViewService; readonly canInteract: boolean; readonly deferredParts?: readonly ResponsePart[] }): React.JSX.Element {
	return (
		<article className="agent-host-chat-turn" aria-label={localize('agentHostChat.turn', "Conversation turn")}>
			<section className="agent-host-chat-user-message" aria-label={localize('agentHostChat.you', "You")}>
				<div>{turn.message.text}</div>
				{turn.message.attachments?.map((attachment, index) => <div key={index} className="agent-host-chat-secondary">{attachment.label}</div>)}
			</section>
			<section className="agent-host-chat-response" aria-label={localize('agentHostChat.agent', "Agent")}>
				<ResponseParts parts={turn.responseParts} turnId={turn.id} client={client} markdownRenderer={markdownRenderer} instantiationService={instantiationService} contextViewService={contextViewService} canInteract={canInteract} deferredParts={deferredParts} />
			</section>
		</article>
	);
}

function BlockingPrompt({ part, turnId, client, markdownRenderer, instantiationService, contextViewService, onPromptCreated }: { readonly part: ResponsePart; readonly turnId: string; readonly client: IAgentHostChatClient; readonly markdownRenderer: ChatContentMarkdownRenderer; readonly instantiationService: IInstantiationService; readonly contextViewService: IContextViewService; readonly onPromptCreated: (prompt: HTMLElement | undefined) => void }): React.JSX.Element {
	const promptRef = React.useRef<HTMLDivElement>(null);
	React.useEffect(() => {
		const prompt = promptRef.current;
		if (!prompt) {
			return;
		}
		onPromptCreated(prompt);
		(prompt.querySelector<HTMLElement>(promptControlSelector) ?? prompt).focus();
		return () => {
			onPromptCreated(undefined);
		};
	}, [onPromptCreated]);
	return <div className="agent-host-chat-prompt" ref={promptRef} tabIndex={-1}>
		<ResponseParts parts={[part]} turnId={turnId} client={client} markdownRenderer={markdownRenderer} instantiationService={instantiationService} contextViewService={contextViewService} canInteract={true} />
	</div>;
}

function ModelPickerControl({ modelPicker }: { readonly modelPicker: AgentHostChatModelPicker }): React.JSX.Element {
	const containerRef = React.useRef<HTMLDivElement>(null);
	React.useEffect(() => {
		const container = containerRef.current;
		if (container) {
			modelPicker.render(container);
		}
	}, [modelPicker]);
	return <div className="agent-host-chat-model-picker" ref={containerRef} />;
}

function MonacoComposer({ client, chat, modelPicker, instantiationService, modelService, configurationService, onEditorCreated }: {
	readonly client: IAgentHostChatClient;
	readonly chat: ChatState;
	readonly modelPicker: AgentHostChatModelPicker | undefined;
	readonly instantiationService: IInstantiationService;
	readonly modelService: IModelService;
	readonly configurationService: IConfigurationService;
	readonly onEditorCreated: (editor: ICodeEditor | undefined) => void;
}): React.JSX.Element {
	const containerRef = React.useRef<HTMLDivElement>(null);
	const editorRef = React.useRef<ICodeEditor | undefined>(undefined);
	const latestDraftRef = React.useRef(chat.draft);
	latestDraftRef.current = chat.draft;
	const [hasText, setHasText] = React.useState(Boolean(chat.draft?.text.trim()));
	const [sendError, setSendError] = React.useState<string>();
	const canCompose = chat.interactivity === undefined || chat.interactivity === ChatInteractivity.Full;

	const submit = React.useCallback(async () => {
		const editor = editorRef.current;
		const value = editor?.getValue() ?? '';
		if (!value.trim()) {
			return;
		}
		try {
			setSendError(undefined);
			await client.send(value);
			editor?.setValue('');
			client.setDraft(undefined);
		} catch (error) {
			const message = getErrorMessage(error);
			setSendError(message);
			status(message);
		}
	}, [client]);

	React.useEffect(() => {
		const container = containerRef.current;
		if (!container) {
			return;
		}
		const store = new DisposableStore();
		const model = store.add(modelService.createModel(latestDraftRef.current?.text ?? '', null));
		const options: IEditorOptions = {
			...getSimpleEditorOptions(configurationService),
			ariaLabel: localize('agentHostChat.composerAriaLabel', "Chat message"),
			placeholder: localize('agentHostChat.composerPlaceholder', "Ask a question or describe a task"),
			readOnly: !canCompose,
			padding: { top: 8, bottom: 8 },
			fontSize: 13,
		};
		const editor = store.add(instantiationService.createInstance(CodeEditorWidget, container, options, getSimpleCodeEditorWidgetOptions()));
		editor.setModel(model);
		editorRef.current = editor;
		onEditorCreated(editor);
		const draftScheduler = store.add(new RunOnceScheduler(() => {
			const value = editor.getValue();
			const draft = latestDraftRef.current;
			client.setDraft(value
				? { ...(draft ?? createUserMessage('', undefined, undefined, undefined)), text: value }
				: undefined);
		}, 250));
		store.add(editor.onDidChangeModelContent(() => {
			const value = editor.getValue();
			setHasText(Boolean(value.trim()));
			draftScheduler.schedule();
		}));
		store.add(editor.onDidBlurEditorText(() => draftScheduler.flush()));
		store.add(editor.onKeyDown(event => {
			if (event.keyCode === KeyCode.Enter && !event.shiftKey && !event.browserEvent.isComposing) {
				event.preventDefault();
				event.stopPropagation();
				void submit();
			}
		}));
		const resizeObserver = new (getWindow(container).ResizeObserver)(() => editor.layout());
		resizeObserver.observe(container);
		store.add({ dispose: () => resizeObserver.disconnect() });
		editor.layout();
		return () => {
			draftScheduler.flush();
			onEditorCreated(undefined);
			editorRef.current = undefined;
			store.dispose();
		};
	}, [canCompose, client, configurationService, instantiationService, modelService, onEditorCreated, submit]);

	React.useEffect(() => {
		const editor = editorRef.current;
		const draftText = chat.draft?.text ?? '';
		if (editor && !editor.hasTextFocus() && editor.getValue() !== draftText) {
			editor.setValue(draftText);
		}
	}, [chat.draft?.text]);

	return (
		<div className="agent-host-chat-composer">
			<div className="agent-host-chat-input-container">
				<div className="agent-host-chat-editor" ref={containerRef} />
				{sendError && <div className="agent-host-chat-composer-error" role="alert">{sendError}</div>}
				<div className="agent-host-chat-composer-actions">
					{modelPicker && <ModelPickerControl modelPicker={modelPicker} />}
					{chat.activeTurn
						? <VSCodeButton label={localize('agentHostChat.stop', "Stop")} icon={Codicon.stopCircle} secondary onClick={() => client.cancel()} />
						: <VSCodeButton label={localize('agentHostChat.send', "Send")} icon={Codicon.arrowUpCompact} enabled={canCompose && hasText} onClick={() => void submit()} />}
				</div>
			</div>
		</div>
	);
}

function ReadyChat({ client, chat, ...props }: AgentHostChatAppProps & { readonly chat: ChatState }): React.JSX.Element {
	const scrollerRef = React.useRef<HTMLDivElement | null>(null);
	const stickToBottomRef = React.useRef(true);
	const [atTop, setAtTop] = React.useState(false);
	const [historyError, setHistoryError] = React.useState<string>();
	const screenReaderOptimized = useScreenReaderOptimized(props.accessibilityService);
	const canInteract = chat.interactivity === undefined || chat.interactivity === ChatInteractivity.Full;
	const deferredParts = canInteract ? blockingResponseParts(chat) : [];
	const blockingPart = deferredParts[deferredParts.length - 1];
	const virtualizer = useVirtualizer({
		count: screenReaderOptimized ? 0 : chat.turns.length,
		getScrollElement: () => scrollerRef.current,
		estimateSize: () => 240,
		overscan: 3,
	});
	const virtualItems = virtualizer.getVirtualItems();
	const setScroller = React.useCallback((element: HTMLDivElement | null) => {
		scrollerRef.current = element;
		props.onTranscriptCreated(element ?? undefined, canInteract);
	}, [canInteract, props.onTranscriptCreated]);
	const loadOlder = React.useCallback(async () => {
		const element = scrollerRef.current;
		const previousScrollHeight = element?.scrollHeight;
		const previousScrollTop = element?.scrollTop;
		try {
			setHistoryError(undefined);
			await client.loadOlderTurns();
			if (element && previousScrollHeight !== undefined && previousScrollTop !== undefined) {
				const targetWindow = getWindow(element);
				targetWindow.requestAnimationFrame(() => {
					element.scrollTop = previousScrollTop + element.scrollHeight - previousScrollHeight;
				});
			}
		} catch (error) {
			const message = getErrorMessage(error);
			setHistoryError(message);
			status(message);
		}
	}, [client]);

	React.useLayoutEffect(() => {
		const element = scrollerRef.current;
		if (!element) {
			return;
		}
		const targetWindow = getWindow(element);
		const handle = targetWindow.requestAnimationFrame(() => element.scrollTop = element.scrollHeight);
		return () => targetWindow.cancelAnimationFrame(handle);
	}, []);

	React.useLayoutEffect(() => {
		const element = scrollerRef.current;
		if (element && stickToBottomRef.current) {
			element.scrollTop = element.scrollHeight;
		}
	}, [chat.activeTurn, chat.queuedMessages, chat.turns.length]);

	React.useEffect(() => {
		if (!atTop || !chat.turnsNextCursor) {
			return;
		}
		void loadOlder();
	}, [atTop, chat.turnsNextCursor, loadOlder]);

	const onScroll = React.useCallback(() => {
		const element = scrollerRef.current;
		if (!element) {
			return;
		}
		setAtTop(element.scrollTop <= 80);
		stickToBottomRef.current = element.scrollHeight - element.scrollTop - element.clientHeight <= 80;
	}, []);

	return (
		<div className="agent-host-chat-app">
			<div className="agent-host-chat-transcript" ref={setScroller} role="log" aria-live="off" tabIndex={0} onScroll={onScroll}>
				{chat.turnsNextCursor && <div className="agent-host-chat-history-action"><VSCodeButton label={localize('agentHostChat.loadOlder', "Load Older Messages")} secondary onClick={() => void loadOlder()} /></div>}
				{historyError && <div className="agent-host-chat-error">{historyError}</div>}
				{screenReaderOptimized
					? chat.turns.map(turn => <TurnView key={turn.id} turn={turn} client={client} markdownRenderer={props.markdownRenderer} instantiationService={props.instantiationService} contextViewService={props.contextViewService} canInteract={canInteract} />)
					: <div className="agent-host-chat-history" role="list" style={{ height: `${virtualizer.getTotalSize()}px` }}>
						{virtualItems.map(item => {
						const turn = chat.turns[item.index];
						return (
							<div
								key={turn.id}
								data-index={item.index}
								ref={virtualizer.measureElement}
								className="agent-host-chat-virtual-row"
								role="listitem"
								style={{ transform: `translateY(${item.start}px)` }}
								aria-setsize={chat.turns.length}
								aria-posinset={item.index + 1}
							>
								<TurnView turn={turn} client={client} markdownRenderer={props.markdownRenderer} instantiationService={props.instantiationService} contextViewService={props.contextViewService} canInteract={canInteract} />
							</div>
						);
						})}
					</div>}
				{chat.activeTurn && <TurnView turn={chat.activeTurn} client={client} markdownRenderer={props.markdownRenderer} instantiationService={props.instantiationService} contextViewService={props.contextViewService} canInteract={canInteract} deferredParts={deferredParts} />}
				{chat.queuedMessages?.map(pending => (
					<div key={pending.id} className="agent-host-chat-pending">
						<span className="agent-host-chat-pending-label">{localize('agentHostChat.queued', "Queued")}</span>
						<span>{pending.message.text}</span>
					</div>
				))}
				{!chat.turns.length && !chat.activeTurn && <div className="agent-host-chat-empty">{localize('agentHostChat.empty', "Start a conversation with your agent")}</div>}
			</div>
			{canInteract && (blockingPart && chat.activeTurn
				? <BlockingPrompt part={blockingPart} turnId={chat.activeTurn.id} client={client} markdownRenderer={props.markdownRenderer} instantiationService={props.instantiationService} contextViewService={props.contextViewService} onPromptCreated={props.onPromptCreated} />
				: <MonacoComposer client={client} chat={chat} modelPicker={props.modelPicker} instantiationService={props.instantiationService} modelService={props.modelService} configurationService={props.configurationService} onEditorCreated={props.onEditorCreated} />)}
		</div>
	);
}

function AgentHostChatApp(props: AgentHostChatAppProps): React.JSX.Element {
	const snapshot = React.useSyncExternalStore(
		React.useCallback(listener => {
			const subscription = props.client.subscribe(listener);
			return () => subscription.dispose();
		}, [props.client]),
		React.useCallback(() => props.client.getSnapshot(), [props.client]),
	);
	if (snapshot.status === 'loading') {
		return <div className="agent-host-chat-state" role="status">{localize('agentHostChat.loading', "Loading conversation...")}</div>;
	}
	if (snapshot.status === 'error') {
		return <div className="agent-host-chat-state agent-host-chat-error" role="alert">{snapshot.error.message}</div>;
	}
	return <ReadyChat {...props} chat={snapshot.chat} />;
}

export class AgentHostChatView extends AbstractChatView {
	override readonly rendererId = RENDERER_ID;
	readonly kind = 'chat';
	override readonly hasVisibleTranscriptContent = observableValue(this, false);
	override readonly isLoadingTranscript = observableValue(this, true);

	private readonly _root: Root;
	private _editor: ICodeEditor | undefined;
	private _transcript: HTMLElement | undefined;
	private _prompt: HTMLElement | undefined;
	private _previousChatState: ChatState | undefined;
	private _focusPending = false;
	private _pendingInput: string | undefined;

	constructor(
		private readonly _clientReference: IAgentHostChatClientReference,
		private readonly _modelPicker: AgentHostChatModelPicker | undefined,
		@IInstantiationService instantiationService: IInstantiationService,
		@IModelService modelService: IModelService,
		@IConfigurationService configurationService: IConfigurationService,
		@IContextViewService contextViewService: IContextViewService,
		@IAccessibilityService accessibilityService: IAccessibilityService,
	) {
		super();
		this.element.classList.add('agent-host-react-chat-view');
		this._register(_clientReference);
		if (_modelPicker) {
			this._register(_modelPicker);
		}
		const markdownRenderer = instantiationService.createInstance(ChatContentMarkdownRenderer);
		const onEditorCreated = (editor: ICodeEditor | undefined) => {
			this._editor = editor;
			if (!editor) {
				return;
			}
			if (this._pendingInput !== undefined) {
				editor.setValue(this._pendingInput);
				this._pendingInput = undefined;
			}
			if (this._focusPending) {
				this._focusPending = false;
				editor.focus();
			}
		};
		const onTranscriptCreated = (transcript: HTMLElement | undefined, canInteract: boolean) => {
			this._transcript = transcript;
			if (transcript && !canInteract && this._focusPending) {
				this._focusPending = false;
				transcript.focus();
			}
		};
		const onPromptCreated = (prompt: HTMLElement | undefined) => {
			const document = getWindow(this.element).document;
			if (!prompt && this._prompt?.contains(document.activeElement)) {
				this._focusPending = true;
			}
			this._prompt = prompt;
		};
		this._root = createRoot(this.element);
		this._register(_clientReference.object.subscribe(() => this._updateTranscriptState()));
		this._root.render(
			<AgentHostChatApp
				client={_clientReference.object}
				modelPicker={_modelPicker}
				markdownRenderer={markdownRenderer}
				instantiationService={instantiationService}
				modelService={modelService}
				configurationService={configurationService}
				contextViewService={contextViewService}
				accessibilityService={accessibilityService}
				onEditorCreated={onEditorCreated}
				onTranscriptCreated={onTranscriptCreated}
				onPromptCreated={onPromptCreated}
			/>
		);
		this._updateTranscriptState();
		this._register({ dispose: () => this._root.unmount() });
	}

	override setChat(_chat: IChat, _historyKey?: string, _session?: ISession): void {
		this._updateTranscriptState();
	}

	override getAccessibleContent(): string | undefined {
		const snapshot = this._clientReference.object.getSnapshot();
		if (snapshot.status === 'loading') {
			return localize('agentHostChat.accessible.loading', "Loading conversation");
		}
		if (snapshot.status === 'error') {
			return localize('agentHostChat.accessible.loadError', "Could not load conversation: {0}", snapshot.error.message);
		}
		return buildAccessibleChatContent(snapshot.chat);
	}

	private _updateTranscriptState(): void {
		const snapshot = this._clientReference.object.getSnapshot();
		this.isLoadingTranscript.set(snapshot.status === 'loading', undefined);
		this.hasVisibleTranscriptContent.set(snapshot.status === 'ready' && Boolean(snapshot.chat.turns.length || snapshot.chat.activeTurn), undefined);
		if (snapshot.status === 'ready') {
			const hadBlockingPrompt = this._previousChatState ? hasBlockingPrompt(this._previousChatState) : false;
			const hasPrompt = hasBlockingPrompt(snapshot.chat);
			if (!hadBlockingPrompt && hasPrompt && this._editor?.hasTextFocus()) {
				this._focusPending = true;
			} else if (hadBlockingPrompt && !hasPrompt && this._prompt?.contains(getWindow(this.element).document.activeElement)) {
				this._focusPending = true;
			}
			if (this._previousChatState?.activeTurn && !snapshot.chat.activeTurn) {
				status(localize('agentHostChat.responseComplete', "Agent response complete"));
			}
			const latestPart = snapshot.chat.activeTurn?.responseParts.at(-1);
			const previousLatestPart = this._previousChatState?.activeTurn?.responseParts.at(-1);
			if (latestPart?.kind === ResponsePartKind.InputRequest
				&& latestPart.response === undefined
				&& (previousLatestPart?.kind !== ResponsePartKind.InputRequest || previousLatestPart.request.id !== latestPart.request.id || previousLatestPart.response !== undefined)) {
				status(localize('agentHostChat.inputRequired', "Agent input required"));
			} else if (latestPart?.kind === ResponsePartKind.ToolCall
				&& latestPart.toolCall.status === ToolCallStatus.PendingConfirmation
				&& (previousLatestPart?.kind !== ResponsePartKind.ToolCall || previousLatestPart.toolCall.toolCallId !== latestPart.toolCall.toolCallId || previousLatestPart.toolCall.status !== ToolCallStatus.PendingConfirmation)) {
				status(localize('agentHostChat.confirmationRequired', "Tool confirmation required"));
			} else if (latestPart?.kind === ResponsePartKind.Error
				&& (previousLatestPart?.kind !== ResponsePartKind.Error || previousLatestPart.error.message !== latestPart.error.message)) {
				status(latestPart.error.message);
			}
			this._previousChatState = snapshot.chat;
		}
	}

	protected doLayout(width: number): void {
		this._editor?.layout();
		this._modelPicker?.layout(width);
	}

	override toJSON(): object {
		return {};
	}

	override focus(): void {
		if (this._editor) {
			this._editor.focus();
		} else if (this._prompt) {
			(this._prompt.querySelector<HTMLElement>(promptControlSelector) ?? this._prompt).focus();
		} else if (this._transcript) {
			this._transcript.focus();
		} else {
			this._focusPending = true;
		}
	}

	override prefillInput(text: string): void {
		if (this._editor) {
			this._editor.setValue(text);
			this._editor.focus();
		} else {
			this._pendingInput = text;
			this._focusPending = true;
		}
	}

	override sendQuery(text: string): void {
		void this._clientReference.object.send(text).catch(error => status(getErrorMessage(error)));
	}

	override async submitInput(): Promise<boolean> {
		const text = this._editor?.getValue() ?? '';
		if (!text.trim()) {
			return false;
		}
		await this._clientReference.object.send(text);
		this._editor?.setValue('');
		this._clientReference.object.setDraft(undefined);
		return true;
	}

	override attach(uris: URI[]): void {
		this._clientReference.object.attachResources(uris);
	}
}

export const AGENT_HOST_REACT_CHAT_RENDERER_ID = RENDERER_ID;
