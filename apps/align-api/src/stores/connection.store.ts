/**
 * connection.store.ts
 *
 * CAV Level 1 hardening — Store layer, Section 2 of Hardening Directive.
 *
 * Stateless persistence adapter for:
 *   - protocol_connections table
 *   - Broker credential encryption at rest
 *
 * Encryption contract:
 *   - encryptCredentials() called before every DB write
 *   - decryptCredentials() called only when returning credentials for
 *     active connection initiation — never for list/get responses
 *   - Decrypted values are NEVER logged
 *
 * Rules:
 *   - Requires tenantId explicitly on every method.
 *   - No business rule logic.
 *   - Only layer allowed to call Supabase for connection data.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { ProtocolType } from '@cav-align/core';
import {
  encryptCredentials,
  decryptCredentials,
  isEncryptionConfigured,
} from '../lib/crypto';
import { rootLogger } from '../lib/logger';

const log = rootLogger.child({ context: 'ConnectionStore' });

export interface ConnectionRow {
  id:         string;
  tenantId:   string;
  name:       string;
  protocol:   ProtocolType;
  config:     Record<string, unknown>;
  status:     string;
  createdAt:  string;
  updatedAt:  string;
}

export interface CreateConnectionInput {
  tenantId:    string;
  name:        string;
  protocol:    ProtocolType;
  config:      Record<string, unknown>;
  credentials: Record<string, unknown>;
  createdBy:   string;
}

export class ConnectionStore {
  constructor(private readonly supabase: SupabaseClient) {}

  async create(input: CreateConnectionInput): Promise<ConnectionRow | undefined> {
    if (!isEncryptionConfigured()) {
      log.error('Cannot save connection — CREDENTIAL_ENCRYPTION_KEY not configured');
      throw new Error('Credential encryption is not configured. Set CREDENTIAL_ENCRYPTION_KEY.');
    }

    // Encrypt before write — plaintext credentials never reach the DB
    const encryptedCredentials = encryptCredentials(input.credentials);

    try {
      const now = new Date().toISOString();
      const { data, error } = await this.supabase
        .from('protocol_connections')
        .insert({
          tenant_id:              input.tenantId,
          name:                   input.name,
          protocol:               input.protocol,
          config:                 input.config,
          encrypted_credentials:  encryptedCredentials,
          status:                 'disconnected',
          created_by:             input.createdBy,
          created_at:             now,
          updated_at:             now,
        })
        .select('id, tenant_id, name, protocol, config, status, created_at, updated_at')
        .single();

      if (error) {
        log.error('create connection failed', error, { tenantId: input.tenantId });
        return undefined;
      }

      return rowToConnection(data);
    } catch (err) {
      log.error('create connection exception', err, { tenantId: input.tenantId });
      return undefined;
    }
  }

  async list(tenantId: string): Promise<ConnectionRow[]> {
    try {
      const { data, error } = await this.supabase
        .from('protocol_connections')
        // Never select encrypted_credentials in list — not needed and reduces exposure
        .select('id, tenant_id, name, protocol, config, status, created_at, updated_at')
        .eq('tenant_id', tenantId)
        .order('created_at', { ascending: false });

      if (error) {
        log.error('list connections failed', error, { tenantId });
        return [];
      }

      return (data ?? []).map(rowToConnection);
    } catch (err) {
      log.error('list connections exception', err);
      return [];
    }
  }

  async get(tenantId: string, connectionId: string): Promise<ConnectionRow | undefined> {
    try {
      const { data, error } = await this.supabase
        .from('protocol_connections')
        .select('id, tenant_id, name, protocol, config, status, created_at, updated_at')
        .eq('id', connectionId)
        .eq('tenant_id', tenantId)
        .single();

      if (error || !data) return undefined;
      return rowToConnection(data);
    } catch (err) {
      log.error('get connection exception', err);
      return undefined;
    }
  }

  /**
   * Returns decrypted credentials for the given connection.
   * Only call this immediately before initiating a connection.
   * NEVER log the return value.
   */
  async getCredentials(
    tenantId: string,
    connectionId: string,
  ): Promise<Record<string, unknown> | undefined> {
    try {
      const { data, error } = await this.supabase
        .from('protocol_connections')
        .select('encrypted_credentials')
        .eq('id', connectionId)
        .eq('tenant_id', tenantId)
        .single();

      if (error || !data?.encrypted_credentials) {
        log.warn('getCredentials — no encrypted credentials found', { tenantId, connectionId });
        return undefined;
      }

      // Decrypt only here — result must never be logged
      return decryptCredentials(data.encrypted_credentials as string);
    } catch (err) {
      log.error('getCredentials exception', err, { tenantId, connectionId });
      return undefined;
    }
  }

  async updateStatus(input: {
    tenantId:     string;
    connectionId: string;
    status:       string;
  }): Promise<void> {
    try {
      const { error } = await this.supabase
        .from('protocol_connections')
        .update({ status: input.status, updated_at: new Date().toISOString() })
        .eq('id', input.connectionId)
        .eq('tenant_id', input.tenantId);

      if (error) {
        log.error('updateStatus failed', error, { tenantId: input.tenantId });
      }
    } catch (err) {
      log.error('updateStatus exception', err);
    }
  }

  async delete(tenantId: string, connectionId: string): Promise<boolean> {
    try {
      const { error } = await this.supabase
        .from('protocol_connections')
        .delete()
        .eq('id', connectionId)
        .eq('tenant_id', tenantId);

      if (error) {
        log.error('delete connection failed', error, { tenantId });
        return false;
      }
      return true;
    } catch (err) {
      log.error('delete connection exception', err);
      return false;
    }
  }
}

function rowToConnection(row: Record<string, unknown>): ConnectionRow {
  return {
    id:        row['id'] as string,
    tenantId:  row['tenant_id'] as string,
    name:      row['name'] as string,
    protocol:  row['protocol'] as ProtocolType,
    config:    (row['config'] as Record<string, unknown>) ?? {},
    status:    row['status'] as string,
    createdAt: row['created_at'] as string,
    updatedAt: row['updated_at'] as string,
  };
}
