import { getAdapter } from "./adapters/index.ts";
import { sessionDir } from "./paths.ts";
import { roleState, saveSession } from "./session.ts";
import { backlogMarker, backlogSince, appendTranscript } from "./backlog.ts";
import type { Agent, Config, SessionData } from "./types.ts";

const FOOTER =
  "\n\n---\nThe collaboration context and history are in ./backlog.md in the working directory. " +
  "When you finish, append a concise summary of your work to backlog.md under the heading " +
  '"## [<your-role>]" so the next roles can continue.';

export interface DelegateResult {
  output: string;
  exitCode: number;
}

/**
 * Launch (or resume) the agent's CLI attached to the terminal, wait for the user
 * to finish, then capture what the role appended to backlog.md.
 */
export async function delegate(
  session: SessionData,
  agent: Agent,
  config: Config,
  userText: string,
): Promise<DelegateResult> {
  const adapter = getAdapter(agent.cli);
  const state = roleState(session, agent);
  const isNew = state.cliSessionId == null;

  let sessionId = state.cliSessionId;
  if (isNew && adapter.preassignsSessionId) sessionId = crypto.randomUUID();

  const bin = agent.bin ?? config.clis[agent.cli];
  const args = adapter.buildArgs({
    model: agent.model,
    sessionId,
    isNew,
    backstory: agent.backstory,
    sessionDir: sessionDir(session.name),
    prompt: userText + FOOTER,
    extraFlags: agent.extraFlags ?? [],
  });

  // The shared backlog lives in the workdir, where the sub-CLI runs.
  const marker = await backlogMarker(session.workdir);
  const snapshot = isNew && adapter.snapshot ? await adapter.snapshot() : undefined;
  const startedAt = Date.now();
  await appendTranscript(
    session.name,
    `→ [${agent.id}] (${agent.cli}/${agent.model}): ${userText.replace(/\s+/g, " ").slice(0, 120)}`,
  );

  const proc = Bun.spawn([bin, ...args], {
    cwd: session.workdir,
    stdio: ["inherit", "inherit", "inherit"],
  });
  const exitCode = await proc.exited;

  // Capture the session id for CLIs that generate their own (codex).
  if (isNew && !adapter.preassignsSessionId && adapter.captureSessionId) {
    sessionId = await adapter.captureSessionId(snapshot, startedAt, session.workdir);
  }
  state.cliSessionId = sessionId;
  state.lastUsedAt = new Date().toISOString();

  const output = await backlogSince(session.workdir, marker);
  if (output) {
    session.lastOutput = { roleId: agent.id, text: output, at: new Date().toISOString() };
  }
  await saveSession(session);
  await appendTranscript(
    session.name,
    `← [${agent.id}] finished (exit ${exitCode}), ${output ? output.length + " chars in backlog" : "no entry"}`,
  );

  return { output, exitCode };
}
