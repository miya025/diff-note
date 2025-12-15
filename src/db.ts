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
