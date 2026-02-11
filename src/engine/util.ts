import fs from "node:fs";
import path from "node:path";

import Ajv2020Module from "ajv/dist/2020.js";
import addFormatsModule from "ajv-formats";

// ESM default export handling
const Ajv2020 = (Ajv2020Module as any).default || Ajv2020Module;
const addFormats = (addFormatsModule as any).default || addFormatsModule;

function findPackageRoot(startDir: string): string | undefined {
  let current = path.resolve(startDir);
  while (true) {
    const packageJson = path.join(current, "package.json");
    const promptsDir = path.join(current, "prompts");
    const schemasDir = path.join(current, "schemas");
    if (fs.existsSync(packageJson) && fs.existsSync(promptsDir) && fs.existsSync(schemasDir)) {
      return current;
    }
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return undefined;
}

function resolvePackageRoot(): string {
  const candidates: string[] = [];
  if (typeof __dirname !== "undefined") candidates.push(__dirname);
  if (typeof process.argv?.[1] === "string" && process.argv[1].trim()) {
    candidates.push(path.dirname(path.resolve(process.argv[1])));
  }
  candidates.push(process.cwd());

  for (const candidate of candidates) {
    const resolved = findPackageRoot(candidate);
    if (resolved) return resolved;
  }
  return process.cwd();
}

export const PACKAGE_ROOT = resolvePackageRoot();

export type ExecOptions = {
  cwd?: string;
  input?: string;
  env?: NodeJS.ProcessEnv;
  stdio?: "pipe" | "inherit";
};

export function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

export function loadText(p: string): string {
  return fs.readFileSync(p, "utf8");
}

export function writeText(p: string, content: string): void {
  ensureDir(path.dirname(p));
  fs.writeFileSync(p, content, "utf8");
}

export function writeJson(p: string, obj: unknown): void {
  writeText(p, JSON.stringify(obj, null, 2));
}

export function redactSecrets(text: string): string {
  const patterns: RegExp[] = [
    // GitHub tokens
    /ghp_[a-zA-Z0-9]{36}/g,
    /gho_[a-zA-Z0-9]{36}/g,
    /github_pat_[a-zA-Z0-9_]{82}/g,
    /ghs_[a-zA-Z0-9]{36}/g,
    // Bearer tokens
    /Bearer\s+[A-Za-z0-9\-._~+/]+=*/g,
    // OpenAI keys
    /sk-[a-zA-Z0-9]{48}/g,
    // Generic secrets (key=value pattern)
    /(token|password|secret|api_key|apikey|auth)\s*[:=]\s*['"]?[^\s'"]+['"]?/gi,
    // AWS keys
    /AKIA[0-9A-Z]{16}/g,
    // Private keys
    /-----BEGIN\s+(RSA|DSA|EC|OPENSSH)?\s*PRIVATE\s+KEY-----/g,
  ];
  // NOTE: Removed over-aggressive 40+ char alphanumeric pattern (S5 fix)
  // It was redacting git SHAs, npm hashes, and other diagnostic data

  let redacted = text;
  for (const pattern of patterns) {
    redacted = redacted.replace(pattern, "***REDACTED***");
  }
  return redacted;
}

export function findResidualSecrets(text: string): string[] {
  const checks: Array<{ label: string; pattern: RegExp }> = [
    { label: "github_token_classic", pattern: /gh[pousr]_[A-Za-z0-9]{20,}/g },
    { label: "github_token_fine_grained", pattern: /github_pat_[A-Za-z0-9_]{30,}/g },
    { label: "openai_key", pattern: /\bsk-[A-Za-z0-9]{20,}\b/g },
    { label: "bearer_token", pattern: /Bearer\s+[A-Za-z0-9\-._~+/=]{16,}/g },
    { label: "aws_access_key", pattern: /\bAKIA[0-9A-Z]{16}\b/g },
    { label: "private_key", pattern: /-----BEGIN\s+(?:RSA|DSA|EC|OPENSSH)?\s*PRIVATE\s+KEY-----/g },
    { label: "jwt", pattern: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g }
  ];

  const found = new Set<string>();
  for (const check of checks) {
    if (check.pattern.test(text)) {
      found.add(check.label);
    }
  }
  return Array.from(found);
}

export function extractJsonObject(text: string): string {
  // Try to find JSON in various formats:
  // 1. Pure JSON (starts with {)
  // 2. JSON in markdown code block (```json ... ```)
  // 3. JSON after prose text
  
  // First, try to extract from markdown code block
  const codeBlockMatch = text.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/);
  if (codeBlockMatch) {
    return codeBlockMatch[1].trim();
  }
  
  // S4 FIX: Use non-greedy matching with balanced brace counting
  // Find first { and match to its balanced closing }
  const startIdx = text.indexOf('{');
  if (startIdx === -1) {
    // No JSON found - provide helpful error
    const preview = text.substring(0, 200).replace(/\n/g, ' ');
    throw new Error(
      `No JSON object found in Copilot response.\n` +
      `Response preview: "${preview}..."\n` +
      `Hint: Copilot may have returned prose instead of JSON. Check copilot.*.raw.txt file.`
    );
  }
  
  let depth = 0;
  let inString = false;
  let escape = false;
  
  for (let i = startIdx; i < text.length; i++) {
    const char = text[i];
    
    if (escape) {
      escape = false;
      continue;
    }
    
    if (char === '\\' && inString) {
      escape = true;
      continue;
    }
    
    if (char === '"' && !escape) {
      inString = !inString;
      continue;
    }
    
    if (!inString) {
      if (char === '{') depth++;
      else if (char === '}') {
        depth--;
        if (depth === 0) {
          return text.slice(startIdx, i + 1);
        }
      }
    }
  }
  
  // Fallback: return from first { to end (may be truncated JSON)
  throw new Error("Unbalanced JSON object in Copilot response - missing closing brace");
}

export function validateJson(data: unknown, schemaPath: string): void {
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  addFormats(ajv);
  const schema = JSON.parse(loadText(schemaPath));
  const validate = ajv.compile(schema);
  const ok = validate(data);
  if (!ok) {
    const errors = (validate.errors || [])
      .map((e: { instancePath?: string; message?: string }) => `${e.instancePath || "(root)"}: ${e.message}`)
      .join("\n");
    throw new Error(`Schema validation failed (${schemaPath}):\n${errors}`);
  }
}

export function clampText(s: string, maxChars: number): string {
  if (s.length <= maxChars) return s;
  return s.slice(0, maxChars) + "\n... [truncated]";
}
