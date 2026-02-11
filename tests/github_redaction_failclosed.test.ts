import { fetchRunContext } from '../src/engine/github';
import { ghAsync } from '../src/engine/async-exec';

jest.mock('../src/engine/async-exec', () => ({
  ghAsync: jest.fn()
}));

const mockedGhAsync = ghAsync as jest.MockedFunction<typeof ghAsync>;

describe('fetchRunContext redaction fail-closed', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('aborts when residual secret patterns remain after redaction', async () => {
    const jwtLike = 'eyJabcdefgh12.eyJijklmnop34.eyJqrstuvwx56';
    mockedGhAsync.mockResolvedValue(`Build log line with suspicious token ${jwtLike}`);

    await expect(fetchRunContext('owner/repo', 1001, 12000)).rejects.toThrow(
      /Redaction fail-closed/
    );
    expect(mockedGhAsync).toHaveBeenCalledTimes(1);
  });
});
