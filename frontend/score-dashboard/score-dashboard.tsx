import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";

type Metric = {
  label: string;
  value: number;
  delta: number;
};

function DeltaBadge({ delta }: { delta: number }) {
  if (delta === 0) {
    return <Badge variant="neutral">0</Badge>;
  }

  const positive = delta > 0;
  return <Badge variant={positive ? "success" : "danger"}>{positive ? `+${delta}` : delta}</Badge>;
}

function MetricCard({ metric }: { metric: Metric }) {
  return (
    <Card className="animate-fade-up">
      <CardContent className="space-y-2">
        <p className="text-xs uppercase tracking-wide text-muted-foreground">{metric.label}</p>
        <div className="flex items-end justify-between">
          <p className="text-3xl font-semibold text-foreground">{metric.value}</p>
          <DeltaBadge delta={metric.delta} />
        </div>
      </CardContent>
    </Card>
  );
}

export function ScoreDashboard({
  atsScore,
  skillScore,
  semanticScore,
  atsDelta,
  skillDelta,
  semanticDelta,
}: {
  atsScore: number;
  skillScore: number;
  semanticScore: number;
  atsDelta: number;
  skillDelta: number;
  semanticDelta: number;
}) {
  const metrics: Metric[] = [
    { label: "ATS Score", value: atsScore, delta: atsDelta },
    { label: "Skill Match", value: skillScore, delta: skillDelta },
    { label: "Semantic Fit", value: semanticScore, delta: semanticDelta },
  ];

  return (
    <section className="grid gap-3 md:grid-cols-3">
      {metrics.map((metric) => (
        <MetricCard key={metric.label} metric={metric} />
      ))}
    </section>
  );
}
