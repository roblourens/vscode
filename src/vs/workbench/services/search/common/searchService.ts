/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as arrays from 'vs/base/common/arrays';
import { DeferredPromise, raceCancellationError } from 'vs/base/common/async';
import { CancellationToken } from 'vs/base/common/cancellation';
import { CancellationError } from 'vs/base/common/errors';
import { Disposable, IDisposable, toDisposable } from 'vs/base/common/lifecycle';
import { ResourceMap, ResourceSet } from 'vs/base/common/map';
import { Schemas } from 'vs/base/common/network';
import { StopWatch } from 'vs/base/common/stopwatch';
import { isNumber } from 'vs/base/common/types';
import { URI, URI as uri } from 'vs/base/common/uri';
import { IModelService } from 'vs/editor/common/services/model';
import { IFileService } from 'vs/platform/files/common/files';
import { ILogService } from 'vs/platform/log/common/log';
import { ITelemetryService } from 'vs/platform/telemetry/common/telemetry';
import { IUriIdentityService } from 'vs/platform/uriIdentity/common/uriIdentity';
import { EditorResourceAccessor, SideBySideEditor } from 'vs/workbench/common/editor';
import { IEditorService } from 'vs/workbench/services/editor/common/editorService';
import { IExtensionService } from 'vs/workbench/services/extensions/common/extensions';
import { deserializeSearchError, FileMatch, IAITextQuery, ICachedSearchStats, IFileMatch, IFileQuery, IFileSearchStats, IFolderQuery, IProgressMessage, ISearchComplete, ISearchEngineStats, ISearchProgressItem, ISearchQuery, ISearchResultProvider, ISearchService, isFileMatch, isProgressMessage, ITextQuery, pathIncludedInQuery, QueryType, SEARCH_RESULT_LANGUAGE_ID, SearchError, SearchErrorCode, SearchProviderType } from 'vs/workbench/services/search/common/search';
import { getTextSearchMatchWithModelContext, editorMatchesToTextSearchResults } from 'vs/workbench/services/search/common/searchHelpers';

/**
 * The main search service implementation for VS Code.
 * Manages text search, file search, and AI-powered text search across the workspace.
 * Coordinates multiple search providers for different URI schemes (file://, http://, etc.)
 * and combines results from both open editors and the file system.
 */
export class SearchService extends Disposable implements ISearchService {

	declare readonly _serviceBrand: undefined;

	/** Map of file search providers keyed by URI scheme (e.g., 'file', 'vscode-remote') */
	private readonly fileSearchProviders = new Map<string, ISearchResultProvider>();
	/** Map of text search providers keyed by URI scheme */
	private readonly textSearchProviders = new Map<string, ISearchResultProvider>();
	/** Map of AI-powered text search providers keyed by URI scheme */
	private readonly aiTextSearchProviders = new Map<string, ISearchResultProvider>();

	/** Deferred promises waiting for file search providers to be registered for specific schemes */
	private deferredFileSearchesByScheme = new Map<string, DeferredPromise<ISearchResultProvider>>();
	/** Deferred promises waiting for text search providers to be registered for specific schemes */
	private deferredTextSearchesByScheme = new Map<string, DeferredPromise<ISearchResultProvider>>();
	/** Deferred promises waiting for AI text search providers to be registered for specific schemes */
	private deferredAITextSearchesByScheme = new Map<string, DeferredPromise<ISearchResultProvider>>();

	/** Track schemes that have been logged as missing providers to avoid duplicate warnings */
	private loggedSchemesMissingProviders = new Set<string>();

	constructor(
		@IModelService private readonly modelService: IModelService,
		@IEditorService private readonly editorService: IEditorService,
		@ITelemetryService private readonly telemetryService: ITelemetryService,
		@ILogService private readonly logService: ILogService,
		@IExtensionService private readonly extensionService: IExtensionService,
		@IFileService private readonly fileService: IFileService,
		@IUriIdentityService private readonly uriIdentityService: IUriIdentityService,
	) {
		super();
	}

	/**
	 * Registers a search result provider for a specific URI scheme and search type.
	 * Providers enable search functionality for different types of file systems and resources.
	 * @param scheme - The URI scheme (e.g., 'file', 'vscode-remote', 'http')
	 * @param type - The type of search provider (file, text, or AI text)
	 * @param provider - The provider implementation
	 * @returns A disposable to unregister the provider
	 */
	registerSearchResultProvider(scheme: string, type: SearchProviderType, provider: ISearchResultProvider): IDisposable {
		let list: Map<string, ISearchResultProvider>;
		let deferredMap: Map<string, DeferredPromise<ISearchResultProvider>>;
		if (type === SearchProviderType.file) {
			list = this.fileSearchProviders;
			deferredMap = this.deferredFileSearchesByScheme;
		} else if (type === SearchProviderType.text) {
			list = this.textSearchProviders;
			deferredMap = this.deferredTextSearchesByScheme;
		} else if (type === SearchProviderType.aiText) {
			list = this.aiTextSearchProviders;
			deferredMap = this.deferredAITextSearchesByScheme;
		} else {
			throw new Error('Unknown SearchProviderType');
		}

		list.set(scheme, provider);

		if (deferredMap.has(scheme)) {
			deferredMap.get(scheme)!.complete(provider);
			deferredMap.delete(scheme);
		}

		return toDisposable(() => {
			list.delete(scheme);
		});
	}

	/**
	 * Performs a text search across the workspace.
	 * Combines results from open editors (synchronously) with file system search results (asynchronously).
	 * @param query - The text search query parameters
	 * @param token - Cancellation token to abort the search
	 * @param onProgress - Callback for reporting search progress
	 * @returns Search results including all matches, whether the result limit was hit, and any messages
	 */
	async textSearch(query: ITextQuery, token?: CancellationToken, onProgress?: (item: ISearchProgressItem) => void): Promise<ISearchComplete> {
		const results = this.textSearchSplitSyncAsync(query, token, onProgress);
		const openEditorResults = results.syncResults;
		const otherResults = await results.asyncResults;
		return {
			limitHit: otherResults.limitHit || openEditorResults.limitHit,
			results: [...otherResults.results, ...openEditorResults.results],
			messages: [...otherResults.messages, ...openEditorResults.messages]
		};
	}

	/**
	 * Performs an AI-powered text search across the workspace.
	 * Uses AI/semantic search providers when available for more intelligent results.
	 * @param query - The AI text search query parameters
	 * @param token - Cancellation token to abort the search
	 * @param onProgress - Callback for reporting search progress
	 * @returns Search results from the AI provider
	 */
	async aiTextSearch(query: IAITextQuery, token?: CancellationToken, onProgress?: (item: ISearchProgressItem) => void): Promise<ISearchComplete> {
		const onProviderProgress = (progress: ISearchProgressItem) => {
			// Match
			if (onProgress) { // don't override open editor results
				if (isFileMatch(progress)) {
					onProgress(progress);
				} else {
					onProgress(<IProgressMessage>progress);
				}
			}

			if (isProgressMessage(progress)) {
				this.logService.debug('SearchService#search', progress.message);
			}
		};
		return this.doSearch(query, token, onProviderProgress);
	}

	/**
	 * Splits text search into synchronous (open editors) and asynchronous (file system) parts.
	 * This allows immediate results from open/dirty files while file system search runs in the background.
	 * @param query - The text search query parameters
	 * @param token - Cancellation token to abort the search
	 * @param onProgress - Callback for reporting search progress
	 * @param notebookFilesToIgnore - Notebook files to exclude from sync results
	 * @param asyncNotebookFilesToIgnore - Promise of notebook files to exclude from async results
	 * @returns Object containing both sync results (from open editors) and async results (from file system)
	 */
	textSearchSplitSyncAsync(
		query: ITextQuery,
		token?: CancellationToken | undefined,
		onProgress?: ((result: ISearchProgressItem) => void) | undefined,
		notebookFilesToIgnore?: ResourceSet,
		asyncNotebookFilesToIgnore?: Promise<ResourceSet>
	): {
		syncResults: ISearchComplete;
		asyncResults: Promise<ISearchComplete>;
	} {
		// Get open editor results from dirty/untitled
		const openEditorResults = this.getOpenEditorResults(query);

		if (onProgress) {
			arrays.coalesce([...openEditorResults.results.values()]).filter(e => !(notebookFilesToIgnore && notebookFilesToIgnore.has(e.resource))).forEach(onProgress);
		}

		const syncResults: ISearchComplete = {
			results: arrays.coalesce([...openEditorResults.results.values()]),
			limitHit: openEditorResults.limitHit ?? false,
			messages: []
		};

		const getAsyncResults = async () => {
			const resolvedAsyncNotebookFilesToIgnore = await asyncNotebookFilesToIgnore ?? new ResourceSet();
			const onProviderProgress = (progress: ISearchProgressItem) => {
				if (isFileMatch(progress)) {
					// Match
					if (!openEditorResults.results.has(progress.resource) && !resolvedAsyncNotebookFilesToIgnore.has(progress.resource) && onProgress) { // don't override open editor results
						onProgress(progress);
					}
				} else if (onProgress) {
					// Progress
					onProgress(<IProgressMessage>progress);
				}

				if (isProgressMessage(progress)) {
					this.logService.debug('SearchService#search', progress.message);
				}
			};
			return await this.doSearch(query, token, onProviderProgress);
		};

		return {
			syncResults,
			asyncResults: getAsyncResults()
		};
	}

	/**
	 * Performs a file search to find files matching a pattern.
	 * @param query - The file search query parameters
	 * @param token - Cancellation token to abort the search
	 * @returns Search results containing matching file paths
	 */
	fileSearch(query: IFileQuery, token?: CancellationToken): Promise<ISearchComplete> {
		return this.doSearch(query, token);
	}

	/**
	 * Core search execution method that handles provider activation, folder validation, and result aggregation.
	 * Activates extensions that provide search functionality, filters non-existent folders, and combines results from all providers.
	 * @param query - The search query (file, text, or AI text)
	 * @param token - Cancellation token to abort the search
	 * @param onProgress - Callback for reporting search progress
	 * @returns Aggregated search results from all providers
	 */
	private doSearch(query: ISearchQuery, token?: CancellationToken, onProgress?: (item: ISearchProgressItem) => void): Promise<ISearchComplete> {
		this.logService.trace('SearchService#search', JSON.stringify(query));

		const schemesInQuery = this.getSchemesInQuery(query);

		const providerActivations: Promise<any>[] = [Promise.resolve(null)];
		schemesInQuery.forEach(scheme => providerActivations.push(this.extensionService.activateByEvent(`onSearch:${scheme}`)));
		providerActivations.push(this.extensionService.activateByEvent('onSearch:file'));

		const providerPromise = (async () => {
			await Promise.all(providerActivations);
			await this.extensionService.whenInstalledExtensionsRegistered();

			// Cancel faster if search was canceled while waiting for extensions
			if (token && token.isCancellationRequested) {
				return Promise.reject(new CancellationError());
			}

			const progressCallback = (item: ISearchProgressItem) => {
				if (token && token.isCancellationRequested) {
					return;
				}

				onProgress?.(item);
			};

			const exists = await Promise.all(query.folderQueries.map(query => this.fileService.exists(query.folder)));
			query.folderQueries = query.folderQueries.filter((_, i) => exists[i]);

			let completes = await this.searchWithProviders(query, progressCallback, token);
			completes = arrays.coalesce(completes);
			if (!completes.length) {
				return {
					limitHit: false,
					results: [],
					messages: [],
				};
			}

			return {
				limitHit: completes[0] && completes[0].limitHit,
				stats: completes[0].stats,
				messages: arrays.coalesce(arrays.flatten(completes.map(i => i.messages))).filter(arrays.uniqueFilter(message => message.type + message.text + message.trusted)),
				results: arrays.flatten(completes.map((c: ISearchComplete) => c.results))
			};
		})();

		return token ? raceCancellationError<ISearchComplete>(providerPromise, token) : providerPromise;
	}

	/**
	 * Extracts all unique URI schemes from the search query's folder queries and extra file resources.
	 * @param query - The search query
	 * @returns Set of URI schemes (e.g., 'file', 'vscode-remote')
	 */
	private getSchemesInQuery(query: ISearchQuery): Set<string> {
		const schemes = new Set<string>();
		query.folderQueries?.forEach(fq => schemes.add(fq.folder.scheme));

		query.extraFileResources?.forEach(extraFile => schemes.add(extraFile.scheme));

		return schemes;
	}

	/**
	 * Waits for a search provider to be registered for a specific scheme and query type.
	 * Creates a deferred promise if one doesn't exist, allowing the search to wait for provider registration.
	 * @param queryType - The type of query (File, Text, or aiText)
	 * @param scheme - The URI scheme
	 * @returns Promise that resolves when the provider is registered
	 */
	private async waitForProvider(queryType: QueryType, scheme: string): Promise<ISearchResultProvider> {
		const deferredMap: Map<string, DeferredPromise<ISearchResultProvider>> = this.getDeferredTextSearchesByScheme(queryType);

		if (deferredMap.has(scheme)) {
			return deferredMap.get(scheme)!.p;
		} else {
			const deferred = new DeferredPromise<ISearchResultProvider>();
			deferredMap.set(scheme, deferred);
			return deferred.p;
		}
	}

	/**
	 * Gets the appropriate provider map for the given query type.
	 * @param type - The query type (File, Text, or aiText)
	 * @returns Map of providers keyed by URI scheme
	 */
	private getSearchProvider(type: QueryType): Map<string, ISearchResultProvider> {
		switch (type) {
			case QueryType.File:
				return this.fileSearchProviders;
			case QueryType.Text:
				return this.textSearchProviders;
			case QueryType.aiText:
				return this.aiTextSearchProviders;
			default:
				throw new Error(`Unknown query type: ${type}`);
		}
	}

	/**
	 * Gets the appropriate deferred provider map for the given query type.
	 * Used to wait for providers that haven't been registered yet.
	 * @param type - The query type (File, Text, or aiText)
	 * @returns Map of deferred promises keyed by URI scheme
	 */
	private getDeferredTextSearchesByScheme(type: QueryType): Map<string, DeferredPromise<ISearchResultProvider>> {
		switch (type) {
			case QueryType.File:
				return this.deferredFileSearchesByScheme;
			case QueryType.Text:
				return this.deferredTextSearchesByScheme;
			case QueryType.aiText:
				return this.deferredAITextSearchesByScheme;
			default:
				throw new Error(`Unknown query type: ${type}`);
		}
	}

	/**
	 * Executes search across all registered providers for the schemes in the query.
	 * Groups folder queries by scheme, waits for/validates providers, and executes searches in parallel.
	 * @param query - The search query
	 * @param onProviderProgress - Callback for reporting progress from providers
	 * @param token - Cancellation token
	 * @returns Array of search results from all providers
	 */
	private async searchWithProviders(query: ISearchQuery, onProviderProgress: (progress: ISearchProgressItem) => void, token?: CancellationToken) {
		const e2eSW = StopWatch.create(false);

		const searchPs: Promise<ISearchComplete>[] = [];

		const fqs = this.groupFolderQueriesByScheme(query);
		const someSchemeHasProvider = [...fqs.keys()].some(scheme => {
			return this.getSearchProvider(query.type).has(scheme);
		});

		if (query.type === QueryType.aiText && !someSchemeHasProvider) {
			return [];
		}
		await Promise.all([...fqs.keys()].map(async scheme => {
			const schemeFQs = fqs.get(scheme)!;
			let provider = this.getSearchProvider(query.type).get(scheme);

			if (!provider) {
				if (someSchemeHasProvider) {
					if (!this.loggedSchemesMissingProviders.has(scheme)) {
						this.logService.warn(`No search provider registered for scheme: ${scheme}. Another scheme has a provider, not waiting for ${scheme}`);
						this.loggedSchemesMissingProviders.add(scheme);
					}
					return;
				} else {
					if (!this.loggedSchemesMissingProviders.has(scheme)) {
						this.logService.warn(`No search provider registered for scheme: ${scheme}, waiting`);
						this.loggedSchemesMissingProviders.add(scheme);
					}
					provider = await this.waitForProvider(query.type, scheme);
				}
			}

			const oneSchemeQuery: ISearchQuery = {
				...query,
				...{
					folderQueries: schemeFQs
				}
			};

			const doProviderSearch = () => {
				switch (query.type) {
					case QueryType.File:
						return provider.fileSearch(<IFileQuery>oneSchemeQuery, token);
					case QueryType.Text:
						return provider.textSearch(<ITextQuery>oneSchemeQuery, onProviderProgress, token);
					default:
						return provider.textSearch(<ITextQuery>oneSchemeQuery, onProviderProgress, token);
				}
			};

			searchPs.push(doProviderSearch());
		}));

		return Promise.all(searchPs).then(completes => {
			const endToEndTime = e2eSW.elapsed();
			this.logService.trace(`SearchService#search: ${endToEndTime}ms`);
			completes.forEach(complete => {
				this.sendTelemetry(query, endToEndTime, complete);
			});
			return completes;
		}, err => {
			const endToEndTime = e2eSW.elapsed();
			this.logService.trace(`SearchService#search: ${endToEndTime}ms`);
			const searchError = deserializeSearchError(err);
			this.logService.trace(`SearchService#searchError: ${searchError.message}`);
			this.sendTelemetry(query, endToEndTime, undefined, searchError);

			throw searchError;
		});
	}

	/**
	 * Groups folder queries by their URI scheme to enable scheme-specific provider routing.
	 * @param query - The search query containing folder queries
	 * @returns Map of folder queries grouped by URI scheme
	 */
	private groupFolderQueriesByScheme(query: ISearchQuery): Map<string, IFolderQuery[]> {
		const queries = new Map<string, IFolderQuery[]>();

		query.folderQueries.forEach(fq => {
			const schemeFQs = queries.get(fq.folder.scheme) || [];
			schemeFQs.push(fq);

			queries.set(fq.folder.scheme, schemeFQs);
		});

		return queries;
	}

	/**
	 * Sends telemetry data for search operations to track performance and usage.
	 * Includes metrics like search time, result counts, and error types.
	 * @param query - The search query
	 * @param endToEndTime - Total time taken for the search in milliseconds
	 * @param complete - Search completion data (if successful)
	 * @param err - Search error (if failed)
	 */
	private sendTelemetry(query: ISearchQuery, endToEndTime: number, complete?: ISearchComplete, err?: SearchError): void {
		const fileSchemeOnly = query.folderQueries.every(fq => fq.folder.scheme === Schemas.file);
		const otherSchemeOnly = query.folderQueries.every(fq => fq.folder.scheme !== Schemas.file);
		const scheme = fileSchemeOnly ? Schemas.file :
			otherSchemeOnly ? 'other' :
				'mixed';

		if (query.type === QueryType.File && complete && complete.stats) {
			const fileSearchStats = complete.stats as IFileSearchStats;
			if (fileSearchStats.fromCache) {
				const cacheStats: ICachedSearchStats = fileSearchStats.detailStats as ICachedSearchStats;

				type CachedSearchCompleteClassifcation = {
					owner: 'roblourens';
					comment: 'Fired when a file search is completed from previously cached results';
					reason?: { classification: 'SystemMetaData'; purpose: 'PerformanceAndHealth'; comment: 'Indicates which extension or UI feature triggered this search' };
					resultCount: { classification: 'SystemMetaData'; purpose: 'PerformanceAndHealth'; isMeasurement: true; comment: 'The number of search results' };
					workspaceFolderCount: { classification: 'SystemMetaData'; purpose: 'PerformanceAndHealth'; isMeasurement: true; comment: 'The number of folders in the workspace' };
					endToEndTime: { classification: 'SystemMetaData'; purpose: 'PerformanceAndHealth'; isMeasurement: true; comment: 'The total search time' };
					sortingTime?: { classification: 'SystemMetaData'; purpose: 'PerformanceAndHealth'; isMeasurement: true; comment: 'The amount of time spent sorting results' };
					cacheWasResolved: { classification: 'SystemMetaData'; purpose: 'PerformanceAndHealth'; comment: 'Whether the cache was already resolved when the search began' };
					cacheLookupTime: { classification: 'SystemMetaData'; purpose: 'PerformanceAndHealth'; isMeasurement: true; comment: 'The amount of time spent looking up the cache to use for the search' };
					cacheFilterTime: { classification: 'SystemMetaData'; purpose: 'PerformanceAndHealth'; isMeasurement: true; comment: 'The amount of time spent searching within the cache' };
					cacheEntryCount: { classification: 'SystemMetaData'; purpose: 'PerformanceAndHealth'; isMeasurement: true; comment: 'The number of entries in the searched-in cache' };
					scheme: { classification: 'SystemMetaData'; purpose: 'PerformanceAndHealth'; comment: 'The uri scheme of the folder searched in' };
				};
				type CachedSearchCompleteEvent = {
					reason?: string;
					resultCount: number;
					workspaceFolderCount: number;
					endToEndTime: number;
					sortingTime?: number;
					cacheWasResolved: boolean;
					cacheLookupTime: number;
					cacheFilterTime: number;
					cacheEntryCount: number;
					scheme: string;
				};
				this.telemetryService.publicLog2<CachedSearchCompleteEvent, CachedSearchCompleteClassifcation>('cachedSearchComplete', {
					reason: query._reason,
					resultCount: fileSearchStats.resultCount,
					workspaceFolderCount: query.folderQueries.length,
					endToEndTime: endToEndTime,
					sortingTime: fileSearchStats.sortingTime,
					cacheWasResolved: cacheStats.cacheWasResolved,
					cacheLookupTime: cacheStats.cacheLookupTime,
					cacheFilterTime: cacheStats.cacheFilterTime,
					cacheEntryCount: cacheStats.cacheEntryCount,
					scheme
				});
			} else {
				const searchEngineStats: ISearchEngineStats = fileSearchStats.detailStats as ISearchEngineStats;

				type SearchCompleteClassification = {
					owner: 'roblourens';
					comment: 'Fired when a file search is completed';
					reason?: { classification: 'SystemMetaData'; purpose: 'PerformanceAndHealth'; comment: 'Indicates which extension or UI feature triggered this search' };
					resultCount: { classification: 'SystemMetaData'; purpose: 'PerformanceAndHealth'; isMeasurement: true; comment: 'The number of search results' };
					workspaceFolderCount: { classification: 'SystemMetaData'; purpose: 'PerformanceAndHealth'; isMeasurement: true; comment: 'The number of folders in the workspace' };
					endToEndTime: { classification: 'SystemMetaData'; purpose: 'PerformanceAndHealth'; isMeasurement: true; comment: 'The total search time' };
					sortingTime?: { classification: 'SystemMetaData'; purpose: 'PerformanceAndHealth'; isMeasurement: true; comment: 'The amount of time spent sorting results' };
					fileWalkTime: { classification: 'SystemMetaData'; purpose: 'PerformanceAndHealth'; isMeasurement: true; comment: 'The amount of time spent walking file system' };
					directoriesWalked: { classification: 'SystemMetaData'; purpose: 'PerformanceAndHealth'; isMeasurement: true; comment: 'The number of directories walked' };
					filesWalked: { classification: 'SystemMetaData'; purpose: 'PerformanceAndHealth'; isMeasurement: true; comment: 'The number of files walked' };
					cmdTime: { classification: 'SystemMetaData'; purpose: 'PerformanceAndHealth'; isMeasurement: true; comment: 'The amount of time spent running the search command' };
					cmdResultCount?: { classification: 'SystemMetaData'; purpose: 'PerformanceAndHealth'; isMeasurement: true; comment: 'The number of results returned from the search command' };
					scheme: { classification: 'SystemMetaData'; purpose: 'PerformanceAndHealth'; comment: 'The uri scheme of the folder searched in' };
				};
				type SearchCompleteEvent = {
					reason?: string;
					resultCount: number;
					workspaceFolderCount: number;
					endToEndTime: number;
					sortingTime?: number;
					fileWalkTime: number;
					directoriesWalked: number;
					filesWalked: number;
					cmdTime: number;
					cmdResultCount?: number;
					scheme: string;

				};

				this.telemetryService.publicLog2<SearchCompleteEvent, SearchCompleteClassification>('searchComplete', {
					reason: query._reason,
					resultCount: fileSearchStats.resultCount,
					workspaceFolderCount: query.folderQueries.length,
					endToEndTime: endToEndTime,
					sortingTime: fileSearchStats.sortingTime,
					fileWalkTime: searchEngineStats.fileWalkTime,
					directoriesWalked: searchEngineStats.directoriesWalked,
					filesWalked: searchEngineStats.filesWalked,
					cmdTime: searchEngineStats.cmdTime,
					cmdResultCount: searchEngineStats.cmdResultCount,
					scheme
				});
			}
		} else if (query.type === QueryType.Text) {
			let errorType: string | undefined;
			if (err) {
				errorType = err.code === SearchErrorCode.regexParseError ? 'regex' :
					err.code === SearchErrorCode.unknownEncoding ? 'encoding' :
						err.code === SearchErrorCode.globParseError ? 'glob' :
							err.code === SearchErrorCode.invalidLiteral ? 'literal' :
								err.code === SearchErrorCode.other ? 'other' :
									err.code === SearchErrorCode.canceled ? 'canceled' :
										'unknown';
			}

			type TextSearchCompleteClassification = {
				owner: 'roblourens';
				comment: 'Fired when a text search is completed';
				reason?: { classification: 'SystemMetaData'; purpose: 'PerformanceAndHealth'; comment: 'Indicates which extension or UI feature triggered this search' };
				workspaceFolderCount: { classification: 'SystemMetaData'; purpose: 'PerformanceAndHealth'; isMeasurement: true; comment: 'The number of folders in the workspace' };
				endToEndTime: { classification: 'SystemMetaData'; purpose: 'PerformanceAndHealth'; isMeasurement: true; comment: 'The total search time' };
				scheme: { classification: 'SystemMetaData'; purpose: 'PerformanceAndHealth'; comment: 'The uri scheme of the folder searched in' };
				error?: { classification: 'SystemMetaData'; purpose: 'PerformanceAndHealth'; comment: 'The type of the error, if any' };
			};
			type TextSearchCompleteEvent = {
				reason?: string;
				workspaceFolderCount: number;
				endToEndTime: number;
				scheme: string;
				error?: string;
			};
			this.telemetryService.publicLog2<TextSearchCompleteEvent, TextSearchCompleteClassification>('textSearchComplete', {
				reason: query._reason,
				workspaceFolderCount: query.folderQueries.length,
				endToEndTime: endToEndTime,
				scheme,
				error: errorType,
			});
		}
	}

	/**
	 * Searches through open/dirty editor models for text matches.
	 * This provides immediate results from unsaved files before file system search completes.
	 * Filters out special files like search result editors, git files, and non-file-backed editors.
	 * @param query - The text search query
	 * @returns Results from open editors and whether the result limit was hit
	 */
	private getOpenEditorResults(query: ITextQuery): { results: ResourceMap<IFileMatch | null>; limitHit: boolean } {
		const openEditorResults = new ResourceMap<IFileMatch | null>(uri => this.uriIdentityService.extUri.getComparisonKey(uri));
		let limitHit = false;

		if (query.type === QueryType.Text) {
			const canonicalToOriginalResources = new ResourceMap<URI>();
			for (const editorInput of this.editorService.editors) {
				const canonical = EditorResourceAccessor.getCanonicalUri(editorInput, { supportSideBySide: SideBySideEditor.PRIMARY });
				const original = EditorResourceAccessor.getOriginalUri(editorInput, { supportSideBySide: SideBySideEditor.PRIMARY });

				if (canonical) {
					canonicalToOriginalResources.set(canonical, original ?? canonical);
				}
			}

			const models = this.modelService.getModels();
			models.forEach((model) => {
				const resource = model.uri;
				if (!resource) {
					return;
				}

				if (limitHit) {
					return;
				}

				const originalResource = canonicalToOriginalResources.get(resource);
				if (!originalResource) {
					return;
				}

				// Skip search results
				if (model.getLanguageId() === SEARCH_RESULT_LANGUAGE_ID && !(query.includePattern && query.includePattern['**/*.code-search'])) {
					// TODO: untitled search editors will be excluded from search even when include *.code-search is specified
					return;
				}

				// Block walkthrough, webview, etc.
				if (originalResource.scheme !== Schemas.untitled && !this.fileService.hasProvider(originalResource)) {
					return;
				}

				// Exclude files from the git FileSystemProvider, e.g. to prevent open staged files from showing in search results
				if (originalResource.scheme === 'git') {
					return;
				}

				if (!this.matches(originalResource, query)) {
					return; // respect user filters
				}

				// Use editor API to find matches
				const askMax = isNumber(query.maxResults) ? query.maxResults + 1 : Number.MAX_SAFE_INTEGER;
				let matches = model.findMatches(query.contentPattern.pattern, false, !!query.contentPattern.isRegExp, !!query.contentPattern.isCaseSensitive, query.contentPattern.isWordMatch ? query.contentPattern.wordSeparators! : null, false, askMax);
				if (matches.length) {
					if (askMax && matches.length >= askMax) {
						limitHit = true;
						matches = matches.slice(0, askMax - 1);
					}

					const fileMatch = new FileMatch(originalResource);
					openEditorResults.set(originalResource, fileMatch);

					const textSearchResults = editorMatchesToTextSearchResults(matches, model, query.previewOptions);
					fileMatch.results = getTextSearchMatchWithModelContext(textSearchResults, model, query);
				} else {
					openEditorResults.set(originalResource, null);
				}
			});
		}

		return {
			results: openEditorResults,
			limitHit
		};
	}

	/**
	 * Checks if a resource matches the include/exclude patterns in the query.
	 * @param resource - The resource URI to check
	 * @param query - The text search query containing include/exclude patterns
	 * @returns True if the resource should be included in search results
	 */
	private matches(resource: uri, query: ITextQuery): boolean {
		return pathIncludedInQuery(query, resource.fsPath);
	}

	/**
	 * Clears cached search results across all file search providers.
	 * @param cacheKey - The cache key to clear
	 */
	async clearCache(cacheKey: string): Promise<void> {
		const clearPs = Array.from(this.fileSearchProviders.values())
			.map(provider => provider && provider.clearCache(cacheKey));
		await Promise.all(clearPs);
	}
}
