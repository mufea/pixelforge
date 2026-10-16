import sharp from "sharp";
import type { GenerateInput, ProviderResult } from "@/lib/ai/types";

export async function mockGenerate(input: GenerateInput): Promise<ProviderResult> {
  const started = Date.now();
  const bytes = await sharp({
    create: {
      width: 32,
      height: 32,
      channels: 3,
      background: { r: 30, g: 64, b: 175 },
    },
  })
    .png()
    .toBuffer();

  return {
    images: [{ bytes, mimeType: "image/png", width: 32, height: 32 }],
    providerRequestId: `mock-${Buffer.from(input.prompt).toString("hex").slice(0, 12)}`,
    latencyMs: Date.now() - started,
    rawModel: "mock-png",
  };
}
