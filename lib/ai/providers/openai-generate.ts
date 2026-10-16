import { getEnv, isOpenAIConfigured } from "@/lib/env";
import { DomainError } from "@/lib/errors";
import type { GenerateInput, ProviderResult } from "@/lib/ai/types";

const OPENAI_MODEL = "gpt-image-2.5-flare";

export async function openaiGenerate(input: GenerateInput, signal: AbortSignal): Promise<ProviderResult> {
  const env = getEnv();
  if (!isOpenAIConfigured(env)) {
    throw new DomainError("PROVIDER_NOT_CONFIGURED", "OpenAI image generation is not configured", 503);
  }

  const started = Date.now();
  const response = await fetch(`${env.OPENAI_BASE_URL.replace(/\/$/, "")}/images/generations`, {
    method: "POST",
    signal,
    headers: {
      Authorization: `Bearer ${env.OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      prompt: input.prompt,
      size: "1024x1024",
      n: 1,
    }),
  });

  if (response.status === 429) {
    throw new DomainError("PROVIDER_RATE_LIMITED", "The image provider is rate limited", 429);
  }
  if (response.status >= 500) {
    throw new DomainError("PROVIDER_UNAVAILABLE", "The image provider is unavailable", 503);
  }
  if (!response.ok) {
    throw new DomainError("PROVIDER_REJECTED", await providerErrorMessage(response), 502);
  }

  const payload = (await response.json()) as {
    data?: Array<{ b64_json?: string; url?: string }>;
    id?: string;
  };
  const b64 = payload.data?.[0]?.b64_json;
  if (!b64) {
    throw new DomainError("PROVIDER_REJECTED", "The image provider did not return image bytes", 502);
  }

  const bytes = Buffer.from(b64, "base64");
  return {
    images: [{ bytes, mimeType: "image/png", width: 1024, height: 1024 }],
    providerRequestId: payload.id,
    latencyMs: Date.now() - started,
    rawModel: OPENAI_MODEL,
  };
}

async function providerErrorMessage(response: Response) {
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

export { OPENAI_MODEL };
