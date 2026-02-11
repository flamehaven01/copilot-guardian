import { generatePatchOptions } from '../src/engine/patch_options';
import * as asyncExec from '../src/engine/async-exec';
import * as fs from 'fs';
import * as path from 'path';

jest.mock('../src/engine/async-exec');

type MockAnalysis = {
  diagnosis: {
    hypotheses: Array<{ id: string; title: string; confidence: number }>;
    selected_hypothesis_id: string;
    root_cause: string;
  };
  patch_plan: {
    intent: string;
    allowed_files: string[];
    strategy: string[];
  };
};

type Strategy = {
  id: string;
  label: string;
  risk_level: 'low' | 'medium' | 'high';
  summary: string;
  diff: string;
};

type QualityShape = {
  verdict: 'GO' | 'NO_GO';
  slop_score: number;
  risk_level: 'low' | 'medium' | 'high';
  reasons: string[];
  suggested_adjustments: string[];
};

const OUT_DIR = '.test-output';

const MODEL_GO: QualityShape = {
  verdict: 'GO',
  slop_score: 0.08,
  risk_level: 'low',
  reasons: ['Model judged patch as acceptable'],
  suggested_adjustments: []
};

function baseAnalysis(overrides?: Partial<MockAnalysis['patch_plan']>): MockAnalysis {
  return {
    diagnosis: {
      hypotheses: [{ id: 'H1', title: 'CI failure', confidence: 0.91 }],
      selected_hypothesis_id: 'H1',
      root_cause: 'Regression detected in CI'
    },
    patch_plan: {
      intent: 'Fix CI failure with minimal, real code changes. No bypasses. No suppressions.',
      allowed_files: ['src/**/*.ts', 'tests/**/*.ts', 'package.json', '.github/workflows/*.yml'],
      strategy: ['Fix root cause'],
      ...overrides
    }
  };
}

function safeBalanced(): Strategy {
  return {
    id: 'balanced',
    label: 'BALANCED',
    risk_level: 'low',
    summary: 'Real fix in allowed scope',
    diff: [
      '--- a/src/engine/github.ts',
      '+++ b/src/engine/github.ts',
      '@@ -200,7 +200,7 @@',
      '-  return { workflowPath };',
      "+  return { workflowPath: workflowPath || '' };"
    ].join('\n')
  };
}

function safeAggressive(): Strategy {
  return {
    id: 'aggressive',
    label: 'AGGRESSIVE',
    risk_level: 'medium',
    summary: 'Real test fix in allowed scope',
    diff: [
      '--- a/tests/quality_guard_regression_matrix.test.ts',
      '+++ b/tests/quality_guard_regression_matrix.test.ts',
      '@@ -1,1 +1,1 @@',
      '-const oldValue = 0;',
      '+const oldValue = 1;'
    ].join('\n')
  };
}

function mockCopilot(
  strategies: Strategy[],
  qualityByStrategy?: Record<string, Partial<QualityShape> | string>
): void {
  (asyncExec.copilotChatAsync as jest.Mock).mockImplementation((prompt: string) => {
    if (prompt.includes('ANALYSIS_JSON:')) {
      return Promise.resolve(JSON.stringify({ strategies }));
    }

    const strategyMatch = prompt.match(/"strategy"\s*:\s*"([^"]+)"/);
    const strategyId = strategyMatch?.[1] || '';
    const override = strategyId ? qualityByStrategy?.[strategyId] : undefined;

    if (typeof override === 'string') {
      return Promise.resolve(override);
    }

    if (override) {
      return Promise.resolve(JSON.stringify({ ...MODEL_GO, ...override }));
    }

    return Promise.resolve(JSON.stringify(MODEL_GO));
  });
}

function findResult(result: any, id: string): any {
  const item = result.index.results.find((r: any) => r.id === id);
  expect(item).toBeDefined();
  return item;
}

function readQualityReview(strategyId: string): QualityShape {
  const reviewPath = path.join(OUT_DIR, `quality_review.${strategyId}.json`);
  return JSON.parse(fs.readFileSync(reviewPath, 'utf8')) as QualityShape;
}

function joinedReasons(review: QualityShape): string {
  return (Array.isArray(review.reasons) ? review.reasons : []).join(' | ');
}

describe('quality guard regression matrix', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('baseline: rejects bypass + out-of-scope and keeps one real GO strategy', async () => {
    const analysis = baseAnalysis({
      allowed_files: ['src/**/*.ts', 'tests/**/*.ts', 'package.json']
    });

    mockCopilot([
      {
        id: 'conservative',
        label: 'CONSERVATIVE',
        risk_level: 'low',
        summary: 'Bypass lint gate',
        diff: [
          '--- a/package.json',
          '+++ b/package.json',
          '@@ -10,7 +10,7 @@',
          '-    "lint": "eslint src --max-warnings=0"',
          '+    "lint": "node -e \\"process.exit(0)\\""'
        ].join('\n')
      },
      safeBalanced(),
      {
        id: 'aggressive',
        label: 'AGGRESSIVE',
        risk_level: 'high',
        summary: 'Out-of-scope docs edit',
        diff: [
          '--- a/docs/README.md',
          '+++ b/docs/README.md',
          '@@ -1,1 +1,2 @@',
          '-old',
          '+new',
          '+TODO: follow-up'
        ].join('\n')
      }
    ]);

    const result = await generatePatchOptions(analysis, OUT_DIR);
    const conservative = findResult(result, 'conservative');
    const balanced = findResult(result, 'balanced');
    const aggressive = findResult(result, 'aggressive');

    expect(conservative.verdict).toBe('NO_GO');
    expect(aggressive.verdict).toBe('NO_GO');
    expect(balanced.verdict).toBe('GO');

    const goList = result.index.results.filter((r: any) => r.verdict === 'GO');
    expect(goList).toHaveLength(1);
    expect(goList[0].id).toBe('balanced');
  });

  test.each([
    {
      name: 'ts-ignore suppression',
      diff: [
        '--- a/src/engine/github.ts',
        '+++ b/src/engine/github.ts',
        '@@ -1,2 +1,3 @@',
        '+// @ts-ignore',
        "+const x: number = 'nope' as any;"
      ].join('\n'),
      reason: 'TS/lint suppression marker'
    },
    {
      name: 'ts-nocheck suppression',
      diff: [
        '--- a/src/engine/github.ts',
        '+++ b/src/engine/github.ts',
        '@@ -1,2 +1,3 @@',
        '+// @ts-nocheck',
        "+const x: number = 'nope' as any;"
      ].join('\n'),
      reason: 'TS/lint suppression marker'
    },
    {
      name: 'eslint-disable suppression',
      diff: [
        '--- a/src/engine/github.ts',
        '+++ b/src/engine/github.ts',
        '@@ -1,2 +1,3 @@',
        '+// eslint-disable-next-line @typescript-eslint/no-explicit-any',
        '+const x: any = 1;'
      ].join('\n'),
      reason: 'TS/lint suppression marker'
    },
    {
      name: 'todo placeholder',
      diff: [
        '--- a/src/engine/github.ts',
        '+++ b/src/engine/github.ts',
        '@@ -10,6 +10,7 @@',
        '+// TODO: fix properly later'
      ].join('\n'),
      reason: 'TODO/FIXME/HACK markers'
    },
    {
      name: 'fixme placeholder',
      diff: [
        '--- a/src/engine/github.ts',
        '+++ b/src/engine/github.ts',
        '@@ -10,6 +10,7 @@',
        '+// FIXME: temporary workaround'
      ].join('\n'),
      reason: 'TODO/FIXME/HACK markers'
    },
    {
      name: 'hack placeholder',
      diff: [
        '--- a/src/engine/github.ts',
        '+++ b/src/engine/github.ts',
        '@@ -10,6 +10,7 @@',
        '+// HACK: bypass for CI'
      ].join('\n'),
      reason: 'TODO/FIXME/HACK markers'
    },
    {
      name: 'process-exit bypass',
      diff: [
        '--- a/package.json',
        '+++ b/package.json',
        '@@ -10,7 +10,7 @@',
        '-    "lint": "eslint src --max-warnings=0"',
        '+    "lint": "node -e \\"process.exit(0)\\""'
      ].join('\n'),
      reason: 'Bypass anti-pattern'
    },
    {
      name: 'continue-on-error bypass',
      diff: [
        '--- a/.github/workflows/ci.yml',
        '+++ b/.github/workflows/ci.yml',
        '@@ -10,6 +10,7 @@',
        ' - name: Run tests',
        '   run: npm test',
        '+  continue-on-error: true'
      ].join('\n'),
      reason: 'Bypass anti-pattern'
    },
    {
      name: 'tls bypass via NODE_TLS_REJECT_UNAUTHORIZED=0',
      diff: [
        '--- a/package.json',
        '+++ b/package.json',
        '@@ -10,6 +10,7 @@',
        '-    "test": "jest"',
        '+    "test": "NODE_TLS_REJECT_UNAUTHORIZED=0 jest"'
      ].join('\n'),
      reason: 'Bypass anti-pattern'
    },
    {
      name: 'strict-ssl bypass',
      diff: [
        '--- a/package.json',
        '+++ b/package.json',
        '@@ -10,6 +10,7 @@',
        '-    "postinstall": "node scripts/setup.js"',
        '+    "postinstall": "npm config set strict-ssl false && node scripts/setup.js"'
      ].join('\n'),
      reason: 'Bypass anti-pattern'
    },
    {
      name: 'curl insecure bypass',
      diff: [
        '--- a/.github/workflows/ci.yml',
        '+++ b/.github/workflows/ci.yml',
        '@@ -10,6 +10,7 @@',
        '-      run: curl https://example.com/healthz',
        '+      run: curl -k https://example.com/healthz'
      ].join('\n'),
      reason: 'Bypass anti-pattern'
    }
  ])('rejects bad patch: $name', async ({ diff, reason }) => {
    const analysis = baseAnalysis();

    mockCopilot([
      {
        id: 'conservative',
        label: 'CONSERVATIVE',
        risk_level: 'medium',
        summary: `Bad patch: ${reason}`,
        diff
      },
      safeBalanced(),
      safeAggressive()
    ]);

    const result = await generatePatchOptions(analysis, OUT_DIR);
    const conservative = findResult(result, 'conservative');
    const balanced = findResult(result, 'balanced');
    const conservativeReview = readQualityReview('conservative');

    expect(conservative.verdict).toBe('NO_GO');
    expect(conservative.risk_level).toBe('high');
    expect(joinedReasons(conservativeReview)).toContain(reason);
    expect(balanced.verdict).toBe('GO');
  });

  test('rejects out-of-scope edits even when model review says GO', async () => {
    const analysis = baseAnalysis({
      allowed_files: ['src/**/*.ts', 'tests/**/*.ts', 'package.json']
    });

    mockCopilot([
      {
        id: 'conservative',
        label: 'CONSERVATIVE',
        risk_level: 'low',
        summary: 'Workflow change out of scope',
        diff: [
          '--- a/.github/workflows/ci.yml',
          '+++ b/.github/workflows/ci.yml',
          '@@ -1,3 +1,4 @@',
          ' name: CI',
          '+# harmless comment'
        ].join('\n')
      },
      safeBalanced(),
      safeAggressive()
    ]);

    const result = await generatePatchOptions(analysis, OUT_DIR);
    const conservative = findResult(result, 'conservative');
    const balanced = findResult(result, 'balanced');
    const conservativeReview = readQualityReview('conservative');

    expect(conservative.verdict).toBe('NO_GO');
    expect(joinedReasons(conservativeReview)).toContain('Out-of-scope file changes detected');
    expect(balanced.verdict).toBe('GO');
  });

  test('forces NO_GO when quality review slop_score is out of schema range', async () => {
    const analysis = baseAnalysis();
    mockCopilot(
      [
        {
          id: 'conservative',
          label: 'CONSERVATIVE',
          risk_level: 'low',
          summary: 'Looks clean but model emits invalid slop_score',
          diff: safeBalanced().diff
        },
        safeBalanced(),
        safeAggressive()
      ],
      {
        conservative: { verdict: 'GO', risk_level: 'low', slop_score: 1.7, reasons: [], suggested_adjustments: [] }
      }
    );

    const result = await generatePatchOptions(analysis, OUT_DIR);
    const conservative = findResult(result, 'conservative');
    const balanced = findResult(result, 'balanced');
    const conservativeReview = readQualityReview('conservative');

    expect(conservative.verdict).toBe('NO_GO');
    expect(conservative.risk_level).toBe('high');
    expect(conservative.slop_score).toBe(1);
    expect(joinedReasons(conservativeReview)).toContain('slop_score out of range');
    expect(balanced.verdict).toBe('GO');
  });

  test('forces NO_GO when quality review returns malformed JSON', async () => {
    const analysis = baseAnalysis();
    mockCopilot(
      [
        {
          id: 'conservative',
          label: 'CONSERVATIVE',
          risk_level: 'low',
          summary: 'Model output malformed',
          diff: safeBalanced().diff
        },
        safeBalanced(),
        safeAggressive()
      ],
      {
        conservative: '{ "verdict": "GO", "slop_score": '
      }
    );

    const result = await generatePatchOptions(analysis, OUT_DIR);
    const conservative = findResult(result, 'conservative');
    const balanced = findResult(result, 'balanced');
    const conservativeRawPath = path.join(OUT_DIR, 'copilot.quality.conservative.raw.txt');
    const conservativeRaw = fs.readFileSync(conservativeRawPath, 'utf8');

    expect(conservative.verdict).toBe('NO_GO');
    expect(conservative.risk_level).toBe('high');
    expect(conservative.slop_score).toBe(1);
    expect(conservativeRaw).toContain('"slop_score"');
    expect(balanced.verdict).toBe('GO');
  });

});
