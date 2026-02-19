/**
 * expected-divergence.service.ts
 *
 * Angular service for Expected Divergence CRUD operations.
 * Communicates with align-api /api/expected-divergences endpoints.
 */

import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import type {
  ExpectedDivergence,
  ExpectedDivergenceSummary,
  CreateExpectedDivergenceRequest,
} from '@cav-align/core';
import { environment } from '../../../environments/environment';

@Injectable({ providedIn: 'root' })
export class ExpectedDivergenceService {
  private readonly http = inject(HttpClient);
  private readonly base = `${environment.apiUrl}/api/expected-divergences`;

  create(req: CreateExpectedDivergenceRequest): Observable<ExpectedDivergence> {
    return this.http.post<ExpectedDivergence>(this.base, req);
  }

  list(filters?: { status?: string; topic?: string }): Observable<ExpectedDivergenceSummary[]> {
    const params: Record<string, string> = {};
    if (filters?.status) params['status'] = filters.status;
    if (filters?.topic)  params['topic']  = filters.topic;
    return this.http.get<ExpectedDivergenceSummary[]>(this.base, { params });
  }

  get(id: string): Observable<ExpectedDivergence> {
    return this.http.get<ExpectedDivergence>(`${this.base}/${id}`);
  }

  cancel(id: string): Observable<ExpectedDivergence> {
    return this.http.patch<ExpectedDivergence>(`${this.base}/${id}/cancel`, {});
  }
}
