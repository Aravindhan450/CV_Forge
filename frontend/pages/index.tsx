import { useEffect, useMemo, useRef, useState } from "react";

declare global {
  interface Window {
    pdfjsLib?: PdfJsLib;
    mammoth?: MammothLib;
  }
}

type Stage = "input" | "loading" | "results";
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
  "Parsing resume content",
  "Extracting skills & keywords",
  "Running semantic fit analysis",
  "Evaluating career trajectory",
  "Generating ATS report",
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
  const [jobDescriptionText, setJobDescriptionText] = useState<string>(DEFAULT_JD);
  const [resumeFileName, setResumeFileName] = useState<string>("");
  const [jdFileName, setJdFileName] = useState<string>("");
  const [resumePreviewStatus, setResumePreviewStatus] = useState<string | null>(null);

  const [activeStep, setActiveStep] = useState<number>(-1);
  const [doneSteps, setDoneSteps] = useState<number>(0);
  const [analysis, setAnalysis] = useState<AnalysisResult | null>(null);
  const [analyzedAt, setAnalyzedAt] = useState<string>("");
  const [atsDelta, setAtsDelta] = useState<number | null>(null);
  const [analyzeError, setAnalyzeError] = useState<string | null>(null);

  const resultsRef = useRef<HTMLDivElement | null>(null);

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
    style.textContent = "@keyframes spin { to { transform: rotate(360deg); } }";
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

      setAnalysis(nextResult);
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
    setAnalysis(null);
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
    return (
      <div className="w-full max-w-[400px] flex flex-col gap-2">
        {STEPS.map((step, index) => {
          const done = index < doneSteps;
          const active = index === activeStep && !done;
          return (
            <div
              key={step}
              className={`flex items-center gap-3 px-3 py-2 rounded-lg border transition-all duration-300 ${
                done
                  ? "border-[#D2D2D4] bg-[#E7E7E7]"
                  : active
                    ? "border-[#FF634A] bg-[#E7E7E7]"
                    : "border-[#D2D2D4] bg-[#F4F4F6]"
              }`}
            >
              {done && (
                <span className="w-4 h-4 rounded-full bg-[#FF634A] text-white text-[9px] flex items-center justify-center">
                  ✓
                </span>
              )}
              {active && <span className="w-4 h-4 rounded-full border-2 border-[#FF634A] animate-spin" />}
              {!done && !active && <span className="w-4 h-4 rounded-full border border-[#D2D2D4]" />}
              <span
                className={`text-xs ${
                  done ? "text-[#FF634A]" : active ? "font-medium text-[#1a1a1a]" : "text-[#9b9b9b]"
                }`}
              >
                {step}
              </span>
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

    try {
      if (ext === "pdf") {
        void renderPDFToCanvas(file);
        const text = await extractTextForAPI(file);
        setResumeText(text);
        setResumeTextForAPI(text);
      } else if (ext === "docx") {
        const text = await extractDocxText(file);
        setResumeText(text);
        setResumeTextForAPI(text);
        renderTextPreview(text);
      } else {
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

  function renderTextPreview(text: string): void {
    const container = document.getElementById("pdf-canvas-container") as HTMLDivElement | null;
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
                <label className="mx-4 mt-3 border-[1.5px] border-dashed border-[#D2D2D4] bg-[#F4F4F6] rounded-lg p-5 text-center cursor-pointer relative transition-all duration-200 ease-in-out hover:border-[#FF634A] hover:bg-[#fff1ee] hover:scale-[1.01]">
                  <input
                    type="file"
                    accept={ACCEPTED_TYPES}
                    className="absolute inset-0 opacity-0 cursor-pointer"
                    onChange={(event) => {
                      void handleResumeUpload(event.target.files?.[0] ?? null);
                    }}
                  />
                  <div className="text-base text-[#6b6b6b]">⬆</div>
                  <div className="text-xs text-[#6b6b6b] mt-2">Drop resume file or click to upload</div>
                  <div className="text-xs text-[#9b9b9b] mt-1">Accepted: .txt, .pdf, .docx</div>
                  {resumeFileName && (
                    <div className="inline-flex bg-[#fff1ee] text-[#FF634A] border border-[#ffc4b8] rounded-full px-3 py-1 text-xs font-medium mt-2 transition-all duration-200 hover:bg-[#FF634A] hover:text-white">
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
                  <div className="text-base text-[#6b6b6b]">⬆</div>
                  <div className="text-xs text-[#6b6b6b] mt-2">Drop JD file or click to upload</div>
                  <div className="text-xs text-[#9b9b9b] mt-1">Accepted: .txt, .pdf, .docx</div>
                  {jdFileName && (
                    <div className="inline-flex bg-[#fff1ee] text-[#FF634A] border border-[#ffc4b8] rounded-full px-3 py-1 text-xs font-medium mt-2 transition-all duration-200 hover:bg-[#FF634A] hover:text-white">
                      {jdFileName}
                    </div>
                  )}
                </label>

                <div className="text-xs text-[#9b9b9b] text-center my-2">or paste job description</div>

                <textarea
                  value={jobDescriptionText}
                  onChange={(event) => setJobDescriptionText(event.target.value)}
                  placeholder="Paste job description here..."
                  className="mx-4 mb-4 w-[calc(100%-2rem)] flex-1 min-h-0 bg-[#F4F4F6] border border-[#D2D2D4] rounded-lg p-3 text-xs text-[#1a1a1a] leading-relaxed resize-none focus:outline-none focus:border-[#D2D2D4] placeholder-[#9b9b9b]"
                />
              </div>
            </div>
          </div>

          <div className="flex flex-col min-h-0 h-[calc(100vh-52px)] bg-[#E7E7E7] overflow-hidden">
            <div className="px-5 py-3 border-b border-[#D2D2D4] flex items-center gap-2">
              <span className="w-1.5 h-1.5 rounded-full bg-[#FF634A]" />
              <span className="text-xs font-medium text-[#6b6b6b] uppercase tracking-wide">Resume Preview</span>
            </div>

            <div className="preview-chrome flex-1 min-h-0 h-full bg-[#D2D2D4] overflow-y-auto">
              <div
                id="pdf-canvas-container"
                className="preview-chrome"
                style={{
                  height: "100%",
                  overflowY: "auto",
                  padding: "20px",
                  backgroundColor: "#D2D2D4",
                }}
              >
                <div
                  id="preview-placeholder"
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    justifyContent: "center",
                    height: "100%",
                    minHeight: "500px",
                    color: "#aaa",
                    fontSize: "12px",
                    textAlign: "center",
                    gap: "10px",
                  }}
                >
                  <div style={{ fontSize: "28px" }}>📄</div>
                  <div>Upload or paste your resume to preview it here</div>
                </div>
              </div>
            </div>
          </div>
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
            className={`border-t border-[#D2D2D4] pt-8 px-6 pb-16 transition-opacity duration-300 ease-in-out ${
              resultsVisible ? "opacity-100" : "opacity-0"
            }`}
          >
            <div className="flex items-center justify-between mb-6">
              <div className="flex items-center">
                <h2 className="text-sm font-medium text-[#1a1a1a]">Analysis Results</h2>
                <span className="text-xs text-[#9b9b9b] ml-3">{analyzedAt}</span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={resetToInputStage}
                  className="border border-[#D2D2D4] text-xs text-[#1a1a1a] bg-[#F4F4F6] rounded-md px-3 py-1.5 hover:bg-[#E7E7E7] transition-all duration-150"
                >
                  ← Analyze Another
                </button>
                <button
                  type="button"
                  onClick={() => {
                    void runAnalysis(true);
                  }}
                  className="border border-[#D2D2D4] text-xs text-[#1a1a1a] bg-[#F4F4F6] rounded-md px-3 py-1.5 transition-all duration-150 hover:border-[#FF634A] hover:text-[#FF634A]"
                >
                  ↻ Re-analyze
                </button>
                <button
                  type="button"
                  onClick={exportReport}
                  className="border border-[#D2D2D4] text-xs text-[#1a1a1a] bg-[#F4F4F6] rounded-md px-3 py-1.5 transition-all duration-150 hover:border-[#FF634A] hover:text-[#FF634A]"
                >
                  ↓ Export PDF
                </button>
              </div>
            </div>

            <div className="grid grid-cols-4 gap-4 mb-8">
              <div className="bg-[#E7E7E7] border-2 border-[#D2D2D4] rounded-lg p-4 text-center transition-all duration-200 hover:-translate-y-0.5 hover:shadow-[0_4px_16px_rgba(0,0,0,0.08)]">
                <div className="mx-auto relative w-20 h-20 mb-2">
                  <svg className="w-20 h-20 -rotate-90" viewBox="0 0 64 64">
                    <circle cx="32" cy="32" r={ring.radius} fill="none" className="stroke-[#D2D2D4]" strokeWidth="5" />
                    <circle
                      cx="32"
                      cy="32"
                      r={ring.radius}
                      fill="none"
                      className="stroke-[#FF634A] transition-[stroke-dashoffset] duration-700 ease-out"
                      strokeWidth="5"
                      strokeLinecap="round"
                      strokeDasharray={ring.circumference}
                      strokeDashoffset={ring.offset}
                    />
                  </svg>
                  <div className="absolute inset-0 flex items-center justify-center text-2xl font-medium text-[#1a1a1a]">
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
                  <div className={`text-[10px] mt-1 ${atsDelta >= 0 ? "text-[#FF634A]" : "text-red-600"}`}>
                    {atsDelta >= 0 ? "↑" : "↓"} {Math.abs(atsDelta)}
                  </div>
                )}
              </div>

              <div className="bg-[#D2D2D4] border border-[#D2D2D4] rounded-lg p-4 text-center transition-all duration-200 hover:-translate-y-0.5 hover:shadow-[0_4px_16px_rgba(0,0,0,0.08)]">
                <div className="text-2xl font-medium text-[#1a1a1a]">{analysis.skills_score}%</div>
                <div className="text-xs text-[#6b6b6b] mt-1">Skills</div>
              </div>
              <div className="bg-[#D2D2D4] border border-[#D2D2D4] rounded-lg p-4 text-center transition-all duration-200 hover:-translate-y-0.5 hover:shadow-[0_4px_16px_rgba(0,0,0,0.08)]">
                <div className="text-2xl font-medium text-[#1a1a1a]">{analysis.semantic_score}%</div>
                <div className="text-xs text-[#6b6b6b] mt-1">Semantic</div>
              </div>
              <div className="bg-[#D2D2D4] border border-[#D2D2D4] rounded-lg p-4 text-center transition-all duration-200 hover:-translate-y-0.5 hover:shadow-[0_4px_16px_rgba(0,0,0,0.08)]">
                <div className="text-2xl font-medium text-[#1a1a1a]">{analysis.career_score}%</div>
                <div className="text-xs text-[#6b6b6b] mt-1">Career</div>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-4 mb-8">
              <div>
                <div className="text-xs font-medium text-[#6b6b6b] uppercase tracking-wide mb-3">Fixes / Suggestions</div>
                {analysis.suggestions.map((s, idx) => (
                  <div key={`${s.title}-${idx}`} className={`rounded-md border p-3 mb-2 text-xs leading-relaxed transition-all duration-150 hover:translate-x-[3px] hover:shadow-[0_2px_8px_rgba(0,0,0,0.06)] ${suggestionClasses(s.type)}`}>
                    <div className="text-[9px] font-medium uppercase tracking-wide opacity-60 mb-1">{s.category}</div>
                    <div className="font-medium">{s.title}</div>
                    <div className="mt-1">{s.detail}</div>
                  </div>
                ))}
              </div>

              <div>
                <div className="text-xs font-medium text-[#6b6b6b] uppercase tracking-wide mb-3">Keywords</div>

                <div className="text-[10px] font-medium text-[#9b9b9b] uppercase tracking-wide mb-2 mt-3">Found</div>
                <div className="flex flex-wrap gap-1.5">
                  {analysis.keywords_found.map((k) => (
                    <span key={`found-${k}`} className="text-[10px] px-2 py-0.5 bg-green-50 border border-green-200 text-green-700 rounded-full transition-all duration-150 hover:scale-105">
                      {k}
                    </span>
                  ))}
                </div>

                <div className="text-[10px] font-medium text-[#9b9b9b] uppercase tracking-wide mb-2 mt-3">Missing</div>
                <div className="flex flex-wrap gap-1.5">
                  {analysis.keywords_missing.map((k) => (
                    <span key={`missing-${k}`} className="text-[10px] px-2 py-0.5 bg-red-50 border border-red-200 text-red-700 rounded-full transition-all duration-150 hover:scale-105">
                      {k}
                    </span>
                  ))}
                </div>
              </div>

              <div>
                <div className="text-xs font-medium text-[#6b6b6b] uppercase tracking-wide mb-3">Career Fit</div>
                <div className="grid grid-cols-2 gap-2 mb-3">
                  <div className="bg-[#D2D2D4] border border-[#D2D2D4] rounded-md p-2">
                    <div className="text-[10px] font-medium text-[#6b6b6b] uppercase tracking-wide">Current</div>
                    <div className="text-xs text-[#1a1a1a] mt-1">{analysis.career_analysis.current_level}</div>
                  </div>
                  <div className="bg-[#D2D2D4] border border-[#D2D2D4] rounded-md p-2">
                    <div className="text-[10px] font-medium text-[#6b6b6b] uppercase tracking-wide">Target</div>
                    <div className="text-xs text-[#1a1a1a] mt-1">{analysis.career_analysis.target_level}</div>
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

                <p className="bg-[#F4F4F6] border border-[#D2D2D4] rounded-md p-3 text-xs text-[#6b6b6b] leading-relaxed mt-2">
                  {analysis.career_analysis.narrative}
                </p>
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

        <button
          type="button"
          onClick={() => {
            void runAnalysis(false);
          }}
          className="fixed bottom-8 left-1/2 -translate-x-1/2 z-50 bg-[#FF634A] text-white text-sm font-medium px-10 py-3 rounded-xl shadow-[0_4px_16px_rgba(255,99,74,0.35)] transition-all duration-200 hover:-translate-y-[2px] hover:shadow-[0_8px_24px_rgba(255,99,74,0.4)] active:translate-y-0"
        >
          Analyze Resume
        </button>
        </>
      )}
    </div>
  );
}
