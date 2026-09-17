/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { URI } from '../../../base/common/uri.js';
import { IAgentConnection } from './agentService.js';
import { ActionType } from './state/sessionActions.js';
import { Message } from './state/sessionState.js';

/** Protocol payload shared by every client that starts an Agent Host turn. */
export interface IAgentHostTurnSubmission {
	readonly turnId: string;
	readonly startedAt: string;
	readonly message: Message;
}

/** Dispatches a turn start through the connection's optimistic protocol path. */
export function submitAgentHostTurn(connection: IAgentConnection, chat: URI | string, submission: IAgentHostTurnSubmission): void {
	connection.dispatch(typeof chat === 'string' ? chat : chat.toString(), {
		type: ActionType.ChatTurnStarted,
		...submission,
	});
}

/** Dispatches a normalized turn cancellation through the same protocol path. */
export function cancelAgentHostTurn(connection: IAgentConnection, chat: URI | string, turnId: string, duration: number): void {
	connection.dispatch(typeof chat === 'string' ? chat : chat.toString(), {
		type: ActionType.ChatTurnCancelled,
		turnId,
		duration: Number.isFinite(duration) ? Math.max(0, duration) : 0,
	});
}
