/**
 * Entry point for the double-click offline preview (npm run build:offline).
 * Same app, but: hash URLs (work from file://), no server rendering, and the
 * API answered from a bundled data snapshot (src/offline/offline-api.ts).
 */
import { inject, provideAppInitializer, provideBrowserGlobalErrorListeners } from '@angular/core';
import { bootstrapApplication } from '@angular/platform-browser';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { provideRouter, withComponentInputBinding, withHashLocation, withInMemoryScrolling } from '@angular/router';
import { App } from './app/app';
import { routes } from './app/app.routes';
import { MotionService } from './app/core/motion.service';
import { AuthService } from './app/core/auth.service';
import { offlineApiInterceptor } from './offline/offline-api';

bootstrapApplication(App, {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideRouter(routes, withHashLocation(), withComponentInputBinding(), withInMemoryScrolling({ scrollPositionRestoration: 'top', anchorScrolling: 'enabled' })),
    provideHttpClient(withInterceptors([offlineApiInterceptor])),
    provideAppInitializer(() => {
      inject(MotionService).init();
      void inject(AuthService).init();
    }),
  ],
}).catch((err) => console.error(err));
