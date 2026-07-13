import type { CliKind } from "../types.ts";
import type { CliAdapter } from "./types.ts";
import { claudeAdapter } from "./claude.ts";
import { codexAdapter } from "./codex.ts";

const ADAPTERS: Record<CliKind, CliAdapter> = {
  claude: claudeAdapter,
  codex: codexAdapter,
};

export function getAdapter(cli: CliKind): CliAdapter {
  return ADAPTERS[cli];
}

export type { CliAdapter } from "./types.ts";
