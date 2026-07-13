import { backlogPath, transcriptFile } from "./paths.ts";

/**
 * The backlog is the shared channel between roles and lives in the working
 * directory, so each sub-CLI reads/writes it natively as ./backlog.md.
 */
export async function backlogMarker(workdir: string): Promise<number> {
  const file = Bun.file(backlogPath(workdir));
  if (!(await file.exists())) return 0;
  return (await file.text()).length;
}

/** Return everything appended to the backlog since `marker`. */
export async function backlogSince(workdir: string, marker: number): Promise<string> {
  const file = Bun.file(backlogPath(workdir));
  if (!(await file.exists())) return "";
  return (await file.text()).slice(marker).trim();
}

export async function readBacklog(workdir: string): Promise<string> {
  const file = Bun.file(backlogPath(workdir));
  return (await file.exists()) ? await file.text() : "";
}

async function append(path: string, content: string): Promise<void> {
  const existing = (await Bun.file(path).exists()) ? await Bun.file(path).text() : "";
  await Bun.write(path, existing + content);
}

/** Append a titled entry to the shared backlog. */
export async function appendBacklog(workdir: string, author: string, body: string): Promise<void> {
  await append(backlogPath(workdir), `\n## [${author}] ${new Date().toISOString()}\n\n${body}\n`);
}

/** Append a line to the orchestrator transcript (kept in the session dir). */
export async function appendTranscript(sessionName: string, line: string): Promise<void> {
  await append(transcriptFile(sessionName), `- ${new Date().toISOString()} — ${line}\n`);
}
