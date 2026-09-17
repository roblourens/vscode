/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as cp from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { createRequire } from 'module';
import * as esbuild from 'esbuild';

const root = path.resolve(import.meta.dirname, '../..');
const browserRuntimeDependencyRoots = ['@tanstack/react-virtual', 'react', 'react-dom'];
export const browserRuntimeProductionDefines = { 'process.env.NODE_ENV': '"production"' } as const;
const browserRuntimeDevelopmentDefines = { 'process.env.NODE_ENV': '"development"' } as const;

const reactDevelopmentEntry = `
import React from 'react';
export { createRoot, hydrateRoot } from 'react-dom/client';
export * from '@tanstack/react-virtual';
export default React;
export const {
	Children,
	Component,
	Fragment,
	Profiler,
	PureComponent,
	StrictMode,
	Suspense,
	__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED,
	act,
	cloneElement,
	createContext,
	createElement,
	createFactory,
	createRef,
	forwardRef,
	isValidElement,
	lazy,
	memo,
	startTransition,
	unstable_act,
	useCallback,
	useContext,
	useDebugValue,
	useDeferredValue,
	useEffect,
	useId,
	useImperativeHandle,
	useInsertionEffect,
	useLayoutEffect,
	useMemo,
	useReducer,
	useRef,
	useState,
	useSyncExternalStore,
	useTransition,
	version,
} = React;
`;

export function inlineBrowserRuntimeDependenciesPlugin(repoRoot = root): esbuild.Plugin {
	const packageNames = collectDependencyClosure(repoRoot, browserRuntimeDependencyRoots);
	const require = createRequire(path.join(repoRoot, 'package.json'));

	return {
		name: 'inline-browser-runtime-dependencies',
		setup(build) {
			build.onResolve({ filter: /^[^./]|^@/ }, args => {
				if (!packageNames.has(getPackageName(args.path))) {
					return undefined;
				}
				return { path: require.resolve(args.path) };
			});
		},
	};
}

function collectDependencyClosure(repoRoot: string, roots: readonly string[]): Set<string> {
	const result = new Set<string>();
	const pending = [...roots];
	while (pending.length > 0) {
		const packageName = pending.pop()!;
		if (result.has(packageName)) {
			continue;
		}
		result.add(packageName);

		const packageJsonPath = path.join(repoRoot, 'node_modules', ...packageName.split('/'), 'package.json');
		const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8')) as { dependencies?: Record<string, string> };
		pending.push(...Object.keys(packageJson.dependencies ?? {}));
	}
	return result;
}

function getPackageName(moduleSpecifier: string): string {
	const segments = moduleSpecifier.split('/');
	return moduleSpecifier.startsWith('@') ? segments.slice(0, 2).join('/') : segments[0];
}

/** Writes the shared ESM browser runtime used by unbundled development builds. */
export async function bundleBrowserRuntimeDependencies(outputRoot: string, repoRoot = root): Promise<void> {
	const outfile = path.join(outputRoot, 'vs', 'sessions', 'browser', 'browserRuntime.js');
	await fs.promises.mkdir(path.dirname(outfile), { recursive: true });
	await esbuild.build({
		absWorkingDir: repoRoot,
		bundle: true,
		define: browserRuntimeDevelopmentDefines,
		format: 'esm',
		outfile,
		platform: 'browser',
		sourcemap: 'linked',
		stdin: {
			contents: reactDevelopmentEntry,
			resolveDir: repoRoot,
			sourcefile: 'browserRuntime.ts',
		},
		target: ['es2024'],
	});
}

// esbuild-based bundle tasks (drop-in replacement for bundle-vscode / minify-vscode)

export function runEsbuildTranspile(outDir: string, excludeTests: boolean): Promise<void> {
	return new Promise((resolve, reject) => {
		const scriptPath = path.join(root, 'build/next/index.ts');
		const args = [scriptPath, 'transpile', '--out', outDir];
		if (excludeTests) {
			args.push('--exclude-tests');
		}

		const proc = cp.spawn(process.execPath, args, {
			cwd: root,
			stdio: 'inherit'
		});

		proc.on('error', reject);
		proc.on('close', code => {
			if (code === 0) {
				resolve();
			} else {
				reject(new Error(`esbuild transpile failed with exit code ${code} (outDir: ${outDir})`));
			}
		});
	});
}

export function runEsbuildBundle(outDir: string, minify: boolean, nls: boolean, target: 'desktop' | 'server' | 'server-web' = 'desktop', sourceMapBaseUrl?: string): Promise<void> {
	return new Promise((resolve, reject) => {
		const scriptPath = path.join(root, 'build/next/index.ts');
		const args = [scriptPath, 'bundle', '--out', outDir, '--target', target];
		if (minify) {
			args.push('--minify');
			args.push('--mangle-privates');
		}
		if (nls) {
			args.push('--nls');
		}
		if (sourceMapBaseUrl) {
			args.push('--source-map-base-url', sourceMapBaseUrl);
		}

		const proc = cp.spawn(process.execPath, args, {
			cwd: root,
			stdio: 'inherit'
		});

		proc.on('error', reject);
		proc.on('close', code => {
			if (code === 0) {
				resolve();
			} else {
				reject(new Error(`esbuild bundle failed with exit code ${code} (outDir: ${outDir}, minify: ${minify}, nls: ${nls}, target: ${target})`));
			}
		});
	});
}
