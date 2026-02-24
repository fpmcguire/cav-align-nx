import { Component, inject, signal, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { environment } from '../../../environments/environment';

// Runtime session from alignment_sessions table
interface RuntimeSession {
  id: string;
  tenant_id: string;
  connection_id: string;
  protocol: string;
  status: 'starting' | 'active' | 'stopped' | 'error';
  health: 'healthy' | 'degraded' | 'stalled';
  message_count: number;
  started_at: string;
  stopped_at: string | null;
}

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
            <p class="state-label">Loading sessions…</p>
          </div>
        }

        @if (state() === 'error') {
          <div class="state-center">
            <i class="fa-solid fa-triangle-exclamation state-icon warning"></i>
            <p class="state-label">Failed to load sessions. Is the API running?</p>
          </div>
        }

        @if (state() === 'empty') {
          <div class="state-center">
            <i class="fa-solid fa-network-wired state-icon muted"></i>
            <p class="state-label">No sessions found.</p>
            <p class="state-sublabel">Start a connection to begin monitoring.</p>
          </div>
        }

        @if (state() === 'loaded') {
          <div class="sessions-list">
            @for (session of sessions(); track session.id) {
              <div class="session-card" [attr.data-status]="session.status">
                <div class="session-header">
                  <div class="session-id">
                    <i class="fa-solid fa-circle-dot"></i>
                    {{ session.id.substring(0, 8) }}...
                  </div>
                  <span class="session-status" [attr.data-status]="session.status">
                    {{ session.status }}
                  </span>
                </div>
                <div class="session-meta">
                  <div class="meta-item">
                    <span class="meta-label">Protocol</span>
                    <span class="meta-value">{{ session.protocol | uppercase }}</span>
                  </div>
                  <div class="meta-item">
                    <span class="meta-label">Health</span>
                    <span class="meta-value health-{{ session.health }}">
                      {{ session.health }}
                    </span>
                  </div>
                  <div class="meta-item">
                    <span class="meta-label">Messages</span>
                    <span class="meta-value">{{ session.message_count | number }}</span>
                  </div>
                </div>
                <div class="session-footer">
                  <span class="session-time">
                    Started {{ session.started_at | date: 'MMM d, y h:mm a' }}
                  </span>
                  @if (session.stopped_at) {
                    <span class="session-time">
                      Stopped {{ session.stopped_at | date: 'MMM d, y h:mm a' }}
                    </span>
                  }
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

      /* Sessions list */
      .sessions-list {
        display: flex;
        flex-direction: column;
        gap: var(--space-3);
        max-width: 800px;
      }
      .session-card {
        border: 1px solid var(--color-border-subtle);
        border-radius: var(--radius-md);
        padding: var(--space-4);
        background: var(--color-surface-raised);
        display: flex;
        flex-direction: column;
        gap: var(--space-3);
        transition: border-color 0.15s ease;
        &:hover {
          border-color: var(--color-border);
        }
      }
      .session-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: var(--space-2);
      }
      .session-id {
        font-family: var(--font-mono);
        font-size: var(--text-sm);
        color: var(--color-text-secondary);
        display: flex;
        align-items: center;
        gap: var(--space-2);
        i {
          color: var(--color-accent);
        }
      }
      .session-status {
        font-size: var(--text-xs);
        padding: 2px var(--space-2);
        border-radius: var(--radius-full);
        flex-shrink: 0;
        font-weight: var(--font-weight-medium);
        &[data-status='active'] {
          background: var(--color-success-subtle);
          color: var(--color-success);
        }
        &[data-status='starting'] {
          background: var(--color-warning-subtle);
          color: var(--color-warning);
        }
        &[data-status='stopped'] {
          background: var(--color-border-subtle);
          color: var(--color-text-tertiary);
        }
        &[data-status='error'] {
          background: var(--color-danger-subtle);
          color: var(--color-danger);
        }
      }
      .session-meta {
        display: grid;
        grid-template-columns: repeat(3, 1fr);
        gap: var(--space-4);
      }
      .meta-item {
        display: flex;
        flex-direction: column;
        gap: 4px;
      }
      .meta-label {
        font-size: var(--text-xs);
        color: var(--color-text-tertiary);
        text-transform: uppercase;
        letter-spacing: 0.5px;
      }
      .meta-value {
        font-size: var(--text-sm);
        color: var(--color-text-primary);
        font-weight: var(--font-weight-medium);
        &.health-healthy {
          color: var(--color-success);
        }
        &.health-degraded {
          color: var(--color-warning);
        }
        &.health-stalled {
          color: var(--color-danger);
        }
      }
      .session-footer {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding-top: var(--space-2);
        border-top: 1px solid var(--color-border-subtle);
      }
      .session-time {
        font-size: var(--text-xs);
        color: var(--color-text-tertiary);
      }
    `,
  ],
})
export class SessionsPage implements OnInit {
  private readonly http = inject(HttpClient);

  protected readonly sessions = signal<RuntimeSession[]>([]);
  protected readonly state = signal<LoadState>('loading');

  ngOnInit(): void {
    this.load();
  }

  protected reload(): void {
    this.load();
  }

  private load(): void {
    this.state.set('loading');
    this.http
      .get<{ sessions: RuntimeSession[] }>(`${environment.apiUrl}/sessions`)
      .subscribe({
        next: (response) => {
          this.sessions.set(response.sessions);
          this.state.set(response.sessions.length === 0 ? 'empty' : 'loaded');
        },
        error: () => this.state.set('error'),
      });
  }
}
