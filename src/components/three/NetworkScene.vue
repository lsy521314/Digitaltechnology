<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { CSS2DObject, CSS2DRenderer } from 'three/addons/renderers/CSS2DRenderer.js'
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js'
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js'
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js'
import type { NetworkNode, NodeStatus } from '../../types/network'
import type { Scenario } from '../../types/scenario'
import type { AssetAccessLevel, SimulationEvent } from '../../types/simulation'
import { useSettingsStore } from '../../stores/settings'

type CameraInsets = { left: number; right: number; top: number; bottom: number }

const props = withDefaults(defineProps<{
  scenario: Scenario
  statuses?: Record<string, NodeStatus> | null
  events?: SimulationEvent[]
  assetAccess?: Record<string, AssetAccessLevel>
  assetSearchComplete?: boolean
  activeIndex?: number
  selectedNodeId?: string | null
  showLabels?: boolean
  compactLabels?: boolean
  minimalUi?: boolean
  editable?: boolean
  modelScale?: number
  fitRequest?: number
  focusMode?: boolean
  focusNodeIds?: string[]
  focusEdgeIds?: string[]
  cameraInsets?: CameraInsets
}>(), {
  statuses: null,
  events: () => [],
  assetAccess: () => ({}),
  activeIndex: -1,
  selectedNodeId: null,
  showLabels: true,
  compactLabels: false,
  minimalUi: false,
  editable: false,
  modelScale: 1.08,
  fitRequest: 0,
  focusMode: false,
  focusNodeIds: () => [],
  focusEdgeIds: () => [],
  cameraInsets: () => ({ left: 0, right: 0, top: 0, bottom: 0 }),
})

const emit = defineEmits<{
  selectNode: [id: string]
  moveNode: [id: string, position: NetworkNode['position']]
}>()
const settingsStore = useSettingsStore()

const host = ref<HTMLDivElement>()
const isReady = ref(false)
let renderer: THREE.WebGLRenderer | undefined
let labelRenderer: CSS2DRenderer | undefined
let scene: THREE.Scene | undefined
let topologyRoot: THREE.Group | undefined
let camera: THREE.PerspectiveCamera | undefined
let controls: OrbitControls | undefined
let animationFrame = 0
let nodeFocusAnimation = 0
let resizeObserver: ResizeObserver | undefined
let raycaster: THREE.Raycaster | undefined
let pointer = new THREE.Vector2()
let plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0)
let dragPoint = new THREE.Vector3()
let draggingId: string | undefined
let hoveredId: string | undefined
let userAdjustedCamera = false
let fitDistance = 1
let cameraFitTransition: {
  fromPosition: THREE.Vector3
  toPosition: THREE.Vector3
  fromTarget: THREE.Vector3
  toTarget: THREE.Vector3
  startedAt: number
  duration: number
} | undefined
let labelLod: 'near' | 'normal' | 'far' = 'normal'
let lastLodDistance = 0
let selectedId: string | null = null
let nodeMeshes = new Map<string, THREE.Group>()
let edgeLines = new Map<string, THREE.Mesh | THREE.Line>()
let edgeCurves = new Map<string, THREE.CatmullRomCurve3>()
let edgeFlowDots = new Map<string, THREE.Mesh>()
let edgeFlowPhases = new Map<string, number>()
let nodeGroundGlows = new Map<string, THREE.Mesh>()
let zoneOutlineMaterials: THREE.LineBasicMaterial[] = []
let labels = new Map<string, CSS2DObject>()
let zoneLabels: CSS2DObject[] = []
let labelOffsets = new Map<HTMLElement, { x: number; y: number }>()
let labelLayoutDirty = true
let lastLabelLayoutAt = 0
let nodePositions = new Map<string, THREE.Vector3>()
let packets: THREE.Group[] = []
let edgeTint = '#75c9dc'

type SceneFx =
  | { kind: 'burst'; points: THREE.Points; velocities: THREE.Vector3[]; bornAt: number; life: number }
  | { kind: 'ring'; mesh: THREE.Mesh; bornAt: number; life: number; maxScale: number }
let sceneFx: SceneFx[] = []

const EDGE_RISE = 0.5
const EDGE_RADIUS = 0.045

interface QualityPreset {
  pixelRatio: number
  shadows: 0 | 1 | 2
  flowRatio: number
  burstCount: number
  allowRing: boolean
  /** Screen-space bloom is only affordable on the high preset. */
  bloom: boolean
}

const QUALITY_PRESETS: Record<'low' | 'medium' | 'high', QualityPreset> = {
  low: { pixelRatio: 1, shadows: 0, flowRatio: 0.5, burstCount: 12, allowRing: false, bloom: false },
  medium: { pixelRatio: 1.35, shadows: 1, flowRatio: 0.8, burstCount: 18, allowRing: true, bloom: false },
  high: { pixelRatio: 1.7, shadows: 2, flowRatio: 1, burstCount: 26, allowRing: true, bloom: true },
}

let activeQuality: QualityPreset = { ...QUALITY_PRESETS.high }

/**
 * Physically plausible surface profiles. Before this, every device used one
 * uniform "metalness 0.35 / roughness 0.48" material, which made racks, plastic
 * shells and switches read as the same substance once an environment map exists.
 */
interface SurfaceProfile { metalness: number; roughness: number; emissiveIntensity: number }

const SURFACES: Record<string, SurfaceProfile> = {
  metal: { metalness: 0.88, roughness: 0.28, emissiveIntensity: 0.05 },
  chassis: { metalness: 0.58, roughness: 0.44, emissiveIntensity: 0.08 },
  plastic: { metalness: 0.16, roughness: 0.66, emissiveIntensity: 0.1 },
  device: { metalness: 0.46, roughness: 0.46, emissiveIntensity: 0.1 },
}

function surfaceFor(type: NetworkNode['type']): SurfaceProfile {
  if (type === 'Server' || type === 'Database') return SURFACES.metal!
  if (type === 'Firewall' || type === 'Router' || type === 'Switch') return SURFACES.chassis!
  if (type === 'Workstation') return SURFACES.plastic!
  return SURFACES.device!
}

let activeSurface: SurfaceProfile = SURFACES.device!
let composer: EffectComposer | undefined
let bloomPass: UnrealBloomPass | undefined
let environmentTexture: THREE.Texture | undefined
let pmremGenerator: THREE.PMREMGenerator | undefined
const statusColorCache = new Map<string, THREE.Color>()

let activeEdgeLines: Array<THREE.Mesh | THREE.Line> = []
let activeRouteNodeIds = new Set<string>()
let focusNodeIdSet = new Set<string>()
let focusEdgeIdSet = new Set<string>()
let eventStartedAt = performance.now()
let blockMarkerTimer: ReturnType<typeof setTimeout> | undefined
let blockMarker: CSS2DObject | undefined

const zoneStyles = {
  Internet: { label: '外部网络', color: '#4b91b8' },
  DMZ: { label: 'DMZ', color: '#58a99f' },
  Office: { label: '办公区', color: '#3d91a5' },
  Server: { label: '服务器区', color: '#5e86bd' },
  Database: { label: '数据区', color: '#8b78bf' },
  Control: { label: '控制中心', color: '#7a6fae' },
  Field: { label: '现场设备区', color: '#c28452' },
  Historian: { label: '历史数据区', color: '#5d9d6e' },
}
const primaryLabelNames = new Set(['Firewall', 'Edge Firewall', 'Internal Firewall', 'Public Web Server', 'Application Server', 'Customer Database', 'Office-PC-01', 'Core L3'])
const secondaryLabelNames = new Set(['Mail Server', 'File Server', 'Office-PC-02', 'Office-PC-03'])

function getZoneBounds() {
  const configuredZones = new Set([...props.scenario.vlans.map((vlan) => vlan.zone), ...props.scenario.nodes.map((node) => node.zone)])
  return [...configuredZones].flatMap((id) => {
    const members = props.scenario.nodes.filter((node) => node.zone === id)
    if (!members.length) return []
    const positions = members.map(displayPosition)
    const xs = positions.map((position) => position.x)
    const zs = positions.map((position) => position.z)
    const style = zoneStyles[id]
    return [{ id, ...style, centerX: (Math.min(...xs) + Math.max(...xs)) / 2, centerZ: (Math.min(...zs) + Math.max(...zs)) / 2, width: Math.max(4.2, Math.max(...xs) - Math.min(...xs) + 2.8), depth: Math.max(5.2, Math.max(...zs) - Math.min(...zs) + 2.8) }]
  })
}

function displayPosition(node: NetworkNode): THREE.Vector3 {
  const position = node.position
  return new THREE.Vector3(position.x, position.y, position.z)
}

function colorForStatus(status: NodeStatus | undefined, type: NetworkNode['type']): THREE.Color {
  const cacheKey = `${status ?? 'none'}|${type}`
  const cached = statusColorCache.get(cacheKey)
  if (cached) return cached
  let color: THREE.Color
  if (status === 'compromised') color = new THREE.Color('#f06c68')
  else if (status === 'warning') color = new THREE.Color('#e9b65e')
  else if (status === 'isolated') color = new THREE.Color('#798391')
  else if (type === 'Database') color = new THREE.Color('#84a5e7')
  else if (type === 'Server') color = new THREE.Color('#58bfd2')
  else if (type === 'Firewall') color = new THREE.Color('#e2ae65')
  else color = new THREE.Color('#53bcd0')
  statusColorCache.set(cacheKey, color)
  return color
}

function material(color: THREE.ColorRepresentation, emissive?: THREE.ColorRepresentation) {
  return new THREE.MeshStandardMaterial({
    color,
    metalness: activeSurface.metalness,
    roughness: activeSurface.roughness,
    emissive: emissive ?? color,
    emissiveIntensity: activeSurface.emissiveIntensity,
  })
}

function addBox(group: THREE.Group, size: [number, number, number], y: number, color: THREE.ColorRepresentation, x = 0, z = 0) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(...size), material(color))
  mesh.position.set(x, y, z)
  mesh.castShadow = true
  mesh.receiveShadow = true
  group.add(mesh)
}

function createNodeMesh(node: NetworkNode): THREE.Group {
  const group = new THREE.Group()
  activeSurface = surfaceFor(node.type)
  const initialStatus = props.statuses?.[node.id] ?? (node.isolationEnabled ? 'isolated' : node.protectionEnabled && node.status === 'normal' ? 'protected' : node.status)
  const color = colorForStatus(initialStatus, node.type)
  if (node.type === 'Internet') {
    const sphere = new THREE.Mesh(new THREE.IcosahedronGeometry(0.72, 1), material(color, '#257eac'))
    sphere.position.y = 0.9
    sphere.castShadow = true
    group.add(sphere)
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.88, 0.025, 6, 36), new THREE.MeshBasicMaterial({ color: '#57b8d1', transparent: true, opacity: 0.48 }))
    ring.rotation.x = Math.PI / 2
    ring.position.y = 0.38
    group.add(ring)
  } else if (node.type === 'Gateway') {
    addBox(group, [1.05, 0.68, 0.78], 0.53, color)
    addBox(group, [0.68, 0.12, 0.08], 0.55, '#d1e5eb', 0, 0.42)
    const indicator = new THREE.Mesh(new THREE.SphereGeometry(0.09, 10, 8), material('#69d3b1'))
    indicator.position.set(0.32, 0.7, 0.4)
    group.add(indicator)
  } else if (node.type === 'Firewall') {
    addBox(group, [1.2, 1.15, 0.82], 0.72, color)
    addBox(group, [0.12, 0.78, 0.05], 0.75, '#d7e9ef', -0.3, 0.44)
    addBox(group, [0.12, 0.78, 0.05], 0.75, '#d7e9ef', 0, 0.44)
    addBox(group, [0.12, 0.78, 0.05], 0.75, '#d7e9ef', 0.3, 0.44)
  } else if (node.type === 'Router') {
    const disk = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.6, 0.42, 8), material(color))
    disk.position.y = 0.5
    group.add(disk)
    const orb = new THREE.Mesh(new THREE.SphereGeometry(0.17, 14, 10), material('#d6f3f6'))
    orb.position.y = 0.82
    group.add(orb)
  } else if (node.type === 'Switch') {
    addBox(group, [1.18, 0.42, 0.66], 0.39, color)
    for (let index = 0; index < 5; index += 1) {
      const led = new THREE.Mesh(new THREE.SphereGeometry(0.045, 8, 8), new THREE.MeshBasicMaterial({ color: index % 2 ? '#81e0bf' : '#a9dce2' }))
      led.position.set(-0.43 + index * 0.2, 0.43, 0.35)
      group.add(led)
    }
  } else if (node.type === 'Workstation') {
    addBox(group, [0.88, 0.58, 0.13], 1.06, color, 0, -0.18)
    addBox(group, [0.12, 0.32, 0.12], 0.62, '#6e8398', 0, -0.18)
    addBox(group, [0.54, 0.09, 0.34], 0.42, '#6e8398', 0, -0.18)
    addBox(group, [0.4, 0.58, 0.55], 0.34, '#27465a', 0.68, 0.13)
    const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.7, 0.39), new THREE.MeshBasicMaterial({ color: '#193443', transparent: true, opacity: 0.85 }))
    screen.position.set(0, 1.06, -0.105)
    group.add(screen)
  } else if (node.type === 'Server') {
    addBox(group, [0.9, 1.55, 0.86], 0.84, color)
    for (let index = 0; index < 3; index += 1) {
      addBox(group, [0.58, 0.06, 0.035], 0.38 + index * 0.38, '#c0d8e1', 0, 0.45)
      const led = new THREE.Mesh(new THREE.SphereGeometry(0.04, 8, 8), new THREE.MeshBasicMaterial({ color: index === 0 ? '#83dfad' : '#63b9cc' }))
      led.position.set(0.3, 0.42 + index * 0.38, 0.49)
      group.add(led)
    }
  } else {
    const cylinder = new THREE.Mesh(new THREE.CylinderGeometry(0.58, 0.58, 1.3, 28, 1, false), material(color, '#5275ad'))
    cylinder.position.y = 0.75
    cylinder.castShadow = true
    group.add(cylinder)
    const top = new THREE.Mesh(new THREE.CircleGeometry(0.56, 28), new THREE.MeshStandardMaterial({ color: '#a4b8e3', metalness: 0.4, roughness: 0.45 }))
    top.rotation.x = -Math.PI / 2
    top.position.y = 1.405
    group.add(top)
    for (let index = 0; index < 3; index += 1) {
      const band = new THREE.Mesh(new THREE.TorusGeometry(0.585, 0.018, 6, 28), new THREE.MeshBasicMaterial({ color: '#b6c8eb', transparent: true, opacity: 0.55 }))
      band.rotation.x = Math.PI / 2
      band.position.y = 0.38 + index * 0.36
      group.add(band)
    }
  }

  if (node.protectionEnabled && ['Workstation', 'Server'].includes(node.type)) {
    const shieldRing = new THREE.Mesh(
      new THREE.TorusGeometry(0.79, 0.035, 8, 40),
      new THREE.MeshBasicMaterial({ color: '#62d3a5', transparent: true, opacity: 0.82 }),
    )
    shieldRing.rotation.x = Math.PI / 2
    shieldRing.position.y = 0.09
    group.add(shieldRing)
  }
  if (node.isCritical) {
    const assetRing = new THREE.Mesh(
      new THREE.TorusGeometry(0.98, 0.025, 6, 40),
      new THREE.MeshBasicMaterial({ color: '#e8be70', transparent: true, opacity: 0.76 }),
    )
    assetRing.rotation.x = Math.PI / 2
    assetRing.position.y = 0.075
    group.add(assetRing)
  }
  if (node.isolationEnabled || initialStatus === 'isolated') {
    const isolationRing = new THREE.Mesh(
      new THREE.TorusGeometry(0.88, 0.035, 6, 36),
      new THREE.MeshBasicMaterial({ color: '#87939d', transparent: true, opacity: 0.7 }),
    )
    isolationRing.rotation.x = Math.PI / 2
    isolationRing.position.y = 0.1
    group.add(isolationRing)
  }
  const glowRadius = node.type === 'Database' ? 1.18 : node.type === 'Firewall' ? 1.06 : node.type === 'Server' ? 1.1 : 0.95
  const groundGlow = new THREE.Mesh(
    new THREE.CircleGeometry(glowRadius, 44),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.22, depthWrite: false }),
  )
  groundGlow.rotation.x = -Math.PI / 2
  groundGlow.position.y = 0.016
  groundGlow.renderOrder = 2
  group.add(groundGlow)
  nodeGroundGlows.set(node.id, groundGlow)
  group.position.copy(nodePositions.get(node.id) ?? displayPosition(node))
  const emphasisScale = node.type === 'Database' ? 1.28 : node.type === 'Firewall' ? 1.14 : node.type === 'Server' ? 1.15 : 1
  const baseScale = props.modelScale * emphasisScale
  group.scale.setScalar(baseScale)
  group.userData.baseScale = baseScale
  group.userData.nodeId = node.id
  return group
}

function addZone(zone: { id: keyof typeof zoneStyles; label: string; color: string; centerX: number; centerZ: number; width: number; depth: number }, target: THREE.Group) {
  const base = new THREE.Mesh(
    new THREE.BoxGeometry(zone.width, 0.12, zone.depth),
    new THREE.MeshBasicMaterial({ color: zone.color, transparent: true, opacity: 0.075, depthWrite: false }),
  )
  base.position.set(zone.centerX, -0.075, zone.centerZ)
  target.add(base)
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(zone.width, zone.depth),
    new THREE.MeshBasicMaterial({ color: zone.color, transparent: true, opacity: 0.065, side: THREE.DoubleSide, depthWrite: false }),
  )
  floor.rotation.x = -Math.PI / 2
  floor.position.set(zone.centerX, -0.012, zone.centerZ)
  target.add(floor)
  const nearZ = zone.centerZ + zone.depth / 2
  const farZ = zone.centerZ - zone.depth / 2
  const outlinePoints = [
    new THREE.Vector3(zone.centerX - zone.width / 2, 0.06, farZ), new THREE.Vector3(zone.centerX + zone.width / 2, 0.06, farZ),
    new THREE.Vector3(zone.centerX + zone.width / 2, 0.06, nearZ), new THREE.Vector3(zone.centerX - zone.width / 2, 0.06, nearZ),
    new THREE.Vector3(zone.centerX - zone.width / 2, 0.06, farZ),
  ]
  const outlineMaterial = new THREE.LineBasicMaterial({ color: zone.color, transparent: true, opacity: 0.36 })
  const outline = new THREE.Line(new THREE.BufferGeometry().setFromPoints(outlinePoints), outlineMaterial)
  zoneOutlineMaterials.push(outlineMaterial)
  target.add(outline)
  const cornerMaterial = new THREE.LineBasicMaterial({ color: zone.color, transparent: true, opacity: 0.3 })
  for (const [x, z] of [[zone.centerX - zone.width / 2, farZ], [zone.centerX + zone.width / 2, farZ], [zone.centerX + zone.width / 2, nearZ], [zone.centerX - zone.width / 2, nearZ]]) {
    target.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(x!, 0.06, z!), new THREE.Vector3(x!, 0.32, z!)]), cornerMaterial.clone()))
  }
  const labelEl = document.createElement('div')
  labelEl.className = 'zone-label'
  labelEl.innerHTML = `<strong>${zone.label}</strong>`
  const label = new CSS2DObject(labelEl)
  label.position.set(zone.centerX, 0.52, nearZ - Math.min(0.8, zone.depth * 0.14))
  target.add(label)
  zoneLabels.push(label)
}

function makeLabel(node: NetworkNode): CSS2DObject {
  const el = document.createElement('div')
  el.className = props.minimalUi ? 'network-node-label' : 'network-node-label network-node-label-interactive'
  const compactName = ({
    Internet: '互联网',
    'Edge Gateway': '边界网关',
    Firewall: '防火墙',
    'Core Switch': '核心交换机',
    'DMZ Switch': 'DMZ交换机',
    'Public Web Server': '公网Web服务',
    'Mail Server': '邮件服务',
    'Office Switch': '办公交换机',
    'Office-PC-01': 'PC-01',
    'Office-PC-02': 'PC-02',
    'Office-PC-03': 'PC-03',
    'Server Switch': '服务器交换机',
    'Application Server': '应用服务器',
    'File Server': '文件服务器',
    'Customer Database': '客户数据库',
    'Finance Database': '财务数据库',
    'Perimeter Firewall': '边界防火墙',
    'Edge Firewall': '边界防火墙',
    'Internal Firewall': '内部防火墙',
    'Core L3': '核心三层交换机',
    'Data Switch': '数据交换机',
    'Office Endpoint': '办公终端',
    'Control Switch': '控制交换机',
    'Operator HMI': '操作员 HMI',
    'Engineer Station': '工程师站',
    'Industrial Firewall': '工业防火墙',
    'SCADA Switch': 'SCADA交换机',
    'SCADA Server': 'SCADA服务器',
    'Process File Server': '报表文件服务器',
    'Field Switch': '现场交换机',
    'PLC-01 Pump': '水泵 PLC-01',
    'PLC-02 Line': '产线 PLC-02',
    'RTU Gateway': '采集终端 RTU',
    'Historian Switch': '历史交换机',
    'Historian Database': '历史数据库',
  } as Record<string, string>)[node.name] ?? node.name
  el.innerHTML = `<span class="network-node-label-main"></span><span class="network-node-status-badge" aria-hidden="true"></span><span class="network-node-asset-badge" aria-hidden="true"></span>`
  el.querySelector('.network-node-label-main')!.textContent = compactName
  const label = new CSS2DObject(el)
  // Keep firewall labels above the dense boundary links so the CSS2D card does not cover them.
  const labelHeight = node.type === 'Switch' ? 1.25 : node.type === 'Database' ? 2.08 : node.type === 'Firewall' ? 2.45 : node.type === 'Server' ? 2.05 : 1.78
  label.position.set(0, labelHeight, 0)
  label.userData.nodeId = node.id
  const labelPriority = primaryLabelNames.has(node.name) ? 1 : secondaryLabelNames.has(node.name) ? 2 : 3
  label.userData.labelPriority = labelPriority
  el.classList.toggle('network-node-primary', labelPriority === 1)
  el.addEventListener('mouseenter', () => {
    hoveredId = node.id
    label.element.classList.add('node-label-hovered')
    labelLayoutDirty = true
    updateLabelLod(true)
  })
  el.addEventListener('mouseleave', () => {
    if (hoveredId === node.id) hoveredId = undefined
    label.element.classList.remove('node-label-hovered')
    labelLayoutDirty = true
    updateLabelLod(true)
  })
  if (!props.minimalUi) {
    el.tabIndex = 0
    el.setAttribute('role', 'button')
    el.setAttribute('aria-label', `选择${node.name}`)
    el.addEventListener('click', (event) => {
      event.stopPropagation()
      selectNode(node.id)
    })
    el.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return
      event.preventDefault()
      selectNode(node.id)
    })
  }
  return label
}

function disposeObject(object: THREE.Object3D) {
  object.traverse((child) => {
    if (child instanceof THREE.Mesh || child instanceof THREE.Line) {
      child.geometry.dispose()
      const mats = Array.isArray(child.material) ? child.material : [child.material]
      mats.forEach((item) => item.dispose())
    }
  })
}

function buildEdgeCurve(a: THREE.Vector3, b: THREE.Vector3): THREE.CatmullRomCurve3 {
  const distance = a.distanceTo(b)
  const sag = Math.min(1.6, Math.max(0.32, distance * 0.2))
  const mid = a.clone().lerp(b, 0.5)
  mid.y -= sag
  return new THREE.CatmullRomCurve3([a, mid, b])
}

function spawnBurst(position: THREE.Vector3, color: string, count = 20) {
  if (!scene) return
  const geometry = new THREE.BufferGeometry()
  const positions = new Float32Array(count * 3)
  const velocities: THREE.Vector3[] = []
  for (let index = 0; index < count; index += 1) {
    positions[index * 3] = 0
    positions[index * 3 + 1] = 0
    positions[index * 3 + 2] = 0
    const angle = Math.random() * Math.PI * 2
    const speed = 1.7 + Math.random() * 2.8
    velocities.push(new THREE.Vector3(Math.cos(angle) * speed, Math.random() * 1.5 - 0.1, Math.sin(angle) * speed))
  }
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  const points = new THREE.Points(geometry, new THREE.PointsMaterial({
    color,
    size: activeQuality.pixelRatio >= 1.35 ? 0.3 : 0.22,
    transparent: true,
    opacity: 1,
    depthWrite: false,
    sizeAttenuation: true,
  }))
  points.position.copy(position).add(new THREE.Vector3(0, 0.55, 0))
  scene.add(points)
  sceneFx.push({ kind: 'burst', points, velocities, bornAt: performance.now(), life: 950 })
}

function spawnShockwave(position: THREE.Vector3, color: string) {
  if (!scene || !activeQuality.allowRing) return
  const mesh = new THREE.Mesh(
    new THREE.RingGeometry(0.32, 0.42, 52),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.85, side: THREE.DoubleSide, depthWrite: false }),
  )
  mesh.rotation.x = -Math.PI / 2
  mesh.position.copy(position).add(new THREE.Vector3(0, 0.07, 0))
  scene.add(mesh)
  sceneFx.push({ kind: 'ring', mesh, bornAt: performance.now(), life: 900, maxScale: 4.4 })
}

function updateSceneFx() {
  if (!scene) return
  const now = performance.now()
  for (let index = sceneFx.length - 1; index >= 0; index -= 1) {
    const item = sceneFx[index]!
    const t = (now - item.bornAt) / item.life
    if (t >= 1) {
      if (item.kind === 'burst') {
        item.points.geometry.dispose()
        ;(item.points.material as THREE.PointsMaterial).dispose()
        scene.remove(item.points)
      } else {
        item.mesh.geometry.dispose()
        ;(item.mesh.material as THREE.MeshBasicMaterial).dispose()
        scene.remove(item.mesh)
      }
      sceneFx.splice(index, 1)
      continue
    }
    if (item.kind === 'burst') {
      const attribute = item.points.geometry.attributes.position as THREE.BufferAttribute
      const array = attribute.array as Float32Array
      const gravity = t * t * 2.4
      for (let point = 0; point < item.velocities.length; point += 1) {
        const velocity = item.velocities[point]!
        array[point * 3] = velocity.x * t
        array[point * 3 + 1] = velocity.y * t - gravity
        array[point * 3 + 2] = velocity.z * t
      }
      attribute.needsUpdate = true
      ;(item.points.material as THREE.PointsMaterial).opacity = Math.max(0, 1 - t)
    } else {
      item.mesh.scale.setScalar(1 + t * item.maxScale)
      ;(item.mesh.material as THREE.MeshBasicMaterial).opacity = Math.max(0, 0.85 * (1 - t))
    }
  }
}

function rebuildScene() {
  if (!scene) return
  clearBlockMarker()
  labelRenderer?.domElement.replaceChildren()
  scene.children.slice().forEach((child) => {
    scene?.remove(child)
    disposeObject(child)
  })
  nodeMeshes = new Map()
  edgeLines = new Map()
  edgeCurves = new Map()
  edgeFlowDots = new Map()
  edgeFlowPhases = new Map()
  nodeGroundGlows = new Map()
  zoneOutlineMaterials = []
  sceneFx = []
  labels = new Map()
  zoneLabels = []
  labelOffsets = new Map()
  labelLayoutDirty = true
  topologyRoot = new THREE.Group()
  topologyRoot.name = 'network-topology-bounds'
  scene.add(topologyRoot)
  nodePositions = new Map(props.scenario.nodes.map((node) => [node.id, displayPosition(node)]))
  packets = []
  activeEdgeLines = []
  activeRouteNodeIds = new Set()
  scene.fog = new THREE.Fog('#07111f', 19, 39)
  scene.background = new THREE.Color('#07111f')
  if (environmentTexture) {
    scene.environment = environmentTexture
    // Subtle image-based lighting: enough for metal to read as metal, not enough to flatten the key light.
    scene.environmentIntensity = 0.35
  }
  scene.add(new THREE.HemisphereLight('#b5dbe8', '#132438', 1.05))
  const keyLight = new THREE.DirectionalLight('#d5ecf5', 2.5)
  keyLight.position.set(-6, 13, 7)
  keyLight.castShadow = activeQuality.shadows > 0
  if (activeQuality.shadows === 2) keyLight.shadow.mapSize.set(2048, 2048)
  else if (activeQuality.shadows === 1) keyLight.shadow.mapSize.set(1024, 1024)
  const spanX = props.scenario.nodes.map((node) => Math.abs(node.position.x))
  const spanZ = props.scenario.nodes.map((node) => Math.abs(node.position.z))
  // The default orthographic frustum is only ±5 units, which clips most of the topology.
  const halfSpan = Math.min(30, Math.max(16, Math.max(...spanX, ...spanZ) + 8))
  const shadowCamera = keyLight.shadow.camera
  shadowCamera.left = -halfSpan
  shadowCamera.right = halfSpan
  shadowCamera.top = halfSpan
  shadowCamera.bottom = -halfSpan
  shadowCamera.near = 1
  shadowCamera.far = 70
  shadowCamera.updateProjectionMatrix()
  keyLight.shadow.bias = -0.0006
  keyLight.shadow.normalBias = 0.035
  keyLight.shadow.radius = activeQuality.shadows === 2 ? 3 : 1.5
  scene.add(keyLight)
  const fill = new THREE.PointLight('#3f95b4', 22, 26)
  fill.position.set(2, 5, -6)
  scene.add(fill)

  const ground = new THREE.Mesh(new THREE.PlaneGeometry(52, 25), new THREE.MeshStandardMaterial({ color: '#081522', metalness: 0.06, roughness: 0.92 }))
  ground.rotation.x = -Math.PI / 2
  ground.position.y = -0.03
  ground.receiveShadow = true
  scene.add(ground)
  const grid = new THREE.GridHelper(50, 50, '#20505f', '#10303e')
  grid.position.y = 0.004
  grid.material.transparent = true
  grid.material.opacity = 0.36
  scene.add(grid)
  getZoneBounds().forEach((zone) => addZone(zone, topologyRoot!))

  for (const node of props.scenario.nodes) {
    const group = createNodeMesh(node)
    topologyRoot.add(group)
    nodeMeshes.set(node.id, group)
    const label = makeLabel(node)
    group.add(label)
    labels.set(node.id, label)
  }

  for (const edge of props.scenario.edges) {
    const source = nodeMeshes.get(edge.source)
    const target = nodeMeshes.get(edge.target)
    if (!source || !target) continue
    const a = source.position.clone().add(new THREE.Vector3(0, EDGE_RISE, 0))
    const b = target.position.clone().add(new THREE.Vector3(0, EDGE_RISE, 0))
    const curve = buildEdgeCurve(a, b)
    edgeCurves.set(edge.id, curve)
    const tube = new THREE.Mesh(
      new THREE.TubeGeometry(curve, Math.max(6, Math.round(a.distanceTo(b) * 6)), EDGE_RADIUS, 7, false),
      new THREE.MeshBasicMaterial({ color: edge.enabled ? '#3e91a9' : '#53606a', transparent: true, opacity: edge.enabled ? 0.62 : 0.26 }),
    )
    topologyRoot.add(tube)
    edgeLines.set(edge.id, tube)
    if (Math.random() < activeQuality.flowRatio) {
      const flowPhase = Math.random() * Math.PI * 2
      edgeFlowPhases.set(edge.id, flowPhase)
      const flowDot = new THREE.Mesh(new THREE.SphereGeometry(0.085, 10, 8), new THREE.MeshBasicMaterial({ color: '#8ee7dd', transparent: true, opacity: edge.enabled ? 0.92 : 0.14 }))
      topologyRoot.add(flowDot)
      edgeFlowDots.set(edge.id, flowDot)
    }
  }
  syncSelection()
  syncLabels()
  updateLabelLod(true)
}

function fitCameraToTopology(preserveOrientation = false, smooth = false) {
  if (!camera || !controls || !topologyRoot || !props.scenario.nodes.length) return
  topologyRoot.updateMatrixWorld(true)
  const bounds = new THREE.Box3().setFromObject(topologyRoot)
  if (bounds.isEmpty()) return
  bounds.expandByScalar(0.24)
  const center = bounds.getCenter(new THREE.Vector3())
  const fitPoints: THREE.Vector3[] = []
  topologyRoot.traverse((object) => {
    if (object instanceof THREE.Mesh || object instanceof THREE.Line) {
      if (!object.geometry.boundingBox) object.geometry.computeBoundingBox()
      const geometryBounds = object.geometry.boundingBox
      if (!geometryBounds) return
      for (let index = 0; index < 8; index += 1) {
        fitPoints.push(new THREE.Vector3(
          index & 1 ? geometryBounds.max.x : geometryBounds.min.x,
          index & 2 ? geometryBounds.max.y : geometryBounds.min.y,
          index & 4 ? geometryBounds.max.z : geometryBounds.min.z,
        ).applyMatrix4(object.matrixWorld))
      }
    } else if (object instanceof CSS2DObject) {
      fitPoints.push(object.getWorldPosition(new THREE.Vector3()))
    }
  })
  const viewDirection = preserveOrientation
    ? camera.position.clone().sub(controls.target).normalize()
    : new THREE.Vector3(0.12, 0.32, 0.94).normalize()
  if (viewDirection.lengthSq() < 0.01) viewDirection.set(0.12, 0.32, 0.94).normalize()
  const right = preserveOrientation
    ? new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion).normalize()
    : new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), viewDirection).normalize()
  const viewUp = preserveOrientation
    ? new THREE.Vector3(0, 1, 0).applyQuaternion(camera.quaternion).normalize()
    : new THREE.Vector3().crossVectors(viewDirection, right).normalize()
  const halfVerticalFov = THREE.MathUtils.degToRad(camera.fov / 2)
  const halfHorizontalFov = Math.atan(Math.tan(halfVerticalFov) * Math.max(camera.aspect, 0.1))
  const width = Math.max(1, host.value?.clientWidth ?? 1)
  const height = Math.max(1, host.value?.clientHeight ?? 1)
  const insets = props.cameraInsets
  const usableWidth = THREE.MathUtils.clamp(1 - (insets.left + insets.right) / width, 0.28, 1)
  const usableHeight = THREE.MathUtils.clamp(1 - (insets.top + insets.bottom) / height, 0.28, 1)
  const hasInsets = insets.left + insets.right + insets.top + insets.bottom > 0
  const fillWidth = usableWidth * (hasInsets ? 0.74 : 0.84)
  const fillHeight = usableHeight * (hasInsets ? 0.82 : 0.78)
  let requiredDistance = camera.near + 2
  const corner = new THREE.Vector3()
  for (const point of fitPoints) {
    corner.copy(point).sub(center)
    const towardCamera = corner.dot(viewDirection)
    const projectedX = Math.abs(corner.dot(right)) + 0.35
    const projectedY = Math.abs(corner.dot(viewUp)) + 0.25
    requiredDistance = Math.max(
      requiredDistance,
      towardCamera + projectedX / (Math.tan(halfHorizontalFov) * fillWidth),
      towardCamera + projectedY / (Math.tan(halfVerticalFov) * fillHeight),
    )
  }
  fitDistance = Math.max(8, requiredDistance * 1.035)
  if (scene?.fog instanceof THREE.Fog) {
    scene.fog.near = Math.max(28, fitDistance * 1.05)
    scene.fog.far = Math.max(62, fitDistance * 2.6)
  }
  const fitTarget = center.clone().addScaledVector(viewUp, -0.45)
  const horizontalCenterOffset = (insets.left - insets.right) / width
    * fitDistance * Math.tan(halfHorizontalFov)
  const verticalCenterOffset = (insets.top - insets.bottom) / height
    * fitDistance * Math.tan(halfVerticalFov)
  fitTarget.addScaledVector(right, -horizontalCenterOffset)
  fitTarget.addScaledVector(viewUp, verticalCenterOffset)
  const fitPosition = fitTarget.clone().addScaledVector(viewDirection, fitDistance)
  if (smooth) {
    cameraFitTransition = {
      fromPosition: camera.position.clone(),
      toPosition: fitPosition,
      fromTarget: controls.target.clone(),
      toTarget: fitTarget,
      startedAt: performance.now(),
      duration: 260,
    }
  } else {
    cameraFitTransition = undefined
    controls.target.copy(fitTarget)
    camera.position.copy(fitPosition)
    camera.lookAt(fitTarget)
  }
  controls.minDistance = Math.max(4, fitDistance * 0.18)
  controls.maxDistance = Math.max(48, fitDistance * 2.35)
  if (!preserveOrientation) userAdjustedCamera = false
  controls.update()
  updateLabelLod(true)
  labelLayoutDirty = true
}

function updateCameraFitTransition(time: number) {
  if (!cameraFitTransition || !camera || !controls) return
  const transition = cameraFitTransition
  const progress = THREE.MathUtils.clamp((time - transition.startedAt) / transition.duration, 0, 1)
  const eased = progress * progress * (3 - 2 * progress)
  controls.target.lerpVectors(transition.fromTarget, transition.toTarget, eased)
  camera.position.lerpVectors(transition.fromPosition, transition.toPosition, eased)
  camera.lookAt(controls.target)
  if (progress >= 1) cameraFitTransition = undefined
}

function syncLabels() {
  updateLabelLod(true)
}

function updateLabelLod(force = false) {
  if (!camera || !controls) return
  const distance = camera.position.distanceTo(controls.target)
  if (!force && Math.abs(distance - lastLodDistance) < 0.45) return
  lastLodDistance = distance
  const ratio = distance / Math.max(fitDistance, 1)
  const nextLod = ratio < 0.9 ? 'near' : ratio < 1.55 ? 'normal' : 'far'
  if (nextLod === labelLod && !force) return
  labelLod = nextLod
  labels.forEach((label, id) => {
    const priority = Number(label.userData.labelPriority) || 3
    const visibleByLod = labelLod === 'near' || (labelLod === 'normal' && priority <= 1) || (labelLod === 'far' && priority === 1)
    const keepVisible = visibleByLod || activeRouteNodeIds.has(id) || id === hoveredId || id === selectedId
    label.element.classList.toggle('lod-hidden', !props.showLabels || !keepVisible)
  })
  labelLayoutDirty = true
}

function updateLabelLayout() {
  if (!camera || !host.value || !labelRenderer) return
  const width = host.value.clientWidth
  const height = host.value.clientHeight
  if (!width || !height) return
  const safeLeft = Math.min(width - 80, Math.max(5, props.cameraInsets.left + 8))
  const safeRight = Math.max(safeLeft + 80, Math.min(width - 5, width - props.cameraInsets.right - 8))
  const safeTop = Math.min(height - 40, Math.max(5, props.cameraInsets.top + 5))
  const safeBottom = Math.max(safeTop + 40, Math.min(height - 5, height - props.cameraInsets.bottom - 5))
  const candidates = [
    ...[...labels.values()].map((object) => ({ object, element: object.element, priority: Number(object.userData.labelPriority) || 3, id: String(object.userData.nodeId ?? '') })),
    ...zoneLabels.map((object, index) => ({ object, element: object.element, priority: 2.5, id: `zone-${index}` })),
  ].filter((item) => !item.element.classList.contains('lod-hidden') && item.element.offsetWidth > 0 && item.element.offsetHeight > 0)
    .sort((a, b) => {
      const aEmphasis = a.element.classList.contains('node-label-hovered') || a.element.classList.contains('node-is-selected') ? -2 : a.priority
      const bEmphasis = b.element.classList.contains('node-label-hovered') || b.element.classList.contains('node-is-selected') ? -2 : b.priority
      return aEmphasis - bEmphasis || a.id.localeCompare(b.id)
    })
  const placed: Array<{ left: number; right: number; top: number; bottom: number }> = []
  const offsets = [
    { x: 0, y: 0 }, { x: 0, y: -24 }, { x: 0, y: 24 }, { x: -28, y: 0 }, { x: 28, y: 0 },
    { x: 0, y: -44 }, { x: 0, y: 44 }, { x: -38, y: -20 }, { x: 38, y: -20 }, { x: -38, y: 20 }, { x: 38, y: 20 },
  ]
  for (const item of candidates) {
    const projected = item.object.getWorldPosition(new THREE.Vector3()).project(camera)
    if (projected.z < -1 || projected.z > 1 || Math.abs(projected.x) > 1.15 || Math.abs(projected.y) > 1.15) continue
    const centerX = (projected.x + 1) * width / 2
    const centerY = (1 - projected.y) * height / 2
    const itemWidth = item.element.offsetWidth
    const itemHeight = item.element.offsetHeight
    const previous = labelOffsets.get(item.element)
    const orderedOffsets = previous ? [previous, ...offsets.filter((offset) => offset.x !== previous.x || offset.y !== previous.y)] : offsets
    let chosen = orderedOffsets[0]!
    let chosenBox: { left: number; right: number; top: number; bottom: number } | undefined
    let bestScore = Number.POSITIVE_INFINITY
    for (const offset of orderedOffsets) {
      const box = {
        left: centerX + offset.x - itemWidth / 2,
        right: centerX + offset.x + itemWidth / 2,
        top: centerY + offset.y - itemHeight / 2,
        bottom: centerY + offset.y + itemHeight / 2,
      }
      const overlapCount = placed.filter((other) => box.left < other.right + 5 && box.right + 5 > other.left && box.top < other.bottom + 5 && box.bottom + 5 > other.top).length
      const overflow = Math.max(0, safeLeft - box.left) + Math.max(0, box.right - safeRight) + Math.max(0, safeTop - box.top) + Math.max(0, box.bottom - safeBottom)
      const score = overlapCount * 10000 + overflow * 100 + Math.hypot(offset.x, offset.y)
      if (score < bestScore) {
        chosen = offset
        chosenBox = box
        bestScore = score
      }
    }
    if (!chosenBox) {
      chosenBox = {
        left: centerX + chosen.x - itemWidth / 2,
        right: centerX + chosen.x + itemWidth / 2,
        top: centerY + chosen.y - itemHeight / 2,
        bottom: centerY + chosen.y + itemHeight / 2,
      }
    }
    const minLabelOffset = safeLeft + itemWidth / 2 - centerX
    const maxLabelOffset = safeRight - itemWidth / 2 - centerX
    const appliedOffset = { x: THREE.MathUtils.clamp(chosen.x, minLabelOffset, maxLabelOffset), y: chosen.y }
    const appliedBox = {
      left: centerX + appliedOffset.x - itemWidth / 2,
      right: centerX + appliedOffset.x + itemWidth / 2,
      top: centerY + appliedOffset.y - itemHeight / 2,
      bottom: centerY + appliedOffset.y + itemHeight / 2,
    }
    labelOffsets.set(item.element, appliedOffset)
    item.element.style.marginLeft = `${appliedOffset.x}px`
    item.element.style.marginTop = `${appliedOffset.y}px`
    placed.push(appliedBox)
  }
}

function setNodeColor(group: THREE.Group, color: THREE.Color, selected: boolean, pulse: number) {
  group.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return
    if (child.material instanceof THREE.MeshStandardMaterial) {
      child.material.emissive.set(color)
      child.material.emissiveIntensity = selected ? 0.58 : pulse
      if (child.material.color.getHexString() !== 'ffffff' && child.geometry.type !== 'PlaneGeometry') child.material.color.lerp(color, 0.55)
    }
  })
}

function syncStatuses(time = 0) {
  for (const node of props.scenario.nodes) {
    const group = nodeMeshes.get(node.id)
    if (!group) continue
    const status = props.statuses?.[node.id] ?? (node.isolationEnabled ? 'isolated' : node.protectionEnabled && node.status === 'normal' ? 'protected' : node.status)
    const routeDimmed = props.focusMode && focusNodeIdSet.size > 0
      ? !focusNodeIdSet.has(node.id)
      : activeRouteNodeIds.size > 0 && !activeRouteNodeIds.has(node.id)
    const pulse = routeDimmed ? 0.04 : status === 'compromised' ? 0.25 + Math.sin(time * 0.004) * 0.22 : 0.13
    setNodeColor(group, colorForStatus(status, node.type), node.id === selectedId, pulse)
    group.userData.routeDimmed = routeDimmed
    group.traverse((child) => {
      if (!(child instanceof THREE.Mesh)) return
      const mats = Array.isArray(child.material) ? child.material : [child.material]
      mats.forEach((item) => {
        if (!(item instanceof THREE.MeshStandardMaterial)) return
        item.transparent = routeDimmed
        item.opacity = routeDimmed ? 0.48 : 1
        item.depthWrite = !routeDimmed
      })
    })
    const glow = nodeGroundGlows.get(node.id)
    if (glow) {
      const glowMaterial = glow.material as THREE.MeshBasicMaterial
      const glowBase = routeDimmed ? 0.05 : status === 'compromised' ? 0.3 : status === 'isolated' ? 0.12 : 0.2
      glowMaterial.color.set(colorForStatus(status, node.type))
      glowMaterial.opacity = glowBase + (status === 'compromised' ? Math.sin(time * 0.004) * 0.09 : Math.sin(time * 0.0012 + node.id.length * 0.6) * 0.045)
    }
    const label = labels.get(node.id)
    if (label) {
      label.element.classList.toggle('node-is-isolated', status === 'isolated')
      label.element.classList.toggle('node-is-compromised', status === 'compromised')
      label.element.classList.toggle('node-is-protected', status === 'protected' || node.protectionEnabled)
      label.element.classList.toggle('route-dimmed', routeDimmed && node.id !== hoveredId && node.id !== selectedId)
      const badge = label.element.querySelector<HTMLElement>('.network-node-status-badge')
      if (badge) {
        badge.textContent = ''
        badge.dataset.status = status === 'protected' || node.protectionEnabled ? 'protected' : status
        badge.title = status === 'isolated' ? '已隔离' : status === 'compromised' ? '受影响' : status === 'warning' ? '风险提示' : status === 'protected' || node.protectionEnabled ? '已防护' : '正常'
      }
      const assetBadge = label.element.querySelector<HTMLElement>('.network-node-asset-badge')
      if (assetBadge && node.type === 'Database') {
        const access = props.assetAccess?.[node.id]
        assetBadge.textContent = access === 'DATA_ACCESS'
          ? '数据已访问'
          : props.assetSearchComplete === false
            ? '暂不能判定'
            : props.assetSearchComplete === true
              ? '数据受保护'
              : '数据未访问'
        assetBadge.dataset.access = access === 'DATA_ACCESS' ? 'reached' : props.assetSearchComplete === false ? 'unknown' : props.assetSearchComplete === true ? 'protected' : 'pending'
        assetBadge.title = access === 'DATA_ACCESS'
          ? '教学模型中的数据访问目标已达成；数据库主机状态仍独立显示。'
          : props.assetSearchComplete === false
            ? '状态搜索未完整完成，不能据此确认目标安全。'
            : props.assetSearchComplete === true
              ? '完整教学状态搜索范围内未发现数据访问链；数据库主机状态仍独立显示。'
              : '尚未运行实验。'
        assetBadge.hidden = !props.assetAccess || Object.keys(props.assetAccess).length === 0
      }
    }
  }
}

function syncSelection() {
  selectedId = props.selectedNodeId ?? null
  labels.forEach((label, id) => label.element.classList.toggle('node-is-selected', id === selectedId))
  syncStatuses(performance.now())
}

function updateEventEffect(time: number) {
  if (!scene) return
  const event = props.events[props.activeIndex]
  if (!event) {
    activeRouteNodeIds = new Set()
    packets.forEach((packet) => (packet.visible = false))
    edgeLines.forEach((line, edgeId) => {
      const material = line.material as THREE.MeshBasicMaterial
      const chainEdge = props.focusMode && focusEdgeIdSet.has(edgeId)
      material.color.set(chainEdge ? '#62b9ad' : '#3e91a9')
      material.opacity = props.focusMode && focusEdgeIdSet.size ? (chainEdge ? 0.82 : 0.16) : 0.62
    })
    activeEdgeLines = []
    return
  }
  activeRouteNodeIds = event.routeEdgeIds.length > 0 ? new Set(event.route) : new Set()
  if (!packets.length) {
    packets = Array.from({ length: 3 }, (_, index) => {
      const core = new THREE.Mesh(new THREE.SphereGeometry(0.15, 12, 10), new THREE.MeshBasicMaterial({ color: '#f0716b', transparent: true, opacity: 1 }))
      const halo = new THREE.Mesh(new THREE.SphereGeometry(0.3, 12, 10), new THREE.MeshBasicMaterial({ color: '#f0716b', transparent: true, opacity: 0.22, depthWrite: false }))
      const group = new THREE.Group()
      group.userData.index = index
      group.add(core, halo)
      scene!.add(group)
      return group
    })
  }
  const routeGroups = event.route.map((id) => nodeMeshes.get(id)).filter((group): group is THREE.Group => Boolean(group))
  const points = routeGroups.map((group) => group.position.clone().add(new THREE.Vector3(0, 0.6, 0)))
  if (event.routeEdgeIds.length === 0 || points.length < 2) packets.forEach((packet) => (packet.visible = false))
  const duration = 900
  const elapsed = Math.max(0, Math.min(duration, time - eventStartedAt))
  const isAttackObjective = event.attackEffect === 'DATA_ACCESS_GRANTED'
  const isDataAccessControlBlock = event.attackTechniqueId === 'database-access'
    && event.attackTransitionResult === 'BLOCKED'
    && event.reason.includes('数据访问控制')
  // This event's communication path succeeded; only the teaching data-access action was blocked.
  const tint = isDataAccessControlBlock ? '#75c9dc' : event.result === 'block' ? '#70d9a9' : isAttackObjective ? '#e9b95e' : event.result === 'compromise' || event.attackTechniqueId ? '#f0716b' : '#75c9dc'
  edgeTint = tint
  edgeLines.forEach((line, edgeId) => {
    const material = line.material as THREE.MeshBasicMaterial
    const chainEdge = props.focusMode && focusEdgeIdSet.has(edgeId)
    material.color.set(chainEdge ? '#62b9ad' : '#3e91a9')
    material.opacity = chainEdge ? 0.48 : 0.14
  })
  activeEdgeLines = event.routeEdgeIds.map((id) => edgeLines.get(id)).filter((line): line is THREE.Mesh | THREE.Line => Boolean(line))
  activeEdgeLines.forEach((line) => {
    const material = line.material as THREE.MeshBasicMaterial
    material.color.set(tint)
    material.opacity = 0.98
  })
  const blockedAtNode = props.scenario.nodes.some((node) => node.id === event.blockedAt || node.name === event.blockedAt)
  const routeStop = event.result === 'block' && !blockedAtNode && points.length > 1
    ? (points.length - 2 + 0.82) / (points.length - 1)
    : 1
  packets.forEach((packet) => {
    if (points.length < 2 || (event.result === 'info' && !event.attackTechniqueId) || event.routeEdgeIds.length === 0) {
      packet.visible = false
      return
    }
    const stagger = Number(packet.userData.index ?? 0) * 0.3
    const progress = Math.min(routeStop, (elapsed / duration + stagger) * routeStop)
    const scaledProgress = progress * (points.length - 1)
    const segment = Math.min(points.length - 2, Math.floor(scaledProgress))
    const from = points[segment]!
    const to = points[segment + 1]!
    packet.position.copy(from).lerp(to, scaledProgress - segment)
    packet.visible = true
    const core = packet.children[0] as THREE.Mesh
    const halo = packet.children[1] as THREE.Mesh
    ;(core.material as THREE.MeshBasicMaterial).color.set(tint)
    ;(halo.material as THREE.MeshBasicMaterial).color.set(tint)
  })
  if (event.result === 'block') {
    const targetGroup = nodeMeshes.get(event.targetId)
    if (targetGroup && blockedAtNode) {
      const baseScale = Number(targetGroup.userData.baseScale) || props.modelScale
      targetGroup.scale.setScalar(baseScale * (1 + Math.max(0, Math.sin(elapsed / duration * Math.PI * 3)) * 0.045))
    }
  }
}

function updateEdgeFlow(time: number) {
  const event = props.events[props.activeIndex]
  const eventActive = Boolean(event)
  const activeEdgeSet = new Set(activeEdgeLines)
  for (const [edgeId, dot] of edgeFlowDots) {
    const curve = edgeCurves.get(edgeId)
    if (!curve) continue
    const enabled = props.scenario.edges.find((edge) => edge.id === edgeId)?.enabled ?? true
    if (!enabled) { dot.visible = false; continue }
    const phase = edgeFlowPhases.get(edgeId) ?? 0
    const isActiveEdge = activeEdgeSet.has(edgeLines.get(edgeId)!)
    const isFocusEdge = props.focusMode && focusEdgeIdSet.has(edgeId)
    const boost = isActiveEdge ? 6 : isFocusEdge ? 2 : 1
    const progress = (time * 0.00012 * boost + phase) % 1
    dot.position.copy(curve.getPointAt(progress))
    const material = dot.material as THREE.MeshBasicMaterial
    if (eventActive) {
      material.opacity = isActiveEdge ? 1 : isFocusEdge ? 0.5 : 0.16
      material.color.set(isActiveEdge ? edgeTint : isFocusEdge ? '#62b9ad' : '#8ee7dd')
      dot.scale.setScalar(isActiveEdge ? 1.5 : isFocusEdge ? 1.15 : 1)
    } else {
      material.opacity = 0.82
      material.color.set('#8ee7dd')
      dot.scale.setScalar(1)
    }
  }
}

function animate(time: number) {
  animationFrame = requestAnimationFrame(animate)
  if (controls) controls.update()
  updateCameraFitTransition(time)
  updateEventEffect(time)
  for (const [id, group] of nodeMeshes) {
    const status = props.statuses?.[id]
    const baseScale = Number(group.userData.baseScale) || props.modelScale
    if (status === 'compromised' && id !== draggingId) group.scale.setScalar(baseScale * (1 + Math.sin(time * 0.004) * 0.018))
    else if (id !== draggingId && id !== hoveredId) group.scale.setScalar(baseScale * (id === selectedId ? 1.025 : 1))
  }
  if (hoveredId && hoveredId !== selectedId && hoveredId !== draggingId) {
    const group = nodeMeshes.get(hoveredId)
    if (group) group.scale.setScalar((Number(group.userData.baseScale) || props.modelScale) * 1.045)
  }
  syncStatuses(time)
  updateEdgeFlow(time)
  updateSceneFx()
  zoneOutlineMaterials.forEach((material, index) => {
    const base = 0.2 + (index % 3) * 0.06
    material.opacity = base + Math.sin(time * 0.001 + index * 1.7) * 0.13
  })
  updateLabelLod()
  if (composer) composer.render()
  else renderer?.render(scene!, camera!)
  labelRenderer?.render(scene!, camera!)
  if (labelLayoutDirty && time - lastLabelLayoutAt >= 100) {
    updateLabelLayout()
    labelLayoutDirty = false
    lastLabelLayoutAt = time
  }
}

function setPointer(event: MouseEvent) {
  const rect = renderer!.domElement.getBoundingClientRect()
  pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1
  pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1
}

function hitNode(event: MouseEvent) {
  if (!raycaster || !camera) return undefined
  setPointer(event)
  raycaster.setFromCamera(pointer, camera)
  const hits = raycaster.intersectObjects([...nodeMeshes.values()], true)
  return hits.map((hit) => {
    let item: THREE.Object3D | null = hit.object
    while (item && !item.userData.nodeId) item = item.parent
    return item?.userData.nodeId as string | undefined
  }).find(Boolean)
}

function onPointerDown(event: PointerEvent) {
  if (!renderer || !raycaster || !camera || !props.editable || event.button !== 0) return
  const id = hitNode(event)
  if (!id) return
  draggingId = id
  controls!.enabled = false
  setPointer(event)
  raycaster.setFromCamera(pointer, camera)
  raycaster.ray.intersectPlane(plane, dragPoint)
  renderer.domElement.setPointerCapture(event.pointerId)
}

function onPointerMove(event: PointerEvent) {
  if (!renderer || !raycaster || !camera) return
  if (draggingId) {
    setPointer(event)
    raycaster.setFromCamera(pointer, camera)
    const point = new THREE.Vector3()
    if (raycaster.ray.intersectPlane(plane, point)) {
      const group = nodeMeshes.get(draggingId)
      if (group) group.position.set(point.x, group.position.y, point.z)
      updateEdgeGeometry()
    }
    return
  }
  const next = hitNode(event)
  if (hoveredId !== next) {
    const priorHover = hoveredId
    hoveredId = next
    if (priorHover) labels.get(priorHover)?.element.classList.remove('node-label-hovered')
    if (next) labels.get(next)?.element.classList.add('node-label-hovered')
    labelLayoutDirty = true
    updateLabelLod(true)
    if (renderer) renderer.domElement.style.cursor = next ? (props.editable ? 'grab' : 'pointer') : 'default'
  }
}

function updateEdgeGeometry() {
  if (!scene) return
  for (const edge of props.scenario.edges) {
    const aGroup = nodeMeshes.get(edge.source)
    const bGroup = nodeMeshes.get(edge.target)
    const line = edgeLines.get(edge.id)
    if (!aGroup || !bGroup || !line) continue
    const a = aGroup.position.clone().add(new THREE.Vector3(0, EDGE_RISE, 0))
    const b = bGroup.position.clone().add(new THREE.Vector3(0, EDGE_RISE, 0))
    const curve = buildEdgeCurve(a, b)
    edgeCurves.set(edge.id, curve)
    const geometry = new THREE.TubeGeometry(curve, Math.max(6, Math.round(a.distanceTo(b) * 6)), EDGE_RADIUS, 7, false)
    line.geometry.dispose()
    line.geometry = geometry
  }
}

function onPointerUp(event: PointerEvent) {
  if (!draggingId) return
  const id = draggingId
  const group = nodeMeshes.get(id)
  draggingId = undefined
  if (controls) controls.enabled = true
  if (group) {
    const node = props.scenario.nodes.find((item) => item.id === id)
    const position = group.position
    let x = position.x
    let z = position.z
    emit('moveNode', id, { x: Number(x.toFixed(2)), y: node?.position.y ?? position.y, z: Number(z.toFixed(2)) })
  }
  if (renderer?.domElement.hasPointerCapture(event.pointerId)) renderer.domElement.releasePointerCapture(event.pointerId)
}

function selectNode(id: string) {
  emit('selectNode', id)
  selectedId = id
  labels.forEach((label, labelId) => label.element.classList.toggle('node-is-selected', labelId === id))
  labelLayoutDirty = true
  syncStatuses(performance.now())
  const group = nodeMeshes.get(id)
  if (group && camera && controls) {
    if (nodeFocusAnimation) cancelAnimationFrame(nodeFocusAnimation)
    const target = group.position.clone()
    const offset = camera.position.clone().sub(controls.target)
    const nextPosition = target.clone().add(offset)
    const fromTarget = controls.target.clone()
    const fromCamera = camera.position.clone()
    const start = performance.now()
    const focus = (now: number) => {
      const t = Math.min(1, (now - start) / 460)
      const eased = t * (2 - t)
      controls!.target.lerpVectors(fromTarget, target, eased)
      camera!.position.lerpVectors(fromCamera, nextPosition, eased)
      if (t < 1) nodeFocusAnimation = requestAnimationFrame(focus)
      else nodeFocusAnimation = 0
    }
    nodeFocusAnimation = requestAnimationFrame(focus)
  }
}

function onClick(event: MouseEvent) {
  if (!renderer || draggingId) return
  const id = hitNode(event)
  if (id) selectNode(id)
}

/**
 * Screen-space bloom makes the LEDs, flow dots and status rings read as light
 * sources instead of flat bright pixels. It is rebuilt whenever the render
 * quality changes because the composer caches the renderer pixel ratio.
 */
function setupComposer() {
  composer?.dispose()
  composer = undefined
  bloomPass = undefined
  if (!renderer || !scene || !camera || !activeQuality.bloom) return
  const width = Math.max(1, host.value?.clientWidth ?? 1)
  const height = Math.max(1, host.value?.clientHeight ?? 1)
  const pixelRatio = renderer.getPixelRatio()
  const target = new THREE.WebGLRenderTarget(
    Math.floor(width * pixelRatio),
    Math.floor(height * pixelRatio),
    { type: THREE.HalfFloatType, samples: 4 },
  )
  composer = new EffectComposer(renderer, target)
  composer.setSize(width, height)
  composer.addPass(new RenderPass(scene, camera))
  bloomPass = new UnrealBloomPass(new THREE.Vector2(width * pixelRatio, height * pixelRatio), 0.5, 0.7, 0.78)
  composer.addPass(bloomPass)
  composer.addPass(new OutputPass())
}

function init() {  if (!host.value) return
  const width = Math.max(1, host.value.clientWidth)
  const height = Math.max(1, host.value.clientHeight)
  scene = new THREE.Scene()
  camera = new THREE.PerspectiveCamera(38, width / height, 0.1, 180)
  camera.position.set(0, 25, 22)
  const qualityMap = QUALITY_PRESETS
  activeQuality = { ...(qualityMap[settingsStore.renderQuality] ?? qualityMap.high) }
  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, activeQuality.pixelRatio))
  renderer.setSize(width, height)
  renderer.shadowMap.enabled = activeQuality.shadows > 0
  renderer.shadowMap.type = THREE.PCFSoftShadowMap
  renderer.outputColorSpace = THREE.SRGBColorSpace
  renderer.toneMapping = THREE.ACESFilmicToneMapping
  renderer.toneMappingExposure = 1.08
  renderer.domElement.className = 'network-webgl'
  host.value.appendChild(renderer.domElement)

  pmremGenerator = new THREE.PMREMGenerator(renderer)
  environmentTexture = pmremGenerator.fromScene(new RoomEnvironment(), 0.04).texture
  pmremGenerator.dispose()
  pmremGenerator = undefined

  labelRenderer = new CSS2DRenderer()
  labelRenderer.setSize(width, height)
  labelRenderer.domElement.className = 'network-label-layer'
  host.value.appendChild(labelRenderer.domElement)
  controls = new OrbitControls(camera, renderer.domElement)
  controls.enableDamping = true
  controls.dampingFactor = 0.07
  controls.minDistance = 6
  controls.maxDistance = 80
  controls.maxPolarAngle = Math.PI * 0.48
  controls.target.set(0, 0, 0)
  controls.update()
  controls.addEventListener('start', () => { userAdjustedCamera = true; cameraFitTransition = undefined })
  controls.addEventListener('change', () => { updateLabelLod(); labelLayoutDirty = true })
  raycaster = new THREE.Raycaster()
  raycaster.params.Line!.threshold = 0.12
  rebuildScene()
  setupComposer()
  fitCameraToTopology()
  isReady.value = true
  renderer.domElement.addEventListener('pointerdown', onPointerDown)
  renderer.domElement.addEventListener('pointermove', onPointerMove)
  renderer.domElement.addEventListener('pointerup', onPointerUp)
  renderer.domElement.addEventListener('click', onClick)
  resizeObserver = new ResizeObserver(() => {
    if (!host.value || !camera || !renderer || !labelRenderer) return
    const nextWidth = Math.max(1, host.value.clientWidth)
    const nextHeight = Math.max(1, host.value.clientHeight)
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, activeQuality.pixelRatio))
    camera.aspect = nextWidth / nextHeight
    camera.updateProjectionMatrix()
    renderer.setSize(nextWidth, nextHeight)
    labelRenderer.setSize(nextWidth, nextHeight)
    composer?.setSize(nextWidth, nextHeight)
    labelLayoutDirty = true
    if (!userAdjustedCamera) requestAnimationFrame(() => fitCameraToTopology(true, true))
    else updateLabelLod(true)
  })
  resizeObserver.observe(host.value)
  animationFrame = requestAnimationFrame(animate)
}

watch(() => JSON.stringify({ id: props.scenario.id, nodes: props.scenario.nodes, edges: props.scenario.edges }), () => {
  userAdjustedCamera = false
  rebuildScene()
  requestAnimationFrame(() => fitCameraToTopology(false, false))
})
watch(() => props.fitRequest, () => {
  if (nodeFocusAnimation) cancelAnimationFrame(nodeFocusAnimation)
  requestAnimationFrame(() => fitCameraToTopology(false, true))
})
watch(() => [props.cameraInsets.left, props.cameraInsets.right, props.cameraInsets.top, props.cameraInsets.bottom], () => {
  if (nodeFocusAnimation) cancelAnimationFrame(nodeFocusAnimation)
  requestAnimationFrame(() => fitCameraToTopology(true, true))
})
watch(() => props.statuses, () => syncStatuses(performance.now()), { deep: true })
watch(() => [props.assetAccess, props.assetSearchComplete], () => syncStatuses(performance.now()), { deep: true })
watch(() => props.focusNodeIds, (ids) => { focusNodeIdSet = new Set(ids); syncStatuses(performance.now()) }, { deep: true, immediate: true })
watch(() => props.focusEdgeIds, (ids) => { focusEdgeIdSet = new Set(ids) }, { deep: true, immediate: true })
watch(() => props.focusMode, () => {
  syncStatuses(performance.now())
  updateLabelLod(true)
  requestAnimationFrame(() => fitCameraToTopology(true, true))
})
watch(() => props.selectedNodeId, () => syncSelection())
watch(() => props.showLabels, syncLabels)
watch(() => settingsStore.renderQuality, () => {
  if (!scene || !renderer) return
  activeQuality = { ...(QUALITY_PRESETS[settingsStore.renderQuality] ?? QUALITY_PRESETS.high) }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, activeQuality.pixelRatio))
  renderer.shadowMap.enabled = activeQuality.shadows > 0
  rebuildScene()
  setupComposer()
  requestAnimationFrame(() => fitCameraToTopology(true, true))
})
function clearBlockMarker() {
  if (blockMarker && scene) scene.remove(blockMarker)
  blockMarker = undefined
}

function placeBlockMarker(event: SimulationEvent) {
  clearBlockMarker()
  if (!scene || event.result !== 'block') return
  const dataAccessBlocked = event.attackTechniqueId === 'database-access'
    && event.attackTransitionResult === 'BLOCKED'
    && event.reason.includes('数据访问控制')
  const element = document.createElement('div')
  element.className = dataAccessBlocked ? 'path-block-marker path-block-marker-data' : 'path-block-marker'
  element.innerHTML = dataAccessBlocked
    ? '<span class="path-block-shield">✓</span><span class="path-block-copy"><strong>数据目标已保护</strong><small>网络通信正常 · 行为已阻止</small></span>'
    : '<span class="path-block-shield">✓</span><strong>已阻断</strong>'
  const marker = new CSS2DObject(element)
  const blockedNode = props.scenario.nodes.find((node) => node.id === event.blockedAt || node.name === event.blockedAt)
  const target = nodeMeshes.get(blockedNode?.id ?? event.targetId)
  if (blockedNode && target) {
    marker.position.copy(target.position).add(new THREE.Vector3(0, dataAccessBlocked ? 3.05 : 2.15, 0))
  } else {
    const edgeId = event.routeEdgeIds[event.routeEdgeIds.length - 1]
    const curve = edgeId ? edgeCurves.get(edgeId) : undefined
    if (curve) {
      const from = curve.getPointAt(0)
      const to = curve.getPointAt(1)
      marker.position.copy(from).lerp(to, 0.82).add(new THREE.Vector3(0, 1.1, 0))
    } else if (target) {
      marker.position.copy(target.position).add(new THREE.Vector3(0, 1.9, 0))
    }
  }
  blockMarker = marker
  scene.add(marker)
  requestAnimationFrame(() => element.classList.add('is-visible'))
}

watch(() => props.activeIndex, (index) => {
  eventStartedAt = performance.now()
  const event = props.events[index]
  activeRouteNodeIds = event?.routeEdgeIds.length ? new Set(event.route) : new Set()
  updateLabelLod(true)
  if (blockMarkerTimer) clearTimeout(blockMarkerTimer)
  clearBlockMarker()
  if (event) {
    if (event.result === 'compromise') {
      const targetGroup = nodeMeshes.get(event.targetId)
      if (targetGroup) spawnBurst(targetGroup.position, '#f06c68', activeQuality.burstCount)
    } else if (event.attackEffect === 'DATA_ACCESS_GRANTED') {
      const targetGroup = nodeMeshes.get(event.targetId)
      if (targetGroup) spawnShockwave(targetGroup.position, '#e9b95e')
    } else if (event.attackTechniqueId && event.result !== 'block') {
      const targetGroup = nodeMeshes.get(event.targetId)
      if (targetGroup) spawnShockwave(targetGroup.position, '#f0716b')
    } else if (event.result === 'block') {
      const blockedGroup = nodeMeshes.get(event.blockedAt ?? event.targetId) ?? nodeMeshes.get(event.targetId)
      if (blockedGroup) {
        spawnBurst(blockedGroup.position, '#62d3a5', Math.round(activeQuality.burstCount * 0.6))
        spawnShockwave(blockedGroup.position, '#62d3a5')
      }
    }
  }
  if (event?.result === 'block') {
    placeBlockMarker(event)
    blockMarkerTimer = setTimeout(clearBlockMarker, 1450)
  }
})

onMounted(init)
onBeforeUnmount(() => {
  cancelAnimationFrame(animationFrame)
  if (nodeFocusAnimation) cancelAnimationFrame(nodeFocusAnimation)
  if (blockMarkerTimer) clearTimeout(blockMarkerTimer)
  clearBlockMarker()
  resizeObserver?.disconnect()
  if (renderer) {
    const canvas = renderer.domElement
    canvas.removeEventListener('pointerdown', onPointerDown)
    canvas.removeEventListener('pointermove', onPointerMove)
    canvas.removeEventListener('pointerup', onPointerUp)
    canvas.removeEventListener('click', onClick)
  }
  controls?.dispose()
  scene?.children.slice().forEach((child) => disposeObject(child))
  composer?.dispose()
  composer = undefined
  bloomPass = undefined
  environmentTexture?.dispose()
  environmentTexture = undefined
  pmremGenerator?.dispose()
  pmremGenerator = undefined
  statusColorCache.clear()
  renderer?.dispose()
  renderer?.domElement.remove()
  labelRenderer?.domElement.remove()
  nodeMeshes.clear()
  edgeLines.clear()
  edgeCurves.clear()
  edgeFlowDots.clear()
  edgeFlowPhases.clear()
  nodeGroundGlows.clear()
  zoneOutlineMaterials = []
  sceneFx = []
})

defineExpose({ fitCameraToTopology })
</script>

<template>
  <div ref="host" class="network-scene" :class="{ 'scene-editable': editable, 'scene-compact-labels': compactLabels, 'scene-minimal-ui': minimalUi }">
    <div v-if="!isReady" class="scene-loading"><span class="scene-loading-orbit"></span><span>正在构建网络场景…</span></div>
    <div v-if="!minimalUi" class="scene-tools"><span>网络拓扑</span><span class="scene-tools-divider"></span><span>拖拽旋转</span><span>滚轮缩放</span><span v-if="editable">拖动节点编辑布局</span></div>
    <div v-if="!minimalUi" class="scene-compass"><span>N</span><i></i><small>XYZ</small></div>
    <div v-if="!minimalUi" class="scene-legend"><span><i class="legend-normal"></i>正常</span><span><i class="legend-risk"></i>受影响</span><span><i class="legend-block"></i>已拦截</span></div>
  </div>
</template>
