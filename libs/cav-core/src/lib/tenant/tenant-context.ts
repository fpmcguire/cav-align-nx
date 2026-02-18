/**
 * tenant-context.ts
 *
 * Tenant and module subscription types for CAV-Align's à la carte module model.
 * Each tenant purchases the shell + one or more protocol modules.
 * Module subscriptions carry their own limits and usage tracking.
 */

import type { User } from '@supabase/supabase-js';

/**
 * The full tenant context returned after authentication.
 * Includes user session + tenant subscription state.
 */
export interface TenantContext {
  readonly user: User;
  readonly tenant: Tenant;
  readonly subscriptions: ModuleSubscription[];
}

export interface Tenant {
  readonly id: string;
  readonly organizationName: string;
  readonly createdAt: string;
}

/**
 * A module subscription for a specific tenant.
 * Each module (MQTT, API, Kafka) has its own subscription record
 * with module-specific limits and usage tracking.
 */
export interface ModuleSubscription {
  readonly id: string;
  readonly tenantId: string;
  readonly moduleName: string;              // 'mqtt', 'api', 'kafka'
  readonly status: SubscriptionStatus;
  readonly tier: SubscriptionTier;
  readonly limits: ModuleLimits;
  readonly usage: ModuleUsage;
  readonly startedAt: string;               // ISO 8601
  readonly expiresAt?: string;              // ISO 8601 — null for perpetual
  readonly trialEndsAt?: string;            // ISO 8601 — null if not trial
  readonly usageResetAt: string;            // When usage counters reset
}

export type SubscriptionStatus =
  | 'active'      // Paid, valid subscription
  | 'trial'       // Free trial period
  | 'suspended'   // Payment failed or manually suspended
  | 'canceled';   // Subscription ended

export type SubscriptionTier = 'starter' | 'professional' | 'enterprise' | 'custom';

/**
 * Base module limits interface.
 * Each protocol module extends this with protocol-specific limits.
 */
export interface BaseModuleLimits {
  readonly retentionDays: number;           // How long to keep evidence/history
}

/**
 * MQTT module-specific limits.
 */
export interface MqttModuleLimits extends BaseModuleLimits {
  readonly maxConnections: number;
  readonly maxMessagesPerMonth: number;
  readonly maxTopicsPerConnection: number;
}

/**
 * API module-specific limits (future).
 */
export interface ApiModuleLimits extends BaseModuleLimits {
  readonly maxEndpoints: number;
  readonly maxRequestsPerMonth: number;
}

/**
 * Kafka module-specific limits (future).
 */
export interface KafkaModuleLimits extends BaseModuleLimits {
  readonly maxTopics: number;
  readonly maxMessagesPerMonth: number;
  readonly maxConsumerGroups: number;
}

/**
 * Union of all module limit types.
 * The actual type is determined by ModuleSubscription.moduleName.
 */
export type ModuleLimits =
  | MqttModuleLimits
  | ApiModuleLimits
  | KafkaModuleLimits
  | Record<string, unknown>;  // Fallback for unknown/future modules

/**
 * Module usage tracking for the current billing period.
 * Counters reset at usageResetAt.
 */
export interface ModuleUsage {
  // MQTT
  readonly connections?: number;
  readonly messagesThisMonth?: number;
  readonly topics?: number;

  // API
  readonly endpoints?: number;
  readonly requestsThisMonth?: number;

  // Kafka
  readonly kafkaTopics?: number;
  readonly consumerGroups?: number;

  // Extensible
  readonly [key: string]: number | undefined;
}

/**
 * Helper to check if a tenant has access to a module.
 */
export function hasModule(context: TenantContext | null, moduleName: string): boolean {
  if (!context) return false;
  return context.subscriptions.some(
    (s) => s.moduleName === moduleName && (s.status === 'active' || s.status === 'trial')
  );
}

/**
 * Helper to get a specific module subscription.
 */
export function getModuleSubscription(
  context: TenantContext | null,
  moduleName: string
): ModuleSubscription | null {
  if (!context) return null;
  return context.subscriptions.find((s) => s.moduleName === moduleName) ?? null;
}
