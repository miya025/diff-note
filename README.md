# diff-note

GitHub PRのdiffを解析し、AIが自動でドキュメントを生成するSaaSツール。

## 機能

- **PR要約**: 変更内容を自動で要約
- **README追記候補**: 必要に応じてREADMEへの追記を提案
- **ADRドラフト**: アーキテクチャ決定記録のドラフトを生成

## 利用方法

### 1. GitHub Appをインストール

[diff-note GitHub App](https://github.com/apps/test20251214) をインストールしてください。

インストール時に、diff-noteを使用したいリポジトリを選択します（全リポジトリまたは特定のリポジトリ）。

### 2. PRを作成

通常通りPull Requestを作成するだけです。

### 3. 自動コメント

PRが作成されると、diff-noteが自動的に以下をコメントします：

- PR Summary（変更の要約）
- README追記候補（該当する場合）
- ADRドラフト（アーキテクチャ変更の場合）

## スキップされるPR

以下の条件に該当するPRは自動的にスキップされます：

- 変更が10行未満
- テストファイルのみの変更
- ドキュメントファイルのみの変更
- `no-ai-review`ラベルが付いている
- タイトルに`WIP`または`[skip ci]`が含まれている

## 対応ファイル

以下のロックファイルは解析対象外です：

- package-lock.json
- yarn.lock
- pnpm-lock.yaml
- Gemfile.lock
- Cargo.lock
- poetry.lock
- composer.lock

## セルフホスト

自分でホストする場合は以下の環境変数が必要です：

```
GITHUB_APP_ID=
GITHUB_PRIVATE_KEY=
GITHUB_WEBHOOK_SECRET=
ANTHROPIC_API_KEY=
SUPABASE_URL=
SUPABASE_SERVICE_KEY=
```

### Supabaseテーブル

```sql
CREATE TABLE installations (
  id SERIAL PRIMARY KEY,
  installation_id BIGINT UNIQUE NOT NULL,
  account_login TEXT NOT NULL,
  account_type TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
```

## 技術スタック

- TypeScript
- Vercel Serverless Functions
- GitHub App (Installation Token認証)
- Anthropic Claude API
- Supabase

## ライセンス

MIT
