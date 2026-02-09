// Mock for @github/copilot-sdk
export const mockSession = {
  sendAndWait: jest.fn().mockResolvedValue({
    data: { content: 'Mock SDK response' }
  }),
  destroy: jest.fn().mockResolvedValue(undefined),
  sessionId: 'mock-session-id',
};

export const mockClient = {
  start: jest.fn().mockResolvedValue(undefined),
  stop: jest.fn().mockResolvedValue(undefined),
  createSession: jest.fn().mockResolvedValue(mockSession),
  ping: jest.fn().mockResolvedValue({ message: 'pong', timestamp: Date.now() }),
};

export class CopilotClient {
  constructor() {
    return mockClient;
  }
}

// Helper to reset mocks between tests
export function resetMocks() {
  mockSession.sendAndWait.mockReset().mockResolvedValue({
    data: { content: 'Mock SDK response' }
  });
  mockSession.destroy.mockReset().mockResolvedValue(undefined);
  mockClient.start.mockReset().mockResolvedValue(undefined);
  mockClient.stop.mockReset().mockResolvedValue(undefined);
  mockClient.createSession.mockReset().mockResolvedValue(mockSession);
  mockClient.ping.mockReset().mockResolvedValue({ message: 'pong', timestamp: Date.now() });
}
