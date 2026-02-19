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
    path: 'expected-divergences',
    loadComponent: () =>
      import('../features/expected-divergence/expected-divergence-list.page').then(
        (m) => m.ExpectedDivergenceListPage,
      ),
  },
  {
    path: 'expected-divergences/create',
    loadComponent: () =>
      import('../features/expected-divergence/create-expected-divergence.page').then(
        (m) => m.CreateExpectedDivergencePage,
      ),
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
