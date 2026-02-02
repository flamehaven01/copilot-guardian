import path from "node:path";
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

import { analyzeRun } from "./analyze";
import { generatePatchOptions } from "./patch_options";
import { ensureDir, loadText, writeText, extractJsonObject } from "./util";
import { copilotChatAsync } from "./async-exec";

/**
 * Async wrapper for copilot chat (replaces blocking execSync)
 */
async function copilotChat(payload: string): Promise<string> {
  return await copilotChatAsync(payload, {
    showSpinner: false,
    spinnerText: 'Asking Copilot...'
  });
}

export async function debugInteractive(repo: string, runId: number, outDir = path.join(process.cwd(), ".copilot-guardian")) {
  ensureDir(outDir);

  const { analysis, ctx } = await analyzeRun(repo, runId, outDir);

  const rl = readline.createInterface({ input, output });
  const transcriptPath = path.join(outDir, "debug.transcript.md");
  writeText(transcriptPath, `# copilot-guardian debug transcript\n\nRepo: ${repo}\nRun: ${runId}\n\n`);

  // Thin interactive layer: ask follow-ups, then optionally generate patch spectrum.
  while (true) {
    output.write("\nChoose an action:\n");
    output.write("  1) Ask Copilot a follow-up question\n");
    output.write("  2) Generate patch options (Conservative/Balanced/Aggressive)\n");
    output.write("  3) Exit\n\n");

    const choice = (await rl.question("Your choice (1-3): ")).trim();

    if (choice === "3") break;

    if (choice === "2") {
      await generatePatchOptions(analysis, outDir);
      output.write(`\n[+] Patch options generated. See: ${path.join(outDir, "patch_options.json")}\n`);
      continue;
    }

    if (choice !== "1") {
      output.write("Invalid choice.\n");
      continue;
    }

    const q = (await rl.question("\nAsk Copilot: ")).trim();
    if (!q) continue;

    const prompt = loadText(path.join(process.cwd(), "prompts", "debug.followup.v1.txt"));
    const payload = `${prompt}\n\nCONTEXT:\n${JSON.stringify({
      repo,
      run_id: runId,
      selected: analysis.diagnosis.selected_hypothesis_id,
      root_cause: analysis.diagnosis.root_cause,
      log_excerpt: ctx.logExcerpt
    }, null, 2)}\n\nQUESTION:\n${q}`;

    const raw = await copilotChat(payload);
    writeText(path.join(outDir, "copilot.debug.followup.raw.txt"), raw);

    const obj = JSON.parse(extractJsonObject(raw));
    if (typeof obj.answer !== "string" || typeof obj.next_check !== "string" || typeof obj.confidence !== "number") {
      throw new Error("Invalid follow-up JSON from Copilot (expected {answer, confidence, next_check})");
    }

    // Append transcript with actual values
    const snippet = `\n## Q: ${q}\n\n${obj.answer}\n\n- confidence: ${obj.confidence}\n- next_check: ${obj.next_check}\n`;
    writeText(transcriptPath, loadText(transcriptPath) + snippet);

    output.write(`\nCopilot: ${obj.answer}\nNext check: ${obj.next_check}\n`);
  }

  rl.close();
  return { outDir, analysis };
}
