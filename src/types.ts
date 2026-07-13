export type Provider = "anthropic" | "openai";
export type CliKind = "claude" | "codex";

export interface Agent {
  id: string;
  name: string;
  provider: Provider;
  cli: CliKind;
  model: string;
  backstory: string;
  /** Optional explicit path to the CLI binary, overrides config.clis[cli]. */
  bin?: string;
  /** Extra flags passed verbatim to the CLI on every launch. */
  extraFlags?: string[];
}

export interface Config {
  /** Manually configurable paths to the CLI binaries to launch. */
  clis: Record<CliKind, string>;
}

export interface RoleState {
  /** UUID of the underlying CLI session. null until first launch is captured. */
  cliSessionId: string | null;
  lastUsedAt: string | null;
}

export interface LastOutput {
  roleId: string;
  text: string;
  at: string;
}

export interface SessionData {
  name: string;
  createdAt: string;
  /** Working directory the sub-CLIs run in (e.g. a git worktree). */
  workdir: string;
  roles: Record<string, RoleState>;
  lastOutput: LastOutput | null;
}
