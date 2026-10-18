import type { DeviceRole, FirewallPolicy, FirewallRule, NetworkEdge, NetworkInterface, NetworkNode, NetworkService, NetworkZone, RouteEntry, ServiceId, VlanDefinition } from '../../types/network'
import type { Scenario } from '../../types/scenario'
import { industrialScenario } from './industrialScenario'

const node = (id: string, name: string, type: NetworkNode['type'], deviceRole: DeviceRole, zone: NetworkZone, position: NetworkNode['position'], ip: string, description: string, options: Partial<NetworkNode> = {}): NetworkNode => ({
  id, name, type, deviceRole, zone, position, ip, description,
  status: 'normal', isCritical: false, protectionEnabled: false, isolationEnabled: false, ...options,
})

const intf = (id: string, nodeId: string, name: string, kind: NetworkInterface['kind'], options: Partial<NetworkInterface> = {}): NetworkInterface => ({ id, nodeId, name, kind, enabled: true, ...options })
const link = (id: string, source: string, target: string, sourceInterfaceId: string, targetInterfaceId: string): NetworkEdge => ({ id, source, target, sourceInterfaceId, targetInterfaceId, enabled: true })
const zone = (value: NetworkZone): FirewallRule['source'] => ({ kind: 'ZONE', zone: value })
const host = (nodeId: string): FirewallRule['source'] => ({ kind: 'NODE', nodeId })
const rule = (id: string, firewallId: string, order: number, name: string, source: FirewallRule['source'], destination: FirewallRule['destination'], serviceId: FirewallRule['serviceId'], action: FirewallRule['action'], enabled = true): FirewallRule => ({ id, firewallId, order, name, source, destination, serviceId, action, enabled })

const services: NetworkService[] = (['WEB', 'MAIL', 'DATABASE', 'FILE', 'INTERNAL'] as ServiceId[]).map((serviceId) => ({
  serviceId, name: serviceId, transport: 'TO_BE_VERIFIED', destinationPort: 'TO_BE_VERIFIED', verificationStatus: 'TO_BE_VERIFIED',
}))

const lateralNodes: NetworkNode[] = [
  node('internet', 'Internet', 'Internet', 'EXTERNAL_NETWORK', 'Internet', { x: -20, y: .4, z: 0 }, '203.0.113.1', '教学实验外部网络来源', { services: ['WEB', 'MAIL', 'DATABASE'] }),
  node('edge-fw', 'Edge Firewall', 'Firewall', 'FIREWALL', 'Internet', { x: -15, y: .65, z: 0 }, '10.10.254.2', 'DMZ 与外部网络边界策略设备'),
  node('core', 'Core L3', 'Router', 'L3_SWITCH', 'Office', { x: -9, y: .55, z: 0 }, '10.10.10.1', '办公 VLAN 网关和区域间静态路由节点'),
  node('office-switch', 'Office Switch', 'Switch', 'L2_SWITCH', 'Office', { x: -5, y: .35, z: 0 }, '10.10.10.2', '办公区二层交换节点'),
  node('pc01', 'Office-PC-01', 'Workstation', 'ENDPOINT', 'Office', { x: -1.5, y: .55, z: -3 }, '10.10.10.21', '实验开始前已受到影响的办公终端', { services: ['INTERNAL'] }),
  node('pc02', 'Office-PC-02', 'Workstation', 'ENDPOINT', 'Office', { x: -1.5, y: .55, z: 0 }, '10.10.10.22', '办公终端；弱口令条件为教学抽象，不代表漏洞扫描结果', { services: ['INTERNAL'], teachingConditions: ['WEAK_CREDENTIAL_CONDITION'] }),
  node('pc03', 'Office-PC-03', 'Workstation', 'ENDPOINT', 'Office', { x: -1.5, y: .55, z: 3 }, '10.10.10.23', '办公终端；弱口令条件为教学抽象，不代表漏洞扫描结果', { services: ['INTERNAL'], teachingConditions: ['WEAK_CREDENTIAL_CONDITION'] }),
  node('dmz-switch', 'DMZ Switch', 'Switch', 'L2_SWITCH', 'DMZ', { x: -10, y: .35, z: -8 }, '10.10.20.2', 'DMZ 二层交换节点'),
  node('web', 'Public Web Server', 'Server', 'ENDPOINT', 'DMZ', { x: -6, y: .7, z: -8 }, '10.10.20.20', 'DMZ 公网 Web 服务；远程访问条件为教学抽象，不代表真实漏洞', { isCritical: false, services: ['WEB'], teachingConditions: ['REMOTE_ACCESS_EXPOSED'] }),
  node('mail', 'Mail Server', 'Server', 'ENDPOINT', 'DMZ', { x: -6, y: .7, z: -11 }, '10.10.20.30', 'DMZ 邮件服务', { services: ['MAIL'] }),
  node('internal-fw', 'Internal Firewall', 'Firewall', 'FIREWALL', 'Server', { x: -3, y: .65, z: 0 }, '10.10.254.6', '办公核心与服务器、数据库区域之间的内部边界'),
  node('server-switch', 'Server Switch', 'Switch', 'L2_SWITCH', 'Server', { x: 1, y: .35, z: -3 }, '10.10.30.2', '服务器区二层交换节点'),
  node('app', 'Application Server', 'Server', 'ENDPOINT', 'Server', { x: 5, y: .7, z: -4.5 }, '10.10.30.10', '提供 Web 业务并访问数据库的应用服务器；教学条件不代表真实漏洞', { isCritical: true, services: ['WEB'], teachingConditions: ['REMOTE_ACCESS_EXPOSED', 'PRIVILEGE_ESCALATION_CONDITION', 'APPLICATION_SERVICE_ROLE'] }),
  node('file', 'File Server', 'Server', 'ENDPOINT', 'Server', { x: 5, y: .7, z: -1.5 }, '10.10.30.20', '服务器区文件服务', { services: ['FILE'] }),
  node('data-switch', 'Data Switch', 'Switch', 'L2_SWITCH', 'Database', { x: 1, y: .35, z: 4 }, '10.10.40.2', '数据库区域独立二层交换节点'),
  node('db', 'Customer Database', 'Database', 'ENDPOINT', 'Database', { x: 5, y: .75, z: 4 }, '10.10.40.10', '仅允许必要业务访问的关键客户数据库；数据访问条件为教学抽象', { isCritical: true, services: ['DATABASE'], teachingConditions: ['DATA_ACCESS_CONDITION'] }),
]

const interfaces: NetworkInterface[] = [
  intf('internet-nic', 'internet', 'outside-net', 'ENDPOINT_NIC', { ipv4Address: '203.0.113.1', prefixLength: 24 }),
  intf('edge-wan', 'edge-fw', 'wan', 'L3_INTERFACE', { ipv4Address: '203.0.113.254', prefixLength: 24 }),
  intf('edge-core', 'edge-fw', 'to-core', 'L3_INTERFACE', { ipv4Address: '10.10.254.2', prefixLength: 30 }),
  intf('edge-dmz', 'edge-fw', 'dmz-gateway', 'L3_INTERFACE', { ipv4Address: '10.10.20.1', prefixLength: 24, vlanId: 20 }),
  intf('core-edge', 'core', 'to-edge-fw', 'L3_INTERFACE', { ipv4Address: '10.10.254.1', prefixLength: 30 }),
  intf('core-internal', 'core', 'to-internal-fw', 'L3_INTERFACE', { ipv4Address: '10.10.254.5', prefixLength: 30 }),
  intf('core-office-port', 'core', 'office-uplink', 'SWITCH_PORT', { switchportMode: 'TRUNK', allowedVlanIds: [10] }),
  intf('core-office-gw', 'core', 'vlan10-gateway', 'VLAN_GATEWAY', { ipv4Address: '10.10.10.1', prefixLength: 24, vlanId: 10, parentInterfaceId: 'core-office-port' }),
  intf('office-uplink', 'office-switch', 'core-uplink', 'SWITCH_PORT', { switchportMode: 'TRUNK', allowedVlanIds: [10] }),
  intf('dmz-fw-port', 'dmz-switch', 'firewall-port', 'SWITCH_PORT', { switchportMode: 'ACCESS', accessVlanId: 20 }),
  intf('dmz-web-port', 'dmz-switch', 'web-port', 'SWITCH_PORT', { switchportMode: 'ACCESS', accessVlanId: 20 }),
  intf('dmz-mail-port', 'dmz-switch', 'mail-port', 'SWITCH_PORT', { switchportMode: 'ACCESS', accessVlanId: 20 }),
  intf('web-nic', 'web', 'eth0', 'ENDPOINT_NIC', { ipv4Address: '10.10.20.20', prefixLength: 24, vlanId: 20 }),
  intf('mail-nic', 'mail', 'eth0', 'ENDPOINT_NIC', { ipv4Address: '10.10.20.30', prefixLength: 24, vlanId: 20 }),
  intf('office-pc01-nic', 'pc01', 'eth0', 'ENDPOINT_NIC', { ipv4Address: '10.10.10.21', prefixLength: 24, vlanId: 10 }),
  intf('office-pc02-nic', 'pc02', 'eth0', 'ENDPOINT_NIC', { ipv4Address: '10.10.10.22', prefixLength: 24, vlanId: 10 }),
  intf('office-pc03-nic', 'pc03', 'eth0', 'ENDPOINT_NIC', { ipv4Address: '10.10.10.23', prefixLength: 24, vlanId: 10 }),
  intf('office-sw-core-port', 'office-switch', 'core-port', 'SWITCH_PORT', { switchportMode: 'TRUNK', allowedVlanIds: [10] }),
  intf('office-sw-pc01-port', 'office-switch', 'pc01-port', 'SWITCH_PORT', { switchportMode: 'ACCESS', accessVlanId: 10 }),
  intf('office-sw-pc02-port', 'office-switch', 'pc02-port', 'SWITCH_PORT', { switchportMode: 'ACCESS', accessVlanId: 10 }),
  intf('office-sw-pc03-port', 'office-switch', 'pc03-port', 'SWITCH_PORT', { switchportMode: 'ACCESS', accessVlanId: 10 }),
  intf('ifw-core', 'internal-fw', 'to-core', 'L3_INTERFACE', { ipv4Address: '10.10.254.6', prefixLength: 30 }),
  intf('ifw-server', 'internal-fw', 'server-gateway', 'L3_INTERFACE', { ipv4Address: '10.10.30.1', prefixLength: 24, vlanId: 30 }),
  intf('ifw-data', 'internal-fw', 'data-gateway', 'L3_INTERFACE', { ipv4Address: '10.10.40.1', prefixLength: 24, vlanId: 40 }),
  intf('server-fw-port', 'server-switch', 'firewall-port', 'SWITCH_PORT', { switchportMode: 'ACCESS', accessVlanId: 30 }),
  intf('server-app-port', 'server-switch', 'app-port', 'SWITCH_PORT', { switchportMode: 'ACCESS', accessVlanId: 30 }),
  intf('server-file-port', 'server-switch', 'file-port', 'SWITCH_PORT', { switchportMode: 'ACCESS', accessVlanId: 30 }),
  intf('app-nic', 'app', 'eth0', 'ENDPOINT_NIC', { ipv4Address: '10.10.30.10', prefixLength: 24, vlanId: 30 }),
  intf('file-nic', 'file', 'eth0', 'ENDPOINT_NIC', { ipv4Address: '10.10.30.20', prefixLength: 24, vlanId: 30 }),
  intf('data-fw-port', 'data-switch', 'firewall-port', 'SWITCH_PORT', { switchportMode: 'ACCESS', accessVlanId: 40 }),
  intf('data-db-port', 'data-switch', 'db-port', 'SWITCH_PORT', { switchportMode: 'ACCESS', accessVlanId: 40 }),
  intf('db-nic', 'db', 'eth0', 'ENDPOINT_NIC', { ipv4Address: '10.10.40.10', prefixLength: 24, vlanId: 40 }),
]

const edges: NetworkEdge[] = [
  link('l-internet-edge', 'internet', 'edge-fw', 'internet-nic', 'edge-wan'),
  link('l-edge-core', 'edge-fw', 'core', 'edge-core', 'core-edge'),
  link('l-edge-dmz', 'edge-fw', 'dmz-switch', 'edge-dmz', 'dmz-fw-port'),
  link('l-core-office', 'core', 'office-switch', 'core-office-port', 'office-sw-core-port'),
  link('l-core-internal', 'core', 'internal-fw', 'core-internal', 'ifw-core'),
  link('l-office-pc01', 'office-switch', 'pc01', 'office-sw-pc01-port', 'office-pc01-nic'),
  link('l-office-pc02', 'office-switch', 'pc02', 'office-sw-pc02-port', 'office-pc02-nic'),
  link('l-office-pc03', 'office-switch', 'pc03', 'office-sw-pc03-port', 'office-pc03-nic'),
]
edges.push(
  link('l-dmz-web', 'dmz-switch', 'web', 'dmz-web-port', 'web-nic'),
  link('l-dmz-mail', 'dmz-switch', 'mail', 'dmz-mail-port', 'mail-nic'),
  link('l-ifw-server', 'internal-fw', 'server-switch', 'ifw-server', 'server-fw-port'),
  link('l-server-app', 'server-switch', 'app', 'server-app-port', 'app-nic'),
  link('l-server-file', 'server-switch', 'file', 'server-file-port', 'file-nic'),
  link('l-ifw-data', 'internal-fw', 'data-switch', 'ifw-data', 'data-fw-port'),
  link('l-data-db', 'data-switch', 'db', 'data-db-port', 'db-nic'),
)
const vlans: VlanDefinition[] = [
  { id: 10, name: 'Office', zone: 'Office', subnetCidr: '10.10.10.0/24', gatewayInterfaceId: 'core-office-gw' },
  { id: 20, name: 'DMZ', zone: 'DMZ', subnetCidr: '10.10.20.0/24', gatewayInterfaceId: 'edge-dmz' },
  { id: 30, name: 'Server', zone: 'Server', subnetCidr: '10.10.30.0/24', gatewayInterfaceId: 'ifw-server' },
  { id: 40, name: 'Database', zone: 'Database', subnetCidr: '10.10.40.0/24', gatewayInterfaceId: 'ifw-data' },
]

const routes: RouteEntry[] = [
  { id: 'core-to-dmz', deviceId: 'core', kind: 'STATIC', destinationCidr: '10.10.20.0/24', nextHopIp: '10.10.254.2', outInterfaceId: 'core-edge' },
  { id: 'core-to-server', deviceId: 'core', kind: 'STATIC', destinationCidr: '10.10.30.0/24', nextHopIp: '10.10.254.6', outInterfaceId: 'core-internal' },
  { id: 'core-to-data', deviceId: 'core', kind: 'STATIC', destinationCidr: '10.10.40.0/24', nextHopIp: '10.10.254.6', outInterfaceId: 'core-internal' },
  { id: 'core-default', deviceId: 'core', kind: 'DEFAULT', destinationCidr: '0.0.0.0/0', nextHopIp: '10.10.254.2', outInterfaceId: 'core-edge' },
  { id: 'edge-to-office', deviceId: 'edge-fw', kind: 'STATIC', destinationCidr: '10.10.10.0/24', nextHopIp: '10.10.254.1', outInterfaceId: 'edge-core' },
  { id: 'edge-to-server', deviceId: 'edge-fw', kind: 'STATIC', destinationCidr: '10.10.30.0/24', nextHopIp: '10.10.254.1', outInterfaceId: 'edge-core' },
  { id: 'edge-to-data', deviceId: 'edge-fw', kind: 'STATIC', destinationCidr: '10.10.40.0/24', nextHopIp: '10.10.254.1', outInterfaceId: 'edge-core' },
  { id: 'edge-default', deviceId: 'edge-fw', kind: 'DEFAULT', destinationCidr: '0.0.0.0/0', outInterfaceId: 'edge-wan' },
  { id: 'ifw-to-office', deviceId: 'internal-fw', kind: 'STATIC', destinationCidr: '10.10.10.0/24', nextHopIp: '10.10.254.5', outInterfaceId: 'ifw-core' },
  { id: 'ifw-to-dmz', deviceId: 'internal-fw', kind: 'STATIC', destinationCidr: '10.10.20.0/24', nextHopIp: '10.10.254.5', outInterfaceId: 'ifw-core' },
  { id: 'ifw-default', deviceId: 'internal-fw', kind: 'DEFAULT', destinationCidr: '0.0.0.0/0', nextHopIp: '10.10.254.5', outInterfaceId: 'ifw-core' },
]

const firewallPolicies: FirewallPolicy[] = [
  {
    firewallId: 'edge-fw', defaultAction: 'DENY', rules: [
      rule('edge-10-web', 'edge-fw', 10, '外部访问公开 Web', zone('Internet'), host('web'), 'WEB', 'ALLOW'),
      rule('edge-20-mail', 'edge-fw', 20, '外部访问邮件服务', zone('Internet'), host('mail'), 'MAIL', 'ALLOW'),
      rule('edge-30-office-web', 'edge-fw', 30, '办公区访问公开 Web', zone('Office'), host('web'), 'WEB', 'ALLOW'),
    ],
  },
  {
    firewallId: 'internal-fw', defaultAction: 'DENY', rules: [
      rule('internal-10-app-db', 'internal-fw', 10, '应用服务访问数据库', host('app'), host('db'), 'DATABASE', 'ALLOW'),
      rule('internal-20-office-db-allow', 'internal-fw', 20, '办公区错误放行数据库访问', zone('Office'), host('db'), 'DATABASE', 'ALLOW'),
      rule('internal-30-office-db-deny', 'internal-fw', 30, '办公区禁止直接访问数据库', zone('Office'), zone('Database'), 'ANY', 'DENY'),
      rule('internal-40-office-server-deny', 'internal-fw', 40, '办公区禁止直接访问服务器区', zone('Office'), zone('Server'), 'ANY', 'DENY'),
      rule('internal-50-dmz-server-deny', 'internal-fw', 50, 'DMZ 禁止访问服务器区', zone('DMZ'), zone('Server'), 'ANY', 'DENY'),
      rule('internal-60-dmz-db-deny', 'internal-fw', 60, 'DMZ 禁止访问数据库区', zone('DMZ'), zone('Database'), 'ANY', 'DENY'),
    ],
  },
]

/** A narrow policy permits the Office-to-Application teaching behavior without opening the full Server zone. */
const lateralAttackPolicies = JSON.parse(JSON.stringify(firewallPolicies)) as FirewallPolicy[]
lateralAttackPolicies.find((policy) => policy.firewallId === 'edge-fw')!.rules.push(
  rule('edge-40-web-to-app', 'edge-fw', 40, '教学 Web 入口到应用服务通信路径', host('web'), host('app'), 'WEB', 'ALLOW'),
)
lateralAttackPolicies.find((policy) => policy.firewallId === 'internal-fw')!.rules.push(
  rule('internal-25-office-app-web', 'internal-fw', 25, '办公终端访问应用服务（教学路径）', zone('Office'), host('app'), 'WEB', 'ALLOW'),
  rule('internal-26-web-to-app', 'internal-fw', 26, 'DMZ Web 入口到应用服务通信路径', host('web'), host('app'), 'WEB', 'ALLOW'),
)

const businessPaths = [
  { id: 'office-public-web', sourceId: 'pc01', targetId: 'web', service: 'WEB' as const, label: 'Office 用户访问 Public Web Server' },
  { id: 'app-customer-db', sourceId: 'app', targetId: 'db', service: 'DATABASE' as const, label: 'Application Server 访问 Customer Database' },
]

export const lateralScenario: Scenario = {
  id: 'lateral', name: '终端失陷与横向传播', shortName: '横向传播',
  description: 'Office-PC-01 在实验开始前已由教学初始状态标记为 USER 控制。后续状态变化由抽象攻击行为、通信路径、目标教学条件和安全控制共同判定；不代表真实漏洞利用或攻击链预测。',
  difficulty: '进阶', duration: '约 8 分钟', accent: '#ef8b71',
  simulationMode: 'ATTACK_STATE',
  initialAttackState: {
    controlledEndpoints: { pc01: { nodeId: 'pc01', privilege: 'USER' } },
    assetAccess: { db: 'NONE' },
    executedTransitionIds: [],
  },
  nodes: lateralNodes, interfaces, edges, vlans, routes, services, firewallPolicies: lateralAttackPolicies,
  initialEvents: [{ id: 'seed-phishing', type: 'seed', sourceId: 'pc01', targetId: 'pc01', service: 'INTERNAL', message: '实验初始条件：Office-PC-01 在仿真开始前已由教学状态标记为 USER 控制（界面显示为受影响）。' }],
  learningObjectives: ['区分网络通信路径与攻击状态路径', '观察攻击行为如何同时检查权限、教学条件和安全控制', '验证通信允许只是前置条件，不会自动使目标进入受控状态'],
  businessPaths,
  challenge: { title: '保护 Customer Database', description: '调整内部防火墙规则，同时保持办公 Web 与应用数据库业务可达。', protectedNodeId: 'db', requiredBusinessPathIds: ['office-public-web', 'app-customer-db'] },
}

type ScenarioCopy = Pick<Scenario, 'difficulty' | 'duration' | 'accent' | 'learningObjectives' | 'businessPaths' | 'challenge'>

function deriveScenario(
  id: string,
  name: string,
  shortName: string,
  description: string,
  initialEvents: Scenario['initialEvents'],
  policies: FirewallPolicy[] = firewallPolicies,
  copy: Partial<ScenarioCopy> = {},
): Scenario {
  return {
    ...cloneScenario(lateralScenario), id, name, shortName, description,
    simulationMode: 'TEACHING_PROPAGATION', initialAttackState: undefined,
    nodes: cloneScenario(lateralScenario).nodes,
    interfaces: cloneScenario(lateralScenario).interfaces,
    edges: cloneScenario(lateralScenario).edges,
    vlans: cloneScenario(lateralScenario).vlans,
    routes: cloneScenario(lateralScenario).routes,
    services: cloneScenario(lateralScenario).services,
    firewallPolicies: JSON.parse(JSON.stringify(policies)) as FirewallPolicy[],
    initialEvents,
    challenge: undefined,
    ...copy,
  }
}

const externalFirewallPolicies = JSON.parse(JSON.stringify(firewallPolicies)) as FirewallPolicy[]
externalFirewallPolicies.find((policy) => policy.firewallId === 'edge-fw')!.rules = [
  rule('edge-10-web', 'edge-fw', 10, '外部访问公开 Web', zone('Internet'), host('web'), 'WEB', 'ALLOW'),
  rule('edge-20-mail', 'edge-fw', 20, '外部访问邮件服务', zone('Internet'), host('mail'), 'MAIL', 'ALLOW'),
]

export const firewallScenario = deriveScenario('firewall', '外部访问与防火墙拦截', '边界防火墙', '观察外部请求如何沿真实路由到达边界防火墙，并由其独立策略判定。', [
  { id: 'request-web', type: 'request', sourceId: 'internet', targetId: 'web', service: 'WEB', message: '外部 WEB 请求' },
  { id: 'request-db', type: 'request', sourceId: 'internet', targetId: 'db', service: 'DATABASE', message: '外部数据库请求' },
], externalFirewallPolicies, {
  difficulty: '入门',
  duration: '约 5 分钟',
  learningObjectives: ['观察外部请求经过边界 Firewall 的真实路由路径', '验证公开 Web 与邮件服务的显式放行规则', '区分允许的公开服务与默认拒绝的数据库请求'],
  businessPaths: [
    { id: 'internet-public-web', sourceId: 'internet', targetId: 'web', service: 'WEB', label: '外部用户访问公开 Web 服务' },
    { id: 'internet-public-mail', sourceId: 'internet', targetId: 'mail', service: 'MAIL', label: '外部用户访问公开邮件服务' },
  ],
})

const segmentationPolicies = JSON.parse(JSON.stringify(firewallPolicies)) as FirewallPolicy[]
segmentationPolicies.find((policy) => policy.firewallId === 'internal-fw')!.rules.find((item) => item.id === 'internal-20-office-db-allow')!.enabled = false
export const segmentationScenario = deriveScenario('segmentation', '网络分区防御实验', '网络分区', '初始终端位于办公 VLAN。默认策略禁止办公区直接访问服务器和数据库区域，同时保留办公 Web 与应用数据库必要业务路径。', [
  { id: 'seed-office', type: 'seed', sourceId: 'pc01', targetId: 'pc01', service: 'INTERNAL', message: '实验初始条件：Office-PC-01 在仿真开始前已受到影响。' },
], segmentationPolicies, {
  difficulty: '进阶',
  duration: '约 6 分钟',
  learningObjectives: ['理解 VLAN 与区域边界如何限制跨区通信', '验证办公区到数据库的默认拒绝规则', '确认必要 Web 与应用数据库业务仍可达'],
  businessPaths,
})

/** 教学供应链情境：以预设受影响的 Web 入口演示显式跨区放行路径。 */
const supplyChainPolicies = JSON.parse(JSON.stringify(firewallPolicies)) as FirewallPolicy[]
supplyChainPolicies.find((policy) => policy.firewallId === 'edge-fw')!.rules.push(
  rule('edge-40-web-to-app', 'edge-fw', 40, '教学 Web 入口到应用服务路径', host('web'), host('app'), 'WEB', 'ALLOW'),
)
supplyChainPolicies.find((policy) => policy.firewallId === 'internal-fw')!.rules = [
  rule('internal-10-app-db', 'internal-fw', 10, '应用服务访问数据库', host('app'), host('db'), 'DATABASE', 'ALLOW'),
  rule('internal-20-web-to-app', 'internal-fw', 20, '教学 Web 入口到应用服务路径', host('web'), host('app'), 'WEB', 'ALLOW'),
  rule('internal-30-office-db-deny', 'internal-fw', 30, '办公区禁止直接访问数据库', zone('Office'), zone('Database'), 'ANY', 'DENY'),
  rule('internal-40-office-server-deny', 'internal-fw', 40, '办公区禁止直接访问服务器区', zone('Office'), zone('Server'), 'ANY', 'DENY'),
  rule('internal-50-dmz-server-deny', 'internal-fw', 50, 'DMZ 其他流量禁止访问服务器区', zone('DMZ'), zone('Server'), 'ANY', 'DENY'),
  rule('internal-60-dmz-db-deny', 'internal-fw', 60, 'DMZ 禁止访问数据库区', zone('DMZ'), zone('Database'), 'ANY', 'DENY'),
]
export const supplyChainScenario = deriveScenario('supply-chain', '供应链入口传播路径实验', '供应链路径', '将 Public Web Server 设为实验开始前已受影响的入口。它可沿 DMZ 内的 MAIL 服务路径影响 Mail Server；跨区到 Application Server 则必须同时命中 Edge 与 Internal Firewall 的显式 Web 放行规则。应用服务器之后按可达 FILE、DATABASE 服务继续教学传播。本场景不模拟真实软件投毒或代码执行。', [
  { id: 'seed-web-compromise', type: 'seed', sourceId: 'web', targetId: 'web', service: 'WEB', message: '实验初始条件：Public Web Server 在仿真开始前已进入受影响状态（供应链入口情境）。' },
], supplyChainPolicies, {
  difficulty: '挑战', duration: '约 10 分钟', accent: '#b09ae8',
  learningObjectives: ['区分 DMZ 内 MAIL 服务路径与跨区 Web → Application Server 路径', '验证跨区通信必须分别通过路径上的 Edge 与 Internal Firewall 规则', '观察应用服务器可达的文件与数据库服务如何受到教学传播模型影响'],
  businessPaths,
  challenge: { title: '保护 Customer Database', description: '限制受影响 Web 入口经应用服务影响数据库，同时保持办公 Web 与应用数据库必要业务可达。', protectedNodeId: 'db', requiredBusinessPathIds: ['office-public-web', 'app-customer-db'] },
})

/** 勒索风险教学情境：只演示节点受影响状态沿可达服务扩散，不模拟文件加密或恢复。 */
const ransomwarePolicies = JSON.parse(JSON.stringify(firewallPolicies)) as FirewallPolicy[]
ransomwarePolicies.find((policy) => policy.firewallId === 'internal-fw')!.rules = [
  rule('internal-10-app-db', 'internal-fw', 10, '应用服务访问数据库', host('app'), host('db'), 'DATABASE', 'ALLOW'),
  rule('internal-20-office-db-deny', 'internal-fw', 20, '办公区禁止直接访问数据库', zone('Office'), zone('Database'), 'ANY', 'DENY'),
  rule('internal-30-office-file-allow', 'internal-fw', 30, '办公区访问必要文件服务', zone('Office'), host('file'), 'FILE', 'ALLOW'),
  rule('internal-40-office-server-deny', 'internal-fw', 40, '办公区禁止访问其他服务器服务', zone('Office'), zone('Server'), 'ANY', 'DENY'),
  rule('internal-50-dmz-server-deny', 'internal-fw', 50, 'DMZ 禁止访问服务器区', zone('DMZ'), zone('Server'), 'ANY', 'DENY'),
  rule('internal-60-dmz-db-deny', 'internal-fw', 60, 'DMZ 禁止访问数据库区', zone('DMZ'), zone('Database'), 'ANY', 'DENY'),
]
export const ransomwareScenario = deriveScenario('ransomware', '勒索风险传播与文件服务保护', '勒索风险', 'Office-PC-02 是实验开始前已受影响的种子节点。仿真会沿同区域以及策略允许的跨区服务路径尝试传播节点状态；本场景不模拟真实恶意软件、文件加密、解密或恢复。', [
  { id: 'seed-ransom', type: 'seed', sourceId: 'pc02', targetId: 'pc02', service: 'INTERNAL', message: '实验初始条件：Office-PC-02 已进入受影响状态（勒索风险情境）；本模型不模拟文件加密或恢复。' },
], ransomwarePolicies, {
  difficulty: '进阶', duration: '约 9 分钟', accent: '#e8a06a',
  learningObjectives: ['观察受影响终端如何沿同区域及策略允许的跨区路径扩散状态', '验证终端防护如何阻止目标节点进入受影响状态', '在保护文件服务与保持必要业务可达之间进行权衡'],
  businessPaths: [
    { id: 'office-public-web', sourceId: 'pc01', targetId: 'web', service: 'WEB' as const, label: 'Office 用户访问 Public Web Server' },
    { id: 'office-file', sourceId: 'pc01', targetId: 'file', service: 'FILE' as const, label: 'Office 用户访问 File Server' },
    { id: 'app-customer-db', sourceId: 'app', targetId: 'db', service: 'DATABASE' as const, label: 'Application Server 访问 Customer Database' },
  ],
  challenge: { title: '保护文件服务节点', description: '启用文件服务器终端防护或调整传播路径，在保持办公 Web、办公文件与应用数据库业务可达的前提下，使文件服务器不进入受影响状态。', protectedNodeId: 'file', requiredBusinessPathIds: ['office-public-web', 'office-file', 'app-customer-db'] },
})

export const scenarios: Scenario[] = [lateralScenario, firewallScenario, segmentationScenario, supplyChainScenario, ransomwareScenario, industrialScenario]

export function cloneScenario(scenario: Scenario): Scenario {
  return JSON.parse(JSON.stringify(scenario)) as Scenario
}

export function getScenario(id: string): Scenario {
  const found = scenarios.find((item) => item.id === id)
  return cloneScenario(found ?? lateralScenario)
}

export function isBuiltInScenario(id: string): boolean {
  return scenarios.some((scenario) => scenario.id === id)
}
