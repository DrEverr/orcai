import { afterAll, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { validateSessionName, createSession, expandWorkdir } from "./session.ts";

const tempDirs: string[] = [];
afterAll(async () => {
  await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })));
});

test("validateSessionName rejects traversal and unsafe names", () => {
  for (const bad of ["", ".", "..", "../x", "../../etc", "a/b", "a\\b", "na me"]) {
    expect(() => validateSessionName(bad)).toThrow();
  }
});

test("validateSessionName accepts safe names", () => {
  expect(() => validateSessionName("demo")).not.toThrow();
  expect(() => validateSessionName("demo_1.2-x")).not.toThrow();
});

test("expandWorkdir resolves home-relative paths", () => {
  expect(expandWorkdir("~")).toBe(homedir());
  expect(expandWorkdir("~/Development/orcai")).toBe(join(homedir(), "Development/orcai"));
});

test("createSession rejects a non-existent workdir (no writes)", async () => {
  await expect(
    createSession(`orcai_test_${randomUUID().slice(0, 8)}`, `/no/such/dir/${randomUUID()}`),
  ).rejects.toThrow(/does not exist/i);
});

test("createStartupSession creates a fresh UUID session for the current directory", async () => {
  const home = await mkdtemp(join(process.env.TMPDIR ?? "/tmp", "orcai-home-"));
  const workdir = await mkdtemp(join(process.env.TMPDIR ?? "/tmp", "orcai-workdir-"));
  tempDirs.push(home, workdir);

  const sessionModule = new URL("./session.ts", import.meta.url).href;
  const script = `
    const { createStartupSession } = await import(${JSON.stringify(sessionModule)});
    const first = await createStartupSession();
    const second = await createStartupSession();
    console.log(JSON.stringify([first, second]));
  `;
  const proc = Bun.spawn({
    cmd: [process.execPath, "--eval", script],
    cwd: workdir,
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

  const sessions = JSON.parse(stdout) as Array<{ name: string; workdir: string }>;
  const expectedWorkdir = await realpath(workdir);
  expect(sessions).toHaveLength(2);
  expect(sessions[0]!.name).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  expect(sessions[1]!.name).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  expect(sessions[0]!.name).not.toBe(sessions[1]!.name);
  expect(sessions[0]!.workdir).toBe(expectedWorkdir);
  expect(sessions[1]!.workdir).toBe(expectedWorkdir);

  for (const session of sessions) {
    expect(await Bun.file(join(home, ".orcai", "sessions", session.name, "session.json")).exists()).toBe(true);
    expect(await Bun.file(join(home, ".orcai", "sessions", session.name, "transcript.md")).exists()).toBe(true);
  }
  expect(await Bun.file(join(workdir, "backlog.md")).exists()).toBe(true);
});
