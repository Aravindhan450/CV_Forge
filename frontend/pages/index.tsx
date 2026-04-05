import { useMemo, useState } from "react";

type Stage = "input" | "loading" | "results";
type ViewMode = "preview" | "edit";
type ActiveTab = "fixes" | "keywords" | "career";
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

const LOADING_STEPS = [
  "Parsing resume content",
  "Extracting skills & keywords",
  "Running semantic fit analysis",
  "Evaluating career trajectory",
  "Generating ATS compatibility report",
];

const STEP_DELAYS = [1800, 1800, 5000, 1800, 1800];
const ACCEPTED_UPLOAD_TYPES = ".txt,.pdf,.docx";

const INITIAL_RESUME = `ARAVINDHAN R
Senior Full-Stack Engineer

SUMMARY
Product-focused engineer with 6+ years building web platforms using React, Next.js, Python, and FastAPI. Strong ownership across architecture, APIs, and deployment workflows.

EXPERIENCE
Senior Software Engineer | Acme Labs
- Built internal hiring dashboard with role-based access and workflow automations.
- Reduced API latency by 34% by optimizing PostgreSQL query plans and introducing async workers.
- Partnered with product managers and recruiters to improve resume screening quality.

Software Engineer | Nova Stack
- Developed reusable React UI components for enterprise B2B products.
- Added observability and error tracking, reducing production incidents.

SKILLS
React, Next.js, TypeScript, Python, FastAPI, PostgreSQL, Docker, Redis, CI/CD, AWS

EDUCATION
B.E. Computer Science`;

const INITIAL_JD = `We are hiring a Senior AI Engineer to design AI-powered developer tools.
Requirements:
- Strong Python and FastAPI backend experience
- React / Next.js frontend expertise
- Experience with ATS workflows and resume analysis systems
- Knowledge of embeddings, LLM prompting, and semantic search
- Production deployment with Docker, Redis, PostgreSQL, and cloud infrastructure`;

function clampScore(value: unknown): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  return Math.max(0, Math.min(100, Math.round(numeric)));
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function stripMarkdownFences(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed.startsWith("```")) return trimmed;
  return trimmed.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
}

function getFileExtension(fileName: string): string {
  const index = fileName.lastIndexOf(".");
  if (index < 0) return "";
  return fileName.slice(index + 1).toLowerCase();
}

async function extractPdfText(file: File): Promise<string> {
  const pdfjsLib = await import("pdfjs-dist");
  const workerVersion = (pdfjsLib as { version?: string }).version ?? "4.8.69";
  // Use a CDN worker for browser parsing in this client-only page.
  (pdfjsLib as { GlobalWorkerOptions: { workerSrc: string } }).GlobalWorkerOptions.workerSrc =
    `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${workerVersion}/pdf.worker.min.mjs`;

  const arrayBuffer = await file.arrayBuffer();
  const loadingTask = (pdfjsLib as { getDocument: (options: { data: ArrayBuffer }) => { promise: Promise<unknown> } })
    .getDocument({ data: arrayBuffer });
  const pdfDocument = (await loadingTask.promise) as {
    numPages: number;
    getPage: (pageNumber: number) => Promise<{ getTextContent: () => Promise<{ items: Array<{ str?: string }> }> }>;
  };

  let output = "";
  for (let pageNumber = 1; pageNumber <= pdfDocument.numPages; pageNumber += 1) {
    const page = await pdfDocument.getPage(pageNumber);
    const content = await page.getTextContent();
    const text = content.items
      .map((item) => item?.str ?? "")
      .join(" ")
      .trim();
    output += `${text}\n`;
  }

  return output.trim();
}

async function extractDocxText(file: File): Promise<string> {
  const mammoth = await import("mammoth");
  const arrayBuffer = await file.arrayBuffer();
  const result = await mammoth.extractRawText({ arrayBuffer });
  return result.value.trim();
}

async function extractTextFromFile(file: File): Promise<string> {
  const extension = getFileExtension(file.name);

  if (extension === "txt") {
    return (await file.text()).trim();
  }

  if (extension === "pdf") {
    return extractPdfText(file);
  }

  if (extension === "docx") {
    return extractDocxText(file);
  }

  throw new Error("Unsupported file format. Please upload .txt, .pdf, or .docx.");
}

function normalizeAnalysis(input: unknown, resumeText: string): AnalysisResult {
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
      narrative: "No narrative returned.",
    },
    highlights: [],
  };

  if (!input || typeof input !== "object") return fallback;
  const data = input as Record<string, unknown>;
  const suggestionsRaw = Array.isArray(data.suggestions) ? data.suggestions : [];
  const keywordFoundRaw = Array.isArray(data.keywords_found) ? data.keywords_found : [];
  const keywordMissingRaw = Array.isArray(data.keywords_missing) ? data.keywords_missing : [];
  const highlightsRaw = Array.isArray(data.highlights) ? data.highlights : [];

  const suggestions: Suggestion[] = suggestionsRaw
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const entry = item as Record<string, unknown>;
      const type = String(entry.type || "info") as SuggestionType;
      const safeType: SuggestionType =
        type === "warn" || type === "danger" || type === "info" || type === "success" ? type : "info";
      return {
        type: safeType,
        category: String(entry.category || "general"),
        title: String(entry.title || "Suggestion"),
        detail: String(entry.detail || "No detail provided."),
      };
    })
    .filter(Boolean)
    .slice(0, 8) as Suggestion[];

  const resumeTextLower = resumeText.toLowerCase();
  const highlights: HighlightItem[] = highlightsRaw
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const entry = item as Record<string, unknown>;
      const type = String(entry.type || "yellow") as HighlightType;
      const safeType: HighlightType = type === "red" || type === "green" || type === "yellow" ? type : "yellow";
      const phrase = String(entry.phrase || "").trim();
      if (!phrase) return null;
      if (!resumeTextLower.includes(phrase.toLowerCase())) return null;
      return {
        phrase,
        type: safeType,
        reason: String(entry.reason || "Improve this phrase for stronger role fit."),
      };
    })
    .filter(Boolean)
    .slice(0, 15) as HighlightItem[];

  const verdictRaw = String(data.verdict || "Needs Work");
  const verdict: AnalysisResult["verdict"] =
    verdictRaw === "Excellent" || verdictRaw === "Good" || verdictRaw === "Needs Work" || verdictRaw === "Weak"
      ? verdictRaw
      : "Needs Work";

  const careerRaw = (data.career_analysis as Record<string, unknown>) || {};

  return {
    ats_score: clampScore(data.ats_score),
    skills_score: clampScore(data.skills_score),
    semantic_score: clampScore(data.semantic_score),
    career_score: clampScore(data.career_score),
    verdict,
    suggestions,
    keywords_found: keywordFoundRaw.map((item) => String(item)).slice(0, 10),
    keywords_missing: keywordMissingRaw.map((item) => String(item)).slice(0, 10),
    career_analysis: {
      current_level: String(careerRaw.current_level || "Unknown"),
      target_level: String(careerRaw.target_level || "Unknown"),
      transition_type: String(careerRaw.transition_type || "Undetermined"),
      transferable_strengths: Array.isArray(careerRaw.transferable_strengths)
        ? careerRaw.transferable_strengths.map((item) => String(item)).slice(0, 8)
        : [],
      gaps: Array.isArray(careerRaw.gaps) ? careerRaw.gaps.map((item) => String(item)).slice(0, 8) : [],
      narrative: String(careerRaw.narrative || "No narrative returned."),
    },
    highlights,
  };
}

function escapeHtml(input: string): string {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function buildReportHtml(result: AnalysisResult, resumeText: string): string {
  const today = new Date().toLocaleString();
  const suggestions = result.suggestions
    .map(
      (item) =>
        `<div style="border:1px solid #e5e7eb;border-radius:8px;padding:10px;margin-bottom:8px;">
          <div style="font-size:11px;color:#6b7280;text-transform:uppercase;letter-spacing:.04em;">${escapeHtml(item.category)}</div>
          <div style="font-size:13px;color:#111827;margin-top:4px;">${escapeHtml(item.title)}</div>
          <div style="font-size:12px;color:#374151;margin-top:6px;line-height:1.6;">${escapeHtml(item.detail)}</div>
        </div>`
    )
    .join("");

  const found = result.keywords_found.map((k) => `<span>${escapeHtml(k)}</span>`).join(", ");
  const missing = result.keywords_missing.map((k) => `<span>${escapeHtml(k)}</span>`).join(", ");
  const strengths = result.career_analysis.transferable_strengths.map((k) => `<li>${escapeHtml(k)}</li>`).join("");
  const gaps = result.career_analysis.gaps.map((k) => `<li>${escapeHtml(k)}</li>`).join("");

  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>CV FORGE Analysis Report</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; margin: 24px; color: #111827; }
    .muted { color: #6b7280; font-size: 12px; }
    .grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; margin: 14px 0 20px; }
    .cell { border: 1px solid #e5e7eb; border-radius: 8px; padding: 10px; background: #f9fafb; }
    .label { font-size: 11px; color: #9ca3af; text-transform: uppercase; letter-spacing: .05em; }
    .value { font-size: 18px; margin-top: 4px; }
    h2 { font-size: 14px; margin: 20px 0 10px; font-weight: 500; }
    ul { margin: 8px 0; padding-left: 18px; }
    pre { border: 1px solid #e5e7eb; border-radius: 8px; background: #f9fafb; padding: 12px; white-space: pre-wrap; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; line-height: 1.8; }
  </style>
</head>
<body>
  <h1 style="font-size:16px;font-weight:500;margin:0;">CV FORGE Resume Analysis Report</h1>
  <div class="muted" style="margin-top:6px;">Generated ${escapeHtml(today)} • ATS ${result.ats_score}/100</div>

  <div class="grid">
    <div class="cell"><div class="label">ATS</div><div class="value">${result.ats_score}</div></div>
    <div class="cell"><div class="label">Skills</div><div class="value">${result.skills_score}</div></div>
    <div class="cell"><div class="label">Semantic</div><div class="value">${result.semantic_score}</div></div>
    <div class="cell"><div class="label">Career</div><div class="value">${result.career_score}</div></div>
  </div>

  <h2>Suggestions</h2>
  ${suggestions || "<div class='muted'>No suggestions available.</div>"}

  <h2>Keywords</h2>
  <div style="font-size:12px;line-height:1.7;"><strong>Found:</strong> ${found || "None"}</div>
  <div style="font-size:12px;line-height:1.7;margin-top:4px;"><strong>Missing:</strong> ${missing || "None"}</div>

  <h2>Career Analysis</h2>
  <div style="font-size:12px;line-height:1.7;"><strong>Current:</strong> ${escapeHtml(result.career_analysis.current_level)}</div>
  <div style="font-size:12px;line-height:1.7;"><strong>Target:</strong> ${escapeHtml(result.career_analysis.target_level)}</div>
  <div style="font-size:12px;line-height:1.7;"><strong>Transition:</strong> ${escapeHtml(result.career_analysis.transition_type)}</div>
  <div style="margin-top:8px;font-size:12px;line-height:1.7;"><strong>Transferable strengths:</strong><ul>${strengths || "<li>None</li>"}</ul></div>
  <div style="margin-top:8px;font-size:12px;line-height:1.7;"><strong>Gaps:</strong><ul>${gaps || "<li>None</li>"}</ul></div>
  <div style="border:1px solid #e5e7eb;border-radius:8px;background:#f9fafb;padding:10px;margin-top:10px;font-size:12px;line-height:1.8;color:#4b5563;">${escapeHtml(result.career_analysis.narrative)}</div>

  <h2>Resume Text</h2>
  <pre>${escapeHtml(resumeText)}</pre>
</body>
</html>`;
}

function scoreVerdict(score: number): string {
  if (score >= 70) return "Strong";
  if (score >= 45) return "Moderate";
  return "Weak";
}

function scoreColor(score: number): string {
  if (score >= 70) return "text-green-600";
  if (score >= 45) return "text-amber-600";
  return "text-red-600";
}

function suggestionClasses(type: SuggestionType): string {
  if (type === "success") return "bg-green-50 border-green-200 text-green-700";
  if (type === "warn") return "bg-amber-50 border-amber-200 text-amber-700";
  if (type === "danger") return "bg-red-50 border-red-200 text-red-700";
  return "bg-blue-50 border-blue-200 text-blue-700";
}

function highlightClass(type: HighlightType): string {
  if (type === "green") return "border-b border-green-500 cursor-pointer";
  if (type === "red") return "border-b border-red-400 cursor-pointer";
  return "border-b border-amber-400 cursor-pointer";
}

type HighlightSegment = {
  start: number;
  end: number;
  item: HighlightItem;
};

function buildHighlightSegments(text: string, highlights: HighlightItem[]): HighlightSegment[] {
  const sorted = [...highlights].sort((a, b) => b.phrase.length - a.phrase.length);
  const segments: HighlightSegment[] = [];
  const textLower = text.toLowerCase();

  for (const item of sorted) {
    const phrase = item.phrase.trim();
    if (!phrase) continue;
    const phraseLower = phrase.toLowerCase();

    let foundAt = -1;
    let searchIndex = 0;

    while (searchIndex < textLower.length) {
      const index = textLower.indexOf(phraseLower, searchIndex);
      if (index === -1) break;

      const nextEnd = index + phrase.length;
      const overlaps = segments.some((segment) => !(nextEnd <= segment.start || index >= segment.end));
      if (!overlaps) {
        foundAt = index;
        break;
      }
      searchIndex = index + 1;
    }

    if (foundAt >= 0) {
      segments.push({
        start: foundAt,
        end: foundAt + phrase.length,
        item,
      });
    }
  }

  return segments.sort((a, b) => a.start - b.start);
}

export default function CVForgeResumeAnalyzer(): JSX.Element {
  const [stage, setStage] = useState<Stage>("input");
  const [resumeText, setResumeText] = useState<string>(INITIAL_RESUME);
  const [jobDescription, setJobDescription] = useState<string>(INITIAL_JD);
  const [selectedFileName, setSelectedFileName] = useState<string>("");
  const [selectedJobFileName, setSelectedJobFileName] = useState<string>("");

  const [loadingTitle, setLoadingTitle] = useState<string>("Analyzing your resume");
  const [activeStepIndex, setActiveStepIndex] = useState<number>(0);
  const [completedSteps, setCompletedSteps] = useState<number>(0);

  const [analysis, setAnalysis] = useState<AnalysisResult | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>("preview");
  const [activeTab, setActiveTab] = useState<ActiveTab>("fixes");
  const [baseResumeText, setBaseResumeText] = useState<string>(INITIAL_RESUME);
  const [editText, setEditText] = useState<string>(INITIAL_RESUME);
  const [previousAtsScore, setPreviousAtsScore] = useState<number | null>(null);

  const [tooltip, setTooltip] = useState<TooltipState>({
    visible: false,
    x: 0,
    y: 0,
    text: "",
  });

  const atsScore = analysis?.ats_score ?? 0;
  const hasUnsavedChanges = analysis ? editText !== baseResumeText : false;

  const ring = useMemo(() => {
    const radius = 23;
    const circumference = 2 * Math.PI * radius;
    const progress = (atsScore / 100) * circumference;
    return {
      radius,
      circumference,
      offset: circumference - progress,
    };
  }, [atsScore]);

  const highlightSegments = useMemo(() => {
    if (!analysis) return [];
    return buildHighlightSegments(baseResumeText, analysis.highlights);
  }, [analysis, baseResumeText]);

  const atsDelta = useMemo(() => {
    if (previousAtsScore === null || !analysis) return null;
    return analysis.ats_score - previousAtsScore;
  }, [analysis, previousAtsScore]);

  async function callAnthropic(resume: string, jd: string): Promise<AnalysisResult> {
    const apiKey = process.env.NEXT_PUBLIC_ANTHROPIC_API_KEY;
    if (!apiKey) {
      throw new Error("Missing NEXT_PUBLIC_ANTHROPIC_API_KEY in your frontend env.");
    }

    const prompt = `You are an AI resume analyzer. Return strict JSON only, no markdown, no extra text.

Required schema:
{
  "ats_score": 0-100,
  "skills_score": 0-100,
  "semantic_score": 0-100,
  "career_score": 0-100,
  "verdict": "Excellent|Good|Needs Work|Weak",
  "suggestions": [{ "type": "warn|danger|info|success", "category": "string", "title": "string", "detail": "string" }],
  "keywords_found": ["string"],
  "keywords_missing": ["string"],
  "career_analysis": {
    "current_level": "string",
    "target_level": "string",
    "transition_type": "string",
    "transferable_strengths": ["string"],
    "gaps": ["string"],
    "narrative": "string"
  },
  "highlights": [{ "phrase": "exact phrase from resume", "type": "yellow|red|green", "reason": "string" }]
}

Rules:
- 5 to 8 suggestions.
- Maximum 10 items each for keywords_found and keywords_missing.
- 8 to 15 highlights.
- Every highlight.phrase must exist exactly in resume text.

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
      const text = await response.text();
      throw new Error(`Anthropic API error: ${response.status} ${text}`);
    }

    const payload = await response.json();
    const outputText = Array.isArray(payload?.content)
      ? payload.content
          .map((part: { type?: string; text?: string }) => (part?.type === "text" ? part.text || "" : ""))
          .join("\n")
      : "";

    const normalizedJson = stripMarkdownFences(outputText);
    const parsed = JSON.parse(normalizedJson);
    return normalizeAnalysis(parsed, resume);
  }

  async function runAnalysis(nextResumeText: string, nextJobDescription: string, isReanalysis: boolean): Promise<void> {
    const previousStage = stage;
    setLoadingTitle(isReanalysis ? "Re-analyzing edited resume" : "Analyzing your resume");
    setStage("loading");
    setActiveStepIndex(0);
    setCompletedSteps(0);

    try {
      let nextAnalysis: AnalysisResult | null = null;

      for (let i = 0; i < LOADING_STEPS.length; i += 1) {
        setActiveStepIndex(i);

        if (i === 2) {
          const startedAt = Date.now();
          nextAnalysis = await callAnthropic(nextResumeText, nextJobDescription);
          const elapsed = Date.now() - startedAt;
          if (elapsed < STEP_DELAYS[i]) {
            await sleep(STEP_DELAYS[i] - elapsed);
          }
        } else {
          await sleep(STEP_DELAYS[i]);
        }

        setCompletedSteps(i + 1);
      }

      if (!nextAnalysis) throw new Error("No analysis result received.");

      if (isReanalysis && analysis) {
        setPreviousAtsScore(analysis.ats_score);
      } else {
        setPreviousAtsScore(null);
      }

      setAnalysis(nextAnalysis);
      setBaseResumeText(nextResumeText);
      setEditText(nextResumeText);
      setViewMode("preview");
      setActiveTab("fixes");
      setStage("results");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Analysis failed";
      alert(message);
      setStage(previousStage);
    }
  }

  async function handleAnalyzeClick(): Promise<void> {
    if (!resumeText.trim()) {
      alert("Please upload or paste resume text.");
      return;
    }
    if (!jobDescription.trim()) {
      alert("Please add a job description.");
      return;
    }
    await runAnalysis(resumeText, jobDescription, false);
  }

  async function handleReanalyzeClick(): Promise<void> {
    if (!editText.trim()) {
      alert("Resume text cannot be empty.");
      return;
    }
    await runAnalysis(editText, jobDescription, true);
  }

  async function handleResumeFileChange(file: File | null): Promise<void> {
    if (!file) return;
    try {
      const content = await extractTextFromFile(file);
      if (!content) {
        throw new Error("No readable text found in file.");
      }
      setResumeText(content);
      setSelectedFileName(file.name);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to parse selected file.";
      alert(message);
    }
  }

  async function handleJobDescriptionFileChange(file: File | null): Promise<void> {
    if (!file) return;
    try {
      const content = await extractTextFromFile(file);
      if (!content) {
        throw new Error("No readable text found in file.");
      }
      setJobDescription(content);
      setSelectedJobFileName(file.name);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to parse selected file.";
      alert(message);
    }
  }

  function handleExportPdf(): void {
    if (!analysis) return;
    const html = buildReportHtml(analysis, baseResumeText);
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
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "cv-forge-report.html";
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  }

  function renderPreviewText(): JSX.Element {
    if (!analysis) {
      return <div className="text-xs text-gray-400">No preview available.</div>;
    }

    if (highlightSegments.length === 0) {
      return <>{baseResumeText}</>;
    }

    const nodes: JSX.Element[] = [];
    let cursor = 0;

    for (let index = 0; index < highlightSegments.length; index += 1) {
      const segment = highlightSegments[index];
      if (segment.start > cursor) {
        nodes.push(
          <span key={`plain-${cursor}`}>{baseResumeText.slice(cursor, segment.start)}</span>
        );
      }

      nodes.push(
        <span
          key={`hl-${segment.start}-${segment.end}`}
          className={highlightClass(segment.item.type)}
          onMouseEnter={(event) => {
            setTooltip({
              visible: true,
              x: event.clientX + 12,
              y: event.clientY + 12,
              text: segment.item.reason,
            });
          }}
          onMouseMove={(event) => {
            setTooltip((prev) => ({
              ...prev,
              visible: true,
              x: event.clientX + 12,
              y: event.clientY + 12,
              text: segment.item.reason,
            }));
          }}
          onMouseLeave={() => {
            setTooltip((prev) => ({ ...prev, visible: false }));
          }}
        >
          {baseResumeText.slice(segment.start, segment.end)}
        </span>
      );

      cursor = segment.end;
    }

    if (cursor < baseResumeText.length) {
      nodes.push(<span key={`plain-end-${cursor}`}>{baseResumeText.slice(cursor)}</span>);
    }

    return <>{nodes}</>;
  }

  return (
    <div className="min-h-screen bg-gray-50 text-gray-700 font-normal">
      <header className="fixed top-0 left-0 right-0 z-20 h-11 px-5 bg-white border-b border-gray-200 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-gray-900" />
          <span className="text-sm font-medium text-gray-900">CV FORGE</span>
          <span className="text-sm text-gray-400">AI Resume Analyzer</span>
        </div>
      </header>

      <main className="pt-11 h-screen">
        {stage === "input" && (
          <section className="p-5 flex flex-col gap-4 h-[calc(100vh-2.75rem)]">
            <div className="grid grid-cols-2 gap-4">
              <div className="bg-white border border-gray-200 rounded-lg p-4 flex flex-col gap-3">
                <div className="text-xs font-medium text-gray-500 uppercase tracking-wide flex items-center gap-2">
                  <span className="w-1.5 h-1.5 rounded-full bg-blue-400" />
                  Resume Input
                </div>

                <label className="border border-dashed border-gray-300 rounded-md p-4 text-center cursor-pointer hover:bg-gray-50 relative transition-all duration-150">
                  <input
                    type="file"
                    accept={ACCEPTED_UPLOAD_TYPES}
                    className="absolute inset-0 opacity-0 cursor-pointer"
                    onChange={(event) => {
                      void handleResumeFileChange(event.target.files?.[0] ?? null);
                    }}
                  />
                  <div className="text-base text-gray-500">⇧</div>
                  <div className="text-xs text-gray-500 mt-1">Drop resume file or click to upload</div>
                  <div className="text-xs text-gray-400 mt-1">Accepted: .txt, .pdf, .docx</div>
                  {selectedFileName && (
                    <div className="mt-2 inline-flex bg-blue-50 text-blue-600 text-xs rounded-full px-2 py-0.5">
                      {selectedFileName}
                    </div>
                  )}
                </label>

                <div className="text-xs text-gray-300 text-center">or paste resume content</div>

                <textarea
                  value={resumeText}
                  onChange={(event) => setResumeText(event.target.value)}
                  className="h-44 bg-gray-50 border border-gray-200 rounded-md p-3 resize-none focus:outline-none focus:border-gray-400 w-full text-xs leading-relaxed"
                />
              </div>

              <div className="bg-white border border-gray-200 rounded-lg p-4 flex flex-col gap-3">
                <div className="text-xs font-medium text-gray-500 uppercase tracking-wide flex items-center gap-2">
                  <span className="w-1.5 h-1.5 rounded-full bg-green-400" />
                  Job Description
                </div>
                <label className="border border-dashed border-gray-300 rounded-md p-4 text-center cursor-pointer hover:bg-gray-50 relative transition-all duration-150">
                  <input
                    type="file"
                    accept={ACCEPTED_UPLOAD_TYPES}
                    className="absolute inset-0 opacity-0 cursor-pointer"
                    onChange={(event) => {
                      void handleJobDescriptionFileChange(event.target.files?.[0] ?? null);
                    }}
                  />
                  <div className="text-base text-gray-500">⇧</div>
                  <div className="text-xs text-gray-500 mt-1">Drop JD file or click to upload</div>
                  <div className="text-xs text-gray-400 mt-1">Accepted: .txt, .pdf, .docx</div>
                  {selectedJobFileName && (
                    <div className="mt-2 inline-flex bg-green-50 text-green-600 text-xs rounded-full px-2 py-0.5">
                      {selectedJobFileName}
                    </div>
                  )}
                </label>
                <div className="text-xs text-gray-300 text-center">or paste job description</div>
                <textarea
                  value={jobDescription}
                  onChange={(event) => setJobDescription(event.target.value)}
                  className="h-44 bg-gray-50 border border-gray-200 rounded-md p-3 resize-none focus:outline-none focus:border-gray-400 w-full text-xs leading-relaxed"
                />
              </div>
            </div>

            <div className="flex items-center justify-between">
              <p className="text-xs text-gray-400">Analysis covers ATS fit, skills, semantic alignment, and career trajectory.</p>
              <button
                type="button"
                onClick={() => {
                  void handleAnalyzeClick();
                }}
                className="bg-gray-900 text-white text-sm font-medium px-5 py-2 rounded-md hover:bg-gray-800 transition-all duration-150"
              >
                Analyze Resume
              </button>
            </div>
          </section>
        )}

        {stage === "loading" && (
          <section className="h-[calc(100vh-2.75rem)] flex flex-col items-center py-16 gap-5">
            <h2 className="text-sm font-medium text-gray-500">{loadingTitle}</h2>
            <div className="flex flex-col gap-2 w-full max-w-sm">
              {LOADING_STEPS.map((step, index) => {
                const isDone = index < completedSteps;
                const isActive = index === activeStepIndex && !isDone;

                return (
                  <div
                    key={step}
                    className={`rounded-lg px-3 py-2.5 flex items-center gap-3 transition-all duration-300 ${
                      isDone
                        ? "border border-green-200 bg-green-50"
                        : isActive
                          ? "border border-gray-300 bg-white"
                          : "border border-gray-200 bg-white"
                    }`}
                  >
                    {isDone && (
                      <span className="w-4 h-4 rounded-full bg-green-500 flex items-center justify-center text-white text-[9px]">✓</span>
                    )}
                    {isActive && <span className="w-4 h-4 rounded-full border-2 border-gray-900 animate-spin" />}
                    {!isDone && !isActive && <span className="w-4 h-4 rounded-full border border-gray-300" />}
                    <span
                      className={`text-xs ${
                        isDone ? "text-green-600" : isActive ? "text-gray-900 font-medium" : "text-gray-400"
                      }`}
                    >
                      {step}
                    </span>
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {stage === "results" && analysis && (
          <section className="flex flex-row h-[calc(100vh-2.75rem)]">
            <aside className="w-72 border-r border-gray-200 flex flex-col overflow-hidden bg-white">
              <div className="px-4 py-3 border-b border-gray-200 flex items-center justify-between">
                <h3 className="text-xs font-medium text-gray-900">Analysis Summary</h3>
                <button
                  type="button"
                  onClick={() => {
                    setStage("input");
                    setViewMode("preview");
                    setActiveTab("fixes");
                    setPreviousAtsScore(null);
                    setTooltip((prev) => ({ ...prev, visible: false }));
                  }}
                  className="text-xs text-gray-500 border border-gray-200 rounded-md px-2 py-1 hover:bg-gray-50 transition-all duration-150"
                >
                  Reset
                </button>
              </div>

              <div className="px-4 py-3 border-b border-gray-200">
                <div className="flex items-center gap-3 mb-3">
                  <div className="relative w-14 h-14">
                    <svg viewBox="0 0 60 60" className="w-14 h-14 -rotate-90">
                      <circle cx="30" cy="30" r={ring.radius} fill="none" className="stroke-gray-100" strokeWidth="4.5" />
                      <circle
                        cx="30"
                        cy="30"
                        r={ring.radius}
                        fill="none"
                        className="stroke-gray-900 transition-[stroke-dashoffset] duration-700 ease-out"
                        strokeWidth="4.5"
                        strokeLinecap="round"
                        strokeDasharray={ring.circumference}
                        strokeDashoffset={ring.offset}
                      />
                    </svg>
                    <div className="absolute inset-0 flex items-center justify-center text-sm font-medium text-gray-900">{analysis.ats_score}</div>
                  </div>
                  <div>
                    <div className="text-[10px] text-gray-400 uppercase tracking-wide">ATS Score</div>
                    <div className={`text-sm font-medium ${scoreColor(analysis.ats_score)}`}>{scoreVerdict(analysis.ats_score)}</div>
                    {atsDelta !== null && (
                      <div className={`text-[10px] ${atsDelta >= 0 ? "text-green-600" : "text-red-600"}`}>
                        {atsDelta >= 0 ? "↑" : "↓"} {Math.abs(atsDelta)}
                      </div>
                    )}
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-1.5">
                  <div className="bg-gray-50 rounded-md p-2 text-center">
                    <div className="text-sm font-medium text-gray-900">{analysis.skills_score}</div>
                    <div className="text-[9px] text-gray-400 mt-0.5">Skills</div>
                  </div>
                  <div className="bg-gray-50 rounded-md p-2 text-center">
                    <div className="text-sm font-medium text-gray-900">{analysis.semantic_score}</div>
                    <div className="text-[9px] text-gray-400 mt-0.5">Semantic</div>
                  </div>
                  <div className="bg-gray-50 rounded-md p-2 text-center">
                    <div className="text-sm font-medium text-gray-900">{analysis.career_score}</div>
                    <div className="text-[9px] text-gray-400 mt-0.5">Career</div>
                  </div>
                </div>
              </div>

              <div className="flex px-3 pt-2 gap-0.5 border-b border-gray-200">
                {(["fixes", "keywords", "career"] as ActiveTab[]).map((tab) => (
                  <button
                    key={tab}
                    type="button"
                    onClick={() => setActiveTab(tab)}
                    className={`text-xs px-2.5 py-1.5 rounded-t border-b-2 transition-all duration-150 ${
                      activeTab === tab
                        ? "border-gray-900 text-gray-900 font-medium"
                        : "border-transparent text-gray-400 hover:text-gray-600"
                    }`}
                  >
                    {tab === "fixes" ? "Fixes" : tab === "keywords" ? "Keywords" : "Career"}
                  </button>
                ))}
              </div>

              <div className="flex-1 overflow-y-auto px-3 py-2.5">
                {activeTab === "fixes" && (
                  <div>
                    {analysis.suggestions.slice(0, 8).map((item, index) => (
                      <div key={`${item.title}-${index}`} className={`rounded-md border p-2.5 mb-2 text-xs leading-relaxed ${suggestionClasses(item.type)}`}>
                        <div className="text-[9px] font-medium uppercase tracking-wide opacity-70 mb-1">{item.category}</div>
                        <div className="font-medium">{item.title}</div>
                        <div className="mt-1">{item.detail}</div>
                      </div>
                    ))}
                  </div>
                )}

                {activeTab === "keywords" && (
                  <div>
                    <div className="text-[10px] font-medium text-gray-400 uppercase tracking-wide mb-1.5 mt-2">Keywords Found</div>
                    <div className="flex flex-wrap gap-1.5">
                      {analysis.keywords_found.map((item) => (
                        <span key={`found-${item}`} className="text-[10px] font-medium px-2 py-0.5 rounded-full border border-green-200 bg-green-50 text-green-700">
                          {item}
                        </span>
                      ))}
                    </div>

                    <div className="text-[10px] font-medium text-gray-400 uppercase tracking-wide mb-1.5 mt-4">Keywords Missing</div>
                    <div className="flex flex-wrap gap-1.5">
                      {analysis.keywords_missing.map((item) => (
                        <span key={`missing-${item}`} className="text-[10px] font-medium px-2 py-0.5 rounded-full border border-red-200 bg-red-50 text-red-700">
                          {item}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                {activeTab === "career" && (
                  <div className="flex flex-col gap-2">
                    <div className="grid grid-cols-2 gap-2">
                      <div className="bg-gray-50 border border-gray-200 rounded-md p-2">
                        <div className="text-[10px] font-medium text-gray-400 uppercase tracking-wide">Current Level</div>
                        <div className="text-xs text-gray-700 mt-1">{analysis.career_analysis.current_level}</div>
                      </div>
                      <div className="bg-gray-50 border border-gray-200 rounded-md p-2">
                        <div className="text-[10px] font-medium text-gray-400 uppercase tracking-wide">Target Level</div>
                        <div className="text-xs text-gray-700 mt-1">{analysis.career_analysis.target_level}</div>
                      </div>
                    </div>

                    <div className="bg-blue-50 border border-blue-200 text-blue-700 rounded-md p-2 text-xs">
                      <div className="text-[9px] font-medium uppercase tracking-wide opacity-70 mb-1">Transition Type</div>
                      {analysis.career_analysis.transition_type}
                    </div>

                    <div>
                      <div className="text-[10px] font-medium text-gray-400 uppercase tracking-wide mb-1.5">Transferable Strengths</div>
                      <div className="flex flex-wrap gap-1.5">
                        {analysis.career_analysis.transferable_strengths.map((item) => (
                          <span key={`strength-${item}`} className="text-[10px] px-2 py-1 rounded border border-green-200 bg-green-50 text-green-700">
                            {item}
                          </span>
                        ))}
                      </div>
                    </div>

                    <div>
                      <div className="text-[10px] font-medium text-gray-400 uppercase tracking-wide mb-1.5">Gaps</div>
                      <div className="flex flex-wrap gap-1.5">
                        {analysis.career_analysis.gaps.map((item) => (
                          <span key={`gap-${item}`} className="text-[10px] px-2 py-1 rounded border border-red-200 bg-red-50 text-red-700">
                            {item}
                          </span>
                        ))}
                      </div>
                    </div>

                    <div className="bg-gray-50 rounded-md p-3 text-xs leading-relaxed text-gray-500 border border-gray-200">
                      {analysis.career_analysis.narrative}
                    </div>
                  </div>
                )}
              </div>
            </aside>

            <div className="flex-1 flex flex-col overflow-hidden min-w-0">
              <div className="px-4 py-2.5 border-b border-gray-200 bg-gray-50 flex items-center justify-between">
                <div className="flex items-center">
                  <div className="flex border border-gray-200 rounded-md overflow-hidden">
                    <button
                      type="button"
                      onClick={() => setViewMode("preview")}
                      className={`text-xs px-3 py-1.5 border-none cursor-pointer transition-all duration-150 ${
                        viewMode === "preview" ? "bg-gray-900 text-white" : "bg-white text-gray-500 hover:bg-gray-50"
                      }`}
                    >
                      Preview
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setViewMode("edit");
                      }}
                      className={`text-xs px-3 py-1.5 border-none cursor-pointer transition-all duration-150 ${
                        viewMode === "edit" ? "bg-gray-900 text-white" : "bg-white text-gray-500 hover:bg-gray-50"
                      }`}
                    >
                      Edit
                    </button>
                  </div>
                  {hasUnsavedChanges && (
                    <span className="text-[10px] bg-amber-50 text-amber-600 border border-amber-200 rounded-full px-2 py-0.5 ml-2">
                      unsaved changes
                    </span>
                  )}
                </div>

                <div className="flex gap-2">
                  {hasUnsavedChanges && (
                    <button
                      type="button"
                      onClick={() => {
                        void handleReanalyzeClick();
                      }}
                      className="text-xs border border-gray-300 text-gray-700 bg-white rounded-md px-3 py-1.5 hover:bg-gray-50 transition-all duration-150"
                    >
                      Re-analyze
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={handleExportPdf}
                    className="text-xs border border-gray-300 text-gray-700 bg-white rounded-md px-3 py-1.5 hover:bg-gray-50 transition-all duration-150"
                  >
                    ↓ Export PDF
                  </button>
                </div>
              </div>

              {viewMode === "preview" && (
                <div className="flex flex-col flex-1 overflow-hidden">
                  <div className="flex items-center gap-3 px-4 py-2 bg-gray-50 border-b border-gray-200 flex-wrap">
                    <span className="text-[10px] font-medium text-gray-500 mr-1">Legend</span>
                    <span className="text-[10px] text-gray-400"><span className="w-2 h-2 rounded-sm inline-block mr-1 bg-amber-400" />Weak phrasing</span>
                    <span className="text-[10px] text-gray-400"><span className="w-2 h-2 rounded-sm inline-block mr-1 bg-red-400" />Gap</span>
                    <span className="text-[10px] text-gray-400"><span className="w-2 h-2 rounded-sm inline-block mr-1 bg-green-500" />Strong match</span>
                  </div>

                  <div className="flex-1 overflow-y-auto px-8 py-5">
                    <div className="max-w-2xl mx-auto text-xs leading-[1.9] whitespace-pre-wrap break-words text-gray-700 font-normal">
                      {renderPreviewText()}
                    </div>
                  </div>
                </div>
              )}

              {viewMode === "edit" && (
                <div className="flex-1 overflow-hidden flex flex-col">
                  <div className="flex-1 overflow-y-auto px-8 py-5">
                    <div className="max-w-2xl mx-auto flex flex-col gap-3">
                      <div className="bg-amber-50 border border-amber-200 rounded-md px-3 py-2 text-xs text-amber-700">
                        Edit carefully. Re-analyze to update scores and highlights.
                      </div>

                      <textarea
                        value={editText}
                        onChange={(event) => setEditText(event.target.value)}
                        className="w-full min-h-[480px] border border-gray-200 rounded-md p-4 font-mono text-xs leading-[1.85] text-gray-700 bg-white resize-y focus:outline-none focus:border-gray-400"
                      />

                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => {
                            void handleReanalyzeClick();
                          }}
                          className="bg-gray-900 text-white text-sm font-medium px-3 py-2 rounded-md hover:bg-gray-800 transition-all duration-150"
                        >
                          Re-analyze
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setEditText(baseResumeText);
                            setViewMode("preview");
                          }}
                          className="border border-gray-300 text-gray-700 bg-white text-sm px-3 py-2 rounded-md hover:bg-gray-50 transition-all duration-150"
                        >
                          Cancel
                        </button>
                        <span className="text-[10px] text-gray-400 ml-auto">{editText.length} chars</span>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {tooltip.visible && (
              <div
                className="fixed bg-gray-900 text-white text-[10px] leading-relaxed rounded px-2 py-1.5 pointer-events-none z-50 max-w-[200px]"
                style={{ left: tooltip.x, top: tooltip.y }}
              >
                {tooltip.text}
              </div>
            )}
          </section>
        )}
      </main>
    </div>
  );
}
