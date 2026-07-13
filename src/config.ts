import { CONFIG_FILE } from "./paths.ts";
import { readJson, writeJson } from "./store.ts";
import type { Config } from "./types.ts";

const DEFAULT_CONFIG: Config = {
  // Bare names resolve via PATH. Override with absolute paths per machine, e.g.
  // { "codex": "/Users/stas/.local/bin/codex", "claude": "/opt/homebrew/bin/claude" }
  clis: {
    claude: "claude",
    codex: "codex",
  },
};

/** Load config, seeding the default file on first run. */
export async function loadConfig(): Promise<Config> {
  const existing = await readJson<Config | null>(CONFIG_FILE, null);
  if (existing) return { clis: { ...DEFAULT_CONFIG.clis, ...existing.clis } };
  await writeJson(CONFIG_FILE, DEFAULT_CONFIG);
  return DEFAULT_CONFIG;
}
