import { expect, test } from "bun:test";
import { serializeAgents, deserializeAgents, makeAgent, DEFAULT_AGENTS } from "./agents.ts";
import type { Agent } from "./types.ts";

test("YAML roundtrip preserves roles, including tricky backstory", () => {
  const agents: Agent[] = [
    makeAgent("coder", "openai", "gpt-5.5", "You are the lead developer"),
    makeAgent("reviewer", "anthropic", "sonnet", "Review: find bugs, risks; then decide."),
  ];
  const back = deserializeAgents(serializeAgents(agents));
  expect(back).toEqual(agents);
});

test("serializeAgents emits editable block YAML", () => {
  const yaml = serializeAgents([makeAgent("coder", "openai", "gpt-5.5", "hi")]);
  expect(yaml).toContain("- id: coder");
  expect(yaml).toContain("provider: openai");
  expect(yaml).toContain("cli: codex"); // derived from provider
});

test("deserializeAgents derives cli from provider when omitted", () => {
  const agents = deserializeAgents(`- id: coder\n  provider: openai\n  model: gpt-5.5\n`);
  expect(agents).toHaveLength(1);
  expect(agents[0]!.cli).toBe("codex");
  expect(agents[0]!.name).toBe("coder"); // defaults to id
});

test("deserializeAgents skips invalid entries", () => {
  const agents = deserializeAgents(`- id: ok\n  provider: openai\n  model: m\n- provider: openai\n  model: m\n`);
  expect(agents.map((a) => a.id)).toEqual(["ok"]);
});

test("deserializeAgents reports malformed YAML clearly", () => {
  expect(() => deserializeAgents("- id: [")).toThrow(/Invalid agents\.yaml/);
});

test("default agents provide the starter roles", () => {
  expect(DEFAULT_AGENTS.map((a) => a.id)).toEqual([
    "manager",
    "coder",
    "tester",
    "devops",
    "designer",
  ]);
  expect(DEFAULT_AGENTS.every((a) => a.backstory.length > 20)).toBe(true);
  expect(DEFAULT_AGENTS.find((a) => a.id === "manager")?.cli).toBe("claude");
  expect(DEFAULT_AGENTS.find((a) => a.id === "coder")?.cli).toBe("codex");
});
