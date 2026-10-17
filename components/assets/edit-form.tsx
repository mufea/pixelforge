"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { PublicJob } from "@/components/jobs/generate-panel";

export function EditForm({
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
  const [prompt, setPrompt] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!available) {
    return <p className="text-xs text-muted-foreground">{unavailableReason ?? "AI edit is not configured."}</p>;
  }

  async function onEdit() {
    setPending(true);
    setError(null);
    try {
      const response = await fetch("/api/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ operation: "EDIT", projectId, assetId, prompt }),
      });
      const body = (await response.json()) as PublicJob & { error?: { message: string } };
      if (!response.ok) {
        throw new Error(body.error?.message ?? "Could not start edit");
      }
      const finished = await pollJob(body.id);
      if (finished.status === "failed") {
        throw new Error(finished.errorMessage ?? "Edit failed");
      }
      toast.success("Edit saved. The original is unchanged.");
      setPrompt("");
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Edit failed");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="space-y-2">
      <Label htmlFor={`edit-${assetId}`}>AI edit</Label>
      <Textarea
        id={`edit-${assetId}`}
        value={prompt}
        disabled={pending}
        placeholder="Describe the change, for example: make the mug blue"
        onChange={(event) => setPrompt(event.target.value)}
      />
      <Button type="button" variant="outline" size="sm" disabled={pending || prompt.trim().length < 3} onClick={() => void onEdit()}>
        {pending ? "Editing…" : "Edit image"}
      </Button>
      {error ? (
        <Alert variant="destructive">
          <AlertTitle>Edit failed</AlertTitle>
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
  throw new Error("Edit is still running. Refresh to check status.");
}
