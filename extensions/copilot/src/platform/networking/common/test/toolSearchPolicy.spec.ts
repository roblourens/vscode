/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { describe, expect, it } from 'vitest';
import { ChatLocation } from '../../../chat/common/commonTypes';
import { isSubagentToolSearchExclusion, isToolSearchEnabledForRequest, isToolSearchEnabledInPrompt } from '../toolSearchPolicy';

describe('isToolSearchEnabledForRequest', () => {
	it('enables search for a top-level agent with a search-capable endpoint', () => {
		expect(isToolSearchEnabledForRequest({
			supportsToolSearch: true,
			isSubagent: false,
			hasToolSearchTool: true,
			location: ChatLocation.Agent,
		})).toBe(true);
	});

	it('disables search for subagents even when the endpoint supports it', () => {
		expect(isToolSearchEnabledForRequest({
			supportsToolSearch: true,
			isSubagent: true,
			hasToolSearchTool: true,
			location: ChatLocation.Agent,
		})).toBe(false);
	});

	it('disables search when the endpoint does not support it', () => {
		expect(isToolSearchEnabledForRequest({
			supportsToolSearch: false,
			isSubagent: false,
			hasToolSearchTool: true,
			location: ChatLocation.Agent,
		})).toBe(false);
	});

	it('disables search when the search tool was filtered out of the request', () => {
		expect(isToolSearchEnabledForRequest({
			supportsToolSearch: true,
			isSubagent: false,
			hasToolSearchTool: false,
			location: ChatLocation.Agent,
		})).toBe(false);
	});

	it('disables search outside Agent / MessagesProxy locations', () => {
		expect(isToolSearchEnabledForRequest({
			supportsToolSearch: true,
			isSubagent: false,
			hasToolSearchTool: true,
			location: ChatLocation.Panel,
		})).toBe(false);
	});

	it('enables search for MessagesProxy when other gates pass', () => {
		expect(isToolSearchEnabledForRequest({
			supportsToolSearch: true,
			isSubagent: false,
			hasToolSearchTool: true,
			location: ChatLocation.MessagesProxy,
		})).toBe(true);
	});
});

describe('isSubagentToolSearchExclusion', () => {
	it('treats telemetry subType subagent as excluded', () => {
		expect(isSubagentToolSearchExclusion({ telemetryProperties: { subType: 'subagent' } })).toBe(true);
		expect(isSubagentToolSearchExclusion({ telemetryProperties: { subType: 'subagent-custom' } })).toBe(true);
	});

	it('treats explicit enableToolSearch false as excluded', () => {
		expect(isSubagentToolSearchExclusion({ modelCapabilities: { enableToolSearch: false } })).toBe(true);
	});

	it('does not exclude a top-level agent request', () => {
		expect(isSubagentToolSearchExclusion({})).toBe(false);
		expect(isSubagentToolSearchExclusion({
			telemetryProperties: { subType: 'system-initiated' },
			modelCapabilities: { enableToolSearch: true },
		})).toBe(false);
	});
});

describe('isToolSearchEnabledInPrompt', () => {
	it('follows endpoint capability when enableToolSearch is unset', () => {
		expect(isToolSearchEnabledInPrompt({ supportsToolSearch: true })).toBe(true);
		expect(isToolSearchEnabledInPrompt({ supportsToolSearch: false })).toBe(false);
	});

	it('suppresses discovery instructions when enableToolSearch is false', () => {
		expect(isToolSearchEnabledInPrompt({ supportsToolSearch: true }, false)).toBe(false);
	});
});
