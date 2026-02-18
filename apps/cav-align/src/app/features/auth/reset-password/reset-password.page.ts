import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { AuthService } from '../../../core/services/auth.service';
import { AppIconComponent } from '@cav-align/ui';

@Component({
  selector: 'app-reset-password-page',
  imports: [FormsModule, RouterLink, AppIconComponent],
  template: `
    <div class="auth-page">
      <div class="auth-card">
        <div class="auth-header">
          <span class="auth-wordmark">Align</span>
          <p class="auth-tagline">Reset your password.</p>
        </div>

        @if (sent()) {
          <div class="auth-confirmed" role="status">
            <app-icon name="circle-check" />
            <div>
              <p>If that email exists, a reset link is on its way.</p>
              <a routerLink="/auth/login">Back to sign in</a>
            </div>
          </div>
        } @else {
          <form class="auth-form" (ngSubmit)="onSubmit()">
            <div class="field">
              <label class="field-label" for="email">Email</label>
              <input
                id="email"
                class="field-input"
                type="email"
                [(ngModel)]="email"
                name="email"
                autocomplete="email"
                required
                placeholder="you@example.com"
              />
            </div>

            <button class="btn-primary" type="submit" [disabled]="loading()">
              @if (loading()) {
                <app-icon name="rotate" />
                <span>Sending…</span>
              } @else {
                <span>Send reset link</span>
              }
            </button>
          </form>

          <div class="auth-links">
            <a routerLink="/auth/login">Back to sign in</a>
          </div>
        }
      </div>
    </div>
  `,
  styles: [`
    .auth-page {
      display: flex; align-items: center; justify-content: center;
      min-height: 100vh; padding: var(--space-8); background: var(--color-bg-base);
    }
    .auth-card {
      width: 100%; max-width: 360px;
      background: var(--color-bg-surface);
      border: 1px solid var(--color-border-default);
      border-radius: var(--radius-lg); padding: var(--space-8);
    }
    .auth-header { margin-bottom: var(--space-8); text-align: center; }
    .auth-wordmark {
      display: block; font-size: var(--text-xl);
      font-weight: var(--font-weight-semibold);
      color: var(--color-text-primary); letter-spacing: -0.02em; margin-bottom: var(--space-2);
    }
    .auth-tagline { font-size: var(--text-sm); color: var(--color-text-muted); margin: 0; }
    .auth-form { display: flex; flex-direction: column; gap: var(--space-4); }
    .auth-confirmed {
      display: flex; align-items: flex-start;
      gap: var(--space-3); color: var(--color-accent); font-size: var(--text-sm);
    }
    .auth-confirmed p { margin: 0 0 var(--space-2); color: var(--color-text-primary); }
    .auth-confirmed a { color: var(--color-accent); text-decoration: none; }
    .field { display: flex; flex-direction: column; gap: var(--space-2); }
    .field-label { font-size: var(--text-sm); font-weight: var(--font-weight-medium); color: var(--color-text-secondary); }
    .field-input {
      height: 36px; padding: 0 var(--space-3);
      background: var(--color-bg-raised); border: 1px solid var(--color-border-default);
      border-radius: var(--radius-md); color: var(--color-text-primary);
      font-size: var(--text-base); font-family: var(--font-sans); outline: none;
      transition: border-color var(--transition-fast);
    }
    .field-input:focus { border-color: var(--color-accent); }
    .field-input::placeholder { color: var(--color-text-muted); }
    .btn-primary {
      display: flex; align-items: center; justify-content: center; gap: var(--space-2);
      height: 36px; padding: 0 var(--space-4); background: var(--color-accent);
      border: none; border-radius: var(--radius-md); color: var(--color-text-inverse);
      font-size: var(--text-base); font-weight: var(--font-weight-medium);
      cursor: pointer; transition: background var(--transition-fast); margin-top: var(--space-2);
    }
    .btn-primary:hover:not(:disabled) { background: var(--color-accent-hover); }
    .btn-primary:disabled { opacity: 0.5; cursor: not-allowed; }
    .auth-links {
      margin-top: var(--space-6); padding-top: var(--space-6);
      border-top: 1px solid var(--color-border-subtle); text-align: center;
    }
    .auth-links a { font-size: var(--text-sm); color: var(--color-accent); text-decoration: none; }
  `],
})
export class ResetPasswordPage {
  private readonly auth = inject(AuthService);
  email = '';
  readonly loading = signal(false);
  readonly sent = signal(false);

  async onSubmit(): Promise<void> {
    if (!this.email) return;
    this.loading.set(true);
    await this.auth.resetPassword(this.email);
    this.sent.set(true);
    this.loading.set(false);
  }
}
