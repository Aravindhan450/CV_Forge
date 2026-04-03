import {
  AnalysisResponse,
  AnalysisTaskQueuedResponse,
  AnalysisTaskStatusResponse,
} from "@/lib/types";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000/api/v1";

function withAuth(headers: HeadersInit = {}, accessToken?: string): HeadersInit {
  if (!accessToken) {
    return headers;
  }

  return {
    ...headers,
    Authorization: `Bearer ${accessToken}`,
  };
}

export async function analyzeUpload(
  file: File,
  jobDescription: string,
  accessToken: string,
  previousAnalysisId?: string
): Promise<AnalysisTaskQueuedResponse> {
  const formData = new FormData();
  formData.append("resume_file", file);
  formData.append("job_description", jobDescription);
  if (previousAnalysisId) {
    formData.append("previous_analysis_id", previousAnalysisId);
  }

  const response = await fetch(`${API_BASE}/analysis/upload`, {
    method: "POST",
    headers: withAuth({}, accessToken),
    body: formData,
  });

  if (!response.ok) {
    const payload = await safeJson(response);
    throw new Error(payload?.detail || "Failed to enqueue uploaded resume analysis");
  }

  return response.json();
}

export async function reanalyzeResume(
  resumeText: string,
  jobDescription: string,
  accessToken: string,
  previousAnalysisId?: string
): Promise<AnalysisTaskQueuedResponse> {
  const response = await fetch(`${API_BASE}/analysis/reanalyze`, {
    method: "POST",
    headers: withAuth(
      {
        "Content-Type": "application/json",
      },
      accessToken
    ),
    body: JSON.stringify({
      resume_text: resumeText,
      job_description: jobDescription,
      previous_analysis_id: previousAnalysisId,
    }),
  });

  if (!response.ok) {
    const payload = await safeJson(response);
    throw new Error(payload?.detail || "Failed to enqueue re-analysis");
  }

  return response.json();
}

export async function getAnalysisStatus(
  taskId: string,
  accessToken: string
): Promise<AnalysisTaskStatusResponse> {
  const response = await fetch(`${API_BASE}/analysis-status/${taskId}`, {
    method: "GET",
    headers: withAuth({}, accessToken),
  });

  if (!response.ok) {
    const payload = await safeJson(response);
    throw new Error(payload?.detail || "Failed to fetch analysis status");
  }

  return response.json();
}

export async function pollAnalysisResult(
  taskId: string,
  accessToken: string,
  options?: {
    intervalMs?: number;
    timeoutMs?: number;
    onTick?: (status: AnalysisTaskStatusResponse) => void;
  }
): Promise<AnalysisResponse> {
  const intervalMs = options?.intervalMs ?? 2000;
  const timeoutMs = options?.timeoutMs ?? 120_000;
  const start = Date.now();

  while (Date.now() - start < timeoutMs) {
    const status = await getAnalysisStatus(taskId, accessToken);
    options?.onTick?.(status);

    if (status.status === "completed" && status.result) {
      return status.result;
    }

    if (status.status === "failed") {
      throw new Error(status.error || "Analysis task failed");
    }

    await delay(intervalMs);
  }

  throw new Error("Analysis polling timed out");
}

export async function fetchResumeHistory(accessToken: string): Promise<
  {
    analysis_id: string;
    created_at: string;
    resume_filename: string | null;
    ats_score: number;
    skill_match_score: number;
    semantic_fit_score: number;
  }[]
> {
  const response = await fetch(`${API_BASE}/analysis/history`, {
    method: "GET",
    headers: withAuth({}, accessToken),
  });

  if (!response.ok) {
    const payload = await safeJson(response);
    throw new Error(payload?.detail || "Failed to fetch analysis history");
  }

  return response.json();
}

export async function downloadReport(
  analysisId: string,
  accessToken: string
): Promise<Blob> {
  const response = await fetch(`${API_BASE}/analysis/${analysisId}/report`, {
    method: "GET",
    headers: withAuth({}, accessToken),
  });

  if (!response.ok) {
    const payload = await safeJson(response);
    throw new Error(payload?.detail || "Failed to download analysis report");
  }

  return response.blob();
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function safeJson(response: Response): Promise<{ detail?: string } | null> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}
