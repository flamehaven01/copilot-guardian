// Jest setup file
import { resetMocks } from './__mocks__/@github/copilot-sdk';

beforeEach(() => {
  // Reset SDK mocks before each test
  resetMocks();
});
