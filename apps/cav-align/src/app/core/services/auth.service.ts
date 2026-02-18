/**
 * auth.service.ts
 *
 * Signal-based authentication service backed by Supabase Auth.
 * This is the single source of truth for session state in the app.
 *
 * Supabase client is injected via a token (see supabase.token.ts) so
 * the service remains testable and the client config is centralised.
 *
 * Phase 1 — email/password auth only.
 * Password reset flow is stubbed; the route exists to prevent 404s
 * from Supabase reset emails.
 */
import { Injectable, signal, computed, inject } from '@angular/core';
import { Router } from '@angular/router';
import { createClient, SupabaseClient, Session, User } from '@supabase/supabase-js';
import { environment } from '../../../environments/environment';

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly router = inject(Router);

  // Lazily initialised Supabase client — one instance for the app lifetime.
  private readonly supabase: SupabaseClient = createClient(
    environment.supabaseUrl,
    environment.supabaseAnonKey
  );

  // ---------------------------------------------------------------------------
  // State signals
  // ---------------------------------------------------------------------------

  private readonly _session = signal<Session | null>(null);
  private readonly _loading = signal(true);

  /** The current Supabase session. Null when unauthenticated. */
  readonly session = this._session.asReadonly();

  /** The authenticated user. Null when unauthenticated. */
  readonly user = computed<User | null>(() => this._session()?.user ?? null);

  /** True while the initial session restoration is in progress. */
  readonly loading = this._loading.asReadonly();

  /** True when the user is authenticated. */
  readonly isAuthenticated = computed(() => this._session() !== null);

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  /**
   * Must be called once at app startup (in app.config.ts providers).
   * Restores the existing session from storage and subscribes to auth events.
   */
  async init(): Promise<void> {
    const { data } = await this.supabase.auth.getSession();
    this._session.set(data.session);
    this._loading.set(false);

    this.supabase.auth.onAuthStateChange((_event, session) => {
      this._session.set(session);
    });
  }

  // ---------------------------------------------------------------------------
  // Auth operations
  // ---------------------------------------------------------------------------

  async signIn(email: string, password: string): Promise<{ error: string | null }> {
    const { error } = await this.supabase.auth.signInWithPassword({ email, password });
    if (error) return { error: error.message };
    await this.router.navigateByUrl('/app');
    return { error: null };
  }

  async signUp(email: string, password: string): Promise<{ error: string | null }> {
    const { error } = await this.supabase.auth.signUp({ email, password });
    if (error) return { error: error.message };
    return { error: null };
  }

  async signOut(): Promise<void> {
    await this.supabase.auth.signOut();
    await this.router.navigateByUrl('/auth/login');
  }

  async resetPassword(email: string): Promise<{ error: string | null }> {
    const { error } = await this.supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/auth/reset-password`,
    });
    if (error) return { error: error.message };
    return { error: null };
  }

  /**
   * Returns the current JWT for attaching to API requests.
   * Returns null if unauthenticated.
   */
  getAccessToken(): string | null {
    return this._session()?.access_token ?? null;
  }
}
