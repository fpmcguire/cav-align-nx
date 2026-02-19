/**
 * logger.ts
 *
 * Structured logging baseline for CAV-Align backend.
 * Every log line includes: timestamp, level, requestId, tenantId, message, context.
 *
 * CAV Level 1 hardening — Section 5 of Hardening Directive.
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogEntry {
  timestamp: string;
  level: LogLevel;
  requestId?: string;
  tenantId?: string;
  userId?: string;
  message: string;
  context?: Record<string, unknown>;
  error?: string;
}

export interface Logger {
  debug(message: string, context?: Record<string, unknown>): void;
  info(message: string, context?: Record<string, unknown>): void;
  warn(message: string, context?: Record<string, unknown>): void;
  error(message: string, error?: unknown, context?: Record<string, unknown>): void;
  child(bindings: { requestId?: string; tenantId?: string; userId?: string; context?: string }): Logger;
}

function formatError(err: unknown): string | undefined {
  if (!err) return undefined;
  if (err instanceof Error) return `${err.name}: ${err.message}`;
  return String(err);
}

function createLogger(bindings: {
  requestId?: string;
  tenantId?: string;
  userId?: string;
  context?: string;
} = {}): Logger {
  function write(level: LogLevel, message: string, context?: Record<string, unknown>, err?: unknown): void {
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      requestId: bindings.requestId,
      tenantId: bindings.tenantId,
      userId: bindings.userId,
      message,
      ...(context || bindings.context ? { context: { ...(bindings.context ? { logger: bindings.context } : {}), ...context } } : {}),
      ...(err !== undefined ? { error: formatError(err) } : {}),
    };
    const line = JSON.stringify(entry);
    if (level === 'error' || level === 'warn') {
      process.stderr.write(line + '\n');
    } else {
      process.stdout.write(line + '\n');
    }
  }

  return {
    debug: (msg, ctx) => write('debug', msg, ctx),
    info:  (msg, ctx) => write('info',  msg, ctx),
    warn:  (msg, ctx) => write('warn',  msg, ctx),
    error: (msg, err, ctx) => write('error', msg, ctx, err),
    child: (childBindings) => createLogger({ ...bindings, ...childBindings }),
  };
}

export const rootLogger = createLogger();
