/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize, localize2 } from '../../../../nls.js';
import { Categories } from '../../../../platform/action/common/actionCommonCategories.js';
import { Action2, MenuId, registerAction2 } from '../../../../platform/actions/common/actions.js';
import { ConfigurationTarget, IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { ServicesAccessor } from '../../../../platform/instantiation/common/instantiation.js';
import { INotificationService } from '../../../../platform/notification/common/notification.js';
import product from '../../../../platform/product/common/product.js';
import { ChatContextKeys } from '../common/actions/chatContextKeys.js';
import { ChatConfiguration } from '../common/constants.js';

const DAY_MS = 24 * 60 * 60 * 1000;

class AdvanceSessionLifecycleTimeAction extends Action2 {

	static readonly ID = 'sessions.github.advanceSessionLifecycleTime';

	constructor() {
		super({
			id: AdvanceSessionLifecycleTimeAction.ID,
			title: localize2('advanceSessionLifecycleTime', "Advance Session Cleanup Time by One Day"),
			category: Categories.Developer,
			precondition: ChatContextKeys.enabled,
			menu: [{ id: MenuId.CommandPalette, when: ChatContextKeys.enabled }],
		});
	}

	override async run(accessor: ServicesAccessor): Promise<void> {
		const configurationService = accessor.get(IConfigurationService);
		const notificationService = accessor.get(INotificationService);
		const currentOffset = getSessionLifecycleTimeOffset(configurationService);
		const newOffset = currentOffset + 1;
		await configurationService.updateValue(ChatConfiguration.SessionLifecycleTimeOffsetDays, newOffset, ConfigurationTarget.APPLICATION);

		const simulatedDate = new Date(Date.now() + newOffset * DAY_MS).toLocaleString();
		notificationService.info(localize('sessionLifecycleTimeAdvanced', "Session cleanup time advanced by one day to {0}. The total offset is {1} days.", simulatedDate, newOffset));
	}
}

class ResetSessionLifecycleTimeAction extends Action2 {

	static readonly ID = 'sessions.github.resetSessionLifecycleTime';

	constructor() {
		super({
			id: ResetSessionLifecycleTimeAction.ID,
			title: localize2('resetSessionLifecycleTime', "Reset Session Cleanup Time"),
			category: Categories.Developer,
			precondition: ChatContextKeys.enabled,
			menu: [{ id: MenuId.CommandPalette, when: ChatContextKeys.enabled }],
		});
	}

	override async run(accessor: ServicesAccessor): Promise<void> {
		const configurationService = accessor.get(IConfigurationService);
		const notificationService = accessor.get(INotificationService);
		await configurationService.updateValue(ChatConfiguration.SessionLifecycleTimeOffsetDays, 0, ConfigurationTarget.APPLICATION);
		notificationService.info(localize('sessionLifecycleTimeReset', "Session cleanup time reset to the current date and time."));
	}
}

function getSessionLifecycleTimeOffset(configurationService: IConfigurationService): number {
	const value = configurationService.getValue<number>(ChatConfiguration.SessionLifecycleTimeOffsetDays);
	return Number.isInteger(value) && value > 0 ? value : 0;
}

if (!product.commit) {
	registerAction2(AdvanceSessionLifecycleTimeAction);
	registerAction2(ResetSessionLifecycleTimeAction);
}
