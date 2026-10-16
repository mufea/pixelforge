import { openaiGenerate } from "@/lib/ai/providers/openai-generate";
import { mockGenerate } from "@/lib/ai/providers/mock";
import type { GenerateInput, ProviderResult } from "@/lib/ai/types";
import { getEnv, isMockAiAllowed, isOpenAIConfigured } from "@/lib/env";
import { DomainError } from "@/lib/errors";

export function resolveGenerateProvider() {
  const env = getEnv();
  if (isMockAiAllowed(env)) {
    return "mock" as const;
  }
  if (isOpenAIConfigured(env)) {
    return "openai" as const;
  }
  throw new DomainError("PROVIDER_NOT_CONFIGURED", "No image generation provider is configured", 503);
}

export async function runGenerate(input: GenerateInput, signal: AbortSignal): Promise<ProviderResult> {
  const provider = resolveGenerateProvider();
  if (provider === "mock") {
    return mockGenerate(input);
  }
  return openaiGenerate(input, signal);
}
