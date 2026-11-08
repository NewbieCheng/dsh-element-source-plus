/**
 * Framework probes for the page-side inject script. Each probe reads a real
 * dev-runtime signal off a DOM-like element and returns a precise or
 * heuristic source location. Pure functions over a minimal element contract
 * so they run inside the inject IIFE and are unit-testable in Node.
 *
 * Probe priority (first match wins, per node):
 *  1. code-inspector-plugin `data-insp-*` attributes — exact for every
 *     framework when the user also uses code-inspector-plugin.
 *  2. React dev `__source` on the nearest fiber's memoizedProps — exact
 *     file:line:col from the JSX transform (@vitejs/plugin-react, CRA).
 *  3. Vue dev `__file` on `__vueParentComponent.type` (v3) or
 *     `__vue__.$options` (v2) — exact file.
 *  4. Svelte dev `__svelte_meta` — exact file:line:col when present.
 *  5. Angular dev markers (`ng-reflect-*`, `_nghost-*`) — framework only,
 *     resolution falls back to the workspace search.
 */
import { type ElementDescriptor, type PickFramework, type PickSource } from '../protocol.ts';
/** The minimal DOM-like contract the probes need (satisfied by real elements). */
export interface ProbeElement {
    tagName?: string;
    id?: string;
    className?: unknown;
    textContent?: string | null;
    parentElement: ProbeElement | null;
    attributes?: NamedNodeMap | ProbeAttribute[] | {
        [name: string]: unknown;
    };
    getAttribute?(name: string): string | null;
    [key: string]: unknown;
}
/** A DOM attribute row (element.attributes is an iterable NamedNodeMap). */
interface ProbeAttribute {
    name: string;
    value: string;
}
/** One probe result for a node. */
interface ProbeResult {
    framework: PickFramework;
    source?: PickSource;
    name?: string;
}
/** code-inspector-plugin's injected DOM attributes — exact for all frameworks. */
export declare function probeCodeInspector(el: ProbeElement): ProbeResult | null;
/**
 * React probe: exact `__source` from the nearest fiber's memoizedProps when
 * the JSX transform injects it (@vitejs/plugin-react, CRA). Compilers that do
 * NOT inject `__source` (notably @vitejs/plugin-react-swc) still yield the
 * component display name, which the host turns into a component-definition
 * search.
 */
export declare function probeReact(el: ProbeElement): ProbeResult | null;
/** Vue 3 / Vue 2 dev `__file` off the element's owning component. */
export declare function probeVue(el: ProbeElement): ProbeResult | null;
/** Svelte 5 dev `__svelte_meta` (template source location). */
export declare function probeSvelte(el: ProbeElement): ProbeResult | null;
/** Angular dev markers: `ng-reflect-*` inputs or `_nghost-*` host classes. */
export declare function probeAngular(el: ProbeElement): ProbeResult | null;
/** Collect the probe results for an element and its ancestors (up to depth). */
export declare function probeChain(el: ProbeElement, depth?: number): Array<{
    node: ProbeElement;
    result: ProbeResult;
}>;
/**
 * Pick the best source across the element and its ancestors: the deepest
 * exact hit (line present) wins, then the deepest file-only hit, then
 * nothing (framework still reported for display).
 */
export declare function bestProbeResult(results: Array<{
    result: ProbeResult;
}>): ProbeResult | null;
/** Build the full element descriptor for one node. */
export declare function describeElement(el: ProbeElement): ElementDescriptor;
export {};
