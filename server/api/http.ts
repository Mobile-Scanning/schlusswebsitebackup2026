import { checkDatabase } from './db';
import type { NextFunction, Request, Response, RequestHandler } from 'express';
import { z, ZodError, ZodType } from 'zod';

/** Error that is safe to show to the client. */
export class HttpError extends Error {
  constructor(public status: number, message: string, public code?: string, public details?: unknown) {
    super(message);
  }
}

export const badRequest = (msg: string, details?: unknown) => new HttpError(400, msg, 'bad_request', details);
export const unauthorised = (msg = 'Please sign in to continue.') => new HttpError(401, msg, 'unauthenticated');
export const forbidden = (msg = 'You do not have permission to do that.') => new HttpError(403, msg, 'forbidden');
export const notFound = (msg = 'Not found.') => new HttpError(404, msg, 'not_found');
export const conflict = (msg: string) => new HttpError(409, msg, 'conflict');

/** Wrap async handlers so thrown errors reach the error middleware. */
export const ah =
  (fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>): RequestHandler =>
  (req, res, next) => {
    fn(req, res, next).catch(next);
  };

/** Validate and coerce input; throws a 422 with field errors. */
export function parse<T extends ZodType>(schema: T, data: unknown): z.infer<T> {
  const r = schema.safeParse(data);
  if (!r.success) {
    const fields: Record<string, string> = {};
    for (const issue of r.error.issues) {
      const key = issue.path.join('.') || '_';
      if (!fields[key]) fields[key] = issue.message;
    }
    throw new HttpError(422, 'Please check the highlighted fields.', 'validation_failed', { fields });
  }
  return r.data;
}

export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction) {
  if (err instanceof HttpError) {
    res.status(err.status).json({ error: { code: err.code, message: err.message, ...(err.details ? { details: err.details } : {}) } });
    return;
  }
  if (err instanceof ZodError) {
    res.status(422).json({ error: { code: 'validation_failed', message: 'Invalid input.' } });
    return;
  }
  // Broken or unreadable request bodies are the sender's mistake (400), not a server fault (500).
  if (['entity.parse.failed', 'charset.unsupported', 'encoding.unsupported', 'request.aborted', 'request.size.invalid'].includes((err as { type?: string })?.type ?? '')) {
    res.status(400).json({ error: { code: 'bad_request', message: 'The request could not be read.' } });
    return;
  }
  if (err instanceof URIError) {
    res.status(400).json({ error: { code: 'bad_request', message: 'The address is not valid.' } });
    return;
  }
  if ((err as { type?: string })?.type === 'entity.too.large') {
    res.status(413).json({ error: { code: 'too_large', message: 'Request is too large.' } });
    return;
  }
  // Never leak internals (SQL, stack traces) to clients.
  const code = (err as { code?: string })?.code ?? '';
  if (/^(ECONNREFUSED|ETIMEDOUT|ENOTFOUND|ER_ACCESS_DENIED_ERROR|ER_ACCESS_DENIED_NO_PASSWORD_ERROR|ER_DBACCESS_DENIED_ERROR|ER_BAD_DB_ERROR|ER_NO_SUCH_TABLE|ER_HOST_NOT_PRIVILEGED)$/.test(code)) {
    // Database not reachable/set up: one plain-language report per minute instead of a stack per request.
    void checkDatabase(true);
    res.status(503).json({ error: { code: 'database_unavailable', message: 'The service is temporarily unavailable. Please try again shortly.' } });
    return;
  }
  console.error('[api] unhandled error', req.method, req.originalUrl, err);
  res.status(500).json({ error: { code: 'server_error', message: 'Something went wrong. Please try again.' } });
}

/** Standard pagination query params, capped to keep queries cheap. */
export const pageQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  perPage: z.coerce.number().int().min(1).max(100).default(25),
});

/** Escape user input for SQL LIKE (the value itself is still bound as a parameter). */
export const escapeLike = (v: string) => v.replace(/[\\%_]/g, (c) => '\\' + c);
export const like = (v: string) => `%${escapeLike(v)}%`;
