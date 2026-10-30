import * as fs from "node:fs/promises"
import * as path from "node:path"

interface AgentRegistryEntry {
  id: string
  sessionID: string
  role: string
  workingDirectory: string
  writeScope: string[]
  skills: string[]
}

const DEFAULT_AGENTS: Record<string, { role: string; workingDirectory: string; writeScope: string[]; skills: string[] }> = {
  frontend: {
    role: "Frontend engineer. Works only in frontend/. Implements UI, components, stores, and frontend tests.",
    workingDirectory: "frontend",
    writeScope: ["frontend/**"],
    skills: ["design-taste-frontend", "fast-typecheck-and-build"]
  },
  backend: {
    role: "Backend engineer. Works only in backend/. Implements APIs, routes, services, schemas, and migrations.",
    workingDirectory: "backend",
    writeScope: ["backend/**"],
    skills: ["api-and-interface-design", "debugging-and-error-recovery"]
  },
  tester: {
    role: "Independent verification agent. Verifies changes independently across repos. Makes no product edits.",
    workingDirectory: ".",
    writeScope: ["AGENTS/TEST_REPORTS/**", "test/**"],
    skills: ["code-review-and-quality"]
  },
  dbmaster: {
    role: "Schema, migration, index, constraint authority and review gate.",
    workingDirectory: ".",
    writeScope: ["AGENTS/DB_REVIEWS/**", "backend/src/db/**"],
    skills: ["domain-modeling"]
  }
}

// 100% Static & Immutable System Prompt for Maximum Prefix Cache Hitting
const STATIC_HEAD_SYSTEM_PROMPT = `=== AGENTBUS HEAD COORDINATOR MODE ===
You are the designated HEAD coordinator agent.
You manage and delegate to persistent sub-agents using the single tool 'agentbus'.

TOOL USAGE SCHEMA:
Use the 'agentbus' tool with one of these actions:
- action: "send"   -> Shoot-and-forget task delegation (returns 'running'). When finished, the sub-agent auto-notifies you with its success block.
                      Requires: agent, task, message.
- action: "btw"    -> Ephemeral question (/btw). Asks the sub-agent a question without polluting the conversation transcript. Returns the answer immediately.
                      Requires: agent, question.
- action: "create" -> Creates a new named sub-agent with its own persistent session.
                      Requires: agent, role. Optional: workingDirectory, writeScope.
- action: "rename" -> Renames an existing sub-agent.
                      Requires: agent, newName.
- action: "delete" -> Deletes and removes a sub-agent session.
                      Requires: agent.
- action: "list"   -> Lists active sub-agents and their persistent sessions.

DELEGATION RULES (file-based workflow):
Workspace folders: AGENTS/CONTEXT/ (global context), AGENTS/TASKS/ (task files), AGENTS/COMPLETIONS/ (summaries).

REPO TYPE (detect before delegating):
- >1 .git or top-level looks like frontend/backend/admin → MULTI-REPO.
- 1 .git with src/lib in base → MONOREPO.
- If ambiguous, ask the user.

MULTI-REPO: one agent per repo. Each repo has its own AGENTS/ dir. Task files: <repo>/AGENTS/TASKS/<slug>.md.

MONOREPO: ask user approval first. Then ensure origin + latest pushed, copy secrets, create <repo>-<agent>/ clones (each with own .git), base repo loses .git. Task files: <repo>-<agent>/AGENTS/TASKS/<slug>.md.

1. Before delegating, scope the task and gather global context into AGENTS/CONTEXT/ if missing.
2. Write the task to the appropriate AGENTS/TASKS/<slug>.md (self-contained: goal, scope, constraints, acceptance criteria, completion file name AGENTS/COMPLETIONS/<slug>.md).
3. Deploy:
   - New sub-agent: 'create' (relevant name + workingDirectory; empty = main cwd) then 'send'.
   - Existing sub-agent: just 'send'.
   - Never 'create' and stop if there is a task.
4. In the 'send' message: refer to the task file path (absolute). Tell the sub-agent to read AGENTS/CONTEXT/* ONLY if it is a new agent or context changed; otherwise skip context and read only the task file. Include the completion file name so the sub-agent knows where to write its summary.
5. Branch/PR: sub-agent creates branch feat/<slug> or fix/<slug>, commits there (never master), pushes branch, opens PR, records PR URL/branch in completion summary. HEAD reviews PR + CI, then merges. HEAD owns integration.
6. Do not implement sub-agent tasks directly in the main session; delegate via 'agentbus'.`

async function loadSkillsIndex(skillNames: string[]): Promise<string> {
  const home = process.env.HOME || "/home/asayman"
  const skillsBase = path.join(home, ".agents", "skills")
  const lines: string[] = []

  for (const name of skillNames) {
    const skillPath = path.join(skillsBase, name, "SKILL.md")
    try {
      const content = await fs.readFile(skillPath, "utf-8")
      const descMatch = content.match(/description:\s*(.+)/i)
      const desc = descMatch ? descMatch[1].trim() : "Custom specialized skill"
      lines.push(`- Skill: ${name} (Path: ${skillPath})\n  Description: ${desc}`)
    } catch {
      lines.push(`- Skill: ${name} (Path: ${skillPath})`)
    }
  }

  return lines.length > 0
    ? `### Available Skills\nYou have access to the following skills. Read their SKILL.md for instructions when relevant:\n${lines.join("\n")}\n`
    : ""
}

export default {
  id: "agentbus",
  async setup(ctx: any) {
    const rootDir = ctx.location?.directory || process.cwd()

    async function getHeadSessionID(): Promise<string | undefined> {
      try {
        const saved = await ctx.storage.get("head_session_id")
        return typeof saved === "string" ? saved : undefined
      } catch {
        return undefined
      }
    }

    async function setHeadSessionID(sessionID: string): Promise<void> {
      await ctx.storage.set("head_session_id", sessionID)
    }

        async function setAgentStatus(agentId: string, info: any): Promise<void> {
      try {
        const statuses: any = (await ctx.storage.get("agent_statuses")) || {}
        statuses[agentId] = info
        await ctx.storage.set("agent_statuses", statuses)
      } catch {}
      // Mirror to a shared file so the TUI plugin (separate storage namespace) can read it
      try {
        const statuses: any = (await ctx.storage.get("agent_statuses")) || {}
        const fs = await import("node:fs/promises")
        const path = await import("node:path")
        const statusFile = path.join("/home/asayman/.config/opencode/plugins/agentbus", "status.json")
        await fs.writeFile(statusFile, JSON.stringify(statuses), "utf-8")
      } catch {}
    }

    async function checkSessionInterrupted(sessionID: string, agentId: string): Promise<{ interrupted: boolean; reason: string; summary: string }> {
      try {
        const msgs = await ctx.session.context({ sessionID })
        let lastAssistantMsg: any = null
        if (Array.isArray(msgs)) {
          for (let i = msgs.length - 1; i >= 0; i--) {
            const m = msgs[i]
            if (m.role === "assistant" || m.author === "assistant" || m.agent === agentId || m.type === "assistant") {
              lastAssistantMsg = m
              break
            }
          }
        }

        if (!lastAssistantMsg) {
          return { interrupted: true, reason: "No output produced before interruption", summary: "" }
        }

        if (lastAssistantMsg.finish === "error" || lastAssistantMsg.error) {
          const reason = lastAssistantMsg.error?.message || (typeof lastAssistantMsg.error === "string" ? lastAssistantMsg.error : "Turn interrupted with error")
          return { interrupted: true, reason, summary: "" }
        }

        if (Array.isArray(lastAssistantMsg.content)) {
          for (const item of lastAssistantMsg.content) {
            if (item.type === "tool") {
              const errMsg = item.state?.error?.message || item.error?.message || ""
              if (errMsg.toLowerCase().includes("interrupted") || errMsg.toLowerCase().includes("aborted")) {
                return { interrupted: true, reason: errMsg, summary: "" }
              }
            }
          }
        }

        try {
          const sess = await ctx.session.get({ sessionID })
          if (sess?.status?.type === "error") {
            return { interrupted: true, reason: sess.status.message || "Sub-agent error", summary: "" }
          }
        } catch {}

        const body = lastAssistantMsg.text || lastAssistantMsg.content || ""
        const summary = typeof body === "string" ? body : JSON.stringify(body)
        return { interrupted: false, reason: "", summary: summary || "Task completed." }
      } catch (err: any) {
        return { interrupted: true, reason: err?.message || String(err), summary: "" }
      }
    }

    async function getAgentStatuses(): Promise<Record<string, any>> {
      try {
        return (await ctx.storage.get("agent_statuses")) || {}
      } catch {
        return {}
      }
    }

    async function getAgents(): Promise<Record<string, AgentRegistryEntry>> {
      try {
        const saved = await ctx.storage.get("agent_registry")
        if (saved && typeof saved === "object") {
          return saved as Record<string, AgentRegistryEntry>
        }
      } catch {}
      return {}
    }

    async function saveAgents(registry: Record<string, AgentRegistryEntry>): Promise<void> {
      try {
        await ctx.storage.set("agent_registry", registry)
      } catch {}
    }

    async function isSubAgentSession(sessionID: string): Promise<boolean> {
      const registry = await getAgents()
      return Object.values(registry).some((a) => a.sessionID === sessionID)
    }

    async function buildSubAgentInstructions(entry: AgentRegistryEntry): Promise<string> {
      const skillsText = await loadSkillsIndex(entry.skills || [])
      const scopeText = (entry.writeScope || []).map((s) => `- ${s}`).join("\n")

      return `You are persistent sub-agent: [${entry.id.toUpperCase()}].
Role: ${entry.role}
Assigned Working Directory: ${entry.workingDirectory} (Absolute path: ${path.resolve(rootDir, entry.workingDirectory)})

=== STRICT WORKING DIRECTORY & FILE CREATION RULE ===
All your files, edits, scripts, and commands MUST be executed inside your Assigned Working Directory:
\`${path.resolve(rootDir, entry.workingDirectory)}\`
Never create or modify files directly in the root workspace unless explicitly authorized. Before creating any file, ensure its directory path starts with your assigned working directory.

=== WRITE ACCESS CONSTRAINT (STRICT) ===
You are authorized to write and edit ONLY inside your allowed scope:
${scopeText}
Do NOT edit or write files outside this scope under any circumstances. If you need modifications outside your scope, report back to the main agent.

${skillsText}

=== TASK PROTOCOL ===
You receive tasks in the format:
<agent id="main" task="...">[task_content]</agent>

1. Follow the task brief and work strictly within your scope.
2. Read AGENTS/CONTEXT/* ONLY if the main agent explicitly says to (new agent or context changed).
3. Complete all work and verification.
4. Branch before editing: git checkout -b feat/<slug> or fix/<slug>. Never commit to master.
5. Push your branch and open a PR: git push -u origin <branch>, then gh pr create --base master --head <branch>.
6. Write a summary (including PR URL/branch) to the completion file path given by the main agent (AGENTS/COMPLETIONS/<slug>.md).
7. Finish with your clear summary.`
    }

    async function initSubAgentSession(
      agentId: string,
      role?: string,
      workingDir?: string,
      writeScope?: string[]
    ): Promise<AgentRegistryEntry> {
      const registry = await getAgents()

      const template = DEFAULT_AGENTS[agentId] || {
        role: role || `Specialized engineer for ${agentId}`,
        workingDirectory: workingDir || agentId,
        writeScope: writeScope || [`${agentId}/**`],
        skills: []
      }

      const session = await ctx.session.create({
        title: `AgentBus: ${agentId}`
      })

      // Move the session into its assigned working directory so tool calls land there
      try {
        const fs = await import("node:fs/promises")
        const pathMod = await import("node:path")
        const wd = template.workingDirectory || agentId
        const abs = pathMod.resolve(rootDir, wd)
        await fs.mkdir(abs, { recursive: true })
        await ctx.session.move({ sessionID: session.id, directory: abs })
      } catch {}

      // Inherit the exact model and provider currently used by the HEAD coordinator session
      const headId = await getHeadSessionID()
      if (headId) {
        try {
          const headSession = await ctx.session.get({ sessionID: headId })
          if (headSession?.model) {
            await ctx.session.switchModel({
              sessionID: session.id,
              model: headSession.model
            })
          }
        } catch (e) {
          console.error("Failed to inherit model from head session:", e)
        }
      }

      const entry: AgentRegistryEntry = {
        id: agentId,
        sessionID: session.id,
        role: template.role,
        workingDirectory: template.workingDirectory,
        writeScope: template.writeScope,
        skills: template.skills
      }

      registry[agentId] = entry
      await saveAgents(registry)
      await setAgentStatus(agentId, { status: "idle" })

      try {
        await ctx.session.synthetic({
          sessionID: session.id,
          text: `[AgentBus] Sub-agent [${agentId.toUpperCase()}] initialized.\nRole: ${template.role}\nWorking Directory: ${path.resolve(rootDir, template.workingDirectory)}`
        })
      } catch {}

      return entry
    }

    async function getOrCreateAgentSession(agentId: string): Promise<AgentRegistryEntry> {
      const registry = await getAgents()
      if (registry[agentId]) {
        try {
          const s = await ctx.session.get({ sessionID: registry[agentId].sessionID })
          if (s) return registry[agentId]
        } catch {}
      }

      return await initSubAgentSession(agentId)
    }

    // Monitor background sub-agents and trigger the main agent on completion or report interruption
    const activeTasks = new Map<string, { mainSessionID: string; agentId: string; task: string }>()

    async function handleSubAgentFinished(sid: string, info: { mainSessionID: string; agentId: string; task: string }) {
      if (!activeTasks.has(sid)) return
      activeTasks.delete(sid)

      try {
        const result = await checkSessionInterrupted(sid, info.agentId)
        if (result.interrupted) {
          await setAgentStatus(info.agentId, { task: info.task, status: "interrupted", finishedAt: Date.now() })

          // Tell the user directly that the sub-agent was interrupted
          await ctx.session.synthetic({
            sessionID: info.mainSessionID,
            text: `Sub-agent '${info.agentId}' was interrupted during task '${info.task}'${result.reason ? ` (${result.reason})` : ""}.`
          })

          // Notify main agent of interruption rather than blindly claiming completion
          if (info.mainSessionID) {
            const notification = `<agent id="${info.agentId}" task="${info.task}" status="interrupted">
Task was interrupted before completion. Reason: ${result.reason || "Execution stopped."}
</agent>`

            await ctx.session.prompt({
              sessionID: info.mainSessionID,
              text: notification,
              delivery: "queue"
            })
          }
        } else {
          await setAgentStatus(info.agentId, { task: info.task, status: "completed", finishedAt: Date.now() })

          if (info.mainSessionID) {
            const notification = `<agent id="${info.agentId}" task="${info.task}">
${result.summary}
</agent>`

            await ctx.session.prompt({
              sessionID: info.mainSessionID,
              text: notification,
              delivery: "queue"
            })
          }
        }
      } catch (err) {
        console.error("Error handling sub-agent finish:", err)
        await setAgentStatus(info.agentId, { task: info.task, status: "interrupted", finishedAt: Date.now() })
        await ctx.session.synthetic({
          sessionID: info.mainSessionID,
          text: `Sub-agent '${info.agentId}' was interrupted or failed during task '${info.task}'.`
        })
      }
    }

    if (ctx.event?.subscribe) {
      const abortCtrl = new AbortController()
      ;(async () => {
        try {
          for await (const event of ctx.event.subscribe({ signal: abortCtrl.signal })) {
            if (event.type === "session.idle" || event.type === "session.status") {
              const sid = (event as any).sessionID || (event as any).data?.sessionID || (event as any).data?.id
              if (sid && activeTasks.has(sid)) {
                const info = activeTasks.get(sid)!
                await handleSubAgentFinished(sid, info)
              }
            }
          }
        } catch {}
      })()
    }

    // Command to initialize HEAD coordinator
    if (ctx.command?.transform) {
      await ctx.command.transform((cmdEditor: any) => {
        cmdEditor.add({
          name: "agentbus-init",
          description: "Initialize and lock the current session as the HEAD coordinator agent",
          execute: async (input: any) => {
            const sessionID = input?.sessionID
            if (!sessionID) return

            if (await isSubAgentSession(sessionID)) {
              await ctx.session.synthetic({
                sessionID,
                text: "Error: Sub-agent sessions are permanently forbidden from executing agentbus-init."
              })
              return
            }

            let userText = ""
            if (typeof input?.args === "string" && input.args.trim()) {
              userText = input.args.trim()
            } else if (Array.isArray(input?.args) && input.args.length > 0) {
              userText = input.args.join(" ").trim()
            } else if (typeof input?.prompt?.text === "string") {
              userText = input.prompt.text.replace(/^\/agentbus-init\s*/i, "").trim()
            } else if (typeof input?.text === "string") {
              userText = input.text.replace(/^\/agentbus-init\s*/i, "").trim()
            }

            const currentHead = await getHeadSessionID()
            if (currentHead === sessionID) {
              if (userText) {
                await ctx.session.prompt({
                  sessionID,
                  text: userText,
                  delivery: input?.delivery || "steer"
                })
              } else {
                await ctx.session.synthetic({
                  sessionID,
                  text: "AgentBus: This session is already initialized as the HEAD coordinator."
                })
              }
              return
            }

            // If a previous HEAD session was set, verify if it still exists or allow re-claiming
            if (currentHead && currentHead !== sessionID) {
              let previousExists = false
              try {
                const prev = await ctx.session.get({ sessionID: currentHead })
                if (prev) previousExists = true
              } catch {}

              // Reassign HEAD to this session
              await ctx.session.synthetic({
                sessionID,
                text: `AgentBus: Reassigning HEAD coordinator role from previous session '${currentHead}' to this session.`
              })
            }

            await setHeadSessionID(sessionID)

            try {
              const current = await ctx.session.get({ sessionID })
              const title = current?.title || "MAIN AGENT"
              const newTitle = title.startsWith("[MAIN]") ? title : `[MAIN] ${title}`
              await ctx.session.update({ sessionID, title: newTitle })
            } catch {}

            if (userText) {
              await ctx.session.prompt({
                sessionID,
                text: userText,
                delivery: input?.delivery || "steer"
              })
            } else {
              await ctx.session.synthetic({
                sessionID,
                text: "AgentBus initialized. This session is now the HEAD coordinator agent."
              })
            }
          }
        })
      })
    }

    // Instruction Injection Hook: Injects static prompt for HEAD and dynamic instructions for sub-agents
    if (ctx.session?.hook) {
      try {
        await ctx.session.hook("context", async (event: any) => {
          const currentHead = await getHeadSessionID()
          if (currentHead && event.sessionID === currentHead) {
            event.system = event.system || []
            const exists = event.system.some(
              (p: any) => p.text && p.text.includes("=== AGENTBUS HEAD COORDINATOR MODE ===")
            )

            if (!exists) {
              event.system.push({
                type: "text",
                text: STATIC_HEAD_SYSTEM_PROMPT
              })
            }
            return
          }

          const registry = await getAgents()
          const subAgent = Object.values(registry).find((a) => a.sessionID === event.sessionID)
          if (subAgent) {
            event.system = event.system || []
            const exists = event.system.some(
              (p: any) => p.text && p.text.includes(`persistent sub-agent: [${subAgent.id.toUpperCase()}]`)
            )
            if (!exists) {
              const instr = await buildSubAgentInstructions(subAgent)
              event.system.push({
                type: "text",
                text: instr
              })
            }
          }
        })
      } catch {}
    }

    // Compaction Hook: Guarantees AgentBus instructions survive context compaction
    if (ctx.session?.hook) {
      try {
        await ctx.session.hook("compaction", async (event: any) => {
          const currentHead = await getHeadSessionID()
          if (currentHead && event.sessionID === currentHead) {
            event.system = event.system || []
            const exists = event.system.some(
              (p: any) => p.text && p.text.includes("=== AGENTBUS HEAD COORDINATOR MODE ===")
            )
            if (!exists) {
              event.system.push({
                type: "text",
                text: STATIC_HEAD_SYSTEM_PROMPT
              })
            }
            return
          }

          const registry = await getAgents()
          const subAgent = Object.values(registry).find((a) => a.sessionID === event.sessionID)
          if (subAgent) {
            event.system = event.system || []
            const exists = event.system.some(
              (p: any) => p.text && p.text.includes(`persistent sub-agent: [${subAgent.id.toUpperCase()}]`)
            )
            if (!exists) {
              const instr = await buildSubAgentInstructions(subAgent)
              event.system.push({
                type: "text",
                text: instr
              })
            }
          }
        })
      } catch {}
    }

    // Single unified 'agentbus' tool
    await ctx.tool.transform((editor: any) => {
      editor.add({
        name: "agentbus",
        description: "Coordinate, delegate, query, create, rename, or delete persistent sub-agents. Restricted to HEAD session.",
        input: {
          type: "object",
          properties: {
            action: {
              type: "string",
              enum: ["send", "btw", "create", "rename", "delete", "list"],
              description: "Action to perform: 'send' (shoot-and-forget task), 'btw' (ephemeral question), 'create' (new agent), 'rename' (rename agent), 'delete' (delete agent), 'list' (view all agents)"
            },
            agent: {
              type: "string",
              description: "Target sub-agent identifier (e.g. 'frontend', 'backend', 'tester', 'dbmaster', or custom)"
            },
            task: {
              type: "string",
              description: "Task title, brief identifier, or slug (required for action='send')"
            },
            message: {
              type: "string",
              description: "Task instructions to relay to the sub-agent (required for action='send')"
            },
            question: {
              type: "string",
              description: "Ephemeral question for the sub-agent (required for action='btw')"
            },
            role: {
              type: "string",
              description: "Role description for new sub-agent (used with action='create')"
            },
            workingDirectory: {
              type: "string",
              description: "Working directory for new sub-agent (used with action='create')"
            },
            writeScope: {
              type: "array",
              items: { type: "string" },
              description: "Allowed write globs (used with action='create', e.g. ['mobile/**'])"
            },
            newName: {
              type: "string",
              description: "New name for the sub-agent (used with action='rename')"
            },
            taskFilePath: {
              type: "string",
              description: "Optional file path to mirror the task brief on disk (e.g. 'backend/AGENT/TASK.md')"
            },
            workingDirectory: {
              type: "string",
              description: "Optional override of the sub-agent's working directory for this task (defaults to the agent's registered working directory / main cwd)"
            }
          },
          required: ["action"],
          additionalProperties: false
        },
        execute: async (input: any, context: any) => {
          const sessionID = context?.sessionID
          const currentHead = await getHeadSessionID()

          if (currentHead && sessionID && sessionID !== currentHead) {
            return {
              content: `Error: The 'agentbus' tool is restricted to the designated HEAD coordinator session (${currentHead}). This session (${sessionID}) is not authorized.`
            }
          }

          const { action, agent, task, message, question, role, workingDirectory, writeScope, newName, taskFilePath } = input

          // 1. LIST
          if (action === "list") {
            const registry = await getAgents()
            const list = Object.values(registry).map((a) => ({
              id: a.id,
              sessionID: a.sessionID,
              role: a.role,
              workingDirectory: a.workingDirectory,
              writeScope: a.writeScope,
              skills: a.skills
            }))
            return {
              content: JSON.stringify(list, null, 2)
            }
          }

          // 2. CREATE NEW AGENT
          if (action === "create") {
            if (!agent) return { content: "Error: 'agent' identifier is required to create an agent." }
            const registry = await getAgents()
            if (registry[agent]) {
              return { content: `Error: Sub-agent '${agent}' already exists with session '${registry[agent].sessionID}'.` }
            }

            const created = await initSubAgentSession(agent, role, workingDirectory, writeScope)
            return {
              content: `Successfully created persistent sub-agent [${agent}] (Session: ${created.sessionID}, WorkingDir: ${created.workingDirectory}).`
            }
          }

          // 3. RENAME AGENT
          if (action === "rename") {
            if (!agent || !newName) return { content: "Error: Both 'agent' and 'newName' are required to rename an agent." }
            const registry = await getAgents()
            if (!registry[agent]) return { content: `Error: Sub-agent '${agent}' not found.` }

            const entry = registry[agent]
            delete registry[agent]
            entry.id = newName
            registry[newName] = entry
            await saveAgents(registry)

            try {
              await ctx.session.update({
                sessionID: entry.sessionID,
                title: `AgentBus: ${newName}`
              })
            } catch {}

            return {
              content: `Successfully renamed sub-agent [${agent}] to [${newName}].`
            }
          }

          // 4. DELETE AGENT
          if (action === "delete") {
            if (!agent) return { content: "Error: 'agent' identifier is required to delete an agent." }
            const registry = await getAgents()
            if (!registry[agent]) return { content: `Error: Sub-agent '${agent}' not found.` }

            const sid = registry[agent].sessionID
            delete registry[agent]
            await saveAgents(registry)

            activeTasks.delete(sid)
            try {
              const statuses = await getAgentStatuses()
              delete statuses[agent]
              await ctx.storage.set("agent_statuses", statuses)
            } catch {}

            try {
              await ctx.session.remove({ sessionID: sid })
            } catch {}

            return {
              content: `Successfully deleted sub-agent [${agent}] and removed session [${sid}].`
            }
          }

          // 5. SHOOT-AND-FORGET TASK (SEND)
          if (action === "send") {
            if (!agent || !task || !message) {
              return { content: "Error: 'agent', 'task', and 'message' are all required for action='send'." }
            }

            const target = await getOrCreateAgentSession(agent)

            // Optional per-task working directory override
            if (workingDirectory) {
              const registry = await getAgents()
              if (registry[agent]) {
                registry[agent].workingDirectory = workingDirectory
                await saveAgents(registry)
              }
              // Actually move the session's working directory so tool calls land in the right folder
              try {
                const fs = await import("node:fs/promises")
                const pathMod = await import("node:path")
                const abs = pathMod.resolve(rootDir, workingDirectory)
                await fs.mkdir(abs, { recursive: true })
                await ctx.session.move({ sessionID: target.sessionID, directory: abs })
              } catch {}
            }

            if (taskFilePath) {
              const absTaskPath = path.resolve(rootDir, taskFilePath)
              await fs.mkdir(path.dirname(absTaskPath), { recursive: true })
              await fs.writeFile(absTaskPath, message, "utf-8")
            }

            const mainID = sessionID || currentHead || ""
            const promptPayload = `<agent id="main" task="${task}">
${message}
</agent>`

            // Record status as running
            await setAgentStatus(agent, { task, status: "running", startedAt: Date.now() })

            // Prompt sub-agent session (shoot-and-forget) cleanly without crashing on mid-turn steering
            try {
              await ctx.session.prompt({
                sessionID: target.sessionID,
                text: promptPayload
              })
            } catch (err: any) {
              // Fallback to queue delivery if session is busy
              await ctx.session.prompt({
                sessionID: target.sessionID,
                text: promptPayload,
                delivery: "queue"
              })
            }

            // Register active task
            const taskInfo = { mainSessionID: mainID, agentId: agent, task }
            activeTasks.set(target.sessionID, taskInfo)

            // Spawn background monitoring fallback that awaits sub-agent completion and auto-triggers main
            const monitorTask = async () => {
              try {
                // Wait for sub-agent session to finish execution
                await ctx.session.wait({ sessionID: target.sessionID })
                await handleSubAgentFinished(target.sessionID, taskInfo)
              } catch (err) {
                await handleSubAgentFinished(target.sessionID, taskInfo)
              }
            }
            void monitorTask()

            return {
              content: `[status: running] Task "${task}" dispatched to sub-agent [${agent}]. When the sub-agent finishes, you will be automatically triggered with its completion block.`
            }
          }

          // 6. EPHEMERAL QUESTION (/BTW)
          if (action === "btw") {
            if (!agent || !question) {
              return { content: "Error: 'agent' and 'question' are required for action='btw'." }
            }

            const target = await getOrCreateAgentSession(agent)

            // Transient generation without adding to conversation history
            let answer = ""
            try {
              const gen = await ctx.session.generate({
                sessionID: target.sessionID,
                prompt: `[Ephemeral Side-Question /btw]: ${question}`
              })
              answer = gen?.text || "No response received."
            } catch {
              // Fallback to experimental generate if session generate is not supported
              try {
                const gen = await ctx.experimental?.generate?.text?.({
                  prompt: `You are sub-agent [${agent.toUpperCase()}]. Context: ${target.role}. Question: ${question}`
                })
                answer = gen?.text || "No response received."
              } catch (e: any) {
                answer = `Failed to generate ephemeral response: ${e.message}`
              }
            }

            return {
              content: `[/btw answer from ${agent}]:\n${answer}`
            }
          }

          return {
            content: `Unknown action '${action}'. Supported: send, btw, create, rename, delete, list.`
          }
        }
      })
    })

    return () => {}
  }
}
