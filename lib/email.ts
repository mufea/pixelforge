import { getEnv } from "@/lib/env";
import { logger } from "@/lib/logging";

type AuthEmailKind = "verify" | "reset";

export async function sendAuthEmail(input: {
  to: string;
  subject: string;
  url: string;
  kind: AuthEmailKind;
}) {
  const env = getEnv();
  const html = `
    <p>${input.kind === "verify" ? "Confirm your PixelForge AI account." : "Reset your PixelForge AI password."}</p>
    <p><a href="${input.url}">${input.kind === "verify" ? "Verify email" : "Choose a new password"}</a></p>
    <p>If you did not request this, you can ignore this email.</p>
  `;

  if (env.RESEND_API_KEY) {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: env.EMAIL_FROM,
        to: [input.to],
        subject: input.subject,
        html,
      }),
    });
    if (!response.ok) {
      throw new Error(`Resend rejected the message (${response.status})`);
    }
    return;
  }

  if (env.SMTP_HOST) {
    const nodemailer = await import("nodemailer");
    const transporter = nodemailer.createTransport({
      host: env.SMTP_HOST,
      port: Number(env.SMTP_PORT ?? "587"),
      secure: env.SMTP_PORT === "465",
      auth:
        env.SMTP_USER && env.SMTP_PASS
          ? { user: env.SMTP_USER, pass: env.SMTP_PASS }
          : undefined,
    });
    await transporter.sendMail({
      from: env.EMAIL_FROM,
      to: input.to,
      subject: input.subject,
      html,
    });
    return;
  }

  if (env.NODE_ENV === "production") {
    throw new Error("Email delivery is not configured");
  }

  logger.info(
    { to: input.to, kind: input.kind, url: input.url },
    "Auth email logged because no email provider is configured",
  );
}
