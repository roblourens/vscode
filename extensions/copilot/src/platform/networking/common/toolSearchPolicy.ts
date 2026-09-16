/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ChatLocation } from '../../chat/common/commonTypes';

/**
 * Request-scoped inputs that decide whether tool search / deferral is actually
 * active. Endpoint capability alone is not enough: the Responses API keeps
 * subagent tools eagerly loaded and omits the search tool.
 */
export interface ToolSearchRequestPolicy {
	readonly supportsToolSearch: boolean | undefined;
	readonly isSubagent: boolean;
	/**
	 * When false, tool search is disabled even if the endpoint supports it
	 * (for example a custom agent that filtered `tool_search` out).
	 * `undefined` means "not checked here".
	 */
	readonly hasToolSearchTool?: boolean;
	/**
	 * When set, search is limited to Agent / MessagesProxy conversations,
	 * matching Responses API serialization.
	 */
	readonly location?: ChatLocation;
}

/**
 * Effective tool-search / deferral policy for a single request.
 *
 * This must stay aligned between prompt generation and request serialization.
 * Subagents in particular receive full ordinary tool schemas and no search
 * tool, so they must not be told to discover tools before calling them.
 */
export function isToolSearchEnabledForRequest(policy: ToolSearchRequestPolicy): boolean {
	if (!policy.supportsToolSearch || policy.isSubagent) {
		return false;
	}
	if (policy.hasToolSearchTool === false) {
		return false;
	}
	if (policy.location !== undefined
		&& policy.location !== ChatLocation.Agent
		&& policy.location !== ChatLocation.MessagesProxy) {
		return false;
	}
	return true;
}

/**
 * Whether this request is a subagent (or otherwise opted out of tool search)
 * from the fetch/serialization option bag.
 *
 * `enableToolSearch: false` is the fetch-time flag set for subagents; telemetry
 * `subType` is the Responses API serializer's historical signal. Either one
 * disables search. Presence of the search tool in the pre-serialization tool
 * list is not sufficient on its own because the serializer still strips it.
 */
export function isSubagentToolSearchExclusion(options: {
	telemetryProperties?: { subType?: string };
	modelCapabilities?: { enableToolSearch?: boolean };
}): boolean {
	if (options.modelCapabilities?.enableToolSearch === false) {
		return true;
	}
	return options.telemetryProperties?.subType?.startsWith('subagent') ?? false;
}

/**
 * Prompt-side wrapper: an explicit `enableToolSearch: false` (subagent) wins
 * over endpoint capability. `undefined` preserves the previous endpoint-only
 * check for call sites that have not been threaded through yet.
 */
export function isToolSearchEnabledInPrompt(
	endpoint: { supportsToolSearch?: boolean } | undefined,
	enableToolSearch?: boolean,
): boolean {
	if (enableToolSearch === false) {
		return false;
	}
	return isToolSearchEnabledForRequest({
		supportsToolSearch: endpoint?.supportsToolSearch,
		isSubagent: false,
	});
}
