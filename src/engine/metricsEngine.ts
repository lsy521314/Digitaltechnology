import type { BusinessPathResult, NodeStatus } from '../types/network'
import type { Scenario } from '../types/scenario'
import type { SimulationEvent, SimulationMetrics } from '../types/simulation'
import { canCommunicate } from './ruleEngine'

export function evaluateBusinessPaths(scenario: Scenario, statuses: Record<string, NodeStatus>): BusinessPathResult[] {
  const nodes = scenario.nodes.map((node) => ({ ...node, status: statuses[node.id] ?? node.status }))
  return scenario.businessPaths.map((path) => {
    const source = nodes.find((node) => node.id === path.sourceId)
    const target = nodes.find((node) => node.id === path.targetId)
    if (!source || !target) {
      return { ...path, allowed: false, reason: '业务路径引用了不存在的节点。', route: [], routeEdgeIds: [] }
    }
    const decision = canCommunicate(source, target, path.service, nodes, scenario.edges, scenario.rules)
    return {
      ...path,
      allowed: decision.allowed,
      reason: decision.reason,
      route: decision.route,
      routeEdgeIds: decision.routeEdgeIds,
      matchedRuleId: decision.matchedRule?.id,
      matchedRuleName: decision.matchedRule?.name,
    }
  })
}

export function calculateMetrics(
  scenario: Scenario,
  events: SimulationEvent[],
  compromisedNodeIds: string[],
  businessPathResults: BusinessPathResult[],
): SimulationMetrics {
  const affected = new Set(compromisedNodeIds)
  const blockedEvents = events.filter((event) => event.result === 'block').length
  const propagationSteps = events.filter((event) => event.phase === 'propagation' && event.result === 'compromise').length
  const blockedPropagationEvents = events.filter((event) => event.phase === 'propagation' && event.result === 'block').length
  const propagationAttempts = blockedPropagationEvents + propagationSteps
  const reachable = businessPathResults.filter((path) => path.allowed).length

  return {
    totalNodes: scenario.nodes.length,
    affectedNodes: affected.size,
    affectedRatio: Math.round((affected.size / Math.max(scenario.nodes.length, 1)) * 100),
    blockedEvents,
    propagationSteps,
    criticalAssetCompromised: scenario.nodes.some((node) => node.isCritical && affected.has(node.id)),
    blockedPropagationRatio: propagationAttempts ? Math.round((blockedPropagationEvents / propagationAttempts) * 100) : 0,
    businessPathsTotal: businessPathResults.length,
    businessPathsReachable: reachable,
    businessReachability: businessPathResults.length ? Math.round((reachable / businessPathResults.length) * 100) : 100,
  }
}
