import { describe, expect, it } from 'vitest'
import { cloneScenario, lateralScenario } from '../src/data/scenarios'
import { decodeScenario, encodeScenario } from '../src/utils/scenarioShare'
import { validateScenario } from '../src/engine/scenarioValidator'

describe('shareable scenario links', () => {
  it('round-trips a scenario without losing configuration', async () => {
    const scenario = cloneScenario(lateralScenario)
    scenario.nodes.find((node) => node.id === 'pc02')!.protectionEnabled = true
    scenario.firewallPolicies[1].rules.find((rule) => rule.id === 'internal-20-office-db-allow')!.enabled = false
    const token = await encodeScenario(scenario)
    const restored = await decodeScenario(token)
    expect(restored).toEqual(scenario)
    expect(validateScenario(restored)).toEqual([])
  })

  it('produces a URL-safe token that stays short enough to paste', async () => {
    const token = await encodeScenario(cloneScenario(lateralScenario))
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/)
    expect(token.length).toBeLessThan(8000)
  })

  it('rejects a corrupted token instead of returning a partial scenario', async () => {
    await expect(decodeScenario('not-a-real-token')).rejects.toBeTruthy()
  })
})
