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

    // Only 1 slot: Directly above the prompt composer box (just below the session chat title/area)
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

    return () => {
      unregisterComposerSlot?.()
    }
  }
})
