/**
 * Wire helpers for the plugin's JSON API: bounded body reading, response
 * writing, and the shared error envelope.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
/** Machine-readable error codes of the plugin API. */
type ApiErrorCode = 'bad-request' | 'forbidden' | 'method-error' | 'not-found' | 'resolve-error' | 'internal';
/** One API failure with its wire code and HTTP status. */
export declare class ApiError extends Error {
    readonly code: ApiErrorCode;
    readonly status: number;
    constructor(code: ApiErrorCode, message: string, status?: number);
}
/** Read and parse the JSON request body (bounded; malformed → bad-request). */
export declare function readJsonBody(req: IncomingMessage): Promise<unknown>;
/** Write a JSON response with the given status. */
export declare function writeJson(res: ServerResponse, status: number, body: unknown): void;
export {};
