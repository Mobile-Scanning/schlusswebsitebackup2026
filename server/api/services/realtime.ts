import { EventEmitter } from 'node:events';
import type { Request, Response } from 'express';

/**
 * In-process event bus for live chat updates (Server-Sent Events).
 * The website runs as one Node process, so no extra service (Redis etc.) is needed. If the site is ever
 * scaled to several processes, clients still stay correct: they also poll every 60 s as a fallback.
 */
const bus = new EventEmitter();
bus.setMaxListeners(0);

export type LiveEvent = { ticketId: number; kind: 'message' | 'status' };

export function publish(e: LiveEvent) {
  bus.emit('ticket:' + e.ticketId, e);
  bus.emit('tickets', e);
}

/** Open an SSE stream; `channel` is 'tickets' (staff) or 'ticket:<id>' (one conversation). */
export function stream(req: Request, res: Response, channel: string) {
  res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
  res.flushHeaders?.();
  res.write('retry: 5000\n\n');
  const send = (e: LiveEvent) => res.write(`event: update\ndata: ${JSON.stringify(e)}\n\n`);
  const ping = setInterval(() => res.write(': ping\n\n'), 25_000);
  bus.on(channel, send);
  req.on('close', () => {
    clearInterval(ping);
    bus.off(channel, send);
  });
}
