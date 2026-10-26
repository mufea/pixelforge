import { z } from "zod";

export const UPSCALE_SCALE_FACTORS = [2, 3, 4] as const;
export type UpscaleScaleFactor = (typeof UPSCALE_SCALE_FACTORS)[number];

export function isUpscaleScaleFactor(value: unknown): value is UpscaleScaleFactor {
  return UPSCALE_SCALE_FACTORS.includes(value as UpscaleScaleFactor);
}

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

export const createUpscaleJobSchema = z.object({
  operation: z.literal("UPSCALE"),
  projectId: z.string().uuid(),
  assetId: z.string().uuid(),
  scaleFactor: z.union([z.literal(2), z.literal(3), z.literal(4)]),
});

export const createEditJobSchema = z.object({
  operation: z.literal("EDIT"),
  projectId: z.string().uuid(),
  assetId: z.string().uuid(),
  prompt: z.string().trim().min(3, "Prompt must be at least 3 characters").max(2000),
  maskAssetId: z.string().uuid().optional(),
});

export const createRemoveObjectJobSchema = z.object({
  operation: z.literal("REMOVE_OBJECT"),
  projectId: z.string().uuid(),
  assetId: z.string().uuid(),
  maskAssetId: z.string().uuid(),
});

export const createImageToImageJobSchema = z.object({
  operation: z.literal("IMAGE_TO_IMAGE"),
  projectId: z.string().uuid(),
  assetId: z.string().uuid(),
  prompt: z.string().trim().min(3, "Prompt must be at least 3 characters").max(2000),
  strength: z.number().gte(0.01).lte(1).optional(),
});

export type CreateGenerateJobInput = z.infer<typeof createGenerateJobSchema>;
export type CreateRemoveBackgroundJobInput = z.infer<typeof createRemoveBackgroundJobSchema>;
export type CreateUpscaleJobInput = z.infer<typeof createUpscaleJobSchema>;
export type CreateEditJobInput = z.infer<typeof createEditJobSchema>;
export type CreateRemoveObjectJobInput = z.infer<typeof createRemoveObjectJobSchema>;
export type CreateImageToImageJobInput = z.infer<typeof createImageToImageJobSchema>;
