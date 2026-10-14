import pino from "pino";
import { getEnv } from "@/lib/env";

export const logger = pino({
  level: getEnv().LOG_LEVEL,
  redact: {
    paths: [
      "req.headers.authorization",
      "req.headers.cookie",
      "password",
      "token",
      "secret",
      "apiKey",
      "*.password",
      "*.token",
      "*.secret",
      "*.apiKey",
      "*.accessToken",
      "*.signedUrl",
      "url",
      "*.url",
    ],
    remove: true,
  },
  base: { service: "pixelforge-web" },
});
