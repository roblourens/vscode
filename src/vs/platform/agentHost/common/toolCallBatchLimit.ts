/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize } from '../../../nls.js';
import type { ErrorInfo } from './state/protocol/common/state.js';

/**
 * Hard cap on tool calls produced by a single model response.
 *
 * Independent of the multi-turn `chat.agent.maxRequests` continuation limit: a
 * pathological assistant message can carry thousands of tool requests in one
 * round, which that setting does not bound. See vscode#336301.
 */
export const MAX_TOOL_CALLS_PER_RESPONSE = 64;

export function isOversizedToolCallBatch(count: number, limit = MAX_TOOL_CALLS_PER_RESPONSE): boolean {
	return count > limit;
}

export function createOversizedToolBatchError(count: number, limit = MAX_TOOL_CALLS_PER_RESPONSE): ErrorInfo {
	return {
		errorType: 'tooManyToolCalls',
		message: localize(
			'agentHost.tooManyToolCalls',
			"This response requested {0} tool calls, which exceeds the limit of {1} per response. The batch was not executed. Send another message to continue.",
			count,
			limit,
		),
	};
}

/**
 * Tracks unique tool-call IDs for the in-flight model response so a single
 * assistant message cannot schedule an unbounded parallel batch.
 *
 * A response is sealed when its complete `assistant.message` arrives. The next
 * delta or message starts a new response and resets the count, so legitimate
 * multi-round turns are not charged against the previous round.
 */
export class ToolCallResponseBatch {

	private readonly _ids = new Set<string>();
	private _sealed = false;
	private _rejected = false;

	constructor(readonly limit = MAX_TOOL_CALLS_PER_RESPONSE) { }

	get rejected(): boolean {
		return this._rejected;
	}

	get size(): number {
		return this._ids.size;
	}

	/** Call at the start of a model-response event (streaming delta or complete message). */
	beginResponseEvent(): void {
		if (this._rejected) {
			return;
		}
		if (this._sealed) {
			this._ids.clear();
			this._sealed = false;
		}
	}

	/**
	 * Records one tool call from the current response.
	 * @returns `false` when the batch is over the cap (and from then on).
	 */
	observe(toolCallId: string): boolean {
		if (this._rejected) {
			return false;
		}
		this._ids.add(toolCallId);
		if (this._ids.size > this.limit) {
			this._rejected = true;
			return false;
		}
		return true;
	}

	/**
	 * Seals this response using the complete message's tool-request count.
	 * @returns `false` when the batch is over the cap.
	 */
	finishMessage(toolRequestCount: number): boolean {
		const count = Math.max(toolRequestCount, this._ids.size);
		if (this._rejected || isOversizedToolCallBatch(count, this.limit)) {
			this._rejected = true;
			this._sealed = true;
			return false;
		}
		this._sealed = true;
		return true;
	}

	reset(): void {
		this._ids.clear();
		this._sealed = false;
		this._rejected = false;
	}
}
