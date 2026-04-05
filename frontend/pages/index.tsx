import { useEffect, useMemo, useRef, useState } from "react";

type Stage = "idle" | "loading" | "results";
type SuggestionType = "warn" | "danger" | "info" | "success";
type HighlightType = "yellow" | "red" | "green";

type Suggestion = {
  type: SuggestionType;
  category: string;
  title: string;
  detail: string;
};

type CareerAnalysis = {
  current_level: string;
  target_level: string;
  transition_type: string;
  transferable_strengths: string[];
  gaps: string[];
  narrative: string;
};

type HighlightItem = {
  phrase: string;
  type: HighlightType;
  reason: string;
};

type AnalysisResult = {
  ats_score: number;
  skills_score: number;
  semantic_score: number;
  career_score: number;
  verdict: "Excellent" | "Good" | "Needs Work" | "Weak";
  suggestions: Suggestion[];
  keywords_found: string[];
  keywords_missing: string[];
  career_analysis: CareerAnalysis;
  highlights: HighlightItem[];
};

type TooltipState = {
  visible: boolean;
  x: number;
  y: number;
  text: string;
};

type HighlightSegment = {
  start: number;
  end: number;
  item: HighlightItem;
};

type MonacoEditorType = React.ComponentType<{
  height?: string;
  defaultLanguage?: string;
  value?: string;
  theme?: string;
  options?: Record<string, unknown>;
}>;

const ACCEPTED_TYPES = ".txt,.pdf,.docx";
const STEPS = [
  "Parsing resume content",
  "Extracting skills & keywords",
  "Running semantic fit analysis",
  "Evaluating career trajectory",
  "Generating ATS report",
];
const STEP_DELAY_MS = [1800, 1800, 5000, 1500, 1500];

const DEFAULT_RESUME = `SENIOR FULL-STACK ENGINEER

SUMMARY
Product-focused engineer with 6+ years building web platforms using React, Next.js, Python, and FastAPI. Strong ownership across architecture, APIs, and deployment workflows.

EXPERIENCE
Senior Software Engineer | Technology Company
- Built internal hiring dashboard with role-based access and workflow automations.
- Reduced API latency by 34% by optimizing PostgreSQL query plans and introducing async workers.
- Partnered with product managers and recruiters to improve resume screening quality.

Software Engineer | Product Company
- Developed reusable React UI components for enterprise B2B products.
- Added observability and error tracking, reducing production incidents.

SKILLS
React, Next.js, TypeScript, Python, FastAPI, PostgreSQL, Docker, Redis, CI/CD, AWS

EDUCATION
B.E. Computer Science`;

const DEFAULT_JD = `We are hiring a Senior AI Engineer to build production AI workflows.
Requirements:
- Python, FastAPI, React, Next.js
- Resume optimization and ATS awareness
- Embeddings and semantic search familiarity
- Deployment with Docker, Redis, PostgreSQL`;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function clampScore(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, Math.round(n)));
}

function stripMarkdownFences(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed.startsWith("```")) return trimmed;
  return trimmed.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
}

function scoreTone(score: number): string {
  if (score >= 70) return "Strong";
  if (score >= 45) return "Moderate";
  return "Weak";
}

function scoreBadgeClasses(score: number): string {
  if (score >= 70) return "bg-green-50 text-green-700";
  if (score >= 45) return "bg-amber-50 text-amber-700";
  return "bg-red-50 text-red-700";
}

function suggestionClasses(type: SuggestionType): string {
  if (type === "success") return "bg-green-50 border-green-200 text-green-700";
  if (type === "warn") return "bg-amber-50 border-amber-200 text-amber-700";
  if (type === "danger") return "bg-red-50 border-red-200 text-red-700";
  return "bg-blue-50 border-blue-200 text-blue-700";
}

function highlightClasses(type: HighlightType): string {
  if (type === "green") return "border-b-2 border-green-500 cursor-pointer";
  if (type === "red") return "border-b-2 border-red-400 cursor-pointer";
  return "border-b-2 border-amber-400 cursor-pointer";
}

function buildHighlightSegments(text: string, highlights: HighlightItem[]): HighlightSegment[] {
  const textLower = text.toLowerCase();
  const ordered = [...highlights].sort((a, b) => b.phrase.length - a.phrase.length);
  const segments: HighlightSegment[] = [];

  for (const item of ordered) {
    const phrase = item.phrase.trim();
    if (!phrase) continue;
    const phraseLower = phrase.toLowerCase();

    let searchFrom = 0;
    while (searchFrom < textLower.length) {
      const idx = textLower.indexOf(phraseLower, searchFrom);
      if (idx === -1) break;
      const end = idx + phrase.length;
      const overlap = segments.some((s) => !(end <= s.start || idx >= s.end));
      if (!overlap) {
        segments.push({ start: idx, end, item });
        break;
      }
      searchFrom = idx + 1;
    }
  }

  return segments.sort((a, b) => a.start - b.start);
}

function normalizeAnalysis(raw: unknown, resumeText: string): AnalysisResult {
  const fallback: AnalysisResult = {
    ats_score: 0,
    skills_score: 0,
    semantic_score: 0,
    career_score: 0,
    verdict: "Needs Work",
    suggestions: [],
    keywords_found: [],
    keywords_missing: [],
    career_analysis: {
      current_level: "Unknown",
      target_level: "Unknown",
      transition_type: "Undetermined",
      transferable_strengths: [],
      gaps: [],
      narrative: "No narrative available.",
    },
    highlights: [],
  };

  if (!raw || typeof raw !== "object") return fallback;
  const data = raw as Record<string, unknown>;

  const suggestions: Suggestion[] = (Array.isArray(data.suggestions) ? data.suggestions : [])
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const x = item as Record<string, unknown>;
      const t = String(x.type || "info") as SuggestionType;
      const safeType: SuggestionType =
        t === "warn" || t === "danger" || t === "info" || t === "success" ? t : "info";
      return {
        type: safeType,
        category: String(x.category || "General"),
        title: String(x.title || "Suggestion"),
        detail: String(x.detail || "No detail provided."),
      };
    })
    .filter(Boolean)
    .slice(0, 8) as Suggestion[];

  const resumeLower = resumeText.toLowerCase();
  const highlights: HighlightItem[] = (Array.isArray(data.highlights) ? data.highlights : [])
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const x = item as Record<string, unknown>;
      const phrase = String(x.phrase || "").trim();
      if (!phrase) return null;
      if (!resumeLower.includes(phrase.toLowerCase())) return null;
      const t = String(x.type || "yellow") as HighlightType;
      const safeType: HighlightType = t === "yellow" || t === "red" || t === "green" ? t : "yellow";
      return {
        phrase,
        type: safeType,
        reason: String(x.reason || "Review this phrase."),
      };
    })
    .filter(Boolean)
    .slice(0, 15) as HighlightItem[];

  const career = (data.career_analysis as Record<string, unknown>) || {};
  const verdictRaw = String(data.verdict || "Needs Work");
  const verdict: AnalysisResult["verdict"] =
    verdictRaw === "Excellent" || verdictRaw === "Good" || verdictRaw === "Needs Work" || verdictRaw === "Weak"
      ? verdictRaw
      : "Needs Work";

  return {
    ats_score: clampScore(data.ats_score),
    skills_score: clampScore(data.skills_score),
    semantic_score: clampScore(data.semantic_score),
    career_score: clampScore(data.career_score),
    verdict,
    suggestions,
    keywords_found: (Array.isArray(data.keywords_found) ? data.keywords_found : []).map((v) => String(v)).slice(0, 10),
    keywords_missing: (Array.isArray(data.keywords_missing) ? data.keywords_missing : []).map((v) => String(v)).slice(0, 10),
    career_analysis: {
      current_level: String(career.current_level || "Unknown"),
      target_level: String(career.target_level || "Unknown"),
      transition_type: String(career.transition_type || "Undetermined"),
      transferable_strengths: Array.isArray(career.transferable_strengths)
        ? career.transferable_strengths.map((v) => String(v)).slice(0, 10)
        : [],
      gaps: Array.isArray(career.gaps) ? career.gaps.map((v) => String(v)).slice(0, 10) : [],
      narrative: String(career.narrative || "No narrative available."),
    },
    highlights,
  };
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function buildExportHtml(
  result: AnalysisResult,
  resumeText: string,
  analyzedAt: string
): string {
  const suggestionHtml = result.suggestions
    .map(
      (s) => `<div style="border:1px solid #e5e7eb;border-radius:8px;padding:10px;margin-bottom:8px;">
        <div style="font-size:11px;color:#6b7280;text-transform:uppercase;letter-spacing:.04em;">${escapeHtml(s.category)}</div>
        <div style="font-size:13px;color:#111827;margin-top:4px;">${escapeHtml(s.title)}</div>
        <div style="font-size:12px;color:#374151;margin-top:6px;line-height:1.6;">${escapeHtml(s.detail)}</div>
      </div>`
    )
    .join("");

  const highlightHtml = result.highlights
    .map(
      (h) =>
        `<li><strong>${escapeHtml(h.phrase)}</strong> — ${escapeHtml(h.type)} — ${escapeHtml(h.reason)}</li>`
    )
    .join("");

  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>CV FORGE Report</title>
  <style>
    body { margin: 24px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; color: #111827; }
    .muted { color: #6b7280; font-size: 12px; }
    .grid { display:grid; grid-template-columns: repeat(4, 1fr); gap: 10px; margin: 12px 0 20px; }
    .cell { border:1px solid #e5e7eb; border-radius:8px; background:#f9fafb; padding:10px; }
    .label { font-size:11px; color:#9ca3af; text-transform:uppercase; letter-spacing:.04em; }
    .value { font-size:20px; margin-top:4px; }
    h2 { font-size:14px; margin: 18px 0 8px; font-weight:500; }
    pre { border:1px solid #e5e7eb; border-radius:8px; padding:12px; background:#fff; white-space:pre-wrap; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size:12px; line-height:1.8; }
    ul { margin: 8px 0; padding-left: 18px; }
  </style>
</head>
<body>
  <h1 style="font-size:16px;font-weight:500;margin:0;">CV FORGE — Resume Analysis Report</h1>
  <div class="muted" style="margin-top:6px;">${escapeHtml(analyzedAt)}</div>
  <div class="grid">
    <div class="cell"><div class="label">ATS</div><div class="value">${result.ats_score}</div></div>
    <div class="cell"><div class="label">Skills</div><div class="value">${result.skills_score}</div></div>
    <div class="cell"><div class="label">Semantic</div><div class="value">${result.semantic_score}</div></div>
    <div class="cell"><div class="label">Career</div><div class="value">${result.career_score}</div></div>
  </div>

  <h2>Suggestions</h2>
  ${suggestionHtml || "<div class='muted'>No suggestions</div>"}

  <h2>Keywords</h2>
  <div style="font-size:12px;line-height:1.7;"><strong>Found:</strong> ${result.keywords_found.map(escapeHtml).join(", ") || "None"}</div>
  <div style="font-size:12px;line-height:1.7;"><strong>Missing:</strong> ${result.keywords_missing.map(escapeHtml).join(", ") || "None"}</div>

  <h2>Career Analysis</h2>
  <div style="font-size:12px;line-height:1.7;"><strong>Current:</strong> ${escapeHtml(result.career_analysis.current_level)}</div>
  <div style="font-size:12px;line-height:1.7;"><strong>Target:</strong> ${escapeHtml(result.career_analysis.target_level)}</div>
  <div style="font-size:12px;line-height:1.7;"><strong>Transition:</strong> ${escapeHtml(result.career_analysis.transition_type)}</div>
  <div style="margin-top:8px;font-size:12px;line-height:1.7;">${escapeHtml(result.career_analysis.narrative)}</div>

  <h2>Annotated Resume Highlights</h2>
  <ul>${highlightHtml || "<li>No highlights</li>"}</ul>

  <h2>Resume Text</h2>
  <pre>${escapeHtml(resumeText)}</pre>
</body>
</html>`;
}

async function readFileAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("Unable to read file"));
    reader.readAsText(file);
  });
}

async function parseUploadToText(file: File, role: "resume" | "jd"): Promise<string> {
  const ext = file.name.split(".").pop()?.toLowerCase() || "";
  if (ext === "txt") {
    return (await readFileAsText(file)).trim();
  }

  if (ext === "pdf" || ext === "docx") {
    const prefix = `File uploaded: ${file.name} — text extraction in progress`;
    try {
      const raw = await readFileAsText(file);
      const cleaned = raw.replace(/\u0000/g, "").trim();
      if (cleaned.length > 0) {
        return `${prefix}\n\n${cleaned.slice(0, 20000)}`;
      }
      return prefix;
    } catch {
      return prefix;
    }
  }

  throw new Error(`Unsupported ${role} file. Use .txt, .pdf, or .docx`);
}

export default function CVForgeResumeAnalyzer(): JSX.Element {
  const [stage, setStage] = useState<Stage>("idle");
  const [resumeText, setResumeText] = useState<string>(DEFAULT_RESUME);
  const [jobDescriptionText, setJobDescriptionText] = useState<string>(DEFAULT_JD);
  const [resumeFileName, setResumeFileName] = useState<string>("");
  const [jdFileName, setJdFileName] = useState<string>("");

  const [activeStep, setActiveStep] = useState<number>(-1);
  const [doneSteps, setDoneSteps] = useState<number>(0);
  const [analysis, setAnalysis] = useState<AnalysisResult | null>(null);
  const [analyzedAt, setAnalyzedAt] = useState<string>("");
  const [atsDelta, setAtsDelta] = useState<number | null>(null);

  const [tooltip, setTooltip] = useState<TooltipState>({
    visible: false,
    x: 0,
    y: 0,
    text: "",
  });

  const [MonacoEditor, setMonacoEditor] = useState<MonacoEditorType | null>(null);
  const resultsRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let mounted = true;
    import("@monaco-editor/react")
      .then((mod) => {
        if (!mounted) return;
        setMonacoEditor(() => mod.default as MonacoEditorType);
      })
      .catch(() => {
        if (!mounted) return;
        setMonacoEditor(null);
      });
    return () => {
      mounted = false;
    };
  }, []);

  const resumePreviewText = resumeText.trim() ? resumeText : "// Your resume will appear here...";
  const previewLines = useMemo(() => resumePreviewText.split("\n"), [resumePreviewText]);

  const ring = useMemo(() => {
    const score = analysis?.ats_score ?? 0;
    const radius = 24;
    const circumference = 2 * Math.PI * radius;
    const progress = (score / 100) * circumference;
    return { radius, circumference, offset: circumference - progress };
  }, [analysis]);

  const highlightSegments = useMemo(() => {
    if (!analysis) return [];
    return buildHighlightSegments(resumeText, analysis.highlights);
  }, [analysis, resumeText]);

  async function callAnthropic(resume: string, jd: string): Promise<AnalysisResult> {
    const apiKey = process.env.NEXT_PUBLIC_ANTHROPIC_API_KEY;
    if (!apiKey) {
      throw new Error("Missing NEXT_PUBLIC_ANTHROPIC_API_KEY in frontend env.");
    }

    const prompt = `Analyze the resume against the job description.
Return JSON only, no markdown, no explanation.

Use this exact structure:
{
  "ats_score": 0,
  "skills_score": 0,
  "semantic_score": 0,
  "career_score": 0,
  "verdict": "Excellent|Good|Needs Work|Weak",
  "suggestions": [{ "type": "warn|danger|info|success", "category": "", "title": "", "detail": "" }],
  "keywords_found": [],
  "keywords_missing": [],
  "career_analysis": {
    "current_level": "",
    "target_level": "",
    "transition_type": "",
    "transferable_strengths": [],
    "gaps": [],
    "narrative": ""
  },
  "highlights": [{ "phrase": "", "type": "yellow|red|green", "reason": "" }]
}

Rules:
- 5-8 suggestions
- max 10 keywords in each keywords array
- 8-15 highlights
- every highlight phrase must exist exactly in the resume text

Resume:
${resume}

Job Description:
${jd}`;

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 1000,
        messages: [{ role: "user", content: prompt }],
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Analysis API failed: ${response.status} ${errorText}`);
    }

    const payload = await response.json();
    const outputText = Array.isArray(payload?.content)
      ? payload.content
          .map((part: { type?: string; text?: string }) => (part.type === "text" ? part.text || "" : ""))
          .join("\n")
      : "";

    const cleaned = stripMarkdownFences(outputText);
    const parsed = JSON.parse(cleaned);
    return normalizeAnalysis(parsed, resume);
  }

  async function runAnalysis(isReanalyze: boolean): Promise<void> {
    if (!resumeText.trim()) {
      alert("Please provide resume content.");
      return;
    }
    if (!jobDescriptionText.trim()) {
      alert("Please provide a job description.");
      return;
    }

    const previousAts = isReanalyze && analysis ? analysis.ats_score : null;
    setStage("loading");
    setActiveStep(0);
    setDoneSteps(0);

    try {
      let nextResult: AnalysisResult | null = null;

      for (let i = 0; i < STEPS.length; i += 1) {
        setActiveStep(i);

        if (i === 2) {
          const start = Date.now();
          nextResult = await callAnthropic(resumeText, jobDescriptionText);
          const elapsed = Date.now() - start;
          if (elapsed < STEP_DELAY_MS[i]) {
            await sleep(STEP_DELAY_MS[i] - elapsed);
          }
        } else {
          await sleep(STEP_DELAY_MS[i]);
        }

        setDoneSteps(i + 1);
      }

      if (!nextResult) {
        throw new Error("No analysis result returned.");
      }

      setAnalysis(nextResult);
      setAnalyzedAt(new Date().toLocaleString());
      if (previousAts === null) {
        setAtsDelta(null);
      } else {
        setAtsDelta(nextResult.ats_score - previousAts);
      }
      setStage("results");

      window.setTimeout(() => {
        resultsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      }, 120);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Analysis failed.";
      alert(message);
      setStage("idle");
      setActiveStep(-1);
      setDoneSteps(0);
    }
  }

  async function handleResumeUpload(file: File | null): Promise<void> {
    if (!file) return;
    try {
      const content = await parseUploadToText(file, "resume");
      setResumeFileName(file.name);
      setResumeText(content);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to process file.";
      alert(message);
    }
  }

  async function handleJDUpload(file: File | null): Promise<void> {
    if (!file) return;
    try {
      const content = await parseUploadToText(file, "jd");
      setJdFileName(file.name);
      setJobDescriptionText(content);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to process file.";
      alert(message);
    }
  }

  function exportReport(): void {
    if (!analysis) return;
    const html = buildExportHtml(analysis, resumeText, analyzedAt || new Date().toLocaleString());
    const printWin = window.open("", "_blank");

    if (printWin) {
      printWin.document.open();
      printWin.document.write(html);
      printWin.document.close();
      window.setTimeout(() => {
        printWin.print();
      }, 500);
      return;
    }

    const blob = new Blob([html], { type: "text/html" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "cv-forge-report.html";
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  function renderAnnotatedResume(): JSX.Element {
    if (!analysis) {
      return <>{resumeText}</>;
    }

    if (highlightSegments.length === 0) {
      return <>{resumeText}</>;
    }

    const parts: JSX.Element[] = [];
    let cursor = 0;

    for (let i = 0; i < highlightSegments.length; i += 1) {
      const seg = highlightSegments[i];
      if (seg.start > cursor) {
        parts.push(<span key={`plain-${cursor}`}>{resumeText.slice(cursor, seg.start)}</span>);
      }

      parts.push(
        <span
          key={`hl-${seg.start}-${seg.end}`}
          className={highlightClasses(seg.item.type)}
          onMouseEnter={(event) => {
            setTooltip({
              visible: true,
              x: event.clientX + 12,
              y: event.clientY + 12,
              text: seg.item.reason,
            });
          }}
          onMouseMove={(event) => {
            setTooltip((prev) => ({
              ...prev,
              visible: true,
              x: event.clientX + 12,
              y: event.clientY + 12,
              text: seg.item.reason,
            }));
          }}
          onMouseLeave={() => setTooltip((prev) => ({ ...prev, visible: false }))}
        >
          {resumeText.slice(seg.start, seg.end)}
        </span>
      );

      cursor = seg.end;
    }

    if (cursor < resumeText.length) {
      parts.push(<span key={`tail-${cursor}`}>{resumeText.slice(cursor)}</span>);
    }

    return <>{parts}</>;
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="fixed top-0 left-0 right-0 bg-white border-b border-gray-200 h-11 px-6 flex items-center gap-2 z-30">
        <span className="w-2 h-2 rounded-full bg-gray-900" />
        <span className="text-sm font-medium text-gray-900">CV FORGE</span>
        <span className="text-xs text-gray-400 ml-1">AI Resume Analyzer</span>
      </header>

      <main className="pt-11">
        <section className="grid grid-cols-[40%_60%] h-full min-h-[600px] border-t border-gray-200">
          <div className="border-r border-gray-200 flex flex-col">
            <div className="flex-1 min-h-0 border-b border-gray-200 flex flex-col">
              <div className="px-5 py-3 border-b border-gray-200 flex items-center gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-blue-500" />
                <span className="text-xs font-medium text-gray-500 uppercase tracking-wide">Resume Input</span>
              </div>

              <div className="flex-1 flex flex-col">
                <label className="mx-4 mt-3 border border-dashed border-gray-300 rounded-lg p-5 text-center cursor-pointer hover:bg-gray-50 relative transition-all duration-150">
                  <input
                    type="file"
                    accept={ACCEPTED_TYPES}
                    className="absolute inset-0 opacity-0 cursor-pointer"
                    onChange={(event) => {
                      void handleResumeUpload(event.target.files?.[0] ?? null);
                    }}
                  />
                  <div className="text-base text-gray-500">⬆</div>
                  <div className="text-xs text-gray-500 mt-2">Drop resume file or click to upload</div>
                  <div className="text-xs text-gray-400 mt-1">Accepted: .txt, .pdf, .docx</div>
                  {resumeFileName && (
                    <div className="inline-flex bg-blue-50 text-blue-600 text-xs rounded-full px-3 py-0.5 mt-2">
                      {resumeFileName}
                    </div>
                  )}
                </label>

                <div className="text-xs text-gray-300 text-center my-2">or paste resume content</div>

                <textarea
                  value={resumeText}
                  onChange={(event) => setResumeText(event.target.value)}
                  placeholder="Paste resume text here..."
                  className="mx-4 mb-4 w-[calc(100%-2rem)] h-36 bg-white border border-gray-200 rounded-lg p-3 text-xs text-gray-700 leading-relaxed resize-none focus:outline-none focus:border-gray-400 placeholder-gray-300"
                />
              </div>
            </div>

            <div className="flex-1 min-h-0 flex flex-col">
              <div className="px-5 py-3 border-b border-gray-200 flex items-center gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-green-500" />
                <span className="text-xs font-medium text-gray-500 uppercase tracking-wide">Job Description</span>
              </div>

              <div className="flex-1 flex flex-col">
                <label className="mx-4 mt-3 border border-dashed border-gray-300 rounded-lg p-5 text-center cursor-pointer hover:bg-gray-50 relative transition-all duration-150">
                  <input
                    type="file"
                    accept={ACCEPTED_TYPES}
                    className="absolute inset-0 opacity-0 cursor-pointer"
                    onChange={(event) => {
                      void handleJDUpload(event.target.files?.[0] ?? null);
                    }}
                  />
                  <div className="text-base text-gray-500">⬆</div>
                  <div className="text-xs text-gray-500 mt-2">Drop JD file or click to upload</div>
                  <div className="text-xs text-gray-400 mt-1">Accepted: .txt, .pdf, .docx</div>
                  {jdFileName && (
                    <div className="inline-flex bg-green-50 text-green-600 text-xs rounded-full px-3 py-0.5 mt-2">
                      {jdFileName}
                    </div>
                  )}
                </label>

                <div className="text-xs text-gray-300 text-center my-2">or paste job description</div>

                <textarea
                  value={jobDescriptionText}
                  onChange={(event) => setJobDescriptionText(event.target.value)}
                  placeholder="Paste job description here..."
                  className="mx-4 mb-4 w-[calc(100%-2rem)] h-36 bg-white border border-gray-200 rounded-lg p-3 text-xs text-gray-700 leading-relaxed resize-none focus:outline-none focus:border-gray-400 placeholder-gray-300"
                />
              </div>
            </div>
          </div>

          <div className="flex flex-col min-h-0">
            <div className="px-5 py-3 border-b border-gray-200 flex items-center gap-2">
              <span className="w-1.5 h-1.5 rounded-full bg-purple-500" />
              <span className="text-xs font-medium text-gray-500 uppercase tracking-wide">Resume Preview</span>
            </div>

            <div className="flex-1 min-h-0">
              {MonacoEditor ? (
                <MonacoEditor
                  height="100%"
                  defaultLanguage="markdown"
                  value={resumePreviewText}
                  theme="vs-dark"
                  options={{
                    readOnly: true,
                    minimap: { enabled: false },
                    wordWrap: "on",
                    fontSize: 12,
                    lineNumbers: "on",
                    scrollBeyondLastLine: false,
                    glyphMargin: false,
                    folding: false,
                  }}
                />
              ) : (
                <div className="h-full flex">
                  <div className="w-10 bg-[#1e1e1e] text-[#858585] text-xs font-mono text-right pr-3 pt-5 select-none border-r border-[#333] leading-[1.85] overflow-hidden">
                    {previewLines.map((_line, idx) => (
                      <div key={`line-${idx + 1}`}>{idx + 1}</div>
                    ))}
                  </div>
                  <textarea
                    readOnly
                    value={resumePreviewText}
                    className="font-mono text-xs leading-[1.85] bg-[#1e1e1e] text-[#d4d4d4] p-5 w-full h-full resize-none focus:outline-none border-none"
                  />
                </div>
              )}
            </div>
          </div>
        </section>

        <section className="mt-8 mb-4 flex justify-center">
          {stage !== "loading" ? (
            <button
              type="button"
              onClick={() => {
                void runAnalysis(false);
              }}
              className="bg-gray-900 text-white text-sm font-medium px-10 py-3 rounded-lg hover:bg-gray-800 transition-colors"
            >
              Analyze Resume
            </button>
          ) : (
            <div className="max-w-sm mx-auto flex flex-col gap-2 py-4 w-full">
              {STEPS.map((step, index) => {
                const done = index < doneSteps;
                const active = index === activeStep && !done;
                return (
                  <div
                    key={step}
                    className={`flex items-center gap-3 px-3 py-2 rounded-lg border transition-all duration-300 ${
                      done
                        ? "border-green-200 bg-green-50"
                        : active
                          ? "border-gray-300 bg-white"
                          : "border-gray-200 bg-white"
                    }`}
                  >
                    {done && (
                      <span className="w-4 h-4 rounded-full bg-green-500 text-white text-[9px] flex items-center justify-center">
                        ✓
                      </span>
                    )}
                    {active && <span className="w-4 h-4 rounded-full border-2 border-gray-900 animate-spin" />}
                    {!done && !active && <span className="w-4 h-4 rounded-full border border-gray-300" />}
                    <span
                      className={`text-xs ${
                        done ? "text-green-600" : active ? "font-medium text-gray-900" : "text-gray-400"
                      }`}
                    >
                      {step}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        {analysis && (
          <section ref={resultsRef} className="border-t border-gray-200 mt-4 pt-8 px-6 pb-16">
            <div className="flex items-center justify-between mb-6">
              <div className="flex items-center">
                <h2 className="text-sm font-medium text-gray-900">Analysis Results</h2>
                <span className="text-xs text-gray-400 ml-3">{analyzedAt}</span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    void runAnalysis(true);
                  }}
                  className="border border-gray-300 text-xs text-gray-600 rounded-md px-3 py-1.5 hover:bg-gray-50 transition-all duration-150"
                >
                  ↻ Re-analyze
                </button>
                <button
                  type="button"
                  onClick={exportReport}
                  className="border border-gray-300 text-xs text-gray-600 rounded-md px-3 py-1.5 hover:bg-gray-50 transition-all duration-150"
                >
                  ↓ Export PDF
                </button>
              </div>
            </div>

            <div className="grid grid-cols-4 gap-4 mb-8">
              <div className="bg-white border-2 border-gray-900 rounded-lg p-4 text-center">
                <div className="mx-auto relative w-20 h-20 mb-2">
                  <svg className="w-20 h-20 -rotate-90" viewBox="0 0 64 64">
                    <circle cx="32" cy="32" r={ring.radius} fill="none" className="stroke-gray-100" strokeWidth="5" />
                    <circle
                      cx="32"
                      cy="32"
                      r={ring.radius}
                      fill="none"
                      className="stroke-gray-900 transition-[stroke-dashoffset] duration-700 ease-out"
                      strokeWidth="5"
                      strokeLinecap="round"
                      strokeDasharray={ring.circumference}
                      strokeDashoffset={ring.offset}
                    />
                  </svg>
                  <div className="absolute inset-0 flex items-center justify-center text-2xl font-medium text-gray-900">
                    {analysis.ats_score}
                  </div>
                </div>
                <div
                  className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${scoreBadgeClasses(
                    analysis.ats_score
                  )}`}
                >
                  {scoreTone(analysis.ats_score)}
                </div>
                {atsDelta !== null && (
                  <div className={`text-[10px] mt-1 ${atsDelta >= 0 ? "text-green-600" : "text-red-600"}`}>
                    {atsDelta >= 0 ? "↑" : "↓"} {Math.abs(atsDelta)}
                  </div>
                )}
              </div>

              <div className="bg-white border border-gray-200 rounded-lg p-4 text-center">
                <div className="text-2xl font-medium text-gray-900">{analysis.skills_score}%</div>
                <div className="text-xs text-gray-400 mt-1">Skills</div>
              </div>
              <div className="bg-white border border-gray-200 rounded-lg p-4 text-center">
                <div className="text-2xl font-medium text-gray-900">{analysis.semantic_score}%</div>
                <div className="text-xs text-gray-400 mt-1">Semantic</div>
              </div>
              <div className="bg-white border border-gray-200 rounded-lg p-4 text-center">
                <div className="text-2xl font-medium text-gray-900">{analysis.career_score}%</div>
                <div className="text-xs text-gray-400 mt-1">Career</div>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-4 mb-8">
              <div>
                <div className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-3">Fixes / Suggestions</div>
                {analysis.suggestions.map((s, idx) => (
                  <div key={`${s.title}-${idx}`} className={`rounded-md border p-3 mb-2 text-xs leading-relaxed ${suggestionClasses(s.type)}`}>
                    <div className="text-[9px] font-medium uppercase tracking-wide opacity-60 mb-1">{s.category}</div>
                    <div className="font-medium">{s.title}</div>
                    <div className="mt-1">{s.detail}</div>
                  </div>
                ))}
              </div>

              <div>
                <div className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-3">Keywords</div>

                <div className="text-[10px] font-medium text-gray-400 uppercase tracking-wide mb-2 mt-3">Found</div>
                <div className="flex flex-wrap gap-1.5">
                  {analysis.keywords_found.map((k) => (
                    <span key={`found-${k}`} className="text-[10px] px-2 py-0.5 bg-green-50 border border-green-200 text-green-700 rounded-full">
                      {k}
                    </span>
                  ))}
                </div>

                <div className="text-[10px] font-medium text-gray-400 uppercase tracking-wide mb-2 mt-3">Missing</div>
                <div className="flex flex-wrap gap-1.5">
                  {analysis.keywords_missing.map((k) => (
                    <span key={`missing-${k}`} className="text-[10px] px-2 py-0.5 bg-red-50 border border-red-200 text-red-700 rounded-full">
                      {k}
                    </span>
                  ))}
                </div>
              </div>

              <div>
                <div className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-3">Career Fit</div>
                <div className="grid grid-cols-2 gap-2 mb-3">
                  <div className="bg-white border border-gray-200 rounded-md p-2">
                    <div className="text-[10px] font-medium text-gray-400 uppercase tracking-wide">Current</div>
                    <div className="text-xs text-gray-700 mt-1">{analysis.career_analysis.current_level}</div>
                  </div>
                  <div className="bg-white border border-gray-200 rounded-md p-2">
                    <div className="text-[10px] font-medium text-gray-400 uppercase tracking-wide">Target</div>
                    <div className="text-xs text-gray-700 mt-1">{analysis.career_analysis.target_level}</div>
                  </div>
                </div>

                <div className="bg-blue-50 border border-blue-200 rounded-md p-2 text-xs text-blue-700 mb-3">
                  {analysis.career_analysis.transition_type}
                </div>

                <div className="space-y-1.5">
                  {analysis.career_analysis.transferable_strengths.map((s) => (
                    <div key={`strength-${s}`} className="bg-green-50 border border-green-200 rounded-md px-2 py-1 text-xs text-green-700">
                      {s}
                    </div>
                  ))}
                </div>

                <div className="space-y-1.5 mt-2">
                  {analysis.career_analysis.gaps.map((g) => (
                    <div key={`gap-${g}`} className="bg-red-50 border border-red-200 rounded-md px-2 py-1 text-xs text-red-700">
                      {g}
                    </div>
                  ))}
                </div>

                <p className="bg-gray-50 border border-gray-200 rounded-md p-3 text-xs text-gray-500 leading-relaxed mt-2">
                  {analysis.career_analysis.narrative}
                </p>
              </div>
            </div>

            <div>
              <div className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-3">Annotated Resume</div>

              <div className="flex items-center gap-4 mb-3 px-4 py-2 bg-gray-50 border border-gray-200 rounded-md">
                <span className="text-xs text-gray-400">
                  <span className="inline-block w-2 h-2 rounded-full bg-amber-400 mr-1" />
                  weak phrasing
                </span>
                <span className="text-xs text-gray-400">
                  <span className="inline-block w-2 h-2 rounded-full bg-red-400 mr-1" />
                  gap/missing
                </span>
                <span className="text-xs text-gray-400">
                  <span className="inline-block w-2 h-2 rounded-full bg-green-500 mr-1" />
                  strong match
                </span>
              </div>

              <div className="bg-white border border-gray-200 rounded-lg p-6 max-w-none font-mono text-xs leading-[1.9] whitespace-pre-wrap break-words text-gray-700">
                {renderAnnotatedResume()}
              </div>
            </div>
          </section>
        )}
      </main>

      {tooltip.visible && (
        <div
          className="fixed bg-gray-900 text-white text-[10px] rounded px-2 py-1.5 pointer-events-none z-50 max-w-[200px] leading-relaxed"
          style={{ left: tooltip.x, top: tooltip.y }}
        >
          {tooltip.text}
        </div>
      )}
    </div>
  );
}
