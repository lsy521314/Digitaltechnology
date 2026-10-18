import { describe, expect, it } from 'vitest'
import { cloneScenario, lateralScenario } from '../src/data/scenarios'
import { evaluateChallenge } from '../src/engine/challengeEngine'
import { simulationFingerprint } from '../src/engine/simulationFingerprint'
import { runSimulation } from '../src/engine/simulationEngine'

function secureChallengeScenario() {
  const scenario = cloneScenario(lateralScenario)
  scenario.nodes.find((node) => node.id === 'app')!.protectionEnabled = true
  scenario.nodes.find((node) => node.id === 'db')!.securityControls = ['SERVICE_HARDENING']
  scenario.firewallPolicies.find((policy) => policy.firewallId === 'internal-fw')!
    .rules.find((rule) => rule.id === 'internal-20-office-db-allow')!.enabled = false
  return scenario
}

describe('pure challenge evaluation', () => {
  it('returns unverified when no SimulationResult exists', () => {
    expect(evaluateChallenge(lateralScenario, null, null)).toEqual({ status: 'unverified', valid: false, success: null, checks: [] })
  })

  it('reports success from a current result only when objective and all required business paths pass', () => {
    const scenario = secureChallengeScenario()
    const result = runSimulation(scenario)
    const evaluation = evaluateChallenge(scenario, result, simulationFingerprint(scenario))
    expect(evaluation.status).toBe('verified')
    expect(evaluation.valid).toBe(true)
    expect(evaluation.success).toBe(true)
    expect(evaluation.checks.every((item) => item.passed)).toBe(true)
    expect(result.businessPathResults.every((path) => path.allowed)).toBe(true)
    expect(result.finalAttackState?.assetAccess.db).toBe('NONE')
    expect(result.metrics.criticalObjectiveReached).toBe(false)
  })

  it('reports failed when a required business path fails even though the protected objective remains safe', () => {
    const scenario = secureChallengeScenario()
    scenario.nodes.find((node) => node.id === 'pc01')!.isolationEnabled = true
    const result = runSimulation(scenario)
    const evaluation = evaluateChallenge(scenario, result, simulationFingerprint(scenario))
    expect(evaluation.valid).toBe(true)
    expect(evaluation.status).toBe('verified')
    expect(evaluation.success).toBe(false)
    expect(evaluation.checks[0].passed).toBe(true)
    expect(evaluation.checks.slice(1).some((item) => !item.passed)).toBe(true)
  })

  it('treats DATA_ACCESS as failure of the protected data objective without marking the database host compromised', () => {
    const scenario = cloneScenario(lateralScenario)
    const result = runSimulation(scenario)
    const evaluation = evaluateChallenge(scenario, result, simulationFingerprint(scenario))
    expect(result.finalStatuses.db).toBe('normal')
    expect(result.finalAttackState?.assetAccess.db).toBe('DATA_ACCESS')
    expect(evaluation.checks[0].passed).toBe(false)
    expect(evaluation.checks[0].reason).toContain('数据访问能力')
    expect(evaluation.success).toBe(false)
  })

  it('does not expose a previous success after simulation inputs change', () => {
    const scenario = secureChallengeScenario()
    const result = runSimulation(scenario)
    const oldFingerprint = simulationFingerprint(scenario)
    scenario.firewallPolicies.find((policy) => policy.firewallId === 'internal-fw')!.rules[0].enabled = false
    const evaluation = evaluateChallenge(scenario, result, oldFingerprint)
    expect(evaluation.status).toBe('stale')
    expect(evaluation.valid).toBe(false)
    expect(evaluation.success).toBeNull()
  })

  it('keeps challenge evaluation valid after a presentation-only position change', () => {
    const scenario = secureChallengeScenario()
    const result = runSimulation(scenario)
    const fingerprint = simulationFingerprint(scenario)
    scenario.nodes.find((node) => node.id === 'pc01')!.position.x += 12
    const evaluation = evaluateChallenge(scenario, result, fingerprint)
    expect(evaluation.status).toBe('verified')
    expect(evaluation.success).toBe(true)
  })

  it('does not show success while the simulation animation is still running', () => {
    const scenario = secureChallengeScenario()
    const result = runSimulation(scenario)
    const evaluation = evaluateChallenge(scenario, result, simulationFingerprint(scenario), false)
    expect(evaluation.status).toBe('unverified')
    expect(evaluation.success).toBeNull()
  })

  it('does not verify database protection when the bounded AttackState search is incomplete', () => {
    const scenario = secureChallengeScenario()
    const result = runSimulation(scenario)
    result.metrics.attackSearchComplete = false
    const evaluation = evaluateChallenge(scenario, result, simulationFingerprint(scenario))
    expect(evaluation.valid).toBe(false)
    expect(evaluation.status).toBe('incomplete')
    expect(evaluation.success).toBeNull()
    expect(evaluation.checks[0].passed).toBe(false)
    expect(evaluation.checks.at(-1)?.id).toBe('attack-search-complete')
  })
})
