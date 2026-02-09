import { spawn } from 'child_process';
import ora, { Ora } from 'ora';
import chalk from 'chalk';
import { CopilotClient } from '@github/copilot-sdk';

export interface ExecOptions {
  showSpinner?: boolean;
  spinnerText?: string;
  timeout?: number;
  retries?: number;
}

export class TimeoutError extends Error {
  constructor(ms: number) {
    super(`Operation timed out after ${ms}ms`);
    this.name = 'TimeoutError';
  }
}

export class RateLimitError extends Error {
  constructor() {
    super('GitHub API rate limit exceeded');
    this.name = 'RateLimitError';
  }
}

export class CopilotError extends Error {
  constructor(message: string) {
    super(`Copilot SDK error: ${message}`);
    this.name = 'CopilotError';
  }
}

// Singleton client for SDK - lazy initialization
let _sdkClient: CopilotClient | null = null;
let _sdkClientPromise: Promise<CopilotClient> | null = null;

async function getSdkClient(): Promise<CopilotClient> {
  if (_sdkClient) return _sdkClient;
  
  if (_sdkClientPromise) return _sdkClientPromise;
  
  _sdkClientPromise = (async () => {
    const client = new CopilotClient({
      autoStart: true,
      autoRestart: true,
      useLoggedInUser: true,
    });
    await client.start();
    _sdkClient = client;
    return client;
  })().catch((error) => {
    // Reset promise on failure to allow retry
    _sdkClientPromise = null;
    throw error;
  });
  
  return _sdkClientPromise;
}

// Cleanup function for graceful shutdown
export async function closeSdkClient(): Promise<void> {
  // Wait for any in-flight initialization to complete
  if (_sdkClientPromise) {
    try {
      await _sdkClientPromise;
    } catch {
      // Ignore initialization errors during cleanup
    }
  }
  if (_sdkClient) {
    await _sdkClient.stop();
    _sdkClient = null;
  }
  _sdkClientPromise = null;
}

/**
 * Execute command asynchronously with optional spinner
 */
export async function execAsync(
  command: string,
  args: string[],
  input?: string,
  options: ExecOptions = {}
): Promise<string> {
  const {
    showSpinner = true,
    spinnerText = 'Executing...',
    timeout = 120000
  } = options;

  const spinner: Ora | null = showSpinner ? ora(spinnerText).start() : null;

  return new Promise((resolve, reject) => {
    const proc = spawn(command, args, {
      stdio: ['pipe', 'pipe', 'pipe']
    });

    let stdout = '';
    let stderr = '';

    const timer = timeout ? setTimeout(() => {
      proc.kill();
      spinner?.fail('Timeout');
      reject(new TimeoutError(timeout));
    }, timeout) : null;

    proc.stdout.on('data', (chunk) => {
      stdout += chunk;
      if (spinner && stdout.length > 0) {
        const preview = stdout.slice(-50).replace(/\n/g, ' ');
        spinner.text = `${spinnerText} (${Math.round(stdout.length / 1024)}KB)`;
      }
    });

    proc.stderr.on('data', (chunk) => {
      stderr += chunk;
    });

    proc.on('error', (error) => {
      if (timer) clearTimeout(timer);
      spinner?.fail('Command error');
      reject(new Error(`Failed to execute ${command}: ${error.message}`));
    });

    proc.on('close', (code) => {
      if (timer) clearTimeout(timer);

      if (code === 0) {
        spinner?.succeed();
        resolve(stdout);
      } else {
        spinner?.fail();

        if (stderr.includes('rate limit')) {
          reject(new RateLimitError());
        } else if (stderr.includes('not found') || stderr.includes('command not found')) {
          reject(new Error(`Command not found: ${command}. Please install it first.`));
        } else {
          reject(new Error(`Command failed (exit ${code}):\n${stderr}`));
        }
      }
    });

    if (input) {
      proc.stdin.write(input);
      proc.stdin.end();
    }
  });
}

/**
 * Execute with automatic retry on transient failures
 */
export async function execWithRetry(
  command: string,
  args: string[],
  input?: string,
  options: ExecOptions = {}
): Promise<string> {
  const maxRetries = options.retries ?? 3;
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await execAsync(command, args, input, {
        ...options,
        spinnerText: attempt > 1
          ? `${options.spinnerText} (attempt ${attempt}/${maxRetries})`
          : options.spinnerText
      });
    } catch (error: any) {
      lastError = error;

      if (error instanceof RateLimitError) {
        console.log(chalk.yellow(`[!] Rate limited. Waiting 60s before retry ${attempt}/${maxRetries}...`));
        await sleep(60000);
        continue;
      }

      if (error instanceof TimeoutError) {
        console.log(chalk.yellow(`[!] Timeout. Retrying ${attempt}/${maxRetries}...`));
        await sleep(5000);
        continue;
      }

      throw error;
    }
  }

  throw lastError!;
}

/**
 * Call GitHub Copilot via SDK with retry logic
 */
export async function copilotChatAsync(
  prompt: string,
  options: Partial<ExecOptions> = {}
): Promise<string> {
  const fullOptions: ExecOptions = {
    showSpinner: true,
    spinnerText: '[>] Asking Copilot SDK...',
    timeout: 90000,
    retries: 2,
    ...options
  };

  const spinner: Ora | null = fullOptions.showSpinner ? ora(fullOptions.spinnerText).start() : null;
  const maxRetries = fullOptions.retries ?? 2;
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    let session: Awaited<ReturnType<CopilotClient['createSession']>> | null = null;
    
    try {
      if (attempt > 1 && spinner) {
        spinner.text = `${fullOptions.spinnerText} (attempt ${attempt}/${maxRetries})`;
      }

      const client = await getSdkClient();
      
      session = await client.createSession({
        model: process.env.COPILOT_MODEL || 'gpt-4o',
      });

      // Set up timeout with cleanup
      let timeoutId: NodeJS.Timeout | null = null;
      const timeoutPromise = new Promise<never>((_, reject) => {
        timeoutId = setTimeout(() => reject(new TimeoutError(fullOptions.timeout!)), fullOptions.timeout);
      });

      // Send and wait for response
      const responsePromise = session.sendAndWait({ prompt });
      
      try {
        const response = await Promise.race([responsePromise, timeoutPromise]);
        
        // Clear timeout on success
        if (timeoutId) clearTimeout(timeoutId);

        const content = response?.data?.content || '';
        
        if (!content) {
          throw new CopilotError('Empty response from Copilot SDK. The model may be unavailable or the prompt was rejected.');
        }
        
        spinner?.succeed('[+] Copilot SDK response received');
        return content;
      } catch (raceError) {
        // Clear timeout on error too
        if (timeoutId) clearTimeout(timeoutId);
        throw raceError;
      }

    } catch (error: any) {
      lastError = error;
      const errorMsg = error?.message || '';

      // Handle rate limiting
      if (errorMsg.includes('rate limit') || error instanceof RateLimitError) {
        if (spinner) spinner.text = chalk.yellow(`[!] Rate limited. Waiting 60s before retry ${attempt}/${maxRetries}...`);
        await sleep(60000);
        continue;
      }

      // Handle timeout
      if (error instanceof TimeoutError) {
        if (spinner) spinner.text = chalk.yellow(`[!] Timeout. Retrying ${attempt}/${maxRetries}...`);
        await sleep(5000);
        continue;
      }

      // Handle auth errors
      if (errorMsg.includes('not authenticated') || errorMsg.includes('auth')) {
        spinner?.fail();
        throw new CopilotError(
          'Not authenticated. Run: gh auth login'
        );
      }

      // Handle Copilot SDK not found
      if (errorMsg.includes('copilot') && errorMsg.includes('not found')) {
        spinner?.fail();
        throw new CopilotError(
          'Copilot SDK unavailable. Ensure @github/copilot-sdk is installed.'
        );
      }

      // Non-retryable error
      spinner?.fail();
      throw error;
    } finally {
      // Always cleanup session to prevent leaks (SDK-1 fix)
      if (session) {
        try {
          await session.destroy();
        } catch {
          // Ignore cleanup errors
        }
      }
    }
  }

  spinner?.fail();
  throw lastError!;
}

/**
 * Call gh CLI command asynchronously
 */
export async function ghAsync(
  args: string[],
  options: Partial<ExecOptions> = {}
): Promise<string> {
  return execWithRetry(
    'gh',
    args,
    undefined,
    {
      showSpinner: false,
      timeout: 30000,
      retries: 2,
      ...options
    }
  );
}

/**
 * Sleep utility (exported for test mocking)
 */
export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Test if gh CLI is available
 */
export async function checkGHCLI(): Promise<boolean> {
  try {
    await execAsync('gh', ['--version'], undefined, {
      showSpinner: false,
      timeout: 5000
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Test if Copilot SDK is available (replaces old gh copilot check)
 */
export async function checkCopilotCLI(): Promise<boolean> {
  try {
    // SDK-5: Check SDK client initialization instead of gh copilot extension
    const client = await getSdkClient();
    await client.ping();
    return true;
  } catch {
    return false;
  }
}
