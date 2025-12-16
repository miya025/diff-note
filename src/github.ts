import { Octokit } from '@octokit/rest';
import { FileDiff, PullRequestInfo, ProcessedDiff, StructuredDiffOutput, CommitInfo } from './types';
import { getInstallationOctokit } from './auth';
import { DiffProcessor } from './diff-processor';

/**
 * Conventional Commits形式からタイプを抽出
 * 例: "feat: add login" -> "feat"
 *     "fix(auth): resolve token issue" -> "fix"
 */
function parseConventionalCommit(message: string): string | undefined {
  const match = message.match(/^(feat|fix|docs|style|refactor|perf|test|build|ci|chore|revert)(\(.+?\))?[!]?:/i);
  return match ? match[1].toLowerCase() : undefined;
}

// 後方互換用のスキップパターン（レガシー）
const SKIP_PATTERNS = [
  /package-lock\.json$/,
  /yarn\.lock$/,
  /pnpm-lock\.yaml$/,
  /Gemfile\.lock$/,
  /Cargo\.lock$/,
  /poetry\.lock$/,
  /composer\.lock$/,
];

export class GitHubClient {
  private octokit: Octokit;
  private diffProcessor: DiffProcessor;

  constructor(octokit: Octokit) {
    this.octokit = octokit;
    this.diffProcessor = new DiffProcessor();
  }

  static fromToken(token: string): GitHubClient {
    return new GitHubClient(new Octokit({ auth: token }));
  }

  static async fromInstallation(installationId: number): Promise<GitHubClient> {
    const octokit = await getInstallationOctokit(installationId);
    return new GitHubClient(octokit);
  }

  async getPullRequest(owner: string, repo: string, pullNumber: number): Promise<PullRequestInfo> {
    const { data } = await this.octokit.pulls.get({
      owner,
      repo,
      pull_number: pullNumber,
    });

    return {
      owner,
      repo,
      number: pullNumber,
      title: data.title,
      body: data.body,
      base: data.base.sha,
      head: data.head.sha,
      labels: data.labels.map(l => l.name ?? ''),
    };
  }

  /**
   * 構造化されたDiff出力を取得（新API）
   * LLMに最適化されたカテゴリ別・優先度付きの差分データを返す
   */
  async getPRDiffStructured(
    owner: string,
    repo: string,
    pullNumber: number,
    prTitle: string,
    prBody?: string | null
  ): Promise<StructuredDiffOutput> {
    // ファイル一覧とコミット一覧を並列取得
    const [filesResponse, commits] = await Promise.all([
      this.octokit.pulls.listFiles({
        owner,
        repo,
        pull_number: pullNumber,
        per_page: 100,
      }),
      this.getPRCommits(owner, repo, pullNumber),
    ]);

    const files: FileDiff[] = filesResponse.data.map(file => ({
      filename: file.filename,
      status: file.status as FileDiff['status'],
      additions: file.additions,
      deletions: file.deletions,
      patch: file.patch,
    }));

    return this.diffProcessor.process(files, prTitle, pullNumber, prBody ?? undefined, commits);
  }

  /**
   * レガシーAPI（後方互換用）
   * 既存のProcessedDiff形式を返す
   */
  async getPRDiff(owner: string, repo: string, pullNumber: number): Promise<ProcessedDiff> {
    const { data } = await this.octokit.pulls.listFiles({
      owner,
      repo,
      pull_number: pullNumber,
      per_page: 100,
    });

    const files: FileDiff[] = data
      .filter(file => !this.shouldSkipFile(file.filename))
      .map(file => ({
        filename: file.filename,
        status: file.status as FileDiff['status'],
        additions: file.additions,
        deletions: file.deletions,
        patch: file.patch,
      }));

    const totalAdditions = files.reduce((sum, f) => sum + f.additions, 0);
    const totalDeletions = files.reduce((sum, f) => sum + f.deletions, 0);

    return {
      files,
      totalAdditions,
      totalDeletions,
      summary: this.createDiffSummary(files),
    };
  }

  private shouldSkipFile(filename: string): boolean {
    return SKIP_PATTERNS.some(pattern => pattern.test(filename));
  }

  private createDiffSummary(files: FileDiff[]): string {
    return files
      .map(file => {
        const changes = this.extractMeaningfulChanges(file);
        return `- ${file.filename}\n${changes}`;
      })
      .join('\n\n');
  }

  private extractMeaningfulChanges(file: FileDiff): string {
    if (!file.patch) return '  (バイナリファイルまたは変更なし)';

    const lines = file.patch.split('\n');
    const meaningfulChanges: string[] = [];

    for (const line of lines) {
      if (line.startsWith('+') && !line.startsWith('+++')) {
        const content = line.slice(1).trim();
        if (this.isMeaningfulLine(content)) {
          meaningfulChanges.push(`  + ${this.truncate(content, 80)}`);
        }
      } else if (line.startsWith('-') && !line.startsWith('---')) {
        const content = line.slice(1).trim();
        if (this.isMeaningfulLine(content)) {
          meaningfulChanges.push(`  - ${this.truncate(content, 80)}`);
        }
      }
    }

    if (meaningfulChanges.length > 10) {
      return meaningfulChanges.slice(0, 10).join('\n') + `\n  ... (他 ${meaningfulChanges.length - 10} 行)`;
    }

    return meaningfulChanges.join('\n') || '  (軽微な変更)';
  }

  private isMeaningfulLine(content: string): boolean {
    if (!content) return false;
    if (content.startsWith('//') || content.startsWith('#') || content.startsWith('*')) return false;
    if (content === '{' || content === '}' || content === '') return false;
    if (content.startsWith('import ') || content.startsWith('require(')) return false;
    return true;
  }

  private truncate(str: string, maxLength: number): string {
    return str.length > maxLength ? str.slice(0, maxLength) + '...' : str;
  }

  async postPRComment(owner: string, repo: string, pullNumber: number, body: string): Promise<void> {
    await this.octokit.issues.createComment({
      owner,
      repo,
      issue_number: pullNumber,
      body,
    });
  }

  /**
   * PRのコミット一覧を取得
   */
  async getPRCommits(owner: string, repo: string, pullNumber: number): Promise<CommitInfo[]> {
    const { data } = await this.octokit.pulls.listCommits({
      owner,
      repo,
      pull_number: pullNumber,
      per_page: 100,
    });

    return data.map(commit => ({
      sha: commit.sha,
      message: commit.commit.message,
      conventionalType: parseConventionalCommit(commit.commit.message),
    }));
  }
}
