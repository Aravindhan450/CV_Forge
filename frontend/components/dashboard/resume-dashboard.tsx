import dynamic from "next/dynamic";
import { Download, Loader2, LogOut, RefreshCw, UploadCloud } from "lucide-react";
import { useState } from "react";

import { AnalysisSidebar } from "@/components/analysis-sidebar";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { analyzeUpload, downloadReport, pollAnalysisResult, reanalyzeResume } from "@/lib/api";
import { AnalysisResponse } from "@/lib/types";
import { KeywordPanel } from "@/keyword-panel/keyword-panel";
import { ResumePreview } from "@/resume-preview/resume-preview";
import { ScoreDashboard } from "@/score-dashboard/score-dashboard";

const MonacoEditor = dynamic(() => import("@monaco-editor/react"), { ssr: false });

const SAMPLE_JD = `We are hiring a Senior AI Engineer to design and deploy LLM-powered products.
Required: Python, FastAPI, React, PostgreSQL, vector search, prompt engineering, MLOps, and cloud deployment.`;

export function ResumeDashboard({
  accessToken,
  userEmail,
  onLogout,
}: {
  accessToken: string;
  userEmail?: string | null;
  onLogout: () => Promise<void> | void;
}) {
  const [resumeFile, setResumeFile] = useState<File | null>(null);
  const [jobDescription, setJobDescription] = useState<string>(SAMPLE_JD);
  const [analysis, setAnalysis] = useState<AnalysisResponse | null>(null);
  const [resumeEditorText, setResumeEditorText] = useState<string>("");
  const [loadingAnalyze, setLoadingAnalyze] = useState(false);
  const [loadingReanalyze, setLoadingReanalyze] = useState(false);
  const [loadingReport, setLoadingReport] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onAnalyzeUpload() {
    if (!resumeFile) {
      setError("Upload a resume file first (PDF, DOCX, or TXT).");
      return;
    }

    if (!jobDescription.trim()) {
      setError("Paste a job description before analysis.");
      return;
    }

    try {
      setLoadingAnalyze(true);
      setError(null);
      const queued = await analyzeUpload(resumeFile, jobDescription, accessToken, analysis?.analysis_id);
      const result = await pollAnalysisResult(queued.task_id, accessToken);
      setAnalysis(result);
      setResumeEditorText(result.resume_text);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload analysis failed");
    } finally {
      setLoadingAnalyze(false);
    }
  }

  async function onReanalyze() {
    if (!resumeEditorText.trim()) {
      setError("Resume text is empty.");
      return;
    }

    if (!jobDescription.trim()) {
      setError("Job description is empty.");
      return;
    }

    try {
      setLoadingReanalyze(true);
      setError(null);
      const queued = await reanalyzeResume(resumeEditorText, jobDescription, accessToken, analysis?.analysis_id);
      const result = await pollAnalysisResult(queued.task_id, accessToken);
      setAnalysis(result);
      setResumeEditorText(result.resume_text);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Re-analysis failed");
    } finally {
      setLoadingReanalyze(false);
    }
  }

  async function onDownloadReport() {
    if (!analysis) {
      return;
    }

    try {
      setLoadingReport(true);
      setError(null);
      const blob = await downloadReport(analysis.analysis_id, accessToken);
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `analysis-${analysis.analysis_id}.pdf`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Report export failed");
    } finally {
      setLoadingReport(false);
    }
  }

  async function handleLogout() {
    try {
      setLoggingOut(true);
      setError(null);
      await onLogout();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Logout failed");
    } finally {
      setLoggingOut(false);
    }
  }

  return (
    <main className="mx-auto max-w-[1400px] px-4 py-8 sm:px-8">
      <header className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">CV Forge</p>
          <h1 className="text-3xl font-semibold tracking-tight text-foreground">AI Resume Analyzer Platform</h1>
          {userEmail && <p className="mt-1 text-sm text-muted-foreground">Signed in as {userEmail}</p>}
        </div>
        <div className="flex flex-wrap gap-2">
          {analysis && (
            <Button variant="outline" className="gap-2" onClick={onDownloadReport} disabled={loadingReport}>
              {loadingReport ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
              Export PDF Report
            </Button>
          )}
          <Button onClick={onAnalyzeUpload} disabled={loadingAnalyze} className="gap-2">
            {loadingAnalyze ? <Loader2 className="h-4 w-4 animate-spin" /> : <UploadCloud className="h-4 w-4" />}
            Analyze Upload
          </Button>
          <Button variant="secondary" onClick={handleLogout} disabled={loggingOut} className="gap-2">
            {loggingOut ? <Loader2 className="h-4 w-4 animate-spin" /> : <LogOut className="h-4 w-4" />}
            Logout
          </Button>
        </div>
      </header>

      <section className="space-y-4">
        <ScoreDashboard
          atsScore={analysis?.scores.ats_score ?? 0}
          skillScore={analysis?.scores.skill_match_score ?? 0}
          semanticScore={analysis?.scores.semantic_fit_score ?? 0}
          atsDelta={analysis?.score_delta.ats_delta ?? 0}
          skillDelta={analysis?.score_delta.skill_delta ?? 0}
          semanticDelta={analysis?.score_delta.semantic_delta ?? 0}
        />

        {error && <div className="rounded-lg border border-danger/40 bg-danger/10 px-4 py-3 text-sm text-danger">{error}</div>}

        <div className="grid gap-4 xl:grid-cols-12">
          <div className="space-y-4 xl:col-span-4">
            <Card>
              <CardHeader>
                <CardTitle>Input</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <input
                  type="file"
                  accept=".pdf,.docx,.txt"
                  className="block w-full rounded-md border border-border bg-white p-2 text-sm"
                  onChange={(event) => {
                    const file = event.target.files?.[0] ?? null;
                    setResumeFile(file);
                  }}
                />
                <Textarea
                  value={jobDescription}
                  onChange={(event) => setJobDescription(event.target.value)}
                  placeholder="Paste target job description here"
                  className="min-h-48"
                />
              </CardContent>
            </Card>

            <AnalysisSidebar analysis={analysis} />
          </div>

          <div className="space-y-4 xl:col-span-8">
            <ResumePreview resumeText={analysis?.resume_text ?? resumeEditorText} spans={analysis?.highlights.spans ?? []} />

            <Card>
              <CardHeader>
                <CardTitle>Resume Editor (Monaco)</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="overflow-hidden rounded-lg border border-border">
                  <MonacoEditor
                    height="320px"
                    defaultLanguage="markdown"
                    value={resumeEditorText}
                    onChange={(value) => setResumeEditorText(value ?? "")}
                    theme="vs-light"
                    options={{
                      minimap: { enabled: false },
                      wordWrap: "on",
                      fontSize: 13,
                      scrollBeyondLastLine: false,
                    }}
                  />
                </div>
                <Button onClick={onReanalyze} disabled={loadingReanalyze} className="gap-2">
                  {loadingReanalyze ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                  Re-analyze
                </Button>
              </CardContent>
            </Card>

            <KeywordPanel found={analysis?.keywords.found_keywords ?? []} missing={analysis?.keywords.missing_keywords ?? []} />
          </div>
        </div>
      </section>
    </main>
  );
}
