import { z } from "zod";

export const profileSchema = z.object({
  displayName: z.string().trim().min(2, "Display name is required").max(80),
  locale: z.enum(["en", "id"]),
  timezone: z.string().trim().max(64).optional(),
});

export type ProfileInput = z.infer<typeof profileSchema>;
