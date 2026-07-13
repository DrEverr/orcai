import { createInterface } from "node:readline/promises";
import { emitKeypressEvents } from "node:readline";
import { stdin, stdout } from "node:process";
import { homedir } from "node:os";
import { loadConfig } from "./config.ts";
import { loadAgents, saveAgents, findAgent, makeAgent, isProvider } from "./agents.ts";
import {
  createSession,
  loadSession,
  listSessions,
  sessionExists,
} from "./session.ts";
import { appendBacklog, appendTranscript, readBacklog } from "./backlog.ts";
import { checkBinaries } from "./doctor.ts";
import { delegate } from "./launcher.ts";
import {
  card,
  fmtDuration,
  relativeTime,
  style,
  stripAnsi,
  table,
} from "./ui.ts";
import type { Agent, Config, SessionData } from "./types.ts";

const VERSION = "0.1.0";

const COMMANDS: { name: string; desc: string }[] = [
  { name: "/session", desc: "Manage sessions" },
  { name: "/agent", desc: "Manage roles (/agent add|rm|list)" },
  { name: "/agents", desc: "Show roles" },
  { name: "/role", desc: "Change the active role (or Shift+Tab)" },
  { name: "/to", desc: "Delegate a task to a role (/to <role> <text>)" },
  { name: "/pass", desc: "Pass the latest result to another role" },
  { name: "/backlog", desc: "Show the shared backlog" },
  { name: "/last", desc: "Show the latest result" },
  { name: "/note", desc: "Add your own note" },
  { name: "/home", desc: "Show the dashboard" },
  { name: "/help", desc: "Show help" },
  { name: "/quit", desc: "Exit" },
];
const SESSION_SUBS = [
  { name: "new", desc: "Create a session" },
  { name: "open", desc: "Open an existing session" },
  { name: "list", desc: "Show all sessions" },
];

const log = (s = ""): void => void stdout.write(s + "\n");
const shortPath = (p: string): string =>
  p.startsWith(homedir()) ? "~" + p.slice(homedir().length) : p;

export async function repl(initialSession?: string): Promise<void> {
  const config: Config = await loadConfig();
  const agents: Agent[] = await loadAgents();
  let session: SessionData | null = initialSession ? await loadSession(initialSession) : null;
  let activeRoleId = findAgent(agents, "manager")?.id ?? agents[0]?.id ?? "";

  const activeAgent = (): Agent | undefined => findAgent(agents, activeRoleId);
  const promptStr = (): string => {
    const a = activeAgent();
    return `${style.cyan("@" + (a?.id ?? "-"))} ${style.dim(a ? `${a.cli}/${a.model}` : "")} ${style.gray("›")} `;
  };

  // ---- rendering -----------------------------------------------------------
  function renderHome(): void {
    if (!session) {
      log("\n" + card(`orcai ${VERSION}`, [
        { left: style.gray("Session") + "   " + style.yellow("none") },
      ]) + "\n");
      log("  " + style.gray("Create a session to get started:"));
      log("  " + style.dim("/session new demo ~/repo") + "\n");
      return;
    }
    const activeRoles = Object.values(session.roles).filter((r) => r.cliSessionId).length;
    log("\n" + card(`orcai ${VERSION}`, [
      { left: style.gray("Session") + "   " + style.bold(session.name), right: style.gray(shortPath(session.workdir)) },
      { left: style.gray("Roles") + "     " + agents.length, right: style.gray(`active: ${activeRoles}`) },
    ]) + "\n");

    if (session.lastOutput) {
      const firstLine =
        stripAnsi(session.lastOutput.text)
          .split("\n")
          .find((l) => l.trim() && !l.startsWith("#") && !l.startsWith("["))
          ?.slice(0, 50) ?? "";
      log("  " + style.gray("Latest activity"));
      log(
        "  " + style.bold("@" + session.lastOutput.roleId) + "  " + firstLine +
          "   " + style.gray(relativeTime(session.lastOutput.at)),
      );
      log("");
    }
    if (!agents.length) {
      log("  " + style.gray("No roles yet. Create your first worker:"));
      log("  " + style.dim("/agent add coder openai gpt-5.5 You are the lead developer") + "\n");
    } else {
      log("  " + style.gray("Start typing a task or use ") + style.dim("/help"));
      log("  " + style.gray("Example: ") + style.dim(`@${agents[0]!.id} improve login validation`) + "\n");
    }
  }

  function renderAgents(): void {
    if (!agents.length) {
      log(style.gray("  No roles yet. Add one: ") + style.dim("/agent add <id> <anthropic|openai> <model> [backstory]"));
      return;
    }
    const rows = agents.map((a) => {
      const st = session?.roles[a.id];
      const active = a.id === activeRoleId;
      let status: string;
      if (st?.cliSessionId) {
        status = active
          ? style.green("active") + style.gray(st.lastUsedAt ? " · " + relativeTime(st.lastUsedAt) : "")
          : "saved session";
      } else {
        status = active ? style.green("active") : style.gray("ready");
      }
      const marker = active ? style.green("●") : " ";
      return [`${marker} ${a.id}`, `${a.cli} / ${a.model}`, status];
    });
    log("\n" + table(["ROLE", "MODEL", "STATUS"], rows) + "\n");
  }

  async function renderSessionList(): Promise<void> {
    const names = await listSessions();
    if (!names.length) return log(style.gray("  (no sessions)"));
    const rows: string[][] = [];
    for (const name of names) {
      const s = await loadSession(name);
      const active = Object.values(s.roles).filter((r) => r.cliSessionId).length;
      const last = s.lastOutput ? relativeTime(s.lastOutput.at) : style.gray("—");
      rows.push([name, style.gray(shortPath(s.workdir)), String(active), last]);
    }
    log("\n" + table(["SESSION", "DIRECTORY", "ACTIVE", "LAST USED"], rows) + "\n");
  }

  function renderHelp(prefix = ""): void {
    if (prefix === "/session") {
      log("");
      for (const s of SESSION_SUBS) log("  " + style.cyan(`/session ${s.name}`.padEnd(16)) + style.gray(s.desc));
      log("");
      return;
    }
    log("");
    for (const c of COMMANDS) log("  " + style.cyan(c.name.padEnd(12)) + style.gray(c.desc));
    log("\n  " + style.gray("@role text — delegate to a role   ·   plain text — send to the active role") + "\n");
  }

  // ---- delegation ----------------------------------------------------------
  function suspend(): void {
    try {
      if (stdin.isTTY) stdin.setRawMode(false);
    } catch {}
    rl.pause();
  }
  function resume(): void {
    rl.resume();
    try {
      if (stdin.isTTY) stdin.setRawMode(true);
    } catch {}
  }

  async function runDelegate(agent: Agent, text: string): Promise<void> {
    if (!session) return log(style.yellow("No active session. /session new <name> [workdir]"));
    const bin = agent.bin ?? config.clis[agent.cli];
    const wasNew = !session.roles[agent.id]?.cliSessionId;

    log("");
    log(style.cyan(`● Starting @${agent.id}`));
    log(style.dim(`  ${agent.cli} · ${agent.model} · ${wasNew ? "new conversation" : "resuming session"}`));
    log("");

    const start = Date.now();
    suspend();
    let res: Awaited<ReturnType<typeof delegate>>;
    try {
      res = await delegate(session, agent, config, text);
    } catch (err) {
      resume();
      const e = err as NodeJS.ErrnoException;
      if (e.code === "ENOENT") {
        log(style.red(`✗ Program not found: "${bin}"`));
        log("");
        log("  Check whether it works:");
        log(style.dim(`  $ ${bin} --version`));
        log("");
        log("  or set its path in " + style.dim("~/.orcai/config.json"));
      } else {
        log(style.red(`✗ Failed to run @${agent.id}: ${e.message}`));
      }
      return;
    }
    resume();

    const dur = style.gray(`   ${fmtDuration(Date.now() - start)}`);
    if (res.exitCode === 0) log(style.green(`✓ @${agent.id} finished`) + dur);
    else {
      const interrupted = res.exitCode === 130 || res.exitCode === 143;
      log(style.yellow(`▲ @${agent.id} ${interrupted ? "was interrupted" : `exited with code ${res.exitCode}`}`) + dur);
      if (!res.sessionSaved) {
        log(style.gray("  No resumable CLI session was recorded for this failed first launch."));
      }
    }

    if (res.output) {
      const verb = res.autoCaptured ? "Recorded" : "Added";
      log(style.dim(`  ${verb} ${res.output.length} characters to the backlog`));
      log(style.gray("  /last show result   ·   /pass <role> pass it on"));
    } else {
      log(style.yellow("  The role did not add anything to backlog.md — use /backlog or /note"));
    }
  }

  function cycleRole(dir: number): void {
    if (!agents.length) return;
    const i = agents.findIndex((a) => a.id === activeRoleId);
    activeRoleId = agents[(i + dir + agents.length) % agents.length]!.id;
  }

  // ---- command dispatch ----------------------------------------------------
  async function handleCommand(input: string): Promise<boolean> {
    const [cmd, ...rest] = input.split(/\s+/);
    const arg = input.slice(cmd.length).trim();

    switch (cmd) {
      case "/":
        renderHelp();
        return true;
      case "/help":
        renderHelp();
        return true;
      case "/home":
        renderHome();
        return true;
      case "/quit":
      case "/exit":
        return false;

      case "/agents":
        renderAgents();
        return true;

      case "/agent": {
        const [sub, id, provider, model, ...bs] = rest;
        if (!sub || sub === "list") {
          renderAgents();
        } else if (sub === "add") {
          if (!id || !provider || !model) {
            log(style.gray("Usage: /agent add <id> <anthropic|openai> <model> [backstory]"));
          } else if (!isProvider(provider)) {
            log(style.yellow(`Unknown provider "${provider}". Use anthropic or openai.`));
          } else if (findAgent(agents, id)) {
            log(style.yellow(`Role "${id}" already exists.`));
          } else {
            try {
              const agent = makeAgent(id, provider, model, bs.join(" "));
              agents.push(agent);
              await saveAgents(agents);
              if (!activeAgent()) activeRoleId = agent.id;
              log(style.green(`✓ Created role @${agent.id}`) + style.gray(`  ${agent.cli}/${agent.model}`));
            } catch (e) {
              log(style.red(`✗ ${(e as Error).message}`));
            }
          }
        } else if (sub === "rm" || sub === "remove") {
          const i = agents.findIndex((a) => a.id === id);
          if (i < 0) log(style.yellow(`Role "${id}" not found.`));
          else {
            agents.splice(i, 1);
            await saveAgents(agents);
            if (activeRoleId === id) activeRoleId = agents[0]?.id ?? "";
            log(style.green(`✓ Removed role @${id}`));
          }
        } else {
          log(style.gray("Usage: /agent add|rm|list"));
        }
        return true;
      }

      case "/role": {
        if (!arg) {
          cycleRole(1);
          log(style.gray(`Active role: `) + style.cyan("@" + activeRoleId));
          return true;
        }
        const a = findAgent(agents, arg);
        if (!a) return (log(style.yellow(`Unknown role "${arg}". Use /agents to see the list.`)), true);
        activeRoleId = a.id;
        log(style.gray("Active role: ") + style.cyan("@" + a.id));
        return true;
      }

      case "/session": {
        const [sub, name, ...wd] = rest;
        if (sub === "list") await renderSessionList();
        else if (sub === "new") {
          if (!name) return (renderHelp("/session"), true);
          const workdir = wd.join(" ") || process.cwd();
          try {
            session = await createSession(name, workdir);
            log(style.green(`✓ Created session "${name}"`) + style.gray(`  ${shortPath(workdir)}`));
            renderHome();
          } catch (e) {
            log(style.red(`✗ ${(e as Error).message}`));
          }
        } else if (sub === "open" || sub === "resume") {
          if (!name || !(await sessionExists(name)))
            return (log(style.yellow(`Session "${name}" does not exist.`)), true);
          session = await loadSession(name);
          log(style.green(`✓ Opened session "${name}"`));
          renderHome();
        } else renderHelp("/session");
        return true;
      }

      case "/to": {
        const [roleId] = rest;
        const text = arg.slice(roleId?.length ?? 0).trim();
        const agent = roleId ? findAgent(agents, roleId) : undefined;
        if (!agent) return (log(style.yellow(`Unknown role "${roleId}". Use /agents to see the list.`)), true);
        if (!text) return (log(style.gray("Usage: /to <role> <text>")), true);
        await runDelegate(agent, text);
        return true;
      }

      case "/pass": {
        const [roleId] = rest;
        const agent = roleId ? findAgent(agents, roleId) : undefined;
        if (!agent) return (log(style.yellow(`Unknown role "${roleId}". Use /agents to see the list.`)), true);
        if (!session?.lastOutput) return (log(style.yellow("There is no latest result to pass on.")), true);
        const last = session.lastOutput;
        await runDelegate(agent, `The previous role [${last.roleId}] passed this on:\n\n${last.text}`);
        return true;
      }

      case "/note": {
        if (!session) return (log(style.yellow("No active session.")), true);
        if (!arg) return (log(style.gray("Usage: /note <text>")), true);
        await appendBacklog(session.name, "orchestrator", arg);
        await appendTranscript(session.name, `note: ${arg.replace(/\s+/g, " ").slice(0, 120)}`);
        log(style.green("✓ Added to backlog.md"));
        return true;
      }

      case "/backlog": {
        if (!session) return (log(style.yellow("No active session.")), true);
        log("\n" + (await readBacklog(session.name)).trimEnd() + "\n");
        return true;
      }

      case "/last": {
        const last = session?.lastOutput;
        log(last ? `\n${style.bold("@" + last.roleId)} ${style.gray(relativeTime(last.at))}\n${last.text}\n` : style.gray("No results yet."));
        return true;
      }

      default:
        log(style.yellow(`Unknown command "${cmd}". Use /help to see the list.`));
        return true;
    }
  }

  async function handle(line: string): Promise<boolean> {
    const t = line.trim();
    if (!t) return true;

    if (t.startsWith("@")) {
      const sp = t.indexOf(" ");
      const roleId = sp === -1 ? t.slice(1) : t.slice(1, sp);
      const text = sp === -1 ? "" : t.slice(sp + 1).trim();
      const agent = findAgent(agents, roleId);
      if (!agent) return (log(style.yellow(`Unknown role "${roleId}". Use /agents to see the list.`)), true);
      if (!text) {
        activeRoleId = agent.id;
        log(style.gray("Active role: ") + style.cyan("@" + agent.id));
        return true;
      }
      await runDelegate(agent, text);
      return true;
    }
    if (t.startsWith("/")) return handleCommand(t);

    // plain text = task for the active role
    const agent = activeAgent();
    if (!agent) return (log(style.yellow("No roles are configured.")), true);
    await runDelegate(agent, t);
    return true;
  }

  // ---- input loop ----------------------------------------------------------
  function completer(line: string): [string[], string] {
    if (line.startsWith("@")) {
      const opts = agents.map((a) => "@" + a.id);
      const hits = opts.filter((o) => o.startsWith(line));
      return [hits.length ? hits : opts, line];
    }
    if (line.startsWith("/session")) {
      const subs = SESSION_SUBS.map((s) => `/session ${s.name}`);
      const hits = subs.filter((s) => s.startsWith(line));
      return [hits.length ? hits : subs, line];
    }
    if (line.startsWith("/agent ")) {
      const subs = ["/agent add", "/agent rm", "/agent list"];
      const hits = subs.filter((s) => s.startsWith(line));
      return [hits.length ? hits : subs, line];
    }
    if (line.startsWith("/")) {
      const opts = COMMANDS.map((c) => c.name);
      const hits = opts.filter((o) => o.startsWith(line));
      return [hits.length ? hits : opts, line];
    }
    return [[], line];
  }

  const rl = createInterface({ input: stdin, output: stdout, completer });

  // Shift+Tab cycles the active role (Tab stays for completion).
  if (stdin.isTTY) {
    emitKeypressEvents(stdin);
    stdin.on("keypress", (_s, key) => {
      if (key?.name === "tab" && key.shift) {
        cycleRole(1);
        rl.setPrompt(promptStr());
        rl.prompt(true);
      }
    });
  }

  // startup: banner/home + binary diagnostics
  renderHome();
  for (const b of await checkBinaries(config, agents)) {
    if (!b.ok) {
      log(style.yellow(`▲ Could not find "${b.bin}" (CLI role: ${b.cli}).`));
      log(style.gray(`  Install it or set its path in ~/.orcai/config.json (clis.${b.cli}).`));
    }
  }

  rl.setPrompt(promptStr());
  rl.prompt();
  for await (const line of rl) {
    const keepGoing = await handle(line);
    if (!keepGoing) break;
    rl.setPrompt(promptStr());
    rl.prompt();
  }
  rl.close();
  log("\n" + style.gray("Goodbye."));
}
