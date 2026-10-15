import { afterEach, describe, expect, it } from "vitest";
import { assertSameOrigin } from "@/lib/http/origin";
import { DomainError } from "@/lib/errors";
import { resetEnvCache } from "@/lib/env";

describe("same-origin guard", () => {
  afterEach(() => {
    resetEnvCache();
  });

  it("allows the configured application origin", () => {
    const request = new Request("http://127.0.0.1:43127/api/uploads/intents", {
      method: "POST",
      headers: { origin: "http://127.0.0.1:43127" },
    });
    expect(() => assertSameOrigin(request)).not.toThrow();
  });

  it("rejects a foreign origin", () => {
    const request = new Request("http://127.0.0.1:43127/api/uploads/intents", {
      method: "POST",
      headers: { origin: "https://evil.example" },
    });
    expect(() => assertSameOrigin(request)).toThrow(DomainError);
  });
});
