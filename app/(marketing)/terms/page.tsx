import type { Metadata } from "next";

export const metadata: Metadata = { title: "Terms of Service" };

export default function TermsPage() {
  return (
    <div className="mx-auto w-full max-w-3xl space-y-6 px-4 py-16">
      <h1 className="text-4xl font-semibold tracking-tight">Terms of Service</h1>
      <p className="text-muted-foreground">Last updated 14 October 2026. These terms apply to the PixelForge AI service.</p>
      <section className="space-y-3">
        <h2 className="text-xl font-semibold">Account</h2>
        <p>
          You must provide an accurate email address and keep credentials confidential. We may suspend accounts that abuse providers, bypass credit checks, or attempt to access another tenant&apos;s assets.
        </p>
      </section>
      <section className="space-y-3">
        <h2 className="text-xl font-semibold">Credits and payments</h2>
        <p>
          Credits are a prepaid meter for billable jobs. Unused reservations are released according to the published billing policy. Paid plans and packs are fulfilled only after a verified payment notification, not after a browser redirect.
        </p>
      </section>
      <section className="space-y-3">
        <h2 className="text-xl font-semibold">Content</h2>
        <p>
          You retain rights in prompts and uploads you own. Provider models may refuse unsafe content. We may retain job metadata required for billing and abuse prevention.
        </p>
      </section>
      <section className="space-y-3">
        <h2 className="text-xl font-semibold">Service changes</h2>
        <p>
          Model availability depends on third-party providers. Disabling a model in the admin registry is sufficient to stop new jobs for that model.
        </p>
      </section>
    </div>
  );
}
