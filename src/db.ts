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
