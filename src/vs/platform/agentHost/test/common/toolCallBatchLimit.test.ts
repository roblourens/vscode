/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';
import { createOversizedToolBatchError, isOversizedToolCallBatch, MAX_TOOL_CALLS_PER_RESPONSE, ToolCallResponseBatch } from '../../common/toolCallBatchLimit.js';

suite('toolCallBatchLimit', () => {

	ensureNoDisposablesAreLeakedInTestSuite();

	test('allows a batch at the cap and rejects one over it', () => {
		assert.strictEqual(isOversizedToolCallBatch(MAX_TOOL_CALLS_PER_RESPONSE), false);
		assert.strictEqual(isOversizedToolCallBatch(MAX_TOOL_CALLS_PER_RESPONSE + 1), true);
	});

	test('createOversizedToolBatchError is recoverable and names the counts', () => {
		const error = createOversizedToolBatchError(3871);
		assert.strictEqual(error.errorType, 'tooManyToolCalls');
		assert.ok(error.message.includes('3871'));
		assert.ok(error.message.includes(String(MAX_TOOL_CALLS_PER_RESPONSE)));
	});

	test('observe rejects the (limit+1)th distinct tool call', () => {
		const batch = new ToolCallResponseBatch(2);
		assert.strictEqual(batch.observe('a'), true);
		assert.strictEqual(batch.observe('b'), true);
		assert.strictEqual(batch.observe('c'), false);
		assert.strictEqual(batch.rejected, true);
		assert.strictEqual(batch.observe('d'), false);
		assert.strictEqual(batch.observe('a'), false);
	});

	test('duplicate ids in one response do not inflate the count', () => {
		const batch = new ToolCallResponseBatch(1);
		assert.strictEqual(batch.observe('a'), true);
		assert.strictEqual(batch.observe('a'), true);
		assert.strictEqual(batch.size, 1);
		assert.strictEqual(batch.rejected, false);
	});

	test('finishMessage rejects an oversized complete batch before any observe', () => {
		const batch = new ToolCallResponseBatch(2);
		batch.beginResponseEvent();
		assert.strictEqual(batch.finishMessage(3), false);
		assert.strictEqual(batch.rejected, true);
	});

	test('a later response does not inherit the previous round\'s count', () => {
		const batch = new ToolCallResponseBatch(2);
		assert.strictEqual(batch.observe('a'), true);
		assert.strictEqual(batch.observe('b'), true);
		assert.strictEqual(batch.finishMessage(2), true);

		batch.beginResponseEvent();
		assert.strictEqual(batch.observe('c'), true);
		assert.strictEqual(batch.observe('d'), true);
		assert.strictEqual(batch.finishMessage(2), true);
		assert.strictEqual(batch.rejected, false);
	});

	test('a rejected batch stays rejected across a subsequent message', () => {
		const batch = new ToolCallResponseBatch(1);
		assert.strictEqual(batch.observe('a'), true);
		assert.strictEqual(batch.observe('b'), false);
		batch.beginResponseEvent();
		assert.strictEqual(batch.finishMessage(1), false);
		assert.strictEqual(batch.rejected, true);
	});

	test('reset clears rejection so the next turn can run tools', () => {
		const batch = new ToolCallResponseBatch(1);
		assert.strictEqual(batch.observe('a'), true);
		assert.strictEqual(batch.observe('b'), false);
		batch.reset();
		assert.strictEqual(batch.rejected, false);
		assert.strictEqual(batch.observe('c'), true);
	});
});
