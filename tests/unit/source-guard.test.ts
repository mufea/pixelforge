import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(__dirname, "../..");
const SKIP = new Set(["node_modules", ".next", "generated", "coverage", "agent-tools"]);

function walk(dir: string): string[] {
  const entries = readdirSync(dir);
  const files: string[] = [];
  for (const entry of entries) {
    if (SKIP.has(entry)) continue;
    const full = path.join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      files.push(...walk(full));
    } else if (/\.(ts|tsx|js|mjs)$/.test(entry)) {
      files.push(full);
    }
  }
  return files;
}

describe("source guards", () => {
  const files = walk(ROOT);

  it("does not expose provider secrets through NEXT_PUBLIC_ variables", () => {
    const secretPublic = files.flatMap((file) => {
      const text = readFileSync(file, "utf8");
      const matches = text.match(/NEXT_PUBLIC_[A-Z0-9_]+/g) ?? [];
      return matches
        .filter((name) => /SECRET|API_KEY|PRIVATE|PASSWORD|TOKEN|FAL_KEY|MIDTRANS_SERVER/i.test(name))
        .map((name) => `${path.relative(ROOT, file)}:${name}`);
    });
    expect(secretPublic).toEqual([]);
  });

  it("keeps env parsing off client components", () => {
    const violations = files
      .filter((file) => file.includes(`${path.sep}components${path.sep}`))
      .filter((file) => {
        const text = readFileSync(file, "utf8");
        return text.includes("@/lib/env") || text.includes("from \"@/lib/db\"");
      })
      .map((file) => path.relative(ROOT, file));
    expect(violations).toEqual([]);
  });
});
