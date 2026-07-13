import { CODEX_SESSION_INDEX, CODEX_SESSIONS_DIR } from "../paths.ts";
import type { CliAdapter } from "./types.ts";

interface IndexEntry {
  id: string;
  at: number;
}

async function readIndex(): Promise<IndexEntry[]> {
  const file = Bun.file(CODEX_SESSION_INDEX);
  if (!(await file.exists())) return [];
  const out: IndexEntry[] = [];
  for (const line of (await file.text()).split("\n")) {
    if (!line.trim()) continue;
    try {
      const e = JSON.parse(line) as { id?: string; updated_at?: string };
      if (e.id && e.updated_at) out.push({ id: e.id, at: Date.parse(e.updated_at) });
    } catch {
      // ignore malformed lines
    }
  }
  return out;
}

/** Best-effort: read the `cwd` recorded in a codex session's rollout file. */
async function sessionCwd(id: string): Promise<string | null> {
  try {
    const glob = new Bun.Glob(`**/*${id}*`);
    for await (const f of glob.scan({ cwd: CODEX_SESSIONS_DIR, absolute: true })) {
      const text = await Bun.file(f).text();
      for (const line of text.split("\n").slice(0, 15)) {
        if (!line.trim()) continue;
        try {
          const o = JSON.parse(line) as Record<string, unknown>;
          const cwd = (o.cwd ?? (o.payload as Record<string, unknown>)?.cwd ?? (o.git as Record<string, unknown>)?.cwd);
          if (typeof cwd === "string") return cwd;
        } catch {
          // keep scanning
        }
      }
    }
  } catch {
    // globbing/reading is best-effort only
  }
  return null;
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

  buildArgs({ model, sessionId, isNew, backstory, prompt, extraFlags }) {
    if (isNew) {
      const seeded = `${backstory}\n\n---\n\n${prompt}`;
      return ["-m", model, ...extraFlags, "--", seeded];
    }
    // `codex resume` accepts -m, so a changed model in agents.yaml still applies.
    return ["resume", "-m", model, sessionId!, ...extraFlags, "--", prompt];
  },

  async snapshot() {
    return new Set((await readIndex()).map((e) => e.id));
  },

  async captureSessionId(snapshot, startedAtMs, cwd) {
    const known = snapshot instanceof Set ? (snapshot as Set<string>) : new Set<string>();
    // Only sessions that did not exist before this launch, newest first.
    const candidates = (await readIndex())
      .filter((e) => !known.has(e.id) && e.at >= startedAtMs - 5000)
      .sort((a, b) => b.at - a.at);
    if (!candidates.length) return null;

    let firstUnknownCwd: string | null = null;
    for (const c of candidates) {
      const sc = await sessionCwd(c.id);
      if (sc === cwd) return c.id; // strong match
      if (sc === null && firstUnknownCwd === null) firstUnknownCwd = c.id;
    }
    // Prefer a session with an unresolvable cwd over one that clearly belongs
    // elsewhere; fall back to the newest new session.
    return firstUnknownCwd ?? candidates[0]!.id;
  },
};
