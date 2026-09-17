/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../../../base/common/lifecycle.js';
import { derived, observableSignalFromEvent, observableValue } from '../../../../../../base/common/observable.js';
import { IAction } from '../../../../../../base/common/actions.js';
import { IInstantiationService } from '../../../../../../platform/instantiation/common/instantiation.js';
import { IChatInputPickerOptions } from '../../../../../../workbench/contrib/chat/browser/widget/input/chatInputPickerActionItem.js';
import { IModelPickerDelegate, ModelPickerActionItem } from '../../../../../../workbench/contrib/chat/browser/widget/input/modelPicker/modelPickerActionItem.js';
import { IChat, ChatModelSource, SessionStatus } from '../../../../../services/sessions/common/session.js';
import { IActiveSession } from '../../../../../services/sessions/common/sessionsManagement.js';
import { ISessionsProvider } from '../../../../../services/sessions/common/sessionsProvider.js';
import { normalizeModelPickerOptions } from '../../../../chat/browser/sessionModelPickerState.js';

/** Hosts the shared workbench model picker for one committed Agent Host chat. */
export class AgentHostChatModelPicker extends Disposable {

	private readonly _compact = observableValue(this, false);
	private readonly _modelsChanged;
	private readonly _picker: ModelPickerActionItem;

	constructor(
		private readonly _provider: ISessionsProvider,
		private readonly _session: IActiveSession,
		private readonly _chat: IChat,
		@IInstantiationService instantiationService: IInstantiationService,
	) {
		super();
		this._modelsChanged = observableSignalFromEvent(this, _provider.onDidChangeModels);
		const currentModel = derived(this, reader => {
			this._modelsChanged.read(reader);
			const modelId = this._chat.modelId.read(reader);
			if (!modelId) {
				return undefined;
			}
			const resolution = this._provider.getModelsSnapshot(this._session.sessionId, modelId).desiredModelResolution;
			return resolution.kind === 'available' ? resolution.model : undefined;
		});
		const delegate: IModelPickerDelegate = {
			currentModel,
			setModel: model => this._provider.setModel(this._session.sessionId, this._chat.resource, model.identifier, ChatModelSource.Chosen),
			getModels: () => [...this._provider.getModelsSnapshot(this._session.sessionId, this._chat.modelId.get()).models],
			getPresentationOptions: () => ({
				...normalizeModelPickerOptions(this._provider.getModelPickerOptions(this._session.sessionId)),
				showModelIcon: true,
			}),
			getChatSessionId: () => this._session.sessionId,
			isCacheWarm: () => this._chat.status.get() !== SessionStatus.Untitled,
		};
		const options: IChatInputPickerOptions = { compact: this._compact };
		const action: IAction = { id: 'sessions.modelPicker', label: '', enabled: true, class: undefined, tooltip: '', run: () => { } };
		this._picker = this._register(instantiationService.createInstance(ModelPickerActionItem, action, delegate, options));
	}

	render(container: HTMLElement): void {
		this._picker.render(container);
	}

	layout(width: number): void {
		this._compact.set(width < 480, undefined);
	}
}
