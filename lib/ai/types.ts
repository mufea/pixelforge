export type ProviderResult = {
  images: Array<{ bytes: Buffer; mimeType: "image/png" | "image/jpeg" | "image/webp"; width: number; height: number }>;
  providerRequestId?: string;
  latencyMs: number;
  rawModel: string;
};

export type GenerateInput = {
  prompt: string;
};
