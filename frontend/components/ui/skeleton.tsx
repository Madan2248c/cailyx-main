import { cn } from "cn";

function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="skeleton"
      aria-hidden="true"
      className={cn(
        "animate-pulse rounded-lg bg-muted motion-reduce:animate-none",
        className
      )}
      {...props}
    />
  );
}

function PageLoadingState({
  message = "Loading…",
  className,
}: {
  message?: string;
  className?: string;
}) {
  return (
    <div
      role="status"
      aria-live="polite"
      className={cn("flex flex-col gap-4 px-4 py-6", className)}
    >
      <span className="sr-only">{message}</span>
      <Skeleton className="h-8 w-48" />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Skeleton className="h-24" />
        <Skeleton className="h-24" />
        <Skeleton className="hidden h-24 sm:block" />
        <Skeleton className="hidden h-24 lg:block" />
      </div>
      <Skeleton className="h-64" />
    </div>
  );
}

export { Skeleton, PageLoadingState };
