import { Route } from '@angular/router';

export const shellRoutes: Route[] = [
  {
    path: 'sessions',
    loadComponent: () =>
      import('../features/sessions/sessions.page').then((m) => m.SessionsPage),
  },
  {
    path: 'topics',
    loadComponent: () =>
      import('../features/topics/topics.page').then((m) => m.TopicsPage),
  },
  {
    path: 'topics/:id',
    loadComponent: () =>
      import('../features/topics/topic-detail.page').then((m) => m.TopicDetailPage),
  },
  {
    path: 'divergence',
    loadComponent: () =>
      import('../features/divergence/divergence-log.page').then((m) => m.DivergenceLogPage),
  },
  {
    path: 'connections',
    loadComponent: () =>
      import('../features/connections/connections.page').then((m) => m.ConnectionsPage),
  },
  {
    path: '',
    redirectTo: 'sessions',
    pathMatch: 'full',
  },
];
