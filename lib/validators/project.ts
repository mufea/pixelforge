import { z } from "zod";

export const projectSchema = z.object({
  name: z.string().trim().min(2, "Name must be at least 2 characters").max(80),
  description: z.string().trim().max(500, "Description must be 500 characters or fewer"),
});

export type ProjectInput = z.infer<typeof projectSchema>;
