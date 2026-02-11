import fs from 'fs';
import path from 'path';

import { runGuardian } from '../src/engine/run';
import { analyzeRun } from '../src/engine/analyze';
import { generatePatchOptions } from '../src/engine/patch_options';

jest.mock('../src/engine/analyze');
jest.mock('../src/engine/patch_options');

const mockedAnalyzeRun = analyzeRun as jest.MockedFunction<typeof analyzeRun>;
const mockedGeneratePatchOptions = generatePatchOptions as jest.MockedFunction<typeof generatePatchOptions>;

function baseAnalysis() {
  return {
    diagnosis: {
      hypotheses: [],
      selected_hypothesis_id: 'H1',
      category: 'source_code',
      root_cause: 'sample'
    },
    patch_plan: {
      intent: 'fix',
      allowed_files: ['src/**/*.ts'],
      strategy: ['minimal']
    }
  };
}

describe('runGuardian abstain policy', () => {
  const outDir = '.test-output-run-abstain';

  beforeEach(() => {
    jest.clearAllMocks();
    fs.rmSync(outDir, { recursive: true, force: true });
  });

  test('forces abstain on strong auth/permission signal and skips patch generation', async () => {
    mockedAnalyzeRun.mockResolvedValue({
      analysisPath: path.join(outDir, 'analysis.json'),
      analysis: baseAnalysis() as any,
      ctx: {
        step: 'Run tests',
        logSummary: 'Request failed with 403 Forbidden',
        logExcerpt: 'resource not accessible by integration'
      } as any
    });

    const res = await runGuardian('owner/repo', 123, {
      showOptions: true,
      outDir
    });

    expect(res.patchIndex?.abstain?.classification).toBe('NOT_PATCHABLE');
    expect(mockedGeneratePatchOptions).not.toHaveBeenCalled();
    expect(fs.existsSync(path.join(outDir, 'abstain.report.json'))).toBe(true);
  });

  test('does not abstain on a single weak signal; proceeds to patch generation', async () => {
    mockedAnalyzeRun.mockResolvedValue({
      analysisPath: path.join(outDir, 'analysis.json'),
      analysis: baseAnalysis() as any,
      ctx: {
        step: 'Run tests',
        logSummary: 'permission denied while opening local fixture',
        logExcerpt: 'single weak signal only'
      } as any
    });
    mockedGeneratePatchOptions.mockResolvedValue({
      index: {
        results: []
      }
    } as any);

    const res = await runGuardian('owner/repo', 456, {
      showOptions: true,
      outDir
    });

    expect(res.patchIndex?.abstain).toBeUndefined();
    expect(mockedGeneratePatchOptions).toHaveBeenCalledTimes(1);
  });
});
