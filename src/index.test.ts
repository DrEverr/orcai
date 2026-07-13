import { afterAll, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";

const tempDirs: string[] = [];
afterAll(async () => {
  await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })));
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
