import { getAdapter } from "./adapters/index.ts";
import { sessionDir } from "./paths.ts";
import { roleState, saveSession } from "./session.ts";
import { appendBacklog, backlogMarker, backlogSince, appendTranscript } from "./backlog.ts";
import type { Agent, Config, SessionData } from "./types.ts";
import type { ImageAttachment } from "./adapters/types.ts";

function footer(backlogFile: string): string {
  return (
    "\n\n---\nThe collaboration context and history are in this session backlog: " +
    backlogFile +
    ". When you finish, append a concise summary of your work to that file under the heading " +
    '"## [<your-role>]" so the next roles can continue.'
  );
}

export interface DelegateResult {
  output: string;
  exitCode: number;
  sessionSaved: boolean;
  autoCaptured: boolean;
  sessionReset: boolean;
}

function missingBacklogEntry(agent: Agent, exitCode: number, sessionSaved: boolean): string {
  const interrupted = exitCode === 130 || exitCode === 143;
  if (exitCode === 0) {
    return [
      `@${agent.id} returned control to orcai without adding a backlog entry.`,
      "",
      "No role response was captured automatically because the native CLI ran interactively.",
      sessionSaved
        ? "The CLI session was saved and can be resumed; ask the role to summarize its completed work if needed."
        : "No resumable CLI session was recorded.",
    ].join("\n");
  }

  return [
    `@${agent.id} did not add a backlog entry before the CLI ${interrupted ? "was interrupted" : `exited with code ${exitCode}`}.`,
    "",
    "No role response was captured automatically because the native CLI ran interactively.",
    sessionSaved
      ? "The previous CLI session remains recorded for a later resume."
      : "No resumable CLI session was recorded for this failed first launch.",
  ].join("\n");
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
  attachments: ImageAttachment[] = [],
): Promise<DelegateResult> {
  const adapter = getAdapter(agent.cli);
  const state = roleState(session, agent);
  const isNew = state.cliSessionId == null;
  const dir = sessionDir(session.name);
  const backlogFile = `${dir}/backlog.md`;

  let sessionId = state.cliSessionId;
  let effectiveIsNew = isNew;
  let sessionReset = false;
  if (!effectiveIsNew && sessionId && adapter.resumable) {
    const canResume = await adapter.resumable(sessionId, session.workdir);
    if (!canResume) {
      sessionReset = true;
      effectiveIsNew = true;
      sessionId = null;
    }
  }
  if (effectiveIsNew && adapter.preassignsSessionId) sessionId = crypto.randomUUID();

  const bin = agent.bin ?? config.clis[agent.cli];
  const args = adapter.buildArgs({
    model: agent.model,
    sessionId,
    isNew: effectiveIsNew,
    backstory: agent.backstory,
    sessionDir: dir,
    prompt: userText + footer(backlogFile),
    attachments,
    extraFlags: agent.extraFlags ?? [],
  });

  const marker = await backlogMarker(session.name);
  const snapshot = effectiveIsNew && adapter.snapshot ? await adapter.snapshot() : undefined;
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
  const succeeded = exitCode === 0;

  // Capture the session id for CLIs that generate their own (codex).
  if (succeeded && effectiveIsNew && !adapter.preassignsSessionId && adapter.captureSessionId) {
    sessionId = await adapter.captureSessionId(snapshot, startedAt, session.workdir);
  }

  let output = await backlogSince(session.name, marker);
  let autoCaptured = false;
  const sessionSaved = !effectiveIsNew || (succeeded && sessionId !== null);
  if (!output) {
    const fallback = missingBacklogEntry(agent, exitCode, sessionSaved);
    await appendBacklog(session.name, "orcai", fallback);
    output = await backlogSince(session.name, marker);
    autoCaptured = true;
  }
  if (output) {
    session.lastOutput = { roleId: agent.id, text: output, at: new Date().toISOString() };
  }
  if (sessionSaved) {
    state.cliSessionId = sessionId;
    state.lastUsedAt = new Date().toISOString();
  }
  await saveSession(session);
  await appendTranscript(
    session.name,
    `← [${agent.id}] finished (exit ${exitCode}${sessionReset ? ", session renewed" : ""}${
      sessionSaved ? "" : ", session not saved"
    }), ${
      output ? output.length + " chars in backlog" : "no entry"
    }`,
  );

  return { output, exitCode, sessionSaved, autoCaptured, sessionReset };
}
