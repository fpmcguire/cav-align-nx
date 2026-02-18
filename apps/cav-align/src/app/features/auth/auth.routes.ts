import { Route } from '@angular/router';

export const authRoutes: Route[] = [
  {
    path: 'login',
    loadComponent: () =>
      import('./login/login.page').then((m) => m.LoginPage),
  },
  {
    path: 'signup',
    loadComponent: () =>
      import('./signup/signup.page').then((m) => m.SignupPage),
  },
  {
    path: 'reset-password',
    loadComponent: () =>
      import('./reset-password/reset-password.page').then((m) => m.ResetPasswordPage),
  },
  {
    path: '',
    redirectTo: 'login',
    pathMatch: 'full',
  },
];
