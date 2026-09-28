"use client";

import { useEffect } from "react";
import { Button } from "@/components/ui/button";

export default function Error({
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
    <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-4 px-4 py-10">
      <div
        role="alert"
        className="flex flex-col items-start gap-3 rounded-xl border border-destructive/30 bg-destructive/10 p-4"
      >
        <p className="text-sm font-medium text-foreground">
          Something went wrong loading this page.
        </p>
        <Button variant="outline" size="sm" onClick={() => reset()}>
          Try again
        </Button>
      </div>
    </div>
  );
}
