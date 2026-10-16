import { DomainError } from "@/lib/errors";

export const RETRYABLE_PROVIDER_CODES = new Set([
  "PROVIDER_RATE_LIMITED",
  "PROVIDER_UNAVAILABLE",
  "TIMEOUT",
]);

export function isRetryableProviderCode(code: string): boolean {
  return RETRYABLE_PROVIDER_CODES.has(code);
}

export function isRetryableProviderError(error: unknown): boolean {
  if (error instanceof DomainError) {
    return isRetryableProviderCode(error.code);
  }
  return isAbortLike(error);
}

export function isAbortLike(error: unknown): boolean {
  if (!error || typeof error !== "object") {
    return false;
  }
  const name = "name" in error ? String(error.name) : "";
  if (name === "AbortError" || name === "TimeoutError") {
    return true;
  }
  if ("code" in error) {
    const code = String(error.code);
    if (code === "ABORT_ERR" || code === "UND_ERR_ABORTED" || code === "UND_ERR_HEADERS_TIMEOUT") {
      return true;
    }
  }
  return false;
}

export function normalizeProviderError(error: unknown): DomainError {
  if (error instanceof DomainError) {
    return error;
  }
  if (isAbortLike(error)) {
    return new DomainError("TIMEOUT", "The image provider timed out", 504);
  }
  return new DomainError("PROVIDER_UNAVAILABLE", "The image provider is unavailable", 503);
}

export async function withNormalizedProviderErrors<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    throw normalizeProviderError(error);
  }
}

export async function domainErrorFromProviderResponse(response: Response): Promise<DomainError> {
  if (response.status === 429) {
    return new DomainError("PROVIDER_RATE_LIMITED", "The image provider is rate limited", 429);
  }
  if (response.status >= 500) {
    return new DomainError("PROVIDER_UNAVAILABLE", "The image provider is unavailable", 503);
  }
  const message = await providerErrorMessage(response);
  if (isSafetyMessage(message)) {
    return new DomainError("SAFETY_REJECTED", "The image provider rejected the request for safety reasons", 400);
  }
  return new DomainError("PROVIDER_REJECTED", message, 502);
}

export async function providerErrorMessage(response: Response) {
  try {
    const payload = (await response.json()) as { error?: { message?: unknown } };
    const message = payload.error?.message;
    if (typeof message === "string" && message.trim().length > 0) {
      return message.trim().slice(0, 280);
    }
  } catch {
    // Fall through to the generic message; never include credentials or raw bodies.
  }
  return "The image provider rejected the request";
}

function isSafetyMessage(message: string) {
  const lowered = message.toLowerCase();
  return (
    lowered.includes("safety") ||
    lowered.includes("content policy") ||
    lowered.includes("moderation")
  );
}
