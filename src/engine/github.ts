import chalk from "chalk";
import { ghAsync } from "./async-exec.js";
import { redactSecrets, findResidualSecrets } from "./util.js";

export type RunContext = {
  repo: string;
  runId: number;
  workflowPath?: string;
  headSha?: string;
  job?: string;
  step?: string;
  exitCode?: number;
  failedTestFiles?: string[];
  assertionSignals?: string[];
  logExcerpt: string;
  logSummary: string;
  workflowYaml?: string;
};

async function gh(args: string[]): Promise<string> {
  return ghAsync(args, {
    showSpinner: false,
    timeout: 30000
  });
}

function buildLogExcerpt(logs: string, maxLogChars: number): string {
  if (logs.length <= maxLogChars) return logs;
  if (maxLogChars < 200) return logs.slice(-maxLogChars);

  // Keep both beginning (environment/setup) and tail (actual failure)
  const separator = "\n... [middle truncated] ...\n";
  const headChars = Math.floor(maxLogChars * 0.35);
  const tailChars = Math.max(0, maxLogChars - headChars - separator.length);
  return logs.slice(0, headChars) + separator + logs.slice(-tailChars);
}

function extractFailureMeta(runViewRaw: string): { job?: string; step?: string } {
  try {
    const obj = JSON.parse(runViewRaw);
    const jobs = Array.isArray(obj?.jobs) ? obj.jobs : [];

    for (const job of jobs) {
      const steps = Array.isArray(job?.steps) ? job.steps : [];
      const failedStep = steps.find((s: any) => s?.conclusion === "failure");
      if (failedStep) {
        return {
          job: typeof job?.name === "string" ? job.name : undefined,
          step: typeof failedStep?.name === "string" ? failedStep.name : undefined
        };
      }
    }

    const failedJob = jobs.find((j: any) => j?.conclusion === "failure");
    if (failedJob) {
      return {
        job: typeof failedJob?.name === "string" ? failedJob.name : undefined
      };
    }
  } catch {
    // Best-effort only; fall back to log-based inference
  }

  return {};
}

function inferStepFromLog(logs: string): string | undefined {
  const runGroupRegex = /##\[group\]Run ([^\r\n]+)/g;
  let match: RegExpExecArray | null;
  const runs: string[] = [];
  while ((match = runGroupRegex.exec(logs)) !== null) {
    if (match[1]) runs.push(match[1].trim());
  }
  if (runs.length === 0) return undefined;
  return runs[runs.length - 1];
}

function extractExitCode(logs: string): number | undefined {
  const match = logs.match(/Process completed with exit code (\d+)/);
  if (!match) return undefined;
  const code = Number(match[1]);
  return Number.isFinite(code) ? code : undefined;
}

function extractFailedTestFiles(logs: string): string[] {
  const files = new Set<string>();

  const failLineRegex = /^\s*FAIL\s+([^\s]+?\.(?:test|spec)\.[jt]sx?)/gm;
  let match: RegExpExecArray | null;
  while ((match = failLineRegex.exec(logs)) !== null) {
    if (match[1]) files.add(match[1]);
  }

  const stackRegex = /\(([^()\r\n]+?\.(?:test|spec)\.[jt]sx?):\d+:\d+\)/g;
  while ((match = stackRegex.exec(logs)) !== null) {
    if (match[1]) files.add(match[1]);
  }

  return Array.from(files).slice(0, 8);
}

function extractAssertionSignals(logs: string): string[] {
  const lines = logs.split(/\r?\n/);
  const signals: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    const isAssertionSignal =
      /^Expected(?:\s+\w+)?\s*:/.test(trimmed) ||
      /^Received(?:\s+\w+)?\s*:/.test(trimmed) ||
      /expect\(received\)\./.test(trimmed) ||
      /toBe|toContain|toThrow|toEqual/.test(trimmed);

    if (isAssertionSignal) {
      signals.push(trimmed);
      if (signals.length >= 20) break;
    }
  }

  return signals;
}

export async function getLastFailedRunId(repo: string): Promise<number> {
  const out = (await gh([
    'run', 'list',
    '--repo', repo,
    '--status', 'failure',
    '--limit', '1',
    '--json', 'databaseId',
    '-q', '.[0].databaseId'
  ])).trim();
  
  const n = Number(out);
  if (!Number.isFinite(n)) {
    throw new Error(`Could not find failed run for ${repo}`);
  }
  return n;
}

export async function fetchRunContext(repo: string, runId: number, maxLogChars = 12000): Promise<RunContext> {
  console.log(chalk.dim('[>] Fetching logs...'));
  
  // 1) Logs (failed only)
  const rawLogs = await gh(['run', 'view', String(runId), '--repo', repo, '--log-failed']);
  const redacted = redactSecrets(rawLogs);
  const residualSecrets = findResidualSecrets(redacted);
  if (residualSecrets.length > 0) {
    throw new Error(
      `Redaction fail-closed: residual secret patterns detected (${residualSecrets.join(", ")}). Refusing analysis.`
    );
  }
  const excerpt = buildLogExcerpt(redacted, maxLogChars);

  console.log(chalk.dim('[>] Fetching workflow metadata...'));
  
  // 2) Try to derive workflow path + head sha
  let workflowPath: string | undefined;
  let headSha: string | undefined;
  let failedJob: string | undefined;
  let failedStep: string | undefined;
  try {
    const runJson = await gh(['api', `repos/${repo}/actions/runs/${runId}`]);
    const obj = JSON.parse(runJson);
    workflowPath = obj?.path;
    headSha = obj?.head_sha;
  } catch {
    console.log(chalk.yellow('[!] Could not fetch workflow metadata'));
  }

  // 2.1) Get failed step/job metadata for step-aware diagnosis
  try {
    const runViewJson = await gh([
      'run', 'view', String(runId),
      '--repo', repo,
      '--json', 'jobs'
    ]);
    const meta = extractFailureMeta(runViewJson);
    failedJob = meta.job;
    failedStep = meta.step;
  } catch {
    // Keep best-effort behavior
  }

  // 3) Optional: fetch workflow yaml (raw)
  let workflowYaml: string | undefined;
  if (workflowPath && headSha) {
    try {
      console.log(chalk.dim('[>] Fetching workflow YAML...'));
      workflowYaml = await gh([
        'api',
        '-H', 'Accept: application/vnd.github.raw',
        `repos/${repo}/contents/${workflowPath}?ref=${headSha}`
      ]);
    } catch {
      console.log(chalk.yellow('[!] Could not fetch workflow YAML'));
    }
  }

  // 4) Quick heuristic summary (first "Error:" line etc)
  const lines = excerpt.split(/\r?\n/);
  const errorLine = [...lines].reverse().find((l) => /error\b|failed\b|exception\b/i.test(l))?.trim();
  const logSummary = errorLine ? errorLine.slice(0, 240) : lines.slice(0, 3).join(" ").slice(0, 240);
  const exitCode = extractExitCode(redacted);
  const failedTestFiles = extractFailedTestFiles(redacted);
  const assertionSignals = extractAssertionSignals(redacted);

  return {
    repo,
    runId,
    workflowPath,
    headSha,
    job: failedJob,
    step: failedStep || inferStepFromLog(redacted),
    exitCode,
    failedTestFiles,
    assertionSignals,
    logExcerpt: excerpt,
    logSummary,
    workflowYaml
  };
}
