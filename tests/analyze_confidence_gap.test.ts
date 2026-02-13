import { applyStepAwareAdjustments } from '../src/engine/analyze';

describe('analyze confidence gap guard', () => {
  test('flags low-confidence ambiguity when top hypotheses are too close', () => {
    const obj: any = {
      diagnosis: {
        hypotheses: [
          { id: 'H1', title: 'test failure', category: 'source_code', confidence: 0.51, evidence: [], disconfirming: [], next_check: 'check test' },
          { id: 'H2', title: 'dependency mismatch', category: 'dependency', confidence: 0.49, evidence: [], disconfirming: [], next_check: 'check lockfile' },
          { id: 'H3', title: 'network issue', category: 'network', confidence: 0.0, evidence: [], disconfirming: [], next_check: 'check registry' }
        ],
        selected_hypothesis_id: 'H1',
        category: 'source_code',
        root_cause: 'unknown',
        evidence: [],
        confidence_score: 0
      },
      patch_plan: {
        intent: 'Fix tests',
        allowed_files: ['src/**/*.ts'],
        strategy: 'minimal'
      }
    };

    const ctx: any = {
      step: 'Run test suite',
      workflowPath: '.github/workflows/ci.yml',
      failedTestFiles: ['tests/sample.test.ts']
    };

    applyStepAwareAdjustments(obj, ctx);

    expect(obj.diagnosis.selected_hypothesis_id).toBe('H1');
    expect(obj.diagnosis.low_confidence_ambiguity).toBe(true);
    expect(obj.diagnosis.confidence_gap).toBeLessThan(0.15);
    expect(obj.diagnosis.review_guidance).toContain('--show-reasoning');
    expect(obj.diagnosis.confidence_score).toBeCloseTo(obj.diagnosis.hypotheses[0].confidence, 4);
  });

  test('does not flag ambiguity when confidence gap is clear', () => {
    const obj: any = {
      diagnosis: {
        hypotheses: [
          { id: 'H1', title: 'test failure', category: 'source_code', confidence: 0.9, evidence: [], disconfirming: [], next_check: 'check test' },
          { id: 'H2', title: 'dependency mismatch', category: 'dependency', confidence: 0.05, evidence: [], disconfirming: [], next_check: 'check lockfile' },
          { id: 'H3', title: 'network issue', category: 'network', confidence: 0.05, evidence: [], disconfirming: [], next_check: 'check registry' }
        ],
        selected_hypothesis_id: 'H2',
        category: 'dependency',
        root_cause: 'unknown',
        evidence: [],
        confidence_score: 0
      },
      patch_plan: {
        intent: 'Fix tests',
        allowed_files: ['src/**/*.ts'],
        strategy: 'minimal'
      }
    };

    const ctx: any = {
      step: 'Run test suite',
      workflowPath: '.github/workflows/ci.yml',
      failedTestFiles: ['tests/sample.test.ts']
    };

    applyStepAwareAdjustments(obj, ctx);

    expect(obj.diagnosis.selected_hypothesis_id).toBe('H1');
    expect(obj.diagnosis.low_confidence_ambiguity).toBe(false);
    expect(obj.diagnosis.confidence_gap).toBeGreaterThanOrEqual(0.15);
    expect(obj.diagnosis.confidence_score).toBeCloseTo(obj.diagnosis.hypotheses[0].confidence, 4);
  });
});
