import Link from "next/link";
import { ArrowRight, Lock, Layers, Wallet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getActivePlans } from "@/lib/data/plans";
import { formatMoney, site, toolsCatalog } from "@/lib/site";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const plans = await getActivePlans();

  return (
    <div>
      <section className="border-b bg-[radial-gradient(circle_at_top,_oklch(0.35_0.08_255_/_0.35),_transparent_55%)]">
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-8 px-4 py-20 md:py-28">
          <p className="text-sm font-medium uppercase tracking-[0.2em] text-primary">AI image operations</p>
          <h1 className="max-w-3xl text-4xl font-semibold tracking-tight md:text-6xl">{site.tagline}</h1>
          <p className="max-w-2xl text-lg text-muted-foreground">{site.description}</p>
          <div className="flex flex-col gap-3 sm:flex-row">
            <Button asChild size="lg">
              <Link href="/register">
                Start on the free plan <ArrowRight className="size-4" />
              </Link>
            </Button>
            <Button asChild size="lg" variant="outline">
              <Link href="/tools">Browse tools</Link>
            </Button>
          </div>
        </div>
      </section>

      <section className="mx-auto grid w-full max-w-6xl gap-6 px-4 py-16 md:grid-cols-3">
        {[
          {
            icon: Layers,
            title: "One job model",
            body: "Generation, edits, and conversion share the same queued lifecycle and ownership rules.",
          },
          {
            icon: Wallet,
            title: "Credits with a ledger",
            body: "Jobs reserve credits first. Success settles. Failure releases. Redirects never grant balance.",
          },
          {
            icon: Lock,
            title: "Private by default",
            body: "Uploads stay off the public internet. Signed URLs are short-lived and ownership-checked.",
          },
        ].map((item) => (
          <Card key={item.title}>
            <CardHeader>
              <item.icon className="size-5 text-primary" />
              <CardTitle>{item.title}</CardTitle>
              <CardDescription>{item.body}</CardDescription>
            </CardHeader>
          </Card>
        ))}
      </section>

      <section className="border-y bg-card/40">
        <div className="mx-auto w-full max-w-6xl px-4 py-16">
          <h2 className="text-2xl font-semibold">Studio tools</h2>
          <p className="mt-2 max-w-2xl text-muted-foreground">
            Each tool is a module behind a provider interface. If a model cannot inpaint or remove objects, the UI says so.
          </p>
          <div className="mt-8 grid gap-4 md:grid-cols-2">
            {toolsCatalog.slice(0, 6).map((tool) => (
              <Card key={tool.slug}>
                <CardHeader>
                  <CardTitle className="text-lg">{tool.name}</CardTitle>
                  <CardDescription>{tool.summary}</CardDescription>
                </CardHeader>
              </Card>
            ))}
          </div>
          <Button asChild className="mt-8" variant="outline">
            <Link href="/tools">Full directory</Link>
          </Button>
        </div>
      </section>

      <section className="mx-auto w-full max-w-6xl px-4 py-16">
        <h2 className="text-2xl font-semibold">Pricing that maps to jobs</h2>
        <p className="mt-2 max-w-2xl text-muted-foreground">
          Plans are stored in PostgreSQL and can be edited by administrators. Amounts below are seed defaults, not live Stripe/Midtrans products yet.
        </p>
        <div className="mt-8 grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          {plans.length === 0 ? (
            <Card>
              <CardHeader>
                <CardTitle>Plans unavailable</CardTitle>
                <CardDescription>The database did not return active plans. Seed the database and retry.</CardDescription>
              </CardHeader>
            </Card>
          ) : (
            plans
              .filter((plan) => plan.interval !== "year")
              .map((plan) => (
                <Card key={plan.id} className={plan.featured ? "border-primary" : undefined}>
                  <CardHeader>
                    <CardTitle>{plan.name}</CardTitle>
                    <CardDescription>{plan.description}</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <p className="text-3xl font-semibold">
                      {plan.priceAmount === 0 ? "Free" : formatMoney(plan.priceAmount, plan.currency)}
                    </p>
                    <p className="mt-2 text-sm text-muted-foreground">{plan.creditsGranted} credits / period</p>
                  </CardContent>
                </Card>
              ))
          )}
        </div>
      </section>
    </div>
  );
}
