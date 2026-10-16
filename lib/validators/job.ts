import { z } from "zod";

export const createGenerateJobSchema = z.object({
  operation: z.literal("GENERATE"),
  projectId: z.string().uuid(),
  prompt: z.string().trim().min(3, "Prompt must be at least 3 characters").max(2000),
});

export const createRemoveBackgroundJobSchema = z.object({
  operation: z.literal("REMOVE_BACKGROUND"),
  projectId: z.string().uuid(),
  assetId: z.string().uuid(),
});

export type CreateGenerateJobInput = z.infer<typeof createGenerateJobSchema>;
export type CreateRemoveBackgroundJobInput = z.infer<typeof createRemoveBackgroundJobSchema>;
