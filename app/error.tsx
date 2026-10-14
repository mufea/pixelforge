"use client";

import { useEffect } from "react";
import { Button } from "@/components/ui/button";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="mx-auto flex min-h-[60vh] w-full max-w-lg flex-col items-start justify-center gap-4 px-4">
      <h1 className="text-3xl font-semibold">Something broke</h1>
      <p className="text-muted-foreground">The request failed. Retry, or return to a previous page.</p>
      <Button type="button" onClick={reset}>
        Try again
      </Button>
    </div>
  );
}
