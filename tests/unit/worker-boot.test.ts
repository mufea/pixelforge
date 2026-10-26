import { spawnSync } from "node:child_process";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { shouldReleaseCreditsForFailure } from "@/lib/jobs/credits";

describe("worker boot shim", () => {
  it("makes server-only a no-op for the Node worker process", () => {
    const result = spawnSync(
      process.execPath,
      [
        "--require",
        path.join(process.cwd(), "worker/register-server-only.cjs"),
        "-e",
        "require('server-only'); process.stdout.write('ok')",
      ],
      { encoding: "utf8" },
    );
    expect(result.status).toBe(0);
    expect(result.stdout).toBe("ok");
    expect(result.stderr).not.toMatch(/FAL_KEY|STABILITY_API_KEY|BETTER_AUTH_SECRET|postgresql:\/\//);
  });

  it("keeps the credit hold for storage failures", () => {
    expect(shouldReleaseCreditsForFailure("STORAGE_UNAVAILABLE")).toBe(false);
    expect(shouldReleaseCreditsForFailure("STORAGE_NOT_CONFIGURED")).toBe(false);
    expect(shouldReleaseCreditsForFailure("TIMEOUT")).toBe(false);
    expect(shouldReleaseCreditsForFailure("VALIDATION")).toBe(true);
  });
});
