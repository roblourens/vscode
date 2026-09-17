/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { suite, test } from 'node:test';
import { getOutputRelativePath, isTypeScriptSourceFile, mapWithConcurrency, transpileSource } from '../transpile.ts';

suite('transpile', () => {
	test('bounds concurrent work and preserves result order', async () => {
		let active = 0;
		let maximumActive = 0;

		const results = await mapWithConcurrency([0, 1, 2, 3, 4], 2, async item => {
			active++;
			maximumActive = Math.max(maximumActive, active);
			await new Promise(resolve => setImmediate(resolve));
			active--;
			return item * 2;
		});

		assert.deepStrictEqual({ maximumActive, results }, {
			maximumActive: 2,
			results: [0, 2, 4, 6, 8],
		});
	});

	test('propagates errors and stops scheduling work', async () => {
		const started: number[] = [];

		await assert.rejects(mapWithConcurrency([0, 1, 2, 3], 2, async item => {
			started.push(item);
			if (item === 0) {
				throw new Error('expected failure');
			}
			await new Promise(resolve => setImmediate(resolve));
		}), /expected failure/);

		assert.deepStrictEqual(started, [0, 1]);
	});

	test('transpiles TSX and maps its output path', async () => {
		const output = await transpileSource(
			'export const Example = ({ label }: { label: string }) => <span>{label}</span>;',
			'example.tsx'
		);

		assert.deepStrictEqual({
			outputPath: getOutputRelativePath('example.tsx'),
			containsTypeAnnotation: output.includes('label: string'),
			containsCreateElement: output.includes('React.createElement("span"'),
		}, {
			outputPath: 'example.js',
			containsTypeAnnotation: false,
			containsCreateElement: true,
		});
	});

	test('preserves TSX diff fixtures as resources', () => {
		const fixturePath = 'vs/editor/test/node/diffing/fixtures/ws-alignment/1.tsx';

		assert.deepStrictEqual({
			isTypeScriptSource: isTypeScriptSourceFile(fixturePath),
			outputPath: getOutputRelativePath(fixturePath),
		}, {
			isTypeScriptSource: false,
			outputPath: fixturePath,
		});
	});
});
