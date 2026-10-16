"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import type { PublicJob } from "@/components/jobs/generate-panel";

export function RemoveBackgroundButton({
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
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!available) {
    return (
      <p className="text-xs text-muted-foreground">
        {unavailableReason ?? "Background removal is not configured."}
      </p>
    );
  }

  async function onRemove() {
    setPending(true);
    setError(null);
    try {
      const response = await fetch("/api/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ operation: "REMOVE_BACKGROUND", projectId, assetId }),
      });
      const body = (await response.json()) as PublicJob & { error?: { message: string } };
      if (!response.ok) {
        throw new Error(body.error?.message ?? "Could not start background removal");
      }
      const finished = await pollJob(body.id);
      if (finished.status === "failed") {
        throw new Error(finished.errorMessage ?? "Background removal failed");
      }
      toast.success("Background removed. The original is unchanged.");
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Background removal failed");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="space-y-2">
      <Button type="button" variant="outline" size="sm" disabled={pending} onClick={() => void onRemove()}>
        {pending ? "Removing background…" : "Remove background"}
      </Button>
      {error ? (
        <Alert variant="destructive">
          <AlertTitle>Background removal failed</AlertTitle>
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
  throw new Error("Background removal is still running. Refresh to check status.");
}
