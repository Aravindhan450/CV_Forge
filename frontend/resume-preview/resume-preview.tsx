import { useMemo } from "react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { HighlightColor, HighlightSpan } from "@/lib/types";

type Segment = {
  text: string;
  color?: HighlightColor;
  message?: string;
};

const highlightClass: Record<HighlightColor, string> = {
  green: "bg-emerald-200/70 border-b border-emerald-500",
  yellow: "bg-amber-200/70 border-b border-amber-500",
  red: "bg-red-200/70 border-b border-red-500",
};

function buildSegments(text: string, spans: HighlightSpan[]): Segment[] {
  if (!text) {
    return [];
  }

  if (!spans.length) {
    return [{ text }];
  }

  const ordered = [...spans]
    .sort((a, b) => a.start - b.start || b.end - a.end)
    .filter((span) => span.start < span.end && span.start < text.length);

  const segments: Segment[] = [];
  let cursor = 0;

  for (const span of ordered) {
    const start = Math.max(span.start, cursor);
    const end = Math.min(span.end, text.length);
    if (start >= end) {
      continue;
    }

    if (start > cursor) {
      segments.push({ text: text.slice(cursor, start) });
    }

    segments.push({
      text: text.slice(start, end),
      color: span.color,
      message: span.message,
    });

    cursor = end;
    if (cursor >= text.length) {
      break;
    }
  }

  if (cursor < text.length) {
    segments.push({ text: text.slice(cursor) });
  }

  return segments;
}

export function ResumePreview({ resumeText, spans }: { resumeText: string; spans: HighlightSpan[] }) {
  const segments = useMemo(() => buildSegments(resumeText, spans), [resumeText, spans]);

  return (
    <Card className="h-full">
      <CardHeader>
        <CardTitle>Resume Preview</CardTitle>
      </CardHeader>
      <CardContent className="max-h-[540px] overflow-y-auto whitespace-pre-wrap rounded-md bg-white p-4 font-mono text-sm leading-6 text-slate-700">
        {segments.length === 0 ? (
          <p className="text-muted-foreground">Upload a resume to render preview.</p>
        ) : (
          segments.map((segment, index) =>
            segment.color ? (
              <span
                key={`${segment.color}-${index}`}
                className={`${highlightClass[segment.color]} cursor-help rounded-sm px-0.5`}
                title={segment.message}
              >
                {segment.text}
              </span>
            ) : (
              <span key={`plain-${index}`}>{segment.text}</span>
            )
          )
        )}
      </CardContent>
    </Card>
  );
}
