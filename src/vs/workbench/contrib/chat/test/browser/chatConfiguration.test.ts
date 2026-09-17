/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { isIMenuItem, MenuId, MenuRegistry } from '../../../../../platform/actions/common/actions.js';
import { Extensions as ConfigurationExtensions, IConfigurationRegistry } from '../../../../../platform/configuration/common/configurationRegistry.js';
import { Registry } from '../../../../../platform/registry/common/platform.js';
import '../../browser/sessionLifecycleActions.js';
import { ChatContextKeys } from '../../common/actions/chatContextKeys.js';
import { ChatConfiguration } from '../../common/constants.js';
import '../../browser/agentSessionsConfiguration.js';

const configurationProperties = Registry.as<IConfigurationRegistry>(ConfigurationExtensions.Configuration).getConfigurationProperties();
const registeredAgentSessionsSettings = [
	ChatConfiguration.UnifiedWorkspacePicker,
	ChatConfiguration.AutoArchiveMergedSessionsAfterDays,
	ChatConfiguration.AutoDeleteArchivedMergedSessionsAfterDays,
	ChatConfiguration.SessionLifecycleTimeOffsetDays,
].map(key => configurationProperties[key] !== undefined);

suite('Chat configuration', () => {

	ensureNoDisposablesAreLeakedInTestSuite();

	test('registers Agents Window settings in the shared workbench contribution', () => {
		assert.deepStrictEqual(registeredAgentSessionsSettings, [true, true, true, true]);
	});

	test('contributes session lifecycle time controls to the command palette', () => {
		const commandIds = new Set([
			'sessions.github.advanceSessionLifecycleTime',
			'sessions.github.resetSessionLifecycleTime',
		]);
		const items = MenuRegistry.getMenuItems(MenuId.CommandPalette)
			.filter(isIMenuItem)
			.filter(item => commandIds.has(item.command.id));

		assert.deepStrictEqual(items.map(item => ({
			id: item.command.id,
			title: typeof item.command.title === 'string' ? item.command.title : item.command.title.value,
			when: item.when?.serialize(),
			precondition: item.command.precondition?.serialize(),
		})), [
			{
				id: 'sessions.github.advanceSessionLifecycleTime',
				title: 'Advance Session Cleanup Time by One Day',
				when: ChatContextKeys.enabled.key,
				precondition: ChatContextKeys.enabled.key,
			},
			{
				id: 'sessions.github.resetSessionLifecycleTime',
				title: 'Reset Session Cleanup Time',
				when: ChatContextKeys.enabled.key,
				precondition: ChatContextKeys.enabled.key,
			},
		]);
	});
});
