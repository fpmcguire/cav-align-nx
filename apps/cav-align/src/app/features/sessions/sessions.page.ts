import { Component, inject, signal, computed, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ApiService } from '../../core/services/api.service';
import type { IntentArtifactSummary } from '@cav-align/core';

type LoadState = 'loading' | 'empty' | 'loaded' | 'error';

@Component({
  selector: 'app-sessions-page',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="page">
      <header class="page-header">
        <h1 class="page-title">Sessions</h1>
        <button
          class="btn-icon"
          (click)="reload()"
          title="Refresh"
          [disabled]="state() === 'loading'"
        >
          <i class="fa-solid fa-rotate-right" [class.spinning]="state() === 'loading'"></i>
        </button>
      </header>

      <div class="page-body">
        @if (state() === 'loading') {
          <div class="state-center">
            <i class="fa-solid fa-circle-notch fa-spin state-icon muted"></i>
            <p class="state-label">Loading intent artifacts…</p>
          </div>
        }

        @if (state() === 'error') {
          <div class="state-center">
            <i class="fa-solid fa-triangle-exclamation state-icon warning"></i>
            <p class="state-label">Failed to load intent artifacts. Is the API running?</p>
          </div>
        }

        @if (state() === 'empty') {
          <div class="state-center">
            <i class="fa-solid fa-layer-group state-icon muted"></i>
            <p class="state-label">No intent artifacts found.</p>
            <p class="state-sublabel">Create an intent artifact to start tracking alignment.</p>
          </div>
        }

        @if (state() === 'loaded') {
          <div class="filter-bar">
            @for (dim of dimensions; track dim.value) {
              <button
                class="filter-btn"
                [class.active]="activeDimension() === dim.value"
                (click)="setDimension(dim.value)"
              >
                {{ dim.label }}
              </button>
            }
          </div>

          <div class="artifact-grid">
            @for (artifact of filtered(); track artifact.id) {
              <div class="artifact-card" [attr.data-status]="artifact.status">
                <div class="artifact-header">
                  <span class="artifact-name">{{ artifact.name }}</span>
                  <span class="artifact-status" [attr.data-status]="artifact.status">
                    {{ artifact.status }}
                  </span>
                </div>
                <div class="artifact-meta">
                  <span class="artifact-topic">
                    <i class="fa-solid fa-hashtag"></i> {{ artifact.topicScope }}
                  </span>
                  <span class="artifact-dim dim-{{ artifact.dimension }}">
                    {{ artifact.dimension }}
                  </span>
                </div>
                <div class="artifact-footer">
                  <span class="artifact-version">v{{ artifact.currentVersion }}</span>
                  <span class="artifact-updated">
                    Updated {{ artifact.updatedAt | date: 'MMM d, y' }}
                  </span>
                </div>
              </div>
            }
          </div>
        }
      </div>
    </div>
  `,
  styles: [
    `
      .page {
        display: flex;
        flex-direction: column;
        height: 100%;
      }

      .page-header {
        display: flex;
        align-items: center;
        height: var(--topbar-height);
        padding: 0 var(--space-6);
        border-bottom: 1px solid var(--color-border-subtle);
        flex-shrink: 0;
        gap: var(--space-3);
      }
      .page-title {
        margin: 0;
        font-size: var(--text-md);
        font-weight: var(--font-weight-semibold);
        color: var(--color-text-primary);
        flex: 1;
      }
      .btn-icon {
        background: none;
        border: none;
        cursor: pointer;
        color: var(--color-text-secondary);
        padding: var(--space-1);
        border-radius: var(--radius-sm);
        &:hover {
          color: var(--color-text-primary);
        }
        &:disabled {
          opacity: 0.4;
          cursor: default;
        }
      }
      .spinning {
        animation: spin 0.8s linear infinite;
      }
      @keyframes spin {
        to {
          transform: rotate(360deg);
        }
      }

      .page-body {
        flex: 1;
        padding: var(--space-6);
        overflow: auto;
      }

      /* State views */
      .state-center {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        height: 100%;
        gap: var(--space-2);
        padding: var(--space-10);
      }
      .state-icon {
        font-size: 2rem;
      }
      .state-icon.muted {
        color: var(--color-text-tertiary);
      }
      .state-icon.warning {
        color: var(--color-warning);
      }
      .state-label {
        color: var(--color-text-secondary);
        margin: 0;
        font-size: var(--text-sm);
      }
      .state-sublabel {
        color: var(--color-text-tertiary);
        margin: 0;
        font-size: var(--text-xs);
      }

      /* Filter bar */
      .filter-bar {
        display: flex;
        gap: var(--space-2);
        margin-bottom: var(--space-4);
      }
      .filter-btn {
        padding: var(--space-1) var(--space-3);
        border: 1px solid var(--color-border-subtle);
        border-radius: var(--radius-full);
        background: none;
        color: var(--color-text-secondary);
        cursor: pointer;
        font-size: var(--text-xs);
        font-weight: var(--font-weight-medium);
        transition: all 0.15s ease;
        &:hover {
          border-color: var(--color-border);
          color: var(--color-text-primary);
        }
        &.active {
          background: var(--color-accent);
          border-color: var(--color-accent);
          color: #fff;
        }
      }

      /* Artifact grid */
      .artifact-grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
        gap: var(--space-4);
      }
      .artifact-card {
        border: 1px solid var(--color-border-subtle);
        border-radius: var(--radius-md);
        padding: var(--space-4);
        background: var(--color-surface-raised);
        display: flex;
        flex-direction: column;
        gap: var(--space-2);
        transition: border-color 0.15s ease;
        &:hover {
          border-color: var(--color-border);
        }
      }
      .artifact-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: var(--space-2);
      }
      .artifact-name {
        font-weight: var(--font-weight-semibold);
        color: var(--color-text-primary);
        font-size: var(--text-sm);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .artifact-status {
        font-size: var(--text-xs);
        padding: 2px var(--space-2);
        border-radius: var(--radius-full);
        flex-shrink: 0;
        &[data-status='active'] {
          background: var(--color-success-subtle);
          color: var(--color-success);
        }
        &[data-status='draft'] {
          background: var(--color-warning-subtle);
          color: var(--color-warning);
        }
        &[data-status='archived'] {
          background: var(--color-border-subtle);
          color: var(--color-text-tertiary);
        }
      }
      .artifact-meta {
        display: flex;
        align-items: center;
        gap: var(--space-3);
      }
      .artifact-topic {
        font-size: var(--text-xs);
        color: var(--color-text-secondary);
        font-family: var(--font-mono);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        i {
          margin-right: 2px;
          opacity: 0.5;
        }
      }
      .artifact-dim {
        font-size: var(--text-xs);
        font-weight: var(--font-weight-medium);
        padding: 2px var(--space-2);
        border-radius: var(--radius-full);
        flex-shrink: 0;
        &.dim-shape {
          background: rgba(59, 130, 246, 0.12);
          color: #60a5fa;
        }
        &.dim-cadence {
          background: rgba(168, 85, 247, 0.12);
          color: #c084fc;
        }
        &.dim-domain {
          background: rgba(34, 197, 94, 0.12);
          color: #4ade80;
        }
      }
      .artifact-footer {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding-top: var(--space-2);
        border-top: 1px solid var(--color-border-subtle);
      }
      .artifact-version {
        font-size: var(--text-xs);
        color: var(--color-text-tertiary);
        font-family: var(--font-mono);
      }
      .artifact-updated {
        font-size: var(--text-xs);
        color: var(--color-text-tertiary);
      }
    `,
  ],
})
export class SessionsPage implements OnInit {
  private readonly api = inject(ApiService);

  private readonly artifacts = signal<IntentArtifactSummary[]>([]);
  protected readonly activeDimension = signal<string>('all');
  protected readonly state = signal<LoadState>('loading');

  protected readonly dimensions = [
    { label: 'All', value: 'all' },
    { label: 'Shape', value: 'shape' },
    { label: 'Cadence', value: 'cadence' },
    { label: 'Domain', value: 'domain' },
  ];

  protected readonly filtered = computed(() => {
    const dim = this.activeDimension();
    const all = this.artifacts();
    return dim === 'all' ? all : all.filter((a) => a.dimension === dim);
  });

  ngOnInit(): void {
    this.load();
  }

  protected reload(): void {
    this.load();
  }

  protected setDimension(dim: string): void {
    this.activeDimension.set(dim);
  }

  private load(): void {
    this.state.set('loading');
    this.api.intent.list().subscribe({
      next: (items) => {
        this.artifacts.set(items);
        this.state.set(items.length === 0 ? 'empty' : 'loaded');
      },
      error: () => this.state.set('error'),
    });
  }
}
