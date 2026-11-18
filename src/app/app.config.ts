import { ApplicationConfig, inject, provideAppInitializer, provideBrowserGlobalErrorListeners } from '@angular/core';
import { provideHttpClient, withFetch, withInterceptors, withXsrfConfiguration } from '@angular/common/http';
import { apiOriginInterceptor } from './core/public-api';
import { provideRouter, withComponentInputBinding, withInMemoryScrolling } from '@angular/router';
import { provideClientHydration, withEventReplay } from '@angular/platform-browser';
import { routes } from './app.routes';
import { MotionService } from './core/motion.service';
import { AuthService } from './core/auth.service';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideRouter(routes, withComponentInputBinding(), withInMemoryScrolling({ scrollPositionRestoration: 'top', anchorScrolling: 'enabled' })),
    provideClientHydration(withEventReplay()),
    // CSRF: Angular copies the XSRF-TOKEN cookie into this header on every state-changing request.
    provideHttpClient(withFetch(), withInterceptors([apiOriginInterceptor]), withXsrfConfiguration({ cookieName: 'XSRF-TOKEN', headerName: 'X-XSRF-TOKEN' })),
    provideAppInitializer(() => {
      inject(MotionService).init();
      void inject(AuthService).init(); // non-blocking: public pages render immediately
    }),
  ],
};
