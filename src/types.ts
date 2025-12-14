export interface PullRequestInfo {
  owner: string;
  repo: string;
  number: number;
  title: string;
  body: string | null;
  base: string;
  head: string;
  labels: string[];
}

export interface FileDiff {
  filename: string;
  status: 'added' | 'removed' | 'modified' | 'renamed';
  additions: number;
  deletions: number;
  patch?: string;
}

export interface ProcessedDiff {
  files: FileDiff[];
  totalAdditions: number;
  totalDeletions: number;
  summary: string;
}

export interface PRSummary {
  mainChanges: string[];
  breakingChanges: boolean;
  impactScope: string;
}

export interface GeneratedDocuments {
  prSummary: string;
  readmeChanges?: string;
  adrDraft?: string;
}

export interface SkipReason {
  shouldSkip: boolean;
  reason?: string;
}
