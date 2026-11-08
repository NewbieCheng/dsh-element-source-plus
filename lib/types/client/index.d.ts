import type { Context } from '@deepseek-ai/cordis';
/** Services required before mounting (the slot registry + client sessions). */
export declare const inject: string[];
/**
 * Client plugin entry: mount the invisible hooks entry in the frame overlay.
 * @param ctx - the client cordis context (slots, sessions).
 */
export declare function apply(ctx: Context): void;
