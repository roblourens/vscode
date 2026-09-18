/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ChatRequest, LanguageModelToolInformation } from 'vscode';
import { ChatFetchResponseType } from '../../../../platform/chat/common/commonTypes';
import { SpyChatResponseStream } from '../../../../util/common/test/mockChatResponseStream';
import { DisposableStore } from '../../../../util/vs/base/common/lifecycle';
import { generateUuid } from '../../../../util/vs/base/common/uuid';
import { IInstantiationService } from '../../../../util/vs/platform/instantiation/common/instantiation';
import { ChatResponseConfirmationPart, ChatResponseWarningPart } from '../../../../vscodeTypes';
import { Conversation, IResultMetadata, Turn } from '../../../prompt/common/conversation';
import { IBuildPromptContext, IToolCallRound } from '../../../prompt/common/intents';
import { IBuildPromptResult, nullRenderPromptResult } from '../../../prompt/node/intents';
import { createExtensionUnitTestingServices } from '../../../test/node/services';
import { IToolCallingLoopOptions, IToolCallSingleResult, ToolCallLimitBehavior, ToolCallingLoop } from '../../node/toolCallingLoop';

class LimitTestToolCallingLoop extends ToolCallingLoop<IToolCallingLoopOptions> {
	protected override async buildPrompt(_buildPromptContext: IBuildPromptContext): Promise<IBuildPromptResult> {
		return nullRenderPromptResult();
	}

	protected override async getAvailableTools(): Promise<LanguageModelToolInformation[]> {
		return [];
	}

	protected override async fetch(): Promise<never> {
		throw new Error('fetch should not be called in these tests');
	}

	public addToolCallRound(round: IToolCallRound): void {
		(this as any).toolCallRounds.push(round);
	}

	public testHitToolCallLimit(stream: SpyChatResponseStream, lastResult: IToolCallSingleResult): IToolCallSingleResult {
		return (this as any).hitToolCallLimit(stream, lastResult);
	}
}

function createMockChatRequest(overrides: Partial<ChatRequest> = {}): ChatRequest {
	return {
		prompt: 'test prompt',
		command: undefined,
		references: [],
		location: 1,
		location2: undefined,
		attempt: 0,
		enableCommandDetection: false,
		isParticipantDetected: false,
		toolReferences: [],
		toolInvocationToken: {} as ChatRequest['toolInvocationToken'],
		model: null!,
		tools: new Map(),
		id: generateUuid(),
		sessionId: generateUuid(),
		...overrides,
	} as ChatRequest;
}

function createTestConversation(): Conversation {
	return new Conversation(generateUuid(), [
		new Turn(generateUuid(), { message: 'test message', type: 'user' }),
	]);
}

function identicalRounds(count: number, name = 'find_tools', args = '{"query":"x"}'): IToolCallRound[] {
	return Array.from({ length: count }, (_, i) => ({
		id: generateUuid(),
		response: '',
		toolInputRetry: 0,
		toolCalls: [{ id: `call-${i}`, name, arguments: args }],
	}));
}

function createLastResult(): IToolCallSingleResult {
	return {
		response: { type: ChatFetchResponseType.Success, value: 'ok', requestId: 'r', serverRequestId: undefined, usage: undefined, resolvedModel: 'test' } as IToolCallSingleResult['response'],
		round: identicalRounds(1)[0],
		hadIgnoredFiles: false,
		lastRequestMessages: [],
		availableTools: [],
		chatResult: {},
	};
}

describe('ToolCallingLoop identical tool-call budget', () => {
	let disposables: DisposableStore;
	let instantiationService: IInstantiationService;

	beforeEach(() => {
		disposables = new DisposableStore();
		const serviceCollection = disposables.add(createExtensionUnitTestingServices());
		instantiationService = serviceCollection.createTestingAccessor().get(IInstantiationService);
	});

	afterEach(() => {
		disposables.dispose();
	});

	function createLoop(): LimitTestToolCallingLoop {
		const loop = instantiationService.createInstance(
			LimitTestToolCallingLoop,
			{
				conversation: createTestConversation(),
				toolCallLimit: 5,
				onHitToolCallLimit: ToolCallLimitBehavior.Confirm,
				request: createMockChatRequest(),
			}
		);
		disposables.add(loop);
		return loop;
	}

	it('does not offer Continue to iterate when the spent budget was an identical-call loop', () => {
		const loop = createLoop();
		for (const round of identicalRounds(3)) {
			loop.addToolCallRound(round);
		}
		const stream = new SpyChatResponseStream();
		const result = loop.testHitToolCallLimit(stream, createLastResult());
		const metadata = result.chatResult?.metadata as Partial<IResultMetadata> | undefined;

		expect(metadata?.identicalToolCallLoop).toBe(true);
		expect(metadata?.maxToolCallsExceeded).toBeUndefined();
		expect(stream.items.some(part => part instanceof ChatResponseConfirmationPart)).toBe(false);
		expect(stream.items.some(part => part instanceof ChatResponseWarningPart)).toBe(true);
	});

	it('still offers Continue to iterate for a productive turn that hit the request cap', () => {
		const loop = createLoop();
		loop.addToolCallRound({
			id: generateUuid(),
			response: '',
			toolInputRetry: 0,
			toolCalls: [{ id: 'a', name: 'read_file', arguments: '{"path":"a.ts"}' }],
		});
		loop.addToolCallRound({
			id: generateUuid(),
			response: '',
			toolInputRetry: 0,
			toolCalls: [{ id: 'b', name: 'replace_string_in_file', arguments: '{"path":"a.ts"}' }],
		});
		const stream = new SpyChatResponseStream();
		const result = loop.testHitToolCallLimit(stream, createLastResult());
		const metadata = result.chatResult?.metadata as Partial<IResultMetadata> | undefined;

		expect(metadata?.identicalToolCallLoop).toBeUndefined();
		expect(metadata?.maxToolCallsExceeded).toBe(true);
		expect(stream.confirmations.length).toBe(1);
		expect(stream.confirmations[0].title).toContain('Continue to iterate');
	});
});
