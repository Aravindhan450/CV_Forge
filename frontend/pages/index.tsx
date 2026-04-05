import { useEffect, useMemo, useRef, useState, type MutableRefObject, type PropsWithChildren } from "react";
import { useCVForgeStore } from "@/store/useCVForgeStore";

declare global {
  interface Window {
    pdfjsLib?: PdfJsLib;
    mammoth?: MammothLib;
  }
}

type Stage = "input" | "loading" | "results";
type SuggestionType = "warn" | "danger" | "info" | "success";
type HighlightType = "yellow" | "red" | "green" | "missing keyword" | "weak phrasing" | "strong match";

type HighlightCoordinates = {
  x: number;
  y: number;
  width: number;
  height: number;
};

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
  page?: number;
  coordinates?: HighlightCoordinates;
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

type PdfTextItem = {
  str?: string;
  fontName?: string;
  transform: [number, number, number, number, number, number];
};
type PdfPage = {
  getTextContent: (options?: { normalizeWhitespace?: boolean }) => Promise<{ items: PdfTextItem[] }>;
  getViewport: (options: { scale: number }) => { width: number; height: number };
  render: (options: { canvasContext: CanvasRenderingContext2D; viewport: unknown; background?: string }) => { promise: Promise<void> };
};
type PdfDocument = { numPages: number; getPage: (pageNum: number) => Promise<PdfPage> };
type PdfJsLib = {
  GlobalWorkerOptions: { workerSrc: string };
  getDocument: (src: { data: ArrayBuffer }) => { promise: Promise<PdfDocument> };
};

type MammothLib = {
  extractRawText: (options: { arrayBuffer: ArrayBuffer }) => Promise<{ value: string }>;
};

const ACCEPTED_TYPES = ".txt,.pdf,.docx";
const STEPS = [
  "Parsing Resume",
  "Extracting Skills",
  "Matching Job Description",
  "Running AI Analysis",
  "Generating Suggestions",
];
const STEP_DELAY_MS = [1800, 1800, 5000, 1500, 1500];
const PDFJS_CDN_URL = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js";
const PDFJS_WORKER_CDN_URL = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
const MAMMOTH_CDN_URL = "https://cdnjs.cloudflare.com/ajax/libs/mammoth/1.6.0/mammoth.browser.min.js";
const BACKEND_BASE_URL = (process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:8000")
  .replace(/\/api\/v1\/?$/, "")
  .replace(/\/$/, "");

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
  if (score >= 70) return "bg-[#e8f5ee] text-[#1a7a45] border border-[#b6dfc8]";
  if (score >= 45) return "bg-[#fff8e6] text-[#8a6000] border border-[#f0d080]";
  return "bg-[#fdecea] text-[#9b2c2c] border border-[#f5b8b3]";
}

function suggestionClasses(type: SuggestionType): string {
  if (type === "success") return "bg-[#f0fff6] border-[#b8f0d0] text-[#0a5a30]";
  if (type === "warn") return "bg-[#fffbf0] border-[#f0d080] text-[#7a5a00]";
  if (type === "danger") return "bg-[#fff5f5] border-[#ffcccc] text-[#8a1a1a]";
  return "bg-[#f0f6ff] border-[#b8d4f8] text-[#1a4f8a]";
}

function suggestionIcon(category: string): string {
  const normalized = category.trim().toLowerCase();
  if (normalized.includes("skill")) return "⚡";
  if (normalized.includes("format")) return "📄";
  if (normalized.includes("keyword")) return "🔑";
  if (normalized.includes("impact")) return "📊";
  return "💡";
}

function suggestionIconSeverityClasses(type: SuggestionType): string {
  if (type === "success") return "bg-[#e8f5ee] text-[#1a7a45]";
  if (type === "warn") return "bg-[#fff8e6] text-[#8a6000]";
  if (type === "danger") return "bg-[#fdecea] text-[#9b2c2c]";
  return "bg-[#f0f6ff] text-[#1a4f8a]";
}

function groupMissingKeywords(keywords: string[]): { critical: string[]; optional: string[] } {
  const criticalSignals = [
    "python",
    "fastapi",
    "react",
    "next",
    "typescript",
    "pytorch",
    "tensorflow",
    "docker",
    "postgres",
    "redis",
    "kubernetes",
    "aws",
    "machine learning",
    "ml",
    "ai",
    "llm",
    "nlp",
    "sql",
    "api",
  ];

  const critical: string[] = [];
  const optional: string[] = [];

  for (const keyword of keywords) {
    const normalized = keyword.trim().toLowerCase();
    const isCritical = criticalSignals.some((signal) => normalized.includes(signal));
    if (isCritical) {
      critical.push(keyword);
    } else {
      optional.push(keyword);
    }
  }

  return { critical, optional };
}

function scoreBarColor(score: number): string {
  if (score >= 70) return "#1a7a45";
  if (score >= 45) return "#e0a800";
  return "#c0392b";
}

function scoreLabel(score: number): string {
  if (score >= 90) return "Excellent";
  if (score >= 80) return "Strong";
  if (score >= 70) return "Good";
  if (score >= 60) return "Fair";
  return "Needs Improvement";
}

function scoreLabelBadgeClasses(score: number): string {
  if (score >= 90) return "bg-[#e8f5ee] text-[#1a7a45] border border-[#b6dfc8]";
  if (score >= 80) return "bg-[#eef8f1] text-[#216e4d] border border-[#c6e7d5]";
  if (score >= 70) return "bg-[#f0f6ff] text-[#1a4f8a] border border-[#b8d4f8]";
  if (score >= 60) return "bg-[#fff8e6] text-[#8a6000] border border-[#f0d080]";
  return "bg-[#fdecea] text-[#9b2c2c] border border-[#f5b8b3]";
}

function resolveHighlightVisualType(type: string): "red" | "yellow" | "green" {
  const normalized = type.trim().toLowerCase();
  if (normalized.includes("missing") || normalized === "red") return "red";
  if (normalized.includes("weak") || normalized === "yellow") return "yellow";
  if (normalized.includes("strong") || normalized === "green") return "green";
  return "yellow";
}

function highlightOverlayStyles(type: HighlightType): { border: string; background: string; text: string } {
  const visualType = resolveHighlightVisualType(type);
  if (visualType === "red") {
    return {
      border: "2px solid #d14343",
      background: "rgba(209, 67, 67, 0.12)",
      text: "#7f1d1d",
    };
  }
  if (visualType === "green") {
    return {
      border: "2px solid #1a7a45",
      background: "rgba(26, 122, 69, 0.12)",
      text: "#0a5a30",
    };
  }
  return {
    border: "2px solid #e0a800",
    background: "rgba(224, 168, 0, 0.15)",
    text: "#7a5a00",
  };
}

function InteractiveCard({ children, className = "" }: PropsWithChildren<{ className?: string }>): JSX.Element {
  return (
    <div
      className={`bg-white border border-[#E7E7E7] rounded-2xl transition-all duration-300 ease-out hover:-translate-y-1 hover:shadow-lg hover:border-[#ffc8bf] ${className}`}
    >
      {children}
    </div>
  );
}

type ResumePreviewProps = {
  resumeFile: File | null;
  resumeURL: string | null;
  resumePreviewType: "none" | "pdf" | "text";
  previewCurrentPage: number;
  previewTotalPages: number;
  previewContainerRef: MutableRefObject<HTMLDivElement | null>;
  onPreviewScroll: () => void;
  onZoomOut: () => void;
  onZoomIn: () => void;
  onDownload: () => void;
  onEnsurePdfRender: () => void;
};

function ResumePreview({
  resumeFile,
  resumeURL,
  resumePreviewType,
  previewCurrentPage,
  previewTotalPages,
  previewContainerRef,
  onPreviewScroll,
  onZoomOut,
  onZoomIn,
  onDownload,
  onEnsurePdfRender,
}: ResumePreviewProps): JSX.Element {
  const lastRenderedURLRef = useRef<string | null>(null);

  useEffect(() => {
    if (resumePreviewType !== "pdf" || !resumeFile || !resumeURL) return;
    if (lastRenderedURLRef.current === resumeURL) return;

    onEnsurePdfRender();
    lastRenderedURLRef.current = resumeURL;
  }, [resumeFile, resumePreviewType, resumeURL, onEnsurePdfRender]);

  return (
    <div className="flex flex-col min-h-0 h-[calc(100vh-52px)] bg-[#E7E7E7] overflow-hidden">
      <div className="sticky top-0 z-10 h-12 border-b border-[#D2D2D4] bg-[#E7E7E7] px-4 flex items-center justify-between">
        <div className="text-xs font-medium text-[#6b6b6b] uppercase tracking-wide">Resume Preview</div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onZoomOut}
            disabled={resumePreviewType !== "pdf"}
            className="w-7 h-7 inline-flex items-center justify-center rounded-md border border-[#D2D2D4] bg-white text-[#6b6b6b] transition-all duration-150 hover:border-[#FF634A] hover:text-[#FF634A] disabled:opacity-40 disabled:cursor-not-allowed"
            aria-label="Zoom out"
          >
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-3.5 h-3.5">
              <path d="M5 12h14" />
            </svg>
          </button>
          <button
            type="button"
            onClick={onZoomIn}
            disabled={resumePreviewType !== "pdf"}
            className="w-7 h-7 inline-flex items-center justify-center rounded-md border border-[#D2D2D4] bg-white text-[#6b6b6b] transition-all duration-150 hover:border-[#FF634A] hover:text-[#FF634A] disabled:opacity-40 disabled:cursor-not-allowed"
            aria-label="Zoom in"
          >
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-3.5 h-3.5">
              <path d="M12 5v14M5 12h14" />
            </svg>
          </button>
          <span className="text-[11px] text-[#6b6b6b] min-w-[68px] text-center">Page {previewCurrentPage} / {previewTotalPages}</span>
          <button
            type="button"
            onClick={onDownload}
            className="w-7 h-7 inline-flex items-center justify-center rounded-md border border-[#D2D2D4] bg-white text-[#6b6b6b] transition-all duration-150 hover:border-[#FF634A] hover:text-[#FF634A]"
            aria-label="Download resume"
          >
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-3.5 h-3.5">
              <path d="M12 3v12" />
              <path d="m7 10 5 5 5-5" />
              <path d="M5 21h14" />
            </svg>
          </button>
        </div>
      </div>

      <div className="preview-chrome relative flex-1 min-h-0 h-full bg-[#D2D2D4]">
        <div
          id="pdf-canvas-container"
          ref={previewContainerRef}
          className="preview-chrome"
          onScroll={onPreviewScroll}
          style={{
            height: "100%",
            overflowY: "auto",
            padding: "20px",
            backgroundColor: "#D2D2D4",
          }}
        />

        {!resumeFile && resumePreviewType === "none" && (
          <div
            id="preview-placeholder"
            className="absolute inset-0 flex items-center justify-center p-5 pointer-events-none"
          >
            <div className="w-full max-w-[380px] rounded-xl border border-dashed border-[#d2d2d4] bg-[#f8f8fa] px-8 py-10 text-center">
              <div className="mx-auto mb-4 w-12 h-12 rounded-lg bg-white border border-[#e7e7e7] flex items-center justify-center text-gray-500">
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  className="w-6 h-6"
                >
                  <path d="M7 3h7l5 5v13a1 1 0 0 1-1 1H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z" />
                  <path d="M14 3v6h6" />
                  <path d="M9 13h6M9 17h6" />
                </svg>
              </div>
              <h3 className="text-sm font-semibold text-[#1a1a1a] tracking-[-0.01em]">Resume Preview</h3>
              <p className="mt-2 text-xs text-gray-500 leading-relaxed">
                Upload a resume to see a live preview here.
              </p>
              <p className="mt-3 text-[11px] text-gray-500">PDF • DOCX • TXT</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
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
      const rawType = String(x.type || "yellow").trim().toLowerCase();
      const safeType: HighlightType =
        rawType === "yellow" ||
        rawType === "red" ||
        rawType === "green" ||
        rawType === "missing keyword" ||
        rawType === "weak phrasing" ||
        rawType === "strong match"
          ? (rawType as HighlightType)
          : "yellow";

      const pageValue = Number(x.page);
      const page = Number.isFinite(pageValue) && pageValue >= 1 ? Math.round(pageValue) : undefined;

      const c = x.coordinates;
      let coordinates: HighlightCoordinates | undefined;
      if (c && typeof c === "object") {
        const coords = c as Record<string, unknown>;
        const cx = Number(coords.x);
        const cy = Number(coords.y);
        const cw = Number(coords.width);
        const ch = Number(coords.height);
        if ([cx, cy, cw, ch].every((n) => Number.isFinite(n))) {
          coordinates = {
            x: Math.max(0, Math.min(1, cx)),
            y: Math.max(0, Math.min(1, cy)),
            width: Math.max(0.01, Math.min(1, cw)),
            height: Math.max(0.01, Math.min(1, ch)),
          };
        }
      }

      // For text-only highlights, keep previous phrase validation.
      if (!coordinates) {
        if (!phrase) return null;
        if (!resumeLower.includes(phrase.toLowerCase())) return null;
      }

      return {
        phrase,
        type: safeType,
        reason: String(x.reason || "Review this phrase."),
        page,
        coordinates,
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
      (s) => `<div style="border:1px solid #D2D2D4;border-radius:8px;padding:10px;margin-bottom:8px;background:#E7E7E7;">
        <div style="font-size:11px;color:#6b6b6b;text-transform:uppercase;letter-spacing:.04em;">${escapeHtml(s.category)}</div>
        <div style="font-size:13px;color:#1a1a1a;margin-top:4px;">${escapeHtml(s.title)}</div>
        <div style="font-size:12px;color:#6b6b6b;margin-top:6px;line-height:1.6;">${escapeHtml(s.detail)}</div>
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
    body { margin: 24px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; color: #1a1a1a; background:#F4F4F6; }
    .muted { color: #6b6b6b; font-size: 12px; }
    .grid { display:grid; grid-template-columns: repeat(4, 1fr); gap: 10px; margin: 12px 0 20px; }
    .cell { border:1px solid #D2D2D4; border-radius:8px; background:#E7E7E7; padding:10px; }
    .label { font-size:11px; color:#6b6b6b; text-transform:uppercase; letter-spacing:.04em; }
    .value { font-size:20px; margin-top:4px; }
    h2 { font-size:14px; margin: 18px 0 8px; font-weight:500; }
    pre { border:1px solid #D2D2D4; border-radius:8px; padding:12px; background:#fff; white-space:pre-wrap; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size:12px; line-height:1.8; }
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

async function extractTextForAPI(file: File): Promise<string> {
  let attempts = 0;
  while (!window.pdfjsLib && attempts < 20) {
    await new Promise((resolve) => window.setTimeout(resolve, 200));
    attempts += 1;
  }
  if (!window.pdfjsLib) {
    throw new Error("PDF.js failed to load");
  }

  window.pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER_CDN_URL;

  const arrayBuffer = await file.arrayBuffer();
  const pdf = await window.pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  let text = "";

  for (let i = 1; i <= pdf.numPages; i += 1) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    text += content.items.map((item) => item.str || "").join(" ") + "\n";
  }

  return text;
}

async function renderPDFToCanvas(
  file: File
): Promise<number> {
  let attempts = 0;
  while (!window.pdfjsLib && attempts < 20) {
    await new Promise((resolve) => window.setTimeout(resolve, 200));
    attempts += 1;
  }
  if (!window.pdfjsLib) {
    console.error("PDF.js failed to load");
    return 0;
  }

  window.pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER_CDN_URL;

  const container = document.getElementById("pdf-canvas-container") as HTMLDivElement | null;
  if (!container) return 0;

  container.innerHTML = `
    <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:300px;gap:12px">
      <div style="width:28px;height:28px;border:2px solid #D2D2D4;border-top-color:#FF634A;border-radius:50%;animation:spin 0.8s linear infinite"></div>
      <span style="font-size:11px;color:#9b9b9b">Rendering preview...</span>
    </div>
  `;

  try {
    const arrayBuffer = await file.arrayBuffer();
    const pdf = await window.pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    container.innerHTML = "";

    let renderedPages = 0;
    for (let pageNum = 1; pageNum <= pdf.numPages; pageNum += 1) {
      const page = await pdf.getPage(pageNum);

      const desiredWidth = 680;
      const viewport = page.getViewport({ scale: 1 });
      const scale = desiredWidth / viewport.width;
      const scaledViewport = page.getViewport({ scale });

      const wrapper = document.createElement("div");
      wrapper.style.cssText = `
        background: white;
        box-shadow: 0 2px 16px rgba(0,0,0,0.12);
        border-radius: 2px;
        margin: 0 auto 20px auto;
        width: ${scaledViewport.width}px;
        overflow: hidden;
      `;

      const canvas = document.createElement("canvas");
      canvas.width = Math.floor(scaledViewport.width);
      canvas.height = Math.floor(scaledViewport.height);
      canvas.style.cssText = "display:block;width:100%;height:auto";

      wrapper.appendChild(canvas);
      container.appendChild(wrapper);

      const ctx = canvas.getContext("2d");
      if (!ctx) continue;
      await page.render({
        canvasContext: ctx,
        viewport: scaledViewport,
        background: "white",
      }).promise;
      renderedPages += 1;
    }

    return renderedPages;
  } catch (err) {
    console.error("PDF render error:", err);
    container.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:center;height:200px;color:#FF634A;font-size:12px;padding:20px;text-align:center">
        Could not render PDF preview. Please paste your resume text in the left panel instead.
      </div>
    `;
    return 0;
  }
}

async function extractDocxText(file: File): Promise<string> {
  if (!window.mammoth) {
    throw new Error("Mammoth not loaded yet.");
  }
  const arrayBuffer = await file.arrayBuffer();
  const result = await window.mammoth.extractRawText({ arrayBuffer });
  return result.value.trim();
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

  if (ext === "pdf") {
    return extractTextForAPI(file);
  }

  if (ext === "docx") {
    return extractDocxText(file);
  }

  throw new Error(`Unsupported ${role} file. Use .txt, .pdf, or .docx`);
}

export default function CVForgeResumeAnalyzer(): JSX.Element {
  const [stage, setStage] = useState<Stage>("input");
  const [showInputStage, setShowInputStage] = useState<boolean>(true);
  const [inputOpaque, setInputOpaque] = useState<boolean>(true);
  const [resultsVisible, setResultsVisible] = useState<boolean>(false);
  const [resumeText, setResumeText] = useState<string>(DEFAULT_RESUME);
  const [resumeTextForAPI, setResumeTextForAPI] = useState<string>(DEFAULT_RESUME);
  const [resumeFileName, setResumeFileName] = useState<string>("");
  const [jdFileName, setJdFileName] = useState<string>("");
  const [resumePreviewStatus, setResumePreviewStatus] = useState<string | null>(null);
  const [isResumeDragOver, setIsResumeDragOver] = useState<boolean>(false);
  const [activeStep, setActiveStep] = useState<number>(-1);
  const [doneSteps, setDoneSteps] = useState<number>(0);
  const [analyzedAt, setAnalyzedAt] = useState<string>("");
  const [atsDelta, setAtsDelta] = useState<number | null>(null);
  const [analyzeError, setAnalyzeError] = useState<string | null>(null);
  const [previewZoom, setPreviewZoom] = useState<number>(1);
  const [previewTotalPages, setPreviewTotalPages] = useState<number>(1);
  const [previewCurrentPage, setPreviewCurrentPage] = useState<number>(1);
  const [resumePreviewType, setResumePreviewType] = useState<"none" | "pdf" | "text">("none");

  const {
    resumeFile: resumeSourceFile,
    resumeURL,
    jobDescription: jobDescriptionText,
    analysisResult,
    setResumeFile,
    setResumeURL,
    setJobDescription,
    setAnalysisResult,
  } = useCVForgeStore();

  const analysis = (analysisResult as AnalysisResult | null) ?? null;

  const MIN_PREVIEW_ZOOM = 0.6;
  const MAX_PREVIEW_ZOOM = 2;
  const PREVIEW_ZOOM_STEP = 0.1;

  const resultsRef = useRef<HTMLDivElement | null>(null);
  const previewContainerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const loadPDFJS = async (): Promise<void> => {
      const existingPdfLib = window.pdfjsLib;
      if (existingPdfLib) {
        existingPdfLib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER_CDN_URL;
        return;
      }

      await new Promise<void>((resolve, reject) => {
        const script = document.createElement("script");
        script.src = PDFJS_CDN_URL;
        script.onload = () => resolve();
        script.onerror = () => reject(new Error("Failed to load PDF.js"));
        document.head.appendChild(script);
      });

      const loadedPdfLib = window.pdfjsLib;
      if (loadedPdfLib) {
        loadedPdfLib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER_CDN_URL;
      }
    };

    void loadPDFJS();
  }, []);

  useEffect(() => {
    const style = document.createElement("style");
    style.textContent =
      "@keyframes spin { to { transform: rotate(360deg); } } @keyframes fadeSlideUp { from { opacity: 0; transform: translateY(16px); } to { opacity: 1; transform: translateY(0); } }";
    document.head.appendChild(style);

    return () => {
      style.remove();
    };
  }, []);

  useEffect(() => {
    if (window.mammoth) return;
    const script = document.createElement("script");
    script.src = MAMMOTH_CDN_URL;
    document.head.appendChild(script);
  }, []);

  const ring = useMemo(() => {
    const score = analysis?.ats_score ?? 0;
    const radius = 24;
    const circumference = 2 * Math.PI * radius;
    const progress = (score / 100) * circumference;
    return { radius, circumference, offset: circumference - progress };
  }, [analysis]);

  const missingKeywordGroups = useMemo(() => {
    if (!analysis) return { critical: [], optional: [] };
    return groupMissingKeywords(analysis.keywords_missing);
  }, [analysis]);

  useEffect(() => {
    if (!jobDescriptionText.trim()) {
      setJobDescription(DEFAULT_JD);
    }
  }, [jobDescriptionText, setJobDescription]);

  useEffect(() => {
    if (!(stage === "input" && showInputStage)) return;

    if (resumeSourceFile && resumePreviewType === "pdf") {
      void renderPDFToCanvas(resumeSourceFile, previewZoom);
      return;
    }

    if (resumePreviewType === "text") {
      renderTextPreview(resumeText);
    }
  }, [stage, showInputStage, resumeSourceFile, resumePreviewType, previewZoom, resumeText]);

  async function renderPDFToCanvas(file: File, zoomLevel: number = 1): Promise<number> {
    let attempts = 0;
    while (!window.pdfjsLib && attempts < 20) {
      await new Promise((resolve) => window.setTimeout(resolve, 200));
      attempts += 1;
    }
    if (!window.pdfjsLib) {
      console.error("PDF.js failed to load");
      return 0;
    }

    window.pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER_CDN_URL;

    const container = previewContainerRef.current;
    if (!container) return 0;

    container.innerHTML = `
      <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:300px;gap:12px">
        <div style="width:28px;height:28px;border:2px solid #D2D2D4;border-top-color:#FF634A;border-radius:50%;animation:spin 0.8s linear infinite"></div>
        <span style="font-size:11px;color:#9b9b9b">Rendering preview...</span>
      </div>
    `;

    try {
      const arrayBuffer = await file.arrayBuffer();
      const pdf = await window.pdfjsLib.getDocument({ data: arrayBuffer }).promise;
      container.innerHTML = "";
      setPreviewTotalPages(pdf.numPages);
      setPreviewCurrentPage(1);

      let renderedPages = 0;
      for (let pageNum = 1; pageNum <= pdf.numPages; pageNum += 1) {
        const page = await pdf.getPage(pageNum);

        const desiredWidth = 680;
        const viewport = page.getViewport({ scale: 1 });
        const scale = (desiredWidth / viewport.width) * zoomLevel;
        const scaledViewport = page.getViewport({ scale });

        const wrapper = document.createElement("div");
        wrapper.style.cssText = `
          position: relative;
          background: white;
          box-shadow: 0 2px 16px rgba(0,0,0,0.12);
          border-radius: 2px;
          margin: 0 auto 20px auto;
          width: ${scaledViewport.width}px;
          overflow: hidden;
        `;
        wrapper.dataset.pageNumber = String(pageNum);

        const canvas = document.createElement("canvas");
        canvas.width = Math.floor(scaledViewport.width);
        canvas.height = Math.floor(scaledViewport.height);
        canvas.style.cssText = "display:block;width:100%;height:auto";

        wrapper.appendChild(canvas);
        container.appendChild(wrapper);

        const ctx = canvas.getContext("2d");
        if (!ctx) continue;
        await page.render({
          canvasContext: ctx,
          viewport: scaledViewport,
          background: "white",
        }).promise;

        const pageHighlights = (analysis?.highlights || []).filter(
          (h) => h.page === pageNum && h.coordinates
        );

        if (pageHighlights.length) {
          const overlayLayer = document.createElement("div");
          overlayLayer.style.cssText = `
            position:absolute;
            inset:0;
            pointer-events:none;
            z-index:5;
          `;

          for (const highlight of pageHighlights) {
            if (!highlight.coordinates) continue;
            const { x, y, width, height } = highlight.coordinates;
            const overlayBox = document.createElement("div");
            const palette = highlightOverlayStyles(highlight.type);
            overlayBox.style.cssText = `
              position:absolute;
              left:${x * 100}%;
              top:${y * 100}%;
              width:${width * 100}%;
              height:${height * 100}%;
              border:${palette.border};
              background:${palette.background};
              border-radius:4px;
              pointer-events:auto;
              cursor:help;
              transition:transform 160ms ease, box-shadow 160ms ease;
            `;

            const tooltip = document.createElement("div");
            tooltip.textContent = highlight.reason;
            tooltip.style.cssText = `
              position:absolute;
              left:0;
              bottom:calc(100% + 6px);
              max-width:260px;
              padding:6px 8px;
              border-radius:6px;
              border:1px solid #d2d2d4;
              background:#ffffff;
              color:${palette.text};
              font-size:11px;
              line-height:1.4;
              box-shadow:0 8px 20px rgba(0,0,0,0.16);
              opacity:0;
              transform:translateY(4px);
              pointer-events:none;
              transition:opacity 140ms ease, transform 140ms ease;
              z-index:20;
            `;

            overlayBox.appendChild(tooltip);

            overlayBox.addEventListener("mouseenter", () => {
              overlayBox.style.transform = "scale(1.01)";
              overlayBox.style.boxShadow = "0 0 0 2px rgba(255,255,255,0.55) inset";
              tooltip.style.opacity = "1";
              tooltip.style.transform = "translateY(0)";
            });

            overlayBox.addEventListener("mouseleave", () => {
              overlayBox.style.transform = "scale(1)";
              overlayBox.style.boxShadow = "none";
              tooltip.style.opacity = "0";
              tooltip.style.transform = "translateY(4px)";
            });

            overlayLayer.appendChild(overlayBox);
          }

          wrapper.appendChild(overlayLayer);
        }

        renderedPages += 1;
      }

      return renderedPages;
    } catch (err) {
      console.error("PDF render error:", err);
      container.innerHTML = `
        <div style="display:flex;align-items:center;justify-content:center;height:200px;color:#FF634A;font-size:12px;padding:20px;text-align:center">
          Could not render PDF preview. Please paste your resume text in the left panel instead.
        </div>
      `;
      return 0;
    }
  }

  function handlePreviewScroll(): void {
    if (resumePreviewType !== "pdf") return;
    const container = previewContainerRef.current;
    if (!container) return;

    const pageNodes = Array.from(container.querySelectorAll<HTMLElement>("[data-page-number]"));
    if (!pageNodes.length) {
      setPreviewCurrentPage(1);
      return;
    }

    const viewportMid = container.scrollTop + container.clientHeight / 2;
    let closestPage = 1;
    let smallestDistance = Number.POSITIVE_INFINITY;

    for (const node of pageNodes) {
      const pageNumber = Number(node.dataset.pageNumber || "1");
      const mid = node.offsetTop + node.offsetHeight / 2;
      const distance = Math.abs(mid - viewportMid);
      if (distance < smallestDistance) {
        smallestDistance = distance;
        closestPage = pageNumber;
      }
    }

    setPreviewCurrentPage(closestPage);
  }

  function handleZoom(delta: number): void {
    if (resumePreviewType !== "pdf" || !resumeSourceFile) return;
    const nextZoom = Math.min(MAX_PREVIEW_ZOOM, Math.max(MIN_PREVIEW_ZOOM, previewZoom + delta));
    if (nextZoom === previewZoom) return;
    setPreviewZoom(nextZoom);
    void renderPDFToCanvas(resumeSourceFile, nextZoom);
  }

  function downloadPreviewSource(): void {
    if (resumeSourceFile) {
      const url = URL.createObjectURL(resumeSourceFile);
      const a = document.createElement("a");
      a.href = url;
      a.download = resumeSourceFile.name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      return;
    }

    const blob = new Blob([resumeText], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "resume.txt";
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  async function callBackendAnalyze(resume: string, jd: string): Promise<AnalysisResult> {
    const response = await fetch(`${BACKEND_BASE_URL}/api/analyze`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        resume_text: resume,
        jd_text: jd,
      }),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({ detail: response.statusText }));
      throw new Error(`Analysis failed (${response.status}): ${errorData.detail || "Unknown error"}`);
    }

    const result = await response.json();
    return normalizeAnalysis(result, resume);
  }

  async function runAnalysis(isReanalyze: boolean): Promise<void> {
    if (!resumeTextForAPI.trim()) {
      alert("Please provide resume content.");
      return;
    }
    if (!jobDescriptionText.trim()) {
      alert("Please provide a job description.");
      return;
    }

    setAnalyzeError(null);

    const previousAts = isReanalyze && analysis ? analysis.ats_score : null;

    if (!isReanalyze && showInputStage) {
      setInputOpaque(false);
      await sleep(300);
      setShowInputStage(false);
    }

    setStage("loading");
    setActiveStep(0);
    setDoneSteps(0);

    try {
      let nextResult: AnalysisResult | null = null;

      for (let i = 0; i < STEPS.length; i += 1) {
        setActiveStep(i);

        if (i === 2) {
          const start = Date.now();
          nextResult = await callBackendAnalyze(resumeTextForAPI, jobDescriptionText);
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

      setAnalysisResult(nextResult);
      setAnalyzedAt(new Date().toLocaleString());
      if (previousAts === null) {
        setAtsDelta(null);
      } else {
        setAtsDelta(nextResult.ats_score - previousAts);
      }
      setResultsVisible(false);
      setStage("results");
      window.requestAnimationFrame(() => {
        setResultsVisible(true);
      });

      window.setTimeout(() => {
        resultsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      }, 120);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Analysis failed. Please try again.";
      console.error("Analysis error:", error);
      setAnalyzeError(message);
      if (!isReanalyze) {
        setShowInputStage(true);
        setInputOpaque(false);
        window.requestAnimationFrame(() => {
          setInputOpaque(true);
        });
      }
      setStage("input");
      setActiveStep(-1);
      setDoneSteps(0);
    }
  }

  function resetToInputStage(): void {
    setStage("input");
    setAnalysisResult(null);
    setAnalyzedAt("");
    setAtsDelta(null);
    setActiveStep(-1);
    setDoneSteps(0);
    setResultsVisible(false);
    setShowInputStage(true);
    setInputOpaque(false);
    window.requestAnimationFrame(() => {
      setInputOpaque(true);
      window.scrollTo({ top: 0, behavior: "smooth" });
    });
  }

  function renderLoadingSteps(): JSX.Element {
    const stepIcons = [
      <svg key="parse" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="w-4 h-4">
        <path d="M7 3h7l5 5v13a1 1 0 0 1-1 1H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z" />
        <path d="M14 3v6h6" />
      </svg>,
      <svg key="skills" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="w-4 h-4">
        <path d="M4 12h16" />
        <path d="M4 7h16" />
        <path d="M4 17h10" />
      </svg>,
      <svg key="match" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="w-4 h-4">
        <path d="m8 8 8 8" />
        <path d="m16 8-8 8" />
        <path d="M4 12h4m8 0h4" />
      </svg>,
      <svg key="ai" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="w-4 h-4">
        <circle cx="12" cy="12" r="4" />
        <path d="M12 2v3M12 19v3M2 12h3M19 12h3" />
      </svg>,
      <svg key="suggest" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="w-4 h-4">
        <path d="M9 18h6" />
        <path d="M10 22h4" />
        <path d="M12 2a7 7 0 0 0-4 12.8c.5.4 1 .9 1.2 1.5L10 18h4l.8-1.7c.2-.6.7-1.1 1.2-1.5A7 7 0 0 0 12 2Z" />
      </svg>,
    ];

    return (
      <div className="w-full max-w-[440px] flex flex-col gap-2">
        {STEPS.map((step, index) => {
          const done = index < doneSteps;
          const active = index === activeStep && !done;
          const pending = !done && !active;

          return (
            <div
              key={step}
              className={`flex items-center gap-3 px-4 py-3 rounded-xl border transition-all duration-300 ${
                done
                  ? "border-[#b8f0d0] bg-[#f0fff6]"
                  : active
                    ? "border-[#FF634A] bg-[#fff7f5] shadow-sm"
                    : "border-[#D2D2D4] bg-[#F4F4F6]"
              }`}
              style={{ transitionDelay: `${index * 80}ms` }}
            >
              <span
                className={`w-7 h-7 rounded-full flex items-center justify-center transition-all duration-300 ${
                  done
                    ? "bg-[#1a7a45] text-white"
                    : active
                      ? "bg-white border border-[#FF634A] text-[#FF634A]"
                      : "bg-white border border-[#D2D2D4] text-[#9b9b9b]"
                }`}
              >
                {done ? (
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" className="w-3.5 h-3.5">
                    <path d="m5 13 4 4L19 7" />
                  </svg>
                ) : active ? (
                  <span className="w-3.5 h-3.5 rounded-full border-2 border-[#FF634A] border-t-transparent animate-spin" />
                ) : (
                  stepIcons[index]
                )}
              </span>

              <div className="flex flex-col">
                <span
                  className={`text-sm transition-colors duration-300 ${
                    done
                      ? "text-[#1a7a45] font-medium"
                      : active
                        ? "text-[#1a1a1a] font-semibold"
                        : "text-[#9b9b9b]"
                  }`}
                >
                  {step}
                </span>
                <span className={`text-[11px] mt-0.5 ${done ? "text-[#3c8e5f]" : active ? "text-[#FF634A]" : "text-[#b2b2b2]"}`}>
                  {done ? "Completed" : active ? "In progress..." : pending ? "Waiting" : ""}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    );
  }

  async function handleResumeUpload(file: File | null): Promise<void> {
    if (!file) return;
    const fileName = file.name;
    const ext = fileName.split(".").pop()?.toLowerCase() || "";
    setResumeFileName(file.name);

    if (resumeURL) {
      URL.revokeObjectURL(resumeURL);
    }
    const nextResumeURL = URL.createObjectURL(file);
    setResumeFile(file);
    setResumeURL(nextResumeURL);

    try {
      if (ext === "pdf") {
        setResumePreviewType("pdf");
        setPreviewCurrentPage(1);
        void renderPDFToCanvas(file, previewZoom);
        const text = await extractTextForAPI(file);
        setResumeText(text);
        setResumeTextForAPI(text);
      } else if (ext === "docx") {
        setResumePreviewType("text");
        setPreviewTotalPages(1);
        setPreviewCurrentPage(1);
        const text = await extractDocxText(file);
        setResumeText(text);
        setResumeTextForAPI(text);
        renderTextPreview(text);
      } else {
        setResumePreviewType("text");
        setPreviewTotalPages(1);
        setPreviewCurrentPage(1);
        const extractedText = await readFileAsText(file);
        setResumeText(extractedText);
        setResumeTextForAPI(extractedText);
        renderTextPreview(extractedText);
      }

      setResumePreviewStatus(null);
    } catch (error) {
      const message = `// Could not extract text from ${fileName}. Please paste your resume manually.`;
      setResumeText(message);
      setResumeTextForAPI(message);
      setResumePreviewStatus(message);
      const errorMessage = error instanceof Error ? error.message : "Unable to process file.";
      alert(errorMessage);
    }
  }

  async function handleJDUpload(file: File | null): Promise<void> {
    if (!file) return;
    try {
      const content = await parseUploadToText(file, "jd");
      setJdFileName(file.name);
      setJobDescription(content);
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

  function renderTextPreview(text: string): void {
    const container = previewContainerRef.current;
    if (!container) return;

    const lines = text.split("\n");
    const wrapper = document.createElement("div");
    wrapper.style.cssText =
      "width:750px;padding:48px 56px;background:white;box-shadow:0 2px 12px rgba(0,0,0,0.12);margin:24px auto;border-radius:2px";

    for (const line of lines) {
      if (!line.trim()) {
        const spacer = document.createElement("div");
        spacer.style.height = "8px";
        wrapper.appendChild(spacer);
        continue;
      }

      const p = document.createElement("p");
      p.style.cssText =
        "font-size:12px;color:#333;line-height:1.8;margin:0;font-family:'Inter',sans-serif";
      p.textContent = line;
      wrapper.appendChild(p);
    }

    container.innerHTML = "";
    container.appendChild(wrapper);
    setPreviewTotalPages(1);
    setPreviewCurrentPage(1);
  }

  return (
    <div className="min-h-screen bg-[#F4F4F6]">
      <header className="sticky top-0 z-[100] w-full h-[52px] bg-white border-b border-[#D2D2D4] px-6 flex items-center justify-between">
        <div className="flex items-center">
          <span className="w-2 h-2 rounded-full bg-[#FF634A]" />
          <span className="text-sm font-semibold text-[#1a1a1a] ml-2">CV FORGE</span>
        </div>
        <button
          type="button"
          onClick={resetToInputStage}
          className="border border-[#D2D2D4] text-xs text-[#ffffff] px-4 py-1.5 rounded-lg bg-[#FF634A]  hover:border-[#d85858] hover:bg-[#fa4b4b] hover:text-[#ffffff] transition-all duration-150 cursor-pointer"
        >
          Logout
        </button>
      </header>

      <main className={stage === "input" && showInputStage ? "h-[calc(100vh-52px)] overflow-hidden" : ""}>
        {showInputStage && (
        <section
          className={`grid grid-cols-[40%_60%] h-[calc(100vh-52px)] border-t border-[#D2D2D4] transition-opacity duration-300 ease-in-out ${
            inputOpaque ? "opacity-100" : "opacity-0"
          }`}
        >
          <div className="border-r border-[#D2D2D4] flex flex-col bg-[#E7E7E7] h-[calc(100vh-52px)] overflow-hidden">
            <div className="flex-1 min-h-0 border-b border-[#D2D2D4] flex flex-col overflow-hidden transition-shadow duration-200 ease-in-out hover:shadow-[0_2px_12px_rgba(255,99,74,0.08)]">
              <div className="px-5 py-3 border-b border-[#D2D2D4] flex items-center gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-[#FF634A]" />
                <span className="text-xs font-medium text-[#6b6b6b] uppercase tracking-wide">Resume Input</span>
              </div>

              <div className="flex-1 min-h-0 flex flex-col overflow-y-auto">
                <div className="mx-4 mt-3">
                  <div className="text-xs font-semibold text-[#1a1a1a] tracking-[0.02em] mb-2">Upload Resume</div>
                </div>

                <label
                  className={`mx-4 border-[1.5px] border-dashed rounded-xl p-5 text-center cursor-pointer relative transition-all duration-200 ease-in-out hover:scale-[1.01] ${
                    isResumeDragOver
                      ? "border-[#FF634A] bg-[#fff6f3]"
                      : "border-[#D2D2D4] bg-[#F4F4F6] hover:border-[#FF634A] hover:bg-[#fff1ee]"
                  }`}
                  onDragEnter={() => setIsResumeDragOver(true)}
                  onDragLeave={() => setIsResumeDragOver(false)}
                  onDragOver={(event) => {
                    event.preventDefault();
                    setIsResumeDragOver(true);
                  }}
                  onDrop={(event) => {
                    event.preventDefault();
                    setIsResumeDragOver(false);
                    void handleResumeUpload(event.dataTransfer.files?.[0] ?? null);
                  }}
                >
                  <input
                    type="file"
                    accept={ACCEPTED_TYPES}
                    className="absolute inset-0 opacity-0 cursor-pointer"
                    onChange={(event) => {
                      setIsResumeDragOver(false);
                      void handleResumeUpload(event.target.files?.[0] ?? null);
                    }}
                  />

                  <div className="mx-auto w-10 h-10 rounded-lg bg-white border border-[#E7E7E7] flex items-center justify-center text-[#6b6b6b]">
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.8"
                      className="w-5 h-5"
                    >
                      <path d="M12 16V8" />
                      <path d="m8.5 11.5 3.5-3.5 3.5 3.5" />
                      <path d="M20 16.5a3.5 3.5 0 0 0-1.8-6.5 5.5 5.5 0 0 0-10.7 1.3A3.2 3.2 0 0 0 8 18h9" />
                    </svg>
                  </div>

                  <div className="text-sm text-[#1a1a1a] font-medium mt-3">
                    {resumeFileName ? "File chosen" : "Drag & drop your resume"}
                  </div>
                  {!resumeFileName && <div className="text-xs text-[#6b6b6b] mt-1">or click to browse</div>}
                  {!resumeFileName && (
                    <div className="text-[11px] text-[#9b9b9b] mt-2">Supported formats: PDF, DOCX, TXT</div>
                  )}

                  {resumeFileName && (
                    <div className="inline-flex rounded-full bg-orange-100 text-orange-600 px-3 py-1 text-xs font-medium mt-3">
                      {resumeFileName}
                    </div>
                  )}
                </label>

                <div className="text-xs text-[#9b9b9b] text-center my-2">or paste resume content</div>

                <textarea
                  value={resumeText}
                  onChange={(event) => {
                    setResumeText(event.target.value);
                    setResumeTextForAPI(event.target.value);
                    setResumePreviewType("text");
                    if (resumeURL) {
                      URL.revokeObjectURL(resumeURL);
                    }
                    setResumeFile(null);
                    setResumeURL(null);
                    setResumeFileName("");
                    setPreviewTotalPages(1);
                    setPreviewCurrentPage(1);
                    renderTextPreview(event.target.value);
                    setResumePreviewStatus(null);
                  }}
                  placeholder="Paste resume text here..."
                  className="mx-4 mb-4 w-[calc(100%-2rem)] flex-1 min-h-0 bg-[#F4F4F6] border border-[#D2D2D4] rounded-lg p-3 text-xs text-[#1a1a1a] leading-relaxed resize-none focus:outline-none focus:border-[#D2D2D4] placeholder-[#9b9b9b]"
                />
              </div>
            </div>

            <div className="flex-1 min-h-0 flex flex-col overflow-hidden transition-shadow duration-200 ease-in-out hover:shadow-[0_2px_12px_rgba(255,99,74,0.08)]">
              <div className="px-5 py-3 border-b border-[#D2D2D4] flex items-center gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-[#FF634A]" />
                <span className="text-xs font-medium text-[#6b6b6b] uppercase tracking-wide">Job Description</span>
              </div>

              <div className="flex-1 min-h-0 flex flex-col overflow-y-auto">
                <label className="mx-4 mt-3 border-[1.5px] border-dashed border-[#D2D2D4] bg-[#F4F4F6] rounded-lg p-5 text-center cursor-pointer relative transition-all duration-200 ease-in-out hover:border-[#FF634A] hover:bg-[#fff1ee] hover:scale-[1.01]">
                  <input
                    type="file"
                    accept={ACCEPTED_TYPES}
                    className="absolute inset-0 opacity-0 cursor-pointer"
                    onChange={(event) => {
                      void handleJDUpload(event.target.files?.[0] ?? null);
                    }}
                  />
                  <div className="mx-auto w-10 h-10 rounded-lg bg-white border border-[#E7E7E7] flex items-center justify-center text-[#6b6b6b]">
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.8"
                      className="w-5 h-5"
                    >
                      <path d="M12 16V8" />
                      <path d="m8.5 11.5 3.5-3.5 3.5 3.5" />
                      <path d="M20 16.5a3.5 3.5 0 0 0-1.8-6.5 5.5 5.5 0 0 0-10.7 1.3A3.2 3.2 0 0 0 8 18h9" />
                    </svg>
                  </div>
                  <div className="text-sm text-[#1a1a1a] font-medium mt-3">
                    {jdFileName ? "File chosen" : "Drag & drop your job description"}
                  </div>
                  {!jdFileName && <div className="text-xs text-[#6b6b6b] mt-1">or click to browse</div>}
                  {!jdFileName && (
                    <div className="text-[11px] text-[#9b9b9b] mt-2">Supported formats: PDF, DOCX, TXT</div>
                  )}
                  {jdFileName && (
                    <div className="inline-flex rounded-full bg-orange-100 text-orange-600 px-3 py-1 text-xs font-medium mt-3">
                      {jdFileName}
                    </div>
                  )}
                </label>

                <div className="text-xs text-[#9b9b9b] text-center my-2">or paste job description</div>

                <textarea
                  value={jobDescriptionText}
                  onChange={(event) => setJobDescription(event.target.value)}
                  placeholder="Paste job description here..."
                  className="mx-4 mb-4 w-[calc(100%-2rem)] flex-1 min-h-0 bg-[#F4F4F6] border border-[#D2D2D4] rounded-lg p-3 text-xs text-[#1a1a1a] leading-relaxed resize-none focus:outline-none focus:border-[#D2D2D4] placeholder-[#9b9b9b]"
                />
              </div>
            </div>

            <div className="px-4 pb-4 pt-4 mt-2">
              <button
                type="button"
                onClick={() => {
                  void runAnalysis(false);
                }}
                disabled={!resumeTextForAPI.trim() || !jobDescriptionText.trim()}
                className="w-full bg-[#FF634A] text-white rounded-lg py-3 font-medium transition-all duration-200 hover:bg-[#ff4b2f] hover:scale-[1.02] disabled:bg-[#ffb2a6] disabled:text-white/90 disabled:cursor-not-allowed disabled:hover:scale-100 disabled:hover:bg-[#ffb2a6]"
              >
                Analyze Resume
              </button>
            </div>
          </div>

          <ResumePreview
            resumeFile={resumeSourceFile}
            resumeURL={resumeURL}
            resumePreviewType={resumePreviewType}
            previewCurrentPage={previewCurrentPage}
            previewTotalPages={previewTotalPages}
            previewContainerRef={previewContainerRef}
            onPreviewScroll={handlePreviewScroll}
            onZoomOut={() => handleZoom(-PREVIEW_ZOOM_STEP)}
            onZoomIn={() => handleZoom(PREVIEW_ZOOM_STEP)}
            onDownload={downloadPreviewSource}
            onEnsurePdfRender={() => {
              if (resumeSourceFile) {
                void renderPDFToCanvas(resumeSourceFile, previewZoom);
              }
            }}
          />
        </section>
        )}

        {stage === "loading" && (
          <section className="min-h-[calc(100vh-52px)] bg-[#F4F4F6] flex flex-col items-center justify-center px-6 transition-opacity duration-300 ease-in-out opacity-100">
            {renderLoadingSteps()}
          </section>
        )}

        {analysis && stage === "results" && (
          <section
            ref={resultsRef}
            className={`border-t border-[#D2D2D4] transition-opacity duration-300 ease-in-out ${
              resultsVisible ? "opacity-100" : "opacity-0"
            }`}
          >
            <div className="max-w-[1200px] mx-auto px-6 pt-8 pb-20">
              <div
                className="flex items-center justify-between mb-7"
                style={{ animation: "fadeSlideUp 0.4s ease-out 0s both" }}
              >
                <div className="flex flex-col">
                  <h2 className="text-[18px] font-semibold text-[#111] tracking-[-0.02em]">Analysis Results</h2>
                  <span className="text-[11px] text-[#9b9b9b] mt-0.5">{analyzedAt}</span>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={resetToInputStage}
                    className="border border-[#D2D2D4] bg-white text-[#1a1a1a] px-[14px] py-2 rounded-lg text-[12px] transition-all duration-150 cursor-pointer hover:border-[#FF634A] hover:text-[#FF634A]"
                  >
                    ← Analyze Another
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      void runAnalysis(true);
                    }}
                    className="border border-[#D2D2D4] bg-white text-[#1a1a1a] px-[14px] py-2 rounded-lg text-[12px] transition-all duration-150 cursor-pointer hover:border-[#FF634A] hover:text-[#FF634A]"
                  >
                    ↻ Re-analyze
                  </button>
                  <button
                    type="button"
                    onClick={exportReport}
                    className="bg-[#FF634A] text-white border-0 px-4 py-2 rounded-lg text-[12px] font-medium transition-all duration-150 cursor-pointer hover:bg-[#e8553d] hover:shadow-[0_4px_12px_rgba(255,99,74,0.3)]"
                  >
                    ↓ Export PDF
                  </button>
                </div>
              </div>

              <div
                className="grid gap-3 mb-8 grid-cols-1 md:grid-cols-2 xl:[grid-template-columns:320px_1fr_1fr_1fr]"
                style={{ animation: "fadeSlideUp 0.4s ease-out 0.1s both" }}
              >
                <InteractiveCard className="px-6 py-7 min-h-[220px] flex flex-col items-center">
                  <div className="mx-auto relative w-[100px] h-[100px]">
                    <svg className="w-[100px] h-[100px] -rotate-90" viewBox="0 0 64 64">
                      <circle cx="32" cy="32" r={ring.radius} fill="none" stroke="#F0F0F0" strokeWidth="8" />
                      <circle
                        cx="32"
                        cy="32"
                        r={ring.radius}
                        fill="none"
                        stroke="#FF634A"
                        strokeWidth="8"
                        strokeLinecap="round"
                        strokeDasharray={ring.circumference}
                        strokeDashoffset={ring.offset}
                        style={{ transition: "stroke-dashoffset 1s ease-out" }}
                      />
                    </svg>
                    <div className="absolute inset-0 flex items-center justify-center text-[28px] font-bold text-[#111]">
                      {analysis.ats_score}
                    </div>
                  </div>

                  {atsDelta !== null && (
                    <div className={`text-[11px] mt-1 ${atsDelta >= 0 ? "text-[#1a7a45]" : "text-[#c0392b]"}`}>
                      {atsDelta >= 0 ? "+" : "-"}
                      {Math.abs(atsDelta)} from previous run
                    </div>
                  )}

                  <div className="text-[10px] text-[#9b9b9b] uppercase tracking-[0.08em] mt-1">ATS Compatibility Score</div>

                  <div className={`inline-flex rounded-full px-[12px] py-1 text-[11px] font-medium mt-auto ${scoreLabelBadgeClasses(analysis.ats_score)}`}>
                    {scoreLabel(analysis.ats_score)}
                  </div>
                </InteractiveCard>

                {[
                  { label: "Skills", value: analysis.skills_score },
                  { label: "Semantic", value: analysis.semantic_score },
                  { label: "Career", value: analysis.career_score },
                ].map((item) => (
                  <InteractiveCard
                    key={item.label}
                    className="px-5 py-6 flex flex-col justify-between"
                  >
                    <div>
                      <div className="text-[36px] leading-none font-bold text-[#111] tracking-[-0.02em]">{item.value}</div>
                      <div className="text-[11px] text-[#9b9b9b] uppercase tracking-[0.08em] mt-1">{item.label}</div>
                    </div>
                    <div className="mt-4">
                      <div className="h-1 bg-[#F0F0F0] rounded-sm overflow-hidden">
                        <div
                          className="h-full rounded-sm transition-[width] duration-1000 ease-out"
                          style={{ width: `${item.value}%`, backgroundColor: scoreBarColor(item.value) }}
                        />
                      </div>
                      <div className={`inline-flex rounded-full px-[10px] py-[3px] text-[10px] font-medium mt-3 ${scoreLabelBadgeClasses(item.value)}`}>
                        {scoreLabel(item.value)}
                      </div>
                    </div>
                  </InteractiveCard>
                ))}
              </div>

              <div
                className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-8 items-start"
                style={{ animation: "fadeSlideUp 0.4s ease-out 0.2s both" }}
              >
                <InteractiveCard className="overflow-hidden">
                  <div className="px-5 py-4 border-b border-[#F0F0F0] flex items-center justify-between">
                    <div className="text-[12px] font-semibold text-[#111] uppercase tracking-[0.06em]">Fixes / Suggestions</div>
                    <span className="text-[11px] bg-[#F4F4F6] text-[#6b6b6b] rounded-[20px] px-2 py-[2px]">
                      {analysis.suggestions.length}
                    </span>
                  </div>
                  <div className="p-4">
                    {analysis.suggestions.map((s, idx) => (
                      <div
                        key={`${s.title}-${idx}`}
                        className={`rounded-[10px] p-3 mb-2 border text-[11.5px] leading-relaxed transition-all duration-200 hover:-translate-y-1 hover:shadow-md ${suggestionClasses(s.type)}`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-2">
                            <span className={`inline-flex w-5 h-5 items-center justify-center rounded-full text-[11px] ${suggestionIconSeverityClasses(s.type)}`}>
                              {suggestionIcon(s.category)}
                            </span>
                            <span className="text-[9px] font-bold uppercase tracking-[0.08em] px-[7px] py-[2px] rounded bg-[rgba(0,0,0,0.06)]">
                              {s.category}
                            </span>
                          </div>
                          <span className="text-[9px] font-bold uppercase tracking-[0.08em] opacity-80">{s.type}</span>
                        </div>
                        <div className="text-[13px] font-semibold mt-1.5 mb-1">{s.title}</div>
                        <div className="opacity-85">{s.detail}</div>
                      </div>
                    ))}
                  </div>
                </InteractiveCard>

                <InteractiveCard className="overflow-hidden">
                  <div className="px-5 py-4 border-b border-[#F0F0F0] flex items-center justify-between">
                    <div className="text-[12px] font-semibold text-[#111] uppercase tracking-[0.06em]">Keywords</div>
                    <span className="text-[11px] bg-[#F4F4F6] text-[#6b6b6b] rounded-[20px] px-2 py-[2px]">
                      {analysis.keywords_found.length + analysis.keywords_missing.length}
                    </span>
                  </div>
                  <div className="p-4">
                    <div className="text-[10px] font-semibold text-[#1a7a45] uppercase tracking-[0.06em] mb-2 flex items-center gap-1.5">
                      <span>✓</span>
                      <span>FOUND</span>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {analysis.keywords_found.map((k) => (
                        <span
                          key={`found-${k}`}
                          className="rounded-full px-3 py-1 text-sm font-medium bg-[#f0fff6] border border-[#b8f0d0] text-[#0a5a30] transition-all duration-150 hover:bg-[#0a5a30] hover:text-white"
                        >
                          {k}
                        </span>
                      ))}
                    </div>

                    <div className="h-px bg-[#F0F0F0] my-3" />

                    <div className="text-[10px] font-semibold text-[#9b2c2c] uppercase tracking-[0.06em] mb-2 flex items-center gap-1.5">
                      <span>✗</span>
                      <span>CRITICAL MISSING</span>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {missingKeywordGroups.critical.map((k) => (
                        <span
                          key={`critical-${k}`}
                          className="rounded-full px-3 py-1 text-sm font-medium bg-[#fff5f5] border border-[#ffcccc] text-[#8a1a1a] transition-all duration-150 hover:bg-gray-200"
                        >
                          {k}
                        </span>
                      ))}
                      {missingKeywordGroups.critical.length === 0 && (
                        <span className="text-[11px] text-[#9b9b9b]">None</span>
                      )}
                    </div>

                    <div className="h-px bg-[#F0F0F0] my-3" />

                    <div className="text-[10px] font-semibold text-[#b86a00] uppercase tracking-[0.06em] mb-2 flex items-center gap-1.5">
                      <span>•</span>
                      <span>NICE TO HAVE</span>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {missingKeywordGroups.optional.map((k) => (
                        <span
                          key={`optional-${k}`}
                          className="rounded-full px-3 py-1 text-sm font-medium bg-[#fff7eb] border border-[#ffd6a6] text-[#b86a00] transition-all duration-150 hover:bg-gray-200"
                        >
                          {k}
                        </span>
                      ))}
                      {missingKeywordGroups.optional.length === 0 && (
                        <span className="text-[11px] text-[#9b9b9b]">None</span>
                      )}
                    </div>
                  </div>
                </InteractiveCard>

                <InteractiveCard className="overflow-hidden">
                  <div className="px-5 py-4 border-b border-[#F0F0F0] flex items-center justify-between">
                    <div className="text-[12px] font-semibold text-[#111] uppercase tracking-[0.06em]">Career Fit</div>
                    <span className="text-[11px] bg-[#F4F4F6] text-[#6b6b6b] rounded-[20px] px-2 py-[2px]">
                      {analysis.career_analysis.transferable_strengths.length + analysis.career_analysis.gaps.length}
                    </span>
                  </div>
                  <div className="p-4">
                    <div className="grid grid-cols-2 gap-2 mb-3">
                      <div className="bg-[#F4F4F6] rounded-[10px] p-3">
                        <div className="text-[9px] font-bold uppercase tracking-[0.06em] text-[#9b9b9b] mb-1">Current</div>
                        <div className="text-[13px] font-semibold text-[#111]">{analysis.career_analysis.current_level}</div>
                      </div>
                      <div className="bg-[#F4F4F6] rounded-[10px] p-3">
                        <div className="text-[9px] font-bold uppercase tracking-[0.06em] text-[#9b9b9b] mb-1">Target</div>
                        <div className="text-[13px] font-semibold text-[#111]">{analysis.career_analysis.target_level}</div>
                      </div>
                    </div>

                    <div className="w-full bg-[#f0f6ff] border border-[#b8d4f8] text-[#1a4f8a] rounded-lg px-3 py-2 text-[12px] font-medium text-center mb-3">
                      {analysis.career_analysis.transition_type}
                    </div>

                    <div className="text-[10px] font-bold text-[#0a5a30] uppercase tracking-[0.06em] mb-1.5">Strengths</div>
                    {analysis.career_analysis.transferable_strengths.map((s) => (
                      <div key={`strength-${s}`} className="flex items-start gap-2 mb-1.5">
                        <span className="w-4 h-4 rounded-full bg-[#f0fff6] border border-[#b8f0d0] text-[#0a5a30] text-[9px] flex items-center justify-center shrink-0">
                          ✓
                        </span>
                        <span className="text-[11.5px] text-[#333] leading-[1.6]">{s}</span>
                      </div>
                    ))}

                    <div className="h-px bg-[#F0F0F0] my-3" />

                    <div className="text-[10px] font-bold text-[#8a1a1a] uppercase tracking-[0.06em] mb-1.5">Gaps</div>
                    {analysis.career_analysis.gaps.map((g) => (
                      <div key={`gap-${g}`} className="flex items-start gap-2 mb-1.5">
                        <span className="w-4 h-4 rounded-full bg-[#fff5f5] border border-[#ffcccc] text-[#8a1a1a] text-[9px] flex items-center justify-center shrink-0">
                          ✗
                        </span>
                        <span className="text-[11.5px] text-[#333] leading-[1.6]">{g}</span>
                      </div>
                    ))}

                    <p className="text-[11.5px] text-[#555] leading-[1.75] bg-[#F4F4F6] rounded-lg p-3 border-l-[3px] border-[#FF634A] mt-3">
                      {analysis.career_analysis.narrative}
                    </p>
                  </div>
                </InteractiveCard>
              </div>
            </div>

          </section>
        )}
      </main>

      {stage === "input" && showInputStage && (
        <>
          {analyzeError && (
            <div
              style={{
                position: "fixed",
                bottom: "100px",
                left: "50%",
                transform: "translateX(-50%)",
                background: "#fdecea",
                border: "1px solid #f5b8b3",
                color: "#9b2c2c",
                borderRadius: "8px",
                padding: "10px 20px",
                fontSize: "12px",
                zIndex: 100,
                maxWidth: "500px",
                textAlign: "center",
              }}
            >
              {analyzeError}
              <button
                onClick={() => setAnalyzeError(null)}
                style={{
                  marginLeft: "12px",
                  color: "#9b2c2c",
                  fontWeight: 600,
                  background: "none",
                  border: "none",
                  cursor: "pointer",
                }}
              >
                ✕
              </button>
            </div>
          )}

        </>
      )}
    </div>
  );
}
