const { copyFile, mkdir, readFile, rename, rm, stat } = require('fs/promises')
const { randomUUID } = require('crypto')
const os = require('os')
const path = require('path')

const projectRoot = path.resolve(__dirname, '..')
const modelRoot = process.env.OLLAMA_MODELS || path.join(os.homedir(), '.ollama', 'models')
const manifestPath = path.join(modelRoot, 'manifests', 'registry.ollama.ai', 'library', 'qwen2.5', '3b')
const licenseDirectory = path.join(projectRoot, 'build', 'model-licenses')

async function main() {
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
  const licenseLayer = manifest.layers.find((layer) => layer.mediaType === 'application/vnd.ollama.image.license')
  if (!licenseLayer) throw new Error('The Qwen2.5 3B model license layer was not found.')
  const licenseSource = path.join(modelRoot, 'blobs', licenseLayer.digest.replace(':', '-'))
  await stat(licenseSource)
  await mkdir(licenseDirectory, { recursive: true })
  const licenseDestination = path.join(licenseDirectory, 'Qwen-Research-License.txt')
  const sourceContents = await readFile(licenseSource)
  try {
    const existingContents = await readFile(licenseDestination)
    if (sourceContents.equals(existingContents)) {
      console.info('Qwen license is already prepared; no file replacement needed.')
      return
    }
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
  }

  const temporaryDestination = `${licenseDestination}.${randomUUID()}.tmp`
  try {
    await copyFile(licenseSource, temporaryDestination)
    try {
      await rename(temporaryDestination, licenseDestination)
    } catch (error) {
      if (error.code !== 'EEXIST' && error.code !== 'EPERM') throw error
      await rm(licenseDestination, { force: true })
      await rename(temporaryDestination, licenseDestination)
    }
  } finally {
    await rm(temporaryDestination, { force: true }).catch(() => {})
  }
  console.info('Prepared the Qwen license for the installer acceptance page.')
}

main().catch((error) => {
  console.error('[model-license] preparation failed:', error.message)
  process.exitCode = 1
})