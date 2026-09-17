/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { afterEach, beforeEach, suite, test } from 'vitest';
import { CopilotToken, createTestExtendedTokenInfo } from '../../../authentication/common/copilotToken';
import { IAuthenticationService } from '../../../authentication/common/authentication';
import { setCopilotToken, StaticGitHubAuthenticationService } from '../../../authentication/common/staticGitHubAuthenticationService';
import { ConfigKey, IConfigurationService } from '../../../configuration/common/configurationService';
import { EmbeddingType } from '../../../embeddings/common/embeddingsComputer';
import { IGitExtensionService } from '../../../git/common/gitExtensionService';
import { IGitService } from '../../../git/common/gitService';
import { NullGitExtensionService } from '../../../git/common/nullGitExtensionService';
import { MockGitService } from '../../../ignore/node/test/mockGitService';
import { MockSearchService } from '../../../ignore/node/test/mockSearchService';
import { IAdoCodeSearchService } from '../../../remoteCodeSearch/common/adoCodeSearchService';
import { ISearchService } from '../../../search/common/searchService';
import { createPlatformServices, TestingServiceCollection } from '../../../test/node/services';
import { TestWorkspaceService } from '../../../test/node/testWorkspaceService';
import { IWorkspaceService } from '../../../workspace/common/workspaceService';
import { Event } from '../../../../util/vs/base/common/event';
import { DisposableStore } from '../../../../util/vs/base/common/lifecycle';
import { timeout } from '../../../../util/vs/base/common/async';
import { URI } from '../../../../util/vs/base/common/uri';
import { SyncDescriptor } from '../../../../util/vs/platform/instantiation/common/descriptors';
import { IInstantiationService } from '../../../../util/vs/platform/instantiation/common/instantiation';
import { CodeSearchChunkSearch } from '../../node/codeSearch/codeSearchChunkSearch';
import { NullWorkspaceFileIndex } from '../../node/nullWorkspaceFileIndex';
import { IWorkspaceFileIndex } from '../../node/workspaceFileIndex';

class NullAdoCodeSearchService implements IAdoCodeSearchService {
	declare readonly _serviceBrand: undefined;
	readonly onDidChangeIndexState = Event.None;

	async getRemoteIndexState(): Promise<never> {
		throw new Error('not used');
	}

	async triggerIndexing(): Promise<never> {
		throw new Error('not used');
	}

	async searchRepo(): Promise<never> {
		throw new Error('not used');
	}
}

suite('CodeSearchChunkSearch idle indexing', () => {
	const disposables = new DisposableStore();
	let testingServiceCollection: TestingServiceCollection;
	let searchService: MockSearchService;

	beforeEach(() => {
		testingServiceCollection = disposables.add(createPlatformServices());
		searchService = new MockSearchService();
		searchService.setResults([URI.file('/workspace/src/app.ts')]);
		testingServiceCollection.define(ISearchService, searchService);
		testingServiceCollection.define(IGitExtensionService, new NullGitExtensionService());
		testingServiceCollection.define(IGitService, new MockGitService());
		testingServiceCollection.define(IWorkspaceFileIndex, new NullWorkspaceFileIndex());
		testingServiceCollection.define(IAdoCodeSearchService, new NullAdoCodeSearchService());
		testingServiceCollection.define(IWorkspaceService, new TestWorkspaceService([URI.file('/workspace')]));
		testingServiceCollection.define(IAuthenticationService, new SyncDescriptor(StaticGitHubAuthenticationService, [() => 'tid=test']));
	});

	afterEach(() => {
		disposables.clear();
	});

	test('idle status checks do not walk the workspace for external ingest', async () => {
		const accessor = disposables.add(testingServiceCollection.createTestingAccessor());
		const configurationService = accessor.get(IConfigurationService);
		await configurationService.setConfig(ConfigKey.Advanced.WorkspaceEnableCodeSearch, true);
		await configurationService.setConfig(ConfigKey.Advanced.WorkspaceEnableCodeSearchExternalIngest, true);

		setCopilotToken(accessor.get(IAuthenticationService), new CopilotToken(createTestExtendedTokenInfo({
			token: 'blackbird_external_indexing=1;tid=test',
			username: 'test',
			copilot_plan: 'individual',
		})));

		const search = disposables.add(accessor.get(IInstantiationService).createInstance(CodeSearchChunkSearch, EmbeddingType.text3small_512));
		assert.ok(search.isExternalIngestEnabled(), 'Test setup must enable external ingest so a scan would have run before this fix');

		search.getRemoteIndexState(false);
		await timeout(50);

		const state = search.getRemoteIndexState(false);
		assert.notStrictEqual(state.status, 'disabled');
		assert.strictEqual(searchService.findFilesCallCount, 0, 'Idle getRemoteIndexState must not reconcile/scan workspace files');
	});
});
