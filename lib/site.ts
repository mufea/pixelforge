export const site = {
  name: "PixelForge AI",
  tagline: "Production image studio for teams that cannot ship guesses.",
  description:
    "Generate, edit, enhance, and convert product and marketing images with credit-metered jobs, private storage, and an admin-controlled model registry.",
};

export const publicNav = [
  { href: "/features", label: "Features" },
  { href: "/tools", label: "Tools" },
  { href: "/pricing", label: "Pricing" },
  { href: "/gallery", label: "Gallery" },
  { href: "/faq", label: "FAQ" },
] as const;

export const toolsCatalog = [
  {
    slug: "generator",
    name: "Image generator",
    summary: "Text-to-image and reference-driven generation with registry-backed models.",
    status: "Phase 4",
  },
  {
    slug: "editor",
    name: "AI editor",
    summary: "Natural-language edits, inpainting, and before/after versions.",
    status: "Phase 4",
  },
  {
    slug: "background-remover",
    name: "Background remover",
    summary: "Transparent PNG output with the original file preserved.",
    status: "Phase 4",
  },
  {
    slug: "upscaler",
    name: "Upscaler",
    summary: "Resolution increase with dimension and file-size validation.",
    status: "Phase 4",
  },
  {
    slug: "object-remover",
    name: "Object remover",
    summary: "Mask-based removal when the selected model supports it.",
    status: "Phase 4",
  },
  {
    slug: "product-studio",
    name: "Product photography",
    summary: "Studio, lifestyle, and e-commerce scenes around a product photo.",
    status: "Phase 4",
  },
  {
    slug: "marketing-studio",
    name: "Marketing studio",
    summary: "Platform aspect ratios plus deterministic text overlays.",
    status: "Phase 4",
  },
  {
    slug: "converter",
    name: "Converter",
    summary: "PNG, JPEG, WebP, and AVIF conversion, crop, and compression.",
    status: "Phase 3",
  },
] as const;

export const faqs = [
  {
    question: "Are generations faked when no API key is configured?",
    answer:
      "No. Live mode reports a provider-not-configured error. Mock providers run only in automated tests or when AI_PROVIDER_MODE=mock is set in development.",
  },
  {
    question: "When are credits charged?",
    answer:
      "Credits are reserved before a job starts and settled only if the job succeeds. Failures and eligible cancellations release the reservation. Browser payment redirects never grant credits.",
  },
  {
    question: "Can I use Google sign-in?",
    answer:
      "Yes, when an administrator configures Google OAuth client credentials. If those values are missing, the Google button is hidden rather than failing at runtime.",
  },
  {
    question: "Where are my files stored?",
    answer:
      "Uploads and outputs are private by default in S3-compatible storage. Access uses short-lived signed URLs after an ownership check. That pipeline ships in Phase 2.",
  },
  {
    question: "Which AI providers are supported?",
    answer:
      "OpenAI image models, Google Gemini image models, and Fal AI endpoints, selected through a server-side registry. Unsupported operations return a capability error instead of a silent fallback.",
  },
  {
    question: "Is there a public API?",
    answer:
      "The domain layer is designed so a versioned API can be added without duplicating credit or job logic. API keys are intentionally deferred until the studio job workflow is stable.",
  },
];

export function formatMoney(amount: number, currency: string) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    minimumFractionDigits: amount % 100 === 0 ? 0 : 2,
  }).format(amount / 100);
}
