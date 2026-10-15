import { z } from "zod";
import { ALLOWED_IMAGE_MIMES } from "@/lib/assets/mime";

export const uploadIntentSchema = z.object({
  projectId: z.string().uuid().optional(),
  filename: z.string().trim().min(1).max(180),
  mimeType: z.enum(ALLOWED_IMAGE_MIMES),
  byteSize: z.number().int().positive(),
});

export type UploadIntentInput = z.infer<typeof uploadIntentSchema>;
