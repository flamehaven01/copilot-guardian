type SessionResponse = {
  content?: string;
};

type Session = {
  sendAndWait: (input: { prompt: string; mode: string }, timeoutMs?: number) => Promise<SessionResponse>;
};

export class CopilotClient {
  async startSession(): Promise<Session> {
    return {
      sendAndWait: async () => ({ content: '' })
    };
  }
}
