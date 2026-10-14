import type { Metadata } from "next";

export const metadata: Metadata = { title: "Privacy Policy" };

export default function PrivacyPage() {
  return (
    <div className="mx-auto w-full max-w-3xl space-y-6 px-4 py-16">
      <h1 className="text-4xl font-semibold tracking-tight">Privacy Policy</h1>
      <p className="text-muted-foreground">Last updated 14 October 2026.</p>
      <section className="space-y-3">
        <h2 className="text-xl font-semibold">Data we store</h2>
        <p>
          Account identity, session metadata, project and asset records, job input metadata, credit ledger entries, and optional profile fields. Image bytes live in private object storage, not in Redis.
        </p>
      </section>
      <section className="space-y-3">
        <h2 className="text-xl font-semibold">Processors</h2>
        <p>
          Depending on configuration: PostgreSQL host, Redis host, S3-compatible storage, email delivery, Google OAuth, OpenAI, Google Gemini, Fal AI, Stripe, and Midtrans. Keys for those services never ship to the browser.
        </p>
      </section>
      <section className="space-y-3">
        <h2 className="text-xl font-semibold">Retention and deletion</h2>
        <p>
          You can request a data export and account deletion. Financial ledger rows may be retained in anonymized form where required. Uploaded assets follow the configured retention window once that job exists.
        </p>
      </section>
      <section className="space-y-3">
        <h2 className="text-xl font-semibold">Cookies</h2>
        <p>
          Authentication uses HTTP-only session cookies. We do not use third-party advertising cookies in this application.
        </p>
      </section>
    </div>
  );
}
