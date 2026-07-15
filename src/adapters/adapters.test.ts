import { expect, test } from "bun:test";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { claudeAdapter } from "./claude.ts";
import { codexAdapter } from "./codex.ts";

const base = {
  model: "m",
  backstory: "BS",
  sessionDir: "/s",
  prompt: "P",
  attachments: [],
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

test("claude includes image attachment paths in the prompt", () => {
  const args = claudeAdapter.buildArgs({
    ...base,
    sessionId: "u1",
    isNew: false,
    attachments: [{ token: "[Image #1]", path: "/s/attachments/pasted-1.png" }],
  });
  expect(args.at(-1)).toBe("P\n\nAttached images:\n[Image #1]: @/s/attachments/pasted-1.png");
});

test("claude replaces image tokens embedded in the prompt", () => {
  const args = claudeAdapter.buildArgs({
    ...base,
    sessionId: "u1",
    isNew: false,
    prompt: "Describe [Image #1], then compare it with [Image #1].",
    attachments: [{ token: "[Image #1]", path: "/s/attachments/pasted-1.png" }],
  });
  expect(args.at(-1)).toBe(
    "Describe @/s/attachments/pasted-1.png, then compare it with @/s/attachments/pasted-1.png.",
  );
});

test("claude appends image references whose tokens are absent from the prompt", () => {
  const args = claudeAdapter.buildArgs({
    ...base,
    sessionId: "u1",
    isNew: false,
    prompt: "Describe the attached image.",
    attachments: [{ token: "[Image #1]", path: "/s/attachments/pasted-1.png" }],
  });
  expect(args.at(-1)).toBe("Describe the attached image.\n\nAttached images:\n[Image #1]: @/s/attachments/pasted-1.png");
});

test("claude uses an explicit read instruction for image paths with spaces", () => {
  const args = claudeAdapter.buildArgs({
    ...base,
    sessionId: "u1",
    isNew: false,
    prompt: "Describe [Image #1].",
    attachments: [{ token: "[Image #1]", path: "/s/attachments/pasted 1.png" }],
  });
  expect(args.at(-1)).toBe("Describe Attached image (read this file): /s/attachments/pasted 1.png.");
});

test("claude preassigns its own session id", () => {
  expect(claudeAdapter.preassignsSessionId).toBe(true);
});

test("codex new: -m + backstory prepended to prompt", () => {
  const args = codexAdapter.buildArgs({ ...base, sessionId: null, isNew: true });
  expect(args).toEqual(["-m", "m", "--add-dir", "/s", "--", "BS\n\n---\n\nP"]);
});

test("codex resume: resume subcommand passes -m so model changes apply", () => {
  const args = codexAdapter.buildArgs({ ...base, sessionId: "u9", isNew: false });
  expect(args).toEqual(["resume", "-m", "m", "u9", "--add-dir", "/s", "--", "P"]);
});

test("codex passes image attachments with -i", () => {
  const args = codexAdapter.buildArgs({
    ...base,
    sessionId: "u9",
    isNew: false,
    attachments: [{ token: "[Image #1]", path: "/s/attachments/pasted-1.png" }],
  });
  expect(args).toEqual([
    "resume", "-m", "m", "u9",
    "--add-dir", "/s",
    "-i", "/s/attachments/pasted-1.png",
    "--", "P",
  ]);
});

test("codex must snapshot + capture its own session id", () => {
  expect(codexAdapter.preassignsSessionId).toBe(false);
  expect(typeof codexAdapter.snapshot).toBe("function");
  expect(typeof codexAdapter.captureSessionId).toBe("function");
});

test("codex captures a new session id from rollout files when the index is stale", async () => {
  const home = await mkdtemp(join(process.env.TMPDIR ?? "/tmp", "orcai-codex-home-"));
  const workdir = await mkdtemp(join(process.env.TMPDIR ?? "/tmp", "orcai-codex-workdir-"));
  try {
    const sessionsDir = join(home, ".codex", "sessions", "2026", "07", "13");
    await mkdir(sessionsDir, { recursive: true });
    await Bun.write(
      join(sessionsDir, "rollout-2026-07-13T12-00-00-old-session.jsonl"),
      JSON.stringify({
        timestamp: "2026-07-13T12:00:00.000Z",
        type: "session_meta",
        payload: { session_id: "old-session", timestamp: "2026-07-13T12:00:00.000Z", cwd: workdir },
      }) + "\n",
    );

    const adapterModule = new URL("./codex.ts", import.meta.url).href;
    const script = `
      const { codexAdapter } = await import(${JSON.stringify(adapterModule)});
      const snapshot = await codexAdapter.snapshot();
      await Bun.write(${JSON.stringify(join(sessionsDir, "rollout-2026-07-13T12-05-00-new-session.jsonl"))}, JSON.stringify({
        timestamp: "2026-07-13T12:05:00.000Z",
        type: "session_meta",
        payload: { session_id: "new-session", timestamp: "2026-07-13T12:05:00.000Z", cwd: ${JSON.stringify(workdir)} },
      }) + "\\n");
      const id = await codexAdapter.captureSessionId(snapshot, Date.parse("2026-07-13T12:04:58.000Z"), ${JSON.stringify(workdir)});
      console.log(id);
    `;
    const proc = Bun.spawn({
      cmd: [process.execPath, "--eval", script],
      env: { ...process.env, HOME: home },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);

    expect(stderr).toBe("");
    expect(exitCode).toBe(0);
    expect(stdout.trim()).toBe("new-session");
  } finally {
    await rm(home, { recursive: true, force: true });
    await rm(workdir, { recursive: true, force: true });
  }
});

test("codex resumable reports present and absent session ids", async () => {
  const home = await mkdtemp(join(process.env.TMPDIR ?? "/tmp", "orcai-codex-home-"));
  const workdir = await mkdtemp(join(process.env.TMPDIR ?? "/tmp", "orcai-codex-workdir-"));
  try {
    const sessionsDir = join(home, ".codex", "sessions", "2026", "07", "14");
    await mkdir(sessionsDir, { recursive: true });
    await Bun.write(
      join(sessionsDir, "rollout-2026-07-14T12-00-00-present-session.jsonl"),
      JSON.stringify({
        timestamp: "2026-07-14T12:00:00.000Z",
        type: "session_meta",
        payload: { session_id: "present-session", timestamp: "2026-07-14T12:00:00.000Z", cwd: workdir },
      }) + "\n",
    );

    const adapterModule = new URL("./codex.ts", import.meta.url).href;
    const script = `
      const { codexAdapter } = await import(${JSON.stringify(adapterModule)});
      const present = await codexAdapter.resumable("present-session", ${JSON.stringify(workdir)});
      const absent = await codexAdapter.resumable("absent-session", ${JSON.stringify(workdir)});
      console.log(JSON.stringify({ present, absent }));
    `;
    const proc = Bun.spawn({
      cmd: [process.execPath, "--eval", script],
      env: { ...process.env, HOME: home },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);

    expect(stderr).toBe("");
    expect(exitCode).toBe(0);
    expect(JSON.parse(stdout)).toEqual({ present: true, absent: false });
  } finally {
    await rm(home, { recursive: true, force: true });
    await rm(workdir, { recursive: true, force: true });
  }
});
