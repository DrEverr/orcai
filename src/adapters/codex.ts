import { CODEX_SESSION_INDEX, CODEX_SESSIONS_DIR } from "../paths.ts";
import type { CliAdapter } from "./types.ts";

interface IndexEntry {
  id: string;
  at: number;
  cwd: string | null;
}

async function readIndex(): Promise<IndexEntry[]> {
  const file = Bun.file(CODEX_SESSION_INDEX);
  if (!(await file.exists())) return [];
  const out: IndexEntry[] = [];
  for (const line of (await file.text()).split("\n")) {
    if (!line.trim()) continue;
    try {
      const e = JSON.parse(line) as { id?: string; updated_at?: string };
      if (e.id && e.updated_at) out.push({ id: e.id, at: Date.parse(e.updated_at), cwd: null });
    } catch {
      // ignore malformed lines
    }
  }
  return out;
}

async function readRollouts(): Promise<IndexEntry[]> {
  const out: IndexEntry[] = [];
  try {
    const glob = new Bun.Glob("**/rollout-*.jsonl");
    for await (const f of glob.scan({ cwd: CODEX_SESSIONS_DIR, absolute: true })) {
      const text = await Bun.file(f).slice(0, 64 * 1024).text();
      for (const line of text.split("\n").slice(0, 15)) {
        if (!line.trim()) continue;
        try {
          const o = JSON.parse(line) as Record<string, unknown>;
          const payload = o.payload as Record<string, unknown> | undefined;
          const id = payload?.session_id ?? payload?.id ?? o.session_id ?? o.id;
          const cwd = payload?.cwd ?? o.cwd;
          const timestamp = payload?.timestamp ?? o.timestamp;
          if (typeof id === "string" && typeof timestamp === "string") {
            const at = Date.parse(timestamp);
            if (!Number.isNaN(at)) out.push({ id, at, cwd: typeof cwd === "string" ? cwd : null });
          }
          break;
        } catch {
          // keep scanning
        }
      }
    }
  } catch {
    // globbing/reading is best-effort only
  }
  return out;
}

async function readSessions(): Promise<IndexEntry[]> {
  const byId = new Map<string, IndexEntry>();
  for (const entry of await readIndex()) byId.set(entry.id, entry);
  for (const entry of await readRollouts()) {
    const current = byId.get(entry.id);
    if (!current || entry.at > current.at || current.cwd === null) byId.set(entry.id, entry);
  }
  return [...byId.values()];
}

/**
 * Codex adapter. Runs interactively so the user handles approval/sandbox prompts
 * natively. Codex generates its own session id, so we cannot preassign it — we
 * snapshot existing sessions, then capture the newly-created one after the run,
 * preferring the session whose recorded cwd matches ours.
 *
 * Codex has no --append-system-prompt, so the backstory is prepended to the
 * prompt on the first launch (the resumed session then remembers it).
 */
export const codexAdapter: CliAdapter = {
  preassignsSessionId: false,

  buildArgs({ model, sessionId, isNew, backstory, sessionDir, prompt, attachments, extraFlags }) {
    const imageArgs = attachments.flatMap((a) => ["-i", a.path]);
    if (isNew) {
      const seeded = `${backstory}\n\n---\n\n${prompt}`;
      return ["-m", model, "--add-dir", sessionDir, ...imageArgs, ...extraFlags, "--", seeded];
    }
    // `codex resume` accepts -m, so a changed model in agents.yaml still applies.
    return ["resume", "-m", model, sessionId!, "--add-dir", sessionDir, ...imageArgs, ...extraFlags, "--", prompt];
  },

  async snapshot() {
    return new Set((await readSessions()).map((e) => e.id));
  },

  async captureSessionId(snapshot, startedAtMs, cwd) {
    const known = snapshot instanceof Set ? (snapshot as Set<string>) : new Set<string>();
    // Only sessions that did not exist before this launch, newest first.
    const candidates = (await readSessions())
      .filter((e) => !known.has(e.id) && e.at >= startedAtMs - 5000)
      .sort((a, b) => b.at - a.at);
    if (!candidates.length) return null;

    let firstUnknownCwd: string | null = null;
    for (const c of candidates) {
      if (c.cwd === cwd) return c.id; // strong match
      if (c.cwd === null && firstUnknownCwd === null) firstUnknownCwd = c.id;
    }
    // Prefer a session with an unresolvable cwd over one that clearly belongs
    // elsewhere; fall back to the newest new session.
    return firstUnknownCwd ?? candidates[0]!.id;
  },
};
