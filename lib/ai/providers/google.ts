import "server-only";

import { DomainError } from "@/lib/errors";
import type { ImageOperation } from "@/lib/ai/types";

/**
 * Google adapters are catalog stubs in Phase 4.5. They never open a network connection.
 */
export function googleUnimplemented(operation: ImageOperation): never {
  throw new DomainError(
    "MODEL_CAPABILITY_UNSUPPORTED",
    `Google ${operation} is not implemented`,
    400,
  );
}
