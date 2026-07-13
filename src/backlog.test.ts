import { afterAll, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const home = await mkdtemp(join(tmpdir(), "orcai-backlog-home-"));
afterAll(() => rm(home, { recursive: true, force: true }));

test("backlog lives in the session directory and capture returns only new content", async () => {
  const sessionName = "session-a";
  const backlogModule = new URL("./backlog.ts", import.meta.url).href;
  const script = `
    const { appendBacklog, backlogMarker, backlogSince, readBacklog } = await import(${JSON.stringify(backlogModule)});
    await appendBacklog(${JSON.stringify(sessionName)}, "coder", "first entry");
    const marker = await backlogMarker(${JSON.stringify(sessionName)});
    await appendBacklog(${JSON.stringify(sessionName)}, "reviewer", "second entry");
    const captured = await backlogSince(${JSON.stringify(sessionName)}, marker);
    const all = await readBacklog(${JSON.stringify(sessionName)});
    console.log(JSON.stringify({ captured, all }));
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

  const { captured, all } = JSON.parse(stdout) as { captured: string; all: string };
  expect(captured).toContain("[reviewer]");
  expect(captured).toContain("second entry");
  expect(captured).not.toContain("first entry"); // only what came after the marker

  expect(all).toContain("first entry");
  expect(all).toContain("second entry");
  expect(await Bun.file(join(home, ".orcai", "sessions", sessionName, "backlog.md")).exists()).toBe(true);
});
