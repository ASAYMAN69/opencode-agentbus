# AgentBus - AI Agent Handoff & Architecture Guide

Welcome to **AgentBus**. This document provides incoming AI agents and developers with complete context on the system architecture, plugin lifecycle, file locations, mechanics, and operational rules.

---

## 1. Project Purpose & Vision

AgentBus is an **OpenCode v2 plugin** that automates persistent multi-agent workforce orchestration. It replaces manual human relays (inspired by `../zyrun/AGENT.md`) with automated sub-agent sessions coordinated by a designated **HEAD coordinator agent**.

### Core Architecture
- **HEAD Coordinator (`[MAIN]` session)**: The orchestration brain. Interacts with the human user, plans architecture, breaks down features, and delegates work to persistent sub-agents using the single tool `agentbus`.
- **Persistent Sub-Agents (`AgentBus: <name>` sessions)**: Domain specialists (`frontend`, `backend`, `tester`, `dbmaster`, or dynamic custom agents like `helper`, `worker`, etc.). Each has its own persistent OpenCode session, working directory, and write boundary.
- **Shoot-and-Forget Dispatch**: The main coordinator dispatches a task via `agentbus(action="send", ...)` and resumes or concludes its turn immediately (`[status: running]`).
- **Autonomous Notification**: When the sub-agent finishes, the plugin captures its summary and auto-triggers the main coordinator via a queued prompt turn containing the `<agent id="..." task="...">` XML envelope.
- **Interruption Protection**: If a sub-agent is canceled, aborted, or errors out mid-turn, it alerts the user directly and reports `status="interrupted"` to the coordinator instead of falsely claiming completion.

---

## 2. File Locations & Deployment

| File / Path | Purpose |
|---|---|
| `/mnt/ee/aprojects/agentbus/.opencode/plugins/agentbus/index.ts` | **Server Plugin**: Tools, hooks (`context`, `compaction`), command `/agentbus-init`, event monitors. |
| `/mnt/ee/aprojects/agentbus/.opencode/plugins/agentbus/tui.tsx` | **TUI Plugin**: Visual ` MAIN ` badge and sidebar process indicators. |
| `/mnt/ee/aprojects/agentbus/.opencode/plugins/agentbus/package.json` | Plugin package configuration (`exports: { ".": "./index.ts", "./tui": "./tui.tsx" }`). |
| `/home/asayman/.config/opencode/plugins/agentbus/` | **Live Global Plugin Directory**: OpenCode loads the active plugin from here. **Must be kept in sync with `/mnt/ee/aprojects/agentbus/.opencode/plugins/agentbus/`.** |
| `/home/asayman/.config/opencode/opencode.json` | Global config registering `/home/asayman/.config/opencode/plugins/agentbus`. |
| `/home/asayman/.local/share/opencode/opencode.db` | SQLite database storing `session_v2`, `session_message`, and `kv` (plugin state). |
| `/home/asayman/.local/share/opencode/log/opencode.log` | Active OpenCode server logs. |

### Sync & Reload Protocol
Whenever editing plugin code:
```bash
# 1. Sync files to global config
cp /mnt/ee/aprojects/agentbus/.opencode/plugins/agentbus/index.ts /home/asayman/.config/opencode/plugins/agentbus/index.ts
cp /mnt/ee/aprojects/agentbus/.opencode/plugins/agentbus/tui.tsx /home/asayman/.config/opencode/plugins/agentbus/tui.tsx

# 2. Restart OpenCode service
opencode service restart
```

---

## 3. Key Components & Mechanics

### A. Initialization Command (`/agentbus-init [prompt]`)
- **Designates HEAD Coordinator**: Locks the current session as the HEAD coordinator in KV storage (`head_session_id`).
- **Visual Rename**: Updates session title to `[MAIN] <Title>` and displays the red ` MAIN ` badge (`session.composer.top`).
- **Prompt Forwarding**: Accepts optional trailing text (e.g. `/agentbus-init delegate 3 sub agents immediately`). If present, forwards it directly into the chat as a regular user prompt turn.
- **Sub-Agent Shield**: Sub-agents are permanently forbidden from executing `/agentbus-init`.

### B. Single Coordinator Tool (`agentbus`)
Restricted to the active HEAD coordinator session. Actions:

| Action | Parameters | Description |
|---|---|---|
| `send` | `agent`, `task`, `message`, `taskFilePath?` | Shoot-and-forget task dispatch. Wraps instructions in `<agent id="main" task="...">`. Returns `[status: running]`. Auto-notifies main on completion. |
| `btw` | `agent`, `question` | Ephemeral inquiry (`/btw`). Asks the sub-agent a question without recording it in the conversation history. Returns the answer immediately. |
| `create` | `agent`, `role?`, `workingDirectory?`, `writeScope?` | Provisions a new persistent sub-agent session. Inherits the HEAD model/provider and posts an initial banner. |
| `rename` | `agent`, `newName` | Renames an agent and updates session title. |
| `delete` | `agent` | Removes the sub-agent session, cleans up storage, active tasks, and status. |
| `list` | None | Returns JSON roster of active sub-agents, their session IDs, roles, and write scopes. |

### C. System Instruction Injection & Prefix Caching
- **HEAD Coordinator**:
  - `STATIC_HEAD_SYSTEM_PROMPT` is 100% static and immutable to maximize LLM prompt-cache hits across turns.
  - Injected dynamically at the tail of `event.system` via `ctx.session.hook("context")` and `hook("compaction")`.
- **Sub-Agents**:
  - Dynamically resolved from `agent_registry` in KV storage.
  - Injected via `ctx.session.hook("context")` and `hook("compaction")`.
  - Includes absolute working directory, write scope, loaded skill documentation from `~/.agents/skills/`, and task protocol.

### D. Interruption Handling
Sub-agent sessions are monitored through both `ctx.event.subscribe` (`session.idle`/`session.status`) and `ctx.session.wait`:
1. On finish, `checkSessionInterrupted()` inspects turn error states (`finish === "error"`), error messages, and tool error statuses.
2. If interrupted:
   - Emits a synthetic alert directly to the user: `Sub-agent '<agentId>' was interrupted during task '<task>' (<reason>).`
   - Prompts the main coordinator with `<agent id="..." task="..." status="interrupted">`.
   - Sets TUI sidebar status to `✗ interrupted: <task>`.
3. If successful:
   - Extracts the final assistant summary.
   - Prompts the main coordinator with `<agent id="..." task="...">\n<summary>\n</agent>`.
   - Sets TUI sidebar status to `✓ done: <task>`.

### E. TUI Indicators (`tui.tsx`)
- **Badge**: Exactly one red highlight + light gray font ` MAIN ` badge directly above the prompt box (`session.composer.top`) for the coordinator.
- **Sub-Agent Process View**: In the right sidebar (`sidebar.content`), displays:
  - `● running: <task>` (yellow)
  - `✓ done: <task>` (green)
  - `✗ interrupted: <task>` (red)
  - `idle` (gray)

---

## 4. Operational Best Practices & Gotchas

1. **Avoid JS Automatic Semicolon Insertion (ASI) Pitfalls**:
   - In files without trailing semicolons, never start a line with `(` or `[` (e.g. `(async () => { ... })()`). In JS, this gets parsed as a function call on the preceding statement (`activeTasks.set(...)(...)`).
   - Use `const fn = async () => { ... }; void fn();` instead.

2. **Always Provide Absolute Paths in Sub-Agent Task Messages**:
   - Sub-agents run inside the project workspace. To prevent sub-agents from creating files in the project root, the prompt should explicitly specify the absolute path:
     `Write the file at the ABSOLUTE path /path/to/project/agent-workspace/file.ext`.

3. **Sub-Agent Model Inheritance**:
   - Sub-agents inherit whatever model and provider the HEAD session is using at the time of creation (e.g., `reflection/beam-free via kilo`).

4. **Git Repository & Tags**:
   - Code repository is tracked under `/mnt/ee/aprojects/agentbus` on branch `master`.
   - Semantic versioning tags are applied (e.g., `v0.1.0`, `v0.1.1`, `v0.1.2`, `v0.1.3`).
