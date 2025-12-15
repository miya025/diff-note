# diff-note

GitHub PRのdiffを解析し、AIが自動でドキュメントを生成するSaaSツール。

**PRを読まなくても「何が変わったか」が3分で分かる。**

## こんな人におすすめ

- PRが長くて読むのが辛い
- ドキュメント更新が後回しになる
- 変更の意図が後から分からなくなる

## 機能

- **PR要約**: 変更内容を日本語で自動要約（意図・影響範囲・破壊的変更）
- **README追記候補**: Recent Changes用のテキストを自動生成
- **ADRドラフト**: アーキテクチャ決定記録のドラフトを生成

---

## 利用方法

### ステップ1：GitHub Appをインストール

1. [diff-note GitHub App](https://github.com/apps/diff-note) にアクセス
2. 「Install」ボタンをクリック
3. インストール先を選択：
   - **個人アカウント**: 自分のリポジトリで使用
   - **Organization**: チームのリポジトリで使用
4. アクセス権限を選択：
   - **All repositories**: すべてのリポジトリで有効化
   - **Only select repositories**: 特定のリポジトリのみ選択

### ステップ2：PRを作成

通常通りPull Requestを作成するだけです。特別な設定は不要です。

### ステップ3：自動コメントを確認

PRが作成されると、数秒〜数十秒後に以下のコメントが自動投稿されます：

```
## PR Summary (AI Generated)

[変更内容の要約]

---

### README追記候補

[該当する場合のみ表示]

---

### ADRドラフト

[アーキテクチャ変更がある場合のみ表示]
```

### スキップされるPR

以下の条件に該当するPRは自動的にスキップされます：

| 条件 | 説明 |
|------|------|
| 変更が10行未満 | 軽微な変更はスキップ |
| テストファイルのみ | `*.test.*`, `*.spec.*`, `__tests__/` など |
| ドキュメントのみ | `*.md`, `docs/` など |
| `no-ai-review`ラベル | 手動でスキップしたい場合に使用 |
| タイトルに`WIP` | 作業中のPRはスキップ |
| タイトルに`[skip ci]` | CI スキップ指定 |

### 対応リポジトリ

- **Publicリポジトリ**: 対応
- **Privateリポジトリ**: 対応（インストール時に許可が必要）

---

## 出力例

```
## PR Summary (AI Generated)

- 認証フローにリフレッシュトークン方式を追加
- トークン有効期限の管理ロジックを整理

**破壊的変更**: なし
**影響範囲**: 認証APIを利用するクライアント

---

### README追記候補

- 2025-01-15: 認証にリフレッシュトークン方式を導入

---

### ADRドラフト

# ADR-20250115-リフレッシュトークン導入

## Context
セッション有効期限が短く、ユーザー体験に影響していた

## Decision
リフレッシュトークン方式を採用

## Consequences
- セッション維持が改善
- トークン管理の複雑性が増加
```

---

## 技術スタック

- **Runtime**: Node.js / TypeScript
- **Hosting**: Vercel Serverless Functions
- **Authentication**: GitHub App (Installation Token)
- **AI**: Anthropic Claude API
- **Database**: Supabase (PostgreSQL)

---

## ライセンス

MIT
