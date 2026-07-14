import { homedir } from "node:os";
import { join, resolve } from "node:path";

export const ROOT = join(homedir(), ".orcai");
export const CONFIG_FILE = join(ROOT, "config.json");
export const AGENTS_FILE = join(ROOT, "agents.yaml");
export const SESSIONS_DIR = join(ROOT, "sessions");

/** Orchestrator metadata lives under ~/.orcai/sessions/<name>/. */
export function sessionDir(name: string): string {
  return join(SESSIONS_DIR, name);
}
export function sessionFile(name: string): string {
  return join(sessionDir(name), "session.json");
}
export function transcriptFile(name: string): string {
  return join(sessionDir(name), "transcript.md");
}

/** The shared team backlog is scoped to a single orcai session. */
export function backlogPath(name: string): string {
  return join(sessionDir(name), "backlog.md");
}

export function attachmentsDir(name: string): string {
  return join(sessionDir(name), "attachments");
}

/** Guard against path traversal: resolved session dir must stay under SESSIONS_DIR. */
export function isInsideSessions(name: string): boolean {
  const base = resolve(SESSIONS_DIR);
  const dir = resolve(sessionDir(name));
  return dir === join(base, name) && dir.startsWith(base + "/");
}

/** Codex stores its session index and rollouts here (used to capture session UUIDs). */
export const CODEX_HOME = join(homedir(), ".codex");
export const CODEX_SESSION_INDEX = join(CODEX_HOME, "session_index.jsonl");
export const CODEX_SESSIONS_DIR = join(CODEX_HOME, "sessions");

/** Claude Code stores project-scoped session transcripts here. */
export const CLAUDE_PROJECTS_DIR = join(homedir(), ".claude", "projects");
