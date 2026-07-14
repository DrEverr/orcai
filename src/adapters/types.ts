export interface ImageAttachment {
  token: string;
  path: string;
}

export interface BuildArgsInput {
  model: string;
  sessionId: string | null;
  isNew: boolean;
  backstory: string;
  sessionDir: string;
  prompt: string;
  attachments: ImageAttachment[];
  extraFlags: string[];
}

export interface CliAdapter {
  /** Whether we can assign the session UUID ourselves before the first launch. */
  preassignsSessionId: boolean;
  /**
   * Check whether a previously saved native CLI session still exists.
   * Return false only when the backing store was readable and the id is absent.
   */
  resumable?(sessionId: string, cwd: string): Promise<boolean>;
  /** Build the argv (excluding the binary) for a launch/resume. */
  buildArgs(input: BuildArgsInput): string[];
  /**
   * For CLIs that generate their own session id: take a snapshot of existing
   * sessions before launching, so `captureSessionId` can pick only a genuinely
   * new one (avoids grabbing a concurrent CLI's session).
   */
  snapshot?(): Promise<unknown>;
  /**
   * Find the UUID of the session created by this launch. `snapshot` is whatever
   * `snapshot()` returned; `cwd` is the working directory we launched in (used
   * to disambiguate concurrent sessions). Returns null if none found.
   */
  captureSessionId?(snapshot: unknown, startedAtMs: number, cwd: string): Promise<string | null>;
}
