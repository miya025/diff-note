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

/**
 * PRのコミット情報
 */
export interface CommitInfo {
  sha: string;
  message: string;
  /** Conventional Commits形式から抽出されたタイプ (feat, fix, refactor等) */
  conventionalType?: string;
}

// ============================================
// Enhanced Diff Processing Types
// ============================================

import type { FileCategory, ChangeType, ImportanceLevel } from './patterns';

/**
 * 意味のある変更を表す
 */
export interface MeaningfulChange {
  type: 'added' | 'removed';
  content: string;
  context?: string;
  lineNumber?: number;
}

/**
 * 強化されたファイル差分（メタデータ付き）
 */
export interface EnhancedFileDiff extends FileDiff {
  category: FileCategory;
  changeType: ChangeType;
  importance: ImportanceLevel;
  isGenerated: boolean;
  isFormattingOnly: boolean;
  meaningfulChanges: MeaningfulChange[];
  truncated: boolean;
  originalLineCount: number;
}

/**
 * カテゴリ別にグループ化されたファイル
 */
export interface CategorizedFiles {
  backend: EnhancedFileDiff[];
  frontend: EnhancedFileDiff[];
  infra: EnhancedFileDiff[];
  config: EnhancedFileDiff[];
  test: EnhancedFileDiff[];
  docs: EnhancedFileDiff[];
  other: EnhancedFileDiff[];
}

/**
 * 処理統計情報
 */
export interface ProcessingStats {
  totalFiles: number;
  processedFiles: number;
  skippedFiles: number;
  truncatedFiles: number;
  estimatedTokens: number;
  categoryCounts: Record<FileCategory, number>;
}

/**
 * カテゴリサマリー
 */
export interface CategorySummary {
  category: FileCategory;
  files: string[];
  highlights: string[];
  hasBreakingChanges: boolean;
  changeTypes: ChangeType[];
}

/**
 * LLMに渡す構造化Diff出力
 */
export interface StructuredDiffOutput {
  metadata: {
    prTitle: string;
    prNumber: number;
    prBody?: string;
    totalAdditions: number;
    totalDeletions: number;
    fileCount: number;
    stats: ProcessingStats;
    /** PRのコミット情報 */
    commits: CommitInfo[];
  };
  categories: CategorizedFiles;
  summary: {
    /** PR要約に関連する変更 */
    prRelevant: CategorySummary[];
    /** README更新に関連する変更 */
    readmeRelevant: CategorySummary[];
    /** ADR生成に関連する変更 */
    adrRelevant: CategorySummary[];
  };
  /** 後方互換用のレガシーサマリー */
  legacySummary: string;
}
