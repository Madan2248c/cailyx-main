'use client';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

/** Manual property pick — testing fallback when auto-match finds nothing. */
export function PropertyPicker({
  title,
  description,
  items,
  onPick,
  isLoading,
}: {
  title: string;
  description: string;
  items: Array<{ key: string; label: string; hint?: string }>;
  onPick: (key: string) => void;
  isLoading?: boolean;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Loading properties…</p>
        ) : items.length === 0 ? (
          <p className="text-sm text-muted-foreground">No properties on this Google account.</p>
        ) : (
          items.map((item) => (
            <div key={item.key} className="flex items-center justify-between gap-3 text-sm">
              <p className="truncate">
                {item.label}
                {item.hint ? <span className="text-muted-foreground"> · {item.hint}</span> : null}
              </p>
              <Button variant="secondary" size="sm" onClick={() => onPick(item.key)}>
                Use this
              </Button>
            </div>
          ))
        )}
      </CardContent>
    </Card>
  );
}
