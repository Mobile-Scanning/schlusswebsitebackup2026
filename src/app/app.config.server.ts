import { mergeApplicationConfig, ApplicationConfig, ErrorHandler } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';

/** Server-side rendering: report failed API calls as one short line (details are logged by the API itself). */
class ServerErrorHandler implements ErrorHandler {
  handleError(error: unknown): void {
    if (error instanceof HttpErrorResponse) console.error(`[ssr] ${error.status} from ${error.url}`);
    else console.error('[ssr]', error);
  }
}
import { provideServerRendering, withRoutes } from '@angular/ssr';
import { appConfig } from './app.config';
import { serverRoutes } from './app.routes.server';

const serverConfig: ApplicationConfig = {
  providers: [
    provideServerRendering(withRoutes(serverRoutes)),
    { provide: ErrorHandler, useClass: ServerErrorHandler },
  ]
};

export const config = mergeApplicationConfig(appConfig, serverConfig);
