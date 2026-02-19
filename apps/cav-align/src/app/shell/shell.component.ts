/**
 * shell.component.ts
 *
 * The top-level layout for authenticated users.
 * Renders the sidebar navigation and the main content area.
 * All feature pages are loaded as children of this component.
 */
import { Component, inject, signal } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { AuthService } from '../core/services/auth.service';
import { AppIconComponent } from '@cav-align/ui';

@Component({
  selector: 'app-shell',
  imports: [RouterOutlet, RouterLink, RouterLinkActive, AppIconComponent],
  template: `
    <div class="shell">
      <nav class="sidebar" [class.collapsed]="sidebarCollapsed()">
        <div class="sidebar-header">
          <span class="wordmark" aria-label="Align by Cavilieri">
            @if (!sidebarCollapsed()) {
              <span class="wordmark-align">Align</span>
              <span class="wordmark-by">by Cavilieri</span>
            } @else {
              <span class="wordmark-glyph">A</span>
            }
          </span>
          <button class="collapse-btn" (click)="toggleSidebar()" [attr.aria-label]="sidebarCollapsed() ? 'Expand sidebar' : 'Collapse sidebar'">
            <app-icon [name]="sidebarCollapsed() ? 'chevron-right' : 'bars'" />
          </button>
        </div>

        <ul class="nav-list" role="list">
          <li>
            <a routerLink="/app/sessions" routerLinkActive="active" class="nav-item">
              <app-icon name="layer-group" />
              @if (!sidebarCollapsed()) { <span>Sessions</span> }
            </a>
          </li>
          <li>
            <a routerLink="/app/topics" routerLinkActive="active" class="nav-item">
              <app-icon name="wave-square" />
              @if (!sidebarCollapsed()) { <span>Topics</span> }
            </a>
          </li>
          <li>
            <a routerLink="/app/divergence" routerLinkActive="active" class="nav-item">
              <app-icon name="bolt" />
              @if (!sidebarCollapsed()) { <span>Divergence</span> }
            </a>
          </li>
          <li>
            <a routerLink="/app/expected-divergences" routerLinkActive="active" class="nav-item">
              <app-icon name="calendar-days" />
              @if (!sidebarCollapsed()) { <span>Expected</span> }
            </a>
          </li>
          <li>
            <a routerLink="/app/connections" routerLinkActive="active" class="nav-item">
              <app-icon name="server" />
              @if (!sidebarCollapsed()) { <span>Connections</span> }
            </a>
          </li>
        </ul>

        <div class="sidebar-footer">
          <button class="nav-item sign-out-btn" (click)="signOut()" title="Sign out">
            <app-icon name="arrow-right-from-bracket" />
            @if (!sidebarCollapsed()) { <span>Sign out</span> }
          </button>
        </div>
      </nav>

      <main class="main-content">
        <router-outlet />
      </main>
    </div>
  `,
  styles: [`
    .shell {
      display: flex;
      height: 100vh;
      overflow: hidden;
      background: var(--color-bg-base);
    }

    /* Sidebar */
    .sidebar {
      display: flex;
      flex-direction: column;
      width: var(--sidebar-width);
      min-width: var(--sidebar-width);
      background: var(--color-bg-surface);
      border-right: 1px solid var(--color-border-subtle);
      transition: width var(--transition-base), min-width var(--transition-base);
      overflow: hidden;
    }

    .sidebar.collapsed {
      width: 52px;
      min-width: 52px;
    }

    .sidebar-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      height: var(--topbar-height);
      padding: 0 var(--space-3);
      border-bottom: 1px solid var(--color-border-subtle);
      flex-shrink: 0;
    }

    .wordmark {
      display: flex;
      align-items: baseline;
      gap: var(--space-2);
      overflow: hidden;
      white-space: nowrap;
    }

    .wordmark-align {
      font-size: var(--text-md);
      font-weight: var(--font-weight-semibold);
      color: var(--color-text-primary);
      letter-spacing: -0.02em;
    }

    .wordmark-by {
      font-size: var(--text-xs);
      color: var(--color-text-muted);
      letter-spacing: 0.02em;
    }

    .wordmark-glyph {
      font-size: var(--text-md);
      font-weight: var(--font-weight-semibold);
      color: var(--color-accent);
    }

    .collapse-btn {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 28px;
      height: 28px;
      padding: 0;
      background: transparent;
      border: none;
      border-radius: var(--radius-sm);
      color: var(--color-text-muted);
      cursor: pointer;
      flex-shrink: 0;
      transition: color var(--transition-fast), background var(--transition-fast);
    }

    .collapse-btn:hover {
      color: var(--color-text-primary);
      background: var(--color-bg-raised);
    }

    /* Navigation */
    .nav-list {
      flex: 1;
      margin: 0;
      padding: var(--space-3) 0;
      list-style: none;
      overflow-y: auto;
    }

    .nav-item {
      display: flex;
      align-items: center;
      gap: var(--space-3);
      height: 36px;
      padding: 0 var(--space-3);
      margin: 1px var(--space-2);
      border-radius: var(--radius-md);
      color: var(--color-text-secondary);
      font-size: var(--text-sm);
      font-weight: var(--font-weight-medium);
      text-decoration: none;
      white-space: nowrap;
      cursor: pointer;
      background: transparent;
      border: none;
      width: calc(100% - var(--space-4));
      transition: color var(--transition-fast), background var(--transition-fast);
    }

    .nav-item:hover {
      color: var(--color-text-primary);
      background: var(--color-bg-raised);
    }

    .nav-item.active {
      color: var(--color-accent);
      background: var(--color-accent-subtle);
    }

    /* Footer */
    .sidebar-footer {
      padding: var(--space-3) 0;
      border-top: 1px solid var(--color-border-subtle);
      flex-shrink: 0;
    }

    .sign-out-btn {
      color: var(--color-text-muted);
    }

    .sign-out-btn:hover {
      color: var(--color-text-primary);
    }

    /* Main content */
    .main-content {
      flex: 1;
      overflow: auto;
      display: flex;
      flex-direction: column;
    }
  `],
})
export class ShellComponent {
  private readonly auth = inject(AuthService);
  readonly sidebarCollapsed = signal(false);

  toggleSidebar(): void {
    this.sidebarCollapsed.update((v) => !v);
  }

  async signOut(): Promise<void> {
    await this.auth.signOut();
  }
}
