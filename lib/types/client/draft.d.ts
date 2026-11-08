/**
 * Chat-draft helpers. After a pick, the located source is placed into the
 * session composer DRAFT (never sent) as a FILE REFERENCE CHIP — the same
 * semantic reference the built-in `@` file menu produces — so the composer and
 * the sent message both show a compact chip instead of a long path line.
 */
/** The minimal structural context face the draft helper needs (satisfied by
 *  the DSH client Context). */
interface DraftContext {
    reflect: {
        get(name: string): unknown;
    };
    sessions?: {
        scope?(id: string): unknown;
    };
}
/** One semantic-draft reference (a chip) as the composer stores it. */
interface DraftReference {
    /** Serializer routing key; file mentions use `reference`. */
    source: string;
    /** Owner-scoped reference id (the `@path` mention text for files). */
    ref: string;
    /** Inline display label. */
    label: string;
    /** Domain glyph. */
    appearance?: 'session' | 'file' | 'folder';
    /** Clipboard projection; must equal the mention text span. */
    clipboardText: string;
}
/** The draft text for one located source (fallback plain text). */
export declare function buildDraftText(result: {
    relative?: string;
    line?: number;
}): string;
/** The `@path` mention text of one located source (quoted when it has spaces). */
export declare function buildMention(relative: string): string;
/** The reference chip payload of one located source. */
export declare function buildReference(relative: string, line?: number): DraftReference;
/**
 * Insert a located source into the session's composer draft as a file
 * reference chip (falling back to plain `[元素定位]` text when the chip API is
 * unavailable). Never sends anything; returns false (logged, no throw) when the
 * conversation service or session scope is unavailable.
 */
export declare function insertLocatedSource(ctx: DraftContext, sessionId: string, relative: string, line?: number): boolean;
export {};
