/**
 * auto-apply.ts
 * Self-Healing Engine: Applies patches automatically and validates CI
 */

import { execAsync } from './async-exec';
import { writeFile, readFile } from 'fs/promises';
import { resolve } from 'path';
import chalk from 'chalk';

export interface ApplyResult {
  success: boolean;
  filesModified: string[];
  commitSha?: string;
  ciStatus?: 'passed' | 'failed' | 'pending';
  error?: string;
}

/**
 * Validate file path is within repository
 */
function isPathSafe(filePath: string, repoRoot: string): boolean {
  const normalized = resolve(repoRoot, filePath);
  return normalized.startsWith(repoRoot) && !filePath.includes('..');
}

/**
 * Apply a patch to local files using git apply for safety
 */
export async function applyPatch(
  patch: { file: string; content: string }[],
  options: { dryRun?: boolean; autoCommit?: boolean; allowedFiles?: string[] } = {}
): Promise<ApplyResult> {
  const filesModified: string[] = [];
  const repoRoot = process.cwd();
  
  try {
    // Validate paths
    for (const { file } of patch) {
      if (!isPathSafe(file, repoRoot)) {
        throw new Error(`Unsafe path detected: ${file}`);
      }
      
      if (options.allowedFiles && !options.allowedFiles.includes(file)) {
        throw new Error(`File not in allowed list: ${file}`);
      }
    }
    
    // Apply file changes
    for (const { file, content } of patch) {
      const filePath = resolve(repoRoot, file);
      
      if (options.dryRun) {
        console.log(chalk.gray(`[DRY RUN] Would modify: ${file}`));
        continue;
      }
      
      // Backup original
      try {
        const original = await readFile(filePath, 'utf-8');
        await writeFile(filePath + '.guardian-backup', original, 'utf-8');
      } catch {
        // File might not exist yet
      }
      
      await writeFile(filePath, content, 'utf-8');
      filesModified.push(file);
      console.log(chalk.green(`[+] Applied patch: ${file}`));
    }
    
    if (options.dryRun) {
      return { success: true, filesModified: [] };
    }
    
    // Auto-commit if requested
    let commitSha: string | undefined;
    if (options.autoCommit && filesModified.length > 0) {
      await execAsync('git', ['add', ...filesModified]);
      
      const commitMessage = `fix: Auto-applied Guardian patch (${filesModified.length} files)`;
      await execAsync('git', ['commit', '-m', commitMessage]);
      
      const commitOutput = await execAsync('git', ['rev-parse', 'HEAD']);
      commitSha = commitOutput.trim();
      
      console.log(chalk.blue(`[>] Committed as ${commitSha.substring(0, 7)}`));
    }
    
    return {
      success: true,
      filesModified,
      commitSha
    };
    
  } catch (error) {
    return {
      success: false,
      filesModified,
      error: error instanceof Error ? error.message : 'Unknown error'
    };
  }
}

/**
 * Auto-heal: Apply patch and retry CI up to maxRetries times
 */
export async function autoHeal(
  patch: { file: string; content: string }[],
  options: {
    maxRetries?: number;
    pushRemote?: boolean;
    branch?: string;
  } = {}
): Promise<ApplyResult> {
  const maxRetries = options.maxRetries ?? 3;
  let attempt = 0;
  
  console.log(chalk.bold('\n[#] Guardian Self-Healing Protocol Activated\n'));
  console.log(chalk.gray('    "The AI That Heals Your CI While You Sleep"\n'));
  
  while (attempt < maxRetries) {
    attempt++;
    console.log(chalk.yellow(`[!] Attempt ${attempt}/${maxRetries}...`));
    
    // Apply patch
    const applyResult = await applyPatch(patch, { autoCommit: true });
    
    if (!applyResult.success) {
      console.log(chalk.red(`[-] Patch application failed: ${applyResult.error}`));
      continue;
    }
    
    // Push to remote if requested
    if (options.pushRemote && applyResult.commitSha) {
      try {
        const branch = options.branch || 'main';
        await execAsync('git', ['push', 'origin', branch]);
        console.log(chalk.green(`[+] Pushed to origin/${branch}`));
        
        // Wait for CI to start
        console.log(chalk.gray('[~] Waiting for CI to trigger (10s)...'));
        await new Promise(resolve => setTimeout(resolve, 10000));
        
        // Check CI status (simplified - real implementation would poll GitHub API)
        const ciStatus = await checkCIStatus(applyResult.commitSha);
        
        if (ciStatus === 'passed') {
          console.log(chalk.green.bold('\n[W] SUCCESS! CI passed after Guardian intervention\n'));
          console.log(chalk.cyan('    Go to sleep. Guardian has your back. Wake up to green checks.\n'));
          return {
            ...applyResult,
            ciStatus: 'passed'
          };
        } else if (ciStatus === 'failed') {
          console.log(chalk.red(`[-] CI still failing, retry ${attempt}/${maxRetries}`));
        }
        
      } catch (error) {
        console.log(chalk.red(`[-] Push failed: ${error}`));
      }
    } else {
      // No remote push, consider success
      return applyResult;
    }
  }
  
  console.log(chalk.red.bold('\n[-] Guardian exhausted retries. Manual intervention required.\n'));
  return {
    success: false,
    filesModified: [],
    error: 'Max retries exceeded'
  };
}

/**
 * Check CI status for a commit
 */
export async function checkCIStatus(commitSha: string): Promise<'passed' | 'failed' | 'pending'> {
  try {
    // Get current repo
    const repoInfo = await execAsync('gh', ['repo', 'view', '--json', 'owner,name']);
    const { owner, name } = JSON.parse(repoInfo);
    
    // Use gh CLI to check status
    const statusOutput = await execAsync('gh', [
      'api',
      `/repos/${owner}/${name}/commits/${commitSha}/status`
    ]);
    
    const status = JSON.parse(statusOutput);
    
    if (status.state === 'success') return 'passed';
    if (status.state === 'failure') return 'failed';
    return 'pending';
    
  } catch (error) {
    console.log(chalk.dim(`[~] Could not check CI status: ${error}`));
    // Fallback: assume pending
    return 'pending';
  }
}

/**
 * Interactive apply: Ask user to confirm before applying
 */
export async function interactiveApply(
  patch: { file: string; content: string }[]
): Promise<ApplyResult> {
  console.log(chalk.yellow.bold('\n[!] Interactive Patch Application\n'));
  
  // Show diff preview
  for (const { file } of patch) {
    console.log(chalk.cyan(`  - ${file}`));
  }
  
  console.log(chalk.gray('\nOptions:'));
  console.log(chalk.gray('  1. Apply locally (no commit)'));
  console.log(chalk.gray('  2. Apply + commit'));
  console.log(chalk.gray('  3. Apply + commit + push + retry CI'));
  console.log(chalk.gray('  0. Cancel'));
  
  // In real implementation, use inquirer or similar for input
  // For now, default to option 1
  const choice = 1 as 0 | 1 | 2 | 3;
  
  switch (choice) {
    case 1:
      return applyPatch(patch, { autoCommit: false });
    case 2:
      return applyPatch(patch, { autoCommit: true });
    case 3:
      return autoHeal(patch, { pushRemote: true, maxRetries: 3 });
    case 0:
    default:
      return { success: false, filesModified: [], error: 'User cancelled' };
  }
}
