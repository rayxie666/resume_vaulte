export type ResumeKind = "tsx" | "pdf" | "latex";

export interface JobCategory {
  id: number;
  name: string;
  jd_text: string | null;
  notes: string | null;
  icon: string | null;
  color: string | null;
  created_at: string;
  updated_at: string;
}

export interface ResumeVersion {
  id: number;
  category_id: number;
  name: string;
  kind: ResumeKind;
  content: string | null;
  file_path: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface ResumeCheckpoint {
  id: number;
  version_id: number;
  seq: number;
  content: string;
  note: string | null;
  created_at: string;
}
