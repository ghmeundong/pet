import { mountPetModel } from './pet-model'

mountPetModel(document.getElementById('pet-canvas'), { showcase: true }).then(() => {
  setTimeout(() => { window.iconRenderReady = true }, 700)
}).catch((error) => {
  console.error('[icon] 3D pet model failed to render:', error)
  window.iconRenderError = error.message
})