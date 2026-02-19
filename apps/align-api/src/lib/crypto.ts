/**
 * crypto.ts
 *
 * AES-256-GCM credential encryption for broker credentials at rest.
 *
 * CAV Level 1 hardening — Secrets Management, Section 3 of Security Checklist.
 *
 * Design:
 *   - Master key loaded from CREDENTIAL_ENCRYPTION_KEY env var (64-char hex = 32 bytes)
 *   - Random 12-byte IV generated per encryption
 *   - Encrypted payload: base64(JSON({ iv, tag, ciphertext }))
 *   - Decrypted value NEVER logged — enforced by keeping decrypt internal to store layer
 *
 * Does NOT touch cav-core. Does NOT depend on Supabase.
 *
 * Required env var:
 *   CREDENTIAL_ENCRYPTION_KEY — 64 hex characters (32 bytes)
 *   Generate with: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
 */

import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
} from 'crypto';
import { rootLogger } from './logger';

const log = rootLogger.child({ context: 'crypto' });

const ALGORITHM  = 'aes-256-gcm';
const IV_BYTES   = 12;
const TAG_BYTES  = 16;

// ---------------------------------------------------------------------------
// Master key loading
// ---------------------------------------------------------------------------

let _masterKey: Buffer | null = null;

function getMasterKey(): Buffer {
  if (_masterKey) return _masterKey;

  const hex = process.env['CREDENTIAL_ENCRYPTION_KEY'];
  if (!hex || hex.length !== 64) {
    throw new Error(
      'CREDENTIAL_ENCRYPTION_KEY must be set to a 64-character hex string (32 bytes). ' +
      'Generate with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"',
    );
  }

  _masterKey = Buffer.from(hex, 'hex');
  return _masterKey;
}

/** Returns true if the encryption key is configured. */
export function isEncryptionConfigured(): boolean {
  const hex = process.env['CREDENTIAL_ENCRYPTION_KEY'];
  return !!hex && hex.length === 64;
}

// ---------------------------------------------------------------------------
// Encrypt / Decrypt
// ---------------------------------------------------------------------------

interface EncryptedPayload {
  iv:         string;   // base64
  tag:        string;   // base64
  ciphertext: string;   // base64
}

/**
 * Encrypts a plaintext string (typically JSON-serialised credentials).
 * Returns a base64-encoded JSON envelope.
 */
export function encrypt(plaintext: string): string {
  const key = getMasterKey();
  const iv  = randomBytes(IV_BYTES);

  const cipher = createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();

  const payload: EncryptedPayload = {
    iv:         iv.toString('base64'),
    tag:        tag.toString('base64'),
    ciphertext: encrypted.toString('base64'),
  };

  return Buffer.from(JSON.stringify(payload)).toString('base64');
}

/**
 * Decrypts an envelope produced by encrypt().
 * Returns the original plaintext string.
 * Throws on tampered ciphertext (GCM auth tag mismatch).
 */
export function decrypt(envelope: string): string {
  const key = getMasterKey();

  let payload: EncryptedPayload;
  try {
    payload = JSON.parse(Buffer.from(envelope, 'base64').toString('utf8')) as EncryptedPayload;
  } catch {
    throw new Error('Invalid encrypted credential envelope');
  }

  const iv         = Buffer.from(payload.iv,         'base64');
  const tag        = Buffer.from(payload.tag,        'base64');
  const ciphertext = Buffer.from(payload.ciphertext, 'base64');

  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag.slice(0, TAG_BYTES));

  const decrypted = Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ]);

  return decrypted.toString('utf8');
}

// ---------------------------------------------------------------------------
// Credential-specific helpers (ProtocolCredentials shape)
// ---------------------------------------------------------------------------

/**
 * Encrypts a credentials object to a storable string.
 * Caller must ensure the result is what gets written to DB — never the plain object.
 */
export function encryptCredentials(credentials: Record<string, unknown>): string {
  return encrypt(JSON.stringify(credentials));
}

/**
 * Decrypts a stored credential envelope back to a plain object.
 * Should only be called in the service layer immediately before initiating a connection.
 * NEVER pass the result to a logger.
 */
export function decryptCredentials(envelope: string): Record<string, unknown> {
  try {
    return JSON.parse(decrypt(envelope)) as Record<string, unknown>;
  } catch (err) {
    // Log the error without any decrypted content
    log.error('decryptCredentials failed — envelope may be corrupt or key mismatch', err);
    throw new Error('Failed to decrypt credentials');
  }
}
