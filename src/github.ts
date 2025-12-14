import { Octokit } from '@octokit/rest';
import { FileDiff, PullRequestInfo, ProcessedDiff } from './types';
import { getInstallationOctokit } from './auth';

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

  constructor(octokit: Octokit) {
    this.octokit = octokit;
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
}
