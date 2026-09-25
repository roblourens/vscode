/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { TestConfigurationService } from '../../../../../platform/configuration/test/common/testConfigurationService.js';
import { ChatConfiguration, ChatPermissionLevel } from '../../common/constants.js';
import { getConfiguredNewSessionAutoApprove } from '../../common/agentHostConfigPolicy.js';

suite('getConfiguredNewSessionAutoApprove', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('maps chat.permissions.default when chat.defaultConfiguration approvals is only a schema default', async () => {
		const config = new class extends TestConfigurationService {
			override inspect<T>(key: string) {
				const base = super.inspect<T>(key);
				if (key === ChatConfiguration.DefaultConfiguration && base.userValue === undefined) {
					const schemaDefault = { mode: 'interactive', approvals: 'manual' } as unknown as T;
					return { ...base, value: schemaDefault, defaultValue: schemaDefault };
				}
				return base;
			}
		}();
		await config.setUserConfiguration(ChatConfiguration.DefaultPermissionLevel, ChatPermissionLevel.AutoApprove);

		assert.strictEqual(getConfiguredNewSessionAutoApprove(config), ChatPermissionLevel.AutoApprove);
	});

	test('lets an explicit chat.defaultConfiguration approvals value win', async () => {
		const config = new TestConfigurationService();
		await config.setUserConfiguration(ChatConfiguration.DefaultPermissionLevel, ChatPermissionLevel.AutoApprove);
		await config.setUserConfiguration(ChatConfiguration.DefaultConfiguration, { approvals: 'assisted' });

		assert.strictEqual(getConfiguredNewSessionAutoApprove(config), ChatPermissionLevel.Assisted);
	});

	test('lets a remembered pick win over chat.permissions.default', async () => {
		const config = new TestConfigurationService();
		await config.setUserConfiguration(ChatConfiguration.DefaultPermissionLevel, ChatPermissionLevel.AutoApprove);

		assert.strictEqual(
			getConfiguredNewSessionAutoApprove(config, { remembered: ChatPermissionLevel.Assisted }),
			ChatPermissionLevel.Assisted,
		);
	});

	test('clamps chat.permissions.default autoApprove when policy disables global auto-approve', async () => {
		const config = new class extends TestConfigurationService {
			override inspect<T>(key: string) {
				const base = super.inspect<T>(key);
				if (key === ChatConfiguration.GlobalAutoApprove) {
					return { ...base, policyValue: false as unknown as T };
				}
				return base;
			}
		}();
		await config.setUserConfiguration(ChatConfiguration.DefaultPermissionLevel, ChatPermissionLevel.AutoApprove);

		assert.strictEqual(getConfiguredNewSessionAutoApprove(config), ChatPermissionLevel.Default);
	});
});
