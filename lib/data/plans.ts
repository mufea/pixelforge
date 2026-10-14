import "server-only";

import { prisma } from "@/lib/db";

export async function getActivePlans() {
  return prisma.plan.findMany({
    where: { active: true },
    orderBy: { sortOrder: "asc" },
  });
}
