/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Max consecutive executions of the same tool with the same arguments.
 * The next identical call is refused and surfaced to the model.
 *
 * Allows one retry (two executions) so a single transient failure can be
 * retried, then circuit-breaks. Matches Claude Code / Codex-style identical-call
 * repetition detection (vscode#336767).
 */
export const MAX_CONSECUTIVE_IDENTICAL_TOOL_CALLS = 2;

/**
 * Synthetic / control tools that should not participate in identical-call
 * streak detection. Skipping them means they neither start a loop nor break
 * an otherwise consecutive streak of a real tool.
 */
export const IDENTICAL_TOOL_CALL_IGNORED_NAMES = new Set<string>([
	'report_voice_progress',
	'task_complete',
]);

export interface IToolCallIdentity {
	readonly name: string;
	readonly arguments: string;
}

function canonicalizeJsonValue(value: unknown): unknown {
	if (Array.isArray(value)) {
		return value.map(canonicalizeJsonValue);
	}
	if (value !== null && typeof value === 'object') {
		const obj = value as Record<string, unknown>;
		const sorted: Record<string, unknown> = {};
		for (const key of Object.keys(obj).sort()) {
			sorted[key] = canonicalizeJsonValue(obj[key]);
		}
		return sorted;
	}
	return value;
}

/**
 * Canonical fingerprint for a tool name + arguments pair so semantically
 * identical JSON payloads (key order, whitespace) compare equal.
 */
export function toolCallFingerprint(call: IToolCallIdentity): string {
	let canonicalArgs = call.arguments.trim();
	try {
		canonicalArgs = JSON.stringify(canonicalizeJsonValue(JSON.parse(call.arguments)));
	} catch {
		// Keep the trimmed raw string when arguments are not JSON.
	}
	return `${call.name}:${canonicalArgs}`;
}

function isIgnoredToolCall(call: IToolCallIdentity): boolean {
	return IDENTICAL_TOOL_CALL_IGNORED_NAMES.has(call.name);
}

/**
 * Count how many trailing (non-ignored) calls share `fingerprint`.
 */
export function consecutiveIdenticalStreak(calls: readonly IToolCallIdentity[], fingerprint: string): number {
	let streak = 0;
	for (let i = calls.length - 1; i >= 0; i--) {
		if (isIgnoredToolCall(calls[i])) {
			continue;
		}
		if (toolCallFingerprint(calls[i]) === fingerprint) {
			streak++;
		} else {
			break;
		}
	}
	return streak;
}

/**
 * True when executing `next` would exceed {@link MAX_CONSECUTIVE_IDENTICAL_TOOL_CALLS}
 * consecutive identical calls.
 */
export function shouldRefuseIdenticalToolCall(precedingCalls: readonly IToolCallIdentity[], next: IToolCallIdentity): boolean {
	if (isIgnoredToolCall(next)) {
		return false;
	}
	return consecutiveIdenticalStreak(precedingCalls, toolCallFingerprint(next)) >= MAX_CONSECUTIVE_IDENTICAL_TOOL_CALLS;
}

export function flattenToolCallsFromRounds(rounds: readonly { readonly toolCalls: readonly IToolCallIdentity[] }[]): IToolCallIdentity[] {
	const calls: IToolCallIdentity[] = [];
	for (const round of rounds) {
		calls.push(...round.toolCalls);
	}
	return calls;
}

/**
 * Trailing consecutive identical (non-ignored) call count across `rounds`.
 */
export function trailingIdenticalToolCallStreak(rounds: readonly { readonly toolCalls: readonly IToolCallIdentity[] }[]): number {
	const calls = flattenToolCallsFromRounds(rounds);
	for (let i = calls.length - 1; i >= 0; i--) {
		if (isIgnoredToolCall(calls[i])) {
			continue;
		}
		return consecutiveIdenticalStreak(calls.slice(0, i), toolCallFingerprint(calls[i])) + 1;
	}
	return 0;
}

/**
 * True when the spent tool-call budget was a repetition loop: the trailing
 * consecutive identical streak is longer than the per-call circuit breaker,
 * so "Continue to iterate?" must not silently raise the round limit.
 */
export function isIdenticalToolCallLoop(rounds: readonly { readonly toolCalls: readonly IToolCallIdentity[] }[]): boolean {
	return trailingIdenticalToolCallStreak(rounds) > MAX_CONSECUTIVE_IDENTICAL_TOOL_CALLS;
}

export function identicalToolCallRefusalMessage(toolName: string): string {
	return `The identical ${toolName} tool call was not executed because it was already called ${MAX_CONSECUTIVE_IDENTICAL_TOOL_CALLS} times in a row with the same arguments. Do not retry this exact tool call. Change the arguments, use a different tool, or stop if you already have the result.`;
}
