import { z } from "zod";
import { ALLOWED_IMAGE_MIMES } from "@/lib/assets/mime";

export const MAX_BATCH_ASSETS = 20;

const cropSchema = z.object({
  left: z.number().int(),
  top: z.number().int(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
});

export const convertAssetSchema = z.object({
  outputFormat: z.enum(ALLOWED_IMAGE_MIMES),
  quality: z.number().int().min(1).max(100).optional(),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
  crop: cropSchema.optional(),
});

export const batchConvertSchema = convertAssetSchema.extend({
  assetIds: z
    .array(z.string().uuid())
    .min(1, "Select at least one image")
    .max(MAX_BATCH_ASSETS, `A batch can include at most ${MAX_BATCH_ASSETS} images`),
});

export type ConvertAssetInput = z.infer<typeof convertAssetSchema>;
export type BatchConvertInput = z.infer<typeof batchConvertSchema>;
