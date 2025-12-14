import { createAppAuth } from '@octokit/auth-app';
import { Octokit } from '@octokit/rest';

export async function getInstallationOctokit(installationId: number): Promise<Octokit> {
  const appId = process.env.GITHUB_APP_ID;
  const privateKey = process.env.GITHUB_PRIVATE_KEY;

  if (!appId || !privateKey) {
    throw new Error('Missing GITHUB_APP_ID or GITHUB_PRIVATE_KEY');
  }

  // Private keyの改行を復元（環境変数では\nが文字列になる）
  const formattedPrivateKey = privateKey.replace(/\\n/g, '\n');

  const auth = createAppAuth({
    appId: parseInt(appId, 10),
    privateKey: formattedPrivateKey,
    installationId,
  });

  const installationAuth = await auth({ type: 'installation' });

  return new Octokit({
    auth: installationAuth.token,
  });
}
