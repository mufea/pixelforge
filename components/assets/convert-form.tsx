"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";

const FORMATS = [
  { value: "image/png", label: "PNG" },
  { value: "image/jpeg", label: "JPEG" },
  { value: "image/webp", label: "WebP" },
] as const;

export function ConvertForm({ assetId, currentMime }: { assetId: string; currentMime: string }) {
  const router = useRouter();
  const defaultFormat = FORMATS.find((format) => format.value !== currentMime)?.value ?? "image/jpeg";
  const [outputFormat, setOutputFormat] = useState<string>(defaultFormat);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onConvert() {
    setPending(true);
    setError(null);
    try {
      const response = await fetch(`/api/assets/${assetId}/convert`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ outputFormat }),
      });
      const body = (await response.json()) as {
        original?: { byteSize: number };
        output?: { byteSize: number; originalFilename: string };
        error?: { message: string };
      };
      if (!response.ok || !body.output || !body.original) {
        throw new Error(body.error?.message ?? "Conversion failed");
      }
      toast.success(
        `${body.output.originalFilename}: ${formatKb(body.original.byteSize)} → ${formatKb(body.output.byteSize)}`,
      );
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Conversion failed");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="space-y-2">
      <Label htmlFor={`convert-${assetId}`}>Convert to</Label>
      <div className="flex flex-wrap gap-2">
        <select
          id={`convert-${assetId}`}
          className="h-8 rounded-md border border-input bg-background px-2 text-sm"
          value={outputFormat}
          disabled={pending}
          onChange={(event) => setOutputFormat(event.target.value)}
        >
          {FORMATS.map((format) => (
            <option key={format.value} value={format.value}>
              {format.label}
            </option>
          ))}
        </select>
        <Button type="button" size="sm" disabled={pending} onClick={() => void onConvert()}>
          {pending ? "Converting…" : "Convert"}
        </Button>
      </div>
      {error ? (
        <Alert variant="destructive">
          <AlertTitle>Conversion failed</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
    </div>
  );
}

function formatKb(bytes: number) {
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}
