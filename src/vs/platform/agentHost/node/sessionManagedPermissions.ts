/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { SessionEvent } from '@github/copilot-sdk';

/**
 * Runtime-owned bypass boundary projected from
 * `session.managed_settings_resolved`. Distinct from VS Code's
 * `autoApprovePolicyRestricted` root flag: `disable` blocks Allow All / yolo
 * but leaves assisted approval available.
 */
export interface ISessionManagedPermissionPolicy {
	readonly resolved: boolean;
	readonly failClosed: boolean;
	readonly bypassPermissionsDisabled: boolean;
}

/** How long turn-start waits for the runtime's first managed-settings snapshot. */
export const MANAGED_PERMISSION_RESOLUTION_TIMEOUT_MS = 5_000;

export type ManagedBypassState = 'allowed' | 'disabled' | 'fail-closed' | 'unresolved';

export function managedBypassState(policy: ISessionManagedPermissionPolicy | undefined): ManagedBypassState {
	if (!policy?.resolved) {
		return 'unresolved';
	}
	if (policy.failClosed) {
		return 'fail-closed';
	}
	return policy.bypassPermissionsDisabled ? 'disabled' : 'allowed';
}

/** Allow All may be requested only after a non-restrictive resolved snapshot. */
export function allowsManagedBypass(policy: ISessionManagedPermissionPolicy | undefined): boolean {
	return managedBypassState(policy) === 'allowed';
}

export function projectCopilotPermissionPolicy(data: Extract<SessionEvent, { type: 'session.managed_settings_resolved' }>['data']): ISessionManagedPermissionPolicy {
	const failClosed = data.failClosed === true;
	return {
		resolved: true,
		failClosed,
		bypassPermissionsDisabled: failClosed || data.bypassPermissionsDisabled === true,
	};
}
