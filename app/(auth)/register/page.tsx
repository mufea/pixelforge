import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { RegisterForm } from "@/components/auth/register-form";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getCurrentSession } from "@/lib/auth/session";
import { isGoogleOAuthConfigured } from "@/lib/env";

export const metadata: Metadata = { title: "Create account" };

export default async function RegisterPage() {
  const session = await getCurrentSession();
  if (session?.user) {
    redirect("/app");
  }

  return (
    <Card className="w-full max-w-md">
      <CardHeader>
        <CardTitle>Create account</CardTitle>
        <CardDescription>Email verification is required in production. Development logs the link when no mailer is configured.</CardDescription>
      </CardHeader>
      <CardContent>
        <RegisterForm googleEnabled={isGoogleOAuthConfigured()} />
      </CardContent>
    </Card>
  );
}
