import type { Metadata } from "next";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getActivePlans } from "@/lib/data/plans";
import { formatMoney } from "@/lib/site";

export const metadata: Metadata = { title: "Pricing" };

export const dynamic = "force-dynamic";

export default async function PricingPage() {
  const plans = await getActivePlans();
  const monthly = plans.filter((plan) => plan.interval !== "year");
  const yearly = plans.filter((plan) => plan.interval === "year");

  if (plans.length === 0) {
    return (
      <div className="mx-auto w-full max-w-3xl px-4 py-16">
        <h1 className="text-4xl font-semibold">Pricing</h1>
        <p className="mt-4 text-muted-foreground">
          No active plans were found. Run the database seed and reload this page. Checkout is not live in this phase.
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-16">
      <h1 className="text-4xl font-semibold tracking-tight">Plans</h1>
      <p className="mt-3 max-w-2xl text-muted-foreground">
        Credit grants are configured in the database. Payments (Stripe and Midtrans Snap) are scheduled for the billing phase. Creating an account does not silently invent a paid subscription.
      </p>
      <div className="mt-10 grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {monthly.map((plan) => (
          <Card key={plan.id} className={plan.featured ? "border-primary" : undefined}>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle>{plan.name}</CardTitle>
                {plan.featured ? <Badge>Most used</Badge> : null}
              </div>
              <CardDescription>{plan.description}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-3xl font-semibold">
                {plan.priceAmount === 0 ? "Free" : `${formatMoney(plan.priceAmount, plan.currency)}/mo`}
              </p>
              <p className="text-sm text-muted-foreground">{plan.creditsGranted} credits each period</p>
              <Button asChild className="w-full">
                <Link href="/register">Create account</Link>
              </Button>
            </CardContent>
          </Card>
        ))}
      </div>
      {yearly.length > 0 ? (
        <div className="mt-16">
          <h2 className="text-2xl font-semibold">Yearly</h2>
          <div className="mt-6 grid gap-4 md:grid-cols-3">
            {yearly.map((plan) => (
              <Card key={plan.id}>
                <CardHeader>
                  <CardTitle>{plan.name}</CardTitle>
                  <CardDescription>{formatMoney(plan.priceAmount, plan.currency)} / year · {plan.creditsGranted} credits</CardDescription>
                </CardHeader>
              </Card>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
