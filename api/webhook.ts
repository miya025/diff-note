import type { VercelRequest, VercelResponse } from '@vercel/node';
import crypto from 'crypto';
import { GitHubClient } from '../src/github';
import { LLMClient } from '../src/llm';
import { shouldSkipPR } from '../src/skip';
import { saveInstallation, deleteInstallation, saveRepositories, deactivateRepositories, removeRepositories, ensureRepositoryExists, getRepositoryByGitHubId, checkAndIncrementUsage, isAlreadyProcessed, recordPRProcessed, GitHubRepoPayload } from '../src/db';
import { PullRequestInfo, StructuredDiffOutput } from '../src/types';

function verifyWebhookSignature(req: VercelRequest): boolean {
  const signature = req.headers['x-hub-signature-256'] as string;
  const secret = process.env.GITHUB_WEBHOOK_SECRET;
  if (!signature || !secret) return false;

  const hmac = crypto.createHmac('sha256', secret);
  const digest = 'sha256=' + hmac.update(JSON.stringify(req.body)).digest('hex');

  try {
    return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(digest));
  } catch {
    return false;
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (process.env.GITHUB_WEBHOOK_SECRET && !verifyWebhookSignature(req)) {
    return res.status(401).json({ error: 'Invalid signature' });
  }

  const event = req.headers['x-github-event'] as string;
  const payload = req.body;

  try {
    switch (event) {
      case 'installation':
        await handleInstallation(payload);
        return res.status(200).json({ message: 'Installation handled' });

      case 'installation_repositories':
        await handleInstallationRepositories(payload);
        return res.status(200).json({ message: 'Installation repositories handled' });

      case 'pull_request':
        const action = payload.action;
        if (!['opened', 'synchronize', 'reopened'].includes(action)) {
          return res.status(200).json({ message: 'Ignored action', action });
        }
        await processPullRequest(payload);
        return res.status(200).json({ message: 'Processed' });

      default:
        return res.status(200).json({ message: 'Ignored event', event });
    }
  } catch (error) {
    console.error('Error handling webhook:', error);
    return res.status(500).json({ error: 'Processing failed' });
  }
}

async function handleInstallation(payload: {
  action: string;
  installation: {
    id: number;
    account: {
      login: string;
      type: string;
    };
  };
  repositories?: GitHubRepoPayload[];
}) {
  const { action, installation, repositories } = payload;

  if (action === 'created') {
    await saveInstallation(
      installation.id,
      installation.account.login,
      installation.account.type
    );
    console.log(`Installation created: ${installation.account.login}`);

    // Save repositories if included in payload
    if (repositories && repositories.length > 0) {
      await saveRepositories(installation.id, repositories);
      console.log(`Saved ${repositories.length} repositories`);
    }
  } else if (action === 'deleted') {
    await deactivateRepositories(installation.id);
    await deleteInstallation(installation.id);
    console.log(`Installation deleted: ${installation.account.login}`);
  }
}

async function handleInstallationRepositories(payload: {
  action: string;
  installation: {
    id: number;
  };
  repositories_added?: GitHubRepoPayload[];
  repositories_removed?: Array<{ id: number }>;
}) {
  const { action, installation, repositories_added, repositories_removed } = payload;

  if (action === 'added' && repositories_added && repositories_added.length > 0) {
    await saveRepositories(installation.id, repositories_added);
    console.log(`Added ${repositories_added.length} repositories to installation ${installation.id}`);
  }

  if (action === 'removed' && repositories_removed && repositories_removed.length > 0) {
    const repoIds = repositories_removed.map(r => r.id);
    await removeRepositories(repoIds);
    console.log(`Removed ${repositories_removed.length} repositories from installation ${installation.id}`);
  }
}

async function processPullRequest(payload: {
  pull_request: {
    number: number;
    title: string;
    body: string | null;
    base: { sha: string };
    head: { sha: string };
    labels: Array<{ name: string }>;
  };
  repository: { id: number; owner: { login: string }; name: string };
  installation: { id: number };
}) {
  const installationId = payload.installation?.id;
  const anthropicKey = process.env.ANTHROPIC_API_KEY;

  if (!installationId) {
    throw new Error('Missing installation ID');
  }

  if (!anthropicKey) {
    throw new Error('Missing ANTHROPIC_API_KEY');
  }

  const owner = payload.repository.owner.login;
  const repo = payload.repository.name;
  const pullNumber = payload.pull_request.number;
  const commitSha = payload.pull_request.head.sha;

  // Auto-register repository if not in DB (self-healing)
  await ensureRepositoryExists(
    payload.repository.id,
    owner,
    repo,
    installationId
  );

  // Get repository info and check usage limit
  const repoData = await getRepositoryByGitHubId(payload.repository.id);
  if (repoData) {
    // Idempotency check: skip if already processed this commit
    const alreadyProcessed = await isAlreadyProcessed(repoData.id, pullNumber, commitSha);
    if (alreadyProcessed) {
      console.log(`Already processed commit ${commitSha} for PR #${pullNumber}. Skipping.`);
      return;
    }

    const usageCheck = await checkAndIncrementUsage(repoData.id, repoData.plan);

    if (!usageCheck.allowed) {
      console.log(`Usage limit reached for ${owner}/${repo}: ${usageCheck.reason}`);

      // Post limit notification comment to PR
      const github = await GitHubClient.fromInstallation(installationId);
      const limitComment = `## ⚠️ 無料プランの上限に達しました

今月の自動ドキュメント生成の上限（10回）に達したため、このPRの解析はスキップされました。

続けて利用するには、Proプラン（¥2,980/月）へのアップグレードをご検討ください。

---
*Generated by diff-note*`;

      await github.postPRComment(owner, repo, pullNumber, limitComment);
      console.log(`Posted limit notification to PR #${pullNumber}`);
      return;
    }

    console.log(`Usage: ${usageCheck.currentCount} PRs this month (plan: ${repoData.plan})`);
  }

  const github = await GitHubClient.fromInstallation(installationId);
  const llm = new LLMClient(anthropicKey);

  console.log(`Processing PR #${pullNumber} in ${owner}/${repo}`);

  const pr: PullRequestInfo = {
    owner,
    repo,
    number: pullNumber,
    title: payload.pull_request.title,
    body: payload.pull_request.body,
    base: payload.pull_request.base.sha,
    head: payload.pull_request.head.sha,
    labels: payload.pull_request.labels.map(l => l.name),
  };

  // 構造化Diff APIを使用（カテゴリ分類・ノイズ除外・トークン予算管理済み）
  const structuredDiff = await github.getPRDiffStructured(
    owner,
    repo,
    pullNumber,
    pr.title
  );

  // レガシーDiffも取得（skipチェック用）
  const legacyDiff = await github.getPRDiff(owner, repo, pullNumber);

  const skipCheck = shouldSkipPR(pr, legacyDiff);
  if (skipCheck.shouldSkip) {
    console.log(`Skipping PR #${pullNumber}: ${skipCheck.reason}`);
    return;
  }

  // 処理統計をログ出力
  const stats = structuredDiff.metadata.stats;
  console.log(
    `Files: ${stats.categoryCounts.backend} backend, ` +
    `${stats.categoryCounts.frontend} frontend, ` +
    `${stats.categoryCounts.test} tests, ` +
    `${stats.categoryCounts.docs} docs ` +
    `(${stats.skippedFiles} skipped, ~${stats.estimatedTokens} tokens)`
  );

  // 構造化Diffを使用してドキュメント生成（Few-shot・最適パラメータ適用）
  const docs = await llm.generatePRSummaryFromStructured(structuredDiff);

  let comment = `## PR Summary (AI Generated)\n\n${docs.prSummary}`;

  if (docs.readmeChanges) {
    comment += `\n\n---\n\n### README追記候補\n\n\`\`\`markdown\n${docs.readmeChanges}\n\`\`\``;
  }

  if (docs.adrDraft) {
    comment += `\n\n---\n\n### ADRドラフト\n\n<details>\n<summary>クリックして展開</summary>\n\n${docs.adrDraft}\n\n</details>`;
  }

  comment += '\n\n---\n*Generated by diff-note*';

  await github.postPRComment(owner, repo, pullNumber, comment);
  console.log(`Posted comment to PR #${pullNumber}`);

  // Record successful processing for idempotency
  if (repoData) {
    await recordPRProcessed(repoData.id, pullNumber, commitSha);
  }
}
