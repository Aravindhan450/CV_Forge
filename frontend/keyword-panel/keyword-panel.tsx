import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

function KeywordList({ title, items }: { title: string; items: string[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent>
        {items.length === 0 ? (
          <p className="text-sm text-muted-foreground">No keywords available.</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {items.map((item) => (
              <span key={item} className="rounded-full border border-border bg-white px-3 py-1 text-xs font-medium">
                {item}
              </span>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export function KeywordPanel({ found, missing }: { found: string[]; missing: string[] }) {
  return (
    <div className="space-y-3">
      <KeywordList title="Keywords Found" items={found} />
      <KeywordList title="Keywords Missing" items={missing} />
    </div>
  );
}
