/**
 * Diff Processor
 * PR差分を意味単位で整形し、LLMに最適化された構造化出力を生成
 */

import {
  FileDiff,
  EnhancedFileDiff,
  CategorizedFiles,
  StructuredDiffOutput,
  ProcessingStats,
  MeaningfulChange,
  CategorySummary,
} from './types';

import {
  FileCategory,
  ChangeType,
  ImportanceLevel,
  CATEGORY_PATTERNS,
  SKIP_PATTERNS,
  FORMATTING_PATTERNS,
  CATEGORY_PRIORITY,
  CATEGORY_TOKEN_BUDGET,
  CATEGORY_LINE_LIMITS,
  CATEGORY_LABELS,
  ADR_TRIGGER_PATTERNS,
} from './patterns';

export class DiffProcessor {
  private readonly TOTAL_TOKEN_BUDGET = 3000;
  private readonly CHARS_PER_TOKEN = 4; // 概算

  /**
   * メインエントリポイント: 生のファイル差分を構造化出力に変換
   */
  public process(files: FileDiff[], prTitle: string): StructuredDiffOutput {
    // Step 1: スキップパターンでフィルタリング
    const filteredFiles = this.filterSkippedFiles(files);

    // Step 2: 各ファイルにメタデータを追加
    const enhancedFiles = filteredFiles.map((f) => this.enhanceFileDiff(f));

    // Step 3: フォーマットのみの変更を除外
    const meaningfulFiles = enhancedFiles.filter((f) => !f.isFormattingOnly);

    // Step 4: カテゴリ別にグループ化
    const categorized = this.categorizeFiles(meaningfulFiles);

    // Step 5: トークン予算に基づいてトランケーション
    const truncatedCategories = this.applyTruncation(categorized);

    // Step 6: 構造化出力を生成
    return this.buildOutput(truncatedCategories, prTitle, files.length);
  }

  /**
   * Step 1: スキップパターンにマッチするファイルを除外
   */
  private filterSkippedFiles(files: FileDiff[]): FileDiff[] {
    return files.filter((file) => {
      const shouldSkip = SKIP_PATTERNS.some((pattern) =>
        pattern.test(file.filename)
      );
      return !shouldSkip;
    });
  }

  /**
   * Step 2: ファイル差分にメタデータを追加
   */
  private enhanceFileDiff(file: FileDiff): EnhancedFileDiff {
    const category = this.detectCategory(file.filename);
    const meaningfulChanges = this.extractMeaningfulChanges(file);
    const isFormattingOnly = this.detectFormattingOnly(file, meaningfulChanges);
    const changeType = this.detectChangeType(file, meaningfulChanges);
    const importance = this.calculateImportance(file, category, changeType);
    const isGenerated = this.detectGenerated(file);

    return {
      ...file,
      category,
      changeType,
      importance,
      isGenerated,
      isFormattingOnly,
      meaningfulChanges,
      truncated: false,
      originalLineCount: meaningfulChanges.length,
    };
  }

  /**
   * ファイル名からカテゴリを検出
   */
  private detectCategory(filename: string): FileCategory {
    // 優先順でカテゴリをチェック
    const categoryOrder: FileCategory[] = [
      'backend',
      'frontend',
      'infra',
      'test',
      'config',
      'docs',
    ];

    for (const category of categoryOrder) {
      const patterns = CATEGORY_PATTERNS[category];
      if (patterns.some((pattern) => pattern.test(filename))) {
        return category;
      }
    }

    // 未分類のTypeScript/JavaScriptファイルはデフォルトでbackend
    if (/\.[jt]sx?$/.test(filename)) {
      if (filename.includes('component') || filename.includes('page')) {
        return 'frontend';
      }
      return 'backend';
    }

    return 'other';
  }

  /**
   * パッチから意味のある変更を抽出
   */
  private extractMeaningfulChanges(file: FileDiff): MeaningfulChange[] {
    if (!file.patch) return [];

    const changes: MeaningfulChange[] = [];
    const lines = file.patch.split('\n');
    let currentContext = '';
    let lineNumber = 0;

    for (const line of lines) {
      // ハンクヘッダーから行番号を追跡
      const hunkMatch = line.match(/^@@\s+-\d+(?:,\d+)?\s+\+(\d+)/);
      if (hunkMatch) {
        lineNumber = parseInt(hunkMatch[1], 10);
        continue;
      }

      // 変更行以外をスキップ
      if (!line.startsWith('+') && !line.startsWith('-')) {
        if (line.startsWith(' ')) {
          currentContext = line.slice(1).trim();
        }
        lineNumber++;
        continue;
      }

      // ファイルマーカーをスキップ
      if (line.startsWith('+++') || line.startsWith('---')) continue;

      const content = line.slice(1).trim();

      // 意味のある行かチェック
      if (!this.isMeaningfulLine(content)) {
        if (line.startsWith('+')) lineNumber++;
        continue;
      }

      // フォーマットパターンをスキップ
      if (FORMATTING_PATTERNS.some((p) => p.test(content))) {
        if (line.startsWith('+')) lineNumber++;
        continue;
      }

      changes.push({
        type: line.startsWith('+') ? 'added' : 'removed',
        content: this.truncateContent(content, 100),
        context: currentContext || undefined,
        lineNumber: line.startsWith('+') ? lineNumber : undefined,
      });

      if (line.startsWith('+')) lineNumber++;
    }

    return changes;
  }

  /**
   * 行が意味のある内容を含むかチェック
   */
  private isMeaningfulLine(content: string): boolean {
    if (!content) return false;

    // コメントをスキップ
    if (content.startsWith('//')) return false;
    if (content.startsWith('#') && !content.startsWith('#!')) return false;
    if (content.startsWith('/*') || content.startsWith('*')) return false;

    // ブラケットのみをスキップ
    if (/^[{}\[\](),;]+$/.test(content)) return false;

    // 空白のみをスキップ
    if (/^\s*$/.test(content)) return false;

    return true;
  }

  /**
   * フォーマットのみの変更かを検出
   */
  private detectFormattingOnly(
    file: FileDiff,
    changes: MeaningfulChange[]
  ): boolean {
    // 意味のある変更がなければフォーマットのみ
    if (changes.length === 0 && file.additions + file.deletions > 0) {
      return true;
    }

    // すべての変更がフォーマットパターンにマッチ
    if (
      changes.length > 0 &&
      changes.every((c) => FORMATTING_PATTERNS.some((p) => p.test(c.content)))
    ) {
      return true;
    }

    return false;
  }

  /**
   * 変更タイプを検出
   */
  private detectChangeType(
    file: FileDiff,
    changes: MeaningfulChange[]
  ): ChangeType {
    const content = changes.map((c) => c.content).join('\n').toLowerCase();

    // ドキュメント変更
    if (file.filename.match(/\.(md|txt|rst)$/)) {
      return 'docs';
    }

    // 新規ファイル（おそらく機能追加）
    if (file.status === 'added') {
      return 'feature';
    }

    // 依存関係変更
    if (
      file.filename.includes('package.json') ||
      file.filename.includes('requirements.txt')
    ) {
      return 'dependency';
    }

    // 設定変更
    if (file.filename.match(/config|\.env|\.ya?ml$/)) {
      return 'config';
    }

    // 修正パターン
    if (
      content.includes('fix') ||
      content.includes('bug') ||
      content.includes('error') ||
      content.includes('patch')
    ) {
      return 'fix';
    }

    // リファクタパターン（追加と削除が同数）
    if (
      changes.filter((c) => c.type === 'added').length ===
      changes.filter((c) => c.type === 'removed').length
    ) {
      return 'refactor';
    }

    return 'feature';
  }

  /**
   * 重要度を計算
   */
  private calculateImportance(
    file: FileDiff,
    category: FileCategory,
    changeType: ChangeType
  ): ImportanceLevel {
    // 高重要度のトリガー
    if (category === 'backend' && file.additions > 50) return 'high';
    if (changeType === 'feature' && file.status === 'added') return 'high';
    if (
      file.filename.includes('schema') ||
      file.filename.includes('migration')
    )
      return 'high';
    if (file.filename.includes('auth') || file.filename.includes('security'))
      return 'high';

    // 低重要度のトリガー
    if (category === 'test') return 'low';
    if (category === 'docs' && changeType !== 'feature') return 'low';
    if (changeType === 'style') return 'low';

    return 'medium';
  }

  /**
   * 自動生成ファイルかを検出
   */
  private detectGenerated(file: FileDiff): boolean {
    // ファイル名パターン
    if (/\.(generated|g|gen|auto)\.[jt]sx?$/.test(file.filename)) {
      return true;
    }

    // パッチ内の生成マーカー
    if (file.patch) {
      const firstLines = file.patch.split('\n').slice(0, 10).join('\n');
      if (
        firstLines.includes('auto-generated') ||
        firstLines.includes('DO NOT EDIT') ||
        firstLines.includes('@generated')
      ) {
        return true;
      }
    }

    return false;
  }

  /**
   * Step 3: ファイルをカテゴリ別にグループ化
   */
  private categorizeFiles(files: EnhancedFileDiff[]): CategorizedFiles {
    const result: CategorizedFiles = {
      backend: [],
      frontend: [],
      infra: [],
      config: [],
      test: [],
      docs: [],
      other: [],
    };

    for (const file of files) {
      result[file.category].push(file);
    }

    // 各カテゴリを重要度順にソート
    for (const category of Object.keys(result) as FileCategory[]) {
      result[category].sort((a, b) => {
        const importanceOrder = { high: 0, medium: 1, low: 2 };
        return importanceOrder[a.importance] - importanceOrder[b.importance];
      });
    }

    return result;
  }

  /**
   * Step 4: トークン予算に基づいてトランケーション
   */
  private applyTruncation(categories: CategorizedFiles): CategorizedFiles {
    const result = { ...categories };

    // 優先順でカテゴリを処理
    const orderedCategories = (
      Object.keys(categories) as FileCategory[]
    ).sort((a, b) => CATEGORY_PRIORITY[b] - CATEGORY_PRIORITY[a]);

    for (const category of orderedCategories) {
      const budget = CATEGORY_TOKEN_BUDGET[category];
      const lineLimit = CATEGORY_LINE_LIMITS[category];
      let categoryTokens = 0;

      result[category] = categories[category].map((file) => {
        // カテゴリ予算を超えた場合はスキップ
        if (categoryTokens >= budget) {
          return {
            ...file,
            meaningfulChanges: [],
            truncated: true,
          };
        }

        // ファイルの変更をトランケート
        const truncatedChanges = file.meaningfulChanges.slice(0, lineLimit);
        const fileTokens = this.estimateTokens(truncatedChanges);

        if (categoryTokens + fileTokens > budget) {
          // 残り予算で含められる変更数を計算
          const remainingBudget = budget - categoryTokens;
          const avgTokensPerChange =
            truncatedChanges.length > 0
              ? fileTokens / truncatedChanges.length
              : 1;
          const changesWeCanInclude = Math.max(
            1,
            Math.floor(remainingBudget / avgTokensPerChange)
          );

          categoryTokens += this.estimateTokens(
            truncatedChanges.slice(0, changesWeCanInclude)
          );

          return {
            ...file,
            meaningfulChanges: truncatedChanges.slice(0, changesWeCanInclude),
            truncated: changesWeCanInclude < file.meaningfulChanges.length,
          };
        }

        categoryTokens += fileTokens;
        return {
          ...file,
          meaningfulChanges: truncatedChanges,
          truncated: truncatedChanges.length < file.meaningfulChanges.length,
        };
      });
    }

    return result;
  }

  /**
   * 変更のトークン数を推定
   */
  private estimateTokens(changes: MeaningfulChange[]): number {
    const totalChars = changes.reduce(
      (sum, c) => sum + c.content.length + (c.context?.length || 0),
      0
    );
    return Math.ceil(totalChars / this.CHARS_PER_TOKEN);
  }

  /**
   * Step 5: 構造化出力を生成
   */
  private buildOutput(
    categories: CategorizedFiles,
    prTitle: string,
    originalFileCount: number
  ): StructuredDiffOutput {
    const stats = this.calculateStats(categories, originalFileCount);

    return {
      metadata: {
        prTitle,
        totalAdditions: this.sumField(categories, 'additions'),
        totalDeletions: this.sumField(categories, 'deletions'),
        fileCount: stats.processedFiles,
        stats,
      },
      categories,
      summary: {
        prRelevant: this.buildPRRelevantSummary(categories),
        readmeRelevant: this.buildReadmeRelevantSummary(categories),
        adrRelevant: this.buildADRRelevantSummary(categories),
      },
      legacySummary: this.buildLegacySummary(categories),
    };
  }

  /**
   * PR関連のサマリーを生成（すべての重要な変更）
   */
  private buildPRRelevantSummary(
    categories: CategorizedFiles
  ): CategorySummary[] {
    const summaries: CategorySummary[] = [];

    for (const [cat, files] of Object.entries(categories)) {
      const typedFiles = files as EnhancedFileDiff[];
      if (typedFiles.length === 0) continue;

      const highPriorityFiles = typedFiles.filter((f: EnhancedFileDiff) => f.importance !== 'low');
      if (highPriorityFiles.length === 0) continue;

      summaries.push({
        category: cat as FileCategory,
        files: highPriorityFiles.map((f: EnhancedFileDiff) => f.filename),
        highlights: this.extractHighlights(highPriorityFiles),
        hasBreakingChanges: this.detectBreakingChanges(highPriorityFiles),
        changeTypes: [...new Set(highPriorityFiles.map((f: EnhancedFileDiff) => f.changeType))] as ChangeType[],
      });
    }

    return summaries.sort(
      (a, b) => CATEGORY_PRIORITY[b.category] - CATEGORY_PRIORITY[a.category]
    );
  }

  /**
   * README関連のサマリーを生成（機能と修正のみ）
   */
  private buildReadmeRelevantSummary(
    categories: CategorizedFiles
  ): CategorySummary[] {
    const relevantCategories: FileCategory[] = [
      'backend',
      'frontend',
      'config',
    ];
    const relevantTypes: ChangeType[] = ['feature', 'fix'];

    return this.filterSummaries(categories, relevantCategories, relevantTypes);
  }

  /**
   * ADR関連のサマリーを生成（アーキテクチャ変更）
   */
  private buildADRRelevantSummary(
    categories: CategorizedFiles
  ): CategorySummary[] {
    const adrRelevant: CategorySummary[] = [];

    // インフラと設定の変更を含める
    for (const cat of ['infra', 'config', 'backend'] as FileCategory[]) {
      const files = categories[cat].filter(
        (f) =>
          f.importance === 'high' ||
          ADR_TRIGGER_PATTERNS.some((p) => p.test(f.filename)) ||
          f.additions > 100
      );

      if (files.length > 0) {
        adrRelevant.push({
          category: cat,
          files: files.map((f) => f.filename),
          highlights: this.extractHighlights(files),
          hasBreakingChanges: this.detectBreakingChanges(files),
          changeTypes: [...new Set(files.map((f) => f.changeType))],
        });
      }
    }

    return adrRelevant;
  }

  /**
   * 後方互換用のレガシーサマリーを生成
   */
  private buildLegacySummary(categories: CategorizedFiles): string {
    const parts: string[] = [];

    for (const [cat, files] of Object.entries(categories)) {
      const typedFiles = files as EnhancedFileDiff[];
      if (typedFiles.length === 0) continue;

      parts.push(`### ${CATEGORY_LABELS[cat as FileCategory]}`);

      for (const file of typedFiles) {
        const changes = file.meaningfulChanges
          .slice(0, 5)
          .map((c: MeaningfulChange) => `  ${c.type === 'added' ? '+' : '-'} ${c.content}`)
          .join('\n');

        parts.push(`- ${file.filename}`);
        if (changes) parts.push(changes);
        if (file.truncated) {
          parts.push(`  ... (他 ${file.originalLineCount - 5} 行)`);
        }
      }
    }

    return parts.join('\n\n');
  }

  // ヘルパーメソッド
  private truncateContent(content: string, maxLength: number): string {
    return content.length > maxLength
      ? content.slice(0, maxLength) + '...'
      : content;
  }

  private sumField(
    categories: CategorizedFiles,
    field: 'additions' | 'deletions'
  ): number {
    return Object.values(categories)
      .flat()
      .reduce((sum, f) => sum + f[field], 0);
  }

  private calculateStats(
    categories: CategorizedFiles,
    originalCount: number
  ): ProcessingStats {
    const allFiles = Object.values(categories).flat();
    const truncatedCount = allFiles.filter((f) => f.truncated).length;

    const categoryCounts = {} as Record<FileCategory, number>;
    for (const [cat, files] of Object.entries(categories)) {
      categoryCounts[cat as FileCategory] = files.length;
    }

    return {
      totalFiles: originalCount,
      processedFiles: allFiles.length,
      skippedFiles: originalCount - allFiles.length,
      truncatedFiles: truncatedCount,
      estimatedTokens: this.estimateTokens(
        allFiles.flatMap((f) => f.meaningfulChanges)
      ),
      categoryCounts,
    };
  }

  private extractHighlights(files: EnhancedFileDiff[]): string[] {
    return files
      .flatMap((f) => f.meaningfulChanges.slice(0, 2))
      .filter((c) => c.type === 'added')
      .slice(0, 5)
      .map((c) => c.content);
  }

  private detectBreakingChanges(files: EnhancedFileDiff[]): boolean {
    const content = files
      .flatMap((f) => f.meaningfulChanges)
      .map((c) => c.content.toLowerCase())
      .join('\n');

    return (
      content.includes('breaking') ||
      content.includes('deprecated') ||
      content.includes('removed') ||
      content.includes('migration required')
    );
  }

  private filterSummaries(
    categories: CategorizedFiles,
    relevantCategories: FileCategory[],
    relevantTypes: ChangeType[]
  ): CategorySummary[] {
    const summaries: CategorySummary[] = [];

    for (const cat of relevantCategories) {
      const files = categories[cat].filter((f) =>
        relevantTypes.includes(f.changeType)
      );

      if (files.length > 0) {
        summaries.push({
          category: cat,
          files: files.map((f) => f.filename),
          highlights: this.extractHighlights(files),
          hasBreakingChanges: this.detectBreakingChanges(files),
          changeTypes: [...new Set(files.map((f) => f.changeType))],
        });
      }
    }

    return summaries;
  }
}
