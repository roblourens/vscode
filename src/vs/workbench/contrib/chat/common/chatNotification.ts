/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { URI } from '../../../../base/common/uri.js';
import { CHAT_SUBAGENT_RESOURCE_QUERY_PARAM } from './constants.js';

export const enum ChatNotificationKind {
	NeedsInput = 'needsInput',
	Idle = 'idle',
}

export function getChatNotificationDedupeKey(sessionResource: URI, kind: ChatNotificationKind): string {
	return `chat-session:${sessionResource.toString()}:${kind}`;
}

/**
 * Nested Agent Host sub-agent chats are opened as the parent session URI plus
 * {@link CHAT_SUBAGENT_RESOURCE_QUERY_PARAM}. Their idle transitions must not
 * produce a user-facing "session finished" toast while the parent turn is still
 * running — and must not produce one toast per finishing sub-agent.
 */
export function isSubagentChatSessionResource(resource: URI): boolean {
	return new URLSearchParams(resource.query).has(CHAT_SUBAGENT_RESOURCE_QUERY_PARAM);
}
