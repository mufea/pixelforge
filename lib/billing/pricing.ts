import { DomainError } from "@/lib/errors";
import type { ImageOperation } from "@/lib/ai/types";
import { isUpscaleScaleFactor, type UpscaleScaleFactor } from "@/lib/validators/job";

export const BILLABLE_OPERATIONS = [
  "GENERATE",
  "EDIT",
  "REMOVE_BACKGROUND",
  "REMOVE_OBJECT",
  "UPSCALE",
] as const;

export type BillableOperation = (typeof BILLABLE_OPERATIONS)[number];

export const NON_BILLABLE_OPERATIONS = ["CONVERT", "RESIZE", "CROP"] as const;
export type NonBillableOperation = (typeof NON_BILLABLE_OPERATIONS)[number];

/**
 * Provisional Phase 4.6 defaults. Server-owned; never accept a client price.
 * Missing billable mappings throw rather than charging zero.
 */
const FLAT_CREDIT_COSTS: Record<Exclude<BillableOperation, "UPSCALE">, number> = {
  GENERATE: 10,
  EDIT: 10,
  REMOVE_BACKGROUND: 6,
  REMOVE_OBJECT: 6,
};

const UPSCALE_CREDIT_COSTS: Record<UpscaleScaleFactor, number> = {
  2: 8,
  3: 12,
  4: 16,
};

export type CreditCostInput = {
  operation: string;
  scaleFactor?: unknown;
};

export function isBillableOperation(operation: string): operation is BillableOperation {
  return (BILLABLE_OPERATIONS as readonly string[]).includes(operation);
}

export function isNonBillableOperation(operation: string): operation is NonBillableOperation {
  return (NON_BILLABLE_OPERATIONS as readonly string[]).includes(operation);
}

export function getCreditCost(input: CreditCostInput): number {
  const { operation } = input;
  if (isNonBillableOperation(operation)) {
    return 0;
  }
  if (operation === "UPSCALE") {
    if (!isUpscaleScaleFactor(input.scaleFactor)) {
      throw new DomainError(
        "UNSUPPORTED_UPSCALE_FACTOR",
        "Upscale factor must be 2, 3, or 4",
      );
    }
    const cost = UPSCALE_CREDIT_COSTS[input.scaleFactor];
    if (!Number.isInteger(cost) || cost <= 0) {
      throw new DomainError(
        "UNSUPPORTED_BILLABLE_CONFIGURATION",
        "No credit price is configured for this upscale factor",
      );
    }
    return cost;
  }
  if (operation === "GENERATE" || operation === "EDIT" || operation === "REMOVE_BACKGROUND" || operation === "REMOVE_OBJECT") {
    const cost = FLAT_CREDIT_COSTS[operation];
    if (!Number.isInteger(cost) || cost <= 0) {
      throw new DomainError(
        "UNSUPPORTED_BILLABLE_CONFIGURATION",
        `No credit price is configured for ${operation}`,
      );
    }
    return cost;
  }
  if ((BILLABLE_OPERATIONS as readonly string[]).includes(operation) || isImageOperationName(operation)) {
    throw new DomainError(
      "UNSUPPORTED_BILLABLE_CONFIGURATION",
      `No credit price is configured for ${operation}`,
    );
  }
  throw new DomainError("UNSUPPORTED_BILLABLE_CONFIGURATION", `Unsupported billable operation ${operation}`);
}

function isImageOperationName(operation: string): operation is ImageOperation {
  return (
    operation === "GENERATE" ||
    operation === "EDIT" ||
    operation === "REMOVE_BACKGROUND" ||
    operation === "REMOVE_OBJECT" ||
    operation === "UPSCALE"
  );
}
