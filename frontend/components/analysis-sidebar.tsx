import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AnalysisResponse } from "@/lib/types";

function BulletList({ items, empty }: { items: string[]; empty: string }) {
  if (!items.length) {
    return <p className="text-sm text-muted-foreground">{empty}</p>;
  }

  return (
    <ul className="space-y-2 text-sm">
      {items.map((item, index) => (
        <li key={`${item}-${index}`} className="rounded-md border border-border/60 bg-white px-3 py-2">
          {item}
        </li>
      ))}
    </ul>
  );
}

export function AnalysisSidebar({ analysis }: { analysis: AnalysisResponse | null }) {
  return (
    <Card className="h-full">
      <CardHeader>
        <CardTitle>Insights</CardTitle>
      </CardHeader>
      <CardContent>
        {!analysis ? (
          <p className="text-sm text-muted-foreground">Analyze a resume to unlock suggestions and keyword insights.</p>
        ) : (
          <Tabs defaultValue="suggestions" className="w-full">
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="suggestions">Suggestions</TabsTrigger>
              <TabsTrigger value="found">Found</TabsTrigger>
              <TabsTrigger value="missing">Missing</TabsTrigger>
              <TabsTrigger value="career">Career Fit</TabsTrigger>
            </TabsList>

            <TabsContent value="suggestions">
              <BulletList
                items={analysis.semantic.improvement_suggestions}
                empty="No semantic suggestions available yet."
              />
            </TabsContent>

            <TabsContent value="found">
              <BulletList items={analysis.keywords.found_keywords} empty="No matched keywords detected." />
            </TabsContent>

            <TabsContent value="missing">
              <BulletList items={analysis.keywords.missing_keywords} empty="No missing keywords detected." />
            </TabsContent>

            <TabsContent value="career">
              <div className="space-y-3 text-sm">
                <p className="rounded-md border border-border/60 bg-white px-3 py-2">
                  {analysis.career_fit.trajectory_summary}
                </p>
                <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Transferable Skills
                </h4>
                <BulletList
                  items={analysis.career_fit.transferable_skills}
                  empty="No transferable skills identified."
                />
                <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Experience Gaps</h4>
                <BulletList items={analysis.career_fit.experience_gaps} empty="No major experience gaps identified." />
              </div>
            </TabsContent>
          </Tabs>
        )}
      </CardContent>
    </Card>
  );
}
