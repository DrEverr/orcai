import { afterAll, expect, test } from "bun:test";
import { chmod, mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const tempDirs: string[] = [];
afterAll(async () => {
  await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })));
});

test("failed first CLI launch records a backlog fallback but no resumable session id", async () => {
  const home = await mkdtemp(join(tmpdir(), "orcai-launcher-home-"));
  const workdir = await mkdtemp(join(tmpdir(), "orcai-launcher-workdir-"));
  const fakeCli = join(home, "fake-codex");
  tempDirs.push(home, workdir);

  await Bun.write(fakeCli, "#!/usr/bin/env bun\nprocess.exit(130);\n");
  await chmod(fakeCli, 0o755);

  const sessionModule = new URL("./session.ts", import.meta.url).href;
  const launcherModule = new URL("./launcher.ts", import.meta.url).href;
  const script = `
    const { createSession } = await import(${JSON.stringify(sessionModule)});
    const { delegate } = await import(${JSON.stringify(launcherModule)});
    const session = await createSession("broken-cli", ${JSON.stringify(workdir)});
    const agent = {
      id: "coder",
      name: "Coder",
      provider: "openai",
      cli: "codex",
      model: "m",
      backstory: "test role"
    };
    const config = { clis: { codex: ${JSON.stringify(fakeCli)}, claude: "claude" } };
    const result = await delegate(session, agent, config, "do work");
    console.log(JSON.stringify({ result, role: session.roles.coder, last: session.lastOutput }));
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
  const parsed = JSON.parse(stdout) as {
    result: { exitCode: number; sessionSaved: boolean; autoCaptured: boolean; sessionReset: boolean; output: string };
    role: { cliSessionId: string | null; lastUsedAt: string | null };
    last: { roleId: string; text: string } | null;
  };
  expect(parsed.result.exitCode).toBe(130);
  expect(parsed.result.sessionSaved).toBe(false);
  expect(parsed.result.autoCaptured).toBe(true);
  expect(parsed.result.sessionReset).toBe(false);
  expect(parsed.result.output).toContain("was interrupted");
  expect(parsed.role.cliSessionId).toBe(null);
  expect(parsed.role.lastUsedAt).toBe(null);
  expect(parsed.last?.roleId).toBe("coder");
  expect(parsed.last?.text).toContain("No resumable CLI session");
});

test("successful CLI launch without role output records a resumable fallback", async () => {
  const home = await mkdtemp(join(tmpdir(), "orcai-launcher-home-"));
  const workdir = await mkdtemp(join(tmpdir(), "orcai-launcher-workdir-"));
  const fakeCli = join(home, "fake-claude");
  tempDirs.push(home, workdir);

  await Bun.write(fakeCli, "#!/usr/bin/env bun\nprocess.exit(0);\n");
  await chmod(fakeCli, 0o755);

  const sessionModule = new URL("./session.ts", import.meta.url).href;
  const launcherModule = new URL("./launcher.ts", import.meta.url).href;
  const script = `
    const { createSession } = await import(${JSON.stringify(sessionModule)});
    const { delegate } = await import(${JSON.stringify(launcherModule)});
    const session = await createSession("empty-success", ${JSON.stringify(workdir)});
    const agent = {
      id: "manager",
      name: "Manager",
      provider: "anthropic",
      cli: "claude",
      model: "m",
      backstory: "test role"
    };
    const config = { clis: { codex: "codex", claude: ${JSON.stringify(fakeCli)} } };
    const result = await delegate(session, agent, config, "do work");
    console.log(JSON.stringify({ result, role: session.roles.manager, last: session.lastOutput }));
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
  const parsed = JSON.parse(stdout) as {
    result: { exitCode: number; sessionSaved: boolean; autoCaptured: boolean; sessionReset: boolean; output: string };
    role: { cliSessionId: string | null; lastUsedAt: string | null };
    last: { roleId: string; text: string } | null;
  };
  expect(parsed.result.exitCode).toBe(0);
  expect(parsed.result.sessionSaved).toBe(true);
  expect(parsed.result.autoCaptured).toBe(true);
  expect(parsed.result.sessionReset).toBe(false);
  expect(parsed.result.output).toContain("without adding a backlog entry");
  expect(parsed.role.cliSessionId).toBeString();
  expect(parsed.role.lastUsedAt).toBeString();
  expect(parsed.last?.roleId).toBe("manager");
});

test("missing claude session starts a fresh conversation and saves the new id", async () => {
  const home = await mkdtemp(join(tmpdir(), "orcai-launcher-home-"));
  const workdir = await mkdtemp(join(tmpdir(), "orcai-launcher-workdir-"));
  const fakeCli = join(home, "fake-claude");
  const argsFile = join(home, "args.json");
  tempDirs.push(home, workdir);

  await Bun.write(
    fakeCli,
    `#!/usr/bin/env bun\nawait Bun.write(${JSON.stringify(argsFile)}, JSON.stringify(process.argv.slice(2)));\nprocess.exit(0);\n`,
  );
  await chmod(fakeCli, 0o755);

  const sessionModule = new URL("./session.ts", import.meta.url).href;
  const launcherModule = new URL("./launcher.ts", import.meta.url).href;
  const script = `
    const { createSession } = await import(${JSON.stringify(sessionModule)});
    const { delegate } = await import(${JSON.stringify(launcherModule)});
    const session = await createSession("stale-claude", ${JSON.stringify(workdir)});
    session.roles.manager = { cliSessionId: "deleted-session", lastUsedAt: "2026-07-14T00:00:00.000Z" };
    const agent = {
      id: "manager",
      name: "Manager",
      provider: "anthropic",
      cli: "claude",
      model: "m",
      backstory: "test role"
    };
    const config = { clis: { codex: "codex", claude: ${JSON.stringify(fakeCli)} } };
    const result = await delegate(session, agent, config, "do work");
    const args = JSON.parse(await Bun.file(${JSON.stringify(argsFile)}).text());
    console.log(JSON.stringify({ result, role: session.roles.manager, args }));
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
  const parsed = JSON.parse(stdout) as {
    result: { exitCode: number; sessionSaved: boolean; autoCaptured: boolean; sessionReset: boolean };
    role: { cliSessionId: string | null; lastUsedAt: string | null };
    args: string[];
  };
  expect(parsed.result.exitCode).toBe(0);
  expect(parsed.result.sessionSaved).toBe(true);
  expect(parsed.result.sessionReset).toBe(true);
  const newId = parsed.role.cliSessionId;
  expect(newId).toBeString();
  if (!newId) throw new Error("Expected renewed Claude session id");
  expect(newId).not.toBe("deleted-session");
  expect(parsed.args).toContain("--session-id");
  expect(parsed.args).not.toContain("--resume");
  expect(parsed.args[parsed.args.indexOf("--session-id") + 1]).toBe(newId);
});

test("existing claude session resumes the saved id", async () => {
  const home = await mkdtemp(join(tmpdir(), "orcai-launcher-home-"));
  const workdir = await mkdtemp(join(tmpdir(), "orcai-launcher-workdir-"));
  const fakeCli = join(home, "fake-claude");
  const argsFile = join(home, "args.json");
  const oldId = "existing-session";
  tempDirs.push(home, workdir);

  await Bun.write(
    fakeCli,
    `#!/usr/bin/env bun\nawait Bun.write(${JSON.stringify(argsFile)}, JSON.stringify(process.argv.slice(2)));\nprocess.exit(0);\n`,
  );
  await chmod(fakeCli, 0o755);
  await mkdir(join(home, ".claude", "projects", "project-a"), { recursive: true });
  await Bun.write(join(home, ".claude", "projects", "project-a", `${oldId}.jsonl`), "");

  const sessionModule = new URL("./session.ts", import.meta.url).href;
  const launcherModule = new URL("./launcher.ts", import.meta.url).href;
  const script = `
    const { createSession } = await import(${JSON.stringify(sessionModule)});
    const { delegate } = await import(${JSON.stringify(launcherModule)});
    const session = await createSession("existing-claude", ${JSON.stringify(workdir)});
    session.roles.manager = { cliSessionId: ${JSON.stringify(oldId)}, lastUsedAt: "2026-07-14T00:00:00.000Z" };
    const agent = {
      id: "manager",
      name: "Manager",
      provider: "anthropic",
      cli: "claude",
      model: "m",
      backstory: "test role"
    };
    const config = { clis: { codex: "codex", claude: ${JSON.stringify(fakeCli)} } };
    const result = await delegate(session, agent, config, "do work");
    const args = JSON.parse(await Bun.file(${JSON.stringify(argsFile)}).text());
    console.log(JSON.stringify({ result, role: session.roles.manager, args }));
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
  const parsed = JSON.parse(stdout) as {
    result: { exitCode: number; sessionSaved: boolean; autoCaptured: boolean; sessionReset: boolean };
    role: { cliSessionId: string | null; lastUsedAt: string | null };
    args: string[];
  };
  expect(parsed.result.exitCode).toBe(0);
  expect(parsed.result.sessionSaved).toBe(true);
  expect(parsed.result.sessionReset).toBe(false);
  expect(parsed.role.cliSessionId).toBe(oldId);
  expect(parsed.args).toContain("--resume");
  expect(parsed.args).not.toContain("--session-id");
  expect(parsed.args[parsed.args.indexOf("--resume") + 1]).toBe(oldId);
});
