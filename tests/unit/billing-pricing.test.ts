import { describe, expect, it } from "vitest";
import { getCreditCost, isBillableOperation, isNonBillableOperation } from "@/lib/billing/pricing";

describe("credit pricing", () => {
  it("returns the provisional costs for every billable operation and upscale factor", () => {
    expect(getCreditCost({ operation: "GENERATE" })).toBe(10);
    expect(getCreditCost({ operation: "EDIT" })).toBe(10);
    expect(getCreditCost({ operation: "IMAGE_TO_IMAGE" })).toBe(10);
    expect(getCreditCost({ operation: "REMOVE_BACKGROUND" })).toBe(6);
    expect(getCreditCost({ operation: "REMOVE_OBJECT" })).toBe(6);
    expect(getCreditCost({ operation: "UPSCALE", scaleFactor: 2 })).toBe(8);
    expect(getCreditCost({ operation: "UPSCALE", scaleFactor: 3 })).toBe(12);
    expect(getCreditCost({ operation: "UPSCALE", scaleFactor: 4 })).toBe(16);
  });

  it("returns zero only for explicitly non-billable local operations", () => {
    expect(isNonBillableOperation("CONVERT")).toBe(true);
    expect(isNonBillableOperation("RESIZE")).toBe(true);
    expect(isNonBillableOperation("CROP")).toBe(true);
    expect(getCreditCost({ operation: "CONVERT" })).toBe(0);
    expect(getCreditCost({ operation: "RESIZE" })).toBe(0);
    expect(getCreditCost({ operation: "CROP" })).toBe(0);
  });

  it("rejects unsupported billable configurations instead of charging zero", () => {
    expect(isBillableOperation("GENERATE")).toBe(true);
    expect(() => getCreditCost({ operation: "UPSCALE" })).toThrow(/2, 3, or 4/);
    expect(() => getCreditCost({ operation: "UPSCALE", scaleFactor: 1 })).toThrow(/2, 3, or 4/);
    expect(() => getCreditCost({ operation: "UPSCALE", scaleFactor: 5 })).toThrow(/2, 3, or 4/);
    try {
      getCreditCost({ operation: "PRODUCT_STUDIO" });
      throw new Error("expected pricing to reject PRODUCT_STUDIO");
    } catch (error) {
      expect(error).toMatchObject({ code: "UNSUPPORTED_BILLABLE_CONFIGURATION" });
    }
    try {
      getCreditCost({ operation: "GENERATE_EXTRA" });
      throw new Error("expected pricing to reject unknown operations");
    } catch (error) {
      expect(error).toMatchObject({ code: "UNSUPPORTED_BILLABLE_CONFIGURATION" });
    }
  });
});
