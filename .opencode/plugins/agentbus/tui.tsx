import { Plugin } from "@opencode/plugin/tui"

export default Plugin.define({
  id: "agentbus.tui",
  setup(context: any) {
    // Session badge rendered right above the composer or in the session slots
    const unregisterComposerSlot = context.ui?.slot?.({
      prepend: "session.composer.top",
      render: ({ sessionID }: { sessionID?: string }) => {
        const sid = sessionID || context.ui?.router?.current?.()?.sessionID
        if (!sid) return null

        const session = context.data?.session?.get?.(sid)
        const title = session?.title || ""

        // Check if this session is the designated HEAD/MAIN agent
        const isMain = title.toLowerCase().includes("head") || 
                       title.toLowerCase().includes("main agent") ||
                       context.data?.session?.instructions?.entry?.list?.(sid)?.some((e: any) => e.key === "agentbus_head_instructions")

        if (isMain) {
          return (
            <box paddingLeft={1} paddingRight={1} paddingTop={0} paddingBottom={0} marginBottom={1}>
              <text bg="red" fg="#d0d0d0" bold> MAIN </text>
            </box>
          )
        }

        // Check if this session is a sub-agent
        if (title.startsWith("AgentBus:")) {
          const agentName = title.replace("AgentBus:", "").trim().toUpperCase()
          return (
            <box paddingLeft={1} paddingRight={1} paddingTop={0} paddingBottom={0} marginBottom={1}>
              <text bg="yellow" fg="black" bold> {agentName} </text>
            </box>
          )
        }

        return null
      }
    })

    // Also register badge in the sidebar content right under the title of each session
    const unregisterSidebarSlot = context.ui?.slot?.({
      append: "sidebar.content",
      render: ({ sessionID }: { sessionID?: string }) => {
        if (!sessionID) return null
        const session = context.data?.session?.get?.(sessionID)
        const title = session?.title || ""

        if (title.toLowerCase().includes("head") || title.toLowerCase().includes("main agent")) {
          return (
            <box paddingLeft={1}>
              <text bg="red" fg="#d0d0d0" bold> MAIN </text>
            </box>
          )
        }

        if (title.startsWith("AgentBus:")) {
          const agentName = title.replace("AgentBus:", "").trim().toUpperCase()
          return (
            <box paddingLeft={1}>
              <text bg="yellow" fg="black" bold> {agentName} </text>
            </box>
          )
        }

        return null
      }
    })

    // Listen for agent creation to automatically open tabs in OpenCode
    const stopListener = context.data?.listen?.(({ details }: any) => {
      if (details?.type === "session.created" && details?.data?.title?.startsWith("AgentBus:")) {
        const sessionID = details?.data?.id
        if (sessionID && context.ui?.tabs?.enabled?.()) {
          context.ui.tabs.open(sessionID)
          context.ui.toast?.show?.({
            title: "AgentBus",
            message: `Opened session tab for ${details?.data?.title}`,
            variant: "info"
          })
        }
      }
    })

    // Register a command to focus or switch to an agent's tab
    context.keymap?.layer?.(() => ({
      mode: "global",
      priority: 10,
      commands: [
        {
          id: "agentbus.open_tab",
          title: "AgentBus: Switch to Sub-Agent Tab",
          group: "AgentBus",
          slash: { name: "agent", aliases: ["subagent"], arguments: true },
          run: async (input: string) => {
            const target = input?.trim()?.toLowerCase()
            const sessions = context.data.session.list()
            const match = sessions.find((s: any) => 
              s.title?.toLowerCase()?.includes(`agentbus: ${target}`) ||
              s.title?.toLowerCase()?.includes(target)
            )

            if (match) {
              if (context.ui?.tabs?.enabled?.()) {
                context.ui.tabs.focus(match.id)
              } else {
                context.ui.router.navigate({ type: "session", sessionID: match.id })
              }
            } else {
              context.ui.toast?.show?.({
                title: "AgentBus",
                message: `No active session found for "${input}". Available: ${sessions.map((s: any) => s.title).join(", ")}`,
                variant: "error"
              })
            }
          }
        }
      ],
      bindings: []
    }))

    return () => {
      unregisterComposerSlot?.()
      unregisterSidebarSlot?.()
      stopListener?.()
    }
  }
})
