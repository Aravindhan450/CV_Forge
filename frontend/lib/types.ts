export type Severity = "low" | "medium" | "high";

export type ATSIssue = {
  issue: string;
  severity: Severity;
  recommendation: string;
};

export type HighlightColor = "green" | "yellow" | "red";

export type HighlightSpan = {
  start: number;
  end: number;
  color: HighlightColor;
  message: string;
  snippet: string;
};

export type AnalysisResponse = {
  analysis_id: string;
  created_at: string;
  resume_text: string;
  scores: {
    ats_score: number;
    skill_match_score: number;
    semantic_fit_score: number;
  };
  score_delta: {
    ats_delta: number;
    skill_delta: number;
    semantic_delta: number;
  };
  parsed_sections: {
    skills: string[];
    experience: string[];
    education: string[];
    projects: string[];
  };
  keywords: {
    resume_keywords: string[];
    jd_keywords: string[];
    found_keywords: string[];
    missing_keywords: string[];
  };
  ats: {
    score: number;
    issues: ATSIssue[];
    diagnostics: Record<string, number>;
  };
  skill_match: {
    score: number;
    matched_skills: string[];
    missing_skills: string[];
    resume_skills: string[];
    job_skills: string[];
  };
  semantic: {
    role_alignment: string;
    strengths: string[];
    weaknesses: string[];
    improvement_suggestions: string[];
    suitability_score: number;
  };
  career_fit: {
    transferable_skills: string[];
    experience_gaps: string[];
    trajectory_summary: string;
    confidence: number;
  };
  highlights: {
    spans: HighlightSpan[];
  };
};

export type AnalysisTaskQueuedResponse = {
  task_id: string;
  status: "processing";
};

export type AnalysisTaskStatusResponse = {
  task_id: string;
  status: "processing" | "completed" | "failed";
  result?: AnalysisResponse;
  error?: string;
};
