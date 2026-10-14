import type { Metadata } from "next";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { prisma } from "@/lib/db";

export const metadata: Metadata = { title: "Admin" };

export default async function AdminPage() {
  const [users, verified, plans, settings] = await Promise.all([
    prisma.user.count(),
    prisma.user.count({ where: { emailVerified: true } }),
    prisma.plan.count({ where: { active: true } }),
    prisma.systemSetting.findMany({ orderBy: { key: "asc" } }),
  ]);

  return (
    <div className="mx-auto w-full max-w-5xl space-y-8">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight">Admin overview</h1>
        <p className="mt-2 text-muted-foreground">
          Live counts from PostgreSQL. Job monitoring, credit adjustments, and provider health arrive in later phases.
        </p>
      </div>
      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle>{users}</CardTitle>
            <CardDescription>Registered users</CardDescription>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>{verified}</CardTitle>
            <CardDescription>Verified emails</CardDescription>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>{plans}</CardTitle>
            <CardDescription>Active plans</CardDescription>
          </CardHeader>
        </Card>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>System settings</CardTitle>
          <CardDescription>
            {settings.length === 0
              ? "No settings rows. Seed the database."
              : settings.map((setting) => `${setting.key}=${JSON.stringify(setting.valueJson)}`).join(" · ")}
          </CardDescription>
        </CardHeader>
      </Card>
    </div>
  );
}
