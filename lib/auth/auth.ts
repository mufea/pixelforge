import "server-only";

import { prismaAdapter } from "@better-auth/prisma-adapter";
import { betterAuth } from "better-auth";
import { nextCookies } from "better-auth/next-js";
import { getEnv, isGoogleOAuthConfigured } from "@/lib/env";
import { prisma } from "@/lib/db";
import { sendAuthEmail } from "@/lib/email";

const env = getEnv();
const googleEnabled = isGoogleOAuthConfigured(env);

export const auth = betterAuth({
  appName: env.APP_NAME,
  baseURL: env.BETTER_AUTH_URL ?? env.APP_URL,
  secret: env.BETTER_AUTH_SECRET,
  database: prismaAdapter(prisma, { provider: "postgresql" }),
  emailAndPassword: {
    enabled: true,
    requireEmailVerification: env.NODE_ENV === "production",
    minPasswordLength: 10,
    sendResetPassword: async ({ user, url }) => {
      await sendAuthEmail({
        to: user.email,
        subject: "Reset your PixelForge AI password",
        url,
        kind: "reset",
      });
    },
  },
  emailVerification: {
    sendOnSignUp: true,
    autoSignInAfterVerification: true,
    sendVerificationEmail: async ({ user, url }) => {
      await sendAuthEmail({
        to: user.email,
        subject: "Verify your PixelForge AI email",
        url,
        kind: "verify",
      });
    },
  },
  socialProviders: googleEnabled
    ? {
        google: {
          clientId: env.GOOGLE_CLIENT_ID!,
          clientSecret: env.GOOGLE_CLIENT_SECRET!,
        },
      }
    : undefined,
  user: {
    additionalFields: {
      role: {
        type: "string",
        required: true,
        defaultValue: "user",
        input: false,
      },
    },
  },
  session: {
    expiresIn: 60 * 60 * 24 * 7,
    updateAge: 60 * 60 * 24,
    cookieCache: {
      enabled: true,
      maxAge: 60 * 5,
    },
  },
  trustedOrigins: [env.APP_URL],
  plugins: [nextCookies()],
  databaseHooks: {
    user: {
      create: {
        after: async (user) => {
          await prisma.userProfile.upsert({
            where: { userId: user.id },
            update: {},
            create: {
              userId: user.id,
              displayName: user.name,
            },
          });
          await prisma.creditAccount.upsert({
            where: { userId: user.id },
            update: {},
            create: {
              userId: user.id,
              availableCredits: 0,
              reservedCredits: 0,
              lifetimeGranted: 0,
              lifetimeConsumed: 0,
            },
          });
        },
      },
    },
  },
});

export type Auth = typeof auth;
