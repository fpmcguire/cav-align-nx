/**
 * auth.interceptor.ts
 *
 * Attaches the Supabase JWT as a Bearer token to all requests
 * targeting the Align API (/api/* or the configured apiUrl).
 *
 * Requests to third-party URLs (e.g. Supabase directly, CDN assets)
 * are passed through untouched.
 */
import { HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { AuthService } from '../services/auth.service';
import { environment } from '@env/environment';

export const authInterceptor: HttpInterceptorFn = (req, next) => {
  // Only attach to requests targeting the Align API.
  if (!req.url.startsWith(environment.apiUrl) && !req.url.startsWith('/api')) {
    return next(req);
  }

  const token = inject(AuthService).getAccessToken();
  if (!token) return next(req);

  return next(
    req.clone({
      setHeaders: { Authorization: `Bearer ${token}` },
    })
  );
};
