import type { DomainError, DomainErrorCode } from "./errors";

export type Result<T> = { ok: true; value: T } | { ok: false; error: DomainError };

export function ok<T>(value: T): Result<T> {
  return { ok: true, value };
}

export function err<T>(code: DomainErrorCode, message: string, fix: string): Result<T> {
  return { ok: false, error: { code, message, fix } };
}
