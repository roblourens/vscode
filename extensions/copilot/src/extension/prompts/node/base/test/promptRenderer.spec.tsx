/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { BasePromptElementProps, PromptElement, UserMessage } from '@vscode/prompt-tsx';
import { describe, expect, test } from 'vitest';
import { IEndpointProvider } from '../../../../../platform/endpoint/common/endpointProvider';
import { MockEndpoint } from '../../../../../platform/endpoint/test/node/mockEndpoint';
import { DeferredPromise } from '../../../../../util/vs/base/common/async';
import { isCancellationError } from '../../../../../util/vs/base/common/errors';
import { Event } from '../../../../../util/vs/base/common/event';
import { IInstantiationService } from '../../../../../util/vs/platform/instantiation/common/instantiation';
import { createExtensionUnitTestingServices } from '../../../../test/node/services';
import { CompositeElement } from '../common';
import { PromptRenderer, renderPromptElementJSON } from '../promptRenderer';

class ThrowingEndpointProvider implements IEndpointProvider {
	declare readonly _serviceBrand: undefined;
	readonly onDidModelsRefresh = Event.None;
	async getChatEndpoint(): Promise<never> { throw new Error('no utility model'); }
	async getEmbeddingsEndpoint(): Promise<never> { throw new Error('not implemented'); }
	async getAllChatEndpoints(): Promise<never[]> { return []; }
	async getAllCompletionModels(): Promise<never[]> { return []; }
}

class GatedPrompt extends PromptElement<{ gate: Promise<void> } & BasePromptElementProps> {
	override async prepare() {
		await this.props.gate;
	}

	override render() {
		return <UserMessage>hello</UserMessage>;
	}
}

class BoomChild extends PromptElement {
	constructor(props: BasePromptElementProps) {
		super(props);
		throw new Error('boom');
	}

	override render() {
		return undefined;
	}
}

class BoomPrompt extends PromptElement {
	override render() {
		return <UserMessage><BoomChild /></UserMessage>;
	}
}

class SimplePrompt extends PromptElement {
	override render() {
		return <UserMessage>hello</UserMessage>;
	}
}

describe('renderPromptElementJSON', () => {
	test('falls back to a stub endpoint when no utility model is available', async () => {
		const testingServiceCollection = createExtensionUnitTestingServices();
		testingServiceCollection.define(IEndpointProvider, new ThrowingEndpointProvider());
		const accessor = testingServiceCollection.createTestingAccessor();

		const result = await renderPromptElementJSON(
			accessor.get(IInstantiationService),
			CompositeElement,
			{},
		);

		expect(result.node).toBeDefined();
	});
});

describe('PromptRenderer InstantiationService dispose', () => {
	test('converts parent InstantiationService dispose during in-flight render into cancellation', async () => {
		const testingServiceCollection = createExtensionUnitTestingServices();
		const accessor = testingServiceCollection.createTestingAccessor();
		const instaService = accessor.get(IInstantiationService);
		const endpoint = instaService.createInstance(MockEndpoint, undefined);
		const gate = new DeferredPromise<void>();
		const renderer = PromptRenderer.create(instaService, endpoint, GatedPrompt, { gate: gate.p });

		const renderPromise = renderer.render();
		instaService.dispose();
		void gate.complete();

		await expect(renderPromise).rejects.toSatisfy(error => isCancellationError(error));
	});

	test('does not convert unrelated createElement errors into cancellation', async () => {
		const testingServiceCollection = createExtensionUnitTestingServices();
		const accessor = testingServiceCollection.createTestingAccessor();
		const instaService = accessor.get(IInstantiationService);
		const endpoint = instaService.createInstance(MockEndpoint, undefined);
		const renderer = PromptRenderer.create(instaService, endpoint, BoomPrompt, {});

		await expect(renderer.render()).rejects.toThrow('boom');
	});

	test('converts InstantiationService dispose after a completed render into cancellation', async () => {
		const testingServiceCollection = createExtensionUnitTestingServices();
		const accessor = testingServiceCollection.createTestingAccessor();
		const instaService = accessor.get(IInstantiationService);
		const endpoint = instaService.createInstance(MockEndpoint, undefined);
		const renderer = PromptRenderer.create(instaService, endpoint, SimplePrompt, {});

		await renderer.render();
		await expect(renderer.countTokens()).rejects.toSatisfy(error => isCancellationError(error));
	});
});
