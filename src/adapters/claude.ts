import { stat } from "node:fs/promises";
import { CLAUDE_PROJECTS_DIR } from "../paths.ts";
import type { CliAdapter, ImageAttachment } from "./types.ts";

function claudeImageReference(attachment: ImageAttachment): string {
  if (/\s/.test(attachment.path)) return `Attached image (read this file): ${attachment.path}`;
  return `@${attachment.path}`;
}

function promptWithImageReferences(prompt: string, attachments: ImageAttachment[]): string {
  let nextPrompt = prompt;
  const footer: string[] = [];

  for (const attachment of attachments) {
    const reference = claudeImageReference(attachment);
    if (nextPrompt.includes(attachment.token)) {
      nextPrompt = nextPrompt.split(attachment.token).join(reference);
    } else {
      footer.push(`${attachment.token}: ${reference}`);
    }
  }

  if (!footer.length) return nextPrompt;
  return `${nextPrompt}\n\nAttached images:\n${footer.join("\n")}`;
}

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

  async resumable(sessionId) {
    try {
      const projects = await stat(CLAUDE_PROJECTS_DIR);
      if (!projects.isDirectory()) return false;
      const glob = new Bun.Glob(`**/${sessionId}.jsonl`);
      for await (const _ of glob.scan({ cwd: CLAUDE_PROJECTS_DIR })) return true;
      return false;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return false;
      return true;
    }
  },

  buildArgs({ model, sessionId, isNew, backstory, sessionDir, prompt, attachments, extraFlags }) {
    const args: string[] = [];
    const promptWithAttachments = promptWithImageReferences(prompt, attachments);
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
    args.push("--", promptWithAttachments);
    return args;
  },
};
