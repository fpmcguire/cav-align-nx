/**
 * api.service.ts
 *
 * Typed HTTP service for the Align API.
 *
 * Auth headers are injected automatically by authInterceptor — this service
 * does not touch tokens or Authorization headers directly.
 *
 * Error handling: all methods catch HTTP errors and re-throw as a plain
 * ApiCallError so callers get a predictable, typed failure shape without
 * unhandled Observable/Promise rejections leaking through.
 *
 * Grouping: three sub-namespaces mirror the API surface:
 *   api.intent   — Intent Artifacts + Versions
 *   api.deltas   — Alignment Deltas time-series
 *   api.breaches — Envelope Breaches + Convergence Actions
 *
 * Public / health endpoints are flat methods on the service itself.
 *
 * Usage:
 *   private readonly api = inject(ApiService);
 *
 *   // Observable
 *   this.api.intent.list({ dimension: 'shape' }).subscribe(artifacts => …);
 *
 *   // Signal (wraps toSignal — safe inside injection context)
 *   readonly artifacts = this.api.intent.listSignal({ dimension: 'shape' });
 */

import { Injectable, inject, Signal } from '@angular/core';
import { HttpClient, HttpParams, HttpErrorResponse } from '@angular/common/http';
import { Observable, throwError } from 'rxjs';
import { catchError, map } from 'rxjs/operators';
import { toSignal } from '@angular/core/rxjs-interop';
import { environment } from '../../../environments/environment';
import type {
  IntentArtifact,
  IntentArtifactSummary,
  IntentVersion,
  IntentVersionSummary,
  CreateIntentArtifactRequest,
  CreateIntentVersionRequest,
  AlignmentDelta,
  AlignmentDeltaSummary,
  EnvelopeBreach,
  EnvelopeBreachSummary,
  ConvergenceAction,
  CreateConvergenceActionRequest,
} from '@cav-align/core';

// ---------------------------------------------------------------------------
// Error type
// ---------------------------------------------------------------------------

export class ApiCallError extends Error {
  constructor(
    public readonly status: number,
    public readonly statusText: string,
    message: string,
  ) {
    super(message);
    this.name = 'ApiCallError';
  }
}

// ---------------------------------------------------------------------------
// Query parameter shapes
// ---------------------------------------------------------------------------

export interface IntentListParams {
  dimension?: string;
  status?: string;
  topicScope?: string;
}

export interface DeltaListParams {
  topicScope?: string;
  dimension?: string;
  from?: string; // ISO date string
  until?: string; // ISO date string
}

export interface BreachListParams {
  status?: string;
  dimension?: string;
  topicScope?: string;
}

// ---------------------------------------------------------------------------
// Public API response shapes (used for the /api and /health endpoints)
// ---------------------------------------------------------------------------

export interface ServiceInfoResponse {
  service: string;
  version: string;
  registeredProtocols: string[];
  activeConnections: number;
}

export interface HealthResponse {
  supabase: { configured: boolean };
  encryption: { configured: boolean };
  version: string;
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

@Injectable({ providedIn: 'root' })
export class ApiService {
  private readonly http = inject(HttpClient);
  private readonly base = environment.apiUrl;

  // Convenience: build a full URL from a path fragment
  private url(path: string): string {
    // Normalise — avoid double slashes
    return `${this.base}${path.startsWith('/') ? path : `/${path}`}`;
  }

  // Shared error handler — converts HttpErrorResponse into ApiCallError
  private handleError(err: unknown): Observable<never> {
    if (err instanceof HttpErrorResponse) {
      const message: string =
        (err.error as { error?: string } | null)?.error ??
        err.statusText ??
        'Unknown API error';
      return throwError(() => new ApiCallError(err.status, err.statusText, message));
    }
    return throwError(() => err);
  }

  // Build HttpParams from a plain object, omitting undefined/null values
  private params(obj: Record<string, string | undefined>): HttpParams {
    return Object.entries(obj)
      .filter((entry): entry is [string, string] => entry[1] != null)
      .reduce((p, [k, v]) => p.set(k, v), new HttpParams());
  }

  // ---------------------------------------------------------------------------
  // Public endpoints — no auth required
  // ---------------------------------------------------------------------------

  /** GET /api — service info */
  serviceInfo(): Observable<ServiceInfoResponse> {
    return this.http
      .get<ServiceInfoResponse>(this.url('/api'))
      .pipe(catchError(this.handleError));
  }

  /** GET /health — health check */
  health(): Observable<HealthResponse> {
    return this.http
      .get<HealthResponse>(this.url('/health'))
      .pipe(catchError(this.handleError));
  }

  // ---------------------------------------------------------------------------
  // intent — Intent Artifacts + Versions
  // ---------------------------------------------------------------------------

  readonly intent = {
    /**
     * POST /api/intent — create a new intent artifact.
     */
    create: (body: CreateIntentArtifactRequest): Observable<IntentArtifact> =>
      this.http
        .post<IntentArtifact>(this.url('/api/intent'), body)
        .pipe(catchError(this.handleError)),

    /**
     * GET /api/intent — list intent artifacts.
     */
    list: (query: IntentListParams = {}): Observable<IntentArtifactSummary[]> =>
      this.http
        .get<IntentArtifactSummary[]>(this.url('/api/intent'), {
          params: this.params({
            dimension: query.dimension,
            status: query.status,
            topicScope: query.topicScope,
          }),
        })
        .pipe(catchError(this.handleError)),

    /**
     * Convenience: same as list() but returns a Signal.
     * Must be called within an injection context.
     */
    listSignal: (
      query: IntentListParams = {},
      initialValue: IntentArtifactSummary[] = [],
    ): Signal<IntentArtifactSummary[]> =>
      toSignal(
        this.http
          .get<IntentArtifactSummary[]>(this.url('/api/intent'), {
            params: this.params({
              dimension: query.dimension,
              status: query.status,
              topicScope: query.topicScope,
            }),
          })
          .pipe(catchError(this.handleError)),
        { initialValue },
      ),

    /**
     * GET /api/intent/:id — get a single artifact.
     */
    get: (id: string): Observable<IntentArtifact> =>
      this.http
        .get<IntentArtifact>(this.url(`/api/intent/${id}`))
        .pipe(catchError(this.handleError)),

    /**
     * PATCH /api/intent/:id/archive — archive an artifact.
     */
    archive: (id: string): Observable<IntentArtifact> =>
      this.http
        .patch<IntentArtifact>(this.url(`/api/intent/${id}/archive`), {})
        .pipe(catchError(this.handleError)),

    versions: {
      /**
       * POST /api/intent/:id/versions — create a draft version.
       */
      create: (
        artifactId: string,
        body: CreateIntentVersionRequest,
      ): Observable<IntentVersion> =>
        this.http
          .post<IntentVersion>(this.url(`/api/intent/${artifactId}/versions`), body)
          .pipe(catchError(this.handleError)),

      /**
       * GET /api/intent/:id/versions — list all versions for an artifact.
       */
      list: (artifactId: string): Observable<IntentVersionSummary[]> =>
        this.http
          .get<IntentVersionSummary[]>(this.url(`/api/intent/${artifactId}/versions`))
          .pipe(catchError(this.handleError)),

      /**
       * GET /api/intent/:id/versions/:vid — get a single version.
       */
      get: (artifactId: string, versionId: string): Observable<IntentVersion> =>
        this.http
          .get<IntentVersion>(this.url(`/api/intent/${artifactId}/versions/${versionId}`))
          .pipe(catchError(this.handleError)),

      /**
       * PATCH /api/intent/:id/versions/:vid/activate — activate a version.
       */
      activate: (
        artifactId: string,
        versionId: string,
      ): Observable<IntentVersion> =>
        this.http
          .patch<IntentVersion>(
            this.url(`/api/intent/${artifactId}/versions/${versionId}/activate`),
            {},
          )
          .pipe(catchError(this.handleError)),
    },
  } as const;

  // ---------------------------------------------------------------------------
  // deltas — Alignment Deltas time-series
  // ---------------------------------------------------------------------------

  readonly deltas = {
    /**
     * GET /api/deltas — query delta time-series.
     */
    list: (query: DeltaListParams = {}): Observable<AlignmentDeltaSummary[]> =>
      this.http
        .get<AlignmentDeltaSummary[]>(this.url('/api/deltas'), {
          params: this.params({
            topicScope: query.topicScope,
            dimension: query.dimension,
            from: query.from,
            until: query.until,
          }),
        })
        .pipe(catchError(this.handleError)),

    /**
     * Convenience: same as list() but returns a Signal.
     * Must be called within an injection context.
     */
    listSignal: (
      query: DeltaListParams = {},
      initialValue: AlignmentDeltaSummary[] = [],
    ): Signal<AlignmentDeltaSummary[]> =>
      toSignal(
        this.http
          .get<AlignmentDeltaSummary[]>(this.url('/api/deltas'), {
            params: this.params({
              topicScope: query.topicScope,
              dimension: query.dimension,
              from: query.from,
              until: query.until,
            }),
          })
          .pipe(catchError(this.handleError)),
        { initialValue },
      ),

    /**
     * GET /api/deltas/:id — get delta detail.
     */
    get: (id: string): Observable<AlignmentDelta> =>
      this.http
        .get<AlignmentDelta>(this.url(`/api/deltas/${id}`))
        .pipe(catchError(this.handleError)),
  } as const;

  // ---------------------------------------------------------------------------
  // breaches — Envelope Breaches + Convergence Actions
  // ---------------------------------------------------------------------------

  readonly breaches = {
    /**
     * GET /api/breaches — list breach events.
     */
    list: (query: BreachListParams = {}): Observable<EnvelopeBreachSummary[]> =>
      this.http
        .get<EnvelopeBreachSummary[]>(this.url('/api/breaches'), {
          params: this.params({
            status: query.status,
            dimension: query.dimension,
            topicScope: query.topicScope,
          }),
        })
        .pipe(catchError(this.handleError)),

    /**
     * Convenience: same as list() but returns a Signal.
     * Must be called within an injection context.
     */
    listSignal: (
      query: BreachListParams = {},
      initialValue: EnvelopeBreachSummary[] = [],
    ): Signal<EnvelopeBreachSummary[]> =>
      toSignal(
        this.http
          .get<EnvelopeBreachSummary[]>(this.url('/api/breaches'), {
            params: this.params({
              status: query.status,
              dimension: query.dimension,
              topicScope: query.topicScope,
            }),
          })
          .pipe(catchError(this.handleError)),
        { initialValue },
      ),

    /**
     * GET /api/breaches/:id — get breach detail.
     */
    get: (id: string): Observable<EnvelopeBreach> =>
      this.http
        .get<EnvelopeBreach>(this.url(`/api/breaches/${id}`))
        .pipe(catchError(this.handleError)),

    actions: {
      /**
       * POST /api/breaches/:id/actions — log a convergence action.
       */
      create: (
        breachId: string,
        body: CreateConvergenceActionRequest,
      ): Observable<ConvergenceAction> =>
        this.http
          .post<ConvergenceAction>(
            this.url(`/api/breaches/${breachId}/actions`),
            body,
          )
          .pipe(catchError(this.handleError)),

      /**
       * GET /api/breaches/:id/actions — list all actions for a breach.
       */
      list: (breachId: string): Observable<ConvergenceAction[]> =>
        this.http
          .get<ConvergenceAction[]>(this.url(`/api/breaches/${breachId}/actions`))
          .pipe(catchError(this.handleError)),
    },
  } as const;
}
