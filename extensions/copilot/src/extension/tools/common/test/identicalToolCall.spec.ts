/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { describe, expect, it } from 'vitest';
import {
	identicalToolCallRefusalMessage,
	isIdenticalToolCallLoop,
	MAX_CONSECUTIVE_IDENTICAL_TOOL_CALLS,
	shouldRefuseIdenticalToolCall,
	toolCallFingerprint,
	trailingIdenticalToolCallStreak,
} from '../identicalToolCall';

function call(name: string, args: string | Record<string, unknown> = {}): { name: string; arguments: string } {
	return { name, arguments: typeof args === 'string' ? args : JSON.stringify(args) };
}

describe('identicalToolCall', () => {
	it('fingerprints JSON arguments independently of key order and whitespace', () => {
		expect(toolCallFingerprint(call('find_tools', '{ "q": "foo", "n": 1 }')))
			.toBe(toolCallFingerprint(call('find_tools', '{"n":1,"q":"foo"}')));
	});

	it('allows the first two identical calls and refuses the third', () => {
		const a = call('find_tools', { query: 'search' });
		expect(shouldRefuseIdenticalToolCall([], a)).toBe(false);
		expect(shouldRefuseIdenticalToolCall([a], a)).toBe(false);
		expect(shouldRefuseIdenticalToolCall([a, a], a)).toBe(true);
		expect(MAX_CONSECUTIVE_IDENTICAL_TOOL_CALLS).toBe(2);
	});

	it('does not refuse when arguments differ', () => {
		const first = call('bash', { command: 'gh run view 1' });
		const second = call('bash', { command: 'gh run view 2' });
		expect(shouldRefuseIdenticalToolCall([first, first], second)).toBe(false);
	});

	it('does not refuse when a different tool breaks the streak', () => {
		const find = call('find_tools', { query: 'x' });
		const read = call('read_file', { path: 'a.ts' });
		expect(shouldRefuseIdenticalToolCall([find, find, read], find)).toBe(false);
	});

	it('ignores synthetic tools when computing the streak', () => {
		const find = call('find_tools', { query: 'x' });
		const voice = call('report_voice_progress', { stage: 'investigating', summary: 'looking' });
		expect(shouldRefuseIdenticalToolCall([find, voice, find], find)).toBe(true);
		expect(shouldRefuseIdenticalToolCall([find, find], voice)).toBe(false);
	});

	it('treats a trailing streak longer than the per-call limit as a budget loop', () => {
		const identical = call('bash', { command: 'gh run view 35303632186' });
		expect(isIdenticalToolCallLoop([
			{ toolCalls: [identical] },
			{ toolCalls: [identical] },
		])).toBe(false);
		expect(trailingIdenticalToolCallStreak([
			{ toolCalls: [identical] },
			{ toolCalls: [identical] },
			{ toolCalls: [identical] },
		])).toBe(3);
		expect(isIdenticalToolCallLoop([
			{ toolCalls: [identical] },
			{ toolCalls: [identical] },
			{ toolCalls: [identical] },
		])).toBe(true);
	});

	it('does not treat a productive turn that ends with one duplicate as a budget loop', () => {
		expect(isIdenticalToolCallLoop([
			{ toolCalls: [call('read_file', { path: 'a.ts' })] },
			{ toolCalls: [call('replace_string_in_file', { path: 'a.ts' })] },
			{ toolCalls: [call('read_file', { path: 'a.ts' })] },
		])).toBe(false);
	});

	it('names the refused tool in the model-facing message', () => {
		expect(identicalToolCallRefusalMessage('commons_create')).toContain('commons_create');
		expect(identicalToolCallRefusalMessage('commons_create')).toContain('Do not retry');
	});
});
