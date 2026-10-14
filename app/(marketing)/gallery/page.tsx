import type { Metadata } from "next";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export const metadata: Metadata = { title: "Gallery" };

export default function GalleryPage() {
  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-16">
      <h1 className="text-4xl font-semibold tracking-tight">Gallery</h1>
      <p className="mt-3 max-w-2xl text-muted-foreground">
        This page will list generated examples after the asset pipeline exists. It does not ship stock images pretending to be product output.
      </p>
      <Card className="mt-10">
        <CardHeader>
          <CardTitle>No examples yet</CardTitle>
          <CardDescription>
            Generation history and public samples require private storage and a worker. Those ship in Phases 2–4. Check back after the first live adapter is connected.
          </CardDescription>
        </CardHeader>
      </Card>
    </div>
  );
}
