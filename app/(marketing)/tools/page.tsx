import type { Metadata } from "next";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { toolsCatalog } from "@/lib/site";

export const metadata: Metadata = { title: "Tools" };

export default function ToolsPage() {
  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-16">
      <h1 className="text-4xl font-semibold tracking-tight">Tool directory</h1>
      <p className="mt-3 max-w-2xl text-muted-foreground">
        Tools become interactive as their phases land. Status labels match the implementation plan, not a fake ready state.
      </p>
      <div className="mt-10 grid gap-4 md:grid-cols-2">
        {toolsCatalog.map((tool) => (
          <Card key={tool.slug}>
            <CardHeader>
              <div className="flex items-center justify-between gap-3">
                <CardTitle>{tool.name}</CardTitle>
                <Badge variant="secondary">{tool.status}</Badge>
              </div>
              <CardDescription>{tool.summary}</CardDescription>
            </CardHeader>
          </Card>
        ))}
      </div>
      <p className="mt-8 text-sm text-muted-foreground">
        Need an account first? <Link href="/register" className="underline-offset-4 hover:underline">Register</Link>
      </p>
    </div>
  );
}
