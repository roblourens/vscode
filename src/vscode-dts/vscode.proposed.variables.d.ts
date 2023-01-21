/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/


export interface NotebookController {
	/** Set this to attach a variable provider to this controller. */
	variableProvider?: NotebookVariableProvider;
}

enum VariablesRequestKind {
	Named,
	Indexed
}

interface VariablesResult {
	variable: Variable;
	namedVariableCount: number;
	indexedVariableCount: number;
}

interface NotebookVariableProvider {
	/** VS Code decides when to call the provider due to execution and variable view visibility. But if other things can change variables (interactive output widgets, background tasks...?) the provider needs to signal a change. */
	onDidChangeVariables: Event<void>;

	/** When variablesReference is undefined, this is requesting global Variables. When a variable is passed, it's requesting child props of that Variable. */
	getChildren(variable: Variable | undefined, kind: VariablesRequestKind, start: number): AsyncIterable<VariablesResult>;
}

interface Variable {
	/** The variable's name. */
	name: string;
	/** The variable's value.
		This can be a multi-line text, e.g. for a function the body of a function.
		For structured variables (which do not have a simple value), it is recommended to provide a one-line representation of the structured object. This helps to identify the structured object in the collapsed state when its children are not yet visible.
		An empty string can be used if no value should be shown in the UI.
	*/
	value: string;

	/** The type of the variable's value */
	type?: string;

	/** The variable size, if defined for this type (array length, dimensions of data frame) */
	size?: string;
}
