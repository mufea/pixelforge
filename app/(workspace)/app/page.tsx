import type { Metadata } from "next";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getCurrentSession } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { toolsCatalog } from "@/lib/site";

export const metadata: Metadata = { title: "Workspace" };

export default async function DashboardPage() {
  const session = await getCurrentSession();
  if (!session?.user) {
    return null;
  }

  const profile = await prisma.userProfile.findUnique({
    where: { userId: session.user.id },
  });

  return (
    <div className="mx-auto w-full max-w-5xl space-y-8">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight">
          {profile?.displayName ? `Welcome, ${profile.displayName}` : "Workspace"}
        </h1>
        <p className="mt-2 text-muted-foreground">
          Account, session, and plan configuration are live. Projects, uploads, and AI jobs are not claimed as working yet.
        </p>
      </div>
      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle>Email</CardTitle>
            <CardDescription>{session.user.email}</CardDescription>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Verification</CardTitle>
            <CardDescription>
              {session.user.emailVerified ? (
                <Badge>Verified</Badge>
              ) : (
                <span>Unverified — production jobs will require a confirmed email.</span>
              )}
            </CardDescription>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Role</CardTitle>
            <CardDescription className="capitalize">{session.user.role}</CardDescription>
          </CardHeader>
        </Card>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Projects</CardTitle>
          <CardDescription>
            No project library yet. Secure uploads and ownership checks are the next phase. Your account is ready to attach them.
          </CardDescription>
        </CardHeader>
      </Card>
      <div>
        <h2 className="text-xl font-semibold">Upcoming tools</h2>
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          {toolsCatalog.map((tool) => (
            <Card key={tool.slug}>
              <CardHeader>
                <CardTitle className="text-base">{tool.name}</CardTitle>
                <CardDescription>
                  {tool.summary} <Badge variant="secondary">{tool.status}</Badge>
                </CardDescription>
              </CardHeader>
            </Card>
          ))}
        </div>
      </div>
      <p className="text-sm text-muted-foreground">
        Update your display name in <Link href="/app/settings" className="underline-offset-4 hover:underline">settings</Link>.
      </p>
    </div>
  );
}
