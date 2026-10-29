# AgentBus Prompt & Workflow Plan (pending approval)

## Goal
Refine the HEAD/sub-agent prompting so delegation uses a file-based, auditable workflow
mirroring the proven zyrun `AGENT.md` + `AGENTS/` protocol, with unified directories.

## Proposed unified layout (new)
```
AGENTS/
  CONTEXT/        # global project context docs (architecture, quirks, features)
  TASKS/         # one task file per delegation (named <agent>-<slug>.md)
  COMPLETIONS/   # one summary per completed task (named <agent>-<slug>.md)
```

## Delegation flow (HEAD)
1. Scope the task; gather global context (architecture, abnormal-but-intentional quirks, extra docs).
2. Write context files into `AGENTS/CONTEXT/` if missing.
3. Write the task into `AGENTS/TASKS/<agent>-<slug>.md` (self-contained, with goal, scope, constraints, acceptance criteria, and the completion file name).
4. If the sub-agent is new: `create` with a relevant name + workingDirectory (empty = main cwd), then `send`.
   If existing: just `send`.
5. The invoking prompt tells the sub-agent to read context files only if this is a new agent or context changed; otherwise just read the task file and start.
6. On completion, the main agent tells the sub-agent the exact completion file name (`AGENTS/COMPLETIONS/<agent>-<slug>.md`); the sub-agent MUST write its summary there.

## Sub-agent obligations
- Read context files ONLY when the main agent explicitly instructs (new agent or context changed). Otherwise skip.
- Work only in assigned working directory / write scope (enforced softly via task prompt for now).
- On completion, write a summary to the designated `AGENTS/COMPLETIONS/*.md` file.

## Prompt changes needed
- Rewrite `STATIC_HEAD_SYSTEM_PROMPT` delegation rules to encode the above flow.
- Add a sub-agent system-prompt section instructing completion-summary writing and conditional context reading (only when main agent says so).
- Update tool descriptions (`send`/`create`) to mention task files and completion files.
- Keep prompts compact (prefix-cache friendly).

## Approval
Reply "approve" to implement; otherwise request changes.
