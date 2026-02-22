/**
 * expected-divergence-list.page.ts
 *
 * Lists all Expected Divergence declarations for the tenant.
 * Supports filtering by status and topic search.
 */

import { Component, inject, signal, computed, afterNextRender } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { ExpectedDivergenceService } from '../../core/services/expected-divergence.service';
import { AppIconComponent } from '@cav-align/ui';
import type { ExpectedDivergenceSummary } from '@cav-align/core';

type StatusFilter = 'all' | 'pending' | 'confirmed' | 'missed' | 'cancelled';

@Component({
  selector: 'app-expected-divergence-list-page',
  imports: [FormsModule, RouterLink, AppIconComponent],
  template: `
    <div class="page">
      <header class="page-header">
        <h1 class="page-title">Expected Divergences</h1>
        <div class="header-actions">
          <a routerLink="/app/expected-divergences/create" class="btn-primary">
            <app-icon name="calendar-plus" />
            <span>Declare Change</span>
          </a>
        </div>
      </header>

      <div class="page-body">
        <!-- Filters -->
        <div class="filters">
          <div class="filter-tabs">
            @for (sf of statusFilters; track sf.value) {
              <button
                class="filter-tab"
                [class.active]="activeStatus() === sf.value"
                (click)="setStatus(sf.value)"
              >
                {{ sf.label }}
                @if (countByStatus(sf.value) > 0) {
                  <span class="badge">{{ countByStatus(sf.value) }}</span>
                }
              </button>
            }
          </div>

          <div class="search-wrap">
            <app-icon name="magnifying-glass" />
            <input
              class="search-input"
              type="text"
              [(ngModel)]="topicSearch"
              placeholder="Filter by topic…"
              (ngModelChange)="onSearchChange()"
            />
          </div>
        </div>

        <!-- Table -->
        @if (loading()) {
          <div class="empty-state">
            <app-icon name="rotate" />
            <span>Loading…</span>
          </div>
        } @else if (error()) {
          <div class="empty-state empty-state--error">
            <app-icon name="triangle-exclamation" />
            <span>{{ error() }}</span>
          </div>
        } @else if (filtered().length === 0) {
          <div class="empty-state">
            <app-icon name="calendar-days" />
            <span>No expected divergences found.</span>
            <a routerLink="/app/expected-divergences/create" class="empty-cta">
              Declare a planned change →
            </a>
          </div>
        } @else {
          <div class="table-wrap">
            <table class="table">
              <thead>
                <tr>
                  <th>Topic</th>
                  <th>Identity Scope</th>
                  <th>Dimensions</th>
                  <th>Window</th>
                  <th>Status</th>
                  <th class="th-actions">Actions</th>
                </tr>
              </thead>
              <tbody>
                @for (item of filtered(); track item.id) {
                  <tr>
                    <td class="td-topic mono truncate" [title]="item.topic">{{ item.topic }}</td>
                    <td class="td-identity">
                      @if (item.identityScope) {
                        <span class="tag tag--identity">{{ item.identityScope }}</span>
                      } @else {
                        <span class="muted">All devices</span>
                      }
                    </td>
                    <td class="td-dims">
                      <div class="dim-tags">
                        @for (d of item.expectedDimensions; track d) {
                          <span class="tag tag--dim">{{ d }}</span>
                        }
                      </div>
                    </td>
                    <td class="td-window">
                      <span class="window-range">
                        {{ formatWindowTime(item.windowStart) }}
                        <span class="arrow">→</span>
                        {{ formatWindowTime(item.windowEnd) }}
                      </span>
                    </td>
                    <td>
                      <span class="status-badge" [class]="'status-badge--' + item.status">
                        <app-icon [name]="statusIcon(item.status)" />
                        {{ item.status }}
                        @if (item.status === 'confirmed' && item.matchedCount > 0) {
                          ({{ item.matchedCount }})
                        }
                      </span>
                    </td>
                    <td class="td-actions">
                      @if (item.status === 'pending' && canCancel(item)) {
                        <button
                          class="btn-sm btn-ghost"
                          (click)="cancel(item)"
                          title="Cancel expectation"
                        >
                          <app-icon name="ban" />
                          Cancel
                        </button>
                      }
                    </td>
                  </tr>
                }
              </tbody>
            </table>
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
        justify-content: space-between;
        height: var(--topbar-height);
        padding: 0 var(--space-6);
        border-bottom: 1px solid var(--color-border-subtle);
        flex-shrink: 0;
      }
      .page-title {
        margin: 0;
        font-size: var(--text-md);
        font-weight: var(--font-weight-semibold);
        color: var(--color-text-primary);
      }
      .header-actions {
        display: flex;
        gap: var(--space-3);
      }
      .page-body {
        flex: 1;
        padding: var(--space-6);
        overflow: auto;
        display: flex;
        flex-direction: column;
        gap: var(--space-4);
      }

      /* Filters */
      .filters {
        display: flex;
        align-items: center;
        gap: var(--space-4);
        flex-wrap: wrap;
      }
      .filter-tabs {
        display: flex;
        gap: var(--space-1);
        background: var(--color-bg-raised);
        border-radius: var(--radius-md);
        padding: 3px;
      }
      .filter-tab {
        display: flex;
        align-items: center;
        gap: var(--space-2);
        height: 28px;
        padding: 0 var(--space-3);
        background: transparent;
        border: none;
        border-radius: var(--radius-sm);
        color: var(--color-text-secondary);
        font-size: var(--text-sm);
        cursor: pointer;
        transition:
          color var(--transition-fast),
          background var(--transition-fast);
      }
      .filter-tab:hover {
        color: var(--color-text-primary);
      }
      .filter-tab.active {
        background: var(--color-bg-overlay);
        color: var(--color-text-primary);
      }
      .badge {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        min-width: 18px;
        height: 18px;
        padding: 0 var(--space-1);
        background: var(--color-bg-overlay);
        border-radius: 9px;
        font-size: var(--text-xs);
        color: var(--color-text-muted);
      }
      .search-wrap {
        display: flex;
        align-items: center;
        gap: var(--space-2);
        background: var(--color-bg-raised);
        border: 1px solid var(--color-border-default);
        border-radius: var(--radius-md);
        padding: 0 var(--space-3);
        height: 34px;
        color: var(--color-text-muted);
      }
      .search-input {
        background: transparent;
        border: none;
        outline: none;
        color: var(--color-text-primary);
        font-size: var(--text-sm);
        width: 200px;
      }
      .search-input::placeholder {
        color: var(--color-text-muted);
      }

      /* Table */
      .table-wrap {
        overflow-x: auto;
      }
      .table {
        width: 100%;
        border-collapse: collapse;
        font-size: var(--text-sm);
      }
      .table th {
        text-align: left;
        padding: var(--space-2) var(--space-3);
        border-bottom: 1px solid var(--color-border-default);
        color: var(--color-text-muted);
        font-weight: var(--font-weight-medium);
        white-space: nowrap;
      }
      .table td {
        padding: var(--space-3);
        border-bottom: 1px solid var(--color-border-subtle);
        color: var(--color-text-primary);
        vertical-align: middle;
      }
      .table tr:last-child td {
        border-bottom: none;
      }
      .table tr:hover td {
        background: var(--color-bg-raised);
      }
      .th-actions,
      .td-actions {
        text-align: right;
      }

      .td-topic {
        max-width: 200px;
        font-family: var(--font-mono);
        font-size: var(--text-xs);
      }
      .td-window {
        white-space: nowrap;
      }
      .window-range {
        display: flex;
        align-items: center;
        gap: var(--space-2);
        color: var(--color-text-secondary);
        font-size: var(--text-xs);
        font-family: var(--font-mono);
      }
      .arrow {
        color: var(--color-text-muted);
      }
      .muted {
        color: var(--color-text-muted);
        font-size: var(--text-xs);
      }
      .mono {
        font-family: var(--font-mono);
      }

      .dim-tags {
        display: flex;
        gap: var(--space-1);
        flex-wrap: wrap;
      }
      .tag {
        display: inline-flex;
        align-items: center;
        height: 20px;
        padding: 0 var(--space-2);
        border-radius: var(--radius-sm);
        font-size: var(--text-xs);
        font-weight: var(--font-weight-medium);
      }
      .tag--dim {
        background: var(--color-bg-overlay);
        color: var(--color-text-secondary);
      }
      .tag--identity {
        background: rgba(79, 142, 247, 0.12);
        color: var(--color-accent);
      }

      .status-badge {
        display: inline-flex;
        align-items: center;
        gap: var(--space-1);
        height: 22px;
        padding: 0 var(--space-2);
        border-radius: var(--radius-sm);
        font-size: var(--text-xs);
        font-weight: var(--font-weight-medium);
        text-transform: capitalize;
      }
      .status-badge--pending {
        background: rgba(79, 142, 247, 0.1);
        color: var(--color-accent);
      }
      .status-badge--confirmed {
        background: rgba(76, 175, 128, 0.12);
        color: #4caf80;
      }
      .status-badge--missed {
        background: rgba(232, 168, 56, 0.1);
        color: var(--color-state-diverged);
      }
      .status-badge--cancelled {
        background: var(--color-bg-overlay);
        color: var(--color-text-muted);
      }

      .td-dims {
        min-width: 140px;
      }

      .empty-state {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: var(--space-4);
        padding: var(--space-16) var(--space-8);
        color: var(--color-text-muted);
        font-size: var(--text-sm);
      }
      .empty-state--error {
        color: var(--color-state-diverged);
      }
      .empty-cta {
        color: var(--color-accent);
        text-decoration: none;
      }
      .empty-cta:hover {
        color: var(--color-accent-hover);
      }

      .btn-primary {
        display: inline-flex;
        align-items: center;
        gap: var(--space-2);
        height: 32px;
        padding: 0 var(--space-3);
        background: var(--color-accent);
        border: none;
        border-radius: var(--radius-md);
        color: var(--color-text-inverse);
        font-size: var(--text-sm);
        font-weight: var(--font-weight-medium);
        cursor: pointer;
        text-decoration: none;
        transition: background var(--transition-fast);
      }
      .btn-primary:hover {
        background: var(--color-accent-hover);
      }

      .btn-sm {
        display: inline-flex;
        align-items: center;
        gap: var(--space-1);
        height: 26px;
        padding: 0 var(--space-2);
        border-radius: var(--radius-sm);
        font-size: var(--text-xs);
        cursor: pointer;
      }
      .btn-ghost {
        background: transparent;
        border: 1px solid var(--color-border-default);
        color: var(--color-text-secondary);
        transition:
          color var(--transition-fast),
          border-color var(--transition-fast);
      }
      .btn-ghost:hover {
        color: var(--color-text-primary);
        border-color: var(--color-border-strong);
      }
    `,
  ],
})
export class ExpectedDivergenceListPage {
  private readonly svc = inject(ExpectedDivergenceService);
  private readonly router = inject(Router);

  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly items = signal<ExpectedDivergenceSummary[]>([]);
  readonly activeStatus = signal<StatusFilter>('all');
  topicSearch = '';

  readonly statusFilters: { value: StatusFilter; label: string }[] = [
    { value: 'all', label: 'All' },
    { value: 'pending', label: 'Pending' },
    { value: 'confirmed', label: 'Confirmed' },
    { value: 'missed', label: 'Missed' },
    { value: 'cancelled', label: 'Cancelled' },
  ];

  readonly filtered = computed(() => {
    const status = this.activeStatus();
    const search = this.topicSearch.toLowerCase();
    return this.items().filter((i) => {
      const statusOk = status === 'all' || i.status === status;
      const topicOk = !search || i.topic.toLowerCase().includes(search);
      return statusOk && topicOk;
    });
  });

  constructor() {
    afterNextRender(() => {
      this.load();
    });
  }

  load(): void {
    this.loading.set(true);
    this.error.set(null);
    this.svc.list().subscribe({
      next: (data) => {
        this.items.set(data);
        this.loading.set(false);
      },
      error: () => {
        this.error.set('Failed to load expected divergences.');
        this.loading.set(false);
      },
    });
  }

  setStatus(s: StatusFilter): void {
    this.activeStatus.set(s);
  }
  onSearchChange(): void {
    /* reactive via computed */
  }

  countByStatus(status: StatusFilter): number {
    if (status === 'all') return this.items().length;
    return this.items().filter((i) => i.status === status).length;
  }

  canCancel(item: ExpectedDivergenceSummary): boolean {
    return new Date(item.windowStart) > new Date();
  }

  cancel(item: ExpectedDivergenceSummary): void {
    this.svc.cancel(item.id).subscribe({
      next: () => this.load(),
      error: (err) => this.error.set(err?.error?.error ?? 'Failed to cancel.'),
    });
  }

  formatWindowTime(iso: string): string {
    return new Date(iso).toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  statusIcon(status: string): import('@cav-align/ui').AppIconName {
    switch (status) {
      case 'confirmed':
        return 'calendar-check';
      case 'missed':
        return 'calendar-xmark';
      case 'cancelled':
        return 'ban';
      default:
        return 'clock';
    }
  }
}
