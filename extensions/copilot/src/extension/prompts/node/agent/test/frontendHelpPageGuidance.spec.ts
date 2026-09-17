/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { readFileSync } from 'fs';
import { join } from 'path';
import { Raw } from '@vscode/prompt-tsx';
import { afterAll, beforeAll, expect, suite, test } from 'vitest';
import { IChatMLFetcher } from '../../../../../platform/chat/common/chatMLFetcher';
import { StaticChatMLFetcher } from '../../../../../platform/chat/test/common/staticChatMLFetcher';
import { MockEndpoint } from '../../../../../platform/endpoint/test/node/mockEndpoint';
import { messageToMarkdown } from '../../../../../platform/log/common/messageStringify';
import { IResponseDelta } from '../../../../../platform/networking/common/fetch';
import { ITestingServicesAccessor } from '../../../../../platform/test/node/services';
import { IInstantiationService } from '../../../../../util/vs/platform/instantiation/common/instantiation';
import { createExtensionUnitTestingServices } from '../../../../test/node/services';
import { IToolsService } from '../../../../tools/common/toolsService';
import { PromptRenderer } from '../../base/promptRenderer';
import '../allAgentPrompts';
import { PromptRegistry } from '../promptRegistry';

const helpPageException = 'When the user explicitly requests a dedicated help, docs, or about page, you implement that page.';
const unsolicitedHowToBan = 'You do not use unsolicited visible, in-app text to describe the application\'s features, functionality, keyboard shortcuts, styling, visual elements, or how to use the application.';
const absoluteHowToBan = 'You do not use visible, in-app text to describe the application\'s features, functionality, keyboard shortcuts, styling, visual elements, or how to use the application.';

const openaiPromptFiles = [
	'gpt55BasePrompt.tsx',
	'gpt55Prompt.tsx',
	'gpt56Prompt.tsx',
	'gpt6Prompt.tsx',
];

suite('Frontend help-page guidance', () => {
	let accessor: ITestingServicesAccessor;

	beforeAll(() => {
		const services = createExtensionUnitTestingServices();
		const chatResponse: (string | IResponseDelta[])[] = [];
		services.define(IChatMLFetcher, new StaticChatMLFetcher(chatResponse));
		accessor = services.createTestingAccessor();
	});

	afterAll(() => {
		accessor.dispose();
	});

	async function renderSystemPrompt(family: string): Promise<string> {
		const instantiationService = accessor.get(IInstantiationService);
		const endpoint = instantiationService.createInstance(MockEndpoint, family);
		const customizations = await PromptRegistry.resolveAllCustomizations(instantiationService, endpoint);
		const renderer = PromptRenderer.create(instantiationService, endpoint, customizations.SystemPrompt, {
			availableTools: accessor.get(IToolsService).tools,
			modelFamily: family,
			codesearchMode: false,
		});
		const result = await renderer.render();
		return result.messages
			.filter(message => message.role === Raw.ChatRole.System)
			.map(message => messageToMarkdown(message))
			.join('\n\n');
	}

	test('source prompts keep the unsolicited-copy ban and allow requested help pages', () => {
		for (const file of openaiPromptFiles) {
			const text = readFileSync(join(__dirname, '../openai', file), 'utf8');
			expect({ file, hasException: text.includes(helpPageException), hasUnsolicitedBan: text.includes(unsolicitedHowToBan), hasAbsoluteBan: text.includes(absoluteHowToBan) }).toEqual({
				file,
				hasException: true,
				hasUnsolicitedBan: true,
				hasAbsoluteBan: false,
			});
		}
	});

	test.each(['gpt-5.5', 'gpt-5.6', 'gpt-6', 'gpt-6-astra'])('%s system prompt allows an explicitly requested help page', async family => {
		const renderedPrompt = await renderSystemPrompt(family);
		expect(renderedPrompt).toContain(unsolicitedHowToBan);
		expect(renderedPrompt).toContain(helpPageException);
		expect(renderedPrompt).not.toContain(absoluteHowToBan);
	});
});
