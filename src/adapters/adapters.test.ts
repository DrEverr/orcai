import { expect, test } from "bun:test";
import { claudeAdapter } from "./claude.ts";
import { codexAdapter } from "./codex.ts";

const base = {
  model: "m",
  backstory: "BS",
  sessionDir: "/s",
  prompt: "P",
  extraFlags: [] as string[],
};

test("claude new: --session-id + --append-system-prompt", () => {
  const args = claudeAdapter.buildArgs({ ...base, sessionId: "u1", isNew: true });
  expect(args).toEqual([
    "--session-id", "u1",
    "--append-system-prompt", "BS",
    "--model", "m",
    "--add-dir", "/s",
    "--", "P",
  ]);
});

test("claude resume: --resume, no backstory re-injection", () => {
  const args = claudeAdapter.buildArgs({ ...base, sessionId: "u1", isNew: false });
  expect(args).toEqual(["--resume", "u1", "--model", "m", "--add-dir", "/s", "--", "P"]);
  expect(args).not.toContain("--append-system-prompt");
});

test("claude preassigns its own session id", () => {
  expect(claudeAdapter.preassignsSessionId).toBe(true);
});

test("codex new: -m + backstory prepended to prompt", () => {
  const args = codexAdapter.buildArgs({ ...base, sessionId: null, isNew: true });
  expect(args).toEqual(["-m", "m", "--", "BS\n\n---\n\nP"]);
});

test("codex resume: resume subcommand passes -m so model changes apply", () => {
  const args = codexAdapter.buildArgs({ ...base, sessionId: "u9", isNew: false });
  expect(args).toEqual(["resume", "-m", "m", "u9", "--", "P"]);
});

test("codex must snapshot + capture its own session id", () => {
  expect(codexAdapter.preassignsSessionId).toBe(false);
  expect(typeof codexAdapter.snapshot).toBe("function");
  expect(typeof codexAdapter.captureSessionId).toBe("function");
});
