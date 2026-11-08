import type { Context } from './context-types.ts';
import { type SourceMapping } from './resolve.ts';
/** Plugin identity for cordis.yml rows. */
export declare const name = "dsh-element-source";
/** Hard dependencies: the webserver routes, the session store, the loader's connection row. */
export declare const inject: string[];
/** Plugin configuration (optional; defaults are documented in the README). */
interface ElementSourceConfig {
    /**
     * Wake the session agent with a located-source message after a pick.
     * Default false: a pick only fills the chat composer draft; nothing is
     * sent until the user sends it themselves.
     */
    autoSteer?: boolean;
    /** Source-path prefix mappings (e.g. monorepo / node_modules rebasing). */
    mappings?: readonly SourceMapping[];
    /** Session id pinned by configuration, ignoring the request's sessionId. */
    sessionId?: string;
}
/**
 * Plugin body.
 * @param ctx - host plugin context (webServer, sessions, loader).
 * @param config - optional deployment-provided configuration.
 */
export declare function apply(ctx: Context, config?: ElementSourceConfig): void;
export {};
