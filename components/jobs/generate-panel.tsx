"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

export type PublicJob = {
  id: string;
  operation: string;
  status: string;
  providerId: string;
  modelId: string;
  outputAssetIds: string[];
  errorCode: string | null;
  errorMessage: string | null;
  createdAt: string;
  finishedAt: string | null;
};

export function GeneratePanel({
  projectId,
  initialJobs,
  available,
  unavailableReason,
}: {
  projectId: string;
  initialJobs: PublicJob[];
  available: boolean;
  unavailableReason: string | null;
}) {
  const router = useRouter();
  const [prompt, setPrompt] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [polledJobs, setPolledJobs] = useState<PublicJob[] | null>(null);
  const jobs = (polledJobs ?? initialJobs).filter((job) => job.operation === "GENERATE");

  const active = jobs.some((job) => job.status === "queued" || job.status === "processing");
  useEffect(() => {
    if (!active) {
      return;
    }
    const timer = window.setInterval(() => {
      void fetch(`/api/jobs?projectId=${projectId}`)
        .then((response) => response.json())
        .then((body: { jobs?: PublicJob[] }) => {
          if (body.jobs) {
            setPolledJobs(body.jobs);
            if (body.jobs.some((job) => job.status === "succeeded")) {
              router.refresh();
            }
          }
        })
        .catch(() => undefined);
    }, 1500);
    return () => window.clearInterval(timer);
  }, [active, projectId, router]);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      const response = await fetch("/api/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ operation: "GENERATE", projectId, prompt }),
      });
      const body = (await response.json()) as PublicJob & { error?: { message: string } };
      if (!response.ok) {
        throw new Error(body.error?.message ?? "Could not start generation");
      }
      setPolledJobs([body, ...jobs.filter((job) => job.id !== body.id)]);
      toast.success("Generation queued");
      setPrompt("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not start generation");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="space-y-4">
      {available ? (
        <form onSubmit={onSubmit} className="space-y-3">
          <Label htmlFor="generate-prompt">Prompt</Label>
          <Textarea
            id="generate-prompt"
            rows={3}
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            placeholder="A product photo of a ceramic mug on slate, soft daylight"
          />
          <Button type="submit" disabled={pending || prompt.trim().length < 3}>
            {pending ? "Queueing…" : "Generate image"}
          </Button>
        </form>
      ) : (
        <Alert>
          <AlertTitle>Generation is not live</AlertTitle>
          <AlertDescription>
            {unavailableReason ?? "No image provider is configured. Conversion still works."}
          </AlertDescription>
        </Alert>
      )}
      {error ? (
        <Alert variant="destructive">
          <AlertTitle>Could not start the job</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      {jobs.length === 0 ? (
        <p className="text-sm text-muted-foreground">No generation jobs in this project yet.</p>
      ) : (
        <ul className="space-y-2">
          {jobs.map((job) => (
            <li key={job.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border px-3 py-2 text-sm">
              <span className="text-muted-foreground">{new Date(job.createdAt).toLocaleString()}</span>
              <Badge variant={job.status === "failed" ? "destructive" : "secondary"}>{job.status}</Badge>
              {job.errorMessage ? <span className="w-full text-destructive">{job.errorMessage}</span> : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
