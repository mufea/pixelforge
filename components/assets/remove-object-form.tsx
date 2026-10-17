"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { PublicJob } from "@/components/jobs/generate-panel";

export function RemoveObjectForm({
  projectId,
  assetId,
  width,
  height,
  previewUrl,
  available,
  unavailableReason,
}: {
  projectId: string;
  assetId: string;
  width: number;
  height: number;
  previewUrl: string | null;
  available: boolean;
  unavailableReason: string | null;
}) {
  const router = useRouter();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const drawing = useRef(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }
    const context = canvas.getContext("2d");
    if (!context) {
      return;
    }
    context.fillStyle = "#000000";
    context.fillRect(0, 0, canvas.width, canvas.height);
  }, [assetId, width, height]);

  if (!available) {
    return (
      <p className="text-xs text-muted-foreground">{unavailableReason ?? "Object removal is not configured."}</p>
    );
  }

  function paint(event: React.PointerEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context || !drawing.current) {
      return;
    }
    const rect = canvas.getBoundingClientRect();
    const x = ((event.clientX - rect.left) / rect.width) * canvas.width;
    const y = ((event.clientY - rect.top) / rect.height) * canvas.height;
    const radius = Math.max(2, Math.min(canvas.width, canvas.height) / 18);
    context.fillStyle = "#ffffff";
    context.beginPath();
    context.arc(x, y, radius, 0, Math.PI * 2);
    context.fill();
  }

  async function onRemove(maskFile?: File) {
    setPending(true);
    setError(null);
    try {
      const file = maskFile ?? (await canvasToMaskFile(canvasRef.current, `${assetId}-mask.png`));
      const maskAssetId = await uploadMask(projectId, file);
      const response = await fetch("/api/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ operation: "REMOVE_OBJECT", projectId, assetId, maskAssetId }),
      });
      const body = (await response.json()) as PublicJob & { error?: { message: string } };
      if (!response.ok) {
        throw new Error(body.error?.message ?? "Could not start object removal");
      }
      const finished = await pollJob(body.id);
      if (finished.status === "failed") {
        throw new Error(finished.errorMessage ?? "Object removal failed");
      }
      toast.success("Object removed. The original is unchanged.");
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Object removal failed");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="space-y-2">
      <Label>Remove object</Label>
      <p className="text-xs text-muted-foreground">
        Paint white over the area to erase, or upload a same-size black-and-white PNG mask. White pixels are removed.
      </p>
      {previewUrl ? (
        <div className="relative overflow-hidden rounded-md border bg-muted">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={previewUrl} alt="" className="block w-full" />
          <canvas
            ref={canvasRef}
            width={width}
            height={height}
            className="absolute inset-0 h-full w-full cursor-crosshair opacity-45"
            onPointerDown={(event) => {
              drawing.current = true;
              event.currentTarget.setPointerCapture(event.pointerId);
              paint(event);
            }}
            onPointerMove={paint}
            onPointerUp={() => {
              drawing.current = false;
            }}
            onPointerLeave={() => {
              drawing.current = false;
            }}
          />
        </div>
      ) : (
        <canvas ref={canvasRef} width={width} height={height} className="hidden" />
      )}
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" size="sm" disabled={pending} onClick={() => void onRemove()}>
          {pending ? "Removing…" : "Remove painted area"}
        </Button>
        <Input
          type="file"
          accept="image/png,.png"
          disabled={pending}
          className="max-w-56 text-xs"
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (file) {
              void onRemove(file);
            }
          }}
        />
      </div>
      {error ? (
        <Alert variant="destructive">
          <AlertTitle>Object removal failed</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
    </div>
  );
}

async function canvasToMaskFile(canvas: HTMLCanvasElement | null, filename: string) {
  if (!canvas) {
    throw new Error("Paint the area to remove, or upload a PNG mask");
  }
  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((value) => {
      if (value) {
        resolve(value);
      } else {
        reject(new Error("Could not read the painted mask"));
      }
    }, "image/png");
  });
  return new File([blob], filename, { type: "image/png" });
}

async function uploadMask(projectId: string, file: File) {
  const intentResponse = await fetch("/api/uploads/intents", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      projectId,
      filename: file.name,
      mimeType: "image/png",
      byteSize: file.size,
    }),
  });
  const intentBody = (await intentResponse.json()) as {
    intentId?: string;
    uploadUrl?: string;
    error?: { message: string };
  };
  if (!intentResponse.ok || !intentBody.intentId || !intentBody.uploadUrl) {
    throw new Error(intentBody.error?.message ?? "Could not create a mask upload");
  }
  const putResponse = await fetch(intentBody.uploadUrl, {
    method: "PUT",
    headers: { "Content-Type": "image/png" },
    body: file,
  });
  if (!putResponse.ok) {
    throw new Error("The mask could not be stored");
  }
  const completeResponse = await fetch(`/api/uploads/intents/${intentBody.intentId}/complete`, { method: "POST" });
  const completeBody = (await completeResponse.json()) as { id?: string; error?: { message: string } };
  if (!completeResponse.ok || !completeBody.id) {
    throw new Error(completeBody.error?.message ?? "The mask failed validation");
  }
  return completeBody.id;
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
  throw new Error("Object removal is still running. Refresh to check status.");
}
