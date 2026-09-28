import { PageLoadingState } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <div className="theme-graphite flex flex-1 flex-col bg-canvas">
      <PageLoadingState message="Loading…" />
    </div>
  );
}
