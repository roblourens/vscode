/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Dev builds replace this module with one browser bundle; production bundles inline these imports.
// eslint-disable-next-line local/code-import-patterns, local/code-amd-node-module
import React from 'react';

export const createElement = React.createElement;
export const Fragment = React.Fragment;
export const useCallback = React.useCallback;
export const useEffect = React.useEffect;
export const useLayoutEffect = React.useLayoutEffect;
export const useMemo = React.useMemo;
export const useRef = React.useRef;
export const useState = React.useState;
export const useSyncExternalStore = React.useSyncExternalStore;
// eslint-disable-next-line local/code-import-patterns
export { createRoot, type Root } from 'react-dom/client';
// eslint-disable-next-line local/code-import-patterns
export { useVirtualizer } from '@tanstack/react-virtual';

export declare namespace JSX {
	export type ElementType = React.JSX.ElementType;
	export interface Element extends React.JSX.Element { }
	export interface ElementClass extends React.JSX.ElementClass { }
	export interface ElementAttributesProperty extends React.JSX.ElementAttributesProperty { }
	export interface ElementChildrenAttribute extends React.JSX.ElementChildrenAttribute { }
	export type LibraryManagedAttributes<C, P> = React.JSX.LibraryManagedAttributes<C, P>;
	export interface IntrinsicAttributes extends React.JSX.IntrinsicAttributes { }
	export interface IntrinsicClassAttributes<T> extends React.JSX.IntrinsicClassAttributes<T> { }
	export interface IntrinsicElements extends React.JSX.IntrinsicElements { }
}
