import { Plugin } from "@opencode/plugin/tui"

export default Plugin.define({
  id: "agentbus.tui",
  setup(context: any) {
    function getBadge(sid: string) {
      if (!sid) return null
      const session = context.data?.session?.get?.(sid)
      const title = session?.title || ""

      let isMain = false
      try {
        const storedHead = context.storage?.get?.("head_session_id")
        if (storedHead === sid) isMain = true
      } catch {}

      const lower = title.toLowerCase()
      if (lower.startsWith("[main]") || lower.includes("main agent") || lower.includes("head")) {
        isMain = true
      }

      if (isMain) {
        return <text bg="red" fg="#d0d0d0" bold> MAIN </text>
      }

      if (title.startsWith("AgentBus:")) {
        const name = title.replace("AgentBus:", "").trim().toUpperCase()
        return <text bg="yellow" fg="black" bold> {name} </text>
      }

      if (lower.includes("frontend")) return <text bg="yellow" fg="black" bold> FRONTEND </text>
      if (lower.includes("backend")) return <text bg="yellow" fg="black" bold> BACKEND </text>
      if (lower.includes("tester")) return <text bg="yellow" fg="black" bold> TESTER </text>
      if (lower.includes("dbmaster")) return <text bg="yellow" fg="black" bold> DBMASTER </text>

      return null
    }

    // 1. Badge directly above prompt box (just below the chat history/title)
    const unregisterComposerSlot = context.ui?.slot?.({
      prepend: "session.composer.top",
      render: () => {
        const currentRoute = context.ui?.router?.current?.()
        const sid = currentRoute?.sessionID
        if (!sid) return null
        const badge = getBadge(sid)
        if (!badge) return null
        return (
          <box paddingBottom={1}>
            {badge}
          </box>
        )
      }
    })

    // 2. Right navbar / sidebar: Show processes and status of each delegated sub-agent
    const unregisterSidebarSlot = context.ui?.slot?.({
      append: "sidebar.content",
      render: ({ sessionID }: { sessionID?: string }) => {
        if (!sessionID) return null
        const session = context.data?.session?.get?.(sessionID)
        const title = session?.title || ""

        // Check if this sidebar item is a sub-agent
        if (title.startsWith("AgentBus:") || title.toLowerCase().includes("frontend") || title.toLowerCase().includes("backend") || title.toLowerCase().includes("tester") || title.toLowerCase().includes("dbmaster")) {
          let agentKey = ""
          if (title.startsWith("AgentBus:")) {
            agentKey = title.replace("AgentBus:", "").trim().toLowerCase()
          } else {
            const l = title.toLowerCase()
            if (l.includes("frontend")) agentKey = "frontend"
            else if (l.includes("backend")) agentKey = "backend"
            else if (l.includes("tester")) agentKey = "tester"
            else if (l.includes("dbmaster")) agentKey = "dbmaster"
          }

          let statusInfo: any = null
          try {
            const statuses = context.storage?.get?.("agent_statuses") || {}
            statusInfo = statuses[agentKey]
          } catch {}

          if (statusInfo?.status === "running") {
            return (
              <box paddingLeft={1} flexDirection="row">
                <text fg="yellow" bold>● running: </text>
                <text fg="#a0a0a0">{statusInfo.task}</text>
              </box>
            )
          }

          if (statusInfo?.status === "completed") {
            return (
              <box paddingLeft={1} flexDirection="row">
                <text fg="green" bold>✓ done: </text>
                <text fg="#808080">{statusInfo.task}</text>
              </box>
            )
          }

          return (
            <box paddingLeft={1}>
              <text fg="#606060">idle</text>
            </box>
          )
        }

        return null
      }
    })

    return () => {
      unregisterComposerSlot?.()
      unregisterSidebarSlot?.()
    }
  }
})
