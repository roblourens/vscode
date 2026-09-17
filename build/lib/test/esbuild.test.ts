/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { pathToFileURL } from 'url';
import { suite, test } from 'node:test';
import * as esbuild from 'esbuild';
import { browserRuntimeProductionDefines, bundleBrowserRuntimeDependencies, inlineBrowserRuntimeDependenciesPlugin } from '../esbuild.ts';

const repositoryRoot = path.resolve(import.meta.dirname, '../../..');

suite('esbuild', () => {
	test('bundles browser runtime dependencies', async () => {
		const result = await esbuild.build({
			bundle: true,
			define: browserRuntimeProductionDefines,
			format: 'esm',
			metafile: true,
			packages: 'external',
			platform: 'neutral',
			plugins: [inlineBrowserRuntimeDependenciesPlugin(repositoryRoot)],
			stdin: {
				contents: [
					`import { useVirtualizer } from '@tanstack/react-virtual';`,
					`import { createElement } from 'react';`,
					`import { createRoot } from 'react-dom/client';`,
					'console.log(useVirtualizer, createElement, createRoot);',
				].join('\n'),
				resolveDir: repositoryRoot,
				sourcefile: 'browser-runtime.ts',
			},
			write: false,
		});

		const inputs = Object.keys(result.metafile.inputs).map(input => input.replaceAll('\\', '/'));
		const externalImports = Object.values(result.metafile.outputs)
			.flatMap(output => output.imports)
			.filter(input => input.external)
			.map(input => input.path);
		assert.deepStrictEqual({
			hasReact: inputs.some(input => input.includes('node_modules/react/')),
			hasReactDevelopment: inputs.some(input => input.includes('node_modules/react/cjs/react.development.js')),
			hasReactDom: inputs.some(input => input.includes('node_modules/react-dom/')),
			hasReactVirtual: inputs.some(input => input.includes('node_modules/@tanstack/react-virtual/')),
			externalImports,
		}, {
			hasReact: true,
			hasReactDevelopment: false,
			hasReactDom: true,
			hasReactVirtual: true,
			externalImports: [],
		});
	});

	test('builds development browser runtime modules', async () => {
		const outputRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'vscode-browser-runtime-'));
		try {
			await bundleBrowserRuntimeDependencies(outputRoot, repositoryRoot);
			const runtime = await import(`${pathToFileURL(path.join(outputRoot, 'vs', 'sessions', 'browser', 'browserRuntime.js')).href}?test=${Date.now()}`);

			assert.deepStrictEqual({
				hasCreateElement: typeof runtime.createElement === 'function',
				hasCreateRoot: typeof runtime.createRoot === 'function',
				hasUseSyncExternalStore: typeof runtime.useSyncExternalStore === 'function',
				hasUseVirtualizer: typeof runtime.useVirtualizer === 'function',
			}, {
				hasCreateElement: true,
				hasCreateRoot: true,
				hasUseSyncExternalStore: true,
				hasUseVirtualizer: true,
			});
		} finally {
			await fs.rm(outputRoot, { force: true, recursive: true });
		}
	});
});
