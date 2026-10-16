import type { BusinessPathResult, NodeStatus } from '../types/network'
import type { Scenario } from '../types/scenario'
import type { SimulationEvent, SimulationMetrics } from '../types/simulation'
import { evaluateCommunication } from './communicationEngine'

export function evaluateBusinessPaths(scenario: Scenario, statuses: Record<string, NodeStatus>): BusinessPathResult[] {
  const runtimeScenario: Scenario = {
    ...scenario,
    nodes: scenario.nodes.map((node) => ({ ...node, status: statuses[node.id] ?? node.status })),
  }
  return scenario.businessPaths.map((path) => {
    const decision = evaluateCommunication(runtimeScenario, {
      sourceNodeId: path.sourceId,
      targetNodeId: path.targetId,
      serviceId: path.service,
    })
    const matched = decision.matchedRules.at(-1)
    return {
      ...path,
      allowed: decision.allowed,
      reason: decision.reason,
      detail: decision.detail,
      route: decision.path,
      routeEdgeIds: decision.routeEdgeIds,
      matchedRuleId: matched?.id,
      matchedRuleName: matched?.name,
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
  const networkCommunicationRefusals = events.filter((event) => event.eventLayer === 'NETWORK' && event.result === 'block').length
  const teachingPropagationBlocks = events.filter((event) => event.eventLayer === 'CONTROL' && event.result === 'block').length
  const blockedEvents = networkCommunicationRefusals + teachingPropagationBlocks
  const propagationSteps = events.filter((event) => event.eventLayer === 'PROPAGATION' && event.result === 'compromise').length
  const reachable = businessPathResults.filter((path) => path.allowed).length
  const propagationAttempts = teachingPropagationBlocks + propagationSteps

  return {
    totalNodes: scenario.nodes.length,
    affectedNodes: affected.size,
    affectedRatio: Math.round((affected.size / Math.max(scenario.nodes.length, 1)) * 100),
    blockedEvents,
    networkCommunicationRefusals,
    teachingPropagationBlocks,
    propagationSteps,
    criticalAssetCompromised: scenario.nodes.some((node) => node.isCritical && affected.has(node.id)),
    blockedPropagationRatio: propagationAttempts ? Math.round((teachingPropagationBlocks / propagationAttempts) * 100) : 0,
    businessPathsTotal: businessPathResults.length,
    businessPathsReachable: reachable,
    businessReachability: businessPathResults.length ? Math.round((reachable / businessPathResults.length) * 100) : 100,
  }
}
