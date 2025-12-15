import { createClient, SupabaseClient } from '@supabase/supabase-js';

let supabase: SupabaseClient | null = null;

export function getSupabase(): SupabaseClient {
  if (!supabase) {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_KEY;

    if (!url || !key) {
      throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_KEY');
    }

    supabase = createClient(url, key);
  }

  return supabase;
}

export interface Installation {
  id: number;
  installation_id: number;
  account_login: string;
  account_type: string;
  created_at: string;
}

export async function saveInstallation(
  installationId: number,
  accountLogin: string,
  accountType: string
): Promise<void> {
  const db = getSupabase();

  await db.from('installations').upsert({
    installation_id: installationId,
    account_login: accountLogin,
    account_type: accountType,
  }, {
    onConflict: 'installation_id',
  });
}

export async function deleteInstallation(installationId: number): Promise<void> {
  const db = getSupabase();

  await db.from('installations')
    .delete()
    .eq('installation_id', installationId);
}

export async function getInstallation(installationId: number): Promise<Installation | null> {
  const db = getSupabase();

  const { data } = await db.from('installations')
    .select('*')
    .eq('installation_id', installationId)
    .single();

  return data;
}

// Repository types and functions
export interface Repository {
  id: number;
  github_repo_id: number;
  owner: string;
  name: string;
  installation_id: number;
  plan: string;
  is_active: boolean;
  created_at: string;
}

export interface GitHubRepoPayload {
  id: number;
  name: string;
  full_name: string;
}

export async function saveRepositories(
  installationId: number,
  repos: GitHubRepoPayload[]
): Promise<void> {
  const db = getSupabase();

  for (const repo of repos) {
    const [owner, name] = repo.full_name.split('/');

    console.log(`Saving repository: ${repo.full_name}`);

    const { error } = await db.from('repositories').upsert({
      github_repo_id: repo.id,
      owner: owner,
      name: name,
      installation_id: installationId,
      plan: 'free',
      is_active: true,
    }, {
      onConflict: 'github_repo_id',
    });

    if (error) {
      console.error('Error saving repo:', error);
    }
  }
}

export async function deactivateRepositories(installationId: number): Promise<void> {
  const db = getSupabase();

  const { error } = await db.from('repositories')
    .update({ is_active: false })
    .eq('installation_id', installationId);

  if (error) {
    console.error('Error deactivating repos:', error);
  }
}

export async function removeRepositories(repoIds: number[]): Promise<void> {
  const db = getSupabase();

  const { error } = await db.from('repositories')
    .update({ is_active: false })
    .in('github_repo_id', repoIds);

  if (error) {
    console.error('Error removing repos:', error);
  }
}

// Auto-register repository if not exists (self-healing on PR events)
export async function ensureRepositoryExists(
  githubRepoId: number,
  owner: string,
  repoName: string,
  installationId: number
): Promise<void> {
  const db = getSupabase();

  // Check if repository exists
  const { data: existingRepo } = await db.from('repositories')
    .select('id')
    .eq('github_repo_id', githubRepoId)
    .single();

  // If not exists, register it
  if (!existingRepo) {
    console.log(`Repository not found in DB. Auto-registering: ${owner}/${repoName}`);

    const { error } = await db.from('repositories').insert({
      github_repo_id: githubRepoId,
      owner: owner,
      name: repoName,
      installation_id: installationId,
      plan: 'free',
      is_active: true,
    });

    if (error) {
      console.error('Error auto-registering repo:', error);
    }
  }
}

// Get repository by GitHub repo ID
export async function getRepositoryByGitHubId(githubRepoId: number): Promise<{ id: string; plan: string } | null> {
  const db = getSupabase();

  const { data } = await db.from('repositories')
    .select('id, plan')
    .eq('github_repo_id', githubRepoId)
    .single();

  return data;
}

// Usage check result type
export interface UsageCheckResult {
  allowed: boolean;
  reason?: string;
  currentCount?: number;
}

// Check and increment monthly PR usage
export async function checkAndIncrementUsage(
  repoId: string,
  plan: string
): Promise<UsageCheckResult> {
  const db = getSupabase();
  const currentMonth = new Date().toISOString().slice(0, 7); // e.g., "2025-12"
  const FREE_PLAN_LIMIT = 10;

  // 1. Get current month's usage
  const { data: usage, error: selectError } = await db
    .from('usage_monthly')
    .select('pr_count')
    .eq('repo_id', repoId)
    .eq('year_month', currentMonth)
    .single();

  let currentCount = 0;

  if (selectError && selectError.code !== 'PGRST116') {
    // PGRST116 = no rows returned (expected for first use)
    console.error('Error checking usage:', selectError);
  }

  if (usage) {
    currentCount = usage.pr_count;
  } else {
    // First time this month - create record
    const { error: insertError } = await db.from('usage_monthly').insert({
      repo_id: repoId,
      year_month: currentMonth,
      pr_count: 0,
    });

    if (insertError) {
      console.error('Error creating usage record:', insertError);
    }
  }

  // 2. Check limit (Pro plan = unlimited)
  if (plan === 'free' && currentCount >= FREE_PLAN_LIMIT) {
    return {
      allowed: false,
      reason: `Freeプランの上限（月${FREE_PLAN_LIMIT}件）に達しました。`,
      currentCount,
    };
  }

  // 3. Increment count using RPC for safe concurrent updates
  const { error: rpcError } = await db.rpc('increment_usage', {
    row_repo_id: repoId,
    row_year_month: currentMonth,
  });

  if (rpcError) {
    // Fallback: direct update if RPC doesn't exist
    console.log('RPC not available, using direct update');
    const { error: updateError } = await db
      .from('usage_monthly')
      .update({ pr_count: currentCount + 1 })
      .eq('repo_id', repoId)
      .eq('year_month', currentMonth);

    if (updateError) {
      console.error('Error incrementing usage:', updateError);
    }
  }

  return {
    allowed: true,
    currentCount: currentCount + 1,
  };
}
