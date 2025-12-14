import Anthropic from '@anthropic-ai/sdk';
import { ProcessedDiff, GeneratedDocuments } from './types';

const SYSTEM_PROMPT = `あなたはシニアソフトウェアエンジニアです。
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

  async generatePRSummary(diff: ProcessedDiff, prTitle: string): Promise<GeneratedDocuments> {
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
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: prompt }],
    });

    const prSummary = response.content[0].type === 'text' ? response.content[0].text : '';

    return {
      prSummary,
      readmeChanges: await this.generateReadmeChanges(diff, prTitle),
    };
  }

  private async generateReadmeChanges(diff: ProcessedDiff, prTitle: string): Promise<string | undefined> {
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
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: prompt }],
    });

    return response.content[0].type === 'text' ? response.content[0].text : undefined;
  }

  async generateADR(diff: ProcessedDiff, prTitle: string, prBody: string | null): Promise<string | undefined> {
    const hasArchitecturalChanges = diff.files.some(f =>
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
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: prompt }],
    });

    return response.content[0].type === 'text' ? response.content[0].text : undefined;
  }
}
