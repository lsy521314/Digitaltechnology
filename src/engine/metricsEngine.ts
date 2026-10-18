import type { BusinessPathResult, NodeStatus } from '../types/network'
import type { Scenario } from '../types/scenario'
import type { AttackState, ControlledEndpoint, SimulationEvent, SimulationMetrics } from '../types/simulation'
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
  attackMetrics?: {
    state: AttackState
    transitions: number
    criticalAttackPaths: number
    reachableControlledEndpoints?: Record<string, ControlledEndpoint>
    criticalObjectiveReached?: boolean
    attackSearchComplete?: boolean
    representativeChainLength?: number
    blockedAttempts?: number
    networkRefusals?: number
    controlBlocks?: number
  },
): SimulationMetrics {
  const reachableControlledEndpoints = attackMetrics?.reachableControlledEndpoints ?? attackMetrics?.state.controlledEndpoints
  const affected = new Set(reachableControlledEndpoints ? Object.keys(reachableControlledEndpoints) : compromisedNodeIds)
  const networkCommunicationRefusals = attackMetrics?.networkRefusals
    ?? events.filter((event) => event.eventLayer === 'NETWORK' && event.result === 'block').length
  const teachingPropagationBlocks = attackMetrics?.controlBlocks
    ?? events.filter((event) => event.eventLayer === 'CONTROL' && event.result === 'block').length
  const propagationSteps = attackMetrics ? (attackMetrics.representativeChainLength ?? attackMetrics.transitions) : events.filter((event) => event.phase === 'propagation'
    && event.eventLayer === 'PROPAGATION' && event.result === 'compromise').length
  const reachable = businessPathResults.filter((path) => path.allowed).length
  const attackBlockedAttempts = attackMetrics?.blockedAttempts
    ?? events.filter((event) => event.attackTechniqueId && event.result === 'block').length
  const propagationAttempts = attackMetrics
    ? attackBlockedAttempts + attackMetrics.transitions
    : teachingPropagationBlocks + propagationSteps
  const blockedPropagationAttempts = attackMetrics ? attackBlockedAttempts : teachingPropagationBlocks
  const objectiveNodeId = scenario.challenge?.protectedNodeId ?? scenario.nodes.find((node) => node.isCritical)?.id
  const criticalObjectiveReached = attackMetrics
    ? attackMetrics.criticalObjectiveReached ?? Boolean(objectiveNodeId && attackMetrics.state.assetAccess[objectiveNodeId] === 'DATA_ACCESS')
    : Boolean(objectiveNodeId && affected.has(objectiveNodeId))

  return {
    totalNodes: scenario.nodes.length,
    affectedNodes: affected.size,
    affectedRatio: Math.round((affected.size / Math.max(scenario.nodes.length, 1)) * 100),
    networkCommunicationRefusals,
    teachingPropagationBlocks,
    propagationSteps,
    criticalAssetCompromised: scenario.nodes.some((node) => node.isCritical && affected.has(node.id)),
    blockedPropagationRatio: propagationAttempts ? Math.round((blockedPropagationAttempts / propagationAttempts) * 100) : 0,
    businessPathsTotal: businessPathResults.length,
    businessPathsReachable: reachable,
    businessReachability: businessPathResults.length ? Math.round((reachable / businessPathResults.length) * 100) : 100,
    ...(attackMetrics ? {
      attackTransitions: attackMetrics.transitions,
      controlledEndpoints: Object.keys(reachableControlledEndpoints ?? {}).length,
      adminControlledEndpoints: Object.values(reachableControlledEndpoints ?? {}).filter((endpoint) => endpoint.privilege === 'ADMIN').length,
      criticalObjectiveReached,
      criticalAttackPaths: attackMetrics.criticalAttackPaths,
      attackSearchComplete: attackMetrics.attackSearchComplete ?? true,
      representativeChainLength: attackMetrics.representativeChainLength ?? attackMetrics.transitions,
      uniqueBlockedCandidateCount: attackBlockedAttempts,
    } : {}),
  }
}
