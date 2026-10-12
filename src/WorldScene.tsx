import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react'
import * as THREE from 'three'
import type { Project } from './worldData'

export type WorldControls = { fit: () => void; zoom: (direction: number) => void; focusProject: (id: string) => void }
type Props = { projects: Project[]; selectedId: string | null; focusedId: string | null; onSelectSession: (id: string) => void; onFocusProject: (id: string) => void }
type Place = { point: THREE.Vector3; width: number }
type PersonRig = { body: THREE.Group; head: THREE.Group; leftArm: THREE.Group; rightArm: THREE.Group; ring: THREE.Mesh }
type Runtime = {
  camera: THREE.OrthographicCamera; target: THREE.Vector3; desiredTarget: THREE.Vector3
  desiredZoom: number; overviewZoom: number; buildings: Map<string, Place>
  seats: Map<string, THREE.Vector3>; rigs: Map<string, PersonRig>
}

const colors = {
  ground: 0x749361, grassLight: 0x91ae70, grassDark: 0x5f7f52,
  stone: 0xb6ad91, stoneEdge: 0x857c68, path: 0xa69578,
  wall: 0xd7c59b, wallShade: 0xb9a67f, timber: 0x674833,
  wood: 0x8e613d, woodLight: 0xad7c4c, dark: 0x382e29,
}
const roofColors = [0x8d5140, 0x756b4b, 0x9b6640, 0x636b57, 0x766342, 0x945f49]
const clothColors = [0x56756c, 0x985c49, 0x697791, 0xa58b53, 0x746151, 0x6f8651]
const skinColors = [0xf0c99d, 0xc78f6a, 0x996348, 0x704536]
const hairColors = [0x392f2a, 0x694c35, 0x9c7250, 0x2c3030]
const mat = (color: number, extras: THREE.MeshLambertMaterialParameters = {}) => new THREE.MeshLambertMaterial({ color, ...extras })
const materials = {
  ground: mat(colors.ground), grassLight: mat(colors.grassLight), grassDark: mat(colors.grassDark),
  stone: mat(colors.stone), stoneEdge: mat(colors.stoneEdge), path: mat(colors.path),
  cobble: [mat(0x9d9279), mat(0xb4aa8c), mat(0x827e6b), mat(0xc2b699)],
  soil: mat(0x6f5238), soilLight: mat(0x896849), crop: mat(0x77974b), cropLight: mat(0xa6aa53),
  wall: mat(colors.wall), wallShade: mat(colors.wallShade), timber: mat(colors.timber),
  wood: mat(colors.wood), woodLight: mat(colors.woodLight), dark: mat(colors.dark),
  glass: mat(0x8dada0, { emissive: 0x779b81, emissiveIntensity: 0.08 }),
  leaf: mat(0x4f7549), leafLight: mat(0x779451), trunk: mat(0x67482f),
  flower: [mat(0xe8c477), mat(0xf3e0cb), mat(0xc98f80)],
  roof: roofColors.map((color) => mat(color)),
  cloth: clothColors.map((color) => mat(color)),
  skin: skinColors.map((color) => mat(color)),
  hair: hairColors.map((color) => mat(color)),
  lamp: mat(0xf3cf83, { emissive: 0xf4bd6d, emissiveIntensity: 0.75 }),
  parchment: mat(0xeee1c1),
  outpostGround: mat(0x697b64), outpostGrass: mat(0x536953),
  outpostStone: mat(0x858884), outpostStoneDark: mat(0x575c5d),
  outpostWall: mat(0xabb2a5), outpostWallShade: mat(0x7f8981),
  outpostTimber: mat(0x393a3a), outpostWood: mat(0x5f5149),
  outpostWoodLight: mat(0x827268), outpostRoof: mat(0x414d53),
  outpostRoofTrim: mat(0x6f7c7c), outpostBanner: mat(0x2d3743),
  outpostAccent: mat(0xb5775c), outpostCloth: [mat(0x4b5a62), mat(0x5c5c63), mat(0x4a5351), mat(0x675b59)],
  ember: mat(0xd89259, { emissive: 0xae552c, emissiveIntensity: 0.55 }),
  outpostSkin: [mat(0xa4a5a0), mat(0x868f8e), mat(0xb1a394), mat(0x768589)],
  riverBed: mat(0x455f60), river: mat(0x4d8794, { transparent: true, opacity: 0.94 }),
  riverLight: mat(0x86b6b6, { emissive: 0x385e5d, emissiveIntensity: 0.12 }),
  riverBank: mat(0xb5a98a), reed: mat(0x809663),
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
  box(tree, 0.52, 2.15, 0.52, materials.trunk, 0, 1.08, 0)
  box(tree, 1.72, 0.72, 1.72, materials.leaf, 0, 2.15, 0)
  box(tree, 2.35, 0.82, 2.15, materials.leafLight, 0, 2.82, 0)
  box(tree, 1.75, 0.7, 1.75, materials.leaf, 0, 3.51, 0)
  box(tree, 1.02, 0.52, 1.04, materials.leafLight, 0, 4.11, 0)
}

function addLamp(parent: THREE.Object3D, x: number, z: number): void {
  box(parent, 0.32, 0.35, 0.32, materials.stoneEdge, x, 0.18, z)
  box(parent, 0.14, 2.15, 0.14, materials.timber, x, 1.38, z)
  box(parent, 0.62, 0.14, 0.62, materials.dark, x, 2.46, z)
  box(parent, 0.42, 0.4, 0.42, materials.lamp, x, 2.73, z)
  box(parent, 0.72, 0.16, 0.72, materials.dark, x, 3.0, z)
}

function addGarden(parent: THREE.Object3D, x: number, z: number, seed: number): void {
  box(parent, 3.25, 0.18, 3.85, materials.wood, x, 0.12, z)
  box(parent, 2.92, 0.12, 3.52, materials.soil, x, 0.26, z)
  for (let row = 0; row < 4; row++) {
    for (let column = 0; column < 3; column++) {
      const cropX = x - 0.9 + column * 0.9
      const cropZ = z - 1.3 + row * 0.86
      box(parent, 0.16, 0.14, 0.16, materials.soilLight, cropX, 0.34, cropZ)
      const height = 0.34 + ((row + column + seed) % 3) * 0.13
      box(parent, 0.11, height, 0.11, materials.crop, cropX, 0.39 + height / 2, cropZ)
      box(parent, 0.29, 0.1, 0.17, materials.cropLight, cropX - 0.12, 0.55 + height * 0.3, cropZ)
      box(parent, 0.24, 0.1, 0.18, materials.crop, cropX + 0.12, 0.52 + height * 0.3, cropZ)
    }
  }
  for (const side of [-1, 1]) {
    for (const end of [-1, 1]) box(parent, 0.14, 0.63, 0.14, materials.timber, x + side * 1.6, 0.43, z + end * 1.9)
    box(parent, 0.1, 0.15, 3.8, materials.woodLight, x + side * 1.6, 0.62, z)
  }
}

function addPerson(parent: THREE.Group, id: string, x: number, z: number, faceBack: boolean, source: Project['source']): PersonRig {
  const seed = hash(id)
  const codex = source === 'codex'
  const cloth = codex ? materials.outpostCloth[seed % materials.outpostCloth.length] : materials.cloth[seed % materials.cloth.length]
  const skin = codex ? materials.outpostSkin[(seed >>> 5) % materials.outpostSkin.length] : materials.skin[(seed >>> 5) % materials.skin.length]
  const hair = codex ? materials.outpostTimber : materials.hair[(seed >>> 9) % materials.hair.length]
  const chair = codex ? materials.outpostWood : materials.wood
  const trim = codex ? materials.outpostStone : materials.wallShade
  const person = new THREE.Group()
  person.position.set(x, 0, z)
  person.rotation.y = faceBack ? Math.PI : 0
  person.userData.sessionId = id
  parent.add(person)
  box(person, 0.75, 0.16, 0.68, chair, 0, 0.52, -0.14)
  box(person, 0.78, 0.74, 0.15, codex ? materials.outpostTimber : materials.timber, 0, 0.88, -0.52)
  for (const leg of [-0.27, 0.27]) box(person, 0.13, 0.47, 0.14, codex ? materials.outpostTimber : materials.timber, leg, 0.23, -0.14)
  const body = new THREE.Group()
  person.add(body)
  box(body, 0.76, 0.72, 0.56, cloth, 0, 1.01, -0.02)
  box(body, 0.8, 0.19, 0.62, cloth, 0, 0.65, 0.0)
  box(body, 0.47, 0.59, 0.025, trim, 0, 1.01, 0.27)
  box(body, 0.52, 0.12, 0.07, codex ? materials.outpostTimber : materials.timber, 0, 0.75, 0.31)
  box(body, 0.13, 0.14, 0.08, codex ? materials.outpostAccent : materials.woodLight, 0, 0.75, 0.35)
  if (codex) {
    box(body, 0.15, 0.13, 0.04, materials.outpostAccent, 0, 1.26, 0.31)
    box(body, 0.31, 0.06, 0.04, materials.outpostTimber, 0, 1.06, 0.31)
  }
  const head = new THREE.Group()
  head.position.set(0, 1.42, 0)
  body.add(head)
  box(head, 0.66, 0.61, 0.59, skin, 0, 0.22, 0)
  box(head, 0.72, 0.14, 0.64, hair, 0, 0.54, -0.01)
  box(head, 0.68, 0.18, 0.16, hair, 0, 0.43, -0.31)
  if (codex) {
    box(head, 0.77, 0.19, 0.73, materials.outpostBanner, 0, 0.61, 0)
    box(head, 0.84, 0.085, 0.77, materials.outpostRoofTrim, 0, 0.52, 0.02)
    box(head, 0.08, 0.14, 0.2, materials.outpostAccent, 0, 0.68, 0.3)
  } else if (seed % 3 === 0) {
    box(head, 0.82, 0.08, 0.72, materials.woodLight, 0, 0.65, 0)
    box(head, 0.59, 0.24, 0.57, materials.wood, 0, 0.79, -0.02)
  } else if (seed % 3 === 1) {
    box(head, 0.17, 0.42, 0.12, hair, -0.29, 0.3, 0.2)
    box(head, 0.17, 0.42, 0.12, hair, 0.29, 0.3, 0.2)
  }
  // Angular noses, separate brows and varied headwear keep the villagers recognizable but original.
  box(head, 0.15, 0.24, 0.19, skin, 0, 0.20, 0.38)
  box(head, 0.13, 0.08, 0.07, skin, 0, 0.09, 0.47)
  for (const side of [-1, 1]) {
    box(head, codex ? 0.2 : 0.16, 0.055, 0.055, hair, side * 0.19, codex ? 0.4 : 0.39, 0.31)
    box(head, 0.065, 0.07, 0.028, materials.dark, side * 0.19, 0.28, 0.31)
    box(head, 0.11, 0.045, 0.045, trim, side * 0.35, 0.19, 0.04)
  }
  const leftArm = new THREE.Group()
  const rightArm = new THREE.Group()
  leftArm.position.set(-0.46, 1.28, 0.02)
  rightArm.position.set(0.46, 1.28, 0.02)
  for (const [arm, side] of [[leftArm, -1], [rightArm, 1]] as const) {
    box(arm, 0.23, 0.43, 0.27, cloth, 0, -0.16, 0.05)
    box(arm, 0.23, 0.15, 0.24, skin, 0, -0.43, 0.17)
    arm.rotation.z = side * 0.26
    arm.rotation.x = -0.28
    body.add(arm)
  }
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.43, 0.52, 32), ringMaterial)
  ring.rotation.x = -Math.PI / 2
  ring.position.y = 0.035
  ring.visible = false
  person.add(ring)
  return { body, head, leftArm, rightArm, ring }
}

function buildingMetrics(project: Project): { commons: boolean; seatColumns: number; tableRows: number; width: number; depth: number } {
  const commons = project.kind === 'Commons'
  const seatColumns = commons
    ? Math.max(2, Math.min(8, Math.ceil(project.sessions.length / 2)))
    : Math.max(2, Math.ceil(project.sessions.length / 2))
  const tableRows = commons ? Math.max(1, Math.ceil(project.sessions.length / (seatColumns * 2))) : 1
  return { commons, seatColumns, tableRows, width: Math.max(commons ? 13.2 : 9.4, seatColumns * 1.34 + 3.5),
    depth: commons ? Math.max(10.5, tableRows * 3.45 + 3.4) : 7.5 }
}

function addBuilding(scene: THREE.Scene, project: Project, index: number, x: number, z: number, seats: Map<string, THREE.Vector3>, rigs: Map<string, PersonRig>): Place {
  const group = new THREE.Group()
  group.position.set(x, 0, z)
  scene.add(group)
  const { commons, seatColumns, tableRows, width, depth } = buildingMetrics(project)
  const codex = project.source === 'codex'
  const stone = codex ? materials.outpostStone : materials.stone
  const stoneEdge = codex ? materials.outpostStoneDark : materials.stoneEdge
  const wall = codex ? materials.outpostWall : materials.wall
  const wallShade = codex ? materials.outpostWallShade : materials.wallShade
  const timber = codex ? materials.outpostTimber : materials.timber
  const wood = codex ? materials.outpostWood : materials.wood
  const woodLight = codex ? materials.outpostWoodLight : materials.woodLight
  const roof = codex ? materials.outpostRoof : materials.roof[commons ? 0 : index % materials.roof.length]
  const roofTrim = codex ? materials.outpostRoofTrim : timber
  const cobble = (variant: number) => codex ? (variant % 2 ? stone : stoneEdge) : materials.cobble[variant % 4]
  // A front cutaway reveals the communal table; the stepped gable remains a cottage silhouette.
  box(group, width + 1.1, 0.37, depth + 1.1, stoneEdge, 0, 0.13, 0)
  box(group, width + 0.5, 0.18, depth + 0.6, wood, 0, 0.4, 0)
  for (let plank = 0; plank < Math.floor(depth / 1.03); plank++) {
    const plankZ = -depth / 2 + 0.55 + plank * 1.03
    box(group, width - 0.42, 0.025, 0.045, plank % 2 ? timber : woodLight, 0, 0.505, plankZ).castShadow = false
  }
  for (let row = 0; row < 2; row++) {
    for (let column = 0; column < Math.ceil(width / 1.1); column++) {
      const blockX = -width / 2 + 0.57 + column * 1.08
      box(group, 1.02, 0.48, 0.43, cobble(column + row + index), blockX, 0.79 + row * 0.49, -depth / 2 + 0.1)
    }
  }
  box(group, width, 2.45, 0.35, wall, 0, 2.5, -depth / 2 + 0.19)
  box(group, width, 0.33, 0.49, timber, 0, 3.84, -depth / 2 + 0.23)
  for (const side of [-1, 1]) {
    const edge = side * (width / 2 - 0.12)
    box(group, 0.42, 3.36, depth - 0.3, wall, edge, 2.16, 0)
    box(group, 0.55, 1.13, depth - 0.25, stone, edge, 0.99, 0)
    for (const beamZ of [-depth / 2 + 0.3, 0, depth / 2 - 0.25]) {
      box(group, 0.28, 3.9, 0.33, timber, edge, 2.39, beamZ)
    }
    box(group, 0.29, 0.27, depth - 0.3, timber, edge, 3.6, 0)
    box(group, 0.68, 0.48, 0.72, cobble(index + side + 1), edge, 0.5, depth / 2 - 0.25)
    const frontX = side * (width / 2 - 1.08)
    box(group, 2.04, 0.78, 0.3, cobble(index + side + 3), frontX, 0.9, depth / 2 - 0.13)
    box(group, 2.04, 1.03, 0.3, wall, frontX, 1.8, depth / 2 - 0.13)
    box(group, 2.13, 0.19, 0.38, timber, frontX, 2.43, depth / 2 - 0.13)
  }
  box(group, width + 0.45, 0.25, 0.43, timber, 0, 4.04, depth / 2 - 0.18)
  for (const beamX of [-width / 2 + 0.28, 0, width / 2 - 0.28]) {
    box(group, 0.28, 3.75, 0.46, timber, beamX, 2.26, -depth / 2 + 0.37)
  }
  // Roof courses rise in block-sized steps toward the ridge. Only the rear half is roofed.
  const roofDepth = 3.45
  const roofZ = -depth / 2 + roofDepth / 2 - 0.3
  const courseWidth = (width + 1.25) / 8
  for (let course = 0; course < 4; course++) {
    const offset = width / 2 + 0.42 - (course + 0.5) * courseWidth
    const elevation = 4.12 + course * 0.39
    for (const side of [-1, 1]) {
      const strip = box(group, courseWidth + 0.06, 0.34, roofDepth, roof, side * offset, elevation, roofZ)
      strip.castShadow = false
      for (let tile = 0; tile < 3; tile++) {
        box(group, courseWidth - 0.12, 0.035, 0.055, roofTrim, side * offset, elevation + 0.19, roofZ - roofDepth / 2 + 0.55 + tile * 1.05).castShadow = false
      }
    }
    box(group, width - course * courseWidth * 2, 0.34, 0.4, wallShade, 0, 4.11 + course * 0.39, -depth / 2 + 0.2)
  }
  box(group, 0.52, 0.37, roofDepth + 0.2, roofTrim, 0, 5.54, roofZ)
  if (index % 2 === 0 && !codex) {
    box(group, 0.9, 1.5, 0.91, stoneEdge, width * 0.29, 5.38, -depth / 2 + 0.65)
    box(group, 1.12, 0.18, 1.12, cobble(index), width * 0.29, 6.15, -depth / 2 + 0.65)
  }
  for (const windowX of [-width * 0.26, width * 0.26]) {
    box(group, 1.22, 0.93, 0.09, timber, windowX, 2.6, -depth / 2 + 0.42)
    box(group, 0.98, 0.68, 0.1, materials.glass, windowX, 2.6, -depth / 2 + 0.49)
    box(group, 0.1, 0.73, 0.11, timber, windowX, 2.6, -depth / 2 + 0.55)
    box(group, 1.42, 0.13, 0.28, woodLight, windowX, 2.08, -depth / 2 + 0.55)
  }
  box(group, 2.25, 0.25, 0.64, stone, 0, 0.25, depth / 2 + 0.65)
  box(group, 1.85, 0.17, 0.73, cobble(index), 0, 0.16, depth / 2 + 1.02)

  const tableLength = Math.max(commons ? 7.3 : 4.15, seatColumns * 1.31 + 0.75)
  for (let row = 0; row < tableRows; row++) {
    const tableZ = (row - (tableRows - 1) / 2) * 3.45 + 0.17
    box(group, tableLength, 0.27, 2.18, woodLight, 0, 1.14, tableZ)
    box(group, tableLength, 0.23, 0.14, wood, 0, 0.93, tableZ + 1.06)
    for (const xLeg of [-tableLength / 2 + 0.22, tableLength / 2 - 0.22]) {
      for (const zLeg of [-0.85, 0.78]) box(group, 0.18, 0.83, 0.18, timber, xLeg, 0.65, tableZ + zLeg)
    }
    for (let paper = 0; paper < Math.min(3, seatColumns); paper++) {
      const xPaper = (paper - (Math.min(3, seatColumns) - 1) / 2) * 1.48
      box(group, 0.43, 0.018, 0.37, codex ? materials.riverLight : materials.parchment, xPaper, 1.29, tableZ)
    }
    if (commons) {
      box(group, 0.48, 0.07, 0.48, codex ? materials.outpostAccent : materials.lamp, 0, 1.35, tableZ).castShadow = false
      box(group, 0.18, 0.22, 0.18, codex ? materials.outpostBanner : materials.dark, 0, 1.25, tableZ)
    }
  }
  project.sessions.forEach((session, seatIndex) => {
    const tableIndex = Math.floor(seatIndex / (seatColumns * 2))
    const seatWithinTable = seatIndex % (seatColumns * 2)
    const rowCapacity = Math.min(seatColumns * 2, project.sessions.length - tableIndex * seatColumns * 2)
    const rowColumns = Math.ceil(rowCapacity / 2)
    const back = seatWithinTable % 2 === 0
    const column = Math.floor(seatWithinTable / 2)
    const seatX = (column - (rowColumns - 1) / 2) * 1.31
    const seatZ = (tableIndex - (tableRows - 1) / 2) * 3.45 + 0.17 + (back ? -1.76 : 1.78)
    const rig = addPerson(group, session.id, seatX, seatZ, !back, project.source)
    rigs.set(session.id, rig)
    seats.set(session.id, new THREE.Vector3(x + seatX, 3 - (seatIndex % 3) * 0.65, z + seatZ))
  })
  const shelfX = width / 2 - 0.75
  box(group, 0.78, 1.4, 0.4, timber, shelfX, 1.2, -depth / 2 + 0.68)
  for (let item = 0; item < 3; item++) box(group, 0.12, 0.4 + item * 0.06, 0.22, codex ? materials.outpostAccent : materials.cloth[(index + item) % materials.cloth.length], shelfX - 0.2 + item * 0.2, 1.16, -depth / 2 + 0.92)
  box(group, 0.67, 0.51, 0.68, wood, -width / 2 + 0.78, 0.66, depth / 2 - 0.86)
  box(group, 0.77, 0.12, 0.77, roof, -width / 2 + 0.78, 0.94, depth / 2 - 0.86)
  for (const side of [-1, 1]) {
    const postX = side * (width / 2 - 0.92)
    box(group, 0.21, 0.7, 0.2, timber, postX, 2.86, depth / 2 - 0.28)
    box(group, 0.45, 0.42, 0.38, codex ? materials.outpostAccent : materials.lamp, postX, 2.51, depth / 2 - 0.28).castShadow = false
    box(group, 0.56, 0.1, 0.49, materials.dark, postX, 2.77, depth / 2 - 0.28)
  }
  if (codex) {
    // Draped geometric insignia and storage give the outpost its own working culture.
    box(group, 1.06, 1.62, 0.09, materials.outpostBanner, 0, 2.9, -depth / 2 + 0.56)
    box(group, 0.24, 0.44, 0.11, materials.outpostAccent, 0, 3.04, -depth / 2 + 0.64)
    box(group, 0.52, 0.16, 0.12, materials.outpostAccent, 0, 2.79, -depth / 2 + 0.64)
    for (let crate = 0; crate < 2; crate++) {
      const crateX = -width / 2 + 0.76 + crate * 0.75
      box(group, 0.65, 0.5 + crate * 0.22, 0.69, wood, crateX, 0.66 + crate * 0.11, depth / 2 - 0.82)
      box(group, 0.7, 0.09, 0.73, timber, crateX, 0.95 + crate * 0.22, depth / 2 - 0.82)
    }
    box(group, 1.1, 0.06, 0.71, materials.outpostBanner, 0, 1.31, 0.18)
    box(group, 0.78, 0.027, 0.07, materials.riverLight, 0, 1.35, 0.12)
  }
  if (commons) {
    // A taller civic crest makes each gathering hall readable from the world view.
    box(group, 2.8, 0.28, 1.55, timber, 0, 5.63, -depth / 2 + 1.5)
    box(group, 2.15, 1.4, 1.3, wallShade, 0, 6.46, -depth / 2 + 1.5)
    box(group, 2.55, 0.28, 1.7, roof, 0, 7.3, -depth / 2 + 1.5)
    box(group, 0.7, 0.76, 0.12, codex ? materials.outpostAccent : materials.lamp, 0, 6.52, -depth / 2 + 0.78).castShadow = false
    for (const side of [-1, 1]) {
      box(group, 0.27, 2.7, 0.3, timber, side * (width / 2 - 2.75), 2.35, depth / 2 - 0.22)
      box(group, 0.74, 0.88, 0.14, codex ? materials.outpostBanner : materials.cloth[1], side * (width / 2 - 2.75), 2.75, depth / 2 - 0.03)
    }
    box(group, 2.7, 0.25, 0.74, stone, 0, 0.25, depth / 2 + 1.16)
  }
  return { point: new THREE.Vector3(x, commons ? 8.1 : 6.45, z - depth / 2), width }
}

function addDarkTree(parent: THREE.Object3D, x: number, z: number, size = 1): void {
  const tree = new THREE.Group()
  tree.position.set(x, 0, z)
  tree.scale.setScalar(size)
  parent.add(tree)
  box(tree, 0.42, 2.55, 0.42, materials.outpostTimber, 0, 1.28, 0)
  box(tree, 1.85, 0.62, 1.85, materials.outpostGrass, 0, 2.38, 0)
  box(tree, 1.48, 0.74, 1.48, materials.leaf, 0, 3.02, 0)
  box(tree, 0.92, 0.77, 0.92, materials.outpostGrass, 0, 3.75, 0)
}

function addRiver(scene: THREE.Scene, size: number): void {
  for (let section = 0; section < Math.ceil(size / 2.1); section++) {
    const z = -size / 2 + section * 2.1 + 1.05
    const x = Math.sin(z * 0.14) * 0.92 + Math.sin(z * 0.35) * 0.26
    box(scene, 7.7, 0.13, 2.35, materials.riverBed, x, -0.005, z)
    box(scene, 6.36, 0.065, 2.36, materials.river, x, 0.075, z).castShadow = false
    for (const side of [-1, 1]) {
      box(scene, 0.91, 0.16, 2.34, side < 0 ? materials.riverBank : materials.outpostStone, x + side * 3.68, 0.04, z)
      if (section % 3 === 0) box(scene, 0.4, 0.17, 0.48, materials.cobble[(section + side + 5) % 4], x + side * 4.25, 0.1, z - 0.55)
    }
    if (section % 2 === 0) {
      box(scene, 0.86, 0.018, 0.08, materials.riverLight, x - 1.1, 0.115, z + 0.31).castShadow = false
      box(scene, 0.46, 0.018, 0.07, materials.riverLight, x + 1.0, 0.115, z - 0.38).castShadow = false
    }
  }
}

function addBridge(scene: THREE.Scene): void {
  for (let plank = 0; plank < 12; plank++) {
    const x = -4.47 + plank * 0.82
    box(scene, 0.77, 0.22, 3.75, plank % 3 === 0 ? materials.woodLight : materials.wood, x, 0.28, 0)
  }
  for (const side of [-1, 1]) {
    box(scene, 9.8, 0.15, 0.18, materials.timber, 0, 0.95, side * 1.83)
    for (let post = -2; post <= 2; post++) box(scene, 0.18, 0.77, 0.18, materials.timber, post * 2.13, 0.63, side * 1.83)
  }
  box(scene, 1.0, 0.15, 3.9, materials.path, -5.0, 0.12, 0)
  box(scene, 1.0, 0.15, 3.9, materials.outpostStone, 5.0, 0.12, 0)
}

function addPath(scene: THREE.Scene, fromX: number, fromZ: number, toX: number, toZ: number, codex: boolean): void {
  const dx = toX - fromX, dz = toZ - fromZ
  const steps = Math.max(2, Math.round(Math.hypot(dx, dz) / 1.1))
  const angle = Math.atan2(dx, dz)
  for (let step = 0; step < steps; step++) {
    const t = (step + 0.5) / steps
    const x = fromX + dx * t, z = fromZ + dz * t
    const tile = box(scene, 2.27, 0.07, 1.14, codex ? materials.outpostStoneDark : materials.path, x, 0.025, z)
    tile.rotation.y = angle
    for (const side of [-1, 0, 1]) {
      const stone = box(scene, 0.61, 0.075, 0.69, codex ? (step % 3 ? materials.outpostStone : materials.outpostWood) : materials.cobble[(step + side + 4) % 4], x + Math.cos(angle) * side * 0.65, 0.077, z - Math.sin(angle) * side * 0.65)
      stone.rotation.y = angle
    }
  }
}

function addWell(scene: THREE.Scene, x: number, z: number): void {
  const group = new THREE.Group()
  group.position.set(x, 0, z)
  scene.add(group)
  box(group, 3.24, 0.3, 3.24, materials.stoneEdge, 0, 0.35, 0)
  box(group, 2.55, 0.35, 2.55, materials.cobble[1], 0, 0.68, 0)
  box(group, 1.88, 0.12, 1.88, materials.dark, 0, 0.89, 0)
  for (const side of [-1, 1]) box(group, 0.22, 2.55, 0.24, materials.timber, side * 1.42, 2.17, 0)
  box(group, 3.57, 0.27, 1.4, materials.roof[0], 0, 3.55, 0)
  box(group, 2.2, 0.25, 1.58, materials.roof[0], 0, 3.84, 0)
  box(group, 0.65, 0.42, 0.62, materials.wood, 0, 2.0, 0)
  box(group, 0.22, 0.75, 0.22, materials.timber, 0, 2.33, 0)
}

function addWatchPost(scene: THREE.Scene, x: number, z: number): void {
  const group = new THREE.Group()
  group.position.set(x, 0, z)
  scene.add(group)
  box(group, 5.6, 0.42, 5.6, materials.outpostStoneDark, 0, 0.25, 0)
  for (const sideX of [-1, 1]) for (const sideZ of [-1, 1]) {
    box(group, 0.5, 4.1, 0.5, materials.outpostTimber, sideX * 2.1, 2.45, sideZ * 2.1)
    box(group, 0.8, 0.45, 0.8, materials.outpostStone, sideX * 2.1, 0.67, sideZ * 2.1)
  }
  box(group, 5.2, 0.26, 5.2, materials.outpostWood, 0, 4.53, 0)
  for (const side of [-1, 1]) {
    box(group, 5.35, 0.45, 0.33, materials.outpostStoneDark, 0, 4.93, side * 2.47)
    box(group, 0.33, 0.45, 5.35, materials.outpostStoneDark, side * 2.47, 4.93, 0)
  }
  box(group, 5.8, 0.33, 5.8, materials.outpostRoof, 0, 5.65, 0)
  box(group, 4.7, 0.39, 4.7, materials.outpostRoofTrim, 0, 6.03, 0)
  box(group, 3.5, 0.37, 3.5, materials.outpostRoof, 0, 6.41, 0)
  box(group, 0.19, 2.1, 0.19, materials.outpostTimber, 0, 7.65, 0)
  box(group, 1.21, 0.98, 0.09, materials.outpostBanner, 0.58, 7.77, 0)
  box(group, 0.17, 0.56, 0.1, materials.outpostAccent, 0.52, 7.78, 0.06)
  box(group, 0.56, 0.12, 0.11, materials.outpostAccent, 0.52, 7.57, 0.06)
  box(group, 1.56, 0.36, 1.35, materials.outpostWood, 0, 0.53, 0)
}

function addOutpostBanner(scene: THREE.Scene, x: number, z: number): void {
  box(scene, 0.2, 3.45, 0.2, materials.outpostTimber, x, 1.76, z)
  box(scene, 1.12, 0.16, 0.19, materials.outpostWoodLight, x + 0.46, 3.22, z)
  box(scene, 0.91, 1.24, 0.1, materials.outpostBanner, x + 0.58, 2.52, z)
  box(scene, 0.16, 0.63, 0.12, materials.outpostAccent, x + 0.58, 2.58, z + 0.06)
  box(scene, 0.49, 0.12, 0.12, materials.outpostAccent, x + 0.58, 2.36, z + 0.06)
  box(scene, 0.4, 0.37, 0.4, materials.outpostStoneDark, x, 0.2, z)
}

function addBrazier(scene: THREE.Scene, x: number, z: number): void {
  box(scene, 0.56, 0.72, 0.56, materials.outpostStoneDark, x, 0.38, z)
  box(scene, 0.96, 0.24, 0.96, materials.outpostTimber, x, 0.86, z)
  box(scene, 0.54, 0.14, 0.54, materials.ember, x, 1.04, z).castShadow = false
  box(scene, 0.18, 0.35, 0.18, materials.ember, x - 0.12, 1.23, z).castShadow = false
  box(scene, 0.12, 0.26, 0.13, materials.ember, x + 0.14, 1.19, z + 0.07).castShadow = false
}

function addVillage(scene: THREE.Scene, projects: Project[], seats: Map<string, THREE.Vector3>, rigs: Map<string, PersonRig>, buildings: Map<string, Place>): { size: number } {
  const maxWidth = Math.max(9.4, ...projects.map((project) => buildingMetrics(project).width))
  const claudeProjects = projects.filter((project) => project.source !== 'codex' && project.kind !== 'Commons')
  const codexProjects = projects.filter((project) => project.source === 'codex' && project.kind !== 'Commons')
  const maxColumns = Math.max(1, Math.ceil(Math.max(claudeProjects.length, codexProjects.length) / 4))
  const size = 88 + (maxColumns - 1) * (maxWidth + 7) * 2
  box(scene, size, 0.7, size, materials.ground, 0, -0.42, 0)
  box(scene, size / 2 - 3.9, 0.045, size, materials.outpostGround, size / 4 + 1.95, -0.025, 0)
  addRiver(scene, size)
  addBridge(scene)
  const districtX = 19.5
  if (projects.some((project) => project.source === 'claude')) {
    addWell(scene, -10.8, 0)
    addPath(scene, -districtX + 2.2, 0, -5.4, 0, false)
    for (const z of [-4.2, 4.2]) addLamp(scene, -10.6, z)
  }
  if (projects.some((project) => project.source === 'codex')) {
    addWatchPost(scene, 10.8, 0)
    addPath(scene, 5.4, 0, districtX - 2.8, 0, true)
    addBrazier(scene, 11.8, -4.3)
    addBrazier(scene, 11.8, 4.3)
    for (const z of [-4.5, 4.5]) {
      box(scene, 0.37, 1.3, 0.37, materials.outpostStoneDark, 13, 0.7, z)
      box(scene, 0.56, 0.38, 0.55, materials.outpostAccent, 13, 1.5, z)
    }
  }
  const positions: Array<[number, number, number]> = []
  for (const [source, districtProjects] of [['claude', claudeProjects], ['codex', codexProjects]] as const) {
    const codex = source === 'codex'
    const side = codex ? 1 : -1
    const hall = projects.find((project) => project.source === source && project.kind === 'Commons')
    if (hall) {
      const hallX = side * districtX
      const place = addBuilding(scene, hall, -1, hallX, 0, seats, rigs)
      buildings.set(hall.id, place)
      positions.push([hallX, 0, buildingMetrics(hall).depth / 2 + 2.4])
      addPath(scene, side * (districtX - 4), 0, hallX, 0, codex)
      if (codex) {
        addOutpostBanner(scene, hallX - place.width / 2 - 1.5, 5)
        addBrazier(scene, hallX + place.width / 2 + 1.8, 4.2)
      } else {
        addLamp(scene, hallX + place.width / 2 + 1.9, 4.6)
        addTree(scene, hallX - place.width / 2 - 3.3, -3.5, 0.83)
      }
    }
    districtProjects.forEach((project, index) => {
      const column = Math.floor(index / 4)
      const row = index % 4
      const z = row < 2 ? (row === 0 ? -19 : 19) : (row === 2 ? -35 : 35)
      const x = side * (districtX + column * (maxWidth + 7))
      positions.push([x, z, 6])
      addPath(scene, side * districtX, z < 0 ? -2.4 : 2.4, x, z < 0 ? z + 5 : z - 5, codex)
      const place = addBuilding(scene, project, index, x, z, seats, rigs)
      buildings.set(project.id, place)
      if (codex) {
        addDarkTree(scene, x + place.width / 2 + 3.3, z - 2.2, 0.82)
        addDarkTree(scene, x - place.width / 2 - 3.1, z + 1.3, 0.61)
        box(scene, 1.34, 0.88, 1.1, materials.outpostWood, x + place.width / 2 + 1.7, 0.5, z + 3.2)
        box(scene, 1.52, 0.13, 1.25, materials.outpostTimber, x + place.width / 2 + 1.7, 1.0, z + 3.2)
        addOutpostBanner(scene, x - place.width / 2 - 1.6, z + 4.5)
      } else {
        addTree(scene, x - place.width / 2 - 2.8, z - 2.35, 0.78)
        addTree(scene, x + place.width / 2 + 3.9, z + 1.0, 0.69)
        addGarden(scene, x + place.width / 2 + 1.75, z - 2.35, index)
        addLamp(scene, x - place.width / 2 - 0.72, z + 4.6)
      }
    })
  }
  const seeded = (index: number) => { const n = Math.sin(index * 72.13 + 3.2) * 43758.5453; return n - Math.floor(n) }
  for (let index = 0; index < Math.min(210, Math.round(size * 2.5)); index++) {
    const x = (seeded(index * 2) - 0.5) * (size - 4)
    const z = (seeded(index * 2 + 1) - 0.5) * (size - 4)
    if (Math.abs(x) < 5.0 || (Math.abs(x + districtX) < 5 && Math.abs(z) < 5) || (Math.abs(x - districtX) < 5 && Math.abs(z) < 5)) continue
    if (positions.some(([bx, bz, clearanceZ]) => Math.abs(x - bx) < maxWidth / 2 + 2.4 && Math.abs(z - bz) < clearanceZ)) continue
    if (x < 0) {
      if (seeded(index + 333) > 0.94) addTree(scene, x, z, 0.53 + seeded(index + 101) * 0.28)
      else {
        box(scene, 0.13, 0.13, 0.13, materials.flower[index % materials.flower.length], x, 0.03, z)
        box(scene, 0.23, 0.06, 0.12, index % 2 ? materials.grassLight : materials.grassDark, x + 0.24, 0.005, z)
      }
    } else if (seeded(index + 333) > 0.94) addDarkTree(scene, x, z, 0.5 + seeded(index + 101) * 0.28)
    else {
      box(scene, 0.23, 0.13, 0.19, index % 3 ? materials.outpostStone : materials.outpostGrass, x, 0.03, z)
      if (index % 5 === 0) box(scene, 0.07, 0.42, 0.07, materials.reed, x + 0.21, 0.21, z)
    }
  }
  return { size }
}

const cameraOffset = new THREE.Vector3(29, 34, 43)

const WorldScene = forwardRef<WorldControls, Props>(function WorldScene({ projects, selectedId, focusedId, onSelectSession, onFocusProject }, ref) {
  const hostRef = useRef<HTMLDivElement>(null)
  const runtimeRef = useRef<Runtime | null>(null)
  const selectedRef = useRef(selectedId)
  selectedRef.current = selectedId
  const focusedRef = useRef(focusedId)
  focusedRef.current = focusedId
  const callbacksRef = useRef({ onSelectSession, onFocusProject })
  callbacksRef.current = { onSelectSession, onFocusProject }
  const [unavailable, setUnavailable] = useState(false)
  const signature = projects.map((project) => `${project.id}:${project.source}:${project.sessions.map((session) => session.id).join(',')}`).join('|')

  useImperativeHandle(ref, () => ({
    fit() { const runtime = runtimeRef.current; if (runtime) { runtime.desiredTarget.set(0, 0, 0); runtime.desiredZoom = runtime.overviewZoom } },
    zoom(direction) { const runtime = runtimeRef.current; if (runtime) runtime.desiredZoom = THREE.MathUtils.clamp(runtime.desiredZoom * (direction > 0 ? 1.26 : 1 / 1.26), runtime.overviewZoom * 0.75, 4.2) },
    focusProject(id) { const runtime = runtimeRef.current; const place = runtime?.buildings.get(id); if (runtime && place) { runtime.desiredTarget.set(place.point.x, 0.5, place.point.z + 2.4); runtime.desiredZoom = Math.max(runtime.overviewZoom * 1.65, Math.min(2.1, 18 / place.width)) } },
  }), [])

  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    const scene = new THREE.Scene()
    scene.background = new THREE.Color(0xc9d7bb)
    scene.fog = new THREE.Fog(0xc9d7bb, 72, 180)
    const camera = new THREE.OrthographicCamera(-20, 20, 20, -20, 0.1, 400)
    let renderer: THREE.WebGLRenderer
    try { renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' }) }
    catch { setUnavailable(true); return }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
    renderer.shadowMap.enabled = true
    renderer.shadowMap.type = THREE.PCFShadowMap
    renderer.outputColorSpace = THREE.SRGBColorSpace
    renderer.toneMapping = THREE.ACESFilmicToneMapping
    renderer.toneMappingExposure = 1.3
    renderer.domElement.className = 'world-canvas'
    host.prepend(renderer.domElement)
    scene.add(new THREE.AmbientLight(0xffefdb, 1.45))
    const sun = new THREE.DirectionalLight(0xffe8c3, 2.25)
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
    const sessionProjects = new Map(projects.flatMap((project) => project.sessions.map((session): [string, string] => [session.id, project.id])))
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
        if (kind === 'project') label.classList.toggle('is-overview', camera.zoom < runtime.overviewZoom * 1.45)
        labelPoint.copy(anchor).project(camera)
        const onScreen = labelPoint.z < 1 && labelPoint.x > -1.12 && labelPoint.x < 1.12 && labelPoint.y > -1.12 && labelPoint.y < 1.12
        const showSession = kind !== 'session' || ((camera.zoom > runtime.overviewZoom * 1.55 || id === selectedRef.current)
          && (!focusedRef.current || sessionProjects.get(id) === focusedRef.current || id === selectedRef.current))
        label.style.visibility = onScreen && showSession ? 'visible' : 'hidden'
        if (onScreen && showSession) visibleLabels.push({ label, kind: kind || '', x: (labelPoint.x + 1) * host.clientWidth / 2, y: (1 - labelPoint.y) * host.clientHeight / 2 })
      }
      const occupied: { left: number; right: number; top: number; bottom: number }[] = []
      const priority = (kind: string) => kind === 'project' ? -1 : 1
      for (const item of visibleLabels.sort((a, b) => priority(a.kind) - priority(b.kind))) {
        const width = item.label.offsetWidth
        const height = item.label.offsetHeight
        const offsets = item.kind === 'session'
          ? [[0, 0], [0, -25], [0, 25], [-35, 0], [35, 0]]
          : [[0, 0], [0, -38], [0, 38], [-60, 0], [60, 0], [-75, -43], [75, -43], [-75, 43], [75, 43], [0, -80], [0, 80], [-135, 0], [135, 0], [-130, -80], [130, -80], [-130, 80], [130, 80], [-200, 0], [200, 0]]
        let placed = false
        for (const [dx, dy] of offsets) {
          const x = item.x + dx, y = item.y + dy
          const bounds = { left: x - width / 2 - 3, right: x + width / 2 + 3, top: y - height - 3, bottom: y + 3 }
          if (bounds.left < 5 || bounds.right > host.clientWidth - 5 || bounds.top < 5 || bounds.bottom > host.clientHeight - 5) continue
          if (occupied.some((other) => bounds.left < other.right && bounds.right > other.left && bounds.top < other.bottom && bounds.bottom > other.top)) continue
          item.label.style.left = `${x}px`
          item.label.style.top = `${y}px`
          occupied.push(bounds)
          placed = true
          break
        }
        if (!placed) item.label.style.visibility = 'hidden'
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
      {projects.map((project) => <button className={`building-label ${project.source === 'codex' ? 'codex' : ''} ${project.kind === 'Commons' ? 'commons' : ''}`} key={project.id} data-world-label="project" data-world-id={project.id} onClick={() => callbacksRef.current.onFocusProject(project.id)} type="button">
        <span className="building-label-kind">{project.source} · {project.kind}</span><strong>{project.name}</strong><small>{project.sessions.length} {project.sessions.length === 1 ? 'session' : 'sessions'}</small>
      </button>)}
      {projects.flatMap((project) => project.sessions.map((session) => <button className={`session-label ${project.source === 'codex' ? 'codex' : ''} ${selectedId === session.id ? 'is-selected' : ''}`} key={session.id} data-world-label="session" data-world-id={session.id} onClick={() => callbacksRef.current.onSelectSession(session.id)} type="button" title={session.name}>
        <span className={`session-status ${session.status}`} />{session.name}
      </button>))}
    </div>
  </div>
})

export default WorldScene
