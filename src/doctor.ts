import type { Agent, CliKind, Config } from "./types.ts";

export interface BinStatus {
  cli: CliKind;
  bin: string;
  ok: boolean;
}

/** Check that every CLI referenced by the agents actually resolves to a binary. */
export async function checkBinaries(config: Config, agents: Agent[]): Promise<BinStatus[]> {
  const used = new Map<CliKind, string>();
  for (const a of agents) used.set(a.cli, a.bin ?? config.clis[a.cli]);

  const out: BinStatus[] = [];
  for (const [cli, bin] of used) {
    const ok = bin.includes("/") ? await Bun.file(bin).exists() : Bun.which(bin) != null;
    out.push({ cli, bin, ok });
  }
  return out;
}
