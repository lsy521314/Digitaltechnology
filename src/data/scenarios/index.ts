import type { NetworkEdge, NetworkNode, SecurityRule, ServiceType } from '../../types/network'
import type { Scenario } from '../../types/scenario'

type NodeInput = Omit<NetworkNode, 'status' | 'protectionEnabled'>

const node = (input: NodeInput): NetworkNode => ({ ...input, status: 'normal', protectionEnabled: false, isolationEnabled: false })
const edge = (id: string, source: string, target: string, service: Exclude<ServiceType, 'ANY'> = 'INTERNAL', bidirectional = true): NetworkEdge => ({
  id, source, target, service, enabled: true, bidirectional,
})
const rule = (id: string, name: string, sourceZone: SecurityRule['sourceZone'], targetZone: SecurityRule['targetZone'], service: ServiceType, action: SecurityRule['action'], enabled = true): SecurityRule => ({
  id, name, sourceZone, targetZone, service, action, enabled,
})

export const lateralScenario: Scenario = {
  id: 'lateral',
  name: '终端失陷与横向传播',
  shortName: '横向传播',
  description: 'Office-PC-01 在仿真开始前已受到影响。Office→Database 策略默认未启用，可观察风险沿核心网络触达数据库；Office 直达应用服务器由边界规则阻断。',
  difficulty: '进阶',
  duration: '约 8 分钟',
  accent: '#ef8b71',
  nodes: [
    node({ id: 'internet', name: 'Internet', type: 'Internet', zone: 'Internet', position: { x: -20, y: 0.4, z: 0 }, ip: '203.0.113.1', isCritical: false, services: ['WEB', 'MAIL'], description: '实验外部网络来源' }),
    node({ id: 'gateway', name: 'Edge Gateway', type: 'Gateway', zone: 'Internet', position: { x: -16.2, y: 0.55, z: 0 }, ip: '10.0.0.1', isCritical: false, services: ['INTERNAL'], description: '外部网络接入边界' }),
    node({ id: 'fw', name: 'Firewall', type: 'Firewall', zone: 'Internet', position: { x: -12.4, y: 0.65, z: 0 }, ip: '10.0.0.2', isCritical: false, services: ['INTERNAL'], description: '执行区域访问策略的边界防火墙' }),
    node({ id: 'core', name: 'Core Switch', type: 'Switch', zone: 'Internet', position: { x: -8.4, y: 0.35, z: 0 }, ip: '10.0.0.3', isCritical: false, services: ['INTERNAL'], description: '连接 DMZ、办公区和服务器区的核心交换节点' }),
    node({ id: 'dmz-switch', name: 'DMZ Switch', type: 'Switch', zone: 'DMZ', position: { x: -3.6, y: 0.35, z: 0 }, ip: '10.20.0.1', isCritical: false, services: ['INTERNAL'], description: 'DMZ 区域交换节点' }),
    node({ id: 'web', name: 'Public Web Server', type: 'Server', zone: 'DMZ', position: { x: -0.2, y: 0.65, z: -2.0 }, ip: '10.20.0.20', isCritical: false, services: ['WEB'], description: '对外提供 WEB 服务的 DMZ 主机' }),
    node({ id: 'mail', name: 'Mail Server', type: 'Server', zone: 'DMZ', position: { x: -0.2, y: 0.65, z: 2.0 }, ip: '10.20.0.30', isCritical: false, services: ['MAIL'], description: '提供邮件服务的 DMZ 主机' }),
    node({ id: 'office-switch', name: 'Office Switch', type: 'Switch', zone: 'Office', position: { x: 3.3, y: 0.35, z: 0 }, ip: '10.10.0.1', isCritical: false, services: ['INTERNAL'], description: '办公区域接入交换节点' }),
    node({ id: 'pc01', name: 'Office-PC-01', type: 'Workstation', zone: 'Office', position: { x: 7.1, y: 0.55, z: -3.3 }, ip: '10.10.0.21', isCritical: false, services: ['INTERNAL'], description: '实验开始前已受到影响的办公终端' }),
    node({ id: 'pc02', name: 'Office-PC-02', type: 'Workstation', zone: 'Office', position: { x: 7.1, y: 0.55, z: -1.1 }, ip: '10.10.0.22', isCritical: false, services: ['INTERNAL'], description: '办公区用户终端，可配置教学仿真防护' }),
    node({ id: 'pc03', name: 'Office-PC-03', type: 'Workstation', zone: 'Office', position: { x: 7.1, y: 0.55, z: 1.1 }, ip: '10.10.0.23', isCritical: false, services: ['INTERNAL'], description: '办公区普通终端' }),
    node({ id: 'pc04', name: 'Office-PC-04', type: 'Workstation', zone: 'Office', position: { x: 7.1, y: 0.55, z: 3.3 }, ip: '10.10.0.24', isCritical: false, services: ['INTERNAL'], description: '办公区普通终端' }),
    node({ id: 'server-switch', name: 'Server Switch', type: 'Switch', zone: 'Server', position: { x: 10.9, y: 0.35, z: 0 }, ip: '10.30.0.1', isCritical: false, services: ['INTERNAL'], description: '服务器区域接入交换节点' }),
    node({ id: 'app', name: 'Application Server', type: 'Server', zone: 'Server', position: { x: 14.6, y: 0.7, z: -2.0 }, ip: '10.30.0.10', isCritical: true, services: ['WEB'], description: '向办公用户提供业务，并通过 DATABASE 服务访问数据区' }),
    node({ id: 'file', name: 'File Server', type: 'Server', zone: 'Server', position: { x: 14.6, y: 0.7, z: 2.0 }, ip: '10.30.0.20', isCritical: false, services: ['FILE'], description: '服务器区文件服务' }),
    node({ id: 'db', name: 'Customer Database', type: 'Database', zone: 'Database', position: { x: 20.8, y: 0.65, z: 0 }, ip: '10.40.0.8', isCritical: true, services: ['DATABASE'], description: '仅通过必要 DATABASE 服务访问的关键数据资产' }),
  ],
  edges: [
    edge('l-in-gw', 'internet', 'gateway'),
    edge('l-gw-fw', 'gateway', 'fw'),
    edge('l-fw-core', 'fw', 'core'),
    edge('l-core-dmz', 'core', 'dmz-switch'),
    edge('l-dmz-web', 'dmz-switch', 'web', 'WEB'),
    edge('l-dmz-mail', 'dmz-switch', 'mail', 'MAIL'),
    edge('l-core-office', 'core', 'office-switch'),
    edge('l-office-pc01', 'office-switch', 'pc01'),
    edge('l-office-pc02', 'office-switch', 'pc02'),
    edge('l-office-pc03', 'office-switch', 'pc03'),
    edge('l-office-pc04', 'office-switch', 'pc04'),
    edge('l-core-server', 'core', 'server-switch'),
    edge('l-server-app', 'server-switch', 'app', 'WEB'),
    edge('l-server-file', 'server-switch', 'file', 'FILE'),
    edge('l-server-db', 'server-switch', 'db', 'DATABASE', false),
  ],
  rules: [
    rule('rule-internet-dmz-web', '外部访问公开 WEB', 'Internet', 'DMZ', 'WEB', 'ALLOW'),
    rule('rule-internet-dmz-mail', '外部访问邮件服务', 'Internet', 'DMZ', 'MAIL', 'ALLOW'),
    rule('rule-internet-office-deny', '禁止外部访问办公区', 'Internet', 'Office', 'ANY', 'DENY'),
    rule('rule-internet-server-deny', '禁止外部访问服务器区', 'Internet', 'Server', 'ANY', 'DENY'),
    rule('rule-internet-data-deny', '禁止外部访问数据区', 'Internet', 'Database', 'ANY', 'DENY'),
    rule('rule-office-dmz-deny', '办公区默认禁止访问 DMZ', 'Office', 'DMZ', 'ANY', 'DENY'),
    rule('rule-office-web-allow', '办公用户访问公开 WEB', 'Office', 'DMZ', 'WEB', 'ALLOW'),
    rule('rule-office-app-deny', '办公区禁止直接访问应用服务器', 'Office', 'Server', 'WEB', 'DENY'),
    rule('rule-office-file-deny', '办公区禁止直接访问文件服务', 'Office', 'Server', 'FILE', 'DENY'),
    rule('rule-dmz-server-deny', 'DMZ 禁止访问内部服务器区', 'DMZ', 'Server', 'ANY', 'DENY'),
    rule('rule-dmz-database-deny', 'DMZ 禁止访问数据库区', 'DMZ', 'Database', 'ANY', 'DENY'),
    rule('rule-server-db-allow', '应用服务访问数据库', 'Server', 'Database', 'DATABASE', 'ALLOW'),
    rule('rule-office-db-deny', '办公区禁止直接访问数据库', 'Office', 'Database', 'DATABASE', 'DENY', false),
  ],
  initialEvents: [
    { id: 'seed-phishing', type: 'seed', sourceId: 'pc01', targetId: 'pc01', service: 'INTERNAL', message: '实验初始条件：Office-PC-01 在仿真开始前已因模拟钓鱼邮件受到影响。' },
  ],
  learningObjectives: ['理解受影响终端如何沿可达服务传播', '验证区域规则与终端防护的作用', '在保护数据库的同时保留必要业务路径'],
  businessPaths: [
    { id: 'office-public-web', sourceId: 'pc02', targetId: 'web', service: 'WEB', label: 'Office 用户访问 Public Web Server' },
    { id: 'app-customer-db', sourceId: 'app', targetId: 'db', service: 'DATABASE', label: 'Application Server 访问 Customer Database' },
  ],
  challenge: {
    title: '保护 Customer Database',
    description: '保留 Office 到公开 WEB 以及 Application Server 到数据库的必要业务，同时阻止关键数据库受到影响。',
    protectedNodeId: 'db',
    requiredBusinessPathIds: ['office-public-web', 'app-customer-db'],
  },
}

export const firewallScenario: Scenario = {
  id: 'firewall',
  name: '外部访问与防火墙拦截',
  shortName: '边界防火墙',
  description: '比较外部 WEB 请求与 DATABASE 请求，观察区域策略如何保护关键数据。',
  difficulty: '入门',
  duration: '约 5 分钟',
  accent: '#71b8cb',
  nodes: [
    node({ id: 'internet', name: 'Internet', type: 'Internet', zone: 'Internet', position: { x: -7, y: 0.4, z: 0 }, ip: '203.0.113.1', isCritical: false, services: ['WEB', 'DATABASE'], description: '抽象外部请求来源' }),
    node({ id: 'fw', name: 'Perimeter Firewall', type: 'Firewall', zone: 'Internet', position: { x: -3.5, y: 0.6, z: 0 }, ip: '10.0.0.1', isCritical: false, services: ['INTERNAL'], description: '根据区域和服务规则判断请求' }),
    node({ id: 'web', name: 'Public Web Server', type: 'Server', zone: 'DMZ', position: { x: 0.5, y: 0.65, z: -1.3 }, ip: '10.20.0.20', isCritical: false, services: ['WEB'], description: '对外公开的 WEB 服务' }),
    node({ id: 'db', name: 'Customer Database', type: 'Database', zone: 'Database', position: { x: 4.5, y: 0.55, z: 1.0 }, ip: '10.40.0.8', isCritical: true, services: ['DATABASE'], description: '不接受外部直接访问的关键资产' }),
  ],
  edges: [
    edge('f-in-fw', 'internet', 'fw'),
    edge('f-fw-web', 'fw', 'web', 'WEB'),
    edge('f-fw-db', 'fw', 'db', 'DATABASE'),
    edge('f-web-db', 'web', 'db', 'DATABASE', false),
  ],
  rules: [
    rule('f-web-allow', '公开 WEB 服务', 'Internet', 'DMZ', 'WEB', 'ALLOW'),
    rule('f-db-deny', '外部禁止直连数据库', 'Internet', 'Database', 'DATABASE', 'DENY'),
  ],
  initialEvents: [
    { id: 'request-web', type: 'request', sourceId: 'internet', targetId: 'web', service: 'WEB', message: '外部 WEB 请求到达边界策略' },
    { id: 'request-db', type: 'request', sourceId: 'internet', targetId: 'db', service: 'DATABASE', message: '外部 DATABASE 请求到达边界策略' },
  ],
  learningObjectives: ['区分网络连通与策略允许', '理解规则匹配和默认放行', '避免关键数据服务直接暴露'],
  businessPaths: [{ id: 'external-public-web', sourceId: 'internet', targetId: 'web', service: 'WEB', label: '外部用户访问公开站点' }],
}

export const segmentationScenario: Scenario = {
  id: 'segmentation',
  name: '网络分区防御实验',
  shortName: '网络分区',
  description: '使用相同拓扑比较扁平访问与分区规则，观察风险范围和必要业务路径。',
  difficulty: '挑战',
  duration: '约 10 分钟',
  accent: '#9a8be8',
  nodes: [
    node({ id: 'office', name: 'Office Endpoint', type: 'Workstation', zone: 'Office', position: { x: -4.8, y: 0.6, z: 0 }, ip: '10.10.0.21', isCritical: false, services: ['INTERNAL'], description: '办公区初始受影响终端' }),
    node({ id: 'app', name: 'Application Server', type: 'Server', zone: 'Server', position: { x: 0, y: 0.65, z: 0 }, ip: '10.30.0.10', isCritical: true, services: ['WEB'], description: '承载业务的应用服务器' }),
    node({ id: 'db', name: 'Finance Database', type: 'Database', zone: 'Database', position: { x: 4.8, y: 0.55, z: 0 }, ip: '10.40.0.12', isCritical: true, services: ['DATABASE'], description: '财务数据关键资产' }),
  ],
  edges: [
    edge('s-office-app', 'office', 'app', 'WEB'),
    edge('s-office-db', 'office', 'db', 'DATABASE'),
    edge('s-app-db', 'app', 'db', 'DATABASE'),
  ],
  rules: [
    rule('s-office-app', '办公区访问应用', 'Office', 'Server', 'WEB', 'ALLOW'),
    rule('s-server-db', '应用访问数据库', 'Server', 'Database', 'DATABASE', 'ALLOW'),
  ],
  initialEvents: [
    { id: 'seed-office', type: 'seed', sourceId: 'office', targetId: 'office', service: 'INTERNAL', message: '实验初始条件：Office Endpoint 在仿真开始前已受到影响。' },
  ],
  learningObjectives: ['比较扁平网络与分区策略', '理解最小权限的业务边界', '兼顾关键资产保护与业务可达性'],
  businessPaths: [
    { id: 'office-app-web', sourceId: 'office', targetId: 'app', service: 'WEB', label: '办公访问业务应用' },
    { id: 'app-db', sourceId: 'app', targetId: 'db', service: 'DATABASE', label: '应用访问数据库' },
  ],
}

export const scenarios: Scenario[] = [lateralScenario, firewallScenario, segmentationScenario]

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
