import { RenderMode, ServerRoute } from '@angular/ssr';

/**
 * Public pages are server-rendered (fast first paint, indexable, data fetched on the server).
 * Sign-in forms and portals render in the browser only – they are personal and never indexed.
 */
export const serverRoutes: ServerRoute[] = [
  ...['login', 'register', 'forgot-password', 'reset-password'].map((path) => ({ path, renderMode: RenderMode.Client as const })),
  ...['account', 'partner', 'admin'].flatMap((p) => [
    { path: p, renderMode: RenderMode.Client as const },
    { path: `${p}/**`, renderMode: RenderMode.Client as const },
  ]),
  { path: '**', renderMode: RenderMode.Server },
];
