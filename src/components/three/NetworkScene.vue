<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { CSS2DObject, CSS2DRenderer } from 'three/addons/renderers/CSS2DRenderer.js'
import type { NetworkNode, NodeStatus } from '../../types/network'
import type { Scenario } from '../../types/scenario'
import type { SimulationEvent } from '../../types/simulation'

const props = withDefaults(defineProps<{
  scenario: Scenario
  statuses?: Record<string, NodeStatus> | null
  events?: SimulationEvent[]
  activeIndex?: number
  selectedNodeId?: string | null
  showLabels?: boolean
  compactLabels?: boolean
  minimalUi?: boolean
  editable?: boolean
  modelScale?: number
  fitRequest?: number
  focusMode?: boolean
}>(), {
  statuses: null,
  events: () => [],
  activeIndex: -1,
  selectedNodeId: null,
  showLabels: true,
  compactLabels: false,
  minimalUi: false,
  editable: false,
  modelScale: 1.08,
  fitRequest: 0,
  focusMode: false,
})

const emit = defineEmits<{
  selectNode: [id: string]
  moveNode: [id: string, position: NetworkNode['position']]
}>()

const host = ref<HTMLDivElement>()
const isReady = ref(false)
let renderer: THREE.WebGLRenderer | undefined
let labelRenderer: CSS2DRenderer | undefined
let scene: THREE.Scene | undefined
let topologyRoot: THREE.Group | undefined
let camera: THREE.PerspectiveCamera | undefined
let controls: OrbitControls | undefined
let animationFrame = 0
let resizeObserver: ResizeObserver | undefined
let raycaster: THREE.Raycaster | undefined
let pointer = new THREE.Vector2()
let plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0)
let dragPoint = new THREE.Vector3()
let draggingId: string | undefined
let hoveredId: string | undefined
let userAdjustedCamera = false
let fitDistance = 1
let labelLod: 'near' | 'normal' | 'far' = 'normal'
let lastLodDistance = 0
let selectedId: string | null = null
let nodeMeshes = new Map<string, THREE.Group>()
let edgeLines = new Map<string, THREE.Line>()
let edgeDots = new Map<string, THREE.Mesh>()
let labels = new Map<string, CSS2DObject>()
let nodePositions = new Map<string, THREE.Vector3>()
let packets: THREE.Mesh[] = []
let activeEdgeLines: THREE.Line[] = []
let activeRouteNodeIds = new Set<string>()
let eventStartedAt = performance.now()
let blockMarkerTimer: ReturnType<typeof setTimeout> | undefined
let blockMarker: CSS2DObject | undefined

const zoneStyles = {
  Internet: { label: '外部网络', color: '#4b91b8' },
  DMZ: { label: 'DMZ', color: '#58a99f' },
  Office: { label: '办公区', color: '#3d91a5' },
  Server: { label: '服务器区', color: '#5e86bd' },
  Database: { label: '数据区', color: '#8b78bf' },
}
const primaryLabelNames = new Set(['Firewall', 'Public Web Server', 'Application Server', 'Customer Database', 'Office-PC-01'])
const secondaryLabelNames = new Set(['Mail Server', 'File Server', 'Office-PC-02', 'Office-PC-03', 'Office-PC-04'])

function getZoneBounds() {
  if (props.scenario.id === 'lateral') {
    return [
      { id: 'Internet' as const, ...zoneStyles.Internet, centerX: -8.3, centerZ: 0, width: 9.2, depth: 5.2 },
      { id: 'DMZ' as const, ...zoneStyles.DMZ, centerX: -1.1, centerZ: -3.2, width: 5.3, depth: 5.5 },
      { id: 'Office' as const, ...zoneStyles.Office, centerX: 3, centerZ: 1.5, width: 7, depth: 9.5 },
      { id: 'Server' as const, ...zoneStyles.Server, centerX: 7.2, centerZ: -2.8, width: 7.4, depth: 6.9 },
      { id: 'Database' as const, ...zoneStyles.Database, centerX: 12.1, centerZ: 0, width: 5.1, depth: 6.2 },
    ]
  }
  return (Object.keys(zoneStyles) as (keyof typeof zoneStyles)[]).flatMap((id) => {
    const members = props.scenario.nodes.filter((node) => node.zone === id)
    if (!members.length) return []
    const positions = members.map(displayPosition)
    const xs = positions.map((position) => position.x)
    const zs = positions.map((position) => position.z)
    const style = zoneStyles[id]
    return [{ id, ...style, centerX: (Math.min(...xs) + Math.max(...xs)) / 2, centerZ: (Math.min(...zs) + Math.max(...zs)) / 2, width: Math.max(3.2, Math.max(...xs) - Math.min(...xs) + 2.1), depth: Math.max(5.2, Math.max(...zs) - Math.min(...zs) + 2.1) }]
  })
}

function displayPosition(node: NetworkNode): THREE.Vector3 {
  const position = node.position
  if (props.scenario.id !== 'lateral') return new THREE.Vector3(position.x, position.y, position.z)
  const x = position.x * 0.58
  if (node.zone === 'Internet') {
    const lift = node.type === 'Internet' ? -0.12 : node.type === 'Firewall' ? 0.26 : node.type === 'Switch' ? 0.08 : 0.16
    return new THREE.Vector3(x, position.y + lift, (position.x + 14) * 0.1)
  }
  if (node.zone === 'DMZ') return new THREE.Vector3(x, position.y + 0.14, position.z * 1.12 - 3.2)
  if (node.zone === 'Office') return new THREE.Vector3(x, position.y + 0.06, position.z * 1.15 + 1.5)
  if (node.zone === 'Server') return new THREE.Vector3(x, position.y + 0.48, position.z * 1.12 - 2.8)
  return new THREE.Vector3(x, position.y + 0.24, position.z)
}

function colorForStatus(status: NodeStatus | undefined, type: NetworkNode['type']): THREE.Color {
  if (status === 'compromised') return new THREE.Color('#f06c68')
  if (status === 'warning') return new THREE.Color('#e9b65e')
  if (status === 'isolated') return new THREE.Color('#798391')
  if (status === 'protected') status = 'normal'
  if (type === 'Database') return new THREE.Color('#84a5e7')
  if (type === 'Server') return new THREE.Color('#58bfd2')
  if (type === 'Firewall') return new THREE.Color('#e2ae65')
  return new THREE.Color('#53bcd0')
}

function material(color: THREE.ColorRepresentation, emissive?: THREE.ColorRepresentation) {
  return new THREE.MeshStandardMaterial({ color, metalness: 0.35, roughness: 0.48, emissive: emissive ?? color, emissiveIntensity: 0.13 })
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
  const outline = new THREE.Line(new THREE.BufferGeometry().setFromPoints(outlinePoints), new THREE.LineBasicMaterial({ color: zone.color, transparent: true, opacity: 0.36 }))
  target.add(outline)
  const cornerMaterial = new THREE.LineBasicMaterial({ color: zone.color, transparent: true, opacity: 0.3 })
  for (const [x, z] of [[zone.centerX - zone.width / 2, farZ], [zone.centerX + zone.width / 2, farZ], [zone.centerX + zone.width / 2, nearZ], [zone.centerX - zone.width / 2, nearZ]]) {
    target.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(x!, 0.06, z!), new THREE.Vector3(x!, 0.32, z!)]), cornerMaterial.clone()))
  }
  const labelEl = document.createElement('div')
  labelEl.className = 'zone-label'
  labelEl.innerHTML = `<small>${zone.id.toUpperCase()} ZONE</small><strong>${zone.label}</strong>`
  const label = new CSS2DObject(labelEl)
  label.position.set(zone.centerX, 0.18, nearZ + 0.18)
  target.add(label)
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
    'Office-PC-04': 'PC-04',
    'Server Switch': '服务器交换机',
    'Application Server': '应用服务器',
    'File Server': '文件服务器',
    'Customer Database': '客户数据库',
    'Finance Database': '财务数据库',
    'Perimeter Firewall': '边界防火墙',
    'Edge Firewall': '边界防火墙',
    'Office Endpoint': '办公终端',
  } as Record<string, string>)[node.name] ?? node.name
  el.innerHTML = `<span class="network-node-label-main"></span><span class="network-node-status-badge" aria-hidden="true"></span>`
  el.querySelector('.network-node-label-main')!.textContent = compactName
  const label = new CSS2DObject(el)
  const labelHeight = node.type === 'Switch' ? 1.25 : node.type === 'Database' ? 2.08 : node.type === 'Firewall' ? 1.95 : node.type === 'Server' ? 2.05 : 1.78
  label.position.set(0, labelHeight, 0)
  label.userData.nodeId = node.id
  label.userData.labelPriority = primaryLabelNames.has(node.name) ? 1 : secondaryLabelNames.has(node.name) ? 2 : 3
  el.addEventListener('mouseenter', () => {
    hoveredId = node.id
    label.element.classList.add('node-label-hovered')
    updateLabelLod(true)
  })
  el.addEventListener('mouseleave', () => {
    if (hoveredId === node.id) hoveredId = undefined
    label.element.classList.remove('node-label-hovered')
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
  edgeDots = new Map()
  labels = new Map()
  topologyRoot = new THREE.Group()
  topologyRoot.name = 'network-topology-bounds'
  scene.add(topologyRoot)
  nodePositions = new Map(props.scenario.nodes.map((node) => [node.id, displayPosition(node)]))
  packets = []
  activeEdgeLines = []
  activeRouteNodeIds = new Set()
  scene.fog = new THREE.Fog('#07111f', 19, 39)
  scene.background = new THREE.Color('#07111f')
  scene.add(new THREE.HemisphereLight('#b5dbe8', '#132438', 1.55))
  const keyLight = new THREE.DirectionalLight('#d5ecf5', 2.4)
  keyLight.position.set(-4, 11, 6)
  keyLight.castShadow = true
  keyLight.shadow.mapSize.set(1024, 1024)
  scene.add(keyLight)
  const fill = new THREE.PointLight('#3f95b4', 28, 26)
  fill.position.set(2, 5, -6)
  scene.add(fill)

  const ground = new THREE.Mesh(new THREE.PlaneGeometry(52, 25), new THREE.MeshStandardMaterial({ color: '#081522', metalness: 0.12, roughness: 0.95 }))
  ground.rotation.x = -Math.PI / 2
  ground.position.y = -0.025
  ground.receiveShadow = true
  scene.add(ground)
  const grid = new THREE.GridHelper(50, 50, '#194253', '#102b3a')
  grid.position.y = 0.005
  grid.material.transparent = true
  grid.material.opacity = 0.2
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
    const a = source.position.clone().add(new THREE.Vector3(0, 0.48, 0))
    const b = target.position.clone().add(new THREE.Vector3(0, 0.48, 0))
    const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints([a, b]), new THREE.LineDashedMaterial({ color: edge.enabled ? '#3e91a9' : '#53606a', dashSize: 0.2, gapSize: 0.1, transparent: true, opacity: edge.enabled ? 0.72 : 0.32 }))
    line.computeLineDistances()
    topologyRoot.add(line)
    edgeLines.set(edge.id, line)
    const dot = new THREE.Mesh(new THREE.SphereGeometry(0.055, 10, 8), new THREE.MeshBasicMaterial({ color: '#67c7d8', transparent: true, opacity: edge.enabled ? 0.84 : 0.24 }))
    topologyRoot.add(dot)
    edgeDots.set(edge.id, dot)
  }
  syncSelection()
  syncLabels()
  updateLabelLod(true)
}

function fitCameraToTopology() {
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
  const viewDirection = new THREE.Vector3(0.18, 0.68, 0.72).normalize()
  const right = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), viewDirection).normalize()
  const viewUp = new THREE.Vector3().crossVectors(viewDirection, right).normalize()
  const halfVerticalFov = THREE.MathUtils.degToRad(camera.fov / 2)
  const halfHorizontalFov = Math.atan(Math.tan(halfVerticalFov) * Math.max(camera.aspect, 0.1))
  const fillWidth = 0.92
  const fillHeight = 0.84
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
  const aspectZoom = THREE.MathUtils.clamp(camera.aspect / 1.85, 1, 1.25)
  const focusZoom = props.focusMode ? 1.15 : 1
  fitDistance = Math.max(8, requiredDistance * 1.035 / (aspectZoom * focusZoom))
  if (scene?.fog instanceof THREE.Fog) {
    scene.fog.near = Math.max(28, fitDistance * 1.05)
    scene.fog.far = Math.max(62, fitDistance * 2.6)
  }
  const fitTarget = center.clone().addScaledVector(viewUp, -0.45)
  controls.target.copy(fitTarget)
  camera.position.copy(fitTarget).addScaledVector(viewDirection, fitDistance)
  camera.lookAt(fitTarget)
  controls.minDistance = Math.max(4, fitDistance * 0.18)
  controls.maxDistance = Math.max(48, fitDistance * 2.35)
  userAdjustedCamera = false
  controls.update()
  updateLabelLod(true)
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
    const visibleByLod = labelLod === 'near' || (labelLod === 'normal' && priority <= 2) || (labelLod === 'far' && priority === 1)
    const keepVisible = visibleByLod || id === hoveredId || id === selectedId
    label.element.classList.toggle('lod-hidden', !props.showLabels || !keepVisible)
  })
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
    const routeDimmed = activeRouteNodeIds.size > 0 && !activeRouteNodeIds.has(node.id)
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
    edgeLines.forEach((line) => {
      const material = line.material as THREE.LineDashedMaterial
      material.color.set('#3e91a9')
      material.opacity = 0.72
    })
    edgeDots.forEach((dot) => (dot.visible = false))
    activeEdgeLines = []
    return
  }
  activeRouteNodeIds = event.routeEdgeIds.length > 0 ? new Set(event.route) : new Set()
  if (!packets.length) {
    packets = Array.from({ length: 1 }, () => {
      const packet = new THREE.Mesh(new THREE.SphereGeometry(0.18, 14, 12), new THREE.MeshBasicMaterial({ color: '#f0716b', transparent: true, opacity: 1 }))
      scene!.add(packet)
      return packet
    })
  }
  const routeGroups = event.route.map((id) => nodeMeshes.get(id)).filter((group): group is THREE.Group => Boolean(group))
  const points = routeGroups.map((group) => group.position.clone().add(new THREE.Vector3(0, 0.6, 0)))
  if (event.routeEdgeIds.length === 0 || points.length < 2) packets.forEach((packet) => (packet.visible = false))
  const duration = 900
  const elapsed = Math.max(0, Math.min(duration, time - eventStartedAt))
  const tint = event.result === 'block' ? '#70d9a9' : event.result === 'compromise' ? '#f0716b' : '#75c9dc'
  edgeLines.forEach((line) => {
    const material = line.material as THREE.LineDashedMaterial
    material.color.set('#3e91a9')
    material.opacity = 0.16
  })
  edgeDots.forEach((dot) => (dot.visible = false))
  activeEdgeLines.forEach((line) => {
    const material = line.material as THREE.LineDashedMaterial
    material.color.set('#3e91a9')
    material.opacity = 0.16
  })
  activeEdgeLines = event.routeEdgeIds.map((id) => edgeLines.get(id)).filter((line): line is THREE.Line => Boolean(line))
  activeEdgeLines.forEach((line) => {
    const material = line.material as THREE.LineDashedMaterial
    material.color.set(tint)
    material.opacity = 0.98
  })
  const blockedAtNode = props.scenario.nodes.some((node) => node.id === event.blockedAt || node.name === event.blockedAt)
  const routeStop = event.result === 'block' && !blockedAtNode && points.length > 1
    ? (points.length - 2 + 0.82) / (points.length - 1)
    : 1
  packets.forEach((packet) => {
    if (points.length < 2 || event.result === 'info' || event.routeEdgeIds.length === 0) {
      packet.visible = false
      return
    }
    const progress = Math.min(routeStop, elapsed / duration * routeStop)
    const scaledProgress = progress * (points.length - 1)
    const segment = Math.min(points.length - 2, Math.floor(scaledProgress))
    const from = points[segment]!
    const to = points[segment + 1]!
    packet.position.copy(from).lerp(to, scaledProgress - segment)
    packet.visible = true
    ;(packet.material as THREE.MeshBasicMaterial).color.set(tint)
  })
  if (event.result === 'block') {
    const targetGroup = nodeMeshes.get(event.targetId)
    if (targetGroup && blockedAtNode) {
      const baseScale = Number(targetGroup.userData.baseScale) || props.modelScale
      targetGroup.scale.setScalar(baseScale * (1 + Math.max(0, Math.sin(elapsed / duration * Math.PI * 3)) * 0.045))
    }
  }
}

function animate(time: number) {
  animationFrame = requestAnimationFrame(animate)
  if (controls) controls.update()
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
  updateLabelLod()
  renderer?.render(scene!, camera!)
  labelRenderer?.render(scene!, camera!)
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
    line.geometry.dispose()
    line.geometry = new THREE.BufferGeometry().setFromPoints([
      aGroup.position.clone().add(new THREE.Vector3(0, 0.48, 0)),
      bGroup.position.clone().add(new THREE.Vector3(0, 0.48, 0)),
    ])
    line.computeLineDistances()
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
    if (node && props.scenario.id === 'lateral') {
      x /= 0.58
      if (node.zone === 'Internet') z -= (node.position.x + 14) * 0.1
      else if (node.zone === 'DMZ') z = (z + 3.2) / 1.12
      else if (node.zone === 'Office') z = (z - 1.5) / 1.15
      else if (node.zone === 'Server') z = (z + 2.8) / 1.12
    }
    emit('moveNode', id, { x: Number(x.toFixed(2)), y: node?.position.y ?? position.y, z: Number(z.toFixed(2)) })
  }
  if (renderer?.domElement.hasPointerCapture(event.pointerId)) renderer.domElement.releasePointerCapture(event.pointerId)
}

function selectNode(id: string) {
  emit('selectNode', id)
  selectedId = id
  labels.forEach((label, labelId) => label.element.classList.toggle('node-is-selected', labelId === id))
  syncStatuses(performance.now())
  const group = nodeMeshes.get(id)
  if (group && camera && controls) {
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
      if (t < 1) requestAnimationFrame(focus)
    }
    requestAnimationFrame(focus)
  }
}

function onClick(event: MouseEvent) {
  if (!renderer || draggingId) return
  const id = hitNode(event)
  if (id) selectNode(id)
}

function init() {
  if (!host.value) return
  const width = Math.max(1, host.value.clientWidth)
  const height = Math.max(1, host.value.clientHeight)
  scene = new THREE.Scene()
  camera = new THREE.PerspectiveCamera(38, width / height, 0.1, 180)
  camera.position.set(0, 25, 22)
  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.7))
  renderer.setSize(width, height)
  renderer.shadowMap.enabled = true
  renderer.shadowMap.type = THREE.PCFSoftShadowMap
  renderer.outputColorSpace = THREE.SRGBColorSpace
  renderer.toneMapping = THREE.ACESFilmicToneMapping
  renderer.toneMappingExposure = 1.05
  renderer.domElement.className = 'network-webgl'
  host.value.appendChild(renderer.domElement)

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
  controls.addEventListener('start', () => { userAdjustedCamera = true })
  controls.addEventListener('change', () => updateLabelLod())
  raycaster = new THREE.Raycaster()
  raycaster.params.Line!.threshold = 0.12
  rebuildScene()
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
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.7))
    camera.aspect = nextWidth / nextHeight
    camera.updateProjectionMatrix()
    renderer.setSize(nextWidth, nextHeight)
    labelRenderer.setSize(nextWidth, nextHeight)
    if (!userAdjustedCamera) requestAnimationFrame(fitCameraToTopology)
    else updateLabelLod(true)
  })
  resizeObserver.observe(host.value)
  animationFrame = requestAnimationFrame(animate)
}

watch(() => JSON.stringify({ id: props.scenario.id, nodes: props.scenario.nodes, edges: props.scenario.edges }), () => {
  userAdjustedCamera = false
  rebuildScene()
  requestAnimationFrame(fitCameraToTopology)
})
watch(() => props.fitRequest, () => requestAnimationFrame(fitCameraToTopology))
watch(() => props.statuses, () => syncStatuses(performance.now()), { deep: true })
watch(() => props.selectedNodeId, () => syncSelection())
watch(() => props.showLabels, syncLabels)
function clearBlockMarker() {
  if (blockMarker && scene) scene.remove(blockMarker)
  blockMarker = undefined
}

function placeBlockMarker(event: SimulationEvent) {
  clearBlockMarker()
  if (!scene || event.result !== 'block') return
  const element = document.createElement('div')
  element.className = 'path-block-marker'
  element.innerHTML = '<span class="path-block-shield">✓</span><strong>已阻断</strong>'
  const marker = new CSS2DObject(element)
  const blockedNode = props.scenario.nodes.find((node) => node.id === event.blockedAt || node.name === event.blockedAt)
  const target = nodeMeshes.get(blockedNode?.id ?? event.targetId)
  if (blockedNode && target) {
    marker.position.copy(target.position).add(new THREE.Vector3(0, 2.15, 0))
  } else {
    const edgeId = event.routeEdgeIds[event.routeEdgeIds.length - 1]
    const line = edgeId ? edgeLines.get(edgeId) : undefined
    const points = line?.geometry.attributes.position
    if (points && points.count >= 2) {
      const from = new THREE.Vector3().fromBufferAttribute(points, 0)
      const to = new THREE.Vector3().fromBufferAttribute(points, 1)
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
  if (blockMarkerTimer) clearTimeout(blockMarkerTimer)
  clearBlockMarker()
  if (event?.result === 'block') {
    placeBlockMarker(event)
    blockMarkerTimer = setTimeout(clearBlockMarker, 1450)
  }
})

onMounted(init)
onBeforeUnmount(() => {
  cancelAnimationFrame(animationFrame)
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
  renderer?.dispose()
  renderer?.domElement.remove()
  labelRenderer?.domElement.remove()
  nodeMeshes.clear()
  edgeLines.clear()
  edgeDots.clear()
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
