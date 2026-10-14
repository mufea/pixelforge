import { describe, expect, it } from "vitest";
import { safeInternalPath } from "@/lib/security/paths";

describe("safeInternalPath", () => {
  it("allows in-app relative paths", () => {
    expect(safeInternalPath("/app")).toBe("/app");
    expect(safeInternalPath("/admin")).toBe("/admin");
    expect(safeInternalPath("/app/settings")).toBe("/app/settings");
  });

  it("rejects absolute and protocol-relative URLs", () => {
    expect(safeInternalPath("https://evil.example")).toBe("/app");
    expect(safeInternalPath("//evil.example")).toBe("/app");
    expect(safeInternalPath("/\\evil.example")).toBe("/app");
    expect(safeInternalPath("http://127.0.0.1:43127/app")).toBe("/app");
  });

  it("falls back for empty values", () => {
    expect(safeInternalPath(null)).toBe("/app");
    expect(safeInternalPath("")).toBe("/app");
  });
});
