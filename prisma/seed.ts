import "dotenv/config";
import { hashPassword } from "better-auth/crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma/client";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("DATABASE_URL is required to seed");
}

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: databaseUrl }),
});

const plans = [
  {
    slug: "free",
    name: "Free",
    description: "Evaluate the workspace. Generation jobs are not unlimited.",
    interval: "none",
    priceAmount: 0,
    currency: "USD",
    creditsGranted: 50,
    featured: false,
    sortOrder: 10,
  },
  {
    slug: "starter",
    name: "Starter",
    description: "For solo marketers shipping regular product shots.",
    interval: "month",
    priceAmount: 1200,
    currency: "USD",
    creditsGranted: 400,
    featured: false,
    sortOrder: 20,
  },
  {
    slug: "pro",
    name: "Pro",
    description: "Higher volume generation and editing for growing teams.",
    interval: "month",
    priceAmount: 2900,
    currency: "USD",
    creditsGranted: 1200,
    featured: true,
    sortOrder: 30,
  },
  {
    slug: "business",
    name: "Business",
    description: "Highest seed grant with room for admin-set quotas later.",
    interval: "month",
    priceAmount: 7900,
    currency: "USD",
    creditsGranted: 4000,
    featured: false,
    sortOrder: 40,
  },
  {
    slug: "starter-year",
    name: "Starter yearly",
    description: "Starter billed annually (10 months priced).",
    interval: "year",
    priceAmount: 12000,
    currency: "USD",
    creditsGranted: 4800,
    featured: false,
    sortOrder: 21,
  },
  {
    slug: "pro-year",
    name: "Pro yearly",
    description: "Pro billed annually (10 months priced).",
    interval: "year",
    priceAmount: 29000,
    currency: "USD",
    creditsGranted: 14400,
    featured: false,
    sortOrder: 31,
  },
  {
    slug: "business-year",
    name: "Business yearly",
    description: "Business billed annually (10 months priced).",
    interval: "year",
    priceAmount: 79000,
    currency: "USD",
    creditsGranted: 48000,
    featured: false,
    sortOrder: 41,
  },
];

async function upsertUser(input: {
  email: string;
  name: string;
  role: "user" | "admin";
  password: string;
}) {
  const password = await hashPassword(input.password);
  const existing = await prisma.user.findUnique({ where: { email: input.email } });
  const user =
    existing ??
    (await prisma.user.create({
      data: {
        id: crypto.randomUUID(),
        email: input.email,
        name: input.name,
        role: input.role,
        emailVerified: true,
      },
    }));

  await prisma.user.update({
    where: { id: user.id },
    data: { role: input.role, name: input.name, emailVerified: true },
  });

  await prisma.userProfile.upsert({
    where: { userId: user.id },
    update: { displayName: input.name },
    create: { userId: user.id, displayName: input.name, locale: "en" },
  });

  await prisma.account.upsert({
    where: {
      providerId_accountId: {
        providerId: "credential",
        accountId: user.id,
      },
    },
    update: { password },
    create: {
      id: crypto.randomUUID(),
      accountId: user.id,
      providerId: "credential",
      userId: user.id,
      password,
    },
  });
}

async function main() {
  for (const plan of plans) {
    await prisma.plan.upsert({
      where: { slug: plan.slug },
      update: plan,
      create: plan,
    });
  }

  await prisma.systemSetting.upsert({
    where: { key: "registrationOpen" },
    update: { valueJson: true },
    create: { key: "registrationOpen", valueJson: true },
  });
  await prisma.systemSetting.upsert({
    where: { key: "aiJobsEnabled" },
    update: { valueJson: true },
    create: { key: "aiJobsEnabled", valueJson: true },
  });

  const adminPassword = process.env.SEED_ADMIN_PASSWORD ?? "DevAdmin!23456";
  const userPassword = process.env.SEED_USER_PASSWORD ?? "DevUser!23456";

  await upsertUser({
    email: "admin@pixelforge.local",
    name: "PixelForge Admin",
    role: "admin",
    password: adminPassword,
  });
  await upsertUser({
    email: "user@pixelforge.local",
    name: "PixelForge User",
    role: "user",
    password: userPassword,
  });

  console.log("Seed complete: plans, settings, admin@pixelforge.local, user@pixelforge.local");
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
