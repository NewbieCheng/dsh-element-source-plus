/**
 * Build the user-role steering message that wakes the agent after a pick.
 * Pure string assembly so the exact model-visible text is unit-testable.
 */
import type { ElementDescriptor, ResolveMethod } from './protocol.ts';
/** The located-source slice buildSteerText needs. */
export interface LocatedForMessage {
    relative: string;
    line?: number;
    method: ResolveMethod;
}
/** A compact one-line element summary for the message. */
export declare function elementSummary(element: ElementDescriptor): string;
/**
 * The steering message delivered to the session agent after a successful pick.
 * Bilingual (zh/en) so the model can answer in the user's language.
 */
export declare function buildSteerText(result: LocatedForMessage, element: ElementDescriptor, pageUrl?: string): string;
