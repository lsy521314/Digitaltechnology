import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { cloneScenario, firewallScenario, lateralScenario } from '../src/data/scenarios'
import { buildComparisonScenarios, runComparison } from '../src/engine/comparisonEngine'
import { runSimulation } from '../src/engine/simulationEngine'
import { useScenarioStore } from '../src/stores/scenario'
import { useSimulationStore } from '../src/stores/simulation'

const internalPolicy = (scenario: typeof lateralScenario) => scenario.firewallPolicies.find((policy) => policy.firewallId === 'internal-fw')!

describe('layered deterministic teaching simulation', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('uses the fixed 16-node, 15-physical-link topology with three office endpoints', () => {
    expect(lateralScenario.nodes).toHaveLength(16)
    expect(lateralScenario.edges).toHaveLength(15)
    expect(lateralScenario.nodes.some((node) => node.id === 'gateway' || node.id === 'pc04')).toBe(false)
    expect(lateralScenario.nodes.filter((node) => node.zone === 'Office' && node.deviceRole === 'ENDPOINT')).toHaveLength(3)
    expect(lateralScenario.edges.some((edge) => [edge.source, edge.target].includes('pc01') && [edge.source, edge.target].includes('db'))).toBe(false)
  })

  it('records the seed as pre-existing state and leaves it unaffected by endpoint protection', () => {
    const scenario = cloneScenario(lateralScenario)
    scenario.nodes.find((node) => node.id === 'pc01')!.protectionEnabled = true
    const result = runSimulation(scenario)
    const seed = result.events.find((event) => event.type === 'seed')
    expect(seed?.eventLayer).toBe('PROPAGATION')
    expect(seed?.reason).toContain('实验开始前已存在')
    expect(result.finalStatuses.pc01).toBe('compromised')
  })

  it('changes target state only in the explicitly named legacy teaching propagation function', () => {
    const result = runSimulation(lateralScenario)
    const dbTransition = result.events.find((event) => event.sourceId === 'pc01' && event.targetId === 'db' && event.eventLayer === 'PROPAGATION')
    expect(dbTransition?.result).toBe('compromise')
    expect(dbTransition?.message).toContain('教学传播')
    expect(result.finalStatuses.db).toBe('compromised')
  })

  it('produces a network denial event without changing target status after policy repair', () => {
    const scenario = cloneScenario(lateralScenario)
    internalPolicy(scenario).rules.find((rule) => rule.id === 'internal-20-office-db-allow')!.enabled = false
    const result = runSimulation(scenario)
    const refusal = result.events.find((event) => event.sourceId === 'pc01' && event.targetId === 'db' && event.eventLayer === 'NETWORK' && event.result === 'block')
    expect(refusal?.matchedRuleName).toBe('办公区禁止直接访问数据库')
    expect(refusal?.route).toEqual(['pc01', 'office-switch', 'core', 'internal-fw'])
    expect(result.finalStatuses.db).toBe('normal')
  })

  it('keeps Application-to-Database business reachable after repairing Office access', () => {
    const scenario = cloneScenario(lateralScenario)
    internalPolicy(scenario).rules.find((rule) => rule.id === 'internal-20-office-db-allow')!.enabled = false
    const result = runSimulation(scenario)
    expect(result.businessPathResults.map((path) => path.allowed)).toEqual([true, true])
    expect(result.metrics.businessReachability).toBe(100)
    expect(result.metrics.businessPathsReachable).toBe(2)
  })

  it('keeps Firewall network refusals separate from terminal teaching-propagation blocks', () => {
    const scenario = cloneScenario(lateralScenario)
    internalPolicy(scenario).rules.find((rule) => rule.id === 'internal-20-office-db-allow')!.enabled = false
    scenario.nodes.find((node) => node.id === 'pc02')!.protectionEnabled = true
    const result = runSimulation(scenario)
    expect(result.metrics.networkCommunicationRefusals).toBeGreaterThan(0)
    expect(result.metrics.teachingPropagationBlocks).toBeGreaterThan(0)
    expect(result.finalStatuses.pc02).toBe('protected')
  })

  it('records a Protection control event for the exact reachable target', () => {
    const scenario = cloneScenario(lateralScenario)
    scenario.nodes.find((node) => node.id === 'pc02')!.protectionEnabled = true
    const result = runSimulation(scenario)
    const blocked = result.events.find((event) => event.sourceId === 'pc01' && event.targetId === 'pc02' && event.eventLayer === 'CONTROL')
    expect(blocked?.result).toBe('block')
    expect(blocked?.message).toContain('终端防护阻止')
    expect(blocked?.route).toEqual(['pc01', 'office-switch', 'pc02'])
    expect(result.finalStatuses.pc02).toBe('protected')
  })

  it('keeps every event route edge aligned with adjacent nodes on that event path', () => {
    const result = runSimulation(lateralScenario)
    const webRequest = result.events.find((event) => event.sourceId === 'pc01' && event.targetId === 'web' && event.eventLayer === 'NETWORK')
    expect(webRequest?.route).toEqual(['pc01', 'office-switch', 'core', 'edge-fw', 'dmz-switch', 'web'])
    expect(webRequest?.routeEdgeIds).toHaveLength((webRequest?.route.length ?? 0) - 1)
    webRequest?.routeEdgeIds.forEach((edgeId, index) => {
      const edge = lateralScenario.edges.find((item) => item.id === edgeId)!
      const pair = [webRequest.route[index], webRequest.route[index + 1]]
      expect([edge.source, edge.target].sort()).toEqual([...pair].sort())
    })
  })

  it('keeps isolation as communication unreachability and lowers required business reachability', () => {
    const scenario = cloneScenario(lateralScenario)
    scenario.nodes.find((node) => node.id === 'pc01')!.isolationEnabled = true
    const result = runSimulation(scenario)
    expect(result.finalStatuses.pc01).toBe('isolated')
    expect(result.metrics.businessReachability).toBe(50)
    expect(result.businessPathResults.find((path) => path.id === 'office-public-web')?.reason).toBe('ISOLATED')
  })

  it('produces identical events, snapshots, metrics, and final states for identical input', () => {
    const first = runSimulation(lateralScenario)
    const second = runSimulation(lateralScenario)
    expect(first.events).toEqual(second.events)
    expect(first.snapshots).toEqual(second.snapshots)
    expect(first.metrics).toEqual(second.metrics)
    expect(first.finalStatuses).toEqual(second.finalStatuses)
  })

  it('runs A/B with identical physical network and initial conditions while using baseline and edited policies', () => {
    const current = cloneScenario(lateralScenario)
    current.nodes.find((node) => node.id === 'pc02')!.protectionEnabled = true
    internalPolicy(current).rules.find((rule) => rule.id === 'internal-20-office-db-allow')!.enabled = false
    const { scenarioA, scenarioB } = buildComparisonScenarios(current)
    expect(scenarioA.nodes.map((node) => ({ id: node.id, status: node.status, position: node.position }))).toEqual(scenarioB.nodes.map((node) => ({ id: node.id, status: node.status, position: node.position })))
    expect(scenarioA.interfaces).toEqual(scenarioB.interfaces)
    expect(scenarioA.vlans).toEqual(scenarioB.vlans)
    expect(scenarioA.routes).toEqual(scenarioB.routes)
    expect(scenarioA.edges).toEqual(scenarioB.edges)
    expect(scenarioA.initialEvents).toEqual(scenarioB.initialEvents)
    expect(internalPolicy(scenarioA).rules.find((rule) => rule.id === 'internal-20-office-db-allow')?.enabled).toBe(true)
    expect(internalPolicy(scenarioB).rules.find((rule) => rule.id === 'internal-20-office-db-allow')?.enabled).toBe(false)
    expect(scenarioA.nodes.find((node) => node.id === 'pc02')?.protectionEnabled).toBe(false)
    expect(scenarioB.nodes.find((node) => node.id === 'pc02')?.protectionEnabled).toBe(true)
  })

  it('recalculates A/B so the database changes from affected to safe while necessary business stays available', () => {
    const current = cloneScenario(lateralScenario)
    current.nodes.find((node) => node.id === 'pc02')!.protectionEnabled = true
    internalPolicy(current).rules.find((rule) => rule.id === 'internal-20-office-db-allow')!.enabled = false
    const result = runComparison(current)
    expect(result.resultA.metrics.criticalAssetCompromised).toBe(true)
    expect(result.resultB.metrics.criticalAssetCompromised).toBe(false)
    expect(result.resultA.metrics.businessReachability).toBe(100)
    expect(result.resultB.metrics.businessReachability).toBe(100)
  })

  it('supports external Firewall teaching requests using the same communication engine', () => {
    const result = runSimulation(firewallScenario)
    expect(result.events.find((event) => event.targetId === 'web')?.result).toBe('allow')
    expect(result.events.find((event) => event.targetId === 'db')?.result).toBe('block')
  })

  it('marks saved simulation output stale after policy, order, or protection changes and fresh after rerun', () => {
    const scenarioStore = useScenarioStore()
    const simulationStore = useSimulationStore()
    simulationStore.makeResult()
    expect(simulationStore.simulationStale).toBe(false)
    scenarioStore.updateFirewallRule('internal-20-office-db-allow', { enabled: false })
    expect(simulationStore.simulationStale).toBe(true)
    scenarioStore.moveFirewallRule('internal-30-office-db-deny', -1)
    expect(simulationStore.simulationStale).toBe(true)
    scenarioStore.updateNode('pc02', { protectionEnabled: true })
    expect(simulationStore.simulationStale).toBe(true)
    simulationStore.makeResult()
    expect(simulationStore.simulationStale).toBe(false)
  })
})
