import * as THREE from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import modelUrl from '../../asset/tesseract_prism/scene.gltf?url'
import bufferUrl from '../../asset/tesseract_prism/scene.bin?url'

export async function mountPetModel(canvas) {
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

  const camera = new THREE.PerspectiveCamera(34, 1, 0.1, 100)
  const manager = new THREE.LoadingManager()
  manager.setURLModifier((url) => (url === 'scene.bin' || /\/scene\.bin(?:[?#]|$)/i.test(url) ? bufferUrl : url))
  const gltf = await new GLTFLoader(manager).loadAsync(modelUrl)
  const model = gltf.scene
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
    const { width, height } = canvas.getBoundingClientRect()
    if (!width || !height) return
    renderer.setSize(width, height, false)
    camera.aspect = width / height
    camera.updateProjectionMatrix()
  }
  const resizeObserver = new ResizeObserver(resize)
  resizeObserver.observe(canvas)
  resize()

  let previous = performance.now()
  let animationFrame
  const animate = (now) => {
    const delta = Math.min((now - previous) / 1000, 0.05)
    previous = now
    tumble.rotation.x += delta * 0.29
    tumble.rotation.y += delta * 0.43
    tumble.rotation.z += delta * 0.17
    renderer.render(scene, camera)
    animationFrame = requestAnimationFrame(animate)
  }
  animationFrame = requestAnimationFrame(animate)

  return () => {
    cancelAnimationFrame(animationFrame)
    resizeObserver.disconnect()
    renderer.dispose()
  }
}