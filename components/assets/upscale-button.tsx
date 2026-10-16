"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import type { PublicJob } from "@/components/jobs/generate-panel";
import { UPSCALE_SCALE_FACTORS, type UpscaleScaleFactor } from "@/lib/validators/job";

export function UpscaleButton({
  projectId,
  assetId,
  available,
  unavailableReason,
}: {
  projectId: string;
  assetId: string;
  available: boolean;
  unavailableReason: string | null;
}) {
  const router = useRouter();
  const [scaleFactor, setScaleFactor] = useState<UpscaleScaleFactor>(2);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!available) {
    return (
      <p className="text-xs text-muted-foreground">{unavailableReason ?? "AI upscale is not configured."}</p>
    );
  }

  async function onUpscale() {
    setPending(true);
    setError(null);
    try {
      const response = await fetch("/api/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ operation: "UPSCALE", projectId, assetId, scaleFactor }),
      });
      const body = (await response.json()) as PublicJob & { error?: { message: string } };
      if (!response.ok) {
        throw new Error(body.error?.message ?? "Could not start upscale");
      }
      const finished = await pollJob(body.id);
      if (finished.status === "failed") {
        throw new Error(finished.errorMessage ?? "Upscale failed");
      }
      toast.success(`Upscaled ${scaleFactor}×. The original is unchanged.`);
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Upscale failed");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="space-y-2">
      <Label htmlFor={`upscale-${assetId}`}>AI upscale</Label>
      <div className="flex flex-wrap gap-2">
        <select
          id={`upscale-${assetId}`}
          className="h-8 rounded-md border border-input bg-background px-2 text-sm"
          value={scaleFactor}
          disabled={pending}
          onChange={(event) => setScaleFactor(Number(event.target.value) as UpscaleScaleFactor)}
        >
          {UPSCALE_SCALE_FACTORS.map((factor) => (
            <option key={factor} value={factor}>
              {factor}×
            </option>
          ))}
        </select>
        <Button type="button" variant="outline" size="sm" disabled={pending} onClick={() => void onUpscale()}>
          {pending ? "Upscaling…" : "Upscale"}
        </Button>
      </div>
      {error ? (
        <Alert variant="destructive">
          <AlertTitle>Upscale failed</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
    </div>
  );
}

async function pollJob(jobId: string): Promise<PublicJob> {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const response = await fetch(`/api/jobs/${jobId}`);
    const body = (await response.json()) as PublicJob & { error?: { message: string } };
    if (!response.ok) {
      throw new Error(body.error?.message ?? "Could not read job status");
    }
    if (body.status === "succeeded" || body.status === "failed" || body.status === "cancelled") {
      return body;
    }
    await new Promise((resolve) => window.setTimeout(resolve, 500));
  }
  throw new Error("Upscale is still running. Refresh to check status.");
}
