import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('pet', {
  setIgnoreMouse: (ignore) => ipcRenderer.send('set-ignore-mouse', ignore),
  quit: () => ipcRenderer.send('quit'),
  dragStart: () => ipcRenderer.send('drag-start'),
  dragEnd: () => ipcRenderer.send('drag-end'),
  onActiveWindow: (cb) => ipcRenderer.on('active-window', (_e, w) => cb(w)),
  getActiveWindow: () => ipcRenderer.invoke('active-window:get'),
  readScreenText: () => ipcRenderer.invoke('screen-text:get'),
  synthesizeSpeech: (text) => ipcRenderer.invoke('tts:synthesize', text),
  onCursor: (cb) => ipcRenderer.on('cursor', (_e, p) => cb(p)),
  getSettings: () => ipcRenderer.invoke('settings:get'),
  setSettings: (tools) => ipcRenderer.invoke('settings:set', tools),
  onConfirm: (cb) => ipcRenderer.on('confirm-request', (_e, req) => cb(req)),
  respondConfirm: (id, ok) => ipcRenderer.send('confirm-response', id, ok),
  cancelChat: (id) => ipcRenderer.send('chat:cancel', id),
  chat: (text, kind, id, { onChunk, onDone, onError, onTool, onReset }) => {
    const matches = (message) => message.id === id
    const onResetEvent = (_e, message) => { if (matches(message)) onReset() }
    const onChunkEvent = (_e, message) => { if (matches(message)) onChunk(message.payload) }
    const onToolEvent = (_e, message) => { if (matches(message)) onTool(message.payload) }
    const cleanup = () => {
      ipcRenderer.removeListener('chat-reset', onResetEvent)
      ipcRenderer.removeListener('chat-chunk', onChunkEvent)
      ipcRenderer.removeListener('chat-tool', onToolEvent)
      ipcRenderer.removeListener('chat-done', onDoneEvent)
      ipcRenderer.removeListener('chat-error', onErrorEvent)
      ipcRenderer.removeListener('chat-cancelled', onCancelledEvent)
    }
    const onDoneEvent = (_e, message) => { if (matches(message)) { cleanup(); onDone() } }
    const onErrorEvent = (_e, message) => { if (matches(message)) { cleanup(); onError(message.payload) } }
    const onCancelledEvent = (_e, message) => { if (matches(message)) cleanup() }
    ipcRenderer.on('chat-reset', onResetEvent)
    ipcRenderer.on('chat-chunk', onChunkEvent)
    ipcRenderer.on('chat-tool', onToolEvent)
    ipcRenderer.on('chat-done', onDoneEvent)
    ipcRenderer.on('chat-error', onErrorEvent)
    ipcRenderer.on('chat-cancelled', onCancelledEvent)
    ipcRenderer.invoke('chat', { text, kind, id })
  }
})
