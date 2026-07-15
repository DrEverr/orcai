#!/usr/bin/env bun
import { repl } from "./repl.ts";
import { createSession, createStartupSession, listSessions } from "./session.ts";
import { loadConfig } from "./config.ts";
import { loadAgents } from "./agents.ts";

const [cmd, ...rest] = process.argv.slice(2);

const HELP_TEXT =
  "orcai — AI role orchestrator\n\n" +
  "Usage:\n" +
  "  orcai                       create a UUID session for this directory and start the REPL\n" +
  "  orcai new <name> [workdir]  create a named session and enter the REPL\n" +
  "  orcai resume <name>         resume a session\n" +
  "  orcai list                  list sessions\n" +
  "  orcai help                  show this help\n" +
  "  orcai version               show the installed version\n\n" +
  "Flags:\n" +
  "  -h, --help                  show help\n" +
  "  -V, --version               show version\n";

const COMMAND_HELP: Record<string, string> = {
  new:
    "Usage: orcai new <name> [workdir]\n\n" +
    "Create a named session for workdir, then enter the REPL.\n" +
    "If workdir is omitted, the current directory is used.",
  resume: "Usage: orcai resume <name>\n\nResume an existing session and enter the REPL.",
  open: "Usage: orcai open <name>\n\nAlias for: orcai resume <name>",
  list: "Usage: orcai list\n\nList available sessions.",
};

function isHelpFlag(value: string | undefined): boolean {
  return value === "help" || value === "--help" || value === "-h";
}

function isVersionFlag(value: string | undefined): boolean {
  return value === "version" || value === "--version" || value === "-V";
}

async function packageVersion(): Promise<string> {
  const pkg = (await Bun.file(new URL("../package.json", import.meta.url)).json()) as {
    version?: string;
  };
  return pkg.version ?? "0.0.0";
}

async function main(): Promise<void> {
  if (isHelpFlag(cmd)) {
    console.log(HELP_TEXT);
    return;
  }

  if (isVersionFlag(cmd)) {
    console.log(await packageVersion());
    return;
  }

  switch (cmd) {
    case undefined: {
      await loadConfig(); // validate/seed config before writing session state
      await loadAgents(); // validate agents before writing session state
      const session = await createStartupSession();
      await repl(session.name);
      break;
    }

    case "new": {
      if (isHelpFlag(rest[0])) {
        console.log(COMMAND_HELP.new);
        return;
      }
      const name = rest[0];
      if (!name) {
        console.error("Usage: orcai new <name> [workdir]");
        process.exit(1);
      }
      const workdir = rest.slice(1).join(" ") || process.cwd();
      await loadConfig(); // seed default config
      await loadAgents(); // seed default agents
      await createSession(name, workdir);
      console.log(`Created session "${name}" (workdir: ${workdir}).`);
      await repl(name);
      break;
    }

    case "resume":
    case "open": {
      if (isHelpFlag(rest[0])) {
        console.log(COMMAND_HELP[cmd]);
        return;
      }
      const name = rest[0];
      if (!name) {
        console.error("Usage: orcai resume <name>");
        process.exit(1);
      }
      await repl(name);
      break;
    }

    case "list": {
      if (isHelpFlag(rest[0])) {
        console.log(COMMAND_HELP.list);
        return;
      }
      const sessions = await listSessions();
      console.log(sessions.length ? sessions.join("\n") : "(no sessions)");
      break;
    }

    default:
      console.error(`Unknown command: ${cmd} (orcai help)`);
      process.exit(1);
  }
}

main().catch((err) => {
  console.error(`✖ ${(err as Error).message}`);
  process.exit(1);
});
