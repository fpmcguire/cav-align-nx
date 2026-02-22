/**
 * divergence-log.page.ts
 *
 * Chronological divergence event log with CAV Level 1.1 annotation labels.
 *
 * Labels:
 *   ● confirmed_planned_change  — Divergence matched a declared expectation
 *   ● missed_planned_change     — Expected divergence window expired without match
 *   ● unplanned_divergence      — No matching expectation found
 */

import { Component, inject, signal, computed, afterNextRender } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { AppIconComponent } from '@cav-align/ui';
import type { DivergenceEventLabel } from '@cav-align/core';
import { environment } from '../../../environments/environment';

interface DivergenceRow {
  id: string;
  dimension: string;
  status: string;
  sourceIdentifier: string | null;
  onsetEstimatedAt: string;
  confirmedAt: string | null;
  resolvedAt: string | null;
  evidence: Record<string, unknown> | null;
  deviceId: string | null;
  label: DivergenceEventLabel;
}

type DimFilter = 'all' | 'shape' | 'cadence' | 'domain';

interface ApiResponse {
  events: Omit<DivergenceRow, 'label'>[];
}

@Component({
  selector: 'app-divergence-log-page',
  imports: [RouterLink, AppIconComponent],
  template: `
    <div class="page">
      <header class="page-header">
        <h1 class="page-title">Divergence Log</h1>
        <div class="header-actions">
          <a routerLink="/app/expected-divergences/create" class="btn-ghost btn-sm">
            <app-icon name="calendar-plus" />
            <span>Declare Change</span>
          </a>
          <button class="btn-ghost btn-sm" (click)="load()">
            <app-icon name="rotate" />
          </button>
        </div>
      </header>

      <div class="page-body">
        <!-- Legend -->
        <div class="legend">
          @for (l of labelConfig; track l.label) {
            <div class="legend-item">
              <span class="legend-dot" [class]="'legend-dot--' + l.cssClass"></span>
              <span>{{ l.display }}</span>
            </div>
          }
        </div>

        <!-- Dimension filter -->
        <div class="dim-tabs">
          @for (tab of dimTabs; track tab.value) {
            <button
              class="dim-tab"
              [class.active]="dimFilter() === tab.value"
              (click)="dimFilter.set(tab.value)"
            >
              {{ tab.label }}
              @if (countByDim(tab.value) > 0) {
                <span class="badge">{{ countByDim(tab.value) }}</span>
              }
            </button>
          }
        </div>

        <!-- Content -->
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
            <app-icon name="bolt" />
            <span>No divergence events found.</span>
          </div>
        } @else {
          <div class="event-list">
            @for (evt of filtered(); track evt.id) {
              <div class="event-card" [class]="'event-card--' + getLabelClass(evt.label)">
                <!-- Label stripe -->
                <div
                  class="label-stripe"
                  [class]="'label-stripe--' + getLabelClass(evt.label)"
                ></div>

                <div class="event-body">
                  <div class="event-top">
                    <div class="event-meta">
                      <span class="dim-badge dim-badge--{{ evt.dimension }}">{{
                        evt.dimension
                      }}</span>
                      <span class="status-badge status-badge--{{ evt.status }}">{{
                        evt.status
                      }}</span>
                      @if (evt.deviceId) {
                        <span class="device-tag">{{ evt.deviceId }}</span>
                      }
                    </div>
                    <div class="event-label" [class]="'event-label--' + getLabelClass(evt.label)">
                      <app-icon [name]="getLabelIcon(evt.label)" />
                      <span>{{ getLabelDisplay(evt.label) }}</span>
                    </div>
                  </div>

                  <div class="event-source mono truncate" [title]="evt.sourceIdentifier ?? ''">
                    {{ evt.sourceIdentifier ?? 'Unknown source' }}
                  </div>

                  <div class="event-times">
                    <span class="time-item">
                      <span class="time-label">Onset</span>
                      <span class="time-value">{{ formatTime(evt.onsetEstimatedAt) }}</span>
                    </span>
                    @if (evt.confirmedAt) {
                      <span class="time-sep">·</span>
                      <span class="time-item">
                        <span class="time-label">Confirmed</span>
                        <span class="time-value">{{ formatTime(evt.confirmedAt) }}</span>
                      </span>
                    }
                    @if (evt.resolvedAt) {
                      <span class="time-sep">·</span>
                      <span class="time-item">
                        <span class="time-label">Resolved</span>
                        <span class="time-value">{{ formatTime(evt.resolvedAt) }}</span>
                      </span>
                    }
                  </div>

                  @if (evt.evidence) {
                    <div class="evidence-summary">
                      @if (evt.evidence['changeKind']) {
                        <span class="evidence-kind">{{ evt.evidence['changeKind'] }}</span>
                      }
                      @if (evt.evidence['affectedFieldPath']) {
                        <span class="evidence-field mono">{{
                          evt.evidence['affectedFieldPath']
                        }}</span>
                      }
                    </div>
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
        gap: var(--space-2);
      }
      .page-body {
        flex: 1;
        padding: var(--space-6);
        overflow: auto;
        display: flex;
        flex-direction: column;
        gap: var(--space-4);
      }

      /* Legend */
      .legend {
        display: flex;
        gap: var(--space-6);
        flex-wrap: wrap;
      }
      .legend-item {
        display: flex;
        align-items: center;
        gap: var(--space-2);
        font-size: var(--text-xs);
        color: var(--color-text-secondary);
      }
      .legend-dot {
        width: 8px;
        height: 8px;
        border-radius: 50%;
      }
      .legend-dot--planned {
        background: #4caf80;
      }
      .legend-dot--missed {
        background: var(--color-state-diverged);
      }
      .legend-dot--unplanned {
        background: #e06c75;
      }

      /* Dim filter */
      .dim-tabs {
        display: flex;
        gap: var(--space-1);
      }
      .dim-tab {
        display: flex;
        align-items: center;
        gap: var(--space-2);
        height: 28px;
        padding: 0 var(--space-3);
        background: transparent;
        border: 1px solid transparent;
        border-radius: var(--radius-sm);
        color: var(--color-text-secondary);
        font-size: var(--text-sm);
        cursor: pointer;
        transition: all var(--transition-fast);
      }
      .dim-tab:hover {
        color: var(--color-text-primary);
        border-color: var(--color-border-default);
      }
      .dim-tab.active {
        background: var(--color-bg-raised);
        color: var(--color-text-primary);
        border-color: var(--color-border-default);
      }
      .badge {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        min-width: 18px;
        height: 18px;
        padding: 0 4px;
        background: var(--color-bg-overlay);
        border-radius: 9px;
        font-size: var(--text-xs);
        color: var(--color-text-muted);
      }

      /* Event cards */
      .event-list {
        display: flex;
        flex-direction: column;
        gap: var(--space-3);
      }
      .event-card {
        display: flex;
        overflow: hidden;
        background: var(--color-bg-surface);
        border: 1px solid var(--color-border-subtle);
        border-radius: var(--radius-md);
      }
      .event-card--planned {
        border-color: rgba(76, 175, 128, 0.3);
      }
      .event-card--missed {
        border-color: rgba(232, 168, 56, 0.3);
      }
      .event-card--unplanned {
        border-color: rgba(224, 108, 117, 0.2);
      }

      .label-stripe {
        width: 3px;
        flex-shrink: 0;
      }
      .label-stripe--planned {
        background: #4caf80;
      }
      .label-stripe--missed {
        background: var(--color-state-diverged);
      }
      .label-stripe--unplanned {
        background: #e06c75;
      }

      .event-body {
        flex: 1;
        padding: var(--space-4);
        display: flex;
        flex-direction: column;
        gap: var(--space-3);
      }

      .event-top {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: var(--space-4);
      }
      .event-meta {
        display: flex;
        align-items: center;
        gap: var(--space-2);
        flex-wrap: wrap;
      }

      .dim-badge {
        display: inline-flex;
        align-items: center;
        height: 20px;
        padding: 0 var(--space-2);
        border-radius: var(--radius-sm);
        font-size: var(--text-xs);
        font-weight: var(--font-weight-semibold);
        text-transform: uppercase;
        letter-spacing: 0.05em;
      }
      .dim-badge--shape {
        background: rgba(79, 142, 247, 0.12);
        color: var(--color-accent);
      }
      .dim-badge--cadence {
        background: rgba(107, 90, 173, 0.15);
        color: #a78bfa;
      }
      .dim-badge--domain {
        background: rgba(76, 175, 128, 0.1);
        color: #4caf80;
      }

      .status-badge {
        display: inline-flex;
        align-items: center;
        height: 20px;
        padding: 0 var(--space-2);
        border-radius: var(--radius-sm);
        font-size: var(--text-xs);
        background: var(--color-bg-overlay);
        color: var(--color-text-muted);
        text-transform: capitalize;
      }
      .status-badge--confirmed {
        color: var(--color-state-diverged);
        background: rgba(232, 168, 56, 0.08);
      }
      .status-badge--resolved {
        color: var(--color-text-muted);
      }

      .device-tag {
        display: inline-flex;
        align-items: center;
        height: 20px;
        padding: 0 var(--space-2);
        background: rgba(79, 142, 247, 0.08);
        border-radius: var(--radius-sm);
        font-size: var(--text-xs);
        font-family: var(--font-mono);
        color: var(--color-text-secondary);
      }

      .event-label {
        display: flex;
        align-items: center;
        gap: var(--space-1);
        font-size: var(--text-xs);
        font-weight: var(--font-weight-medium);
        white-space: nowrap;
      }
      .event-label--planned {
        color: #4caf80;
      }
      .event-label--missed {
        color: var(--color-state-diverged);
      }
      .event-label--unplanned {
        color: #e06c75;
      }

      .event-source {
        font-family: var(--font-mono);
        font-size: var(--text-xs);
        color: var(--color-text-secondary);
        max-width: 500px;
      }

      .event-times {
        display: flex;
        align-items: center;
        gap: var(--space-2);
        flex-wrap: wrap;
      }
      .time-item {
        display: flex;
        gap: var(--space-1);
      }
      .time-label {
        font-size: var(--text-xs);
        color: var(--color-text-muted);
      }
      .time-value {
        font-size: var(--text-xs);
        font-family: var(--font-mono);
        color: var(--color-text-secondary);
      }
      .time-sep {
        color: var(--color-text-muted);
      }

      .evidence-summary {
        display: flex;
        gap: var(--space-2);
        align-items: center;
      }
      .evidence-kind {
        display: inline-flex;
        align-items: center;
        height: 18px;
        padding: 0 var(--space-2);
        background: var(--color-bg-overlay);
        border-radius: var(--radius-sm);
        font-size: var(--text-xs);
        color: var(--color-text-secondary);
        text-transform: lowercase;
      }
      .evidence-field {
        font-size: var(--text-xs);
        color: var(--color-text-muted);
      }
      .mono {
        font-family: var(--font-mono);
      }
      .truncate {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
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

      .btn-ghost {
        display: inline-flex;
        align-items: center;
        gap: var(--space-2);
        background: transparent;
        border: 1px solid var(--color-border-default);
        border-radius: var(--radius-md);
        color: var(--color-text-secondary);
        cursor: pointer;
        text-decoration: none;
        transition:
          color var(--transition-fast),
          border-color var(--transition-fast);
      }
      .btn-sm {
        height: 30px;
        padding: 0 var(--space-3);
        font-size: var(--text-sm);
      }
      .btn-ghost:hover {
        color: var(--color-text-primary);
        border-color: var(--color-border-strong);
      }
    `,
  ],
})
export class DivergenceLogPage {
  private readonly http = inject(HttpClient);
  private readonly router = inject(Router);

  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly events = signal<DivergenceRow[]>([]);
  readonly dimFilter = signal<DimFilter>('all');

  readonly dimTabs: { value: DimFilter; label: string }[] = [
    { value: 'all', label: 'All' },
    { value: 'shape', label: 'Shape' },
    { value: 'cadence', label: 'Cadence' },
    { value: 'domain', label: 'Domain' },
  ];

  readonly labelConfig = [
    {
      label: 'confirmed_planned_change' as DivergenceEventLabel,
      display: 'Confirmed Planned Change',
      cssClass: 'planned',
    },
    {
      label: 'missed_planned_change' as DivergenceEventLabel,
      display: 'Missed Planned Change',
      cssClass: 'missed',
    },
    {
      label: 'unplanned_divergence' as DivergenceEventLabel,
      display: 'Unplanned Divergence',
      cssClass: 'unplanned',
    },
  ];

  readonly filtered = computed(() => {
    const dim = this.dimFilter();
    return dim === 'all' ? this.events() : this.events().filter((e) => e.dimension === dim);
  });

  constructor() {
    afterNextRender(() => {
      this.load();
    });
  }

  load(): void {
    this.loading.set(true);
    this.error.set(null);

    this.http.get<ApiResponse>(`${environment.apiUrl}/api/divergence`).subscribe({
      next: (res) => {
        // The API doesn't return labels — derive them from context.
        // Labels are stored server-side in future; for now display as unplanned.
        // The expected-divergence matcher updates DB records; a future API v2
        // will return annotated events. For now we show raw events.
        const rows: DivergenceRow[] = (res.events ?? []).map((e) => ({
          ...e,
          label: 'unplanned_divergence' as DivergenceEventLabel,
        }));
        this.events.set(rows);
        this.loading.set(false);
      },
      error: () => {
        this.error.set('Failed to load divergence events. Is the API running?');
        this.loading.set(false);
        this.events.set([]);
      },
    });
  }

  countByDim(dim: DimFilter): number {
    if (dim === 'all') return this.events().length;
    return this.events().filter((e) => e.dimension === dim).length;
  }

  formatTime(iso: string | null): string {
    if (!iso) return '—';
    const d = new Date(iso);
    return d.toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  }

  getLabelClass(label: DivergenceEventLabel): string {
    switch (label) {
      case 'confirmed_planned_change':
        return 'planned';
      case 'missed_planned_change':
        return 'missed';
      default:
        return 'unplanned';
    }
  }

  getLabelDisplay(label: DivergenceEventLabel): string {
    return this.labelConfig.find((c) => c.label === label)?.display ?? label;
  }

  getLabelIcon(label: DivergenceEventLabel): import('@cav-align/ui').AppIconName {
    switch (label) {
      case 'confirmed_planned_change':
        return 'calendar-check';
      case 'missed_planned_change':
        return 'calendar-xmark';
      default:
        return 'bolt';
    }
  }
}
