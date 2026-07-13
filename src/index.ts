#!/usr/bin/env bun
import { repl } from "./repl.ts";
import { createSession, createStartupSession, listSessions } from "./session.ts";
import { loadConfig } from "./config.ts";
import { loadAgents } from "./agents.ts";

const [cmd, ...rest] = process.argv.slice(2);

async function main(): Promise<void> {
  switch (cmd) {
    case undefined: {
      await loadConfig(); // validate/seed config before writing session state
      await loadAgents(); // validate agents before writing session state
      const session = await createStartupSession();
      await repl(session.name);
      break;
    }

    case "new": {
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
      const name = rest[0];
      if (!name) {
        console.error("Usage: orcai resume <name>");
        process.exit(1);
      }
      await repl(name);
      break;
    }

    case "list": {
      const sessions = await listSessions();
      console.log(sessions.length ? sessions.join("\n") : "(no sessions)");
      break;
    }

    case "help":
    case "--help":
    case "-h":
      console.log(
        "orcai — AI role orchestrator\n\n" +
          "  orcai                 create a UUID session for this directory and start the REPL\n" +
          "  orcai new <n> [wd]    create a named session and enter the REPL\n" +
          "  orcai resume <n>      resume a session\n" +
          "  orcai list            list sessions\n",
      );
      break;

    default:
      console.error(`Unknown command: ${cmd} (orcai help)`);
      process.exit(1);
  }
}

main().catch((err) => {
  console.error(`✖ ${(err as Error).message}`);
  process.exit(1);
});
