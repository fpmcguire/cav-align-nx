import { Component } from '@angular/core';

@Component({
  selector: 'app-divergence-log-page',
  template: `
    <div class="page">
      <header class="page-header">
        <h1 class="page-title">Divergence Log</h1>
      </header>
      <div class="page-body">
        <!-- Phase 4: Chronological divergence event log with filters -->
      </div>
    </div>
  `,
  styles: [`
    .page { display: flex; flex-direction: column; height: 100%; }
    .page-header {
      display: flex; align-items: center; height: var(--topbar-height);
      padding: 0 var(--space-6);
      border-bottom: 1px solid var(--color-border-subtle);
      flex-shrink: 0;
    }
    .page-title { margin: 0; font-size: var(--text-md); font-weight: var(--font-weight-semibold); color: var(--color-text-primary); }
    .page-body { flex: 1; padding: var(--space-6); overflow: auto; }
  `],
})
export class DivergenceLogPage {}
