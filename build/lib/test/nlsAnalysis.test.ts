/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { suite, test } from 'node:test';
import { analyzeLocalizeCalls } from '../nls-analysis.ts';

suite('NLS analysis', () => {
	test('analyzes TSX source', () => {
		const calls = analyzeLocalizeCalls([
			`import { localize } from './nls.js';`,
			`const label = localize('key', 'Message');`,
			`export const Example = () => <span>{label}</span>;`,
		].join('\n'), 'localize', 'example.tsx');

		assert.deepStrictEqual(calls.map(call => ({ key: call.key, value: call.value })), [
			{ key: `'key'`, value: `'Message'` },
		]);
	});
});
