/**
 * create-expected-divergence.page.ts
 *
 * Form to declare a planned change window (Expected Divergence).
 * CAV Level 1.1 feature.
 */

import { Component, inject, signal, computed } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, ActivatedRoute } from '@angular/router';
import { ExpectedDivergenceService } from '../../core/services/expected-divergence.service';
import { AppIconComponent } from '@cav-align/ui';
import type { DivergenceDimension } from '@cav-align/core';

@Component({
  selector: 'app-create-expected-divergence-page',
  imports: [FormsModule, AppIconComponent],
  template: `
    <div class="page">
      <header class="page-header">
        <button class="btn-ghost back-btn" (click)="goBack()">
          <app-icon name="chevron-right" style="transform: rotate(180deg)" />
        </button>
        <h1 class="page-title">Declare Planned Change</h1>
      </header>

      <div class="page-body">
        <div class="form-card">

          @if (submitError()) {
            <div class="alert alert-error" role="alert">
              <app-icon name="triangle-exclamation" />
              <span>{{ submitError() }}</span>
            </div>
          }

          @if (submitted()) {
            <div class="alert alert-success" role="alert">
              <app-icon name="circle-check" />
              <span>Expectation created. Navigating to list…</span>
            </div>
          }

          <!-- Topic -->
          <div class="field">
            <label class="field-label" for="topic">
              Source / Topic <span class="required">*</span>
            </label>
            <input
              id="topic"
              class="field-input"
              type="text"
              [(ngModel)]="topic"
              name="topic"
              placeholder="e.g. vda5050/KUKA/V01/state"
              [class.field-input--error]="showErrors() && !topic.trim()"
            />
            @if (showErrors() && !topic.trim()) {
              <span class="field-error">Topic is required.</span>
            }
          </div>

          <!-- Identity Scope -->
          <div class="field">
            <label class="field-label" for="identityScope">
              Identity Scope
              <span class="field-hint">(leave blank to match all devices)</span>
            </label>
            <input
              id="identityScope"
              class="field-input"
              type="text"
              [(ngModel)]="identityScope"
              name="identityScope"
              placeholder="e.g. AGV-123 (optional)"
            />
          </div>

          <!-- Dimensions -->
          <fieldset class="field fieldset">
            <legend class="field-label">
              Expected Dimensions <span class="required">*</span>
            </legend>
            <div class="checkbox-group">
              @for (dim of availableDimensions; track dim.value) {
                <label class="checkbox-item">
                  <input
                    type="checkbox"
                    [checked]="selectedDimensions().includes(dim.value)"
                    (change)="toggleDimension(dim.value)"
                  />
                  <span class="checkbox-label">{{ dim.label }}</span>
                  <span class="checkbox-hint">{{ dim.hint }}</span>
                </label>
              }
            </div>
            @if (showErrors() && selectedDimensions().length === 0) {
              <span class="field-error">Select at least one dimension.</span>
            }
          </fieldset>

          <!-- Time Window -->
          <div class="field-row">
            <div class="field">
              <label class="field-label" for="windowStart">
                Window Start <span class="required">*</span>
              </label>
              <input
                id="windowStart"
                class="field-input"
                type="datetime-local"
                [(ngModel)]="windowStart"
                name="windowStart"
                [class.field-input--error]="showErrors() && !windowStart"
              />
              @if (showErrors() && !windowStart) {
                <span class="field-error">Required.</span>
              }
            </div>
            <div class="field">
              <label class="field-label" for="windowEnd">
                Window End <span class="required">*</span>
              </label>
              <input
                id="windowEnd"
                class="field-input"
                type="datetime-local"
                [(ngModel)]="windowEnd"
                name="windowEnd"
                [class.field-input--error]="showErrors() && windowEndError()"
              />
              @if (showErrors() && windowEndError()) {
                <span class="field-error">{{ windowEndError() }}</span>
              }
            </div>
          </div>

          <!-- Grace Period -->
          <div class="field field--sm">
            <label class="field-label" for="graceMinutes">
              Grace Period (minutes)
            </label>
            <input
              id="graceMinutes"
              class="field-input"
              type="number"
              [(ngModel)]="graceMinutes"
              name="graceMinutes"
              min="0"
              max="60"
              placeholder="5"
            />
            <span class="field-hint-block">
              Extends the window by this many minutes on each side for matching.
            </span>
          </div>

          <!-- Actions -->
          <div class="form-actions">
            <button class="btn-ghost" (click)="goBack()" [disabled]="loading()">
              Cancel
            </button>
            <button class="btn-primary" (click)="submit()" [disabled]="loading() || submitted()">
              @if (loading()) {
                <app-icon name="rotate" />
                <span>Creating…</span>
              } @else {
                <app-icon name="calendar-plus" />
                <span>Create Expectation</span>
              }
            </button>
          </div>
        </div>
      </div>
    </div>
  `,
  styles: [`
    .page { display: flex; flex-direction: column; height: 100%; }
    .page-header {
      display: flex; align-items: center; gap: var(--space-3);
      height: var(--topbar-height); padding: 0 var(--space-6);
      border-bottom: 1px solid var(--color-border-subtle); flex-shrink: 0;
    }
    .back-btn {
      display: flex; align-items: center; justify-content: center;
      width: 28px; height: 28px; padding: 0;
      background: transparent; border: none; border-radius: var(--radius-sm);
      color: var(--color-text-muted); cursor: pointer;
    }
    .back-btn:hover { color: var(--color-text-primary); background: var(--color-bg-raised); }
    .page-title {
      margin: 0; font-size: var(--text-md);
      font-weight: var(--font-weight-semibold); color: var(--color-text-primary);
    }
    .page-body { flex: 1; padding: var(--space-6); overflow: auto; }

    .form-card {
      max-width: 560px;
      display: flex; flex-direction: column; gap: var(--space-6);
    }

    .alert {
      display: flex; align-items: center; gap: var(--space-2);
      padding: var(--space-3); border-radius: var(--radius-md);
      font-size: var(--text-sm); border: 1px solid;
    }
    .alert-error {
      color: #e8a838;
      background: rgba(232,168,56,0.08);
      border-color: rgba(232,168,56,0.3);
    }
    .alert-success {
      color: #4caf80;
      background: rgba(76,175,128,0.08);
      border-color: rgba(76,175,128,0.3);
    }

    .field { display: flex; flex-direction: column; gap: var(--space-2); }
    .field--sm { max-width: 200px; }
    .field-row { display: flex; gap: var(--space-4); }
    .field-row .field { flex: 1; }
    .fieldset { border: none; margin: 0; padding: 0; }

    .field-label {
      font-size: var(--text-sm); font-weight: var(--font-weight-medium);
      color: var(--color-text-secondary); display: flex; align-items: center; gap: var(--space-2);
    }
    .required { color: var(--color-state-diverged); }
    .field-hint { font-size: var(--text-xs); color: var(--color-text-muted); font-weight: var(--font-weight-normal); }
    .field-hint-block { font-size: var(--text-xs); color: var(--color-text-muted); }
    .field-error { font-size: var(--text-xs); color: var(--color-state-diverged); }

    .field-input {
      height: 36px; padding: 0 var(--space-3);
      background: var(--color-bg-raised); border: 1px solid var(--color-border-default);
      border-radius: var(--radius-md); color: var(--color-text-primary);
      font-size: var(--text-base); font-family: var(--font-sans);
      outline: none; transition: border-color var(--transition-fast);
      color-scheme: dark;
    }
    .field-input:focus { border-color: var(--color-accent); }
    .field-input::placeholder { color: var(--color-text-muted); }
    .field-input--error { border-color: var(--color-state-diverged); }

    .checkbox-group { display: flex; flex-direction: column; gap: var(--space-3); padding-top: var(--space-2); }
    .checkbox-item {
      display: flex; align-items: flex-start; gap: var(--space-3);
      cursor: pointer;
    }
    .checkbox-item input[type="checkbox"] { margin-top: 2px; accent-color: var(--color-accent); }
    .checkbox-label { font-size: var(--text-sm); color: var(--color-text-primary); font-weight: var(--font-weight-medium); }
    .checkbox-hint { font-size: var(--text-xs); color: var(--color-text-muted); margin-left: auto; }

    .form-actions {
      display: flex; gap: var(--space-3); justify-content: flex-end;
      padding-top: var(--space-2); border-top: 1px solid var(--color-border-subtle);
    }

    .btn-primary {
      display: flex; align-items: center; gap: var(--space-2);
      height: 34px; padding: 0 var(--space-4);
      background: var(--color-accent); border: none;
      border-radius: var(--radius-md); color: var(--color-text-inverse);
      font-size: var(--text-sm); font-weight: var(--font-weight-medium);
      cursor: pointer; transition: background var(--transition-fast);
    }
    .btn-primary:hover:not(:disabled) { background: var(--color-accent-hover); }
    .btn-primary:disabled { opacity: 0.5; cursor: not-allowed; }

    .btn-ghost {
      display: flex; align-items: center; gap: var(--space-2);
      height: 34px; padding: 0 var(--space-3);
      background: transparent; border: 1px solid var(--color-border-default);
      border-radius: var(--radius-md); color: var(--color-text-secondary);
      font-size: var(--text-sm); cursor: pointer;
      transition: color var(--transition-fast), border-color var(--transition-fast);
    }
    .btn-ghost:hover:not(:disabled) { color: var(--color-text-primary); border-color: var(--color-border-strong); }
    .btn-ghost:disabled { opacity: 0.5; cursor: not-allowed; }
  `],
})
export class CreateExpectedDivergencePage {
  private readonly svc    = inject(ExpectedDivergenceService);
  private readonly router = inject(Router);
  private readonly route  = inject(ActivatedRoute);

  // Form fields
  topic            = '';
  identityScope    = '';
  windowStart      = '';
  windowEnd        = '';
  graceMinutes: number | string = 5;

  readonly availableDimensions: { value: DivergenceDimension; label: string; hint: string }[] = [
    { value: 'shape',   label: 'Shape',   hint: 'Structural / field changes' },
    { value: 'cadence', label: 'Cadence', hint: 'Timing pattern changes' },
    { value: 'domain',  label: 'Domain',  hint: 'Value range changes' },
  ];

  readonly selectedDimensions = signal<DivergenceDimension[]>([]);
  readonly loading    = signal(false);
  readonly showErrors = signal(false);
  readonly submitError = signal<string | null>(null);
  readonly submitted  = signal(false);

  readonly windowEndError = computed<string | null>(() => {
    if (!this.windowEnd) return 'Required.';
    if (this.windowStart && new Date(this.windowEnd) <= new Date(this.windowStart)) {
      return 'Must be after window start.';
    }
    return null;
  });

  constructor() {
    // Pre-fill topic from query params (when navigating from source detail)
    this.route.queryParams.subscribe((params) => {
      if (params['topic']) this.topic = params['topic'];
    });
  }

  toggleDimension(dim: DivergenceDimension): void {
    this.selectedDimensions.update((dims) =>
      dims.includes(dim) ? dims.filter((d) => d !== dim) : [...dims, dim],
    );
  }

  async submit(): Promise<void> {
    this.showErrors.set(true);
    this.submitError.set(null);

    if (!this.topic.trim() || this.selectedDimensions().length === 0 ||
        !this.windowStart || this.windowEndError()) {
      return;
    }

    this.loading.set(true);

    const grace = typeof this.graceMinutes === 'string'
      ? parseInt(this.graceMinutes, 10) || 5
      : this.graceMinutes;

    this.svc.create({
      topic: this.topic.trim(),
      identityScope: this.identityScope.trim() || null,
      expectedDimensions: this.selectedDimensions(),
      windowStart: new Date(this.windowStart).toISOString(),
      windowEnd: new Date(this.windowEnd).toISOString(),
      graceMinutes: grace,
    }).subscribe({
      next: () => {
        this.loading.set(false);
        this.submitted.set(true);
        setTimeout(() => this.router.navigate(['/app/expected-divergences']), 1200);
      },
      error: (err) => {
        this.loading.set(false);
        this.submitError.set(err?.error?.error ?? 'Failed to create expectation. Check your connection.');
      },
    });
  }

  goBack(): void {
    this.router.navigate(['/app/expected-divergences']);
  }
}
