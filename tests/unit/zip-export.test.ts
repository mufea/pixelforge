import { describe, expect, it } from "vitest";
import { archiveEntryName } from "@/lib/export/project-zip";

describe("ZIP archive entry names", () => {
  it("strips path traversal and prefixes a stable asset id", () => {
    const used = new Set<string>();
    expect(archiveEntryName("abcdef12-3333-4444-8555-666677778888", "../../etc/passwd", used)).toBe(
      "abcdef12-passwd",
    );
    expect(archiveEntryName("abcdef12-3333-4444-8555-666677778888", "ok.png", used)).toBe("abcdef12-ok.png");
    expect(archiveEntryName("abcdef12-3333-4444-8555-666677778888", "ok.png", used)).toBe("abcdef12-2-ok.png");
    expect(archiveEntryName("abcdef12-3333-4444-8555-666677778888", "C:\\\\Windows\\\\photo.png", used)).toBe(
      "abcdef12-photo.png",
    );
    for (const name of used) {
      expect(name.includes("..")).toBe(false);
      expect(name.includes("/")).toBe(false);
      expect(name.includes("\\")).toBe(false);
    }
  });
});
