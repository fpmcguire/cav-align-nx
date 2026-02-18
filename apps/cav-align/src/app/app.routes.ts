import { Route } from '@angular/router';
import { authGuard } from './core/guards/auth.guard';
import { noAuthGuard } from './core/guards/no-auth.guard';

export const appRoutes: Route[] = [
  {
    path: 'auth',
    canActivate: [noAuthGuard],
    loadChildren: () =>
      import('./features/auth/auth.routes').then((m) => m.authRoutes),
  },
  {
    path: 'app',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./shell/shell.component').then((m) => m.ShellComponent),
    loadChildren: () =>
      import('./shell/shell.routes').then((m) => m.shellRoutes),
  },
  {
    path: '',
    redirectTo: 'app',
    pathMatch: 'full',
  },
  {
    path: '**',
    redirectTo: 'app',
  },
];
