export const PROVIDER_IDS = ["mock", "openai", "fal", "google", "stability"] as const;
export type ProviderId = (typeof PROVIDER_IDS)[number];

export const IMAGE_OPERATIONS = [
  "GENERATE",
  "EDIT",
  "REMOVE_BACKGROUND",
  "UPSCALE",
  "REMOVE_OBJECT",
  "IMAGE_TO_IMAGE",
] as const;
export type ImageOperation = (typeof IMAGE_OPERATIONS)[number];

export type OutputImageMime = "image/png" | "image/jpeg" | "image/webp";

export type ModelCapabilities = {
  operations: ImageOperation[];
  sizes: string[];
  maxN: number;
  supportsSeed: boolean;
  supportsNegativePrompt: boolean;
  supportsMask: boolean;
  supportsReferenceImages: boolean;
  outputFormats: Array<"png" | "jpeg" | "webp">;
  /**
   * False for catalog stubs. Later slices flip this when the adapter may be called.
   * Sharp convert/resize/crop is not an AI capability and is not listed here.
   */
  implemented: boolean;
};

export type ProviderCatalogEntry = {
  id: ProviderId;
  displayName: string;
  /** Env var name shown in docs/UI. Never the secret value. */
  credentialEnvName: string;
};

export type ProviderModelCatalogEntry = {
  providerId: ProviderId;
  modelId: string;
  displayName: string;
  enabled: boolean;
  capabilities: ModelCapabilities;
};

export type ProviderResult = {
  images: Array<{ bytes: Buffer; mimeType: OutputImageMime; width: number; height: number }>;
  providerRequestId?: string;
  latencyMs: number;
  rawModel: string;
};

export type GenerateInput = {
  prompt: string;
};

export type EditInput = {
  prompt: string;
  image: Buffer;
  mimeType?: OutputImageMime;
  mask?: Buffer;
};

export type RemoveBackgroundInput = {
  image: Buffer;
  mimeType?: OutputImageMime;
};

export type UpscaleScaleFactor = 2 | 3 | 4;

export type UpscaleInput = {
  image: Buffer;
  mimeType?: OutputImageMime;
  scaleFactor: UpscaleScaleFactor;
};

export type RemoveObjectInput = {
  image: Buffer;
  mask: Buffer;
  mimeType?: OutputImageMime;
};

export type ImageToImageInput = {
  prompt: string;
  image: Buffer;
  mimeType?: OutputImageMime;
  /** Fal flux/dev/image-to-image: 0.01–1, documented default 0.95. */
  strength?: number;
};

export type ImageGenerationAdapter = {
  readonly providerId: ProviderId;
  readonly modelId: string;
  generate(input: GenerateInput, signal: AbortSignal): Promise<ProviderResult>;
};

export type BackgroundRemovalAdapter = {
  readonly providerId: ProviderId;
  readonly modelId: string;
  removeBackground(input: RemoveBackgroundInput, signal: AbortSignal): Promise<ProviderResult>;
};

export type UpscaleAdapter = {
  readonly providerId: ProviderId;
  readonly modelId: string;
  upscale(input: UpscaleInput, signal: AbortSignal): Promise<ProviderResult>;
};

export type ImageEditAdapter = {
  readonly providerId: ProviderId;
  readonly modelId: string;
  edit(input: EditInput, signal: AbortSignal): Promise<ProviderResult>;
};

export type ObjectRemovalAdapter = {
  readonly providerId: ProviderId;
  readonly modelId: string;
  removeObject(input: RemoveObjectInput, signal: AbortSignal): Promise<ProviderResult>;
};

export type ImageToImageAdapter = {
  readonly providerId: ProviderId;
  readonly modelId: string;
  imageToImage(input: ImageToImageInput, signal: AbortSignal): Promise<ProviderResult>;
};

export type ProviderSelection = {
  providerId?: ProviderId | string;
  modelId?: string;
};

export type ResolvedProvider = {
  providerId: ProviderId;
  modelId: string;
};

export function isProviderId(value: string): value is ProviderId {
  return (PROVIDER_IDS as readonly string[]).includes(value);
}

export function isImageOperation(value: string): value is ImageOperation {
  return (IMAGE_OPERATIONS as readonly string[]).includes(value);
}
