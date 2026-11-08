/**
 * Wire protocol shared by the page probe (inject.js), the DSH chat client, and
 * the host. This module is pure — JSON-compatible types and pure functions
 * only — so it can be inlined into the inject IIFE without pulling in node or
 * DOM globals.
 */
/** Frameworks the probe chain can identify. */
export type PickFramework = 'code-inspector' | 'react' | 'vue' | 'svelte' | 'angular' | 'generic';
/** One precise-or-heuristic source location collected in the page. */
export interface PickSource {
    /** Absolute or project-relative source file as reported by the framework. */
    file: string;
    line?: number;
    column?: number;
}
/** A minimal element descriptor for fallback text/class search on the host. */
export interface ElementDescriptor {
    tag: string;
    id?: string;
    /** Lowercase class names, deduplicated. */
    classes: string[];
    /** Trimmed text content, capped. */
    text?: string;
    /** Short CSS selector path (element and its ancestors), capped. */
    selector: string;
    /** A bounded sample of attribute names; values are capped. */
    attrs: Array<[string, string]>;
}
/** The pick payload the probe script posts to the DSH host. */
export interface ElementPick {
    protocolVersion: number;
    framework: PickFramework;
    /** The best source found among the element and its ancestors. */
    source?: PickSource;
    /** Component / instance display name when the framework reported one. */
    name?: string;
    element: ElementDescriptor;
    /** The page URL the pick happened on. */
    pageUrl: string;
}
/** How the host resolved the pick to a file. */
export type ResolveMethod = 'code-inspector' | 'react-source' | 'vue-file' | 'svelte-source' | 'text-search' | 'component-search' | 'none';
/**
 * One resolved queued pick returned to the DSH chat client poller. The client
 * only needs the display location; resolution happens host-side inside the
 * session workspace, so nothing here can escape that confinement.
 */
export interface PendingResult {
    /** Queue sequence of the pick this entry answers. */
    seq: number;
    ok: boolean;
    /** The located file relative to the session workspace. */
    relative?: string;
    line?: number;
    column?: number;
    /** The source line (or the surrounding window) as a snippet. */
    snippet?: string;
    method?: ResolveMethod;
    framework?: PickFramework;
    /** Human-readable failure reason when ok is false. */
    error?: string;
}
export declare const PROTOCOL_VERSION = 1;
/** Cap a string to `limit` code points, appending an ellipsis when truncated. */
export declare function capText(value: string, limit: number): string;
/** Normalize whitespace runs and trim an element's text for search. */
export declare function normalizeSearchText(value: string): string;
/** A bounded list of unique lowercase class names. */
export declare function classList(classes: readonly (string | null | undefined)[]): string[];
/** Normalize an unknown `pick` payload into an ElementPick (or undefined). */
export declare function pickFromUnknown(value: unknown): ElementPick | undefined;
