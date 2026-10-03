const MAX_RECENT = 8 // 원문으로 유지할 최근 메시지 수
const MAX_SUMMARY = 600

let summary = ''
let recent = []
let queue = Promise.resolve()

export function getMemory() {
  return { summary, recent: [...recent] }
}

// summarize(prevSummary, messages) => 새 요약. 오래된 대화는 백그라운드에서 요약에 합친다
export function addTurn(user, assistant, summarize) {
  recent.push({ role: 'user', content: user }, { role: 'assistant', content: assistant })
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
