"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

function declaredImageMime(file: File) {
  if (file.type === "image/jpeg" || file.type === "image/png" || file.type === "image/webp") {
    return file.type;
  }
  const name = file.name.toLowerCase();
  if (name.endsWith(".png")) return "image/png";
  if (name.endsWith(".jpg") || name.endsWith(".jpeg")) return "image/jpeg";
  if (name.endsWith(".webp")) return "image/webp";
  return null;
}

type UploadState =
  | { status: "idle" }
  | { status: "uploading"; filename: string }
  | { status: "error"; message: string; filename: string };

export function AssetUploader({ projectId }: { projectId: string }) {
  const router = useRouter();
  const [state, setState] = useState<UploadState>({ status: "idle" });

  async function uploadFile(file: File) {
    const mimeType = declaredImageMime(file);
    if (!mimeType) {
      setState({
        status: "error",
        filename: file.name,
        message: "Only JPEG, PNG, and WebP images can be uploaded.",
      });
      return;
    }
    setState({ status: "uploading", filename: file.name });
    try {
      const intentResponse = await fetch("/api/uploads/intents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId,
          filename: file.name,
          mimeType,
          byteSize: file.size,
        }),
      });
      const intentBody = (await intentResponse.json()) as {
        intentId?: string;
        uploadUrl?: string;
        error?: { message: string };
      };
      if (!intentResponse.ok || !intentBody.intentId || !intentBody.uploadUrl) {
        throw new Error(intentBody.error?.message ?? "Could not create an upload slot");
      }

      const putResponse = await fetch(intentBody.uploadUrl, {
        method: "PUT",
        headers: { "Content-Type": file.type },
        body: file,
      });
      if (!putResponse.ok) {
        const putBody = (await putResponse.json().catch(() => null)) as { error?: { message: string } } | null;
        throw new Error(putBody?.error?.message ?? "The file could not be stored");
      }

      const completeResponse = await fetch(`/api/uploads/intents/${intentBody.intentId}/complete`, {
        method: "POST",
      });
      const completeBody = (await completeResponse.json()) as { error?: { message: string } };
      if (!completeResponse.ok) {
        throw new Error(completeBody.error?.message ?? "The file failed validation");
      }

      toast.success(`${file.name} is in your library`);
      setState({ status: "idle" });
      router.refresh();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Upload failed";
      setState({ status: "error", message, filename: file.name });
    }
  }

  return (
    <div className="space-y-3">
      <div className="space-y-2">
        <Label htmlFor="asset-file">Upload image</Label>
        <Input
          id="asset-file"
          type="file"
          accept="image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp"
          disabled={state.status === "uploading"}
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (file) {
              void uploadFile(file);
            }
          }}
        />
        <p className="text-xs text-muted-foreground">JPEG, PNG, or WebP. Private storage. Original filename is never used as the object key.</p>
      </div>
      {state.status === "uploading" ? (
        <p className="text-sm text-muted-foreground">Validating and storing {state.filename}…</p>
      ) : null}
      {state.status === "error" ? (
        <Alert variant="destructive">
          <AlertTitle>Upload failed</AlertTitle>
          <AlertDescription>
            <p>{state.message}</p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="mt-2"
              onClick={() => setState({ status: "idle" })}
            >
              Dismiss and retry
            </Button>
          </AlertDescription>
        </Alert>
      ) : null}
    </div>
  );
}
