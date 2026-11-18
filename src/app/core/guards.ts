import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService, UserType } from './auth.service';

/** UI guard only – every API call is independently authorised on the server. */
export function requireUser(...types: UserType[]): CanActivateFn {
  return async (_route, state) => {
    const auth = inject(AuthService);
    const router = inject(Router);
    await auth.init();
    const u = auth.user();
    if (!u) return router.createUrlTree(['/login'], { queryParams: { next: state.url } });
    if (types.length && !types.includes(u.type)) return router.createUrlTree([auth.homeFor(u.type)]);
    return true;
  };
}

/** Requires ANY of the given permissions. */
export function requirePermission(...permissions: string[]): CanActivateFn {
  return async () => {
    const auth = inject(AuthService);
    await auth.init();
    return permissions.some((p) => auth.can(p)) ? true : inject(Router).createUrlTree(['/admin']);
  };
}

/** Signed-in users skip the login/register pages. */
export const guestOnly: CanActivateFn = async () => {
  const auth = inject(AuthService);
  await auth.init();
  const u = auth.user();
  return u ? inject(Router).createUrlTree([auth.homeFor(u.type)]) : true;
};
