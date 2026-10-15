import { describe, expect, it } from "vitest";
import { assetObjectKey, containsOriginalFilename, uploadObjectKey } from "@/lib/storage/keys";

describe("storage keys", () => {
  it("never uses the original filename as the object key", () => {
    const key = uploadObjectKey("user-1", "intent-1");
    expect(key).toBe("users/user-1/uploads/intent-1");
    expect(containsOriginalFilename(key, "Holiday Shot.PNG")).toBe(false);
    expect(containsOriginalFilename(assetObjectKey("user-1", "asset-1", 1), "Holiday Shot.PNG")).toBe(false);
  });

  it("does not false-positive when the filename appears in the user id prefix", () => {
    expect(containsOriginalFilename("users/holiday/uploads/abc", "holiday")).toBe(false);
  });
});
