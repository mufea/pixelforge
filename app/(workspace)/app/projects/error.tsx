"use client";

import { Button } from "@/components/ui/button";

export default function ProjectsError({ reset }: { error: Error; reset: () => void }) {
  return (
    <div className="mx-auto flex min-h-[40vh] w-full max-w-lg flex-col items-start justify-center gap-4">
      <h1 className="text-2xl font-semibold">Could not load projects</h1>
      <p className="text-muted-foreground">The library request failed. Retry without leaving this page.</p>
      <Button type="button" onClick={reset}>
        Try again
      </Button>
    </div>
  );
}
