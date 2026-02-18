import { Component, inject } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { map } from 'rxjs';

@Component({
  selector: 'app-topic-detail-page',
  imports: [],
  template: `
    <div class="page">
      <header class="page-header">
        <h1 class="page-title">{{ topicId() }}</h1>
      </header>
      <div class="page-body">
        <!-- Phase 4: OT baseline, divergence history, live message stream -->
      </div>
    </div>
  `,
  styles: [`
    .page { display: flex; flex-direction: column; height: 100%; }
    .page-header {
      display: flex; align-items: center; height: var(--topbar-height);
      padding: 0 var(--space-6); border-bottom: 1px solid var(--color-border-subtle); flex-shrink: 0;
    }
    .page-title {
      margin: 0; font-size: var(--text-base); font-weight: var(--font-weight-medium);
      color: var(--color-text-primary); font-family: var(--font-mono);
    }
    .page-body { flex: 1; padding: var(--space-6); overflow: auto; }
  `],
})
export class TopicDetailPage {
  readonly topicId = toSignal(
    inject(ActivatedRoute).paramMap.pipe(map((p) => p.get('id') ?? ''))
  );
}
