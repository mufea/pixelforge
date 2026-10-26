import "server-only";

import { createFalClient } from "@fal-ai/client";
import { getFalCredentials } from "@/lib/ai/config";
import { isAbortLike, normalizeProviderError } from "@/lib/ai/errors";
import { DomainError } from "@/lib/errors";

export type FalSubscribeResult = {
  data: unknown;
  requestId?: string;
};

export type FalSubscriber = (
  modelId: string,
  input: Record<string, unknown>,
  signal: AbortSignal,
) => Promise<FalSubscribeResult>;

let subscriberOverride: FalSubscriber | null = null;

export function setFalSubscriberForTests(next: FalSubscriber | null) {
  subscriberOverride = next;
}

export async function subscribeFal(
  modelId: string,
  input: Record<string, unknown>,
  signal: AbortSignal,
): Promise<FalSubscribeResult> {
  const run = subscriberOverride ?? defaultSubscribeFal;
  try {
    return await run(modelId, input, signal);
  } catch (error) {
    throw mapFalClientError(error);
  }
}

async function defaultSubscribeFal(
  modelId: string,
  input: Record<string, unknown>,
  signal: AbortSignal,
): Promise<FalSubscribeResult> {
  const credentials = getFalCredentials();
  const client = createFalClient({ credentials: credentials.apiKey });
  const result = await client.subscribe(modelId as never, {
    input,
    abortSignal: signal,
  } as never);
  return { data: result.data, requestId: result.requestId };
}

export function mapFalClientError(error: unknown): DomainError {
  if (error instanceof DomainError) {
    return error;
  }
  if (isAbortLike(error)) {
    return normalizeProviderError(error);
  }
  const status = readErrorStatus(error);
  if (status === 429) {
    return new DomainError("PROVIDER_RATE_LIMITED", "The image provider is rate limited", 429);
  }
  if (status !== undefined && status >= 500) {
    return new DomainError("PROVIDER_UNAVAILABLE", "The image provider is unavailable", 503);
  }
  if (status === 401 || status === 403) {
    return new DomainError("PROVIDER_REJECTED", "The image provider rejected the request", 502);
  }
  return normalizeProviderError(error);
}

function readErrorStatus(error: unknown): number | undefined {
  if (!error || typeof error !== "object") {
    return undefined;
  }
  if ("status" in error && typeof error.status === "number") {
    return error.status;
  }
  if ("statusCode" in error && typeof error.statusCode === "number") {
    return error.statusCode;
  }
  return undefined;
}
