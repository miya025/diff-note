import { ProcessedDiff, PullRequestInfo, SkipReason } from './types';

const DOCS_PATTERNS = [
  /\.md$/,
  /\.txt$/,
  /^docs\//,
  /^README/i,
  /^CHANGELOG/i,
  /^LICENSE/i,
];

const TEST_PATTERNS = [
  /\.test\.[jt]sx?$/,
  /\.spec\.[jt]sx?$/,
  /^test\//,
  /^tests\//,
  /__tests__\//,
];

const COMMENT_ONLY_PATTERNS = [
  /\.css$/,
  /\.scss$/,
  /\.less$/,
];

export function shouldSkipPR(pr: PullRequestInfo, diff: ProcessedDiff): SkipReason {
  if (pr.labels.includes('skip-doc')) {
    return { shouldSkip: true, reason: 'skip-docラベルが付与されています' };
  }

  const totalChanges = diff.totalAdditions + diff.totalDeletions;
  if (totalChanges < 10) {
    return { shouldSkip: true, reason: `変更行数が10行未満です (${totalChanges}行)` };
  }

  if (diff.files.length === 0) {
    return { shouldSkip: true, reason: '有効な変更ファイルがありません' };
  }

  const allDocsOrTests = diff.files.every(file =>
    isDocsFile(file.filename) || isTestFile(file.filename)
  );

  if (allDocsOrTests) {
    return { shouldSkip: true, reason: 'ドキュメントまたはテストのみの変更です' };
  }

  return { shouldSkip: false };
}

function isDocsFile(filename: string): boolean {
  return DOCS_PATTERNS.some(pattern => pattern.test(filename));
}

function isTestFile(filename: string): boolean {
  return TEST_PATTERNS.some(pattern => pattern.test(filename));
}

export function categorizeFiles(diff: ProcessedDiff): {
  source: string[];
  tests: string[];
  docs: string[];
  config: string[];
} {
  const result = {
    source: [] as string[],
    tests: [] as string[],
    docs: [] as string[],
    config: [] as string[],
  };

  for (const file of diff.files) {
    if (isTestFile(file.filename)) {
      result.tests.push(file.filename);
    } else if (isDocsFile(file.filename)) {
      result.docs.push(file.filename);
    } else if (isConfigFile(file.filename)) {
      result.config.push(file.filename);
    } else {
      result.source.push(file.filename);
    }
  }

  return result;
}

function isConfigFile(filename: string): boolean {
  const configPatterns = [
    /\.config\.[jt]s$/,
    /\.json$/,
    /\.ya?ml$/,
    /\.toml$/,
    /\.env/,
    /Dockerfile/,
    /docker-compose/,
  ];
  return configPatterns.some(pattern => pattern.test(filename));
}
