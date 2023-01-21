/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as dom from 'vs/base/browser/dom';
import { HighlightedLabel } from 'vs/base/browser/ui/highlightedlabel/highlightedLabel';
import { IListVirtualDelegate } from 'vs/base/browser/ui/list/list';
import { IListAccessibilityProvider } from 'vs/base/browser/ui/list/listWidget';
import { IAsyncDataSource, ITreeNode, ITreeRenderer } from 'vs/base/browser/ui/tree/tree';
import { DisposableStore, dispose, IDisposable } from 'vs/base/common/lifecycle';
import { WorkbenchAsyncDataTree } from 'vs/platform/list/browser/listService';
import { ViewPane } from 'vs/workbench/browser/parts/views/viewPane';
import { renderExpressionValue } from 'vs/workbench/contrib/debug/browser/baseDebugView';
import { IExpression } from 'vs/workbench/contrib/debug/common/debug';

const $ = dom.$;

export const NOTEBOOK_VARIABLES_PANEL_ID = 'workbench.panel.notebookVariables';
export const NOTEBOOK_VARIABLES_VIEW_ID = 'workbench.panel.notebookVariables.view';

export class NotebookVariablesViewPane extends ViewPane {
	private tree!: WorkbenchAsyncDataTree<any, any, any>;

	protected override renderBody(parent: HTMLElement): void {
		super.renderBody(parent);

		const container = dom.append(parent, $('.notebook-variables.debug-pane'));
		const treeContainer = dom.append(container, $(`.notebook-variables-tree.debug-variables`));
		const delegate = new NotebookVariablesDelegate();
		this.tree = <WorkbenchAsyncDataTree<any, any, any>>this.instantiationService.createInstance(
			WorkbenchAsyncDataTree,
			'NotebookVariables',
			treeContainer,
			delegate,
			[
				new VariablesRenderer()
				// new NotebookVariableRenderer()
			],
			// https://github.com/microsoft/TypeScript/issues/32526
			new NotebookVariablesDataSource() as IAsyncDataSource<NotebookVariableSession, NotebookVariable>,
			{
				accessibilityProvider: new NotebookVariablesAccessibilityProvider(),
				// identityProvider,
				// mouseSupport: false,
				// keyboardNavigationLabelProvider: { getKeyboardNavigationLabel: (e: IReplElement) => e.toString(true) },
				// horizontalScrolling: !wordWrap,
				// setRowLineHeight: false,
				// supportDynamicHeights: wordWrap,
				// overrideStyles: {
				// 	listBackground: this.getBackgroundColor()
				// }
			});
		this.tree.setInput(new NotebookVariableSession([
			new NotebookVariable('array', 'list(3)', 'list', '[1, 2, 3]', [new NotebookVariable('0', '', 'number', '1'), new NotebookVariable('1', '', 'number', '2'), new NotebookVariable('2', '', 'number', '3')]),
			new NotebookVariable('dictA', '', '', '{ "a": 1, ... }', [new NotebookVariable('a', '', 'number', '1'), new NotebookVariable('b', '', 'number', '2')]),
			new NotebookVariable('df', 'DataFrame(3, 2)', '', 'a, b', [new NotebookVariable('0', '', '', '1 4'), new NotebookVariable('1', '', '', '2 5'), new NotebookVariable('2', '', '', '3 6')]),
			new NotebookVariable('number', 'int', 'number', '1'),
			new NotebookVariable('someInstance', '', '', 'SomeClass', [new NotebookVariable('x', '', '1', 'number')]),
			new NotebookVariable('string', 'str(11)', 'string', 'hello world'),
			// new NotebookVariable('df', 'col1, col2', [new NotebookVariable('0', '1')]),
		]));
	}

	protected override layoutBody(width: number, height: number): void {
		super.layoutBody(height, width);
		this.tree.layout(width, height);
	}
}

class NotebookVariableSession {
	constructor(public readonly children: NotebookVariable[]) { }
}

class NotebookVariable implements IExpression {
	public readonly hasChildren = this.children.length > 0;

	constructor(
		public readonly name: string,
		public readonly metadata: string,
		public readonly type: string,
		public readonly value: string,
		private readonly children: NotebookVariable[] = []
	) { }

	evaluateLazy(): Promise<void> {
		throw new Error('Method not implemented.');
	}

	async getChildren(): Promise<NotebookVariable[]> {
		return this.children;
	}

	// valueChanged?: boolean | undefined;
	// presentationHint?: DebugProtocol.VariablePresentationHint | undefined;

	getId(): string {
		return this.name;
	}
}

class NotebookVariablesDelegate implements IListVirtualDelegate<NotebookVariable> {
	getHeight(element: NotebookVariable): number {
		return 22;
	}

	getTemplateId(element: NotebookVariable): string {
		return VariablesRenderer.ID;
	}
}

interface INotebookVariableTemplate {
	name: HTMLElement;
	value: HTMLElement;
}

export interface IExpressionTemplateData {
	expression: HTMLElement;
	name: HTMLSpanElement;
	value: HTMLSpanElement;
	inputBoxContainer: HTMLElement;
	// actionBar?: ActionBar;
	elementDisposable: IDisposable[];
	templateDisposable: IDisposable;
	label: HighlightedLabel;
	metadataLabel: HighlightedLabel;
	lazyButton: HTMLElement;
	currentElement: NotebookVariable | undefined;
}

export abstract class AbstractExpressionsRenderer implements ITreeRenderer<NotebookVariable, any, INotebookVariableTemplate> {

	constructor(
	) { }

	abstract get templateId(): string;

	renderTemplate(container: HTMLElement): IExpressionTemplateData {
		const expression = dom.append(container, $('.expression'));
		const name = dom.append(expression, $('span.name'));
		const metadata = dom.append(expression, $('span.metadata'));
		const lazyButton = dom.append(expression, $('span.lazy-button'));
		// lazyButton.classList.add(...ThemeIcon.asClassNameArray(Codicon.eye));
		// lazyButton.title = localize('debug.lazyButton.tooltip', "Click to expand");
		const value = dom.append(expression, $('span.value'));

		const label = new HighlightedLabel(name);
		const metadataLabel = new HighlightedLabel(metadata);

		const inputBoxContainer = dom.append(expression, $('.inputBoxContainer'));

		const templateDisposable = new DisposableStore();

		// let actionBar: ActionBar | undefined;
		// if (this.renderActionBar) {
		// 	dom.append(expression, $('.span.actionbar-spacer'));
		// 	actionBar = templateDisposable.add(new ActionBar(expression));
		// }

		const template: IExpressionTemplateData = { expression, name, value, label, inputBoxContainer, elementDisposable: [], templateDisposable, lazyButton, currentElement: undefined, metadataLabel };

		// templateDisposable.add(dom.addDisposableListener(lazyButton, dom.EventType.CLICK, () => {
		// 	if (template.currentElement) {
		// 		this.debugService.getViewModel().evaluateLazyExpression(template.currentElement);
		// 	}
		// }));

		return template;
	}

	renderElement(node: ITreeNode<NotebookVariable, any>, index: number, data: IExpressionTemplateData): void {
		const { element } = node;
		data.currentElement = element;
		this.renderExpression(element, data, /* createMatches(node.filterData) */);
		// if (data.actionBar) {
		// 	this.renderActionBar!(data.actionBar, element, data);
		// }
		// const selectedExpression = this.debugService.getViewModel().getSelectedExpression();
		// if (element === selectedExpression?.expression || (element instanceof Variable && element.errorMessage)) {
		// 	const options = this.getInputBoxOptions(element, !!selectedExpression?.settingWatch);
		// 	if (options) {
		// 		data.elementDisposable.push(this.renderInputBox(data.name, data.value, data.inputBoxContainer, options));
		// 	}
		// }
	}

	// renderInputBox(nameElement: HTMLElement, valueElement: HTMLElement, inputBoxContainer: HTMLElement, options: IInputBoxOptions): IDisposable {
	// 	nameElement.style.display = 'none';
	// 	valueElement.style.display = 'none';
	// 	inputBoxContainer.style.display = 'initial';
	// 	dom.clearNode(inputBoxContainer);

	// 	const inputBox = new InputBox(inputBoxContainer, this.contextViewService, { ...options, inputBoxStyles: defaultInputBoxStyles });

	// 	inputBox.value = options.initialValue;
	// 	inputBox.focus();
	// 	inputBox.select();

	// 	const done = once((success: boolean, finishEditing: boolean) => {
	// 		nameElement.style.display = '';
	// 		valueElement.style.display = '';
	// 		inputBoxContainer.style.display = 'none';
	// 		const value = inputBox.value;
	// 		dispose(toDispose);

	// 		if (finishEditing) {
	// 			this.debugService.getViewModel().setSelectedExpression(undefined, false);
	// 			options.onFinish(value, success);
	// 		}
	// 	});

	// 	const toDispose = [
	// 		inputBox,
	// 		dom.addStandardDisposableListener(inputBox.inputElement, dom.EventType.KEY_DOWN, (e: IKeyboardEvent) => {
	// 			const isEscape = e.equals(KeyCode.Escape);
	// 			const isEnter = e.equals(KeyCode.Enter);
	// 			if (isEscape || isEnter) {
	// 				e.preventDefault();
	// 				e.stopPropagation();
	// 				done(isEnter, true);
	// 			}
	// 		}),
	// 		dom.addDisposableListener(inputBox.inputElement, dom.EventType.BLUR, () => {
	// 			done(true, true);
	// 		}),
	// 		dom.addDisposableListener(inputBox.inputElement, dom.EventType.CLICK, e => {
	// 			// Do not expand / collapse selected elements
	// 			e.preventDefault();
	// 			e.stopPropagation();
	// 		})
	// 	];

	// 	return toDisposable(() => {
	// 		done(false, false);
	// 	});
	// }

	protected abstract renderExpression(expression: NotebookVariable, data: IExpressionTemplateData, /* highlights: IHighlight[] */): void;

	disposeElement(node: ITreeNode<NotebookVariable, any>, index: number, templateData: IExpressionTemplateData): void {
		dispose(templateData.elementDisposable);
		templateData.elementDisposable = [];
	}

	disposeTemplate(templateData: IExpressionTemplateData): void {
		dispose(templateData.elementDisposable);
		templateData.templateDisposable.dispose();
	}
}

export class VariablesRenderer extends AbstractExpressionsRenderer {

	static readonly ID = 'variable';

	constructor(
		// private readonly linkDetector: LinkDetector,
		// @IMenuService private readonly menuService: IMenuService,
		// @IContextKeyService private readonly contextKeyService: IContextKeyService,
		// @IDebugService debugService: IDebugService,
		// @IContextViewService contextViewService: IContextViewService,
	) {
		super();
	}

	get templateId(): string {
		return VariablesRenderer.ID;
	}

	protected renderExpression(expression: NotebookVariable, data: IExpressionTemplateData, /* highlights: IHighlight[] */): void {
		let text = expression.name;
		if (expression.value && typeof expression.name === 'string') {
			text += ':';
		}
		data.label.set(text, undefined, expression.type ? expression.type : expression.name);
		data.metadataLabel.set(expression.metadata ? ' ' + expression.metadata : '');
		renderExpressionValue(expression, data.value, { colorize: true });
	}

	// protected getInputBoxOptions(expression: IExpression): IInputBoxOptions {
	// 	const variable = <Variable>expression;
	// 	return {
	// 		initialValue: expression.value,
	// 		ariaLabel: localize('variableValueAriaLabel', "Type new variable value"),
	// 		validationOptions: {
	// 			validation: () => variable.errorMessage ? ({ content: variable.errorMessage }) : null
	// 		},
	// 		onFinish: (value: string, success: boolean) => {
	// 			variable.errorMessage = undefined;
	// 			const focusedStackFrame = this.debugService.getViewModel().focusedStackFrame;
	// 			if (success && variable.value !== value && focusedStackFrame) {
	// 				variable.setVariable(value, focusedStackFrame)
	// 					// Need to force watch expressions and variables to update since a variable change can have an effect on both
	// 					.then(() => {
	// 						// Do not refresh scopes due to a node limitation #15520
	// 						forgetScopes = false;
	// 						this.debugService.getViewModel().updateViews();
	// 					});
	// 			}
	// 		}
	// 	};
	// }

	// protected override renderActionBar(actionBar: ActionBar, expression: IExpression) {
	// 	const variable = expression as Variable;
	// 	const contextKeyService = getContextForVariableMenu(this.contextKeyService, variable);
	// 	const menu = this.menuService.createMenu(MenuId.DebugVariablesContext, contextKeyService);

	// 	const primary: IAction[] = [];
	// 	const context = getVariablesContext(variable);
	// 	createAndFillInContextMenuActions(menu, { arg: context, shouldForwardArgs: false }, { primary, secondary: [] }, 'inline');

	// 	actionBar.clear();
	// 	actionBar.context = context;
	// 	actionBar.push(primary, { icon: true, label: false });
	// }
}


class NotebookVariableRenderer implements ITreeRenderer<NotebookVariable, INotebookVariableTemplate, any> {
	static readonly TEMPLATE_ID = 'notebookVariable';

	constructor(
		// @IInstantiationService private readonly instantiationService: IInstantiationService
	) { }

	get templateId(): string {
		return NotebookVariableRenderer.TEMPLATE_ID;
	}

	renderTemplate(container: HTMLElement): INotebookVariableTemplate {
		const data = Object.create(null);
		data.name = dom.append(container, $('.name'));
		data.value = dom.append(container, $('.value'));
		return data;
	}

	renderElement(element: ITreeNode<NotebookVariable, INotebookVariableTemplate>, index: number, templateData: INotebookVariableTemplate): void {
		templateData.name.textContent = element.element.name;
		templateData.value.textContent = element.element.value;
	}

	disposeTemplate(templateData: INotebookVariableTemplate): void {
		// noop
	}
}

class NotebookVariablesDataSource implements IAsyncDataSource<NotebookVariableSession, NotebookVariable> {

	hasChildren(element: NotebookVariableSession | NotebookVariable): boolean {
		if (element instanceof NotebookVariableSession) {
			return true;
		}

		return element.hasChildren;
	}

	async getChildren(element: NotebookVariableSession | NotebookVariable): Promise<NotebookVariable[]> {
		if (element instanceof NotebookVariableSession) {
			return element.children;
		}

		return element.getChildren();
	}
}

export class NotebookVariablesAccessibilityProvider implements IListAccessibilityProvider<NotebookVariable> {

	getWidgetAriaLabel(): string {
		return '';
		// return localize('debugConsole', "Debug Console");
	}

	getAriaLabel(element: NotebookVariable): string {
		// if (element instanceof Variable) {
		// 	return localize('replVariableAriaLabel', "Variable {0}, value {1}", element.name, element.value);
		// }
		// if (element instanceof SimpleReplElement || element instanceof ReplEvaluationInput || element instanceof ReplEvaluationResult) {
		// 	return element.value + (element instanceof SimpleReplElement && element.count > 1 ? localize({ key: 'occurred', comment: ['Front will the value of the debug console element. Placeholder will be replaced by a number which represents occurrance count.'] },
		// 		", occurred {0} times", element.count) : '');
		// }
		// if (element instanceof RawObjectReplElement) {
		// 	return localize('replRawObjectAriaLabel', "Debug console variable {0}, value {1}", element.name, element.value);
		// }
		// if (element instanceof ReplGroup) {
		// 	return localize('replGroup', "Debug console group {0}", element.name);
		// }

		return '';
	}
}
