import type { Project } from './worldData'

export type Footprint = { id: string; x: number; z: number; width: number; depth: number; height?: number }
type Building = Pick<Project, 'id' | 'source' | 'kind'> & { width: number; depth: number }
export type VillageLayout = {
  size: number
  districtX: number
  hospitalX: number
  hospitalZ: number
  sites: Map<string, { x: number; z: number }>
  facilities: Map<string, { x: number; z: number }>
  footprints: Footprint[]
}

export const BUILDING_GAP = 8
const STREET_X = 14
const CAFE_X = 9.5
const CAMERA_YAW = Math.atan2(29, 43)
const CAMERA_PITCH = Math.atan2(34, Math.hypot(29, 43))
const MAX_SILHOUETTE_OVERLAP = 0.15

export function footprintsConflict(a: Footprint, b: Footprint, gap = BUILDING_GAP): boolean {
  return Math.abs(a.x - b.x) < (a.width + b.width) / 2 + gap
    && Math.abs(a.z - b.z) < (a.depth + b.depth) / 2 + gap
}

/** Reject placements that hide a meaningful part of another building at the default angle. */
export function projectedFootprintsConflict(a: Footprint, b: Footprint, maxOverlap = MAX_SILHOUETTE_OVERLAP): boolean {
  const bounds = (item: Footprint) => {
    const height = item.height ?? 7
    const x = Math.cos(CAMERA_YAW) * item.x - Math.sin(CAMERA_YAW) * item.z
    const y = Math.cos(CAMERA_PITCH) * height / 2
      - Math.sin(CAMERA_PITCH) * (Math.sin(CAMERA_YAW) * item.x + Math.cos(CAMERA_YAW) * item.z)
    const halfWidth = Math.cos(CAMERA_YAW) * item.width / 2 + Math.sin(CAMERA_YAW) * item.depth / 2
    const halfHeight = Math.sin(CAMERA_PITCH) * (Math.sin(CAMERA_YAW) * item.width / 2 + Math.cos(CAMERA_YAW) * item.depth / 2)
      + Math.cos(CAMERA_PITCH) * height / 2
    return { left: x - halfWidth, right: x + halfWidth, top: y - halfHeight, bottom: y + halfHeight }
  }
  const first = bounds(a), second = bounds(b)
  const overlapWidth = Math.max(0, Math.min(first.right, second.right) - Math.max(first.left, second.left))
  const overlapHeight = Math.max(0, Math.min(first.bottom, second.bottom) - Math.max(first.top, second.top))
  const firstArea = (first.right - first.left) * (first.bottom - first.top)
  const secondArea = (second.right - second.left) * (second.bottom - second.top)
  return overlapWidth * overlapHeight > Math.min(firstArea, secondArea) * maxOverlap
}

/** Place each district around reserved civic sites, then expand the land to fit. */
export function planVillageLayout(buildings: Building[]): VillageLayout {
  const maxWidth = Math.max(9.4, ...buildings.map((building) => building.width))
  const workshops = buildings.filter((building) => building.kind !== 'Commons' && building.kind !== 'Hospital')
  const maxWorkshopDepth = Math.max(7.5, ...workshops.map((building) => building.depth))
  const hospital = buildings.find((building) => building.source === 'claude' && building.kind === 'Hospital')
  const hallDepth = Math.max(10.5, ...buildings.filter((building) => building.kind === 'Commons').map((building) => building.depth))
  const hallWidth = Math.max(13.2, ...buildings.filter((building) => building.kind === 'Commons').map((building) => building.width))
  const districtX = Math.max(34, maxWidth / 2 + 28)
  const farmBaseX = districtX + Math.max(22, (hallWidth + 11.8) / 2 + BUILDING_GAP + 2)
  const footprints: Footprint[] = []
  const sites = new Map<string, { x: number; z: number }>()
  const facilities = new Map<string, { x: number; z: number }>()
  const clear = (item: Footprint) => footprints.every((occupied) => !footprintsConflict(item, occupied) && !projectedFootprintsConflict(item, occupied))
  const reserve = (item: Footprint) => { footprints.push(item); return item }
  const findLot = (id: string, width: number, depth: number, height: number, candidates: Iterable<{ x: number; z: number }>) => {
    for (const candidate of candidates) {
      const item = { id, width, depth, height, ...candidate }
      if (clear(item)) return reserve(item)
    }
    throw new Error(`Could not place ${id} in the village`)
  }

  for (const source of ['claude', 'codex'] as const) {
    const side = source === 'claude' ? -1 : 1
    reserve({ id: `${source}-board`, x: side * 10.2, z: -5.2, width: 4.4, depth: 2.4, height: 3.5 })
    const hall = buildings.find((building) => building.source === source && building.kind === 'Commons')
    if (hall) {
      sites.set(hall.id, { x: side * districtX, z: 0 })
      reserve({ id: hall.id, x: side * districtX, z: 0, width: hall.width, depth: hall.depth, height: 8 })
    }
  }

  for (const source of ['claude', 'codex'] as const) {
    const side = source === 'claude' ? -1 : 1
    const cafe = findLot(`${source}-cafe`, 8, 8, 3.6,
      Array.from({ length: 30 }, (_, index) => ({ x: side * CAFE_X, z: 14 + index * 7 })))
    facilities.set(cafe.id, { x: cafe.x, z: cafe.z })
    const farmCandidates = Array.from({ length: 20 }, (_, column) => [-11, -20, -29, -38].map((z) => ({ x: side * (farmBaseX + column * 8), z }))).flat()
    const farm = findLot(`${source}-farm`, 12, 10, 2.8, farmCandidates)
    facilities.set(farm.id, { x: farm.x, z: farm.z })
  }

  let hospitalX = -(STREET_X + (hospital?.width || 9.4) / 2 + 9)
  let hospitalZ = -Math.max(18, hallDepth / 2 + (hospital?.depth || 7.5) / 2 + BUILDING_GAP + 1)
  if (hospital) {
    const candidates = Array.from({ length: 20 }, (_, column) => Array.from({ length: 20 }, (_, row) => ({
      x: hospitalX - column * 8, z: hospitalZ - row * 8,
    }))).flat()
    const placed = findLot(hospital.id, hospital.width, hospital.depth, 7.2, candidates)
    hospitalX = placed.x; hospitalZ = placed.z
    sites.set(hospital.id, { x: hospitalX, z: hospitalZ })
  }

  const negativeZ = -Math.max(38, Math.abs(hospitalZ) + (hospital?.depth || 7.5) / 2 + maxWorkshopDepth / 2 + BUILDING_GAP + 5)
  const positiveZ = Math.max(35, hallDepth / 2 + maxWorkshopDepth / 2 + BUILDING_GAP + 17)
  const rowStride = Math.max(19, maxWorkshopDepth + BUILDING_GAP + 4)
  const columnStride = Math.max(19, maxWidth + BUILDING_GAP + 2)

  for (const source of ['claude', 'codex'] as const) {
    const side = source === 'claude' ? -1 : 1
    const district = workshops.filter((building) => building.source === source)
    const candidates = Array.from({ length: Math.max(8, district.length + 2) }, (_, column) =>
      Array.from({ length: Math.max(8, district.length + 2) }, (_, row) => ({
        x: side * (districtX + column * columnStride),
        z: row % 2 === 0 ? negativeZ - Math.floor(row / 2) * rowStride : positiveZ + Math.floor(row / 2) * rowStride,
      }))).flat().sort((a, b) => Math.max(Math.abs(a.x), Math.abs(a.z)) - Math.max(Math.abs(b.x), Math.abs(b.z))
        || Math.hypot(a.x, a.z) - Math.hypot(b.x, b.z))
    for (const building of district) {
      let placed = false
      for (const { x, z } of candidates) {
        const footprint = { id: building.id, x, z, width: building.width, depth: building.depth, height: 7.2 }
        if (Math.abs(x) - building.width / 2 < STREET_X + 5) continue
        if (!clear(footprint)) continue
        sites.set(building.id, { x, z })
        footprints.push(footprint)
        placed = true
        break
      }
      if (!placed) throw new Error(`Could not place ${building.id} in the village`)
    }
  }

  const extent = Math.max(...footprints.map((item) => Math.max(Math.abs(item.x) + item.width / 2, Math.abs(item.z) + item.depth / 2)))
  const size = Math.max(96, Math.ceil((extent + 12) / 2) * 4)
  return { size, districtX, hospitalX, hospitalZ, sites, facilities, footprints }
}
