import "server-only";

import { DomainError } from "@/lib/errors";
import type {
  ImageOperation,
  ProviderCatalogEntry,
  ProviderId,
  ProviderModelCatalogEntry,
} from "@/lib/ai/types";

const GENERATE_ONLY = {
  operations: ["GENERATE"] as ImageOperation[],
  sizes: ["1024x1024", "1536x1024", "1024x1536"],
  maxN: 1,
  supportsSeed: false,
  supportsNegativePrompt: false,
  supportsMask: false,
  supportsReferenceImages: false,
  outputFormats: ["png"] as Array<"png" | "jpeg" | "webp">,
};

/**
 * In-code provider/model catalog.
 *
 * Provider / AIModel tables from docs/DATABASE.md are deferred: Phase 4.5 must not
 * add a Prisma migration. `enabled: false` and `implemented: false` block enqueue
 * the same way a disabled DB row will in a later slice.
 *
 * Sharp convert/resize/crop stays in `lib/images` and is not registered here.
 */
export const PROVIDER_CATALOG: Record<ProviderId, ProviderCatalogEntry> = {
  mock: { id: "mock", displayName: "Mock", credentialEnvName: "AI_PROVIDER_MODE" },
  openai: { id: "openai", displayName: "OpenAI", credentialEnvName: "OPENAI_API_KEY" },
  fal: { id: "fal", displayName: "Fal", credentialEnvName: "FAL_KEY" },
  google: { id: "google", displayName: "Google AI", credentialEnvName: "GOOGLE_AI_API_KEY" },
  stability: { id: "stability", displayName: "Stability AI", credentialEnvName: "STABILITY_API_KEY" },
};

export const MODEL_CATALOG: ProviderModelCatalogEntry[] = [
  {
    providerId: "mock",
    modelId: "mock-png",
    displayName: "Mock PNG",
    enabled: true,
    capabilities: { ...GENERATE_ONLY, sizes: ["32x32"], implemented: true },
  },
  {
    providerId: "mock",
    modelId: "mock-bg-remove",
    displayName: "Mock background removal",
    enabled: true,
    capabilities: {
      operations: ["REMOVE_BACKGROUND"],
      sizes: [],
      maxN: 1,
      supportsSeed: false,
      supportsNegativePrompt: false,
      supportsMask: false,
      supportsReferenceImages: false,
      outputFormats: ["png"],
      implemented: true,
    },
  },
  {
    providerId: "mock",
    modelId: "mock-upscale",
    displayName: "Mock upscale",
    enabled: true,
    capabilities: {
      operations: ["UPSCALE"],
      sizes: [],
      maxN: 1,
      supportsSeed: false,
      supportsNegativePrompt: false,
      supportsMask: false,
      supportsReferenceImages: false,
      outputFormats: ["png"],
      implemented: true,
    },
  },
  {
    providerId: "mock",
    modelId: "mock-edit",
    displayName: "Mock edit",
    enabled: true,
    capabilities: {
      operations: ["EDIT"],
      sizes: [],
      maxN: 1,
      supportsSeed: false,
      supportsNegativePrompt: false,
      supportsMask: true,
      supportsReferenceImages: false,
      outputFormats: ["png"],
      implemented: true,
    },
  },
  {
    providerId: "mock",
    modelId: "mock-object-remove",
    displayName: "Mock object removal",
    enabled: true,
    capabilities: {
      operations: ["REMOVE_OBJECT"],
      sizes: [],
      maxN: 1,
      supportsSeed: false,
      supportsNegativePrompt: false,
      supportsMask: true,
      supportsReferenceImages: false,
      outputFormats: ["png"],
      implemented: true,
    },
  },
  {
    providerId: "mock",
    modelId: "mock-image-to-image",
    displayName: "Mock image-to-image",
    enabled: true,
    capabilities: {
      operations: ["IMAGE_TO_IMAGE"],
      sizes: [],
      maxN: 1,
      supportsSeed: false,
      supportsNegativePrompt: false,
      supportsMask: false,
      supportsReferenceImages: true,
      outputFormats: ["png"],
      implemented: true,
    },
  },
  {
    providerId: "openai",
    modelId: "gpt-image-2.5-flare",
    displayName: "GPT Image 2.5 Flare",
    enabled: true,
    capabilities: {
      ...GENERATE_ONLY,
      operations: ["GENERATE", "EDIT"],
      supportsMask: true,
      implemented: true,
    },
  },
  {
    providerId: "google",
    modelId: "gemini-nano-banana-2.1",
    displayName: "Gemini image (stub)",
    enabled: false,
    capabilities: { ...GENERATE_ONLY, implemented: false },
  },
  {
    providerId: "fal",
    modelId: "fal-ai/bria/background/remove",
    displayName: "Fal background removal",
    enabled: true,
    capabilities: {
      operations: ["REMOVE_BACKGROUND"],
      sizes: [],
      maxN: 1,
      supportsSeed: false,
      supportsNegativePrompt: false,
      supportsMask: false,
      supportsReferenceImages: false,
      outputFormats: ["png"],
      implemented: true,
    },
  },
  {
    providerId: "fal",
    modelId: "fal-ai/flux-vision-upscaler",
    displayName: "Fal Flux Vision upscaler",
    enabled: true,
    capabilities: {
      operations: ["UPSCALE"],
      sizes: [],
      maxN: 1,
      supportsSeed: false,
      supportsNegativePrompt: false,
      supportsMask: false,
      supportsReferenceImages: false,
      outputFormats: ["png"],
      implemented: true,
    },
  },
  {
    providerId: "fal",
    modelId: "fal-ai/object-removal/mask",
    displayName: "Fal object removal",
    enabled: true,
    capabilities: {
      operations: ["REMOVE_OBJECT"],
      sizes: [],
      maxN: 1,
      supportsSeed: false,
      supportsNegativePrompt: false,
      supportsMask: true,
      supportsReferenceImages: false,
      outputFormats: ["png"],
      implemented: true,
    },
  },
  {
    providerId: "fal",
    modelId: "fal-ai/flux/schnell",
    displayName: "Fal FLUX.1 [schnell]",
    enabled: true,
    capabilities: { ...GENERATE_ONLY, implemented: true },
  },
  {
    providerId: "fal",
    modelId: "fal-ai/flux-kontext/dev",
    displayName: "Fal FLUX.1 Kontext [dev]",
    enabled: true,
    capabilities: {
      operations: ["EDIT"],
      sizes: [],
      maxN: 1,
      supportsSeed: true,
      supportsNegativePrompt: false,
      supportsMask: false,
      supportsReferenceImages: true,
      outputFormats: ["png", "jpeg"],
      implemented: true,
    },
  },
  {
    providerId: "fal",
    modelId: "fal-ai/flux/dev/image-to-image",
    displayName: "Fal FLUX.1 [dev] image-to-image",
    enabled: true,
    capabilities: {
      operations: ["IMAGE_TO_IMAGE"],
      sizes: [],
      maxN: 1,
      supportsSeed: true,
      supportsNegativePrompt: false,
      supportsMask: false,
      supportsReferenceImages: true,
      outputFormats: ["png", "jpeg"],
      implemented: true,
    },
  },
  {
    providerId: "fal",
    modelId: "fal-ai/flux-2-pro",
    displayName: "Fal FLUX.2 Pro (stub)",
    enabled: false,
    capabilities: { ...GENERATE_ONLY, implemented: false },
  },
  {
    providerId: "stability",
    modelId: "stability-image-ultra",
    displayName: "Stable Image Ultra",
    enabled: true,
    capabilities: {
      ...GENERATE_ONLY,
      supportsNegativePrompt: true,
      supportsSeed: true,
      supportsReferenceImages: true,
      implemented: true,
    },
  },
  {
    providerId: "stability",
    modelId: "stability-image-inpaint",
    displayName: "Stable Image Inpaint",
    enabled: true,
    capabilities: {
      operations: ["EDIT"],
      sizes: [],
      maxN: 1,
      supportsSeed: true,
      supportsNegativePrompt: true,
      supportsMask: true,
      supportsReferenceImages: true,
      outputFormats: ["png"],
      implemented: true,
    },
  },
  {
    providerId: "stability",
    modelId: "stability-remove-background",
    displayName: "Stable Image Remove Background",
    enabled: true,
    capabilities: {
      operations: ["REMOVE_BACKGROUND"],
      sizes: [],
      maxN: 1,
      supportsSeed: false,
      supportsNegativePrompt: false,
      supportsMask: false,
      supportsReferenceImages: false,
      outputFormats: ["png"],
      implemented: true,
    },
  },
  {
    providerId: "stability",
    modelId: "stability-erase",
    displayName: "Stable Image Erase",
    enabled: true,
    capabilities: {
      operations: ["REMOVE_OBJECT"],
      sizes: [],
      maxN: 1,
      supportsSeed: true,
      supportsNegativePrompt: false,
      supportsMask: true,
      supportsReferenceImages: false,
      outputFormats: ["png"],
      implemented: true,
    },
  },
  {
    providerId: "stability",
    modelId: "stability-upscale-fast",
    displayName: "Stable Image Fast Upscale (4×)",
    enabled: true,
    capabilities: {
      operations: ["UPSCALE"],
      sizes: [],
      maxN: 1,
      supportsSeed: false,
      supportsNegativePrompt: false,
      supportsMask: false,
      supportsReferenceImages: false,
      outputFormats: ["png"],
      implemented: true,
    },
  },
];

export function listProviders(): ProviderCatalogEntry[] {
  return Object.values(PROVIDER_CATALOG);
}

export function getProviderEntry(providerId: ProviderId): ProviderCatalogEntry {
  return PROVIDER_CATALOG[providerId];
}

export function listModels(providerId?: ProviderId): ProviderModelCatalogEntry[] {
  if (!providerId) {
    return MODEL_CATALOG;
  }
  return MODEL_CATALOG.filter((model) => model.providerId === providerId);
}

export function getModel(providerId: ProviderId, modelId: string): ProviderModelCatalogEntry | undefined {
  return MODEL_CATALOG.find((model) => model.providerId === providerId && model.modelId === modelId);
}

export function defaultModelFor(providerId: ProviderId, operation: ImageOperation): ProviderModelCatalogEntry | undefined {
  return MODEL_CATALOG.find(
    (model) =>
      model.providerId === providerId &&
      model.enabled &&
      model.capabilities.implemented &&
      model.capabilities.operations.includes(operation),
  );
}

export function assertOperationSupported(model: ProviderModelCatalogEntry, operation: ImageOperation) {
  if (!model.enabled) {
    throw new DomainError("MODEL_DISABLED", "The selected model is not available", 400);
  }
  if (!model.capabilities.implemented || !model.capabilities.operations.includes(operation)) {
    throw new DomainError(
      "MODEL_CAPABILITY_UNSUPPORTED",
      `Model ${model.modelId} does not support ${operation}`,
      400,
    );
  }
}
