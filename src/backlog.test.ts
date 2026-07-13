import { afterAll, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { appendBacklog, backlogMarker, backlogSince, readBacklog } from "./backlog.ts";

const dir = await mkdtemp(join(tmpdir(), "orcai-backlog-"));
afterAll(() => rm(dir, { recursive: true, force: true }));

test("backlog lives in the workdir and capture returns only new content", async () => {
  await appendBacklog(dir, "coder", "first entry");
  const marker = await backlogMarker(dir);

  await appendBacklog(dir, "reviewer", "second entry");
  const captured = await backlogSince(dir, marker);

  expect(captured).toContain("[reviewer]");
  expect(captured).toContain("second entry");
  expect(captured).not.toContain("first entry"); // only what came after the marker

  const all = await readBacklog(dir);
  expect(all).toContain("first entry");
  expect(all).toContain("second entry");
  // written into the workdir, not the session metadata dir
  expect(await Bun.file(join(dir, "backlog.md")).exists()).toBe(true);
});
