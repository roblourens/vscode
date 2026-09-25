/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IPolicyData } from '../../../../base/common/defaultAccount.js';
import { SessionConfigKey } from '../../../../platform/agentHost/common/sessionConfigKeys.js';
import { IConfigurationService, IConfigurationValue } from '../../../../platform/configuration/common/configuration.js';
import { COPILOT_DISABLE_BYPASS_PERMISSIONS_MODE_KEY } from '../../../../platform/policy/common/copilotManagedSettings.js';
import { ChatConfiguration, ChatPermissionLevel, getChatPermissionLevelFromDefaultConfiguration, isChatPermissionLevel, type IChatDefaultConfiguration } from './constants.js';

export function autoApprovePolicyValue(policyData: IPolicyData): false | undefined {
	return policyData.managedSettings?.[COPILOT_DISABLE_BYPASS_PERMISSIONS_MODE_KEY] === 'disable' ? false : undefined;
}

export function isAutoApprovePolicyRestricted(configurationService: IConfigurationService): boolean {
	return configurationService.inspect<boolean>(ChatConfiguration.GlobalAutoApprove).policyValue === false;
}

export function isAutoApproveValuePolicyRestricted(value: unknown, policyRestricted: boolean): boolean {
	return policyRestricted && value !== ChatPermissionLevel.Default;
}

export function normalizeSessionConfigValue(property: string, value: string, policyRestricted: boolean): string;
export function normalizeSessionConfigValue(property: string, value: unknown, policyRestricted: boolean): unknown;
export function normalizeSessionConfigValue(property: string, value: unknown, policyRestricted: boolean): unknown {
	if (property === SessionConfigKey.AutoApprove && isAutoApproveValuePolicyRestricted(value, policyRestricted)) {
		return ChatPermissionLevel.Default;
	}
	return value;
}

/**
 * `autoApprove` seed for a new Agent Host session, including Copilot SDK
 * harness sessions.
 *
 * Precedence: `chat.defaultConfiguration` policy > remembered pick >
 * explicitly configured `chat.defaultConfiguration.approvals` >
 * `chat.permissions.default` > effective/schema `chat.defaultConfiguration.approvals`.
 *
 * Schema-default `approvals: 'manual'` must not mask `chat.permissions.default`.
 * Elevated values are clamped to {@link ChatPermissionLevel.Default} when
 * enterprise policy disables global auto-approval.
 */
export function getConfiguredNewSessionAutoApprove(
	configurationService: IConfigurationService,
	options?: { remembered?: unknown },
): ChatPermissionLevel | undefined {
	const policyRestricted = isAutoApprovePolicyRestricted(configurationService);
	const inspected = configurationService.inspect<IChatDefaultConfiguration>(ChatConfiguration.DefaultConfiguration);
	return normalizeAutoApproveValue(inspected.policyValue?.approvals, policyRestricted)
		?? normalizeAutoApproveValue(options?.remembered, policyRestricted)
		?? normalizeAutoApproveValue(getExplicitDefaultConfigurationApprovals(inspected), policyRestricted)
		?? normalizeAutoApproveValue(configurationService.getValue(ChatConfiguration.DefaultPermissionLevel), policyRestricted)
		?? normalizeAutoApproveValue(inspected.value?.approvals, policyRestricted);
}

function normalizeAutoApproveValue(value: unknown, policyRestricted: boolean): ChatPermissionLevel | undefined {
	const normalized = getChatPermissionLevelFromDefaultConfiguration(value) ?? (isChatPermissionLevel(value) ? value : undefined);
	if (!normalized) {
		return undefined;
	}
	return isAutoApproveValuePolicyRestricted(normalized, policyRestricted) ? ChatPermissionLevel.Default : normalized;
}

function getExplicitDefaultConfigurationApprovals(inspected: IConfigurationValue<IChatDefaultConfiguration>): unknown {
	for (const layer of [
		inspected.memoryValue,
		inspected.workspaceFolderValue,
		inspected.workspaceValue,
		inspected.userValue,
		inspected.applicationValue,
	]) {
		if (layer?.approvals !== undefined) {
			return layer.approvals;
		}
	}
	return undefined;
}
