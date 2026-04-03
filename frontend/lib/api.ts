import { AnalysisResponse } from "@/lib/types";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000/api/v1";

export async function analyzeUpload(
  file: File,
  jobDescription: string,
  previousAnalysisId?: string
): Promise<AnalysisResponse> {
  const formData = new FormData();
  formData.append("resume_file", file);
  formData.append("job_description", jobDescription);
  if (previousAnalysisId) {
    formData.append("previous_analysis_id", previousAnalysisId);
  }

  const response = await fetch(`${API_BASE}/analysis/upload`, {
    method: "POST",
    body: formData,
  });

  if (!response.ok) {
    const payload = await safeJson(response);
    throw new Error(payload?.detail || "Failed to analyze uploaded resume");
  }

  return response.json();
}

export async function reanalyzeResume(
  resumeText: string,
  jobDescription: string,
  previousAnalysisId?: string
): Promise<AnalysisResponse> {
  const response = await fetch(`${API_BASE}/analysis/reanalyze`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      resume_text: resumeText,
      job_description: jobDescription,
      previous_analysis_id: previousAnalysisId,
    }),
  });

  if (!response.ok) {
    const payload = await safeJson(response);
    throw new Error(payload?.detail || "Failed to re-analyze resume");
  }

  return response.json();
}

export function getReportUrl(analysisId: string): string {
  return `${API_BASE}/analysis/${analysisId}/report`;
}

async function safeJson(response: Response): Promise<{ detail?: string } | null> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}
