/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { parseCodexModelSelection, resolveCodexSubscriptionCatalog, toCodexModelSelectionId } from '../../../node/codex/codexAgent.js';

suite('CodexModelSelection', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('round trips provider and model identifiers', () => {
		const id = toCodexModelSelectionId('custom/provider', 'org/model:latest');
		assert.strictEqual(id, '@provider=custom%2Fprovider:org%2Fmodel%3Alatest');
		assert.deepStrictEqual(parseCodexModelSelection({ id }), {
			modelProvider: 'custom/provider',
			modelId: 'org/model:latest',
		});
	});

	test('does not collide when display names match', () => {
		assert.notStrictEqual(
			toCodexModelSelectionId('vscode-proxy', 'gpt-5.6-sol'),
			toCodexModelSelectionId('openai', 'gpt-5.6-sol'),
		);
	});

	test('publishes ChatGPT catalog models under openai even when config points at vscode-proxy', () => {
		assert.deepStrictEqual(
			resolveCodexSubscriptionCatalog('vscode-proxy', { status: 'signedIn', authType: 'chatgpt' }),
			{ modelProvider: 'openai', usesChatGPTSubscription: true, pickerProvider: 'chatgpt' },
		);
		assert.deepStrictEqual(
			resolveCodexSubscriptionCatalog('openai', { status: 'signedIn', authType: 'chatgpt' }),
			{ modelProvider: 'openai', usesChatGPTSubscription: true, pickerProvider: 'chatgpt' },
		);
		assert.deepStrictEqual(
			resolveCodexSubscriptionCatalog('vscode-proxy', { status: 'signedOut' }),
			{ modelProvider: 'vscode-proxy', usesChatGPTSubscription: false, pickerProvider: 'vscode-proxy' },
		);
		assert.deepStrictEqual(
			resolveCodexSubscriptionCatalog('custom-provider', { status: 'signedIn', authType: 'chatgpt' }),
			{ modelProvider: 'custom-provider', usesChatGPTSubscription: false, pickerProvider: 'custom-provider' },
		);
	});
});
