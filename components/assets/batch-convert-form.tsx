"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import type { AssetCard } from "@/components/assets/asset-grid";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { MAX_BATCH_ASSETS } from "@/lib/validators/convert";

const FORMATS = [
  { value: "image/png", label: "PNG" },
  { value: "image/jpeg", label: "JPEG" },
  { value: "image/webp", label: "WebP" },
] as const;

export function BatchConvertForm({ projectId, assets }: { projectId: string; assets: AssetCard[] }) {
  const router = useRouter();
  const [selected, setSelected] = useState<string[]>([]);
  const [outputFormat, setOutputFormat] = useState("image/webp");
  const [width, setWidth] = useState("");
  const [height, setHeight] = useState("");
  const [cropLeft, setCropLeft] = useState("");
  const [cropTop, setCropTop] = useState("");
  const [cropWidth, setCropWidth] = useState("");
  const [cropHeight, setCropHeight] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectable = useMemo(() => assets.slice(0, 100), [assets]);

  function toggle(id: string) {
    setSelected((current) => {
      if (current.includes(id)) {
        return current.filter((item) => item !== id);
      }
      if (current.length >= MAX_BATCH_ASSETS) {
        return current;
      }
      return [...current, id];
    });
  }

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      const cropFilled = [cropLeft, cropTop, cropWidth, cropHeight].some((value) => value.trim() !== "");
      const body: Record<string, unknown> = {
        assetIds: selected,
        outputFormat,
      };
      if (width.trim()) body.width = Number(width);
      if (height.trim()) body.height = Number(height);
      if (cropFilled) {
        body.crop = {
          left: Number(cropLeft),
          top: Number(cropTop),
          width: Number(cropWidth),
          height: Number(cropHeight),
        };
      }
      const response = await fetch(`/api/projects/${projectId}/convert`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const payload = (await response.json()) as {
        results?: Array<{ output: { originalFilename: string } }>;
        error?: { message: string };
      };
      if (!response.ok || !payload.results) {
        throw new Error(payload.error?.message ?? "Batch conversion failed");
      }
      toast.success(`Created ${payload.results.length} converted image${payload.results.length === 1 ? "" : "s"}`);
      setSelected([]);
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Batch conversion failed");
    } finally {
      setPending(false);
    }
  }

  if (assets.length === 0) {
    return <p className="text-sm text-muted-foreground">Upload images before running a batch.</p>;
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Validate the whole selection first (max {MAX_BATCH_ASSETS}). Originals stay in the library.
      </p>
      <fieldset className="max-h-48 space-y-2 overflow-y-auto rounded-md border p-3">
        <legend className="px-1 text-sm font-medium">Images</legend>
        {selectable.map((asset) => (
          <label key={asset.id} className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={selected.includes(asset.id)}
              onChange={() => toggle(asset.id)}
              disabled={pending || (!selected.includes(asset.id) && selected.length >= MAX_BATCH_ASSETS)}
            />
            <span className="truncate">
              {asset.originalFilename} · {asset.width}×{asset.height}
            </span>
          </label>
        ))}
      </fieldset>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="space-y-1">
          <Label htmlFor="batch-format">Output format</Label>
          <select
            id="batch-format"
            className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
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
        </div>
        <div className="space-y-1">
          <Label htmlFor="batch-width">Width (px)</Label>
          <Input id="batch-width" inputMode="numeric" value={width} disabled={pending} onChange={(e) => setWidth(e.target.value)} placeholder="optional" />
        </div>
        <div className="space-y-1">
          <Label htmlFor="batch-height">Height (px)</Label>
          <Input id="batch-height" inputMode="numeric" value={height} disabled={pending} onChange={(e) => setHeight(e.target.value)} placeholder="optional" />
        </div>
      </div>
      <div className="grid gap-3 sm:grid-cols-4">
        <div className="space-y-1">
          <Label htmlFor="crop-left">Crop left</Label>
          <Input id="crop-left" inputMode="numeric" value={cropLeft} disabled={pending} onChange={(e) => setCropLeft(e.target.value)} placeholder="optional" />
        </div>
        <div className="space-y-1">
          <Label htmlFor="crop-top">Crop top</Label>
          <Input id="crop-top" inputMode="numeric" value={cropTop} disabled={pending} onChange={(e) => setCropTop(e.target.value)} placeholder="optional" />
        </div>
        <div className="space-y-1">
          <Label htmlFor="crop-width">Crop width</Label>
          <Input id="crop-width" inputMode="numeric" value={cropWidth} disabled={pending} onChange={(e) => setCropWidth(e.target.value)} placeholder="optional" />
        </div>
        <div className="space-y-1">
          <Label htmlFor="crop-height">Crop height</Label>
          <Input id="crop-height" inputMode="numeric" value={cropHeight} disabled={pending} onChange={(e) => setCropHeight(e.target.value)} placeholder="optional" />
        </div>
      </div>
      <Button type="submit" disabled={pending || selected.length === 0}>
        {pending ? "Processing…" : `Apply to ${selected.length} image${selected.length === 1 ? "" : "s"}`}
      </Button>
      {error ? (
        <Alert variant="destructive">
          <AlertTitle>Batch failed</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
    </form>
  );
}
