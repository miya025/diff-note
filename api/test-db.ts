import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    // 1. 環境変数の確認
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_KEY;

    if (!url || !key) {
      return res.status(500).json({
        success: false,
        error: '環境変数が足りません',
        debug: {
          hasUrl: !!url,
          hasKey: !!key,
          urlPrefix: url ? url.substring(0, 30) + '...' : null,
          keyPrefix: key ? key.substring(0, 20) + '...' : null,
        }
      });
    }

    // 2. クライアント作成
    const supabase = createClient(url, key);

    // 3. 接続テスト (repositoriesテーブルを読み込む)
    const { data: readData, error: readError, count } = await supabase
      .from('repositories')
      .select('*', { count: 'exact' })
      .limit(1);

    if (readError) {
      return res.status(500).json({
        success: false,
        message: 'Supabaseへの接続またはクエリに失敗しました',
        errorDetails: readError,
        errorCode: readError.code,
        errorHint: readError.hint,
        errorMessage: readError.message,
      });
    }

    // 4. 書き込みテスト (ダミーデータを入れてすぐ消す)
    const dummyId = 999999999;
    const { data: insertData, error: insertError } = await supabase
      .from('repositories')
      .insert({
        github_repo_id: dummyId,
        owner: 'test-owner',
        name: 'test-repo',
        installation_id: 12345,
        plan: 'free',
        is_active: true,
      })
      .select();

    if (insertError) {
      return res.status(500).json({
        success: false,
        message: '読み込みはできましたが、書き込みに失敗しました',
        errorDetails: insertError,
        errorCode: insertError.code,
        errorHint: insertError.hint,
        errorMessage: insertError.message,
      });
    }

    // 後片付け（テストデータを消す）
    await supabase.from('repositories').delete().eq('github_repo_id', dummyId);

    return res.status(200).json({
      success: true,
      message: '完璧です！DB接続・読み込み・書き込みすべて成功しました。',
      existingRecords: count,
    });

  } catch (e: any) {
    return res.status(500).json({
      success: false,
      error: e.message,
      stack: e.stack
    });
  }
}
