import type { Metadata } from "next";
import { ProfileForm } from "@/components/profile/profile-form";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getCurrentSession } from "@/lib/auth/session";
import { prisma } from "@/lib/db";

export const metadata: Metadata = { title: "Settings" };

export default async function SettingsPage() {
  const session = await getCurrentSession();
  if (!session?.user) {
    return null;
  }

  const profile = await prisma.userProfile.findUnique({
    where: { userId: session.user.id },
  });

  return (
    <div className="mx-auto w-full max-w-2xl space-y-6">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight">Profile</h1>
        <p className="mt-2 text-muted-foreground">These fields belong to your account. Role and credit balance cannot be edited here.</p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Identity</CardTitle>
          <CardDescription>{session.user.email}</CardDescription>
        </CardHeader>
        <CardContent>
          <ProfileForm
            defaultValues={{
              displayName: profile?.displayName ?? session.user.name,
              locale: profile?.locale === "id" ? "id" : "en",
              timezone: profile?.timezone ?? "",
            }}
          />
        </CardContent>
      </Card>
    </div>
  );
}
