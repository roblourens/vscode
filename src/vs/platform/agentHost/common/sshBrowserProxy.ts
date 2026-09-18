/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { URI } from '../../../base/common/uri.js';
import { findRemoteAgentHostSessionTypeAuthority } from './agentHostSessionType.js';
import { agentHostAuthority } from './agentHostUri.js';
import { RemoteAgentHostEntryType, type IRemoteAgentHostConnectionInfo, type IRemoteAgentHostEntry } from './remoteAgentHostService.js';

/**
 * Address of the SSH remote agent host that should proxy integrated-browser
 * traffic for {@link sessionResource}, or `undefined` when the session is
 * local / not SSH-backed.
 *
 * Agents-window remote sessions have no vscode-remote `remoteAuthority`, so
 * the existing window-wide browser tunnel proxy never starts. SSH AHP
 * connections already have a live `forwardOut` path; this helper is how the
 * browser tools find it.
 */
export function getSshBrowserProxyAddress(
	sessionResource: URI | undefined,
	connections: readonly IRemoteAgentHostConnectionInfo[],
	getEntry: (address: string) => IRemoteAgentHostEntry | undefined,
): string | undefined {
	if (!sessionResource) {
		return undefined;
	}

	const authority = findRemoteAgentHostSessionTypeAuthority(
		sessionResource.scheme,
		connections.map(connection => agentHostAuthority(connection.address)),
	);
	if (!authority) {
		return undefined;
	}

	const connection = connections.find(candidate => agentHostAuthority(candidate.address) === authority);
	if (!connection) {
		return undefined;
	}

	return getEntry(connection.address)?.connection.type === RemoteAgentHostEntryType.SSH
		? connection.address
		: undefined;
}
