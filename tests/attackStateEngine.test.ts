import { describe, expect, it } from 'vitest'
import { cloneScenario, lateralScenario } from '../src/data/scenarios'
import { lateralTeachingTechniques, evaluateTeachingTechnique, runAttackStateEngine, attackStateSignature, MAX_ATTACK_DEPTH, MAX_ATTACK_STATES } from '../src/engine/attackStateEngine'
import { buildComparisonScenarios } from '../src/engine/comparisonEngine'
import { runSimulation } from '../src/engine/simulationEngine'
import { evaluateCommunication } from '../src/engine/communicationEngine'
import type { AttackState } from '../src/types/simulation'

const technique = (id: string) => lateralTeachingTechniques.find((item) => item.id === id)!
const initial: AttackState = {
  controlledEndpoints: { pc01: { nodeId: 'pc01', privilege: 'USER' } },
  assetAccess: { db: 'NONE' },
  executedTransitionIds: [],
}
const internalPolicy = (scenario: typeof lateralScenario) => scenario.firewallPolicies.find((policy) => policy.firewallId === 'internal-fw')!

describe('AttackState V1 for the lateral scenario', () => {
  it('starts with PC-01 controlled at USER privilege, separate from display node status', () => {
    expect(lateralScenario.simulationMode).toBe('ATTACK_STATE')
    expect(lateralScenario.initialAttackState).toEqual(initial)
    const result = runSimulation(lateralScenario)
    expect(result.finalAttackState?.controlledEndpoints.pc01?.privilege).toBe('USER')
    expect(result.events.find((event) => event.type === 'seed')?.eventLayer).toBe('ATTACK')
  })

  it('does not execute a technique when the communication path is unavailable', () => {
    const scenario = cloneScenario(lateralScenario)
    scenario.edges.find((edge) => edge.id === 'l-core-internal')!.enabled = false
    const assessment = evaluateTeachingTechnique(scenario, initial, 'pc01', 'app', technique('application-access'))
    expect(assessment.communicationDecision?.allowed).toBe(false)
    expect(assessment.executable).toBe(false)
    expect(assessment.preconditions.find((item) => item.id === 'communication')?.passed).toBe(false)
  })

  it('does not execute when communication is allowed but target teaching conditions are absent', () => {
    const scenario = cloneScenario(lateralScenario)
    scenario.nodes.find((node) => node.id === 'app')!.teachingConditions = ['APPLICATION_SERVICE_ROLE']
    const assessment = evaluateTeachingTechnique(scenario, initial, 'pc01', 'app', technique('application-access'))
    expect(assessment.communicationDecision?.allowed).toBe(true)
    expect(assessment.executable).toBe(false)
    expect(assessment.preconditions.find((item) => item.id === 'target-REMOTE_ACCESS_EXPOSED')?.passed).toBe(false)
  })

  it('grants USER control only when network and target teaching conditions pass', () => {
    const result = runSimulation(lateralScenario)
    expect(result.finalAttackState?.controlledEndpoints.app?.privilege).toBe('ADMIN')
    expect(result.attackTransitions?.some((item) => item.sourceNodeId === 'pc01' && item.targetNodeId === 'app' && item.techniqueId === 'application-access')).toBe(true)
  })

  it('requires ADMIN and the application service role for Database Access', () => {
    const assessment = evaluateTeachingTechnique(lateralScenario, initial, 'pc01', 'db', technique('database-access'))
    expect(assessment.communicationDecision?.allowed).toBe(true)
    expect(assessment.executable).toBe(false)
    expect(assessment.preconditions.find((item) => item.id === 'source-privilege')?.passed).toBe(false)
    expect(assessment.preconditions.find((item) => item.id === 'source-APPLICATION_SERVICE_ROLE')?.passed).toBe(false)
  })

  it('models local privilege escalation as USER → ADMIN', () => {
    const result = runSimulation(lateralScenario)
    const escalation = result.attackTransitions?.find((item) => item.techniqueId === 'privilege-escalation' && item.targetNodeId === 'app')
    expect(escalation?.targetPrivilegeBefore).toBe('USER')
    expect(escalation?.targetPrivilegeAfter).toBe('ADMIN')
    expect(escalation?.communicationDecision).toBeNull()
  })

  it('maps legacy protectionEnabled to ENDPOINT_PROTECTION and blocks only techniques that declare it', () => {
    const scenario = cloneScenario(lateralScenario)
    scenario.nodes.find((node) => node.id === 'pc02')!.protectionEnabled = true
    const result = runSimulation(scenario)
    expect(result.finalAttackState?.controlledEndpoints.pc02).toBeUndefined()
    expect(result.attackSearchResult?.searchEvaluations.some((item) => item.targetNodeId === 'pc02'
      && item.preconditionChecks.some((check) => check.id === 'security-controls' && !check.passed)
      && item.reason.includes('终端防护'))).toBe(true)

    const appState: AttackState = {
      controlledEndpoints: { app: { nodeId: 'app', privilege: 'USER' } },
      assetAccess: { db: 'NONE' },
      executedTransitionIds: [],
    }
    const localEscalation = evaluateTeachingTechnique(scenario, appState, 'app', 'app', technique('privilege-escalation'))
    expect(localEscalation.executable).toBe(true)
  })

  it('blocks techniques through the shared communication evaluator when a node is isolated', () => {
    const scenario = cloneScenario(lateralScenario)
    scenario.nodes.find((node) => node.id === 'pc02')!.isolationEnabled = true
    const run = runAttackStateEngine(scenario)
    expect(run.finalState.controlledEndpoints.pc02).toBeUndefined()
    expect(run.actions.some((action) => action.kind === 'blocked'
      && action.assessment.targetNodeId === 'pc02'
      && action.assessment.communicationDecision?.reason === 'ISOLATED')).toBe(true)
  })

  it('changes reachable AttackTransitions when the Firewall closes the Office-to-App path', () => {
    const scenario = cloneScenario(lateralScenario)
    internalPolicy(scenario).rules.find((rule) => rule.id === 'internal-25-office-app-web')!.enabled = false
    const result = runSimulation(scenario)
    expect(result.finalAttackState?.controlledEndpoints.app).toBeUndefined()
    expect(result.finalAttackState?.assetAccess.db).toBe('NONE')
  })

  it('requires the Application → Database Firewall rule for the DATA_ACCESS objective', () => {
    const scenario = cloneScenario(lateralScenario)
    internalPolicy(scenario).rules.find((rule) => rule.id === 'internal-10-app-db')!.enabled = false
    const result = runSimulation(scenario)
    expect(result.finalAttackState?.controlledEndpoints.app?.privilege).toBe('ADMIN')
    expect(result.finalAttackState?.assetAccess.db).toBe('NONE')
    expect(result.events.some((event) => event.attackTechniqueId === 'database-access' && event.eventLayer === 'NETWORK' && event.result === 'block')).toBe(true)
  })

  it('does not convert allowed PC-01 → Database communication into host control or data access', () => {
    const scenario = cloneScenario(lateralScenario)
    internalPolicy(scenario).rules.find((rule) => rule.id === 'internal-10-app-db')!.enabled = false
    const result = runSimulation(scenario)
    const communication = evaluateCommunication(lateralScenario, { sourceNodeId: 'pc01', targetNodeId: 'db', serviceId: 'DATABASE' })
    expect(communication.allowed).toBe(true)
    expect(result.finalAttackState?.controlledEndpoints.db).toBeUndefined()
    expect(result.finalAttackState?.assetAccess.db).toBe('NONE')
    expect(result.finalStatuses.db).toBe('normal')
  })

  it('produces deterministic states, transitions, and finite state expansion', () => {
    const first = runAttackStateEngine(lateralScenario)
    const second = runAttackStateEngine(lateralScenario)
    expect(first.finalState).toEqual(second.finalState)
    expect(first.transitions).toEqual(second.transitions)
    expect(first.transitions.length).toBeLessThan(200)
    expect(first.exploredStateCount).toBeLessThanOrEqual(MAX_ATTACK_STATES)
    expect(first.depthLimitReached).toBe(false)
    expect(first.stateLimitReached).toBe(false)
    expect(new Set(first.transitions.map((item) => item.id)).size).toBe(first.transitions.length)
  })

  it('finds the main Office → Application → Database teaching chain without requiring a second route', () => {
    const result = runSimulation(lateralScenario)
    expect(result.metrics.criticalObjectiveReached).toBe(true)
    expect(result.metrics.criticalAttackPaths).toBeGreaterThanOrEqual(1)
    expect(result.finalAttackState?.assetAccess.db).toBe('DATA_ACCESS')
    const transitions = result.attackTransitions ?? []
    expect(transitions.some((item) => item.sourceNodeId === 'pc01' && item.targetNodeId === 'pc02' && item.techniqueId === 'remote-service-movement')).toBe(true)
    expect(transitions.some((item) => item.sourceNodeId === 'pc01' && item.targetNodeId === 'app' && item.techniqueId === 'application-access')).toBe(true)
    expect(transitions.some((item) => item.sourceNodeId === 'app' && item.targetNodeId === 'db' && item.techniqueId === 'database-access')).toBe(true)
    expect(transitions.every((item) => item.result === 'SUCCESS')).toBe(true)
  })

  it('emits a successful DATA_ACCESS event without marking the database host compromised', () => {
    const result = runSimulation(lateralScenario)
    const event = result.events.find((item) => item.attackTechniqueId === 'database-access'
      && item.attackTransitionResult === 'SUCCESS' && item.attackEffect === 'DATA_ACCESS_GRANTED')
    expect(event).toBeDefined()
    expect(event?.eventLayer).toBe('ATTACK')
    expect(event?.stateBefore).toBe('normal')
    expect(event?.stateAfter).toBe('normal')
    expect(result.finalAttackState?.assetAccess.db).toBe('DATA_ACCESS')
    expect(result.finalStatuses.db).toBe('normal')
  })

  it('compares the baseline attack state with a current protected configuration', () => {
    const current = cloneScenario(lateralScenario)
    current.nodes.find((node) => node.id === 'app')!.protectionEnabled = true
    current.nodes.find((node) => node.id === 'app')!.securityControls = ['SERVICE_HARDENING']
    internalPolicy(current).rules.find((rule) => rule.id === 'internal-20-office-db-allow')!.enabled = false
    const { scenarioA, scenarioB } = buildComparisonScenarios(current)
    const resultA = runSimulation(scenarioA)
    const resultB = runSimulation(scenarioB)
    expect(scenarioA.initialAttackState).toEqual(scenarioB.initialAttackState)
    expect(scenarioA.initialEvents).toEqual(scenarioB.initialEvents)
    expect(scenarioA.interfaces).toEqual(scenarioB.interfaces)
    expect(scenarioA.edges).toEqual(scenarioB.edges)
    expect(scenarioA.vlans).toEqual(scenarioB.vlans)
    expect(scenarioA.routes).toEqual(scenarioB.routes)
    expect(scenarioA.services).toEqual(scenarioB.services)
    expect(scenarioA.nodes.map((node) => node.teachingConditions)).toEqual(scenarioB.nodes.map((node) => node.teachingConditions))
    expect(scenarioA.nodes.find((node) => node.id === 'app')?.securityControls).toBeUndefined()
    expect(scenarioB.nodes.find((node) => node.id === 'app')?.securityControls).toEqual(['SERVICE_HARDENING'])
    expect(resultA.metrics.criticalObjectiveReached).toBe(true)
    expect(resultB.metrics.criticalObjectiveReached).toBe(false)
    expect(resultA.metrics.businessReachability).toBe(100)
    expect(resultB.metrics.businessReachability).toBe(100)
  })

  it('calculates the AttackState block ratio from blocked technique attempts and successful transitions', () => {
    const scenario = cloneScenario(lateralScenario)
    scenario.nodes.find((node) => node.id === 'pc02')!.protectionEnabled = true
    const result = runSimulation(scenario)
    const blocked = result.attackSearchResult?.blockedTransitions.length ?? 0
    const transitions = result.attackSearchResult?.successfulTransitions.length ?? 0
    expect(blocked).toBeGreaterThan(0)
    expect(transitions).toBeGreaterThan(0)
    expect(result.metrics.blockedPropagationRatio).toBe(Math.round((blocked / (blocked + transitions)) * 100))
  })

  it('exposes route, technique and passed preconditions on successful events', () => {
    const result = runSimulation(lateralScenario)
    const event = result.events.find((item) => item.attackTechniqueId === 'application-access' && item.sourceId === 'pc01' && item.targetId === 'app' && item.result === 'compromise')
    expect(event?.route).toEqual(['pc01', 'office-switch', 'core', 'internal-fw', 'server-switch', 'app'])
    expect(event?.routeEdgeIds).toHaveLength((event?.route.length ?? 1) - 1)
    expect(event?.preconditionChecks?.every((item) => item.passed)).toBe(true)
    expect(event?.targetPrivilegeAfter).toBe('USER')
  })

  it('records per-endpoint privilege and the transition that granted control', () => {
    const result = runSimulation(lateralScenario)
    const app = result.finalAttackState?.controlledEndpoints.app
    expect(app?.nodeId).toBe('app')
    expect(app?.privilege).toBe('ADMIN')
    expect(app?.acquiredByTransitionId).toBeTruthy()
    expect(result.finalAttackState?.executedTransitionIds).toContain(app?.acquiredByTransitionId)
  })

  it('keeps an initial seed outside the executed transition history', () => {
    const result = runSimulation(lateralScenario)
    const seed = result.events.find((event) => event.type === 'seed')
    expect(seed?.attackTransitionResult).toBeUndefined()
    expect(result.finalAttackState?.executedTransitionIds.some((id) => id.includes('seed'))).toBe(false)
    expect(result.metrics.attackTransitions).toBe(result.attackTransitions?.filter((transition) => transition.result === 'SUCCESS').length)
  })

  it('emits BLOCKED and NOT_APPLICABLE as distinct teaching transition outcomes', () => {
    const protectedScenario = cloneScenario(lateralScenario)
    protectedScenario.nodes.find((node) => node.id === 'app')!.protectionEnabled = true
    const result = runSimulation(protectedScenario)
    const outcomes = new Set(result.attackTransitionAttempts?.map((item) => item.result))
    expect(outcomes).toContain('SUCCESS')
    expect(outcomes).toContain('BLOCKED')
    expect(outcomes).toContain('NOT_APPLICABLE')
  })

  it('reports an unowned source as not applicable with an explicit source privilege failure', () => {
    const noControl: AttackState = { controlledEndpoints: {}, assetAccess: { db: 'NONE' }, executedTransitionIds: [] }
    const assessment = evaluateTeachingTechnique(lateralScenario, noControl, 'pc01', 'pc02', technique('remote-service-movement'))
    expect(assessment.result).toBe('NOT_APPLICABLE')
    expect(assessment.preconditions.find((item) => item.id === 'source-privilege')?.passed).toBe(false)
  })

  it('marks a missing target teaching condition as not applicable in the run log', () => {
    const scenario = cloneScenario(lateralScenario)
    scenario.nodes.find((node) => node.id === 'app')!.teachingConditions = ['APPLICATION_SERVICE_ROLE', 'PRIVILEGE_ESCALATION_CONDITION']
    const result = runSimulation(scenario)
    const attempt = result.attackTransitionAttempts?.find((item) => item.techniqueId === 'application-access' && item.sourceNodeId === 'pc01' && item.targetNodeId === 'app')
    expect(attempt?.result).toBe('NOT_APPLICABLE')
    expect(attempt?.preconditionChecks.find((item) => item.id === 'target-REMOTE_ACCESS_EXPOSED')?.passed).toBe(false)
  })

  it('retains the direct PC-01 to Database communication result while denying the out-of-scope data behavior', () => {
    const scenario = cloneScenario(lateralScenario)
    internalPolicy(scenario).rules.find((rule) => rule.id === 'internal-10-app-db')!.enabled = false
    const result = runSimulation(scenario)
    const directAssessment = result.attackTransitionAttempts?.find((item) => item.techniqueId === 'database-access' && item.sourceNodeId === 'pc01' && item.targetNodeId === 'db')
    expect(directAssessment?.communicationDecision?.allowed).toBe(true)
    expect(directAssessment?.result).toBe('NOT_APPLICABLE')
    expect(directAssessment?.preconditionChecks.find((item) => item.id === 'source-scope')?.passed).toBe(false)
    expect(result.finalAttackState?.controlledEndpoints.db).toBeUndefined()
    expect(result.finalAttackState?.assetAccess.db).toBe('NONE')
  })

  it('does not block Application-to-Database business communication when the abstract database control blocks the behavior', () => {
    const scenario = cloneScenario(lateralScenario)
    scenario.nodes.find((node) => node.id === 'db')!.securityControls = ['DATA_ACCESS_CONTROL']
    const result = runSimulation(scenario)
    const blocked = result.attackTransitionAttempts?.find((item) => item.techniqueId === 'database-access' && item.sourceNodeId === 'app' && item.result === 'BLOCKED')
    expect(blocked?.preconditionChecks.find((item) => item.id === 'security-controls')?.passed).toBe(false)
    expect(result.businessPathResults.find((item) => item.id === 'app-customer-db')?.allowed).toBe(true)
    expect(result.finalAttackState?.assetAccess.db).toBe('NONE')
  })

  it('uses only the deterministic objective witness as the visible AttackState event sequence', () => {
    const first = runSimulation(lateralScenario)
    const second = runSimulation(lateralScenario)
    const witness = first.attackSearchResult?.objectiveWitnessChain ?? []
    const visible = first.events.filter((event) => event.attackTechniqueId)
    expect(witness.length).toBeGreaterThan(0)
    expect(first.attackSearchResult?.representativeChain).toEqual(witness)
    expect(visible.map((event) => [event.attackTechniqueId, event.sourceId, event.targetId])).toEqual(
      witness.map((item) => [item.techniqueId, item.sourceNodeId, item.targetNodeId]),
    )
    expect(second.attackSearchResult?.representativeChain).toEqual(witness)
  })

  it('selects the shortest successful objective witness chain', () => {
    const result = runSimulation(lateralScenario)
    const search = result.attackSearchResult!
    const witness = search.objectiveWitnessChain!
    const successfulObjectiveCandidates = search.searchEvaluations
      .filter((transition) => transition.result === 'SUCCESS' && transition.effect === 'DATA_ACCESS_GRANTED')
      .map((transition) => transition.beforeState.executedTransitionIds.length + 1)

    expect(successfulObjectiveCandidates.length).toBeGreaterThan(0)
    expect(witness.length).toBe(Math.min(...successfulObjectiveCandidates))
  })

  it('uses a closest blocked witness when no successful objective chain exists', () => {
    const scenario = cloneScenario(lateralScenario)
    scenario.nodes.find((node) => node.id === 'app')!.protectionEnabled = true
    const result = runSimulation(scenario)
    const witness = result.attackSearchResult?.closestBlockedWitness
    expect(result.attackSearchResult?.objectiveReached).toBe(false)
    expect(witness?.at(-1)?.result).toBe('BLOCKED')
    expect(result.attackSearchResult?.representativeChain).toEqual(witness)
    expect(result.events.filter((event) => event.attackTechniqueId).at(-1)?.attackTransitionResult).toBe('BLOCKED')
    const finalTransition = witness!.at(-1)!
    const actualBlock = finalTransition.preconditionChecks.find((item) => !item.passed
      && (item.id === 'security-controls' || item.id === 'communication'))
    expect(actualBlock).toBeDefined()
    expect(finalTransition.reason).toBe(actualBlock?.reason)
  })

  it('chooses a stable closest blocked witness when equally advanced candidates remain', () => {
    const scenario = cloneScenario(lateralScenario)
    scenario.nodes.find((node) => node.id === 'app')!.securityControls = ['SERVICE_HARDENING']
    scenario.nodes.find((node) => node.id === 'db')!.securityControls = ['DATA_ACCESS_CONTROL']
    const first = runAttackStateEngine(scenario).searchResult.closestBlockedWitness
    const second = runAttackStateEngine(scenario).searchResult.closestBlockedWitness

    expect(first?.at(-1)?.techniqueId).toBe('database-access')
    expect(first?.at(-1)?.targetNodeId).toBe('db')
    expect(first).toEqual(second)
  })

  it('deduplicates blocked-candidate metrics without expanding the representative event timeline', () => {
    const scenario = cloneScenario(lateralScenario)
    scenario.nodes.find((node) => node.id === 'pc02')!.protectionEnabled = true
    const result = runSimulation(scenario)
    const search = result.attackSearchResult!
    expect(result.metrics.uniqueBlockedCandidateCount).toBe(search.blockedTransitions.length)
    expect(search.blockedTransitions.length).toBeLessThanOrEqual(search.searchEvaluations.filter((item) => item.result === 'BLOCKED').length)
    expect(result.events.filter((event) => event.attackTechniqueId).length).toBe(search.representativeChain.length)
  })

  it('keeps local privilege escalation outside the network route model', () => {
    const result = runSimulation(lateralScenario)
    const escalation = result.events.find((event) => event.attackTechniqueId === 'privilege-escalation')
    expect(escalation).toBeDefined()
    expect(escalation?.route).toEqual([])
    expect(escalation?.routeEdgeIds).toEqual([])
  })

  it('merges equivalent states even when their witness history differs', () => {
    const first: AttackState = {
      controlledEndpoints: { pc01: { nodeId: 'pc01', privilege: 'USER', acquiredByTransitionId: 't-a' } },
      assetAccess: { db: 'NONE' }, executedTransitionIds: ['t-a'],
    }
    const second: AttackState = {
      controlledEndpoints: { pc01: { nodeId: 'pc01', privilege: 'USER', acquiredByTransitionId: 't-b' } },
      assetAccess: { db: 'NONE' }, executedTransitionIds: ['t-b'],
    }
    expect(attackStateSignature(first)).toBe(attackStateSignature(second))
  })

  it('stops safely at the documented depth and state limits', () => {
    const depthLimited = runAttackStateEngine(lateralScenario, [], { maxDepth: 0 })
    const stateLimited = runAttackStateEngine(lateralScenario, [], { maxStates: 1 })
    expect(MAX_ATTACK_DEPTH).toBeGreaterThanOrEqual(6)
    expect(MAX_ATTACK_DEPTH).toBeLessThanOrEqual(8)
    expect(MAX_ATTACK_STATES).toBeGreaterThanOrEqual(100)
    expect(MAX_ATTACK_STATES).toBeLessThanOrEqual(200)
    expect(depthLimited.exploredStateCount).toBe(1)
    expect(depthLimited.transitions).toHaveLength(0)
    expect(depthLimited.depthLimitReached).toBe(true)
    expect(stateLimited.exploredStateCount).toBe(1)
    expect(stateLimited.stateLimitReached).toBe(true)
  })
})
