import { describe, expect, it } from 'vitest'
import { cloneScenario, zeroTrustScenario } from '../src/data/scenarios'
import { runSimulation } from '../src/engine/simulationEngine'
import { validateScenario } from '../src/engine/scenarioValidator'
import type { Scenario } from '../src/types/scenario'

const internalPolicy = (scenario: Scenario) => scenario.firewallPolicies.find((policy) => policy.firewallId === 'internal-fw')!

describe('zero-trust micro-segmentation scenario', () => {
  it('is structurally valid and ships a solvable challenge', () => {
    expect(validateScenario(zeroTrustScenario)).toEqual([])
    expect(zeroTrustScenario.challenge?.protectedNodeId).toBe('db')
  })

  it('expresses segmentation as host-to-host rules instead of zone rules', () => {
    const zoneSelectors = zeroTrustScenario.firewallPolicies
      .flatMap((policy) => policy.rules)
      .filter((rule) => rule.source.kind === 'ZONE' || rule.destination.kind === 'ZONE')
      .map((rule) => rule.id)
    // Only the external Internet -> Web entry may use a zone selector.
    expect(zoneSelectors).toEqual(['zt-edge-20-internet-web'])
  })

  it('starts with the over-broad host rule letting the attack reach the database', () => {
    const result = runSimulation(cloneScenario(zeroTrustScenario))
    expect(result.finalStatuses.db).toBe('compromised')
    expect(result.businessPathResults.every((path) => path.allowed)).toBe(true)
  })

  it('protects the database once the over-broad rule is tightened, without losing business paths', () => {
    const scenario = cloneScenario(zeroTrustScenario)
    internalPolicy(scenario).rules.find((rule) => rule.id === 'zt-internal-20-pc01-app')!.enabled = false
    const result = runSimulation(scenario)
    expect(result.finalStatuses.db).not.toBe('compromised')
    expect(result.metrics.businessReachability).toBe(100)
    expect(result.metrics.businessPathsReachable).toBe(2)
  })

  it('still denies every flow that has no explicit host-to-host allow', () => {
    const result = runSimulation(cloneScenario(zeroTrustScenario))
    const pc01ToDb = result.events.find((event) => event.sourceId === 'pc01' && event.targetId === 'db' && event.eventLayer === 'NETWORK')
    expect(pc01ToDb?.result).toBe('block')
  })
})
