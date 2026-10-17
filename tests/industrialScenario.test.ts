import { describe, expect, it } from 'vitest'
import { industrialScenario } from '../src/data/scenarios/industrialScenario'
import { cloneScenario } from '../src/data/scenarios'
import { runSimulation } from '../src/engine/simulationEngine'
import { validateScenario } from '../src/engine/scenarioValidator'

const historianId = 'historian'

describe('industrialScenario design', () => {
  it('passes scenario validation', () => {
    expect(validateScenario(industrialScenario)).toEqual([])
  })

  it('default policies let lateral movement compromise the historian', () => {
    const result = runSimulation(industrialScenario)
    expect(result.compromisedNodeIds).toContain(historianId)
    expect(result.compromisedNodeIds).toContain('scada')
    // Business paths remain reachable by design
    const monitor = result.businessPathResults.find((path) => path.id === 'hmi-scada-monitor')
    const pump = result.businessPathResults.find((path) => path.id === 'scada-plc-pump')
    expect(monitor?.allowed).toBe(true)
    expect(pump?.allowed).toBe(true)
    // The bad direct-allow rule ics-40 is what lets the historian be reached
    const historianEvents = result.events.filter((event) => event.targetId === historianId && event.result === 'compromise')
    expect(historianEvents.length).toBeGreaterThan(0)
  })

  it('challenge passes when the bad direct-allow rule is disabled', () => {
    const fixed = cloneScenario(industrialScenario)
    const policy = fixed.firewallPolicies.find((item) => item.firewallId === 'industrial-fw')!
    const badRule = policy.rules.find((item) => item.id === 'ics-40-scada-historian')!
    badRule.enabled = false
    const result = runSimulation(fixed)
    expect(result.compromisedNodeIds).not.toContain(historianId)
    const monitor = result.businessPathResults.find((path) => path.id === 'hmi-scada-monitor')
    const pump = result.businessPathResults.find((path) => path.id === 'scada-plc-pump')
    expect(monitor?.allowed).toBe(true)
    expect(pump?.allowed).toBe(true)
  })
})