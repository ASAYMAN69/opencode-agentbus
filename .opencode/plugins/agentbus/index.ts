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

Do not implement sub-agent tasks directly; delegate via 'agentbus'.`

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

      const skillsText = await loadSkillsIndex(template.skills)
      const scopeText = template.writeScope.map((s) => `- ${s}`).join("\n")

      const subAgentInstructions = `You are persistent sub-agent: [${agentId.toUpperCase()}].
Role: ${template.role}
Assigned Working Directory: ${template.workingDirectory} (Absolute path: ${path.resolve(rootDir, template.workingDirectory)})

=== STRICT WORKING DIRECTORY & FILE CREATION RULE ===
All your files, edits, scripts, and commands MUST be executed inside your Assigned Working Directory:
\`${path.resolve(rootDir, template.workingDirectory)}\`
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
2. Complete all work and verification.
3. Finish with your clear summary.
`

      try {
        if (ctx.session.instructions?.entry?.put) {
          await ctx.session.instructions.entry.put({
            sessionID: session.id,
            key: "agentbus_config",
            value: subAgentInstructions
          })
        }
      } catch {}

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

    // Monitor background sub-agents and trigger the main agent on completion
    const activeTasks = new Map<string, { mainSessionID: string; agentId: string; task: string }>()

    if (ctx.event?.subscribe) {
      const abortCtrl = new AbortController()
      ;(async () => {
        try {
          for await (const event of ctx.event.subscribe({ signal: abortCtrl.signal })) {
            if (event.type === "session.idle" || event.type === "session.status") {
              const sid = (event as any).sessionID || (event as any).data?.sessionID || (event as any).data?.id
              if (sid && activeTasks.has(sid)) {
                const info = activeTasks.get(sid)!
                activeTasks.delete(sid)

                // Sub-agent has finished its turn; extract final assistant summary
                try {
                  const msgs = await ctx.session.context({ sessionID: sid })
                  let summary = "Task completed."
                  if (Array.isArray(msgs)) {
                    for (let i = msgs.length - 1; i >= 0; i--) {
                      const m = msgs[i]
                      if (m.role === "assistant" || m.author === "assistant" || m.agent === info.agentId) {
                        const body = m.text || m.content || JSON.stringify(m)
                        summary = typeof body === "string" ? body : JSON.stringify(body)
                        break
                      }
                    }
                  }

                  // Auto-trigger main agent with success block
                  const notification = `<agent id="${info.agentId}" task="${info.task}">
${summary}
</agent>`

                  await ctx.session.prompt({
                    sessionID: info.mainSessionID,
                    text: notification,
                    delivery: "queue"
                  })
                } catch (e) {
                  console.error("Error auto-notifying main agent:", e)
                }
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
          execute: async ({ sessionID }: any) => {
            if (await isSubAgentSession(sessionID)) {
              await ctx.session.synthetic({
                sessionID,
                text: "Error: Sub-agent sessions are permanently forbidden from executing agentbus-init."
              })
              return
            }

            const currentHead = await getHeadSessionID()
            if (currentHead === sessionID) {
              await ctx.session.synthetic({
                sessionID,
                text: "AgentBus: This session is already initialized as the HEAD coordinator. Re-running is prohibited."
              })
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

            await ctx.session.synthetic({
              sessionID,
              text: "AgentBus initialized. This session is now the HEAD coordinator agent."
            })
          }
        })
      })
    }

    // Prefix Caching Hook: Injects static prompt at the very tail of event.system, right before 1st user message
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

            // Spawn background monitoring promise that awaits sub-agent completion and auto-triggers main
            (async () => {
              try {
                // Wait for sub-agent session to finish execution
                await ctx.session.wait({ sessionID: target.sessionID })

                // Extract the sub-agent's final output
                const msgs = await ctx.session.context({ sessionID: target.sessionID })
                let summary = "Task completed."
                if (Array.isArray(msgs)) {
                  for (let i = msgs.length - 1; i >= 0; i--) {
                    const m = msgs[i]
                    if (m.role === "assistant" || m.author === "assistant" || m.agent === agent) {
                      const body = m.text || m.content || JSON.stringify(m)
                      summary = typeof body === "string" ? body : JSON.stringify(body)
                      break
                    }
                  }
                }

                // Update status to idle
                await setAgentStatus(agent, { task, status: "completed", finishedAt: Date.now() })

                // Auto-trigger the main coordinator session with the success block
                if (mainID) {
                  const notification = `<agent id="${agent}" task="${task}">
${summary}
</agent>`

                  await ctx.session.prompt({
                    sessionID: mainID,
                    text: notification
                  })
                }
              } catch (err) {
                console.error(`Error waiting for sub-agent [${agent}]:`, err)
                await setAgentStatus(agent, { task, status: "error" })
              }
            })()

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
