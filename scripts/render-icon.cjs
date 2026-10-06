const { app, BrowserWindow } = require('electron')
const { createServer } = require('vite')
const { mkdirSync, writeFileSync } = require('fs')
const path = require('path')

const projectRoot = path.resolve(__dirname, '..')

function toIco(png) {
  const header = Buffer.alloc(22)
  header.writeUInt16LE(0, 0)
  header.writeUInt16LE(1, 2)
  header.writeUInt16LE(1, 4)
  header[6] = 0
  header[7] = 0
  header[8] = 0
  header[9] = 0
  header.writeUInt16LE(1, 10)
  header.writeUInt16LE(32, 12)
  header.writeUInt32LE(png.length, 14)
  header.writeUInt32LE(header.length, 18)
  return Buffer.concat([header, png])
}

async function waitForRender(webContents) {
  for (let attempt = 0; attempt < 100; attempt++) {
    const ready = await webContents.executeJavaScript('window.iconRenderReady === true || window.iconRenderError || false')
    if (ready === true) return
    if (typeof ready === 'string') throw new Error(ready)
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  throw new Error('Timed out while rendering the 3D pet icon.')
}

app.whenReady().then(async () => {
  let vite
  let window
  try {
    vite = await createServer({
      configFile: false,
      root: path.join(projectRoot, 'src', 'renderer'),
      server: { host: '127.0.0.1', port: 0, strictPort: false },
      optimizeDeps: { include: ['three'] }
    })
    await vite.listen()
    const address = vite.httpServer.address()
    window = new BrowserWindow({
      width: 512,
      height: 512,
      frame: false,
      show: false,
      transparent: true,
      backgroundColor: '#00000000',
      webPreferences: { backgroundThrottling: false, sandbox: true }
    })
    await window.loadURL(`http://127.0.0.1:${address.port}/icon-preview.html`)
    await waitForRender(window.webContents)
    const rendered = await window.webContents.capturePage()
    const png = rendered.resize({ width: 256, height: 256, quality: 'best' }).toPNG()
    const bitmap = rendered.toBitmap()
    const { width, height } = rendered.getSize()
    const alphaAt = (x, y) => bitmap[(y * width + x) * 4 + 3]
    const cornerAlphas = [alphaAt(0, 0), alphaAt(0, height - 1), alphaAt(width - 1, 0), alphaAt(width - 1, height - 1)]
    if (cornerAlphas.some((alpha) => alpha !== 0)) {
      throw new Error('Icon capture background is not transparent.')
    }
    const buildDir = path.join(projectRoot, 'build')
    mkdirSync(buildDir, { recursive: true })
    writeFileSync(path.join(buildDir, 'icon.png'), png)
    writeFileSync(path.join(buildDir, 'icon.ico'), toIco(png))
    console.info(`Generated ${path.join(buildDir, 'icon.ico')} from the 3D pet model.`)
  } catch (error) {
    console.error('[icon] render failed:', error)
    process.exitCode = 1
  } finally {
    if (window && !window.isDestroyed()) window.destroy()
    if (vite) await vite.close()
    app.quit()
  }
})