/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationToken } from '../../../base/common/cancellation.js';
import { basename, relativePath } from '../../../base/common/resources.js';
import { URI } from '../../../base/common/uri.js';
import { localize } from '../../../nls.js';
import { fromAgentHostUri } from '../common/agentHostUri.js';
import { ChangesetKind, parseChangesetUri } from '../common/changesetUri.js';
import { type IChangesetOperationHandler } from '../common/agentHostChangesetOperationService.js';
import { ChangesetOperationTargetKind, type InvokeChangesetOperationParams, type InvokeChangesetOperationResult } from '../common/state/protocol/channels-changeset/commands.js';
import { AHP_SESSION_NOT_FOUND, JsonRpcErrorCodes, ProtocolError } from '../common/state/sessionProtocol.js';
import { type SessionState } from '../common/state/sessionState.js';
import { IFileService } from '../../files/common/files.js';
import { ILogService } from '../../log/common/log.js';
import { IAgentHostGitService } from '../common/agentHostGitService.js';

export class AgentHostDiscardChangesOperationHandler implements IChangesetOperationHandler {

	public static readonly OPERATION_DISCARD_CHANGES = 'discard-changes';

	constructor(
		private readonly _getSessionState: (sessionKey: string) => SessionState | undefined,
		@IAgentHostGitService private readonly _agentHostGitService: IAgentHostGitService,
		@IFileService private readonly _fileService: IFileService,
		@ILogService private readonly _logService: ILogService,
	) { }

	async invoke(params: InvokeChangesetOperationParams, token: CancellationToken): Promise<InvokeChangesetOperationResult> {
		const abortController = new AbortController();
		if (token.isCancellationRequested) {
			abortController.abort();
		}
		const cancellationListener = token.onCancellationRequested(() => abortController.abort());
		try {
			return await this._invoke(params, token, abortController.signal);
		} finally {
			cancellationListener.dispose();
		}
	}

	private async _invoke(params: InvokeChangesetOperationParams, token: CancellationToken, _signal: AbortSignal): Promise<InvokeChangesetOperationResult> {
		const parsed = parseChangesetUri(params.channel);
		if (!parsed || parsed.kind !== ChangesetKind.Uncommitted) {
			throw new ProtocolError(JsonRpcErrorCodes.InvalidParams, `Not an uncommitted changeset URI: ${params.channel}`);
		}
		this._throwIfCancelled(token);

		const sessionUri = parsed.sessionUri;
		const sessionState = this._getSessionState(sessionUri);
		if (!sessionState) {
			throw new ProtocolError(AHP_SESSION_NOT_FOUND, `Session not found: ${sessionUri}`);
		}

		if (params.target?.kind !== ChangesetOperationTargetKind.Resource) {
			throw new ProtocolError(
				JsonRpcErrorCodes.InvalidParams,
				`Operation '${AgentHostDiscardChangesOperationHandler.OPERATION_DISCARD_CHANGES}' requires a resource target.`);
		}

		const workingDirectoryStr = sessionState.workingDirectories?.[0];
		if (!workingDirectoryStr) {
			throw new ProtocolError(JsonRpcErrorCodes.InternalError, `Session has no working directory: ${sessionUri}`);
		}

		const workingDirectory = URI.parse(workingDirectoryStr);
		const resource = fromAgentHostUri(URI.parse(params.target.resource));
		const restorePath = toGitRestorePath(workingDirectory, resource);

		this._logService.info(`[AgentHostDiscardChangesOperationHandler] Restoring '${restorePath}' for session ${sessionUri}`);

		try {
			await this._agentHostGitService.restore(workingDirectory, [restorePath], { staged: true, worktree: true, ref: 'HEAD' });
		} catch (err) {
			this._throwIfCancelled(token);
			const deleted = await this._tryDeleteUntracked(workingDirectory, resource, restorePath, err);
			if (!deleted) {
				throw new ProtocolError(
					JsonRpcErrorCodes.InternalError,
					localize('agentHost.changeset.discardChanges.failed', "Failed to discard changes: {0}", err instanceof Error ? err.message : String(err)));
			}
		}

		return { message: { markdown: localize('agentHost.changeset.discardChanges.discarded', "Discarded changes to `{0}`.", basename(resource)) } };
	}

	private async _tryDeleteUntracked(workingDirectory: URI, resource: URI, restorePath: string, restoreError: unknown): Promise<boolean> {
		const message = restoreError instanceof Error ? restoreError.message : String(restoreError);
		const looksUntracked = /pathspec .* did not match|did not match any file|is untracked/i.test(message);
		const untracked = await this._agentHostGitService.getUntrackedPaths(workingDirectory) ?? [];
		const isUntracked = untracked.some(candidate => candidate === restorePath || candidate === resource.fsPath);
		if (!looksUntracked && !isUntracked) {
			return false;
		}

		try {
			await this._fileService.del(resource, { recursive: true, useTrash: false });
			return true;
		} catch (delErr) {
			this._logService.warn(`[AgentHostDiscardChangesOperationHandler] Failed to delete untracked '${resource.toString()}'`, delErr);
			return false;
		}
	}

	private _throwIfCancelled(token: CancellationToken): void {
		if (token.isCancellationRequested) {
			throw new ProtocolError(JsonRpcErrorCodes.InternalError, localize('agentHost.changeset.discardChanges.cancelled', "Discard changes operation was cancelled."));
		}
	}
}

function toGitRestorePath(workingDirectory: URI, resource: URI): string {
	return relativePath(workingDirectory, resource) ?? resource.fsPath;
}
