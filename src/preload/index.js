import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('pet', {
  setIgnoreMouse: (ignore) => ipcRenderer.send('set-ignore-mouse', ignore),
  quit: () => ipcRenderer.send('quit'),
  onActiveWindow: (cb) => ipcRenderer.on('active-window', (_e, w) => cb(w)),
  getSettings: () => ipcRenderer.invoke('settings:get'),
  setSettings: (tools) => ipcRenderer.invoke('settings:set', tools),
  onConfirm: (cb) => ipcRenderer.on('confirm-request', (_e, req) => cb(req)),
  respondConfirm: (id, ok) => ipcRenderer.send('confirm-response', id, ok),
  chat: (text, kind, { onChunk, onDone, onError, onTool, onReset }) => {
    ipcRenderer.removeAllListeners('chat-reset')
    ipcRenderer.on('chat-reset', () => onReset())
    ipcRenderer.removeAllListeners('chat-chunk')
    ipcRenderer.removeAllListeners('chat-tool')
    ipcRenderer.removeAllListeners('chat-done')
    ipcRenderer.removeAllListeners('chat-error')
    ipcRenderer.on('chat-chunk', (_e, c) => onChunk(c))
    ipcRenderer.on('chat-tool', (_e, l) => onTool(l))
    ipcRenderer.once('chat-done', () => onDone())
    ipcRenderer.once('chat-error', (_e, m) => onError(m))
    ipcRenderer.invoke('chat', { text, kind })
  }
})
