import * as THREE from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import modelUrl from '../../asset/tesseract_prism/scene.gltf?url'
import bufferUrl from '../../asset/tesseract_prism/scene.bin?url'

export async function mountPetModel(canvas, { showcase = false } = {}) {
  const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, powerPreference: 'low-power' })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
  renderer.setClearColor(0x000000, 0)
  renderer.outputColorSpace = THREE.SRGBColorSpace
  renderer.toneMapping = THREE.ACESFilmicToneMapping
  renderer.toneMappingExposure = 1.15

  const scene = new THREE.Scene()
  scene.add(new THREE.HemisphereLight(0xe9f5ff, 0x42495a, 2.2))
  const keyLight = new THREE.DirectionalLight(0xffffff, 3.2)
  keyLight.position.set(3, 5, 7)
  scene.add(keyLight)
  const fillLight = new THREE.DirectionalLight(0x84c9ff, 1.5)
  fillLight.position.set(-5, -2, -4)
  scene.add(fillLight)
  if (showcase) {
    const rimLight = new THREE.DirectionalLight(0xffc995, 5)
    rimLight.position.set(-3, 4, 5)
    scene.add(rimLight)
  }

  const camera = new THREE.PerspectiveCamera(34, 1, 0.1, 100)
  const manager = new THREE.LoadingManager()
  manager.setURLModifier((url) => (url === 'scene.bin' || /\/scene\.bin(?:[?#]|$)/i.test(url) ? bufferUrl : url))
  const gltf = await new GLTFLoader(manager).loadAsync(modelUrl)
  const model = gltf.scene
  if (showcase) {
    model.traverse((object) => {
      if (!object.isMesh) return
      object.material = Array.isArray(object.material)
        ? object.material.map((material) => material.clone())
        : object.material.clone()
      for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
        material.opacity = Math.max(material.opacity, 0.56)
        material.transparent = material.opacity < 1
        material.color?.lerp(new THREE.Color(0x8ce0bd), 0.32)
        material.emissive?.set(0x285544)
        material.emissiveIntensity = 0.8
        material.needsUpdate = true
      }
    })
  }
  const bounds = new THREE.Box3().setFromObject(model)
  const center = bounds.getCenter(new THREE.Vector3())
  const sphere = bounds.getBoundingSphere(new THREE.Sphere())
  model.position.sub(center)

  const tumble = new THREE.Group()
  tumble.add(model)
  scene.add(tumble)
  camera.position.set(0, 0, (sphere.radius / Math.sin(THREE.MathUtils.degToRad(camera.fov / 2))) * 1.2)
  camera.lookAt(0, 0, 0)

  const resize = () => {
    const layoutWidth = canvas.clientWidth
    const layoutHeight = canvas.clientHeight
    if (!layoutWidth || !layoutHeight) return
    renderer.setSize(layoutWidth, layoutHeight, false)
    camera.aspect = layoutWidth / layoutHeight
    camera.updateProjectionMatrix()
  }
  const resizeObserver = new ResizeObserver(resize)
  resizeObserver.observe(canvas)
  resize()
  const raycaster = new THREE.Raycaster()
  const pointer = new THREE.Vector2()

  let previous = performance.now()
  let pulsing = false
  let pulsePhase = 0
  let pulseCycle = -1
  let pulseAmplitude = 0.08
  let thinking = false
  let rotationMultiplier = 1
  let animationFrame
  const animate = (now) => {
    const delta = Math.min((now - previous) / 1000, 0.05)
    previous = now
    const targetMultiplier = thinking ? 8.23 : 1
    rotationMultiplier += (targetMultiplier - rotationMultiplier) * (1 - Math.exp(-delta * 8))
    tumble.rotation.x += delta * 0.29 * rotationMultiplier
    tumble.rotation.y += delta * 0.43 * rotationMultiplier
    tumble.rotation.z += delta * 0.17 * rotationMultiplier
    if (pulsing) {
      pulsePhase += delta * 14
      const cycle = Math.floor(pulsePhase / Math.PI)
      if (cycle !== pulseCycle) {
        pulseCycle = cycle
        const randomSeed = Math.random()
        pulseAmplitude = 0.06 + randomSeed * 0.04
      }
      tumble.scale.setScalar(1 + Math.abs(Math.sin(pulsePhase)) * pulseAmplitude)
    } else {
      pulsePhase = 0
      pulseCycle = -1
      tumble.scale.setScalar(1)
    }
    renderer.render(scene, camera)
    animationFrame = requestAnimationFrame(animate)
  }
  animationFrame = requestAnimationFrame(animate)

  return {
    setThinking(active) {
      thinking = active
      if (!active) rotationMultiplier = 1
    },
    setPulsing(active) {
      pulsing = active
    },
    hitTest(clientX, clientY) {
      const rect = canvas.getBoundingClientRect()
      if (!rect.width || !rect.height || clientX < rect.left || clientX > rect.right || clientY < rect.top || clientY > rect.bottom) return false
      pointer.x = ((clientX - rect.left) / rect.width) * 2 - 1
      pointer.y = -((clientY - rect.top) / rect.height) * 2 + 1
      raycaster.setFromCamera(pointer, camera)
      return raycaster.intersectObject(tumble, true).length > 0
    },
    dispose() {
      cancelAnimationFrame(animationFrame)
      resizeObserver.disconnect()
      renderer.dispose()
    }
  }
}