"use client";

import { Button } from "@/components/ui/button";

export default function ProjectDetailError({ reset }: { error: Error; reset: () => void }) {
  return (
    <div className="mx-auto flex min-h-[40vh] w-full max-w-lg flex-col items-start justify-center gap-4">
      <h1 className="text-2xl font-semibold">Could not open this project</h1>
      <p className="text-muted-foreground">Retry the request. If the id belongs to another account, it will keep returning not found.</p>
      <Button type="button" onClick={reset}>
        Try again
      </Button>
    </div>
  );
}
