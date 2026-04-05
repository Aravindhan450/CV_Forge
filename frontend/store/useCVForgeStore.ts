import { create } from "zustand";

type AnalysisResultState = Record<string, unknown> | null;

type CVForgeStore = {
  resumeFile: File | null;
  resumeURL: string | null;
  jobDescription: string;
  analysisResult: AnalysisResultState;
  setResumeFile: (file: File | null) => void;
  setResumeURL: (url: string | null) => void;
  setJobDescription: (text: string) => void;
  setAnalysisResult: (data: AnalysisResultState) => void;
};

export const useCVForgeStore = create<CVForgeStore>((set) => ({
  resumeFile: null,
  resumeURL: null,
  jobDescription: "",
  analysisResult: null,

  setResumeFile: (file) => set({ resumeFile: file }),
  setResumeURL: (url) => set({ resumeURL: url }),
  setJobDescription: (text) => set({ jobDescription: text }),
  setAnalysisResult: (data) => set({ analysisResult: data }),
}));
