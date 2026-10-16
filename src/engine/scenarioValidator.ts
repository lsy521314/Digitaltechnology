import { NETWORK_ZONES, SERVICE_TYPES } from '../types/network'
import type { NetworkInterface } from '../types/network'
import type { Scenario } from '../types/scenario'
import { isValidCidr, isIpInCidr, parseIPv4 } from './ipv4'

const serviceValues = new Set<string>(SERVICE_TYPES.filter((service) => service !== 'ANY'))
const zoneValues = new Set<string>(NETWORK_ZONES)

function duplicateIds(ids: string[]): string[] {
  const seen = new Set<string>()
  const duplicate = new Set<string>()
  for (const id of ids) { if (seen.has(id)) duplicate.add(id); seen.add(id) }
  return [...duplicate]
}

function isGatewayInterface(intf: NetworkInterface | undefined): boolean {
  return Boolean(intf && (intf.kind === 'L3_INTERFACE' || intf.kind === 'VLAN_GATEWAY') && intf.ipv4Address)
}

export function validateScenario(value: unknown): string[] {
  if (!value || typeof value !== 'object') return ['场景数据必须是对象。']
  const scenario = value as Partial<Scenario>
  const errors: string[] = []
  const arrays: Array<keyof Scenario> = ['nodes', 'interfaces', 'edges', 'vlans', 'routes', 'services', 'firewallPolicies', 'initialEvents', 'businessPaths']
  if (!scenario.id || !scenario.name) errors.push('场景必须包含 id 和 name。')
  for (const key of arrays) if (!Array.isArray(scenario[key])) errors.push(`${String(key)} 必须是数组。`)
  if (errors.length) return errors

  const nodes = scenario.nodes!
  const interfaces = scenario.interfaces!
  const edges = scenario.edges!
  const vlans = scenario.vlans!
  const routes = scenario.routes!
  const services = scenario.services!
  const policies = scenario.firewallPolicies!
  const events = scenario.initialEvents!
  const businessPaths = scenario.businessPaths!
  const nodeMap = new Map(nodes.map((node) => [node.id, node]))
  const interfaceMap = new Map(interfaces.map((intf) => [intf.id, intf]))
  const vlanMap = new Map(vlans.map((vlan) => [vlan.id, vlan]))
  const serviceIds = new Set(services.map((service) => service.serviceId))

  for (const id of duplicateIds(nodes.map((node) => node.id))) errors.push('节点 ID 重复：' + id)
  for (const node of nodes) {
    if (!node.id || !node.name) errors.push('每个节点都必须包含 id 和 name。')
    if (!zoneValues.has(node.zone)) errors.push('节点 ' + node.id + ' 的区域无效：' + node.zone)
    if (!['EXTERNAL_NETWORK', 'ENDPOINT', 'L2_SWITCH', 'L3_SWITCH', 'FIREWALL'].includes(node.deviceRole)) errors.push('节点 ' + node.id + ' 的设备角色无效。')
    for (const service of node.services ?? []) {
      if (!serviceValues.has(service)) errors.push('节点 ' + node.id + ' 的服务无效：' + service)
      if (!serviceIds.has(service)) errors.push('节点 ' + node.id + ' 引用了未定义的服务：' + service)
    }
  }

  for (const id of duplicateIds(interfaces.map((intf) => intf.id))) errors.push('接口 ID 重复：' + id)
  for (const intf of interfaces) {
    const owner = nodeMap.get(intf.nodeId)
    if (!owner) errors.push('接口 ' + intf.id + ' 引用了不存在的设备：' + intf.nodeId)
    if (intf.ipv4Address !== undefined && !parseIPv4(intf.ipv4Address)) errors.push('接口 ' + intf.id + ' 的 IPv4 地址无效：' + intf.ipv4Address)
    if (intf.prefixLength !== undefined && (!Number.isInteger(intf.prefixLength) || intf.prefixLength < 0 || intf.prefixLength > 32)) errors.push('接口 ' + intf.id + ' 的 prefix 无效。')
    if ((intf.ipv4Address === undefined) !== (intf.prefixLength === undefined)) errors.push('接口 ' + intf.id + ' 的 IPv4 地址和 prefix 必须同时配置。')
    if (intf.kind !== 'SWITCH_PORT' && (intf.switchportMode !== undefined || intf.accessVlanId !== undefined || intf.allowedVlanIds !== undefined)) errors.push('非 SWITCH_PORT 接口 ' + intf.id + ' 不得配置 ACCESS/TRUNK。')
    if (intf.kind === 'SWITCH_PORT') {
      if (owner && !['L2_SWITCH', 'L3_SWITCH'].includes(owner.deviceRole)) errors.push('SWITCH_PORT ' + intf.id + ' 必须属于二层或三层交换设备。')
      if (!intf.switchportMode) errors.push('交换机端口 ' + intf.id + ' 必须配置 ACCESS 或 TRUNK。')
      if (intf.switchportMode === 'ACCESS' && (intf.accessVlanId === undefined || !vlanMap.has(intf.accessVlanId))) errors.push('ACCESS 端口 ' + intf.id + ' 的 VLAN 不存在。')
      if (intf.switchportMode === 'TRUNK' && (!intf.allowedVlanIds?.length || intf.allowedVlanIds.some((id) => !vlanMap.has(id)))) errors.push('TRUNK 端口 ' + intf.id + ' 的允许 VLAN 无效。')
    }
    if (intf.kind === 'ENDPOINT_NIC' && owner && !['ENDPOINT', 'EXTERNAL_NETWORK'].includes(owner.deviceRole)) errors.push('ENDPOINT_NIC ' + intf.id + ' 必须属于终端或外部网络节点。')
    if ((intf.kind === 'L3_INTERFACE' || intf.kind === 'VLAN_GATEWAY') && owner && !['FIREWALL', 'L3_SWITCH'].includes(owner.deviceRole)) errors.push('三层接口 ' + intf.id + ' 必须属于 Firewall 或 L3 Switch。')
    if (intf.vlanId !== undefined && !vlanMap.has(intf.vlanId)) errors.push('接口 ' + intf.id + ' 配置了不存在的 VLAN ' + intf.vlanId + '。')
    if (intf.kind === 'VLAN_GATEWAY' && intf.parentInterfaceId && !interfaceMap.has(intf.parentInterfaceId)) errors.push('VLAN 网关 ' + intf.id + ' 的父接口不存在。')
  }

  for (const id of duplicateIds(edges.map((edge) => edge.id))) errors.push('物理连接 ID 重复：' + id)
  for (const edge of edges) {
    const sourceIntf = interfaceMap.get(edge.sourceInterfaceId)
    const targetIntf = interfaceMap.get(edge.targetInterfaceId)
    if (!nodeMap.has(edge.source)) errors.push('连接 ' + edge.id + ' 的 source 不存在：' + edge.source)
    if (!nodeMap.has(edge.target)) errors.push('连接 ' + edge.id + ' 的 target 不存在：' + edge.target)
    if (!sourceIntf) errors.push('连接 ' + edge.id + ' 的 sourceInterfaceId 不存在。')
    else if (sourceIntf.nodeId !== edge.source) errors.push('连接 ' + edge.id + ' 的源接口所属节点与 source 不一致。')
    if (!targetIntf) errors.push('连接 ' + edge.id + ' 的 targetInterfaceId 不存在。')
    else if (targetIntf.nodeId !== edge.target) errors.push('连接 ' + edge.id + ' 的目标接口所属节点与 target 不一致。')
  }

  for (const id of duplicateIds(vlans.map((vlan) => String(vlan.id)))) errors.push('VLAN ID 重复：' + id)
  for (const vlan of vlans) {
    if (!Number.isInteger(vlan.id) || vlan.id < 1 || vlan.id > 4094) errors.push('VLAN ID 无效：' + vlan.id)
    if (!zoneValues.has(vlan.zone)) errors.push('VLAN ' + vlan.id + ' 的 Zone 无效。')
    if (!isValidCidr(vlan.subnetCidr)) errors.push('VLAN ' + vlan.id + ' 的 Subnet CIDR 无效：' + vlan.subnetCidr)
    const gateway = interfaceMap.get(vlan.gatewayInterfaceId)
    if (!isGatewayInterface(gateway)) errors.push('VLAN ' + vlan.id + ' 的 Gateway 接口不存在或不是三层接口。')
    else if (gateway && gateway.vlanId !== vlan.id) errors.push('VLAN ' + vlan.id + ' 的 Gateway 接口 VLAN 不匹配。')
  }
  for (const intf of interfaces) {
    if (intf.ipv4Address && intf.vlanId !== undefined) {
      const vlan = vlanMap.get(intf.vlanId)
      if (vlan && isValidCidr(vlan.subnetCidr) && !isIpInCidr(intf.ipv4Address, vlan.subnetCidr)) errors.push('接口 ' + intf.id + ' 的 IP 不属于 VLAN ' + intf.vlanId + ' 子网。')
    }
  }

  for (const id of duplicateIds(routes.map((route) => route.id))) errors.push('路由 ID 重复：' + id)
  for (const route of routes) {
    if (!nodeMap.has(route.deviceId)) errors.push('路由 ' + route.id + ' 的设备不存在。')
    if (!isValidCidr(route.destinationCidr)) errors.push('路由 ' + route.id + ' 的目的 CIDR 无效。')
    const outInterface = interfaceMap.get(route.outInterfaceId)
    if (!outInterface || outInterface.nodeId !== route.deviceId) errors.push('路由 ' + route.id + ' 的出接口不存在或不属于该设备。')
    if (route.nextHopIp && !parseIPv4(route.nextHopIp)) errors.push('路由 ' + route.id + ' 的下一跳 IP 无效。')
    if (route.kind === 'STATIC' && !route.nextHopIp) errors.push('静态路由 ' + route.id + ' 缺少下一跳。')
    if (route.kind === 'DEFAULT' && route.destinationCidr !== '0.0.0.0/0') errors.push('默认路由 ' + route.id + ' 必须使用 0.0.0.0/0。')
    if (route.kind === 'DEFAULT' && !route.nextHopIp) {
      const hasExternalPeer = Boolean(outInterface && edges.some((edge) => {
        const localIsSource = edge.source === route.deviceId && edge.sourceInterfaceId === route.outInterfaceId
        const localIsTarget = edge.target === route.deviceId && edge.targetInterfaceId === route.outInterfaceId
        if (!localIsSource && !localIsTarget) return false
        const peerNodeId = localIsSource ? edge.target : edge.source
        return nodeMap.get(peerNodeId)?.deviceRole === 'EXTERNAL_NETWORK'
      }))
      if (!hasExternalPeer) errors.push('默认路由 ' + route.id + ' 缺少下一跳或直连外部网络。')
    }
  }
  for (const route of routes.filter((item) => item.nextHopIp)) {
    const out = interfaceMap.get(route.outInterfaceId)
    const prefix = out?.prefixLength
    if (out?.ipv4Address && prefix !== undefined) {
      const connected = out.ipv4Address + '/' + prefix
      if (!isIpInCidr(route.nextHopIp!, connected)) errors.push('路由 ' + route.id + ' 的下一跳不在出接口直连子网。')
    }
    const peerFound = edges.some((edge) => {
      const localId = edge.source === route.deviceId ? edge.sourceInterfaceId : edge.target === route.deviceId ? edge.targetInterfaceId : null
      if (localId !== route.outInterfaceId) return false
      const remoteId = edge.sourceInterfaceId === localId ? edge.targetInterfaceId : edge.sourceInterfaceId
      return interfaceMap.get(remoteId)?.ipv4Address === route.nextHopIp
    })
    if (!peerFound) errors.push('路由 ' + route.id + ' 的下一跳没有通过指定接口连接到相邻设备。')
  }

  for (const id of duplicateIds(services.map((service) => service.serviceId))) errors.push('服务 ID 重复：' + id)
  for (const service of services) {
    if (!serviceValues.has(service.serviceId)) errors.push('服务定义无效：' + service.serviceId)
    if (service.destinationPort !== undefined && service.destinationPort !== 'TO_BE_VERIFIED'
      && (!Number.isInteger(service.destinationPort) || service.destinationPort < 1 || service.destinationPort > 65535)) errors.push('服务 ' + service.serviceId + ' 的目的端口无效。')
  }

  const firewallIds = new Set(nodes.filter((node) => node.deviceRole === 'FIREWALL').map((node) => node.id))
  for (const id of duplicateIds(policies.map((policy) => policy.firewallId))) errors.push('Firewall Policy 重复：' + id)
  for (const policy of policies) {
    if (!firewallIds.has(policy.firewallId)) errors.push('Firewall Policy 引用了非防火墙设备：' + policy.firewallId)
    if (!['ALLOW', 'DENY'].includes(policy.defaultAction)) errors.push('Firewall ' + policy.firewallId + ' Default Policy 无效。')
    for (const id of duplicateIds(policy.rules.map((item) => item.id))) errors.push('Firewall ' + policy.firewallId + ' 规则 ID 重复：' + id)
    for (const id of duplicateIds(policy.rules.map((item) => String(item.order)))) errors.push('Firewall ' + policy.firewallId + ' 规则 order 重复：' + id)
    for (const item of policy.rules) {
      if (item.firewallId !== policy.firewallId) errors.push('规则 ' + item.id + ' 的 firewallId 与所属策略不一致。')
      if (!Number.isInteger(item.order) || item.order < 0) errors.push('规则 ' + item.id + ' 的 order 无效。')
      if (item.serviceId !== 'ANY' && !serviceIds.has(item.serviceId)) errors.push('规则 ' + item.id + ' 引用了未定义的服务。')
      if (!['ALLOW', 'DENY'].includes(item.action)) errors.push('规则 ' + item.id + ' 的动作无效。')
      for (const selector of [item.source, item.destination]) {
        if (selector.kind === 'NODE' && !nodeMap.has(selector.nodeId)) errors.push('规则 ' + item.id + ' 的 NODE Selector 引用了不存在的节点。')
        if (selector.kind === 'ZONE' && !zoneValues.has(selector.zone)) errors.push('规则 ' + item.id + ' 的 ZONE Selector 无效。')
      }
    }
  }

  for (const trigger of events) {
    if (!nodeMap.has(trigger.sourceId) || !nodeMap.has(trigger.targetId)) errors.push('初始事件 ' + trigger.id + ' 引用了不存在的节点。')
    if (!serviceIds.has(trigger.service)) errors.push('初始事件 ' + trigger.id + ' 的服务未定义。')
  }
  for (const path of businessPaths) {
    if (!path.id || !path.label) errors.push('业务路径必须包含 id 和 label。')
    if (!nodeMap.has(path.sourceId) || !nodeMap.has(path.targetId)) errors.push('业务路径 ' + path.id + ' 引用了不存在的节点。')
    if (!serviceIds.has(path.service)) errors.push('业务路径 ' + path.id + ' 的服务未定义。')
    const target = nodeMap.get(path.targetId)
    if (target && !target.services?.includes(path.service)) errors.push('业务路径 ' + path.id + ' 的目标未提供服务 ' + path.service + '。')
  }
  for (const id of duplicateIds(businessPaths.map((path) => path.id))) errors.push('业务路径 ID 重复：' + id)

  if (scenario.challenge) {
    if (!nodeMap.has(scenario.challenge.protectedNodeId)) errors.push('安全挑战引用了不存在的关键节点。')
    const businessPathIds = new Set(businessPaths.map((path) => path.id))
    for (const id of scenario.challenge.requiredBusinessPathIds) if (!businessPathIds.has(id)) errors.push('安全挑战引用了不存在的业务路径：' + id)
  }
  return errors
}

export function assertValidScenario(value: unknown): asserts value is Scenario {
  const errors = validateScenario(value)
  if (errors.length) throw new Error('场景 JSON 校验失败：' + errors.join(' '))
}
