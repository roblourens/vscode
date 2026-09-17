/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { mainWindow } from '../../../../../base/browser/window.js';
import { mock } from '../../../../../base/test/common/mock.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { ChatSessionArchiveActionWording, ChatSessionArchiveActionWordingSettingId } from '../../../../../platform/chat/common/sessionArchiveActions.js';
import { IConfigurationService } from '../../../../../platform/configuration/common/configuration.js';
import { TestConfigurationService } from '../../../../../platform/configuration/test/common/testConfigurationService.js';
import { TestInstantiationService } from '../../../../../platform/instantiation/test/common/instantiationServiceMock.js';
import { IWorkbenchLayoutService } from '../../../../../workbench/services/layout/browser/layoutService.js';
import { SessionView } from '../../../../browser/parts/sessionView.js';
import { ISessionsPartService } from '../../../../services/sessions/browser/sessionsPartService.js';
import { ISessionsService } from '../../../../services/sessions/browser/sessionsService.js';
import { SESSION_ARCHIVE_NUDGE_SETTING } from '../../browser/sessionArchiveNudge.js';
import { SessionsChatAccessibilityHelp, SessionsChatAccessibleView } from '../../browser/sessionsChatAccessibilityHelp.js';

suite('SessionsChatAccessibilityHelp', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();

	test('describes forking to the side and the keyboard-only alternative', () => {
		const instantiationService = store.add(new TestInstantiationService());
		const configuration = new TestConfigurationService();
		store.add(configuration.onDidChangeConfigurationEmitter);
		instantiationService.stub(IConfigurationService, configuration);
		instantiationService.stub(ISessionsPartService, new class extends mock<ISessionsPartService>() {
			override getFocusedSessionView(): SessionView | undefined {
				return undefined;
			}
			override getSessionView(): SessionView | undefined {
				return undefined;
			}
		}());
		instantiationService.stub(ISessionsService, new class extends mock<ISessionsService>() { }());
		instantiationService.stub(IWorkbenchLayoutService, { mainContainer: mainWindow.document.createElement('div') });
		const provider = store.add(new SessionsChatAccessibilityHelp().getProvider(instantiationService));

		assert.strictEqual(
			provider.provideContent().split('\n').find(line => line.startsWith('Alt-click')),
			'Alt-click, or Option-click on macOS, the Fork Conversation button at a checkpoint to open the fork beside its source. Ordinary activation keeps its existing behavior. With the keyboard, activate Fork Conversation, reopen the source from the Sessions list, then choose Open to the Side from the fork\'s context menu.',
		);
	});

	test('provides accessible content from the focused chat renderer', () => {
		const instantiationService = store.add(new TestInstantiationService());
		const sessionView = new class extends mock<SessionView>() {
			override getAccessibleContent(): string | undefined {
				return 'You:\nValidate the renderer.\nAgent:\nTool: Run Tests (Completed)';
			}
		}();
		instantiationService.stub(ISessionsPartService, new class extends mock<ISessionsPartService>() {
			override getFocusedSessionView(): SessionView | undefined {
				return sessionView;
			}
		}());
		instantiationService.stub(ISessionsService, new class extends mock<ISessionsService>() { }());

		const provider = new SessionsChatAccessibleView().getProvider(instantiationService);
		assert.ok(provider);
		store.add(provider);

		assert.strictEqual(provider.provideContent(), 'You:\nValidate the renderer.\nAgent:\nTool: Run Tests (Completed)');
	});

	for (const { wording, action, dismiss } of [
		{ wording: ChatSessionArchiveActionWording.Archive, action: 'Archive', dismiss: 'Dismiss Archive Suggestion' },
		{ wording: ChatSessionArchiveActionWording.MarkAsDone, action: 'Mark as Done', dismiss: 'Dismiss Mark as Done Suggestion' },
	]) {
		test(`describes the actual dismiss control and Escape for ${action}`, () => {
			const instantiationService = store.add(new TestInstantiationService());
			const configuration = new TestConfigurationService({
				[SESSION_ARCHIVE_NUDGE_SETTING]: true,
				[ChatSessionArchiveActionWordingSettingId]: wording,
			});
			store.add(configuration.onDidChangeConfigurationEmitter);
			instantiationService.stub(IConfigurationService, configuration);
			instantiationService.stub(ISessionsPartService, new class extends mock<ISessionsPartService>() {
				override getFocusedSessionView(): SessionView | undefined {
					return undefined;
				}
				override getSessionView(): SessionView | undefined {
					return undefined;
				}
			}());
			instantiationService.stub(ISessionsService, new class extends mock<ISessionsService>() { }());
			instantiationService.stub(IWorkbenchLayoutService, { mainContainer: mainWindow.document.createElement('div') });
			const provider = store.add(new SessionsChatAccessibilityHelp().getProvider(instantiationService));
			const content = provider.provideContent();
			const nudgeHelp = content.split('\n').find(line => line.includes('suggestion may appear'));

			assert.deepStrictEqual({
				controls: nudgeHelp?.includes(`Use Tab or Shift+Tab to reach ${action}, Configure Automatic Cleanup, or ${dismiss}, then Enter or Space to activate it.`),
				cleanupSettings: nudgeHelp?.includes('Configure Automatic Cleanup opens the settings for automatically archiving inactive merged sessions and permanently deleting automatically archived merged sessions.'),
				escape: nudgeHelp?.includes(`${dismiss}, or Escape while the suggestion is focused, hides the suggestion`),
				focus: nudgeHelp?.includes('returns focus to the chat input'),
				close: nudgeHelp?.includes('Close'),
				onboarding: content.includes('The action waits until you activate the highlighted action, activate Understood, or press Escape to end the spotlight.'),
			}, { controls: true, cleanupSettings: true, escape: true, focus: true, close: false, onboarding: true });
		});
	}
});
