import { z } from "zod";
import { ALLOWED_IMAGE_MIMES } from "@/lib/assets/mime";

export const convertAssetSchema = z.object({
  outputFormat: z.enum(ALLOWED_IMAGE_MIMES),
  quality: z.number().int().min(1).max(100).optional(),
});

export type ConvertAssetInput = z.infer<typeof convertAssetSchema>;
