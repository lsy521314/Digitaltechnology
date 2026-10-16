import { describe, expect, it } from 'vitest'
import { cloneScenario, firewallScenario, lateralScenario } from '../src/data/scenarios'
import { buildComparisonScenarios, runComparison } from '../src/engine/comparisonEngine'
import { canCommunicate } from '../src/engine/ruleEngine'
import { validateScenario } from '../src/engine/scenarioValidator'
import { runSimulation } from '../src/engine/simulationEngine'
import { findServicePath } from '../src/engine/topologyEngine'

describe('deterministic teaching simulation', () => {
  it('uses the layered 16-node enterprise topology without a direct workstation-to-database edge', () => {
    expect(lateralScenario.nodes).toHaveLength(16)
    expect(lateralScenario.nodes.some((node) => node.id === 'web' && node.zone === 'DMZ')).toBe(true)
    expect(lateralScenario.edges.some((edge) => edge.source === 'pc01' && edge.target === 'db' || edge.source === 'db' && edge.target === 'pc01')).toBe(false)
    const route = findServicePath('pc01', 'db', 'DATABASE', lateralScenario.edges, lateralScenario.nodes)
    expect(route?.nodeIds).toContain('core')
    expect(route?.nodeIds).toContain('server-switch')
  })

  it('external WEB requests are allowed while direct DATABASE requests are denied with an explanation', () => {
    const result = runSimulation(firewallScenario)
    const webRequest = result.events.find((event) => event.targetId === 'web')
    const databaseRequest = result.events.find((event) => event.targetId === 'db')
    expect(webRequest?.result).toBe('allow')
    expect(webRequest?.matchedRuleName).toBe('公开 WEB 服务')
    expect(databaseRequest?.result).toBe('block')
    expect(databaseRequest?.matchedRuleName).toBe('外部禁止直连数据库')
    expect(databaseRequest?.route).toEqual(['internet', 'fw', 'db'])
    expect(result.finalStatuses.db).toBe('normal')
  })

  it('shows the exposed Office-to-Database policy while the server-zone boundary blocks direct Office access to the application host', () => {
    const result = runSimulation(lateralScenario)
    const officeToApp = result.events.find((event) => event.sourceId === 'pc01' && event.targetId === 'app')
    const officeToDatabase = result.events.find((event) => event.sourceId === 'pc01' && event.targetId === 'db')
    expect(officeToApp?.result).toBe('block')
    expect(officeToApp?.matchedRuleName).toBe('办公区禁止直接访问应用服务器')
    expect(officeToDatabase?.result).toBe('compromise')
    expect(officeToDatabase?.route).toEqual(['pc01', 'office-switch', 'core', 'server-switch', 'db'])
    expect(result.finalStatuses.db).toBe('compromised')
  })

  it('an enabled Office-to-Database DENY rule blocks that path and leaves the database safe when the application is protected', () => {
    const scenario = cloneScenario(lateralScenario)
    scenario.rules.push({ id: 'test-deny', name: 'Office 到 Database / DATABASE 拒绝', sourceZone: 'Office', targetZone: 'Database', service: 'DATABASE', action: 'DENY', enabled: true })
    const result = runSimulation(scenario)
    const denied = result.events.find((event) => event.sourceId === 'pc01' && event.targetId === 'db' && event.result === 'block')
    expect(result.finalStatuses.db).toBe('normal')
    expect(denied?.matchedRuleName).toBe('Office 到 Database / DATABASE 拒绝')
    expect(denied?.route).toContain('server-switch')
    expect(denied?.reason).toContain('命中拒绝规则')
  })

  it('keeps the required Application-to-Database DATABASE business path reachable', () => {
    const result = runSimulation(lateralScenario)
    const business = result.businessPathResults.find((path) => path.id === 'app-customer-db')
    expect(business?.allowed).toBe(true)
    expect(business?.route).toEqual(['app', 'server-switch', 'db'])
    expect(business?.matchedRuleName).toBe('应用服务访问数据库')
  })

  it('endpoint protection blocks later propagation and explains why', () => {
    const scenario = cloneScenario(lateralScenario)
    scenario.nodes.find((node) => node.id === 'pc02')!.protectionEnabled = true
    const result = runSimulation(scenario)
    const blocked = result.events.find((event) => event.targetId === 'pc02' && event.result === 'block')
    expect(result.finalStatuses.pc02).toBe('protected')
    expect(blocked?.reason).toBe('目标节点终端防护已启用，传播事件被阻断。')
    expect(blocked?.route).toContain('pc02')
  })

  it('treats a seed as a pre-existing state that is not rolled back by endpoint protection', () => {
    const scenario = cloneScenario(lateralScenario)
    scenario.nodes.find((node) => node.id === 'pc01')!.protectionEnabled = true
    const result = runSimulation(scenario)
    const seed = result.events.find((event) => event.type === 'seed')
    expect(seed?.phase).toBe('initial')
    expect(seed?.result).toBe('compromise')
    expect(seed?.reason).toContain('不回溯阻止')
    expect(result.finalStatuses.pc01).toBe('compromised')
  })

  it('isolation blocks propagation through the node and reduces business reachability when it is a business endpoint', () => {
    const scenario = cloneScenario(lateralScenario)
    scenario.nodes.find((node) => node.id === 'pc02')!.isolationEnabled = true
    const result = runSimulation(scenario)
    const blocked = result.events.find((event) => event.sourceId === 'pc01' && event.targetId === 'pc02' && event.result === 'block')
    expect(result.finalStatuses.pc02).toBe('isolated')
    expect(blocked?.reason).toContain('隔离状态不可达')
    expect(blocked?.blockedAt).toBe('Office-PC-02')
    expect(result.businessPathResults.find((path) => path.id === 'office-public-web')?.allowed).toBe(false)
    expect(result.metrics.businessReachability).toBe(50)
  })

  it('produces the same events, snapshots, states, and metrics for the same input', () => {
    const first = runSimulation(lateralScenario)
    const second = runSimulation(lateralScenario)
    expect(first.events).toEqual(second.events)
    expect(first.snapshots).toEqual(second.snapshots)
    expect(first.finalStatuses).toEqual(second.finalStatuses)
    expect(first.metrics).toEqual(second.metrics)
  })

  it('keeps A/B topology and initial conditions identical while changing only defense configuration', () => {
    const current = cloneScenario(lateralScenario)
    current.nodes.find((node) => node.id === 'pc02')!.protectionEnabled = true
    current.nodes.find((node) => node.id === 'pc04')!.isolationEnabled = true
    current.rules.find((rule) => rule.id === 'rule-office-db-deny')!.enabled = true
    const { scenarioA, scenarioB } = buildComparisonScenarios(current)
    expect(scenarioA.id).toBe(scenarioB.id)
    expect(scenarioA.edges).toEqual(scenarioB.edges)
    expect(scenarioA.initialEvents).toEqual(scenarioB.initialEvents)
    expect(scenarioA.nodes.map(({ id, name, type, zone, position, status }) => ({ id, name, type, zone, position, status })))
      .toEqual(scenarioB.nodes.map(({ id, name, type, zone, position, status }) => ({ id, name, type, zone, position, status })))
    expect(scenarioA.rules.find((rule) => rule.id === 'rule-office-db-deny')?.enabled).toBe(false)
    expect(scenarioB.rules.find((rule) => rule.id === 'rule-office-db-deny')?.enabled).toBe(true)
    expect(scenarioA.nodes.find((node) => node.id === 'pc02')?.protectionEnabled).toBe(false)
    expect(scenarioB.nodes.find((node) => node.id === 'pc02')?.protectionEnabled).toBe(true)
  })

  it('recalculates A/B results from original and current policy configurations', () => {
    const current = cloneScenario(lateralScenario)
    current.nodes.find((node) => node.id === 'pc02')!.protectionEnabled = true
    current.rules.find((rule) => rule.id === 'rule-office-db-deny')!.enabled = true
    const compared = runComparison(current)
    expect(compared.resultA.scenarioId).toBe(compared.resultB.scenarioId)
    expect(compared.resultA.metrics.affectedNodes).toBeGreaterThan(compared.resultB.metrics.affectedNodes)
    expect(compared.resultA.metrics.criticalAssetCompromised).toBe(true)
    expect(compared.resultB.metrics.criticalAssetCompromised).toBe(false)
  })

  it('passes the strategy challenge only when the database is protected and both required business paths remain reachable', () => {
    const scenario = cloneScenario(lateralScenario)
    scenario.nodes.find((node) => node.id === 'pc02')!.protectionEnabled = true
    scenario.rules.find((rule) => rule.id === 'rule-office-db-deny')!.enabled = true
    const result = runSimulation(scenario)
    expect(result.finalStatuses.db).toBe('normal')
    expect(result.businessPathResults.filter((path) => scenario.challenge!.requiredBusinessPathIds.includes(path.id)).every((path) => path.allowed)).toBe(true)
    expect(result.metrics.criticalAssetCompromised).toBe(false)
    expect(result.metrics.businessPathsReachable).toBe(2)
  })

  it('evaluates business paths against the requested service carried by enabled edges', () => {
    const scenario = cloneScenario(lateralScenario)
    const appDatabaseEdge = scenario.edges.find((edge) => edge.id === 'l-server-db')!
    appDatabaseEdge.service = 'WEB'
    const result = runSimulation(scenario)
    const business = result.businessPathResults.find((path) => path.id === 'app-customer-db')
    expect(business?.allowed).toBe(false)
    expect(business?.reason).toContain('不承载 DATABASE 服务')
    expect(result.metrics.businessReachability).toBe(50)
  })

  it('records the exact traversed edge and node route on each routed event', () => {
    const result = runSimulation(lateralScenario)
    for (const event of result.events.filter((item) => item.routeEdgeIds.length)) {
      expect(event.routeEdgeIds).toHaveLength(event.route.length - 1)
      event.routeEdgeIds.forEach((edgeId, index) => {
        const edge = lateralScenario.edges.find((item) => item.id === edgeId)!
        const pair = [event.route[index], event.route[index + 1]]
        expect(pair[0] === edge.source && pair[1] === edge.target || edge.bidirectional && pair[0] === edge.target && pair[1] === edge.source).toBe(true)
      })
    }
  })

  it('detects invalid edge endpoint references in imported scenarios', () => {
    const scenario = cloneScenario(lateralScenario)
    scenario.edges[0].target = 'missing-node'
    expect(validateScenario(scenario).join(' ')).toContain('target 不存在：missing-node')
  })

  it('matches more specific rules first and chooses DENY for an equal-specificity tie', () => {
    const source = lateralScenario.nodes.find((node) => node.id === 'pc01')!
    const target = lateralScenario.nodes.find((node) => node.id === 'web')!
    const rules = [
      { id: 'wide-allow', name: 'wide allow', sourceZone: 'Office' as const, targetZone: 'DMZ' as const, service: 'ANY' as const, action: 'ALLOW' as const, enabled: true },
      { id: 'specific-allow', name: 'specific allow', sourceZone: 'Office' as const, targetZone: 'DMZ' as const, service: 'WEB' as const, action: 'ALLOW' as const, enabled: true },
      { id: 'specific-deny', name: 'specific deny', sourceZone: 'Office' as const, targetZone: 'DMZ' as const, service: 'WEB' as const, action: 'DENY' as const, enabled: true },
    ]
    const decision = canCommunicate(source, target, 'WEB', lateralScenario.nodes, lateralScenario.edges, rules)
    expect(decision.allowed).toBe(false)
    expect(decision.matchedRule?.name).toBe('specific deny')
  })
})
