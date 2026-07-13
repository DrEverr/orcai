# Instructions for assistants configuring orcai

This file describes the user onboarding process. Follow this procedure when the user asks to
install orcai, configure it for the first time, or change their team of roles. For ordinary
development tasks in this repository, do not run onboarding and do not modify files in
`~/.orcai/`.

## Goal

Help the user start a small, understandable team of agents based on their installed Codex
and/or Claude Code CLI. Use plain language. Do not begin by showing JSON or a complete list of
options.

## Conversation guidelines

- Start with a one-sentence explanation: `orcai` passes work between specialized roles while
  preserving a shared backlog.
- Ask no more than two or three short questions at a time.
- Recommend sensible defaults. The user does not need to know model names or file structures.
- Begin from the starter roles that ship with orcai. Suggest a different team only when the project warrants it.
- Before saving or overwriting configuration, show a readable summary and ask for approval.
- Never ask for API keys or display secrets. Leave authentication to the native CLI.
- Do not promise that a particular model is available unless you can confirm it locally.

## Onboarding procedure

### 1. Understand the user's needs

Determine:

1. Which project directory should the agents work in?
2. Which tools does the user want to use: Codex, Claude Code, or both?
3. What are they building, and what kind of help do they expect?

If the third answer is broad, start from the built-in starter team:

| Role | Responsibility | Suggested CLI |
|---|---|---|
| Manager | organize the goal and select the next task | Claude |
| Developer | implement changes and run tests | Codex |
| Tester | verify behavior and reproduce failures | Codex |
| DevOps | handle CI, releases, deployment, and operations | Codex |
| Designer | shape user-facing flows, copy, and visual direction | Claude |

Remove or adjust roles when the selected tools are not available or the project clearly needs a smaller team.

### 2. Run a health check

Ask for permission to perform local, read-only checks. Check only the tools selected by the
user:

```bash
bun --version
command -v codex
codex --version
command -v claude
claude --version
```

Also verify that the selected directory exists. If it is a Git repository, show its current
branch and whether it has uncommitted changes. Do not modify the repository during the health
check.

Present the result briefly:

```text
Readiness
✓ Bun 1.x
✓ Codex — found at /path/to/codex
! Claude Code — not found (it will not be used)
✓ Project directory exists
```

A missing tool that the user did not select is not an error. If a required tool is missing,
explain what is needed and pause configuration until the user decides how to proceed. Do not
install global dependencies without explicit approval.

### 3. Present the proposed team

Describe roles in a human-friendly format before showing JSON:

```text
Starter team "storefront-web"

1. manager   plans and protects the goal       Claude / opus
2. coder     implements and tests              Codex / gpt-5.5-codex
3. tester    verifies behavior                 Codex / gpt-5.5-codex
4. devops    handles CI and releases           Codex / gpt-5.5-codex
5. designer  shapes product experience         Claude / sonnet

Flow: manager → coder → tester → coder (if fixes are needed)
```

Ask whether the user wants to keep the starter team, change the roles, or see more details. Show the
full YAML only on request or immediately before saving it.

Each role in `~/.orcai/agents.yaml` has this shape (block YAML, hand-editable):

```yaml
- id: coder
  name: Lead Developer
  provider: openai
  cli: codex
  model: gpt-5.5-codex
  backstory: "Implement agreed tasks, follow the repository instructions, and run tests after making changes."
```

Allowed `cli` values are `codex` and `claude`; their corresponding `provider` values are
`openai` and `anthropic`. Optional fields are `bin` and `extraFlags`. Role IDs should be short,
unique, contain no spaces, and be easy to type in a terminal.

### 4. Prepare the configuration

`orcai` uses two files:

- `~/.orcai/config.json` — CLI binary paths,
- `~/.orcai/agents.yaml` — role definitions.

The application seeds starter roles on first run if `~/.orcai/agents.yaml` does not exist. A
user can add or replace roles interactively with
`/agent add <id> <anthropic|openai> <model> [backstory]`, while an onboarding assistant may
adjust `agents.yaml` after showing the proposal and receiving approval.

Minimal binary configuration:

```json
{
  "clis": {
    "claude": "claude",
    "codex": "codex"
  }
}
```

If `command -v` returned an absolute path, prefer it in the configuration. Before making a
change:

1. Read existing files if they are available.
2. Preserve unrelated settings.
3. Show the user the planned change.
4. Obtain approval.
5. Back up an existing file before overwriting it.
6. Save valid JSON.

Do not change the application's source code to configure an individual user.

### 5. Verify and show the first step

After saving, run this non-invasive verification:

```bash
orcai list
```

Do not create a session without approval. A session writes files, and roles launched later may
modify the selected project. Suggest this first command:

```bash
orcai new my-project /absolute/path/to/project
```

Then show one short workflow:

```text
/to manager Define the first small step for this project
/pass coder
/pass reviewer
/last
```

Finish by summarizing what was detected, which files were configured, which roles were
created, and which command the user should run. Do not overwhelm the user with every command;
the full list is available under `/help`.

## Completion criteria

Onboarding is complete when:

- Bun and the selected CLIs have been checked,
- the user has approved the team of roles,
- configuration has been saved without losing existing settings,
- the user has received one starting command and an example workflow,
- every missing or intentionally omitted tool has been clearly explained.
