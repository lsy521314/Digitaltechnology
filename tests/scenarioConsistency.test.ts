import { describe, expect, it } from 'vitest'
import {
  cloneScenario,
  firewallScenario,
  lateralScenario,
  ransomwareScenario,
  scenarios,
  segmentationScenario,
  supplyChainScenario,
} from '../src/data/scenarios'
import { buildComparisonScenarios } from '../src/engine/comparisonEngine'
import { evaluateChallenge } from '../src/engine/challengeEngine'
import { simulationFingerprint } from '../src/engine/simulationFingerprint'
import { runSimulation } from '../src/engine/simulationEngine'
import { runAttackStateEngine } from '../src/engine/attackStateEngine'
import { validateScenario } from '../src/engine/scenarioValidator'

describe('scenario and metric consistency', () => {
  it('validates every built-in scenario and every challenge business-path reference', () => {
    expect(scenarios).toHaveLength(6)
    for (const scenario of scenarios) {
      expect(validateScenario(scenario), scenario.id).toEqual([])
      for (const trigger of scenario.initialEvents) {
        expect(scenario.nodes.some((node) => node.id === trigger.sourceId)).toBe(true)
        expect(scenario.nodes.some((node) => node.id === trigger.targetId)).toBe(true)
      }
      for (const pathId of scenario.challenge?.requiredBusinessPathIds ?? []) {
        expect(scenario.businessPaths.some((path) => path.id === pathId)).toBe(true)
      }
    }
  })

  it('keeps lateral in AttackState mode and regression-runs all six built-in scenarios', () => {
    expect(lateralScenario.simulationMode).toBe('ATTACK_STATE')
    for (const scenario of scenarios.filter((item) => item.id !== 'lateral')) expect(scenario.simulationMode).toBe('TEACHING_PROPAGATION')
    for (const scenario of scenarios) {
      const result = runSimulation(scenario)
      expect(result.scenarioId, scenario.id).toBe(scenario.id)
      expect(result.metrics.totalNodes, scenario.id).toBe(scenario.nodes.length)
      expect(result.businessPathResults, scenario.id).toHaveLength(scenario.businessPaths.length)
      expect(result.metrics.businessReachability, scenario.id).toBeGreaterThanOrEqual(0)
      expect(result.metrics.businessReachability, scenario.id).toBeLessThanOrEqual(100)
      const challenge = evaluateChallenge(scenario, result, simulationFingerprint(scenario))
      expect(challenge.status, scenario.id).toBe(scenario.challenge ? 'verified' : 'unverified')
    }
  })

  it('excludes pre-existing seed state from propagationSteps and removes the ambiguous blockedEvents metric', () => {
    const legacy = cloneScenario(lateralScenario)
    legacy.simulationMode = 'TEACHING_PROPAGATION'
    legacy.initialAttackState = undefined
    const result = runSimulation(legacy)
    const successfulPropagationEvents = result.events.filter((event) => event.phase === 'propagation'
      && event.eventLayer === 'PROPAGATION' && event.result === 'compromise')
    expect(result.events.some((event) => event.phase === 'initial' && event.type === 'seed')).toBe(true)
    expect(result.metrics.propagationSteps).toBe(successfulPropagationEvents.length)
    expect('blockedEvents' in result.metrics).toBe(false)
  })

  it('reports AttackState metrics separately from legacy propagation metrics', () => {
    const result = runSimulation(lateralScenario)
    const attackRun = runAttackStateEngine(lateralScenario)
    expect(result.metrics.attackTransitions).toBe(attackRun.searchResult.successfulTransitions.length)
    expect(result.metrics.controlledEndpoints).toBe(Object.keys(attackRun.reachableControlledEndpoints).length)
    expect(result.metrics.adminControlledEndpoints).toBe(Object.values(attackRun.reachableControlledEndpoints).filter((value) => value.privilege === 'ADMIN').length)
    expect(result.metrics.criticalObjectiveReached).toBe(result.attackSearchResult?.objectiveReached)
  })

  it('keeps NETWORK refusals and CONTROL propagation blocks as separate metrics', () => {
    const scenario = cloneScenario(lateralScenario)
    scenario.firewallPolicies.find((policy) => policy.firewallId === 'internal-fw')!
      .rules.find((rule) => rule.id === 'internal-10-app-db')!.enabled = false
    scenario.nodes.find((node) => node.id === 'pc02')!.protectionEnabled = true
    const result = runSimulation(scenario)
    const blocked = result.attackSearchResult?.blockedTransitions ?? []
    expect(result.metrics.networkCommunicationRefusals).toBe(blocked.filter((item) => item.communicationDecision && !item.communicationDecision.allowed).length)
    expect(result.metrics.teachingPropagationBlocks).toBe(blocked.filter((item) => item.preconditionChecks.some((check) => check.id === 'security-controls' && !check.passed)).length)
    expect(result.metrics.networkCommunicationRefusals).toBeGreaterThan(0)
    expect(result.metrics.teachingPropagationBlocks).toBeGreaterThan(0)
  })

  it('uses a distinct segmented default that protects the database and preserves required business paths', () => {
    const lateralAllow = lateralScenario.firewallPolicies.find((policy) => policy.firewallId === 'internal-fw')!
      .rules.find((rule) => rule.id === 'internal-20-office-db-allow')!
    const segmentedAllow = segmentationScenario.firewallPolicies.find((policy) => policy.firewallId === 'internal-fw')!
      .rules.find((rule) => rule.id === 'internal-20-office-db-allow')!
    expect(lateralAllow.enabled).toBe(true)
    expect(segmentedAllow.enabled).toBe(false)
    const risky = runSimulation(lateralScenario)
    const segmented = runSimulation(segmentationScenario)
    expect(risky.finalAttackState?.assetAccess.db).toBe('DATA_ACCESS')
    expect(risky.compromisedNodeIds).not.toContain('db')
    expect(segmented.compromisedNodeIds).not.toContain('db')
    expect(segmented.metrics.businessReachability).toBe(100)
  })

  it('allows the supply-chain teaching path only through its explicit Edge and Internal Firewall rules', () => {
    const result = runSimulation(supplyChainScenario)
    const webToApp = result.events.find((event) => event.sourceId === 'web' && event.targetId === 'app'
      && event.eventLayer === 'PROPAGATION' && event.result === 'compromise')
    expect(webToApp?.route).toEqual(['web', 'dmz-switch', 'edge-fw', 'core', 'internal-fw', 'server-switch', 'app'])
    expect(webToApp?.matchedRuleIds).toContain('edge-40-web-to-app')
    expect(webToApp?.matchedRuleIds).toContain('internal-20-web-to-app')
    expect(result.compromisedNodeIds).toContain('mail')
    expect(result.compromisedNodeIds).toContain('db')
    expect(result.metrics.businessReachability).toBe(100)
    expect(supplyChainScenario.description).toContain('不模拟真实软件投毒或代码执行')
  })

  it('preserves ransomware scenario business paths and describes only abstract state propagation', () => {
    const result = runSimulation(ransomwareScenario)
    expect(result.compromisedNodeIds).toContain('file')
    expect(result.metrics.businessReachability).toBe(100)
    expect(ransomwareScenario.challenge?.protectedNodeId).toBe('file')
    expect(ransomwareScenario.name).not.toContain('恢复')
    expect(ransomwareScenario.description).toContain('不模拟真实恶意软件、文件加密、解密或恢复')

    const protectedScenario = cloneScenario(ransomwareScenario)
    protectedScenario.nodes.find((node) => node.id === 'file')!.protectionEnabled = true
    const protectedResult = runSimulation(protectedScenario)
    expect(protectedResult.compromisedNodeIds).not.toContain('file')
    expect(protectedResult.metrics.businessReachability).toBe(100)
  })

  it('describes the firewall experiment with the same allowed and refused requests it computes', () => {
    const result = runSimulation(firewallScenario)
    expect(result.events.find((event) => event.targetId === 'web')?.result).toBe('allow')
    expect(result.events.find((event) => event.targetId === 'db')?.result).toBe('block')
    expect(result.businessPathResults.every((path) => path.allowed)).toBe(true)
    expect(firewallScenario.learningObjectives.join(' ')).toContain('公开 Web')
  })

  it('refuses to build an A/B run when a custom scenario has no original baseline', () => {
    const custom = cloneScenario(lateralScenario)
    custom.id = 'my-imported-lab'
    expect(() => buildComparisonScenarios(custom)).toThrow('没有原始基线')
  })
})
