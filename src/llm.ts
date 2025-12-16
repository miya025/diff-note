import Anthropic from '@anthropic-ai/sdk';
import { ProcessedDiff, GeneratedDocuments, StructuredDiffOutput, MeaningfulChange, EnhancedFileDiff } from './types';
import { ADR_TRIGGER_PATTERNS } from './patterns';

// ============================================
// LLM設定
// ============================================

const LLM_CONFIG = {
  prSummary: {
    model: 'claude-sonnet-4-20250514' as const,
    maxTokens: 1024,
    temperature: 0.3,
  },
  readme: {
    model: 'claude-sonnet-4-20250514' as const,
    maxTokens: 256,
    temperature: 0.2,
  },
  adr: {
    model: 'claude-sonnet-4-20250514' as const,
    maxTokens: 2048,
    temperature: 0.4,
  },
};

// ============================================
// システムプロンプト
// ============================================

const PR_SUMMARY_SYSTEM = `あなたはシニアソフトウェアエンジニアとして、GitHub PRの差分を分析し、日本語でレビュー担当者向けの要約を作成します。

## 役割
PRレビュー担当者が「30秒で変更の本質を理解できる」要約を提供すること。

## 出力ルール
- 実装詳細より「意図」と「影響」を重視
- 箇条書きで最大5点まで
- 技術用語は必要最低限
- 推測には根拠を付記する

## 禁止事項
- コード差分の逐語的説明
- 変更行番号や変数名の羅列
- 根拠のない推測（「〜のためと思われる」）
- 冗長な背景説明
- 変更内容の捏造

## 出力形式
必ず以下の構造で出力:

## 主な変更点
(3点以内で箇条書き)

## 破壊的変更
(ありの場合は具体的に記載、なければ「なし」)

## 影響範囲
(この変更が影響を与えるユーザー・機能・コンポーネント)`;

const README_SYSTEM = `あなたはシニアソフトウェアエンジニアとして、PRの変更内容からREADMEの「Recent Changes」セクション用の履歴エントリを生成します。

## 出力ルール
- 形式: \`- YYYY-MM-DD: 変更内容の簡潔な説明\`
- 1行のみ出力
- 技術的に正確かつ簡潔に
- ユーザーにとっての意味を重視
- 主語を省略した体言止め

## 禁止事項
- 複数行の出力
- 冗長な説明
- 主観的な形容詞（「素晴らしい」「大幅な」等）
- ファイル名の羅列`;

const ADR_SYSTEM = `あなたはシニアソフトウェアアーキテクトとして、PRの変更内容からADR（Architecture Decision Record）のドラフトを作成します。

## ADRの目的
将来のエンジニアが「なぜこの決定をしたのか」を理解できるようにすること。

## 出力構造（厳守）
# ADR-YYYYMMDD-タイトル

## Context
(この決定が必要になった背景・課題)

## Decision
(何を決定したか、どのように実装するか)

## Consequences
(この決定の結果としてのメリットとトレードオフ)

## 各セクションのルール
### Context
- 決定に至った背景・課題を説明
- 「何」ではなく「なぜ変更が必要だったか」

### Decision
- 具体的な技術選択と実装方針
- 検討した代替案がある場合は言及

### Consequences
- **メリット:** と **トレードオフ:** に分けて記載
- 運用面、コスト面、技術面の影響を含む

## 禁止事項
- 「〜と思われる」等の曖昧な表現
- コードの詳細説明
- 実装手順の列挙`;

// レガシー用システムプロンプト（後方互換）
const LEGACY_SYSTEM_PROMPT = `あなたはシニアソフトウェアエンジニアです。
GitHub PRの差分を分析し、レビュー担当者向けに簡潔な要約を作成します。

重要なルール:
- 冗長な説明は禁止
- 実装詳細より「意味」を重視
- 日本語で出力
- コード差分の逐語説明は禁止
- 変更行番号や変数名の羅列は禁止
- 根拠のない推測は禁止`;

export class LLMClient {
  private client: Anthropic;

  constructor(apiKey: string) {
    this.client = new Anthropic({ apiKey });
  }

  // ============================================
  // 新API（構造化Diff対応）
  // ============================================

  /**
   * 構造化Diffを使用してPRサマリーを生成
   */
  async generatePRSummaryFromStructured(
    diff: StructuredDiffOutput
  ): Promise<GeneratedDocuments> {
    const prompt = this.buildPRSummaryPrompt(diff);

    const response = await this.client.messages.create({
      model: LLM_CONFIG.prSummary.model,
      max_tokens: LLM_CONFIG.prSummary.maxTokens,
      temperature: LLM_CONFIG.prSummary.temperature,
      system: PR_SUMMARY_SYSTEM,
      messages: [{ role: 'user', content: prompt }],
    });

    const prSummary =
      response.content[0].type === 'text' ? response.content[0].text : '';

    return {
      prSummary,
      readmeChanges: await this.generateReadmeChangesFromStructured(diff),
      adrDraft: await this.generateADRFromStructured(diff),
    };
  }

  /**
   * PR要約用プロンプトを構築（Few-shot付き）
   */
  private buildPRSummaryPrompt(diff: StructuredDiffOutput): string {
    // コミットメッセージのサマリーを作成
    const commitSummary = this.buildCommitSummary(diff.metadata.commits);

    // PR説明文（長すぎる場合はトランケート）
    const prBody = diff.metadata.prBody
      ? this.truncateText(diff.metadata.prBody, 500)
      : undefined;

    return `以下のGitHub PR差分を読み、PRレビュー担当者向けに要約を作成してください。

---
**例1:**
PR タイトル: ユーザー認証のリファクタリング
変更ファイル数: 3
追加行数: 45
削除行数: 20

差分内容:
- src/auth.ts
  + ログイン時にrefresh_tokenを発行
  + トークン有効期限ロジックを変更
- src/middleware/auth.ts
  + トークン検証ロジックの統一

**理想的な出力:**
## 主な変更点
- 認証フローにリフレッシュトークン方式を追加
- トークン有効期限の管理ロジックを整理・統一

## 破壊的変更
なし

## 影響範囲
認証APIを利用するクライアントアプリケーション

---
**例2:**
PR タイトル: 商品検索APIの新規追加
変更ファイル数: 5
追加行数: 180
削除行数: 10

差分内容:
- src/routes/products.ts
  + GET /api/products/search エンドポイント追加
- src/services/productSearch.ts
  + Elasticsearch連携の検索サービス追加
- src/types/product.ts
  + SearchQuery型の定義追加

**理想的な出力:**
## 主な変更点
- 商品検索API（GET /api/products/search）を新規追加
- Elasticsearchを使用した全文検索機能を実装

## 破壊的変更
なし（新規APIの追加のみ）

## 影響範囲
フロントエンドの商品検索画面（実装が必要）

---
**今回のPR:**
PR タイトル: ${diff.metadata.prTitle}
${prBody ? `PR 説明: ${prBody}` : ''}
変更ファイル数: ${diff.metadata.fileCount}
追加行数: ${diff.metadata.totalAdditions}
削除行数: ${diff.metadata.totalDeletions}
${commitSummary ? `\nコミットメッセージ:\n${commitSummary}` : ''}

差分内容:
${diff.legacySummary}`;
  }

  /**
   * コミットメッセージのサマリーを作成
   */
  private buildCommitSummary(commits: { sha: string; message: string; conventionalType?: string }[]): string {
    if (!commits || commits.length === 0) return '';

    // 最大5件まで表示
    const displayCommits = commits.slice(0, 5);
    const lines = displayCommits.map(c => {
      const firstLine = c.message.split('\n')[0];
      return `- ${this.truncateText(firstLine, 80)}`;
    });

    if (commits.length > 5) {
      lines.push(`... 他 ${commits.length - 5} 件`);
    }

    return lines.join('\n');
  }

  /**
   * テキストをトランケート
   */
  private truncateText(text: string, maxLength: number): string {
    if (text.length <= maxLength) return text;
    return text.slice(0, maxLength) + '...';
  }

  /**
   * 構造化DiffからREADME変更履歴を生成
   */
  private async generateReadmeChangesFromStructured(
    diff: StructuredDiffOutput
  ): Promise<string | undefined> {
    // README更新すべきかの総合判定
    if (!this.shouldGenerateReadme(diff)) {
      return undefined;
    }

    const today = new Date().toISOString().slice(0, 10);
    const prompt = this.buildReadmePrompt(diff, today);

    const response = await this.client.messages.create({
      model: LLM_CONFIG.readme.model,
      max_tokens: LLM_CONFIG.readme.maxTokens,
      temperature: LLM_CONFIG.readme.temperature,
      system: README_SYSTEM,
      messages: [{ role: 'user', content: prompt }],
    });

    return response.content[0].type === 'text'
      ? response.content[0].text
      : undefined;
  }

  /**
   * README更新すべきかを総合判定
   */
  private shouldGenerateReadme(diff: StructuredDiffOutput): boolean {
    const { commits } = diff.metadata;
    const totalChanges = diff.metadata.totalAdditions + diff.metadata.totalDeletions;

    // 1. コミットメッセージにfeat:が含まれる場合は更新すべき
    const hasFeatCommit = commits.some(c => c.conventionalType === 'feat');
    if (hasFeatCommit && totalChanges >= 10) {
      return true;
    }

    // 2. README関連の変更がある場合
    if (diff.summary.readmeRelevant.length > 0 && totalChanges >= 20) {
      return true;
    }

    // 3. 新規APIエンドポイント追加を検出
    const allFiles = Object.values(diff.categories).flat();
    const hasNewEndpoint = allFiles.some(f =>
      f.changeType === 'feature' &&
      (f.filename.includes('route') || f.filename.includes('api') || f.filename.includes('controller')) &&
      f.status === 'added'
    );
    if (hasNewEndpoint) {
      return true;
    }

    // 4. package.jsonに新しい依存関係が追加された
    const hasNewDependency = allFiles.some((f: EnhancedFileDiff) =>
      f.filename.includes('package.json') &&
      f.meaningfulChanges.some((c: MeaningfulChange) =>
        c.type === 'added' &&
        (c.content.includes('"dependencies"') || c.content.includes('"devDependencies"'))
      )
    );
    if (hasNewDependency && totalChanges >= 30) {
      return true;
    }

    return false;
  }

  /**
   * README用プロンプトを構築（Few-shot付き）
   */
  private buildReadmePrompt(diff: StructuredDiffOutput, today: string): string {
    return `以下のPR変更に基づき、READMEの「Recent Changes」セクションに追記する1行の変更履歴を生成してください。

---
**例1:**
PR タイトル: リフレッシュトークン機能の追加
変更内容の要約:
- src/auth/token.ts: generateRefreshToken関数の追加
- src/middleware/auth.ts: refreshTokenの検証ミドルウェア追加

**出力:**
- 2024-12-15: 認証システムにリフレッシュトークン方式を導入

---
**例2:**
PR タイトル: データベースクエリの最適化
変更内容の要約:
- src/repositories/user.ts: バッチ取得への変更、N+1クエリの削除
- src/repositories/product.ts: インデックスヒントの追加

**出力:**
- 2024-12-15: ユーザー・商品取得のN+1問題を解消しクエリ効率を改善

---
**今回のPR:**
PR タイトル: ${diff.metadata.prTitle}
今日の日付: ${today}
変更内容の要約:
${diff.legacySummary}

上記の形式（- YYYY-MM-DD: 説明）で1行のみ出力してください。`;
  }

  /**
   * 構造化DiffからADRドラフトを生成
   */
  private async generateADRFromStructured(
    diff: StructuredDiffOutput
  ): Promise<string | undefined> {
    // ADR生成の必要性をチェック
    if (!this.shouldGenerateADR(diff)) {
      return undefined;
    }

    const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const prNumber = diff.metadata.prNumber;
    const adrPrefix = `${today}-PR${prNumber}`;
    const prompt = this.buildADRPrompt(diff, adrPrefix);

    const response = await this.client.messages.create({
      model: LLM_CONFIG.adr.model,
      max_tokens: LLM_CONFIG.adr.maxTokens,
      temperature: LLM_CONFIG.adr.temperature,
      system: ADR_SYSTEM,
      messages: [{ role: 'user', content: prompt }],
    });

    return response.content[0].type === 'text'
      ? response.content[0].text
      : undefined;
  }

  /**
   * ADR生成が必要かを判定
   */
  private shouldGenerateADR(diff: StructuredDiffOutput): boolean {
    // ADR関連の変更がある場合
    if (diff.summary.adrRelevant.length > 0) {
      return true;
    }

    // すべてのファイルをチェック
    const allFiles = Object.values(diff.categories).flat();

    // ADRトリガーパターンにマッチするファイルがある
    const hasPatternMatch = allFiles.some((f) =>
      ADR_TRIGGER_PATTERNS.some((pattern) => pattern.test(f.filename))
    );

    // 大規模な変更がある
    const hasLargeChanges = allFiles.some((f) => f.additions > 100);

    // 多くのファイルが変更されている
    const hasMultipleFileChanges = allFiles.length >= 5;

    return hasPatternMatch || hasLargeChanges || hasMultipleFileChanges;
  }

  /**
   * ADR用プロンプトを構築（Few-shot付き）
   * @param adrPrefix 日付+PR番号のプレフィックス (例: "20241216-PR42")
   */
  private buildADRPrompt(diff: StructuredDiffOutput, adrPrefix: string): string {
    // PR説明文（長すぎる場合はトランケート）
    const prBody = diff.metadata.prBody
      ? this.truncateText(diff.metadata.prBody, 300)
      : '(なし)';

    return `以下のPR変更に基づき、ADR（Architecture Decision Record）のドラフトを生成してください。

---
**例1:**
PR タイトル: JWT認証からセッション認証への移行
PR 説明: セキュリティ要件の変更に伴い、ステートレスJWT認証からサーバーサイドセッション認証に移行

変更内容:
- src/auth/session.ts (新規追加)
- src/config/auth.ts (認証設定の変更)
- migration/20241215_add_sessions_table.sql

**理想的な出力:**
# ADR-20241215-PR42-セッション認証への移行

## Context
現行のJWT認証方式では、トークンの即時無効化が困難であり、セキュリティインシデント発生時のリスク対応に課題があった。

## Decision
JWT認証からサーバーサイドセッション認証に移行する。Redisをセッションストアとして採用する。

## Consequences
**メリット:**
- セッションの即時無効化が可能になり、セキュリティインシデント対応が迅速化

**トレードオフ:**
- Redisの運用コストが追加で発生
- ステートフルになることでスケーリング設計に考慮が必要

---
**例2:**
PR タイトル: PostgreSQLからMySQLへの移行対応
PR 説明: インフラコスト削減のため移行

変更内容:
- src/db/connection.ts (接続設定の変更)
- prisma/schema.prisma (スキーマ定義の更新)

**理想的な出力:**
# ADR-20241216-PR15-PostgreSQLからMySQLへのデータベース移行

## Context
Aurora PostgreSQLとAurora MySQLのコスト差（約30%）があり、チームのMySQL経験も豊富なため移行が妥当と判断した。

## Decision
データベースエンジンをPostgreSQLからMySQLに変更する。Prismaのプロバイダ変更で対応する。

## Consequences
**メリット:**
- インフラコストの約30%削減

**トレードオフ:**
- PostgreSQL固有機能の代替実装が必要

---
**今回のPR:**
PR タイトル: ${diff.metadata.prTitle}
PR 説明: ${prBody}

変更内容:
${diff.legacySummary}

ADRを以下の形式で出力してください:
# ADR-${adrPrefix}-タイトル`;
  }

  // ============================================
  // レガシーAPI（後方互換用）
  // ============================================

  /**
   * レガシーAPI: ProcessedDiffからPRサマリーを生成
   */
  async generatePRSummary(
    diff: ProcessedDiff,
    prTitle: string
  ): Promise<GeneratedDocuments> {
    const prompt = `以下のGitHub PR差分を読み、PRレビュー担当者向けに要約を作成してください。

PR タイトル: ${prTitle}

変更ファイル数: ${diff.files.length}
追加行数: ${diff.totalAdditions}
削除行数: ${diff.totalDeletions}

差分内容:
${diff.summary}

以下の形式で出力してください:

## 主な変更点
(3点以内で箇条書き)

## 破壊的変更
(ありの場合は具体的に記載、なければ「なし」)

## 影響範囲
(この変更が影響を与えるユーザー・機能・コンポーネント)`;

    const response = await this.client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1024,
      system: LEGACY_SYSTEM_PROMPT,
      messages: [{ role: 'user', content: prompt }],
    });

    const prSummary =
      response.content[0].type === 'text' ? response.content[0].text : '';

    return {
      prSummary,
      readmeChanges: await this.generateReadmeChanges(diff, prTitle),
    };
  }

  /**
   * レガシーAPI: README変更履歴を生成
   */
  private async generateReadmeChanges(
    diff: ProcessedDiff,
    prTitle: string
  ): Promise<string | undefined> {
    if (diff.totalAdditions + diff.totalDeletions < 20) {
      return undefined;
    }

    const prompt = `以下のPR変更に基づき、READMEの「Recent Changes」セクションに追記する1行の変更履歴を生成してください。

PR タイトル: ${prTitle}
変更内容の要約:
${diff.summary}

形式: - YYYY-MM-DD: 変更内容の簡潔な説明

今日の日付を使用してください。`;

    const response = await this.client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 256,
      system: LEGACY_SYSTEM_PROMPT,
      messages: [{ role: 'user', content: prompt }],
    });

    return response.content[0].type === 'text'
      ? response.content[0].text
      : undefined;
  }

  /**
   * レガシーAPI: ADRドラフトを生成
   */
  async generateADR(
    diff: ProcessedDiff,
    prTitle: string,
    prBody: string | null
  ): Promise<string | undefined> {
    const hasArchitecturalChanges = diff.files.some(
      (f) =>
        f.filename.includes('config') ||
        f.filename.includes('schema') ||
        f.filename.includes('migration') ||
        f.additions > 100
    );

    if (!hasArchitecturalChanges) {
      return undefined;
    }

    const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const prompt = `以下のPR変更に基づき、ADR（Architecture Decision Record）のドラフトを生成してください。

PR タイトル: ${prTitle}
PR 説明: ${prBody || '(なし)'}

変更内容:
${diff.summary}

以下の形式で出力:

# ADR-${today}-タイトル

## Context
(この決定が必要になった背景)

## Decision
(何を決定したか)

## Consequences
(この決定の結果、メリットとトレードオフ)`;

    const response = await this.client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1024,
      system: LEGACY_SYSTEM_PROMPT,
      messages: [{ role: 'user', content: prompt }],
    });

    return response.content[0].type === 'text'
      ? response.content[0].text
      : undefined;
  }
}
