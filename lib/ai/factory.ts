import "server-only";

import { DomainError } from "@/lib/errors";
import {
  getProviderRuntimeConfig,
  getProviderTimeoutMs,
  isProviderConfigured,
} from "@/lib/ai/config";
import { normalizeProviderError } from "@/lib/ai/errors";
import { falUnimplemented } from "@/lib/ai/providers/fal";
import { googleUnimplemented } from "@/lib/ai/providers/google";
import { mockGenerate } from "@/lib/ai/providers/mock";
import { openaiGenerate } from "@/lib/ai/providers/openai-generate";
import { assertOperationSupported, defaultModelFor, getModel, getProviderEntry } from "@/lib/ai/registry";
import {
  isProviderId,
  type GenerateInput,
  type ImageGenerationAdapter,
  type ImageOperation,
  type ProviderId,
  type ProviderResult,
  type ProviderSelection,
  type ResolvedProvider,
} from "@/lib/ai/types";

export function parseProviderId(value: string): ProviderId {
  if (!isProviderId(value)) {
    throw new DomainError("VALIDATION", `Unknown provider: ${value}`);
  }
  return value;
}

export function resolveProvider(operation: ImageOperation, selection: ProviderSelection = {}): ResolvedProvider {
  if (selection.providerId) {
    return resolveExplicit(operation, parseProviderId(selection.providerId), selection.modelId);
  }
  return resolveAutomatic(operation);
}

function resolveExplicit(operation: ImageOperation, providerId: ProviderId, modelId?: string): ResolvedProvider {
  if (!isProviderConfigured(providerId)) {
    const entry = getProviderEntry(providerId);
    throw new DomainError("PROVIDER_NOT_CONFIGURED", `${entry.displayName} is not configured`, 503);
  }

  const model = modelId
    ? getModel(providerId, modelId)
    : (defaultModelFor(providerId, operation) ?? getModelFallback(providerId));
  if (!model) {
    throw new DomainError("MODEL_DISABLED", "The selected model is not available", 400);
  }
  assertOperationSupported(model, operation);
  return { providerId, modelId: model.modelId };
}

function getModelFallback(providerId: ProviderId) {
  return getModel(providerId, defaultModelId(providerId));
}

function defaultModelId(providerId: ProviderId) {
  switch (providerId) {
    case "mock":
      return "mock-png";
    case "openai":
      return "gpt-image-2.5-flare";
    case "google":
      return "gemini-nano-banana-2.1";
    case "fal":
      return "fal-ai/flux-2-pro";
  }
}

function resolveAutomatic(operation: ImageOperation): ResolvedProvider {
  if (operation !== "GENERATE") {
    throw new DomainError("MODEL_CAPABILITY_UNSUPPORTED", `Operation ${operation} is not implemented`, 400);
  }

  const config = getProviderRuntimeConfig();
  if (config.mockAllowed) {
    return { providerId: "mock", modelId: "mock-png" };
  }
  if (config.openai.configured) {
    return { providerId: "openai", modelId: "gpt-image-2.5-flare" };
  }
  throw new DomainError("PROVIDER_NOT_CONFIGURED", "No image generation provider is configured", 503);
}

export function resolveGenerateProvider(explicit?: ProviderId | string): "mock" | "openai" {
  const resolved = resolveProvider("GENERATE", explicit ? { providerId: explicit } : {});
  if (resolved.providerId !== "mock" && resolved.providerId !== "openai") {
    throw new DomainError(
      "MODEL_CAPABILITY_UNSUPPORTED",
      `Provider ${resolved.providerId} does not implement GENERATE`,
      400,
    );
  }
  return resolved.providerId;
}

export function getGenerationAdapter(selection: ProviderSelection = {}): ImageGenerationAdapter {
  const resolved = resolveProvider("GENERATE", selection);
  if (resolved.providerId === "mock") {
    return { providerId: "mock", modelId: resolved.modelId, generate: mockGenerate };
  }
  if (resolved.providerId === "openai") {
    return { providerId: "openai", modelId: resolved.modelId, generate: openaiGenerate };
  }
  if (resolved.providerId === "fal") {
    return falUnimplemented("GENERATE");
  }
  return googleUnimplemented("GENERATE");
}

export async function runGenerate(
  input: GenerateInput,
  signal: AbortSignal,
  selection: ProviderSelection = {},
): Promise<ProviderResult> {
  try {
    const adapter = getGenerationAdapter(selection);
    return await adapter.generate(input, signal);
  } catch (error) {
    throw normalizeProviderError(error);
  }
}

export function isGenerateAvailable(): boolean {
  const config = getProviderRuntimeConfig();
  if (!config.jobsEnabled) {
    return false;
  }
  try {
    resolveProvider("GENERATE");
    return true;
  } catch {
    return false;
  }
}

export function generateUnavailableReason(): string | null {
  if (isGenerateAvailable()) {
    return null;
  }
  const config = getProviderRuntimeConfig();
  if (!config.jobsEnabled) {
    return "AI jobs are temporarily disabled.";
  }
  return "OpenAI is not configured. Set OPENAI_API_KEY on the server, or use AI_PROVIDER_MODE=mock in development tests.";
}

export { getProviderTimeoutMs };
