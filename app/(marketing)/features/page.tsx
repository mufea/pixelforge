import type { Metadata } from "next";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export const metadata: Metadata = { title: "Features" };

const features = [
  {
    title: "Multi-provider generation",
    body: "OpenAI, Gemini, and Fal adapters sit behind one interface. The registry decides what each model can do.",
  },
  {
    title: "Asynchronous jobs",
    body: "Long work runs in a BullMQ worker: queued, processing, succeeded, failed, or cancelled.",
  },
  {
    title: "Credit ledger",
    body: "Available, reserved, and consumed balances are first-class. Ordinary users cannot edit their own balance.",
  },
  {
    title: "Private asset library",
    body: "Server-generated storage keys, file-signature checks, and tenant isolation on every download.",
  },
  {
    title: "Admin cost controls",
    body: "Disable a provider, set budgets, and inspect jobs without shipping a frontend change.",
  },
  {
    title: "Audit trail",
    body: "Privileged actions write append-only audit logs. Payment webhooks are verified and idempotent.",
  },
];

export default function FeaturesPage() {
  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-16">
      <h1 className="text-4xl font-semibold tracking-tight">Built as operations software</h1>
      <p className="mt-3 max-w-2xl text-muted-foreground">
        PixelForge AI is a credit-metered image platform, not a prompt toy. The foundation in this release is identity, plans, and the workspace shell.
      </p>
      <div className="mt-10 grid gap-4 md:grid-cols-2">
        {features.map((feature) => (
          <Card key={feature.title}>
            <CardHeader>
              <CardTitle>{feature.title}</CardTitle>
              <CardDescription>{feature.body}</CardDescription>
            </CardHeader>
          </Card>
        ))}
      </div>
    </div>
  );
}
