import "server-only";

import { DomainError } from "@/lib/errors";
import type { ImageOperation } from "@/lib/ai/types";

/**
 * Fal adapters are catalog stubs in Phase 4.5. They never open a network connection.
 * Slice 4.2+ will replace these throws with real queue + download logic.
 */
export function falUnimplemented(operation: ImageOperation): never {
  throw new DomainError(
    "MODEL_CAPABILITY_UNSUPPORTED",
    `Fal ${operation} is not implemented`,
    400,
  );
}
