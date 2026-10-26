import "server-only";

import { DomainError } from "@/lib/errors";
import {
  getProviderRuntimeConfig,
  getProviderTimeoutMs,
  isProviderConfigured,
} from "@/lib/ai/config";
import { normalizeProviderError } from "@/lib/ai/errors";
import { falGenerate, falRemoveBackground, falRemoveObject, falUnimplemented, falUpscale } from "@/lib/ai/providers/fal";
import { googleUnimplemented } from "@/lib/ai/providers/google";
import { mockEdit, mockGenerate, mockRemoveBackground, mockRemoveObject, mockUpscale } from "@/lib/ai/providers/mock";
import { openaiEdit } from "@/lib/ai/providers/openai-edit";
import { openaiGenerate } from "@/lib/ai/providers/openai-generate";
import {
  stabilityEdit,
  stabilityGenerate,
  stabilityRemoveBackground,
  stabilityRemoveObject,
  stabilityUpscale,
} from "@/lib/ai/providers/stability";
import { assertOperationSupported, defaultModelFor, getModel, getProviderEntry } from "@/lib/ai/registry";
import {
  isProviderId,
  type BackgroundRemovalAdapter,
  type EditInput,
  type GenerateInput,
  type ImageEditAdapter,
  type ImageGenerationAdapter,
  type ImageOperation,
  type ObjectRemovalAdapter,
  type ProviderId,
  type ProviderResult,
  type ProviderSelection,
  type RemoveBackgroundInput,
  type RemoveObjectInput,
  type ResolvedProvider,
  type UpscaleAdapter,
  type UpscaleInput,
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
      return "fal-ai/flux/schnell";
    case "stability":
      return "stability-image-ultra";
  }
}

const AUTO_PROVIDER_ORDER: Record<ImageOperation, ProviderId[]> = {
  GENERATE: ["openai", "fal", "stability"],
  EDIT: ["openai", "stability"],
  REMOVE_BACKGROUND: ["fal", "stability"],
  UPSCALE: ["fal", "stability"],
  REMOVE_OBJECT: ["fal", "stability"],
};

function resolveAutomatic(operation: ImageOperation): ResolvedProvider {
  const config = getProviderRuntimeConfig();
  if (config.mockAllowed) {
    const mock = defaultModelFor("mock", operation);
    if (mock) {
      return { providerId: "mock", modelId: mock.modelId };
    }
  }
  for (const providerId of AUTO_PROVIDER_ORDER[operation]) {
    if (!isProviderConfigured(providerId)) {
      continue;
    }
    const model = defaultModelFor(providerId, operation);
    if (model) {
      return { providerId, modelId: model.modelId };
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
  if (operation === "EDIT") {
    throw new DomainError("PROVIDER_NOT_CONFIGURED", "No image editing provider is configured", 503);
  }
  if (operation === "REMOVE_OBJECT") {
    throw new DomainError("PROVIDER_NOT_CONFIGURED", "No object removal provider is configured", 503);
  }
  throw new DomainError("MODEL_CAPABILITY_UNSUPPORTED", `Operation ${operation} is not implemented`, 400);
}

export function resolveGenerateProvider(explicit?: ProviderId | string): ProviderId {
  return resolveProvider("GENERATE", explicit ? { providerId: explicit } : {}).providerId;
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
    return { providerId: "fal", modelId: resolved.modelId, generate: falGenerate };
  }
  if (resolved.providerId === "stability") {
    return { providerId: "stability", modelId: resolved.modelId, generate: stabilityGenerate };
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
  if (resolved.providerId === "stability") {
    return { providerId: "stability", modelId: resolved.modelId, removeBackground: stabilityRemoveBackground };
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
  return "No image generation provider is configured. Set OPENAI_API_KEY, FAL_KEY, or STABILITY_API_KEY on the server, or use AI_PROVIDER_MODE=mock in development tests.";
}

export function getUpscaleAdapter(selection: ProviderSelection = {}): UpscaleAdapter {
  const resolved = resolveProvider("UPSCALE", selection);
  if (resolved.providerId === "mock") {
    return { providerId: "mock", modelId: resolved.modelId, upscale: mockUpscale };
  }
  if (resolved.providerId === "fal") {
    return { providerId: "fal", modelId: resolved.modelId, upscale: falUpscale };
  }
  if (resolved.providerId === "stability") {
    return { providerId: "stability", modelId: resolved.modelId, upscale: stabilityUpscale };
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
  return "No background removal provider is configured. Set FAL_KEY or STABILITY_API_KEY on the server, or use AI_PROVIDER_MODE=mock in development tests.";
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
  return "No upscale provider is configured. Set FAL_KEY or STABILITY_API_KEY on the server, or use AI_PROVIDER_MODE=mock in development tests.";
}

export function getEditAdapter(selection: ProviderSelection = {}): ImageEditAdapter {
  const resolved = resolveProvider("EDIT", selection);
  if (resolved.providerId === "mock") {
    return { providerId: "mock", modelId: resolved.modelId, edit: mockEdit };
  }
  if (resolved.providerId === "openai") {
    return { providerId: "openai", modelId: resolved.modelId, edit: openaiEdit };
  }
  if (resolved.providerId === "stability") {
    return { providerId: "stability", modelId: resolved.modelId, edit: stabilityEdit };
  }
  if (resolved.providerId === "fal") {
    return falUnimplemented("EDIT");
  }
  throw new DomainError(
    "MODEL_CAPABILITY_UNSUPPORTED",
    `Provider ${resolved.providerId} does not implement EDIT`,
    400,
  );
}

export async function runEdit(
  input: EditInput,
  signal: AbortSignal,
  selection: ProviderSelection = {},
): Promise<ProviderResult> {
  try {
    const adapter = getEditAdapter(selection);
    return await adapter.edit(input, signal);
  } catch (error) {
    throw normalizeProviderError(error);
  }
}

export function isEditAvailable(): boolean {
  const config = getProviderRuntimeConfig();
  if (!config.jobsEnabled) {
    return false;
  }
  try {
    resolveProvider("EDIT");
    return true;
  } catch {
    return false;
  }
}

export function editUnavailableReason(): string | null {
  if (isEditAvailable()) {
    return null;
  }
  const config = getProviderRuntimeConfig();
  if (!config.jobsEnabled) {
    return "AI jobs are temporarily disabled.";
  }
  return "No image editing provider is configured. Set OPENAI_API_KEY or STABILITY_API_KEY on the server, or use AI_PROVIDER_MODE=mock in development tests.";
}

export function getObjectRemovalAdapter(selection: ProviderSelection = {}): ObjectRemovalAdapter {
  const resolved = resolveProvider("REMOVE_OBJECT", selection);
  if (resolved.providerId === "mock") {
    return { providerId: "mock", modelId: resolved.modelId, removeObject: mockRemoveObject };
  }
  if (resolved.providerId === "fal") {
    return { providerId: "fal", modelId: resolved.modelId, removeObject: falRemoveObject };
  }
  if (resolved.providerId === "stability") {
    return { providerId: "stability", modelId: resolved.modelId, removeObject: stabilityRemoveObject };
  }
  throw new DomainError(
    "MODEL_CAPABILITY_UNSUPPORTED",
    `Provider ${resolved.providerId} does not implement REMOVE_OBJECT`,
    400,
  );
}

export async function runRemoveObject(
  input: RemoveObjectInput,
  signal: AbortSignal,
  selection: ProviderSelection = {},
): Promise<ProviderResult> {
  try {
    const adapter = getObjectRemovalAdapter(selection);
    return await adapter.removeObject(input, signal);
  } catch (error) {
    throw normalizeProviderError(error);
  }
}

export function isRemoveObjectAvailable(): boolean {
  const config = getProviderRuntimeConfig();
  if (!config.jobsEnabled) {
    return false;
  }
  try {
    resolveProvider("REMOVE_OBJECT");
    return true;
  } catch {
    return false;
  }
}

export function removeObjectUnavailableReason(): string | null {
  if (isRemoveObjectAvailable()) {
    return null;
  }
  const config = getProviderRuntimeConfig();
  if (!config.jobsEnabled) {
    return "AI jobs are temporarily disabled.";
  }
  return "No object removal provider is configured. Set FAL_KEY or STABILITY_API_KEY on the server, or use AI_PROVIDER_MODE=mock in development tests.";
}

export { getProviderTimeoutMs };
