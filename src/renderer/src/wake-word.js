import WakeWordEngine from '@edyrkaj/openwakeword-wasm-browser'

export function createWakeWordController(assetUrl, { onDetected, onError, onReady }) {
  const baseUrl = assetUrl.replace(/\/+$/, '')
  const engine = new WakeWordEngine({
    keywords: ['hey_jarvis'],
    baseAssetUrl: `${baseUrl}/models`,
    ortWasmPath: `${baseUrl}/ort/`,
    detectionThreshold: 0.55,
    cooldownMs: 2500
  })
  let desiredActive = false
  let generation = 0
  let started = false
  let reportedReady = false
  let loadPromise

  engine.on('detect', ({ keyword, score }) => {
    if (!desiredActive) return
    console.info(`[status] ${keyword} detected (score ${score.toFixed(2)})`)
    void (async () => {
      await setActive(false)
      onDetected()
    })()
  })
  engine.on('error', onError)

  async function setActive(active) {
    desiredActive = active === true
    const currentGeneration = ++generation
    if (!desiredActive) {
      if (started) {
        started = false
        await engine.stop().catch(onError)
      }
      return
    }

    try {
      loadPromise ??= engine.load()
      await loadPromise
      if (currentGeneration !== generation || !desiredActive) return
      await engine.start()
      started = true
      if (currentGeneration !== generation || !desiredActive) {
        started = false
        await engine.stop()
        return
      }
      console.info('[status] hey_jarvis wake-word listener active')
      if (!reportedReady) {
        reportedReady = true
        onReady?.()
      }
    } catch (error) {
      if (currentGeneration === generation && desiredActive) {
        desiredActive = false
        onError(error)
      }
    }
  }

  return { setActive }
}