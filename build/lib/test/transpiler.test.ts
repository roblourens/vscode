/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { suite, test } from 'node:test';
import ts from 'typescript';
import { transpileTypeScript } from '../tsb/transpiler.ts';

suite('TypeScript transpiler', () => {
	test('transpiles TSX using its source file name', () => {
		const result = transpileTypeScript(
			'export const Example = ({ label }: { label: string }) => <span>{label}</span>;',
			'example.tsx',
			{ compilerOptions: { jsx: ts.JsxEmit.React, module: ts.ModuleKind.NodeNext } }
		);

		assert.deepStrictEqual({
			diagnostics: result.diag,
			containsTypeAnnotation: result.jsSrc.includes('label: string'),
			containsCreateElement: result.jsSrc.includes('React.createElement("span"'),
		}, {
			diagnostics: [],
			containsTypeAnnotation: false,
			containsCreateElement: true,
		});
	});
});
