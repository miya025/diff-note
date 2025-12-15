/**
 * パターン定義ファイル
 * ファイルカテゴリ分類、ノイズ除外、トークン予算を定義
 */

// ファイルカテゴリの定義
export type FileCategory =
  | 'backend'    // API, services, models, DB
  | 'frontend'   // Components, pages, hooks
  | 'infra'      // Docker, CI/CD, k8s
  | 'config'     // 設定ファイル
  | 'test'       // テストファイル
  | 'docs'       // ドキュメント
  | 'other';     // その他

// 変更タイプの定義
export type ChangeType =
  | 'feature'     // 新機能
  | 'refactor'    // リファクタリング
  | 'fix'         // バグ修正
  | 'style'       // スタイル変更
  | 'dependency'  // 依存関係更新
  | 'config'      // 設定変更
  | 'docs';       // ドキュメント

// 重要度レベル
export type ImportanceLevel = 'high' | 'medium' | 'low';

/**
 * ファイルカテゴリ分類パターン
 * 各カテゴリに対応する正規表現パターン
 */
export const CATEGORY_PATTERNS: Record<FileCategory, RegExp[]> = {
  backend: [
    // API routes
    /^(api|server|backend)\//,
    /\/api\//,
    /\/(routes|controllers|handlers|endpoints)\//,
    // Services and business logic
    /\/(services|service|lib)\//,
    /\.service\.[jt]sx?$/,
    /\.controller\.[jt]sx?$/,
    /\.handler\.[jt]sx?$/,
    // Models and database
    /\/(models|entities|schemas|db|database|prisma|drizzle)\//,
    /\.model\.[jt]sx?$/,
    /\.entity\.[jt]sx?$/,
    /\/(migrations|seeds)\//,
    // Middleware
    /\/middleware\//,
    /\.middleware\.[jt]sx?$/,
  ],

  frontend: [
    // React/Vue/Next.js components
    /^(src\/)?components\//,
    /^(src\/)?pages\//,
    /^(app|src\/app)\//,
    /\.component\.[jt]sx?$/,
    /\.page\.[jt]sx?$/,
    // Hooks and context
    /\/(hooks|contexts|providers)\//,
    /\.hook\.[jt]sx?$/,
    /use[A-Z][^/]*\.[jt]sx?$/,
    // Styles (non-generated)
    /^(src\/)?styles?\//,
    /\.module\.(css|scss|sass)$/,
    /\.styled\.[jt]sx?$/,
    // State management
    /\/(store|stores|redux|zustand|recoil)\//,
    /\.slice\.[jt]sx?$/,
    /\.store\.[jt]sx?$/,
  ],

  infra: [
    // Docker
    /^Dockerfile/,
    /^docker-compose/,
    /\.docker$/,
    /^\.docker\//,
    // CI/CD
    /^\.github\/(workflows|actions)\//,
    /^\.gitlab-ci/,
    /^\.circleci\//,
    /^Jenkinsfile/,
    /^\.travis\.yml$/,
    /^azure-pipelines/,
    /^bitbucket-pipelines/,
    // Infrastructure as Code
    /^(terraform|tf)\//,
    /\.tf$/,
    /^pulumi\//,
    /^cdk\//,
    // Kubernetes
    /^(k8s|kubernetes|helm|charts)\//,
    // Serverless
    /^serverless\./,
    /^vercel\.json$/,
    /^netlify\.toml$/,
  ],

  config: [
    // Package management
    /^package\.json$/,
    /^tsconfig/,
    /^jsconfig/,
    // Build tools
    /\.(config|rc)\.[jt]sx?$/,
    /^vite\.config/,
    /^webpack\.config/,
    /^rollup\.config/,
    /^esbuild/,
    /^babel\.config/,
    /^\.babelrc/,
    // Linting and formatting
    /^\.eslint/,
    /^\.prettier/,
    /^\.stylelint/,
    /^\.editorconfig$/,
    // Environment
    /^\.env/,
    // Other configs
    /^\.nvmrc$/,
    /^\.node-version$/,
    /^\.tool-versions$/,
  ],

  test: [
    /\.test\.[jt]sx?$/,
    /\.spec\.[jt]sx?$/,
    /\.e2e\.[jt]sx?$/,
    /^(test|tests|__tests__|spec|specs)\//,
    /\/(test|tests|__tests__|spec|specs)\//,
    /^cypress\//,
    /^playwright\//,
    /\.stories\.[jt]sx?$/,
    /^\.storybook\//,
    /jest\.config/,
    /vitest\.config/,
  ],

  docs: [
    /\.md$/,
    /\.mdx$/,
    /\.txt$/,
    /^docs?\//,
    /^README/i,
    /^CHANGELOG/i,
    /^CONTRIBUTING/i,
    /^LICENSE/i,
    /^SECURITY/i,
    /^CODE_OF_CONDUCT/i,
    /\.rst$/,
  ],

  other: [], // Fallback - empty patterns, matched by exclusion
};

/**
 * スキップ対象パターン
 * これらにマッチするファイルはLLMに渡さない
 */
export const SKIP_PATTERNS: RegExp[] = [
  // Lock files
  /package-lock\.json$/,
  /yarn\.lock$/,
  /pnpm-lock\.yaml$/,
  /Gemfile\.lock$/,
  /Cargo\.lock$/,
  /poetry\.lock$/,
  /composer\.lock$/,
  /go\.sum$/,
  /Pipfile\.lock$/,

  // Generated files
  /\.generated\.[jt]sx?$/,
  /\.g\.[jt]sx?$/,
  /\.gen\.[jt]sx?$/,
  /\.auto\.[jt]sx?$/,
  /\/generated\//,
  /\/__generated__\//,

  // Build artifacts
  /\.min\.[jt]sx?$/,
  /\.min\.css$/,
  /\.bundle\.[jt]sx?$/,
  /\.chunk\.[jt]sx?$/,
  /\.map$/,
  /^dist\//,
  /^build\//,
  /^out\//,
  /^\.next\//,
  /^\.nuxt\//,

  // Auto-generated API clients
  /\/swagger\//,
  /\/openapi\//,
  /\.swagger\.[jt]sx?$/,
  /\.openapi\.[jt]sx?$/,
  /\/graphql\/generated\//,
  /__generated__\/graphql/,

  // IDE and editor files
  /\.idea\//,
  /\.vscode\/settings\.json$/,
  /\.vscode\/extensions\.json$/,

  // Binary and assets
  /\.(png|jpg|jpeg|gif|ico|svg|webp)$/i,
  /\.(woff|woff2|ttf|eot)$/i,
  /\.(mp3|mp4|wav|avi|mov)$/i,
  /\.(pdf|zip|tar|gz)$/i,

  // Vendor directories
  /^vendor\//,
  /^node_modules\//,
];

/**
 * フォーマットのみの変更を検出するパターン
 */
export const FORMATTING_PATTERNS: RegExp[] = [
  // Whitespace changes
  /^\s*$/,
  // Semicolon additions/removals
  /^[+-]\s*;?\s*$/,
  // Trailing comma changes
  /^[+-]\s*,?\s*$/,
];

/**
 * カテゴリ別優先度（高いほど優先）
 * トランケーション時にどのカテゴリを優先するか
 */
export const CATEGORY_PRIORITY: Record<FileCategory, number> = {
  backend: 100,
  frontend: 80,
  config: 60,
  infra: 50,
  other: 40,
  docs: 30,
  test: 20,
};

/**
 * カテゴリ別トークン予算
 * 総予算 ~3000トークンの配分
 */
export const CATEGORY_TOKEN_BUDGET: Record<FileCategory, number> = {
  backend: 1000,
  frontend: 800,
  config: 300,
  infra: 300,
  docs: 200,
  test: 200,
  other: 200,
};

/**
 * カテゴリ別ファイル行数制限
 * 各ファイルから抽出する最大行数
 */
export const CATEGORY_LINE_LIMITS: Record<FileCategory, number> = {
  backend: 30,
  frontend: 25,
  infra: 20,
  config: 15,
  other: 15,
  docs: 10,
  test: 10,
};

/**
 * カテゴリの日本語ラベル
 */
export const CATEGORY_LABELS: Record<FileCategory, string> = {
  backend: 'バックエンド',
  frontend: 'フロントエンド',
  infra: 'インフラ',
  config: '設定',
  test: 'テスト',
  docs: 'ドキュメント',
  other: 'その他',
};

/**
 * ADR生成トリガーパターン
 * これらにマッチするファイルがある場合、ADR生成を推奨
 */
export const ADR_TRIGGER_PATTERNS: RegExp[] = [
  /config/i,
  /schema/i,
  /migration/i,
  /\.prisma$/,
  /docker/i,
  /infrastructure/i,
  /\.ya?ml$/,
  /\.tf$/,
  /auth/i,
  /security/i,
];
