const FALLBACK_PATH = "/app";

export function safeInternalPath(
  value: string | null | undefined,
  fallback: string = FALLBACK_PATH,
): string {
  if (!value) {
    return fallback;
  }

  if (!value.startsWith("/")) {
    return fallback;
  }

  if (value.startsWith("//") || value.startsWith("/\\")) {
    return fallback;
  }

  if (value.includes("://") || value.includes("\\")) {
    return fallback;
  }

  return value;
}
