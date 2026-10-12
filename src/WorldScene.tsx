import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react'
import * as THREE from 'three'
import type { Project } from './worldData'

export type WorldControls = { fit: () => void; zoom: (direction: number) => void; focusProject: (id: string) => void }
type Props = { projects: Project[]; selectedId: string | null; onSelectSession: (id: string) => void; onFocusProject: (id: string) => void }
type Place = { point: THREE.Vector3; width: number }
type PersonRig = { body: THREE.Group; head: THREE.Group; leftArm: THREE.Group; rightArm: THREE.Group; ring: THREE.Mesh }
type Runtime = {
  camera: THREE.OrthographicCamera; target: THREE.Vector3; desiredTarget: THREE.Vector3
  desiredZoom: number; overviewZoom: number; buildings: Map<string, Place>
  seats: Map<string, THREE.Vector3>; rigs: Map<string, PersonRig>
}

const colors = {
  ground: 0x91a77d, grassLight: 0xa9b98d, grassDark: 0x7e9b72,
  stone: 0xcec6ac, stoneEdge: 0xa9a18a, path: 0xd9cbaa,
  wall: 0xe4d5ae, wallShade: 0xc8b78e, timber: 0x755441,
  wood: 0xa7734c, woodLight: 0xbe8c60, dark: 0x443b34,
}
const roofColors = [0x9e604e, 0x597e70, 0xb1854f, 0x7c708b, 0x667a65, 0xa3715a]
const clothColors = [0x678f85, 0xb07962, 0x7f88a5, 0xb59665, 0x82725e, 0x8b9f67]
const skinColors = [0xf0c99d, 0xc78f6a, 0x996348, 0x704536]
const hairColors = [0x392f2a, 0x694c35, 0x9c7250, 0x2c3030]
const mat = (color: number, extras: THREE.MeshLambertMaterialParameters = {}) => new THREE.MeshLambertMaterial({ color, ...extras })
const materials = {
  ground: mat(colors.ground), grassLight: mat(colors.grassLight), grassDark: mat(colors.grassDark),
  stone: mat(colors.stone), stoneEdge: mat(colors.stoneEdge), path: mat(colors.path),
  wall: mat(colors.wall), wallShade: mat(colors.wallShade), timber: mat(colors.timber),
  wood: mat(colors.wood), woodLight: mat(colors.woodLight), dark: mat(colors.dark),
  glass: mat(0xa6c8b3, { emissive: 0x779b81, emissiveIntensity: 0.12 }),
  leaf: mat(0x62835c), leafLight: mat(0x86a46d), trunk: mat(0x6c533d),
  flower: [mat(0xe8c477), mat(0xf3e0cb), mat(0xc98f80)],
  roof: roofColors.map((color) => mat(color)),
  cloth: clothColors.map((color) => mat(color)),
  skin: skinColors.map((color) => mat(color)),
  hair: hairColors.map((color) => mat(color)),
  lamp: mat(0xf3cf83, { emissive: 0xf4bd6d, emissiveIntensity: 0.75 }),
  parchment: mat(0xeee1c1),
}
const ringMaterial = new THREE.MeshBasicMaterial({ color: 0xffdc86, side: THREE.DoubleSide, transparent: true, opacity: 0.9 })

function box(parent: THREE.Object3D, w: number, h: number, d: number, material: THREE.Material, x: number, y: number, z: number): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material)
  mesh.position.set(x, y, z)
  mesh.castShadow = h > 0.18
  mesh.receiveShadow = true
  parent.add(mesh)
  return mesh
}

function hash(value: string): number {
  let result = 2166136261
  for (const letter of value) result = Math.imul(result ^ letter.charCodeAt(0), 16777619)
  return result >>> 0
}

function addTree(parent: THREE.Object3D, x: number, z: number, size = 1): void {
  const tree = new THREE.Group()
  tree.position.set(x, 0, z)
  tree.scale.setScalar(size)
  parent.add(tree)
  box(tree, 0.48, 1.75, 0.48, materials.trunk, 0, 0.88, 0)
  box(tree, 1.8, 1.05, 1.65, materials.leaf, 0, 2.14, 0)
  box(tree, 1.36, 0.84, 1.4, materials.leafLight, -0.14, 2.83, -0.08)
  box(tree, 0.95, 0.55, 1.05, materials.leaf, 0.16, 3.36, 0.05)
}

function addLamp(parent: THREE.Object3D, x: number, z: number): void {
  box(parent, 0.32, 0.35, 0.32, materials.stoneEdge, x, 0.18, z)
  box(parent, 0.14, 2.15, 0.14, materials.timber, x, 1.38, z)
  box(parent, 0.62, 0.14, 0.62, materials.dark, x, 2.46, z)
  box(parent, 0.42, 0.4, 0.42, materials.lamp, x, 2.73, z)
  box(parent, 0.72, 0.16, 0.72, materials.dark, x, 3.0, z)
}

function addPerson(parent: THREE.Group, id: string, x: number, z: number, faceBack: boolean): PersonRig {
  const seed = hash(id)
  const cloth = materials.cloth[seed % materials.cloth.length]
  const skin = materials.skin[(seed >>> 5) % materials.skin.length]
  const hair = materials.hair[(seed >>> 9) % materials.hair.length]
  const person = new THREE.Group()
  person.position.set(x, 0, z)
  person.rotation.y = faceBack ? Math.PI : 0
  person.userData.sessionId = id
  parent.add(person)
  box(person, 0.67, 0.13, 0.58, materials.wood, 0, 0.52, -0.12)
  box(person, 0.7, 0.77, 0.12, materials.wood, 0, 0.83, -0.48)
  for (const leg of [-0.24, 0.24]) box(person, 0.1, 0.45, 0.1, materials.timber, leg, 0.23, -0.13)
  const body = new THREE.Group()
  person.add(body)
  box(body, 0.6, 0.64, 0.42, cloth, 0, 0.99, -0.04)
  box(body, 0.36, 0.56, 0.025, materials.wallShade, 0, 0.97, 0.19)
  box(body, 0.38, 0.11, 0.05, materials.woodLight, 0, 0.7, 0.21)
  const head = new THREE.Group()
  head.position.set(0, 1.39, 0)
  body.add(head)
  box(head, 0.48, 0.47, 0.45, skin, 0, 0.18, 0)
  box(head, 0.53, 0.17, 0.49, hair, 0, 0.47, -0.01)
  if (seed % 3 === 0) box(head, 0.59, 0.055, 0.56, hair, 0, 0.4, 0)
  if (seed % 4 === 0) box(head, 0.2, 0.09, 0.05, hair, -0.12, 0.39, 0.25)
  box(head, 0.035, 0.04, 0.02, materials.dark, -0.12, 0.22, 0.234)
  box(head, 0.035, 0.04, 0.02, materials.dark, 0.12, 0.22, 0.234)
  const leftArm = new THREE.Group()
  const rightArm = new THREE.Group()
  leftArm.position.set(-0.38, 1.24, 0.02)
  rightArm.position.set(0.38, 1.24, 0.02)
  for (const [arm, side] of [[leftArm, -1], [rightArm, 1]] as const) {
    box(arm, 0.18, 0.47, 0.2, cloth, 0, -0.21, 0.1)
    box(arm, 0.17, 0.13, 0.18, skin, 0, -0.49, 0.13)
    arm.rotation.z = side * 0.12
    body.add(arm)
  }
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.43, 0.52, 32), ringMaterial)
  ring.rotation.x = -Math.PI / 2
  ring.position.y = 0.035
  ring.visible = false
  person.add(ring)
  return { body, head, leftArm, rightArm, ring }
}

function addBuilding(scene: THREE.Scene, project: Project, index: number, x: number, z: number, seats: Map<string, THREE.Vector3>, rigs: Map<string, PersonRig>): Place {
  const group = new THREE.Group()
  group.position.set(x, 0, z)
  scene.add(group)
  const seatColumns = Math.max(2, Math.ceil(project.sessions.length / 2))
  const width = Math.max(9.4, seatColumns * 1.34 + 3.5)
  const depth = 7.5
  const roof = materials.roof[index % materials.roof.length]
  box(group, width + 0.9, 0.38, depth + 1, materials.stoneEdge, 0, 0.12, 0)
  box(group, width + 0.45, 0.16, depth + 0.58, materials.stone, 0, 0.39, 0)
  box(group, width, 3.8, 0.38, materials.wall, 0, 2.34, -depth / 2 + 0.18)
  box(group, 0.34, 3.25, depth - 0.2, materials.wall, -width / 2, 1.97, 0)
  box(group, 0.34, 2.05, depth - 0.2, materials.wallShade, width / 2, 1.36, 0)
  for (const beam of [-width / 2 + 0.34, 0, width / 2 - 0.34]) {
    box(group, 0.27, 3.85, 0.53, materials.timber, beam, 2.36, -depth / 2 + 0.38)
  }
  box(group, width + 0.6, 0.27, 0.57, materials.timber, 0, 4.28, -depth / 2 + 0.18)
  box(group, 0.3, 3.35, 0.35, materials.timber, -width / 2 + 0.13, 2.13, depth / 2 - 0.16)
  box(group, 0.3, 2.16, 0.35, materials.timber, width / 2 - 0.13, 1.52, depth / 2 - 0.16)
  box(group, width + 0.95, 0.28, 2.75, roof, 0, 4.5, -depth / 2 + 0.55)
  box(group, width + 0.6, 0.18, 2.55, materials.timber, 0, 4.25, -depth / 2 + 0.65)
  box(group, 1.2, 0.84, 0.08, materials.timber, -width * 0.23, 2.72, -depth / 2 + 0.46)
  box(group, 0.94, 0.57, 0.09, materials.glass, -width * 0.23, 2.72, -depth / 2 + 0.52)
  box(group, 1.2, 0.84, 0.08, materials.timber, width * 0.23, 2.72, -depth / 2 + 0.46)
  box(group, 0.94, 0.57, 0.09, materials.glass, width * 0.23, 2.72, -depth / 2 + 0.52)
  box(group, 1.6, 0.35, 0.7, materials.stone, 0, 0.21, depth / 2 + 0.66)
  box(group, 1.92, 0.22, 0.9, materials.stoneEdge, 0, 0.11, depth / 2 + 1.05)

  const tableLength = Math.max(4.15, seatColumns * 1.31 + 0.75)
  box(group, tableLength, 0.22, 2.18, materials.woodLight, 0, 1.1, 0.17)
  box(group, tableLength, 0.23, 0.14, materials.wood, 0, 0.93, 1.23)
  for (const xLeg of [-tableLength / 2 + 0.22, tableLength / 2 - 0.22]) {
    for (const zLeg of [-0.68, 0.95]) box(group, 0.18, 0.83, 0.18, materials.timber, xLeg, 0.65, zLeg)
  }
  for (let paper = 0; paper < Math.min(3, seatColumns); paper++) {
    const xPaper = (paper - (Math.min(3, seatColumns) - 1) / 2) * 1.48
    box(group, 0.43, 0.018, 0.37, materials.parchment, xPaper, 1.225, 0.15)
  }
  project.sessions.forEach((session, seatIndex) => {
    const back = seatIndex % 2 === 0
    const column = Math.floor(seatIndex / 2)
    const seatX = (column - (seatColumns - 1) / 2) * 1.31
    const seatZ = back ? -1.59 : 1.95
    const rig = addPerson(group, session.id, seatX, seatZ, !back)
    rigs.set(session.id, rig)
    seats.set(session.id, new THREE.Vector3(x + seatX, 3 - (seatIndex % 3) * 0.65, z + seatZ))
  })
  const shelfX = width / 2 - 0.75
  box(group, 0.78, 1.4, 0.4, materials.timber, shelfX, 1.2, -depth / 2 + 0.68)
  for (let item = 0; item < 3; item++) box(group, 0.12, 0.4 + item * 0.06, 0.22, materials.cloth[(index + item) % materials.cloth.length], shelfX - 0.2 + item * 0.2, 1.16, -depth / 2 + 0.92)
  box(group, 0.67, 0.51, 0.68, materials.wood, -width / 2 + 0.78, 0.66, depth / 2 - 0.86)
  box(group, 0.77, 0.12, 0.77, roof, -width / 2 + 0.78, 0.94, depth / 2 - 0.86)
  return { point: new THREE.Vector3(x, 4.85, z - depth / 2), width }
}

function addVillage(scene: THREE.Scene, projects: Project[], seats: Map<string, THREE.Vector3>, rigs: Map<string, PersonRig>, buildings: Map<string, Place>): { size: number } {
  const maxWidth = Math.max(9.4, ...projects.map((project) => Math.max(9.4, Math.ceil(project.sessions.length / 2) * 1.34 + 3.5)))
  const count = Math.max(4, projects.length)
  const ringCount = Math.max(4, Math.min(8, count))
  const ringRadius = Math.max(15.5, maxWidth * 1.08 + 5)
  const outerRadius = ringRadius + (count > 8 ? Math.ceil((count - 8) / 10) * (maxWidth + 8) : 0)
  const size = outerRadius * 2 + maxWidth + 17
  box(scene, size, 0.7, size, materials.ground, 0, -0.42, 0)
  box(scene, 13, 0.14, 13, materials.stoneEdge, 0, -0.01, 0)
  box(scene, 11.8, 0.11, 11.8, materials.stone, 0, 0.13, 0)
  const plaza = new THREE.Group()
  scene.add(plaza)
  box(plaza, 3.8, 0.4, 3.8, materials.stoneEdge, 0, 0.44, 0)
  box(plaza, 3.16, 0.26, 3.16, materials.stone, 0, 0.77, 0)
  box(plaza, 2.3, 0.16, 2.3, materials.glass, 0, 0.95, 0)
  box(plaza, 0.52, 1.42, 0.52, materials.stoneEdge, 0, 1.6, 0)
  box(plaza, 1.32, 0.19, 1.32, materials.stone, 0, 2.32, 0)
  box(plaza, 0.25, 0.65, 0.25, materials.glass, 0, 2.72, 0)
  for (const [x, z] of [[-5.25, -5.25], [5.25, -5.25], [-5.25, 5.25], [5.25, 5.25]]) addLamp(scene, x, z)
  const positions: Array<[number, number]> = []
  projects.forEach((project, index) => {
    const ring = index < 8 ? 0 : Math.floor((index - 8) / 10) + 1
    const inRing = ring === 0 ? Math.min(projects.length, 8) : Math.min(10, projects.length - 8 - (ring - 1) * 10)
    const slot = ring === 0 ? index : (index - 8) % 10
    const angle = -Math.PI * 0.72 + (slot / Math.max(inRing, ringCount)) * Math.PI * 2
    const radius = ringRadius + ring * (maxWidth + 8)
    const x = Math.sin(angle) * radius
    const z = Math.cos(angle) * radius
    positions.push([x, z])
    const steps = Math.max(3, Math.round(radius / 2.1))
    for (let step = 0; step < steps; step++) {
      const t = (step + 0.5) / steps
      const tile = box(scene, 1.9 + (step % 3) * 0.16, 0.07, 1.58, materials.path, x * t, 0.012, z * t)
      tile.rotation.y = -angle
    }
    const place = addBuilding(scene, project, index, x, z, seats, rigs)
    buildings.set(project.id, place)
    addTree(scene, x - place.width / 2 - 1.95, z - 2.35, 0.82)
    addTree(scene, x + place.width / 2 + 2.1, z + 1.0, 0.68)
    addLamp(scene, x - place.width / 2 - 0.72, z + 4.6)
  })
  const seeded = (index: number) => { const n = Math.sin(index * 72.13 + 3.2) * 43758.5453; return n - Math.floor(n) }
  for (let index = 0; index < Math.min(160, Math.round(size * 2.1)); index++) {
    const x = (seeded(index * 2) - 0.5) * (size - 5)
    const z = (seeded(index * 2 + 1) - 0.5) * (size - 5)
    if (Math.abs(x) < 8 && Math.abs(z) < 8) continue
    if (positions.some(([bx, bz]) => Math.abs(x - bx) < maxWidth / 2 + 2 && Math.abs(z - bz) < 6)) continue
    if (seeded(index + 333) > 0.95) addTree(scene, x, z, 0.55 + seeded(index + 101) * 0.35)
    else {
      const flower = materials.flower[index % materials.flower.length]
      box(scene, 0.13, 0.13, 0.13, flower, x, 0.03, z)
      box(scene, 0.23, 0.06, 0.12, index % 2 ? materials.grassLight : materials.grassDark, x + 0.24, 0.005, z)
    }
  }
  return { size }
}

const cameraOffset = new THREE.Vector3(29, 34, 43)

const WorldScene = forwardRef<WorldControls, Props>(function WorldScene({ projects, selectedId, onSelectSession, onFocusProject }, ref) {
  const hostRef = useRef<HTMLDivElement>(null)
  const runtimeRef = useRef<Runtime | null>(null)
  const selectedRef = useRef(selectedId)
  selectedRef.current = selectedId
  const callbacksRef = useRef({ onSelectSession, onFocusProject })
  callbacksRef.current = { onSelectSession, onFocusProject }
  const [unavailable, setUnavailable] = useState(false)
  const signature = projects.map((project) => `${project.id}:${project.sessions.map((session) => session.id).join(',')}`).join('|')

  useImperativeHandle(ref, () => ({
    fit() { const runtime = runtimeRef.current; if (runtime) { runtime.desiredTarget.set(0, 0, 0); runtime.desiredZoom = runtime.overviewZoom } },
    zoom(direction) { const runtime = runtimeRef.current; if (runtime) runtime.desiredZoom = THREE.MathUtils.clamp(runtime.desiredZoom * (direction > 0 ? 1.26 : 1 / 1.26), runtime.overviewZoom * 0.75, 4.2) },
    focusProject(id) { const runtime = runtimeRef.current; const place = runtime?.buildings.get(id); if (runtime && place) { runtime.desiredTarget.set(place.point.x, 0.5, place.point.z + 2.4); runtime.desiredZoom = Math.max(runtime.overviewZoom * 1.65, Math.min(2.1, 18 / place.width)) } },
  }), [])

  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    const scene = new THREE.Scene()
    scene.background = new THREE.Color(0xd7ddc7)
    scene.fog = new THREE.Fog(0xd7ddc7, 62, 160)
    const camera = new THREE.OrthographicCamera(-20, 20, 20, -20, 0.1, 400)
    let renderer: THREE.WebGLRenderer
    try { renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' }) }
    catch { setUnavailable(true); return }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
    renderer.shadowMap.enabled = true
    renderer.shadowMap.type = THREE.PCFShadowMap
    renderer.outputColorSpace = THREE.SRGBColorSpace
    renderer.toneMapping = THREE.ACESFilmicToneMapping
    renderer.toneMappingExposure = 1.8
    renderer.domElement.className = 'world-canvas'
    host.prepend(renderer.domElement)
    scene.add(new THREE.AmbientLight(0xffefdb, 2.25))
    const sun = new THREE.DirectionalLight(0xffe8c3, 3)
    sun.position.set(-20, 37, 27)
    sun.castShadow = true
    sun.shadow.mapSize.set(2048, 2048)
    sun.shadow.camera.left = -95; sun.shadow.camera.right = 95
    sun.shadow.camera.top = 95; sun.shadow.camera.bottom = -95
    sun.shadow.normalBias = 0.018
    scene.add(sun)
    const buildings = new Map<string, Place>()
    const seats = new Map<string, THREE.Vector3>()
    const rigs = new Map<string, PersonRig>()
    const { size } = addVillage(scene, projects, seats, rigs, buildings)
    const target = new THREE.Vector3()
    const runtime: Runtime = { camera, target, desiredTarget: target.clone(), desiredZoom: 1, overviewZoom: 1, buildings, seats, rigs }
    runtimeRef.current = runtime
    camera.position.copy(cameraOffset)
    camera.lookAt(target)
    const raycaster = new THREE.Raycaster()
    const pointer = new THREE.Vector2()
    const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0)
    const aim = (clientX: number, clientY: number) => {
      const bounds = renderer.domElement.getBoundingClientRect()
      pointer.set((clientX - bounds.left) / bounds.width * 2 - 1, -((clientY - bounds.top) / bounds.height * 2 - 1))
      raycaster.setFromCamera(pointer, camera)
    }
    const groundAt = (clientX: number, clientY: number) => { aim(clientX, clientY); return raycaster.ray.intersectPlane(groundPlane, new THREE.Vector3()) }
    const hitSession = (clientX: number, clientY: number): string | null => {
      aim(clientX, clientY)
      for (const hit of raycaster.intersectObjects(scene.children, true)) {
        let object: THREE.Object3D | null = hit.object
        while (object) { if (object.userData.sessionId) return String(object.userData.sessionId); object = object.parent }
      }
      return null
    }
    let drag: { id: number; x: number; y: number; startX: number; startY: number; moved: boolean } | null = null
    const down = (event: PointerEvent) => {
      if (event.button !== 0) return
      drag = { id: event.pointerId, x: event.clientX, y: event.clientY, startX: event.clientX, startY: event.clientY, moved: false }
      renderer.domElement.setPointerCapture(event.pointerId)
      renderer.domElement.style.cursor = 'grabbing'
    }
    const move = (event: PointerEvent) => {
      if (!drag || drag.id !== event.pointerId) { renderer.domElement.style.cursor = hitSession(event.clientX, event.clientY) ? 'pointer' : 'grab'; return }
      if (Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) > 4) drag.moved = true
      if (drag.moved) {
        const previous = groundAt(drag.x, drag.y)
        const current = groundAt(event.clientX, event.clientY)
        if (previous && current) runtime.desiredTarget.add(previous.sub(current))
      }
      drag.x = event.clientX; drag.y = event.clientY
    }
    const up = (event: PointerEvent) => {
      if (!drag || drag.id !== event.pointerId) return
      const moved = drag.moved
      drag = null
      renderer.domElement.style.cursor = 'grab'
      if (!moved) { const id = hitSession(event.clientX, event.clientY); if (id) callbacksRef.current.onSelectSession(id) }
    }
    const wheel = (event: WheelEvent) => {
      event.preventDefault()
      const before = groundAt(event.clientX, event.clientY)
      runtime.desiredZoom = THREE.MathUtils.clamp(runtime.desiredZoom * Math.exp(-event.deltaY * 0.001), runtime.overviewZoom * 0.75, 4.2)
      camera.zoom = runtime.desiredZoom
      camera.updateProjectionMatrix()
      const after = groundAt(event.clientX, event.clientY)
      if (before && after) runtime.desiredTarget.add(before.sub(after))
    }
    renderer.domElement.addEventListener('pointerdown', down)
    renderer.domElement.addEventListener('pointermove', move)
    renderer.domElement.addEventListener('pointerup', up)
    renderer.domElement.addEventListener('pointercancel', up)
    renderer.domElement.addEventListener('wheel', wheel, { passive: false })
    let firstSize = true
    const resize = () => {
      const width = host.clientWidth, height = host.clientHeight
      if (!width || !height) return
      renderer.setSize(width, height, false)
      const aspect = width / height
      camera.left = -20 * aspect; camera.right = 20 * aspect
      camera.top = 20; camera.bottom = -20
      const previousOverview = runtime.overviewZoom
      runtime.overviewZoom = Math.min(1.22, 36 / size, 37 * aspect / size)
      if (runtime.desiredZoom < runtime.overviewZoom * 0.75) runtime.desiredZoom = runtime.overviewZoom
      if (firstSize || Math.abs(runtime.desiredZoom - previousOverview) < 0.001) runtime.desiredZoom = runtime.overviewZoom
      if (firstSize) { camera.zoom = runtime.overviewZoom; firstSize = false }
      camera.updateProjectionMatrix()
    }
    const observer = new ResizeObserver(resize)
    observer.observe(host)
    resize()
    const labelPoint = new THREE.Vector3()
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)')
    let frame = 0
    const render = () => {
      frame = requestAnimationFrame(render)
      runtime.target.lerp(runtime.desiredTarget, reducedMotion.matches ? 1 : 0.095)
      camera.position.copy(runtime.target).add(cameraOffset)
      camera.lookAt(runtime.target)
      camera.zoom += (runtime.desiredZoom - camera.zoom) * (reducedMotion.matches ? 1 : 0.1)
      camera.updateProjectionMatrix()
      const t = performance.now() / 1000
      rigs.forEach((rig, id) => {
        if (!reducedMotion.matches) {
          const phase = hash(id) % 100
          rig.body.position.y = Math.sin(t * 1.45 + phase) * 0.013
          rig.head.rotation.z = Math.sin(t * 0.85 + phase) * 0.025
          rig.leftArm.rotation.x = Math.sin(t * 1.7 + phase) * 0.035
          rig.rightArm.rotation.x = Math.sin(t * 1.7 + phase + 1) * 0.035
        }
      })
      const visibleLabels: { label: HTMLElement; kind: string; x: number; y: number }[] = []
      for (const label of host.querySelectorAll<HTMLElement>('[data-world-label]')) {
        const kind = label.dataset.worldLabel
        const id = label.dataset.worldId || ''
        const anchor = kind === 'project' ? buildings.get(id)?.point : seats.get(id)
        if (!anchor) continue
        labelPoint.copy(anchor).project(camera)
        const onScreen = labelPoint.z < 1 && labelPoint.x > -1.12 && labelPoint.x < 1.12 && labelPoint.y > -1.12 && labelPoint.y < 1.12
        const showSession = kind === 'project' || camera.zoom > runtime.overviewZoom * 1.55 || id === selectedRef.current
        label.style.visibility = onScreen && showSession ? 'visible' : 'hidden'
        if (onScreen && showSession) visibleLabels.push({ label, kind: kind || '', x: (labelPoint.x + 1) * host.clientWidth / 2, y: (1 - labelPoint.y) * host.clientHeight / 2 })
      }
      const occupied: { left: number; right: number; top: number; bottom: number }[] = []
      for (const item of visibleLabels.sort((a, b) => (a.kind === 'project' ? -1 : 1) - (b.kind === 'project' ? -1 : 1))) {
        const width = item.label.offsetWidth
        const height = item.label.offsetHeight
        const offsets = item.kind === 'project' ? [0] : [0, -25, 25, -50, 50, -75, 75]
        let top = item.y
        for (const offset of offsets) {
          const candidate = item.y + offset
          const bounds = { left: item.x - width / 2 - 3, right: item.x + width / 2 + 3, top: candidate - height - 3, bottom: candidate + 3 }
          if (candidate > height + 6 && candidate < host.clientHeight - 6 && !occupied.some((other) => bounds.left < other.right && bounds.right > other.left && bounds.top < other.bottom && bounds.bottom > other.top)) {
            top = candidate
            break
          }
        }
        item.label.style.left = `${item.x}px`
        item.label.style.top = `${top}px`
        occupied.push({ left: item.x - width / 2 - 3, right: item.x + width / 2 + 3, top: top - height - 3, bottom: top + 3 })
      }
      renderer.render(scene, camera)
    }
    render()
    return () => {
      cancelAnimationFrame(frame)
      observer.disconnect()
      renderer.domElement.removeEventListener('pointerdown', down)
      renderer.domElement.removeEventListener('pointermove', move)
      renderer.domElement.removeEventListener('pointerup', up)
      renderer.domElement.removeEventListener('pointercancel', up)
      renderer.domElement.removeEventListener('wheel', wheel)
      scene.traverse((object) => { if (object instanceof THREE.Mesh) object.geometry.dispose() })
      renderer.dispose()
      renderer.domElement.remove()
      runtimeRef.current = null
    }
  }, [signature])

  useEffect(() => { runtimeRef.current?.rigs.forEach((rig, id) => { rig.ring.visible = id === selectedId }) }, [selectedId, signature])

  return <div className="world-host" ref={hostRef} aria-label="Interactive village map">
    {unavailable && <div className="world-unavailable">This browser cannot start the 3D village. Try enabling WebGL.</div>}
    <div className="world-label-layer">
      {projects.map((project) => <button className="building-label" key={project.id} data-world-label="project" data-world-id={project.id} onClick={() => callbacksRef.current.onFocusProject(project.id)} type="button">
        <span className="building-label-kind">{project.kind}</span><strong>{project.name}</strong><small>{project.sessions.length} {project.sessions.length === 1 ? 'session' : 'sessions'}</small>
      </button>)}
      {projects.flatMap((project) => project.sessions.map((session) => <button className={`session-label ${selectedId === session.id ? 'is-selected' : ''}`} key={session.id} data-world-label="session" data-world-id={session.id} onClick={() => callbacksRef.current.onSelectSession(session.id)} type="button" title={session.name}>
        <span className={`session-status ${session.status}`} />{session.name}
      </button>))}
    </div>
  </div>
})

export default WorldScene
