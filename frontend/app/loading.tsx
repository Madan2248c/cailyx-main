import { PageLoadingState } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <div className="flex flex-1 flex-col">
      <PageLoadingState message="Loading…" />
    </div>
  );
}
