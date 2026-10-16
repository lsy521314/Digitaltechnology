import type { CommunicationDecision, CommunicationReason, FirewallRule, NetworkInterface, NetworkNode, ServiceId } from '../types/network'
import type { Scenario } from '../types/scenario'
import { evaluateFirewall } from './ruleEngine'
import { findNextHop, lookupRoute } from './routingEngine'
import { findLayer2Path, findPhysicalPath, type NetworkPath } from './topologyEngine'
import { sameSubnet } from './ipv4'

export interface CommunicationRequest {
  sourceNodeId: string
  targetNodeId: string
  serviceId: ServiceId
  transport?: 'TCP' | 'UDP'
  destinationPort?: number
}

function unavailable(node: NetworkNode | undefined): boolean {
  return Boolean(node && (node.status === 'isolated' || node.isolationEnabled))
}

function endpointNic(scenario: Scenario, nodeId: string): NetworkInterface | undefined {
  return scenario.interfaces.find((item) => item.nodeId === nodeId && item.kind === 'ENDPOINT_NIC' && item.enabled)
}

function appendPath(target: NetworkPath, segment: NetworkPath): void {
  if (target.nodeIds.length === 0) target.nodeIds.push(...segment.nodeIds)
  else target.nodeIds.push(...segment.nodeIds.slice(1))
  target.edgeIds.push(...segment.edgeIds)
}

function baseDecision(scenario: Scenario, request: CommunicationRequest, reason: CommunicationReason, detail: string, path: NetworkPath = { nodeIds: [], edgeIds: [] }): CommunicationDecision {
  const source = scenario.nodes.find((node) => node.id === request.sourceNodeId)
  const target = scenario.nodes.find((node) => node.id === request.targetNodeId)
  return {
    allowed: false,
    sourceNodeId: request.sourceNodeId,
    targetNodeId: request.targetNodeId,
    sourceIp: endpointNic(scenario, request.sourceNodeId)?.ipv4Address,
    targetIp: endpointNic(scenario, request.targetNodeId)?.ipv4Address,
    path: path.nodeIds,
    routeEdgeIds: path.edgeIds,
    firewallsTraversed: [],
    firewallDecisions: [],
    matchedRules: [],
    serviceId: request.serviceId,
    reason,
    detail,
    blockedAt: reason === 'ISOLATED' ? (source && unavailable(source) ? source.name : target?.name) : undefined,
  }
}

function classifyL2Failure(scenario: Scenario, sourceId: string, targetId: string, vlanId: number): { reason: CommunicationReason; detail: string } {
  const physical = findPhysicalPath(sourceId, targetId, scenario.edges, true)
  if (physical) {
    const isolatedNode = physical.nodeIds.map((id) => scenario.nodes.find((node) => node.id === id)).find(unavailable)
    if (isolatedNode) return { reason: 'ISOLATED', detail: `${isolatedNode.name} 已隔离，不能参与通信或中继。` }
    const disabledEdge = physical.edgeIds.find((id) => !scenario.edges.find((edge) => edge.id === id)?.enabled)
    if (disabledEdge) return { reason: 'LINK_DISABLED', detail: `物理链路 ${disabledEdge} 已禁用。` }
    return { reason: 'VLAN_MISMATCH', detail: `物理链路存在，但接口未共同承载 VLAN ${vlanId}。` }
  }
  return { reason: 'NO_L2_PATH', detail: '设备之间不存在满足 VLAN 条件的二层路径。' }
}

function mergeAndCheckRoutedPath(scenario: Scenario, source: NetworkNode, sourceNic: NetworkInterface, target: NetworkNode, targetNic: NetworkInterface): { path?: NetworkPath; reason?: CommunicationReason; detail?: string } {
  const path: NetworkPath = { nodeIds: [], edgeIds: [] }
  if (source.deviceRole === 'EXTERNAL_NETWORK') {
    const link = scenario.edges.find((edge) => edge.enabled && (edge.source === source.id || edge.target === source.id))
    if (!link) return { path, reason: 'NO_ROUTE', detail: '外部网络没有连接到边界路由设备。' }
    const edgeIntfId = link.source === source.id ? link.sourceInterfaceId : link.targetInterfaceId
    const remoteIntfId = link.source === source.id ? link.targetInterfaceId : link.sourceInterfaceId
    const local = scenario.interfaces.find((item) => item.id === edgeIntfId)
    const remote = scenario.interfaces.find((item) => item.id === remoteIntfId)
    const remoteNode = scenario.nodes.find((node) => node.id === remote?.nodeId)
    if (!local?.enabled || !remote?.enabled || !remoteNode || unavailable(remoteNode)) return { path, reason: unavailable(remoteNode) ? 'ISOLATED' : 'LINK_DISABLED', detail: '外部边界接口或其直连设备不可用。' }
    path.nodeIds.push(source.id, remoteNode.id)
    path.edgeIds.push(link.id)
    return continueRouting(scenario, remoteNode.id, target, targetNic, path)
  }

  const vlan = scenario.vlans.find((item) => item.id === sourceNic.vlanId)
  const gateway = vlan && scenario.interfaces.find((item) => item.id === vlan.gatewayInterfaceId && item.enabled)
  const gatewayNode = gateway && scenario.nodes.find((node) => node.id === gateway.nodeId)
  if (!vlan || !gateway || !gatewayNode) return { path, reason: 'NO_INTERFACE', detail: '源端点 VLAN 或其默认网关接口未配置。' }
  if (unavailable(gatewayNode)) return { path, reason: 'ISOLATED', detail: '默认网关设备处于隔离状态。' }
  const sourcePath = findLayer2Path(source.id, gatewayNode.id, vlan.id, scenario.nodes, scenario.edges, scenario.interfaces)
  if (!sourcePath) {
    const failure = classifyL2Failure(scenario, source.id, gatewayNode.id, vlan.id)
    return { path, ...failure }
  }
  appendPath(path, sourcePath)
  return continueRouting(scenario, gatewayNode.id, target, targetNic, path)
}

function continueRouting(scenario: Scenario, startRouterId: string, target: NetworkNode, targetNic: NetworkInterface, path: NetworkPath): { path?: NetworkPath; reason?: CommunicationReason; detail?: string } {
  let currentId = startRouterId
  const visited = new Set<string>()
  for (let hops = 0; hops < 16; hops += 1) {
    if (currentId === target.id) return { path }
    if (visited.has(currentId)) return { path, reason: 'NO_ROUTE', detail: `路由在 ${currentId} 形成循环。` }
    visited.add(currentId)

    const routeLookup = targetNic.ipv4Address ? lookupRoute(scenario, currentId, targetNic.ipv4Address) : null
    if (!routeLookup) return { path, reason: 'NO_ROUTE', detail: `${currentId} 没有到 ${targetNic.ipv4Address ?? target.id} 的匹配路由。` }
    const { route } = routeLookup
    if (route.kind === 'DIRECT') {
      const directInterface = scenario.interfaces.find((item) => item.id === route.outInterfaceId)
      if (!directInterface?.enabled) return { path, reason: 'NO_INTERFACE', detail: `直连路由接口 ${route.outInterfaceId} 不可用。` }
      if (targetNic.vlanId !== undefined) {
        const segment = findLayer2Path(currentId, target.id, targetNic.vlanId, scenario.nodes, scenario.edges, scenario.interfaces)
        if (!segment) {
          const physical = findPhysicalPath(currentId, target.id, scenario.edges, true)
          if (physical) return { path, ...classifyL2Failure(scenario, currentId, target.id, targetNic.vlanId) }
          return { path, reason: 'NO_L2_PATH', detail: `直连网络 ${route.destinationCidr} 缺少到目标的二层链路。` }
        }
        appendPath(path, segment)
        return { path }
      }
      const directEdge = scenario.edges.find((edge) => edge.enabled
        && ((edge.source === currentId && edge.target === target.id) || (edge.target === currentId && edge.source === target.id)))
      if (!directEdge) return { path, reason: 'NO_L2_PATH', detail: '直连外部接口之间没有启用的物理链路。' }
      path.edgeIds.push(directEdge.id)
      path.nodeIds.push(target.id)
      return { path }
    }

    const hop = findNextHop(scenario, scenario.edges, currentId, route)
    if (!hop) {
      const disabledLink = scenario.edges.find((edge) => {
        if (edge.enabled) return false
        const localId = edge.source === currentId ? edge.sourceInterfaceId : edge.target === currentId ? edge.targetInterfaceId : null
        const remoteId = edge.sourceInterfaceId === route.outInterfaceId ? edge.targetInterfaceId : edge.sourceInterfaceId
        return localId === route.outInterfaceId && scenario.interfaces.find((intf) => intf.id === remoteId)?.ipv4Address === route.nextHopIp
      })
      if (disabledLink) return { path, reason: 'LINK_DISABLED', detail: `下一跳链路 ${disabledLink.id} 已禁用。` }
      return { path, reason: 'NO_ROUTE', detail: `路由 ${route.id} 的下一跳无法通过指定接口解析。` }
    }
    if (unavailable(hop.node)) return { path, reason: 'ISOLATED', detail: `下一跳 ${hop.node.name} 处于隔离状态。` }
    path.edgeIds.push(hop.edge.id)
    path.nodeIds.push(hop.node.id)
    currentId = hop.node.id
  }
  return { path, reason: 'NO_ROUTE', detail: '超过最大路由跳数，未到达目标网络。' }
}

function finalizeFirewalls(scenario: Scenario, request: CommunicationRequest, path: NetworkPath): CommunicationDecision {
  const source = scenario.nodes.find((node) => node.id === request.sourceNodeId)!
  const target = scenario.nodes.find((node) => node.id === request.targetNodeId)!
  const traversed = path.nodeIds.filter((id, index) => scenario.nodes.find((node) => node.id === id)?.deviceRole === 'FIREWALL'
    && path.nodeIds.indexOf(id) === index)
  const decisions = []
  const matchedRules: FirewallRule[] = []
  for (const firewallId of traversed) {
    const policy = scenario.firewallPolicies.find((item) => item.firewallId === firewallId)
    const evaluated = evaluateFirewall(policy, firewallId, source, target, request.serviceId)
    decisions.push(evaluated.decision)
    if (evaluated.matchedRule) matchedRules.push(evaluated.matchedRule)
    if (!evaluated.decision.allowed) {
      const index = path.nodeIds.indexOf(firewallId)
      return {
        allowed: false, sourceNodeId: source.id, targetNodeId: target.id,
        sourceIp: endpointNic(scenario, source.id)?.ipv4Address, targetIp: endpointNic(scenario, target.id)?.ipv4Address,
        path: path.nodeIds.slice(0, index + 1), routeEdgeIds: path.edgeIds.slice(0, index),
        firewallsTraversed: traversed.slice(0, decisions.length), firewallDecisions: decisions, matchedRules,
        serviceId: request.serviceId, reason: 'FIREWALL_DENY', detail: `${scenario.nodes.find((node) => node.id === firewallId)?.name} 拒绝通信：${evaluated.decision.reason}`,
        blockedAt: firewallId,
      }
    }
  }
  return {
    allowed: true, sourceNodeId: source.id, targetNodeId: target.id,
    sourceIp: endpointNic(scenario, source.id)?.ipv4Address, targetIp: endpointNic(scenario, target.id)?.ipv4Address,
    path: path.nodeIds, routeEdgeIds: path.edgeIds, firewallsTraversed: traversed,
    firewallDecisions: decisions, matchedRules, serviceId: request.serviceId,
    reason: 'ALLOWED', detail: traversed.length ? '所有路径内防火墙均允许该通信。' : '同 VLAN 二层路径可达，未经过防火墙。',
  }
}

export function evaluateCommunication(scenario: Scenario, request: CommunicationRequest): CommunicationDecision {
  const source = scenario.nodes.find((node) => node.id === request.sourceNodeId)
  const target = scenario.nodes.find((node) => node.id === request.targetNodeId)
  if (!source || !target) return baseDecision(scenario, request, 'NO_INTERFACE', '源或目标节点不存在。')
  if (unavailable(source) || unavailable(target)) return baseDecision(scenario, request, 'ISOLATED', '源节点或目标节点已隔离。')
  const sourceNic = endpointNic(scenario, source.id)
  const targetNic = endpointNic(scenario, target.id)
  if (!sourceNic || !targetNic || !sourceNic.ipv4Address || !targetNic.ipv4Address) return baseDecision(scenario, request, 'NO_INTERFACE', '源或目标端点缺少已启用的 IPv4 网卡。')
  if (!target.services?.includes(request.serviceId)) return baseDecision(scenario, request, 'SERVICE_UNAVAILABLE', `${target.name} 未提供 ${request.serviceId} 服务。`)

  if (sourceNic.vlanId !== undefined && targetNic.vlanId !== undefined
    && sourceNic.vlanId === targetNic.vlanId
    && sourceNic.prefixLength !== undefined && targetNic.prefixLength !== undefined
    && sourceNic.prefixLength === targetNic.prefixLength
    && sourceNic.prefixLength >= 0 && sourceNic.prefixLength <= 32
    && sourceNic.ipv4Address.split('.').length === 4 && targetNic.ipv4Address.split('.').length === 4) {
    const sourcePrefix = sourceNic.prefixLength
    if (sameSubnet(sourceNic.ipv4Address, targetNic.ipv4Address, sourcePrefix)) {
      const l2 = findLayer2Path(source.id, target.id, sourceNic.vlanId, scenario.nodes, scenario.edges, scenario.interfaces)
      if (!l2) {
        const reason = classifyL2Failure(scenario, source.id, target.id, sourceNic.vlanId)
        return baseDecision(scenario, request, reason.reason, reason.detail)
      }
      return finalizeFirewalls(scenario, request, l2)
    }
  }

  const routed = mergeAndCheckRoutedPath(scenario, source, sourceNic, target, targetNic)
  if (!routed.path || routed.reason) return baseDecision(scenario, request, routed.reason ?? 'NO_ROUTE', routed.detail ?? '网络路径计算失败。', routed.path)
  return finalizeFirewalls(scenario, request, routed.path)
}

export const canCommunicate = evaluateCommunication
