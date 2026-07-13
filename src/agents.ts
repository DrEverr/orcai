import { AGENTS_FILE } from "./paths.ts";
import type { Agent, CliKind, Provider } from "./types.ts";

const ID_RE = /^[a-zA-Z0-9_-]+$/;
const YAML = (Bun as unknown as { YAML: { parse(s: string): unknown } }).YAML;

/** Which CLI each provider is driven through. */
export const PROVIDER_CLI: Record<Provider, CliKind> = {
  anthropic: "claude",
  openai: "codex",
};

export function isProvider(p: string): p is Provider {
  return p === "anthropic" || p === "openai";
}

// ---- YAML (de)serialization ------------------------------------------------

const SAFE = /^[A-Za-z0-9._@/-]+$/;
/** Emit a plain scalar when safe, otherwise a double-quoted (JSON) scalar. */
function scalar(s: string): string {
  return SAFE.test(s) ? s : JSON.stringify(s);
}

/** Human-friendly block YAML for the roles file (hand-editable). */
export function serializeAgents(agents: Agent[]): string {
  const lines = ["# orcai roles — edit freely; reloaded on start.", ""];
  for (const a of agents) {
    lines.push(`- id: ${scalar(a.id)}`);
    lines.push(`  name: ${scalar(a.name)}`);
    lines.push(`  provider: ${a.provider}`);
    lines.push(`  cli: ${a.cli}`);
    lines.push(`  model: ${scalar(a.model)}`);
    lines.push(`  backstory: ${scalar(a.backstory)}`);
    if (a.bin) lines.push(`  bin: ${scalar(a.bin)}`);
    if (a.extraFlags?.length) lines.push(`  extraFlags: [${a.extraFlags.map(scalar).join(", ")}]`);
    lines.push("");
  }
  return lines.join("\n");
}

/** Coerce a parsed YAML/JSON entry into a valid Agent (deriving cli if omitted). */
function normalize(raw: unknown): Agent | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.id !== "string" || !isProvider(String(r.provider))) return null;
  const provider = r.provider as Provider;
  const cli = r.cli === "claude" || r.cli === "codex" ? r.cli : PROVIDER_CLI[provider];
  return {
    id: r.id,
    name: typeof r.name === "string" ? r.name : r.id,
    provider,
    cli,
    model: String(r.model ?? ""),
    backstory: String(r.backstory ?? ""),
    bin: typeof r.bin === "string" ? r.bin : undefined,
    extraFlags: Array.isArray(r.extraFlags) ? r.extraFlags.map(String) : undefined,
  };
}

export function deserializeAgents(text: string): Agent[] {
  const parsed = YAML.parse(text);
  if (!Array.isArray(parsed)) return [];
  return parsed.map(normalize).filter((a): a is Agent => a !== null);
}

// ---- load / save -----------------------------------------------------------

/**
 * Load the user-defined roles from ~/.orcai/agents.yaml. There are no built-in
 * defaults: the user creates workers with `/agent add` or by editing the YAML.
 */
export async function loadAgents(): Promise<Agent[]> {
  const yaml = Bun.file(AGENTS_FILE);
  if (await yaml.exists()) return deserializeAgents(await yaml.text());
  return [];
}

export async function saveAgents(agents: Agent[]): Promise<void> {
  await Bun.write(AGENTS_FILE, serializeAgents(agents));
}

export function findAgent(agents: Agent[], id: string): Agent | undefined {
  return agents.find((a) => a.id === id);
}

/** Build a validated Agent; the CLI is derived from the provider. */
export function makeAgent(id: string, provider: Provider, model: string, backstory: string): Agent {
  if (!ID_RE.test(id)) {
    throw new Error(`Invalid role id "${id}". Allowed: letters, numbers, _ and -.`);
  }
  return {
    id,
    name: id,
    provider,
    cli: PROVIDER_CLI[provider],
    model,
    backstory:
      backstory ||
      `You are the "${id}" role. Do your part of the task and append a concise summary to the session backlog.md.`,
  };
}
