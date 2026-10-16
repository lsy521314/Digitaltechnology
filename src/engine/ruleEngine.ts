import type { NetworkEdge, NetworkNode, SecurityRule, ServiceType } from '../types/network'
import { findPath, findServicePath, type NetworkPath } from './topologyEngine'

export interface CommunicationDecision {
  allowed: boolean
  reason: string
  route: string[]
  routeEdgeIds: string[]
  blockedAt?: string
  matchedRule?: SecurityRule
}

function isIsolated(node: NetworkNode | undefined): boolean {
  return Boolean(node && (node.status === 'isolated' || node.isolationEnabled))
}

function specificity(rule: SecurityRule): number {
  return Number(rule.sourceZone !== 'ANY') + Number(rule.targetZone !== 'ANY') + Number(rule.service !== 'ANY')
}

function resolveRule(source: NetworkNode, target: NetworkNode, service: ServiceType, rules: SecurityRule[]): SecurityRule | undefined {
  return rules
    .map((rule, index) => ({ rule, index }))
    .filter(({ rule }) => rule.enabled
      && (rule.sourceZone === 'ANY' || rule.sourceZone === source.zone)
      && (rule.targetZone === 'ANY' || rule.targetZone === target.zone)
      && (rule.service === 'ANY' || rule.service === service))
    .sort((a, b) => specificity(b.rule) - specificity(a.rule)
      || Number(b.rule.action === 'DENY') - Number(a.rule.action === 'DENY')
      || a.index - b.index)[0]?.rule
}

function decisionWithPath(
  allowed: boolean,
  reason: string,
  path: NetworkPath | null,
  blockedAt?: string,
  matchedRule?: SecurityRule,
): CommunicationDecision {
  return {
    allowed,
    reason,
    route: path?.nodeIds ?? [],
    routeEdgeIds: path?.edgeIds ?? [],
    blockedAt,
    matchedRule,
  }
}

export function canCommunicate(
  source: NetworkNode,
  target: NetworkNode,
  service: ServiceType,
  nodes: NetworkNode[],
  edges: NetworkEdge[],
  rules: SecurityRule[],
): CommunicationDecision {
  const path = findServicePath(source.id, target.id, service, edges, nodes)
  if (!path) {
    const isolatedPath = findServicePath(source.id, target.id, service, edges, nodes, { ignoreIsolation: true })
    if (isolatedPath) {
      const isolationNode = isolatedPath.nodeIds
        .map((id) => nodes.find((node) => node.id === id))
        .find((node) => isIsolated(node))
      if (isolationNode) {
        return decisionWithPath(false, '节点因隔离状态不可达，通信路径在此中断。', isolatedPath, isolationNode.name)
      }
    }
    if (isIsolated(source) || isIsolated(target)) {
      const physicalPath = isolatedPath ?? findPath(source.id, target.id, edges, { nodes, ignoreIsolation: true })
      const isolated = isIsolated(source) ? source : target
      return decisionWithPath(false, '节点因隔离状态不可达，通信被阻断。', physicalPath, isolated.name)
    }
    const physicalPath = findPath(source.id, target.id, edges, { nodes })
    const reason = physicalPath
      ? '拓扑连通，但路径不承载 ' + service + ' 服务。'
      : '当前拓扑中不存在可用路径。'
    return decisionWithPath(false, reason, physicalPath, physicalPath ? '服务边界' : '拓扑边界')
  }

  const matchedRule = resolveRule(source, target, service, rules)
  if (matchedRule?.action === 'DENY') {
    return decisionWithPath(false, '命中拒绝规则：' + matchedRule.name + '。', path, target.zone + ' 区域边界', matchedRule)
  }
  if (matchedRule?.action === 'ALLOW') {
    return decisionWithPath(true, '命中允许规则：' + matchedRule.name + '。', path, undefined, matchedRule)
  }
  return decisionWithPath(true, '拓扑可达，未命中安全规则，按默认 ALLOW 放行。', path)
}
