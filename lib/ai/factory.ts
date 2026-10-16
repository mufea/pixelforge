import "server-only";

import { DomainError } from "@/lib/errors";
import {
  getProviderRuntimeConfig,
  getProviderTimeoutMs,
  isProviderConfigured,
} from "@/lib/ai/config";
import { normalizeProviderError } from "@/lib/ai/errors";
import { falRemoveBackground, falUnimplemented, falUpscale } from "@/lib/ai/providers/fal";
import { googleUnimplemented } from "@/lib/ai/providers/google";
import { mockGenerate, mockRemoveBackground, mockUpscale } from "@/lib/ai/providers/mock";
import { openaiGenerate } from "@/lib/ai/providers/openai-generate";
import { assertOperationSupported, defaultModelFor, getModel, getProviderEntry } from "@/lib/ai/registry";
import {
  isProviderId,
  type BackgroundRemovalAdapter,
  type GenerateInput,
  type ImageGenerationAdapter,
  type UpscaleAdapter,
  type UpscaleInput,
  type ImageOperation,
  type ProviderId,
  type ProviderResult,
  type ProviderSelection,
  type RemoveBackgroundInput,
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
  const config = getProviderRuntimeConfig();
  if (config.mockAllowed) {
    const mock = defaultModelFor("mock", operation);
    if (mock) {
      return { providerId: "mock", modelId: mock.modelId };
    }
  }
  if (operation === "GENERATE" && config.openai.configured) {
    return { providerId: "openai", modelId: "gpt-image-2.5-flare" };
  }
  if ((operation === "REMOVE_BACKGROUND" || operation === "UPSCALE") && config.fal.configured) {
    const fal = defaultModelFor("fal", operation);
    if (fal) {
      return { providerId: "fal", modelId: fal.modelId };
    }
  }
  if (operation === "GENERATE") {
    throw new DomainError("PROVIDER_NOT_CONFIGURED", "No image generation provider is configured", 503);
  }
  if (operation === "REMOVE_BACKGROUND") {
    throw new DomainError("PROVIDER_NOT_CONFIGURED", "No background removal provider is configured", 503);
  }
  if (operation === "UPSCALE") {
    throw new DomainError("PROVIDER_NOT_CONFIGURED", "No upscale provider is configured", 503);
  }
  throw new DomainError("MODEL_CAPABILITY_UNSUPPORTED", `Operation ${operation} is not implemented`, 400);
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

export function getBackgroundRemovalAdapter(selection: ProviderSelection = {}): BackgroundRemovalAdapter {
  const resolved = resolveProvider("REMOVE_BACKGROUND", selection);
  if (resolved.providerId === "mock") {
    return { providerId: "mock", modelId: resolved.modelId, removeBackground: mockRemoveBackground };
  }
  if (resolved.providerId === "fal") {
    return { providerId: "fal", modelId: resolved.modelId, removeBackground: falRemoveBackground };
  }
  throw new DomainError(
    "MODEL_CAPABILITY_UNSUPPORTED",
    `Provider ${resolved.providerId} does not implement REMOVE_BACKGROUND`,
    400,
  );
}

export async function runRemoveBackground(
  input: RemoveBackgroundInput,
  signal: AbortSignal,
  selection: ProviderSelection = {},
): Promise<ProviderResult> {
  try {
    const adapter = getBackgroundRemovalAdapter(selection);
    return await adapter.removeBackground(input, signal);
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

export function getUpscaleAdapter(selection: ProviderSelection = {}): UpscaleAdapter {
  const resolved = resolveProvider("UPSCALE", selection);
  if (resolved.providerId === "mock") {
    return { providerId: "mock", modelId: resolved.modelId, upscale: mockUpscale };
  }
  if (resolved.providerId === "fal") {
    return { providerId: "fal", modelId: resolved.modelId, upscale: falUpscale };
  }
  throw new DomainError(
    "MODEL_CAPABILITY_UNSUPPORTED",
    `Provider ${resolved.providerId} does not implement UPSCALE`,
    400,
  );
}

export async function runUpscale(
  input: UpscaleInput,
  signal: AbortSignal,
  selection: ProviderSelection = {},
): Promise<ProviderResult> {
  try {
    const adapter = getUpscaleAdapter(selection);
    return await adapter.upscale(input, signal);
  } catch (error) {
    throw normalizeProviderError(error);
  }
}

export function isRemoveBackgroundAvailable(): boolean {
  const config = getProviderRuntimeConfig();
  if (!config.jobsEnabled) {
    return false;
  }
  try {
    resolveProvider("REMOVE_BACKGROUND");
    return true;
  } catch {
    return false;
  }
}

export function removeBackgroundUnavailableReason(): string | null {
  if (isRemoveBackgroundAvailable()) {
    return null;
  }
  const config = getProviderRuntimeConfig();
  if (!config.jobsEnabled) {
    return "AI jobs are temporarily disabled.";
  }
  return "Fal is not configured. Set FAL_KEY on the server, or use AI_PROVIDER_MODE=mock in development tests.";
}

export function isUpscaleAvailable(): boolean {
  const config = getProviderRuntimeConfig();
  if (!config.jobsEnabled) {
    return false;
  }
  try {
    resolveProvider("UPSCALE");
    return true;
  } catch {
    return false;
  }
}

export function upscaleUnavailableReason(): string | null {
  if (isUpscaleAvailable()) {
    return null;
  }
  const config = getProviderRuntimeConfig();
  if (!config.jobsEnabled) {
    return "AI jobs are temporarily disabled.";
  }
  return "Fal is not configured. Set FAL_KEY on the server, or use AI_PROVIDER_MODE=mock in development tests.";
}

export { getProviderTimeoutMs };
