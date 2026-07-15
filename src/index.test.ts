import { afterAll, expect, test } from "bun:test";
import { mkdir, mkdtemp, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import packageJson from "../package.json";

const tempDirs: string[] = [];
afterAll(async () => {
  await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })));
});

async function waitForStartupSession(home: string): Promise<string> {
  const sessionsDir = join(home, ".orcai", "sessions");
  const deadline = Date.now() + 2000;
  while (Date.now() < deadline) {
    try {
      const sessions = await readdir(sessionsDir);
      if (sessions.length === 1) return sessions[0]!;
    } catch {}
    await Bun.sleep(10);
  }
  throw new Error("Timed out waiting for startup session");
}

async function runCli(args: string[], home: string, cwd: string) {
  const indexFile = new URL("./index.ts", import.meta.url).pathname;
  const proc = Bun.spawn({
    cmd: [process.execPath, indexFile, ...args],
    cwd,
    env: { ...process.env, HOME: home },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { stdout, stderr, exitCode };
}

test("version flags print package version without creating a session", async () => {
  const home = await mkdtemp(join(process.env.TMPDIR ?? "/tmp", "orcai-home-"));
  const workdir = await mkdtemp(join(process.env.TMPDIR ?? "/tmp", "orcai-workdir-"));
  tempDirs.push(home, workdir);

  for (const flag of ["--version", "-V", "version"]) {
    const { stdout, stderr, exitCode } = await runCli([flag], home, workdir);

    expect(stderr).toBe("");
    expect(exitCode).toBe(0);
    expect(stdout.trim()).toBe(packageJson.version);
  }
  expect(await Bun.file(join(home, ".orcai", "sessions")).exists()).toBe(false);
});

test("help flags print usage without creating a session", async () => {
  const home = await mkdtemp(join(process.env.TMPDIR ?? "/tmp", "orcai-home-"));
  const workdir = await mkdtemp(join(process.env.TMPDIR ?? "/tmp", "orcai-workdir-"));
  tempDirs.push(home, workdir);

  for (const args of [
    ["--help"],
    ["-h"],
    ["help"],
    ["new", "--help"],
    ["resume", "-h"],
    ["list", "help"],
  ]) {
    const { stdout, stderr, exitCode } = await runCli(args, home, workdir);

    expect(stderr).toBe("");
    expect(exitCode).toBe(0);
    expect(stdout).toContain("Usage:");
  }
  expect(await Bun.file(join(home, ".orcai", "sessions")).exists()).toBe(false);
});

test("startup validates config before creating session files", async () => {
  const home = await mkdtemp(join(process.env.TMPDIR ?? "/tmp", "orcai-home-"));
  const workdir = await mkdtemp(join(process.env.TMPDIR ?? "/tmp", "orcai-workdir-"));
  const indexFile = new URL("./index.ts", import.meta.url).pathname;
  tempDirs.push(home, workdir);

  await mkdir(join(home, ".orcai"), { recursive: true });
  await Bun.write(join(home, ".orcai", "config.json"), "{");

  const proc = Bun.spawn({
    cmd: [process.execPath, indexFile],
    cwd: workdir,
    env: { ...process.env, HOME: home },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stderr, exitCode] = await Promise.all([
    new Response(proc.stderr).text(),
    proc.exited,
  ]);

  expect(exitCode).toBe(1);
  expect(stderr).toContain("✖");
  expect(await Bun.file(join(home, ".orcai", "sessions")).exists()).toBe(false);
  expect(await Bun.file(join(workdir, "backlog.md")).exists()).toBe(false);
});

test("startup exit shows how to resume the generated session", async () => {
  const home = await mkdtemp(join(process.env.TMPDIR ?? "/tmp", "orcai-home-"));
  const workdir = await mkdtemp(join(process.env.TMPDIR ?? "/tmp", "orcai-workdir-"));
  const indexFile = new URL("./index.ts", import.meta.url).pathname;
  tempDirs.push(home, workdir);

  const proc = Bun.spawn({
    cmd: [process.execPath, indexFile],
    cwd: workdir,
    env: { ...process.env, HOME: home },
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
  });

  proc.stdin.write("/quit\n");
  proc.stdin.end();

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);

  expect(stderr).toBe("");
  expect(exitCode).toBe(0);

  const sessions = await readdir(join(home, ".orcai", "sessions"));
  expect(sessions).toHaveLength(1);
  expect(stdout).toContain(`orcai resume ${sessions[0]}`);
  expect(stdout).toContain("Goodbye.");
});

test("startup SIGINT shows how to resume the generated session", async () => {
  const home = await mkdtemp(join(process.env.TMPDIR ?? "/tmp", "orcai-home-"));
  const workdir = await mkdtemp(join(process.env.TMPDIR ?? "/tmp", "orcai-workdir-"));
  const indexFile = new URL("./index.ts", import.meta.url).pathname;
  tempDirs.push(home, workdir);

  const proc = Bun.spawn({
    cmd: [process.execPath, indexFile],
    cwd: workdir,
    env: { ...process.env, HOME: home },
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
  });

  const session = await waitForStartupSession(home);
  await Bun.sleep(50);
  proc.kill("SIGINT");

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);

  expect(stderr).toBe("");
  expect(exitCode).toBe(0);
  expect(stdout).toContain(`orcai resume ${session}`);
  expect(stdout).toContain("Goodbye.");
});
