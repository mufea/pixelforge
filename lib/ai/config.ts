import "server-only";

import { DomainError } from "@/lib/errors";
import {
  getEnv,
  isFalConfigured,
  isGoogleAiConfigured,
  isMockAiAllowed,
  isOpenAIConfigured,
  type AppEnv,
} from "@/lib/env";
import type { ProviderId } from "@/lib/ai/types";

export type ProviderRuntimeConfig = {
  mode: "live" | "mock";
  mockAllowed: boolean;
  jobsEnabled: boolean;
  defaultTimeoutMs: number;
  openai: { configured: boolean; baseUrl: string; timeoutMs: number };
  fal: { configured: boolean; timeoutMs: number };
  google: { configured: boolean; baseUrl: string; timeoutMs: number };
};

export type PublicProviderStatus = {
  id: ProviderId;
  configured: boolean;
};

export function getProviderRuntimeConfig(env: AppEnv = getEnv()): ProviderRuntimeConfig {
  return {
    mode: env.AI_PROVIDER_MODE,
    mockAllowed: isMockAiAllowed(env),
    jobsEnabled: env.AI_JOBS_ENABLED,
    defaultTimeoutMs: env.OPENAI_TIMEOUT_MS,
    openai: {
      configured: isOpenAIConfigured(env),
      baseUrl: env.OPENAI_BASE_URL,
      timeoutMs: env.OPENAI_TIMEOUT_MS,
    },
    fal: {
      configured: isFalConfigured(env),
      timeoutMs: env.FAL_TIMEOUT_MS,
    },
    google: {
      configured: isGoogleAiConfigured(env),
      baseUrl: env.GOOGLE_AI_BASE_URL,
      timeoutMs: env.GOOGLE_AI_TIMEOUT_MS,
    },
  };
}

export function isProviderConfigured(providerId: ProviderId, env: AppEnv = getEnv()): boolean {
  switch (providerId) {
    case "mock":
      return isMockAiAllowed(env);
    case "openai":
      return isOpenAIConfigured(env);
    case "fal":
      return isFalConfigured(env);
    case "google":
      return isGoogleAiConfigured(env);
  }
}

export function getProviderTimeoutMs(providerId: ProviderId, env: AppEnv = getEnv()): number {
  const config = getProviderRuntimeConfig(env);
  switch (providerId) {
    case "openai":
      return config.openai.timeoutMs;
    case "fal":
      return config.fal.timeoutMs;
    case "google":
      return config.google.timeoutMs;
    case "mock":
      return config.defaultTimeoutMs;
  }
}

export function publicProviderStatuses(env: AppEnv = getEnv()): PublicProviderStatus[] {
  return [
    { id: "mock", configured: isProviderConfigured("mock", env) },
    { id: "openai", configured: isProviderConfigured("openai", env) },
    { id: "fal", configured: isProviderConfigured("fal", env) },
    { id: "google", configured: isProviderConfigured("google", env) },
  ];
}

export function getOpenAICredentials(env: AppEnv = getEnv()) {
  if (!isOpenAIConfigured(env)) {
    throw new DomainError("PROVIDER_NOT_CONFIGURED", "OpenAI image generation is not configured", 503);
  }
  return {
    apiKey: env.OPENAI_API_KEY as string,
    baseUrl: env.OPENAI_BASE_URL,
    timeoutMs: env.OPENAI_TIMEOUT_MS,
  };
}

export function getFalCredentials(env: AppEnv = getEnv()) {
  if (!isFalConfigured(env)) {
    throw new DomainError("PROVIDER_NOT_CONFIGURED", "Fal is not configured", 503);
  }
  return { apiKey: env.FAL_KEY as string, timeoutMs: env.FAL_TIMEOUT_MS };
}

export function getGoogleAiCredentials(env: AppEnv = getEnv()) {
  if (!isGoogleAiConfigured(env)) {
    throw new DomainError("PROVIDER_NOT_CONFIGURED", "Google AI is not configured", 503);
  }
  return {
    apiKey: env.GOOGLE_AI_API_KEY as string,
    baseUrl: env.GOOGLE_AI_BASE_URL,
    timeoutMs: env.GOOGLE_AI_TIMEOUT_MS,
  };
}
