const MAX_RECENT = 8 // number of recent messages kept verbatim
const MAX_SUMMARY = 600

let summary = ''
let recent = []
let queue = Promise.resolve()

export function getMemory() {
  return { summary, recent: [...recent] }
}

// summarize(prevSummary, messages) => new summary. Old turns are merged into it in the background
export function addTurn(user, assistant, summarize, actions = []) {
  recent.push(
    { role: 'user', content: user },
    { role: 'assistant', content: assistant, ...(actions.length ? { actions: [...actions] } : {}) }
  )
  if (recent.length <= MAX_RECENT) return
  const overflow = recent.splice(0, recent.length - MAX_RECENT)
  queue = queue.then(async () => {
    try {
      summary = (await summarize(summary, overflow)).slice(0, MAX_SUMMARY)
    } catch {
      const raw = overflow.map((m) => m.content).join(' / ')
      summary = `${summary} ${raw}`.trim().slice(-MAX_SUMMARY)
    }
  })
}

export function resetMemory() {
  summary = ''
  recent = []
}
