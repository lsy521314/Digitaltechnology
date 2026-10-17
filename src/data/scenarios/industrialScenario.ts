import type { DeviceRole, FirewallPolicy, FirewallRule, NetworkEdge, NetworkInterface, NetworkNode, NetworkService, NetworkZone, RouteEntry, ServiceId, VlanDefinition } from '../../types/network'
import type { Scenario } from '../../types/scenario'

const node = (id: string, name: string, type: NetworkNode['type'], deviceRole: DeviceRole, zone: NetworkZone, position: NetworkNode['position'], ip: string, description: string, options: Partial<NetworkNode> = {}): NetworkNode => ({
  id, name, type, deviceRole, zone, position, ip, description,
  status: 'normal', isCritical: false, protectionEnabled: false, isolationEnabled: false, ...options,
})

const intf = (id: string, nodeId: string, name: string, kind: NetworkInterface['kind'], options: Partial<NetworkInterface> = {}): NetworkInterface => ({ id, nodeId, name, kind, enabled: true, ...options })
const link = (id: string, source: string, target: string, sourceInterfaceId: string, targetInterfaceId: string): NetworkEdge => ({ id, source, target, sourceInterfaceId, targetInterfaceId, enabled: true })
const zone = (value: NetworkZone): FirewallRule['source'] => ({ kind: 'ZONE', zone: value })
const host = (nodeId: string): FirewallRule['source'] => ({ kind: 'NODE', nodeId })
const rule = (id: string, firewallId: string, order: number, name: string, source: FirewallRule['source'], destination: FirewallRule['destination'], serviceId: FirewallRule['serviceId'], action: FirewallRule['action'], enabled = true): FirewallRule => ({ id, firewallId, order, name, source, destination, serviceId, action, enabled })

const icsservices: NetworkService[] = (['WEB', 'MAIL', 'DATABASE', 'FILE', 'INTERNAL'] as ServiceId[]).map((serviceId) => ({
  serviceId, name: serviceId, transport: 'TO_BE_VERIFIED', destinationPort: 'TO_BE_VERIFIED', verificationStatus: 'TO_BE_VERIFIED',
}))

const icsNodes: NetworkNode[] = [
  node('internet', 'Internet', 'Internet', 'EXTERNAL_NETWORK', 'Internet', { x: -18, y: .4, z: 6 }, '203.0.113.5', '教学实验外部网络来源（本次不发起请求，仅展示边界）。'),
  node('edge-fw', 'Edge Firewall', 'Firewall', 'FIREWALL', 'Control', { x: -13, y: .65, z: 6 }, '203.0.113.254', '工厂边界防火墙，连接互联网与控制核心。'),
  node('core', 'Core Switch', 'Router', 'L3_SWITCH', 'Control', { x: -8, y: .55, z: 6 }, '192.168.10.1', '控制中心核心三层交换机，承载 VLAN 网关与区域间静态路由。'),
  node('control-sw', 'Control Switch', 'Switch', 'L2_SWITCH', 'Control', { x: -4, y: .35, z: 5 }, '192.168.10.2', '控制中心二层交换节点，连接操作员站与工程师站。'),
  node('hmi', 'Operator HMI', 'Workstation', 'ENDPOINT', 'Control', { x: -1, y: .55, z: 6 }, '192.168.10.21', '操作员人机界面终端，实验开始前已受到影响的初始失陷点。', { services: ['INTERNAL'] }),
  node('eng', 'Engineer Station', 'Workstation', 'ENDPOINT', 'Control', { x: -1, y: .55, z: 4 }, '192.168.10.22', '工程师站，用于组态与维护。', { services: ['INTERNAL'] }),
  node('industrial-fw', 'Industrial Firewall', 'Firewall', 'FIREWALL', 'Control', { x: -4, y: .65, z: 0 }, '10.0.254.2', '工控网络区域边界防火墙：隔离控制中心、监控服务器区、现场设备区与历史数据区。'),
  node('scada-sw', 'SCADA Switch', 'Switch', 'L2_SWITCH', 'Server', { x: 1, y: .35, z: 1 }, '192.168.30.2', '监控服务器区二层交换节点。'),
  node('scada', 'SCADA Server', 'Server', 'ENDPOINT', 'Server', { x: 4, y: .7, z: 0 }, '192.168.30.10', 'SCADA 监控服务器：负责数据采集、画面发布与归档。', { services: ['DATABASE'] }),
  node('file', 'Process File Server', 'Server', 'ENDPOINT', 'Server', { x: 4, y: .7, z: 2 }, '192.168.30.20', '生产报表与文件服务器。', { services: ['FILE'] }),
  node('field-sw', 'Field Switch', 'Switch', 'L2_SWITCH', 'Field', { x: 1, y: .35, z: -4 }, '192.168.40.2', '现场设备区二层交换节点。'),
  node('plc1', 'PLC-01 Pump', 'Server', 'ENDPOINT', 'Field', { x: 4, y: .7, z: -5 }, '192.168.40.11', '循环水泵控制器 PLC-01，接收 SCADA 控制指令。', { services: ['INTERNAL'] }),
  node('plc2', 'PLC-02 Line', 'Server', 'ENDPOINT', 'Field', { x: 4, y: .7, z: -7 }, '192.168.40.12', '生产线控制器 PLC-02。', { services: ['INTERNAL'] }),
  node('rtu', 'RTU Gateway', 'Server', 'ENDPOINT', 'Field', { x: 4, y: .7, z: -3 }, '192.168.40.13', '数据采集与遥测终端 RTU。', { services: ['INTERNAL'] }),
  node('his-sw', 'Historian Switch', 'Switch', 'L2_SWITCH', 'Historian', { x: 2, y: .35, z: -8 }, '192.168.50.2', '历史数据区独立二层交换节点。'),
  node('historian', 'Historian Database', 'Database', 'ENDPOINT', 'Historian', { x: 5, y: .75, z: -10 }, '192.168.50.10', '历史数据库：保存工艺运行记录，仅允许最小必要访问。', { isCritical: true, services: ['DATABASE'] }),
]

const icsInterfaces: NetworkInterface[] = [
  intf('internet-nic', 'internet', 'outside-net', 'ENDPOINT_NIC', { ipv4Address: '203.0.113.5', prefixLength: 24 }),
  intf('edge-wan', 'edge-fw', 'wan', 'L3_INTERFACE', { ipv4Address: '203.0.113.254', prefixLength: 24 }),
  intf('edge-core', 'edge-fw', 'to-core', 'L3_INTERFACE', { ipv4Address: '10.0.255.2', prefixLength: 30 }),
  intf('core-edge', 'core', 'to-edge-fw', 'L3_INTERFACE', { ipv4Address: '10.0.255.1', prefixLength: 30 }),
  intf('core-ifw', 'core', 'to-industrial-fw', 'L3_INTERFACE', { ipv4Address: '10.0.254.1', prefixLength: 30 }),
  intf('core-ctrl-port', 'core', 'control-uplink', 'SWITCH_PORT', { switchportMode: 'TRUNK', allowedVlanIds: [10] }),
  intf('core-ctrl-gw', 'core', 'vlan10-gateway', 'VLAN_GATEWAY', { ipv4Address: '192.168.10.1', prefixLength: 24, vlanId: 10, parentInterfaceId: 'core-ctrl-port' }),
  intf('ctrl-core-port', 'control-sw', 'core-uplink', 'SWITCH_PORT', { switchportMode: 'TRUNK', allowedVlanIds: [10] }),
  intf('ctrl-hmi-port', 'control-sw', 'hmi-port', 'SWITCH_PORT', { switchportMode: 'ACCESS', accessVlanId: 10 }),
  intf('ctrl-eng-port', 'control-sw', 'eng-port', 'SWITCH_PORT', { switchportMode: 'ACCESS', accessVlanId: 10 }),
  intf('hmi-nic', 'hmi', 'eth0', 'ENDPOINT_NIC', { ipv4Address: '192.168.10.21', prefixLength: 24, vlanId: 10 }),
  intf('eng-nic', 'eng', 'eth0', 'ENDPOINT_NIC', { ipv4Address: '192.168.10.22', prefixLength: 24, vlanId: 10 }),
  intf('ifw-core', 'industrial-fw', 'to-core', 'L3_INTERFACE', { ipv4Address: '10.0.254.2', prefixLength: 30 }),
  intf('ifw-scada-port', 'industrial-fw', 'scada-gateway', 'L3_INTERFACE', { ipv4Address: '192.168.30.1', prefixLength: 24, vlanId: 30 }),
  intf('ifw-field-port', 'industrial-fw', 'field-gateway', 'L3_INTERFACE', { ipv4Address: '192.168.40.1', prefixLength: 24, vlanId: 40 }),
  intf('ifw-his-port', 'industrial-fw', 'historian-gateway', 'L3_INTERFACE', { ipv4Address: '192.168.50.1', prefixLength: 24, vlanId: 50 }),
  intf('scada-fw-port', 'scada-sw', 'firewall-uplink', 'SWITCH_PORT', { switchportMode: 'TRUNK', allowedVlanIds: [30] }),
  intf('scada-scada-port', 'scada-sw', 'scada-port', 'SWITCH_PORT', { switchportMode: 'ACCESS', accessVlanId: 30 }),
  intf('scada-file-port', 'scada-sw', 'file-port', 'SWITCH_PORT', { switchportMode: 'ACCESS', accessVlanId: 30 }),
  intf('scada-nic', 'scada', 'eth0', 'ENDPOINT_NIC', { ipv4Address: '192.168.30.10', prefixLength: 24, vlanId: 30 }),
  intf('file-nic', 'file', 'eth0', 'ENDPOINT_NIC', { ipv4Address: '192.168.30.20', prefixLength: 24, vlanId: 30 }),
  intf('field-fw-port', 'field-sw', 'firewall-uplink', 'SWITCH_PORT', { switchportMode: 'TRUNK', allowedVlanIds: [40] }),
  intf('field-plc1-port', 'field-sw', 'plc1-port', 'SWITCH_PORT', { switchportMode: 'ACCESS', accessVlanId: 40 }),
  intf('field-plc2-port', 'field-sw', 'plc2-port', 'SWITCH_PORT', { switchportMode: 'ACCESS', accessVlanId: 40 }),
  intf('field-rtu-port', 'field-sw', 'rtu-port', 'SWITCH_PORT', { switchportMode: 'ACCESS', accessVlanId: 40 }),
  intf('plc1-nic', 'plc1', 'eth0', 'ENDPOINT_NIC', { ipv4Address: '192.168.40.11', prefixLength: 24, vlanId: 40 }),
  intf('plc2-nic', 'plc2', 'eth0', 'ENDPOINT_NIC', { ipv4Address: '192.168.40.12', prefixLength: 24, vlanId: 40 }),
  intf('rtu-nic', 'rtu', 'eth0', 'ENDPOINT_NIC', { ipv4Address: '192.168.40.13', prefixLength: 24, vlanId: 40 }),
  intf('his-fw-port', 'his-sw', 'firewall-uplink', 'SWITCH_PORT', { switchportMode: 'TRUNK', allowedVlanIds: [50] }),
  intf('his-db-port', 'his-sw', 'db-port', 'SWITCH_PORT', { switchportMode: 'ACCESS', accessVlanId: 50 }),
  intf('historian-nic', 'historian', 'eth0', 'ENDPOINT_NIC', { ipv4Address: '192.168.50.10', prefixLength: 24, vlanId: 50 }),
]

const icsEdges: NetworkEdge[] = [
  link('l-internet-edge', 'internet', 'edge-fw', 'internet-nic', 'edge-wan'),
  link('l-edge-core', 'edge-fw', 'core', 'edge-core', 'core-edge'),
  link('l-core-control', 'core', 'control-sw', 'core-ctrl-port', 'ctrl-core-port'),
  link('l-core-ifw', 'core', 'industrial-fw', 'core-ifw', 'ifw-core'),
  link('l-ctrl-hmi', 'control-sw', 'hmi', 'ctrl-hmi-port', 'hmi-nic'),
  link('l-ctrl-eng', 'control-sw', 'eng', 'ctrl-eng-port', 'eng-nic'),
  link('l-ifw-scada', 'industrial-fw', 'scada-sw', 'ifw-scada-port', 'scada-fw-port'),
  link('l-ifw-field', 'industrial-fw', 'field-sw', 'ifw-field-port', 'field-fw-port'),
  link('l-ifw-his', 'industrial-fw', 'his-sw', 'ifw-his-port', 'his-fw-port'),
  link('l-scada-scada', 'scada-sw', 'scada', 'scada-scada-port', 'scada-nic'),
  link('l-scada-file', 'scada-sw', 'file', 'scada-file-port', 'file-nic'),
  link('l-field-plc1', 'field-sw', 'plc1', 'field-plc1-port', 'plc1-nic'),
  link('l-field-plc2', 'field-sw', 'plc2', 'field-plc2-port', 'plc2-nic'),
  link('l-field-rtu', 'field-sw', 'rtu', 'field-rtu-port', 'rtu-nic'),
  link('l-his-db', 'his-sw', 'historian', 'his-db-port', 'historian-nic'),
]

const icsVlans: VlanDefinition[] = [
  { id: 10, name: 'Control', zone: 'Control', subnetCidr: '192.168.10.0/24', gatewayInterfaceId: 'core-ctrl-gw' },
  { id: 30, name: 'SCADA', zone: 'Server', subnetCidr: '192.168.30.0/24', gatewayInterfaceId: 'ifw-scada-port' },
  { id: 40, name: 'Field', zone: 'Field', subnetCidr: '192.168.40.0/24', gatewayInterfaceId: 'ifw-field-port' },
  { id: 50, name: 'Historian', zone: 'Historian', subnetCidr: '192.168.50.0/24', gatewayInterfaceId: 'ifw-his-port' },
]

const icsRoutes: RouteEntry[] = [
  { id: 'core-to-scada', deviceId: 'core', kind: 'STATIC', destinationCidr: '192.168.30.0/24', nextHopIp: '10.0.254.2', outInterfaceId: 'core-ifw' },
  { id: 'core-to-field', deviceId: 'core', kind: 'STATIC', destinationCidr: '192.168.40.0/24', nextHopIp: '10.0.254.2', outInterfaceId: 'core-ifw' },
  { id: 'core-to-his', deviceId: 'core', kind: 'STATIC', destinationCidr: '192.168.50.0/24', nextHopIp: '10.0.254.2', outInterfaceId: 'core-ifw' },
  { id: 'core-default', deviceId: 'core', kind: 'DEFAULT', destinationCidr: '0.0.0.0/0', nextHopIp: '10.0.255.2', outInterfaceId: 'core-edge' },
  { id: 'edge-to-control', deviceId: 'edge-fw', kind: 'STATIC', destinationCidr: '192.168.10.0/24', nextHopIp: '10.0.255.1', outInterfaceId: 'edge-core' },
  { id: 'edge-default', deviceId: 'edge-fw', kind: 'DEFAULT', destinationCidr: '0.0.0.0/0', outInterfaceId: 'edge-wan' },
  { id: 'ifw-to-control', deviceId: 'industrial-fw', kind: 'STATIC', destinationCidr: '192.168.10.0/24', nextHopIp: '10.0.254.1', outInterfaceId: 'ifw-core' },
  { id: 'ifw-default', deviceId: 'industrial-fw', kind: 'DEFAULT', destinationCidr: '0.0.0.0/0', nextHopIp: '10.0.254.1', outInterfaceId: 'ifw-core' },
]

const icsFirewallPolicies: FirewallPolicy[] = [
  {
    firewallId: 'edge-fw', defaultAction: 'DENY', rules: [
      rule('edge-10-control-outbound', 'edge-fw', 10, '控制中心允许访问外网', zone('Control'), zone('Internet'), 'WEB', 'ALLOW'),
    ],
  },
  {
    firewallId: 'industrial-fw', defaultAction: 'DENY', rules: [
      rule('ics-10-hmi-scada', 'industrial-fw', 10, '操作员站访问 SCADA 监控画面', host('hmi'), host('scada'), 'DATABASE', 'ALLOW'),
      rule('ics-20-scada-plc1', 'industrial-fw', 20, 'SCADA 向水泵 PLC-01 下发控制指令', host('scada'), host('plc1'), 'INTERNAL', 'ALLOW'),
      rule('ics-30-scada-plc2', 'industrial-fw', 30, 'SCADA 向产线 PLC-02 下发控制指令', host('scada'), host('plc2'), 'INTERNAL', 'ALLOW'),
      rule('ics-40-scada-historian', 'industrial-fw', 40, 'SCADA 直接访问历史数据库（错误放行）', host('scada'), host('historian'), 'DATABASE', 'ALLOW'),
      rule('ics-50-control-historian-deny', 'industrial-fw', 50, '控制中心禁止访问历史数据区', zone('Control'), zone('Historian'), 'ANY', 'DENY'),
      rule('ics-60-field-control-deny', 'industrial-fw', 60, '现场设备区禁止访问控制中心', zone('Field'), zone('Control'), 'ANY', 'DENY'),
      rule('ics-70-field-server-deny', 'industrial-fw', 70, '现场设备区禁止访问监控服务器区', zone('Field'), zone('Server'), 'ANY', 'DENY'),
    ],
  },
]

const icsBusinessPaths = [
  { id: 'hmi-scada-monitor', sourceId: 'hmi', targetId: 'scada', service: 'DATABASE' as const, label: 'Operator HMI 访问 SCADA 监控画面' },
  { id: 'scada-plc-pump', sourceId: 'scada', targetId: 'plc1', service: 'INTERNAL' as const, label: 'SCADA Server 向 PLC-01 下发控制指令' },
]

export const industrialScenario: Scenario = {
  id: 'industrial-ics', name: '工业控制网：SCADA/PLC 横向蔓延', shortName: '工业控制网',
  description: '仿真开始前，控制中心 Operator HMI 已进入受影响状态。失陷移动面沿控制中心、监控服务器区向现场 PLC 与历史数据区横向扩散；工业防火墙负责区域隔离，请找出错误放行并封堵历史数据的横向路径，同时保持监控与控制指令业务。',
  difficulty: '挑战', duration: '约 10 分钟', accent: '#c28452',
  nodes: icsNodes, interfaces: icsInterfaces, edges: icsEdges, vlans: icsVlans, routes: icsRoutes, services: icsservices, firewallPolicies: icsFirewallPolicies,
  initialEvents: [{ id: 'seed-hmi', type: 'seed', sourceId: 'hmi', targetId: 'hmi', service: 'INTERNAL', message: '实验初始条件：Operator HMI 在仿真开始前已进入受影响状态。' }],
  learningObjectives: ['理解 OT 网络分区（控制中心 / 监控层 / 现场层 / 历史数据区）的隔离意义', '识别错误的直连放行规则如何绕过区域拒绝策略', '在保持 SCADA 控制指令业务的同时封堵横向移动路径'],
  businessPaths: icsBusinessPaths,
  challenge: { title: '保护 Historian 历史数据库', description: '调整工业防火墙规则：封堵失陷终端向历史数据库的横向移动，同时保持 SCADA 监控画面与控制指令业务。', protectedNodeId: 'historian', requiredBusinessPathIds: ['hmi-scada-monitor', 'scada-plc-pump'] },
}