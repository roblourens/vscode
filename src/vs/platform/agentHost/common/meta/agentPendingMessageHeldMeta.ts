/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { Message, PendingMessage } from '../state/protocol/state.js';

/**
 * VS Code-owned pending-message marker: the user is editing this queued or
 * steering item, so Agent Host must not auto-deliver it until the edit is
 * saved or discarded.
 */
export const PENDING_MESSAGE_HELD_META_KEY = 'vscode.pendingMessageHeld';

/**
 * Whether a pending message (or its protocol {@link Message}) is held for
 * editing and must not be auto-delivered.
 */
export function isPendingMessageHeld(source: PendingMessage | Message | undefined): boolean {
	if (!source) {
		return false;
	}
	const meta = 'origin' in source ? source._meta : source.message._meta;
	return meta?.[PENDING_MESSAGE_HELD_META_KEY] === true;
}

/** Adds the held-for-edit marker to an open message metadata bag. */
export function withPendingMessageHeldMeta(meta: Record<string, unknown> | undefined): Record<string, unknown> {
	return { ...meta, [PENDING_MESSAGE_HELD_META_KEY]: true };
}

/** Strips the held-for-edit marker so it is not persisted on a delivered turn. */
export function withoutPendingMessageHeld(message: Message): Message {
	if (!isPendingMessageHeld(message)) {
		return message;
	}
	const { [PENDING_MESSAGE_HELD_META_KEY]: _held, ...rest } = message._meta ?? {};
	if (Object.keys(rest).length === 0) {
		const { _meta: _ignored, ...restMessage } = message;
		return restMessage;
	}
	return { ...message, _meta: rest };
}
