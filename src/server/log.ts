/**
 * Structured logging (Phase 12, NFR-11/FR-SEC-31). One JSON line per event with a
 * `requestId` for correlation. The logger NEVER accepts free-form interpolation of
 * personal data or money — callers pass a short event name and a small, safe `meta`
 * object (ids and counts only). Amounts, Transaction IDs, tokens and PII must never be
 * put in `meta`; the money/audit layers keep those in the database, not the log.
 */
import "server-only";
import { randomUUID } from "node:crypto";

export type LogLevel = "info" | "warn" | "error";

export interface LogFields {
  requestId?: string;
  event: string;
  level?: LogLevel;
  [key: string]: string | number | boolean | undefined;
}

/** A fresh request id for correlating a single request's log lines. */
export function newRequestId(): string {
  return randomUUID();
}

export function log(fields: LogFields): void {
  const { level = "info", ...rest } = fields;
  const line = JSON.stringify({ ts: new Date().toISOString(), level, ...rest });
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.info(line);
}
