import type { ElementPick, ResolveMethod } from './protocol.ts';
/** One source-path prefix mapping (like code-inspector's `mappings`). */
export interface SourceMapping {
    /** Path prefix to find (e.g. `@scope/pkg/src`). */
    find: string;
    /** Replacement prefix (e.g. the monorepo directory or `node_modules/…`). */
    replacement: string;
}
/** Options controlling one resolution. */
interface ResolveOptions {
    /** The session's authoritative working directory (must be absolute). */
    cwd: string;
    /** Optional source-path prefix mappings, applied before normalization. */
    mappings?: readonly SourceMapping[];
    /** Extensions the text fallback search reads (without leading dot). */
    searchExtensions?: readonly string[];
    /** Maximum directory depth of the fallback search. */
    maxDepth?: number;
    /** Maximum bytes of one file the fallback search reads. */
    maxFileBytes?: number;
    /** Maximum files the fallback search examines. */
    maxFiles?: number;
    /** Wall-clock budget of one fallback search in milliseconds. Default 2500. */
    searchBudgetMs?: number;
    /** Framework hint that biases which extensions the text search tries first. */
    frameworkHint?: ElementPick['framework'];
}
/** The located source, always workspace-confined. */
export interface LocatedSource {
    ok: true;
    /** Absolute path on disk. */
    file: string;
    /** Path relative to the session cwd. */
    relative: string;
    line?: number;
    column?: number;
    /** The source line (or the 3-line window around it) when a line is known. */
    snippet?: string;
    method: ResolveMethod;
    /** Whether the file exists on disk (false = located by search but not read). */
    existed: boolean;
}
/** True when `target` equals `root` or sits below it. */
export declare function isWithin(root: string, target: string): boolean;
/**
 * Build the ordered candidate absolute paths for one reported source path.
 * Webpack-style project-relative paths (`/src/App.vue`) join the cwd; Vite
 * dev builds report absolute fs paths which pass through.
 */
export declare function candidatePaths(raw: string, cwd: string, mappings?: readonly SourceMapping[]): string[];
/**
 * Resolve one pick to a workspace-confined source location.
 * @returns ok:false with `error` when nothing was found or the reported path
 * escaped the workspace.
 */
export declare function resolvePick(pick: ElementPick, options: ResolveOptions): Promise<LocatedSource | {
    ok: false;
    error: string;
}>;
export {};
