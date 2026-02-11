import {
  ensureAutoHealBranch,
  rerunLatestRunForCommit
} from '../src/engine/auto-apply';
import { execAsync } from '../src/engine/async-exec';

jest.mock('../src/engine/async-exec', () => ({
  execAsync: jest.fn()
}));

const mockedExecAsync = execAsync as jest.MockedFunction<typeof execAsync>;

describe('auto-heal branch safety helpers', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('creates safe branch before patching flow when direct push is disabled', async () => {
    mockedExecAsync
      .mockResolvedValueOnce('main\n') // rev-parse
      .mockResolvedValueOnce(''); // checkout -b

    const ctx = await ensureAutoHealBranch(999, {
      directPush: false,
      baseBranch: 'main',
      suffix: '12345678'
    });

    expect(mockedExecAsync).toHaveBeenNthCalledWith(1, 'git', ['rev-parse', '--abbrev-ref', 'HEAD']);
    expect(mockedExecAsync).toHaveBeenNthCalledWith(2, 'git', ['checkout', '-b', 'guardian/run-999-12345678']);
    expect(ctx.createdSafeBranch).toBe(true);
    expect(ctx.pushBranch).toBe('guardian/run-999-12345678');
    expect(ctx.baseBranch).toBe('main');
  });

  test('does not create safe branch when direct push is enabled', async () => {
    mockedExecAsync.mockResolvedValueOnce('main\n');

    const ctx = await ensureAutoHealBranch(1000, {
      directPush: true,
      baseBranch: 'main'
    });

    expect(mockedExecAsync).toHaveBeenCalledTimes(1);
    expect(ctx.createdSafeBranch).toBe(false);
    expect(ctx.pushBranch).toBe('main');
  });

  test('reruns latest run for commit when available', async () => {
    mockedExecAsync
      .mockResolvedValueOnce(JSON.stringify([{ databaseId: 321, status: 'completed', conclusion: 'failure' }]))
      .mockResolvedValueOnce('');

    const runId = await rerunLatestRunForCommit('owner/repo', 'abc123');
    expect(runId).toBe(321);
    expect(mockedExecAsync).toHaveBeenNthCalledWith(1, 'gh', [
      'run',
      'list',
      '--repo',
      'owner/repo',
      '--commit',
      'abc123',
      '--limit',
      '1',
      '--json',
      'databaseId,status,conclusion'
    ]);
    expect(mockedExecAsync).toHaveBeenNthCalledWith(2, 'gh', [
      'run',
      'rerun',
      '321',
      '--repo',
      'owner/repo'
    ]);
  });
});
