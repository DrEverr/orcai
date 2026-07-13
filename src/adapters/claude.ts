import type { CliAdapter } from "./types.ts";

/**
 * Claude Code adapter. Runs interactively (no --print) so the user handles
 * permission/plan prompts natively in the terminal.
 *
 * We assign the session UUID ourselves via --session-id on the first launch and
 * resume with --resume afterwards. Backstory is injected via --append-system-prompt
 * on the first launch only (the resumed session already carries it).
 */
export const claudeAdapter: CliAdapter = {
  preassignsSessionId: true,

  buildArgs({ model, sessionId, isNew, backstory, sessionDir, prompt, extraFlags }) {
    const args: string[] = [];
    if (isNew) {
      args.push("--session-id", sessionId!);
      args.push("--append-system-prompt", backstory);
    } else {
      args.push("--resume", sessionId!);
    }
    args.push("--model", model);
    args.push("--add-dir", sessionDir);
    args.push(...extraFlags);
    // --add-dir is variadic in Claude Code. Without an option terminator, the
    // initial prompt is consumed as another directory and never reaches Claude.
    args.push("--", prompt);
    return args;
  },
};
