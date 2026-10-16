"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { ConvertForm } from "@/components/assets/convert-form";
import { deleteAssetAction } from "@/lib/actions/assets";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export type AssetCard = {
  id: string;
  originalFilename: string;
  mimeType: string;
  byteSize: number;
  width: number;
  height: number;
  kind: string;
  previewUrl: string | null;
  previewError: string | null;
};

export function AssetGrid({ projectId, assets }: { projectId: string; assets: AssetCard[] }) {
  if (assets.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>No images yet</CardTitle>
          <CardDescription>Upload a JPEG, PNG, or WebP. Invalid files are deleted and never become library records.</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {assets.map((asset) => (
        <AssetCardView key={asset.id} projectId={projectId} asset={asset} />
      ))}
    </div>
  );
}

function AssetCardView({ projectId, asset }: { projectId: string; asset: AssetCard }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function onDelete() {
    setPending(true);
    const result = await deleteAssetAction(asset.id, projectId);
    setPending(false);
    if (!result.ok) {
      toast.error(result.message);
      return;
    }
    toast.success("Image removed");
    router.refresh();
  }

  return (
    <Card className="overflow-hidden">
      <div className="aspect-square bg-muted">
        {asset.previewUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={asset.previewUrl} alt={asset.originalFilename} className="size-full object-cover" />
        ) : (
          <div className="flex size-full items-center justify-center px-4 text-center text-sm text-muted-foreground">
            {asset.previewError ?? "Preview unavailable"}
          </div>
        )}
      </div>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 truncate text-base">
          <span className="truncate">{asset.originalFilename}</span>
          {asset.kind === "DERIVATIVE" ? <Badge variant="secondary">Converted</Badge> : null}
          {asset.kind === "GENERATED" ? <Badge variant="secondary">Generated</Badge> : null}
        </CardTitle>
        <CardDescription>
          {asset.width}×{asset.height} · {Math.max(1, Math.round(asset.byteSize / 1024))} KB · {asset.mimeType.replace("image/", "")}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap gap-2">
          {asset.previewUrl ? (
            <Button asChild variant="outline" size="sm">
              <a href={asset.previewUrl} download={asset.originalFilename}>
                Download
              </a>
            </Button>
          ) : null}
          <Button type="button" variant="ghost" size="sm" disabled={pending} onClick={onDelete}>
            {pending ? "Removing…" : "Remove"}
          </Button>
        </div>
        <ConvertForm assetId={asset.id} currentMime={asset.mimeType} />
      </CardContent>
    </Card>
  );
}
