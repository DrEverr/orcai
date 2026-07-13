import { mkdir, readdir, stat } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import {
  SESSIONS_DIR,
  sessionDir,
  sessionFile,
  transcriptFile,
  backlogPath,
  isInsideSessions,
} from "./paths.ts";
import { readJson, writeJson } from "./store.ts";
import type { Agent, SessionData, RoleState } from "./types.ts";

const NAME_RE = /^[a-zA-Z0-9._-]+$/;

/** Reject names that are unsafe or escape the sessions directory. */
export function validateSessionName(name: string): void {
  if (!name || name === "." || name === ".." || !NAME_RE.test(name)) {
    throw new Error(
      `Invalid session name "${name}". Allowed: letters, numbers, . _ - (excluding / and ..).`,
    );
  }
  if (!isInsideSessions(name)) {
    throw new Error(`Session name "${name}" escapes the sessions directory.`);
  }
}

/** Resolve workdir to an absolute path and verify it is an existing directory. */
export function expandWorkdir(workdir: string): string {
  if (workdir === "~") return homedir();
  if (workdir.startsWith("~/")) return join(homedir(), workdir.slice(2));
  return resolve(workdir);
}

async function resolveWorkdir(workdir: string): Promise<string> {
  const abs = expandWorkdir(workdir);
  let s: Awaited<ReturnType<typeof stat>>;
  try {
    s = await stat(abs);
  } catch {
    throw new Error(`Working directory does not exist: ${abs}`);
  }
  if (!s.isDirectory()) throw new Error(`Working path is not a directory: ${abs}`);
  return abs;
}

export async function listSessions(): Promise<string[]> {
  try {
    const entries = await readdir(SESSIONS_DIR, { withFileTypes: true });
    return entries.filter((e) => e.isDirectory()).map((e) => e.name);
  } catch {
    return [];
  }
}

export async function sessionExists(name: string): Promise<boolean> {
  if (!NAME_RE.test(name)) return false;
  return Bun.file(sessionFile(name)).exists();
}

export async function createSession(name: string, workdir: string): Promise<SessionData> {
  validateSessionName(name);
  const absWorkdir = await resolveWorkdir(workdir);
  if (await sessionExists(name)) throw new Error(`Session "${name}" already exists.`);

  await mkdir(sessionDir(name), { recursive: true });
  const data: SessionData = {
    name,
    createdAt: new Date().toISOString(),
    workdir: absWorkdir,
    roles: {},
    lastOutput: null,
  };
  await saveSession(data);
  await Bun.write(
    transcriptFile(name),
    `# Transcript — session ${name}\n\nCreated ${data.createdAt} (workdir: ${absWorkdir})\n\n`,
  );
  // Seed the shared backlog in the workdir only if one isn't already there.
  const backlog = backlogPath(absWorkdir);
  if (!(await Bun.file(backlog).exists())) {
    await Bun.write(backlog, `# Backlog — session ${name}\n\n`);
  }
  return data;
}

/** Create the default startup session for `orcai` with no subcommand. */
export async function createStartupSession(workdir = process.cwd()): Promise<SessionData> {
  return createSession(randomUUID(), workdir);
}

export async function loadSession(name: string): Promise<SessionData> {
  validateSessionName(name);
  const data = await readJson<SessionData | null>(sessionFile(name), null);
  if (!data) throw new Error(`Session "${name}" does not exist.`);
  return data;
}

export async function saveSession(data: SessionData): Promise<void> {
  await writeJson(sessionFile(data.name), data);
}

/** Ensure a role has a state entry; create an empty one if missing. */
export function roleState(session: SessionData, agent: Agent): RoleState {
  let state = session.roles[agent.id];
  if (!state) {
    state = { cliSessionId: null, lastUsedAt: null };
    session.roles[agent.id] = state;
  }
  return state;
}
