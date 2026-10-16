import "server-only";

import { getOpenAICredentials } from "@/lib/ai/config";
import { domainErrorFromProviderResponse, normalizeProviderError } from "@/lib/ai/errors";
import type { GenerateInput, ProviderResult } from "@/lib/ai/types";
import { DomainError } from "@/lib/errors";

const OPENAI_MODEL = "gpt-image-2.5-flare";

export async function openaiGenerate(input: GenerateInput, signal: AbortSignal): Promise<ProviderResult> {
  const credentials = getOpenAICredentials();
  const started = Date.now();

  let response: Response;
  try {
    response = await fetch(`${credentials.baseUrl.replace(/\/$/, "")}/images/generations`, {
      method: "POST",
      signal,
      headers: {
        Authorization: `Bearer ${credentials.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: OPENAI_MODEL,
        prompt: input.prompt,
        size: "1024x1024",
        n: 1,
      }),
    });
  } catch (error) {
    throw normalizeProviderError(error);
  }

  if (!response.ok) {
    throw await domainErrorFromProviderResponse(response);
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

export { OPENAI_MODEL };
