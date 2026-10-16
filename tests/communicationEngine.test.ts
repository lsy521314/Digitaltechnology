import { describe, expect, it } from 'vitest'
import { cloneScenario, lateralScenario } from '../src/data/scenarios'
import { evaluateCommunication } from '../src/engine/communicationEngine'
import { isIpInCidr, ipv4ToInt, parseIPv4, prefixToMask, sameSubnet } from '../src/engine/ipv4'
import { lookupRoute } from '../src/engine/routingEngine'
import { validateScenario } from '../src/engine/scenarioValidator'

const request = (sourceNodeId: string, targetNodeId: string, serviceId: 'WEB' | 'MAIL' | 'DATABASE' | 'FILE' | 'INTERNAL') => ({ sourceNodeId, targetNodeId, serviceId })
const internalPolicy = (scenario = lateralScenario) => scenario.firewallPolicies.find((policy) => policy.firewallId === 'internal-fw')!

describe('communication engine and IPv4 model', () => {
  it('uses a same-VLAN L2 path for PC01 to PC02 without any L3 device or Firewall', () => {
    const result = evaluateCommunication(lateralScenario, request('pc01', 'pc02', 'INTERNAL'))
    expect(result.allowed).toBe(true)
    expect(result.path).toEqual(['pc01', 'office-switch', 'pc02'])
    expect(result.firewallsTraversed).toEqual([])
  })

  it('routes PC01 to the public web through Core L3 and Edge Firewall with the Office WEB allow rule', () => {
    const result = evaluateCommunication(lateralScenario, request('pc01', 'web', 'WEB'))
    expect(result.allowed).toBe(true)
    expect(result.path).toEqual(['pc01', 'office-switch', 'core', 'edge-fw', 'dmz-switch', 'web'])
    expect(result.firewallsTraversed).toEqual(['edge-fw'])
    expect(result.matchedRules.at(-1)?.id).toBe('edge-30-office-web')
  })

  it('routes the Application Server to the database through Internal Firewall and matches the required allow rule', () => {
    const result = evaluateCommunication(lateralScenario, request('app', 'db', 'DATABASE'))
    expect(result.allowed).toBe(true)
    expect(result.path).toEqual(['app', 'server-switch', 'internal-fw', 'data-switch', 'db'])
    expect(result.firewallsTraversed).toEqual(['internal-fw'])
    expect(result.matchedRules.at(-1)?.id).toBe('internal-10-app-db')
  })

  it('allows Office to Database under the original misordered policy', () => {
    const result = evaluateCommunication(lateralScenario, request('pc01', 'db', 'DATABASE'))
    expect(result.allowed).toBe(true)
    expect(result.matchedRules.at(-1)?.id).toBe('internal-20-office-db-allow')
  })

  it('denies the same request when the erroneous allow rule is disabled', () => {
    const scenario = cloneScenario(lateralScenario)
    internalPolicy(scenario).rules.find((rule) => rule.id === 'internal-20-office-db-allow')!.enabled = false
    const result = evaluateCommunication(scenario, request('pc01', 'db', 'DATABASE'))
    expect(result.allowed).toBe(false)
    expect(result.reason).toBe('FIREWALL_DENY')
    expect(result.matchedRules.at(-1)?.id).toBe('internal-30-office-db-deny')
  })

  it('records the exact denying firewall for an Office to Database request', () => {
    const scenario = cloneScenario(lateralScenario)
    internalPolicy(scenario).rules.find((rule) => rule.id === 'internal-20-office-db-allow')!.enabled = false
    const result = evaluateCommunication(scenario, request('pc01', 'db', 'DATABASE'))
    expect(result.firewallDecisions.at(-1)?.firewallId).toBe('internal-fw')
    expect(result.blockedAt).toBe('internal-fw')
  })

  it('returns NO_ROUTE when no route reaches the destination network', () => {
    const scenario = cloneScenario(lateralScenario)
    scenario.routes = scenario.routes.filter((route) => route.id !== 'core-to-data' && route.id !== 'core-default' && route.id !== 'edge-to-data')
    const result = evaluateCommunication(scenario, request('pc01', 'db', 'DATABASE'))
    expect(result.allowed).toBe(false)
    expect(result.reason).toBe('NO_ROUTE')
  })

  it('ignores rules belonging to a Firewall that is not on the resolved path', () => {
    const scenario = cloneScenario(lateralScenario)
    scenario.firewallPolicies.find((policy) => policy.firewallId === 'edge-fw')!.rules.unshift({
      id: 'unused-deny', firewallId: 'edge-fw', order: 1, name: 'unused',
      source: { kind: 'ZONE', zone: 'Office' }, destination: { kind: 'NODE', nodeId: 'db' }, serviceId: 'DATABASE', action: 'DENY', enabled: true,
    })
    const result = evaluateCommunication(scenario, request('pc01', 'db', 'DATABASE'))
    expect(result.allowed).toBe(true)
    expect(result.firewallsTraversed).toEqual(['internal-fw'])
    expect(result.matchedRules.map((rule) => rule.id)).not.toContain('unused-deny')
  })

  it('uses ascending First Match so the lower-order ALLOW precedes a later DENY', () => {
    const result = evaluateCommunication(lateralScenario, request('pc01', 'db', 'DATABASE'))
    expect(result.allowed).toBe(true)
    expect(result.matchedRules.at(-1)?.id).toBe('internal-20-office-db-allow')
  })

  it('changes the decision when the explicit rule order is changed', () => {
    const scenario = cloneScenario(lateralScenario)
    const rules = internalPolicy(scenario).rules
    rules.find((rule) => rule.id === 'internal-20-office-db-allow')!.order = 40
    rules.find((rule) => rule.id === 'internal-30-office-db-deny')!.order = 20
    const result = evaluateCommunication(scenario, request('pc01', 'db', 'DATABASE'))
    expect(result.allowed).toBe(false)
    expect(result.matchedRules.at(-1)?.id).toBe('internal-30-office-db-deny')
  })

  it('uses the Firewall local Default DENY when no enabled rule matches', () => {
    const scenario = cloneScenario(lateralScenario)
    internalPolicy(scenario).rules.forEach((rule) => { rule.enabled = false })
    const result = evaluateCommunication(scenario, request('pc01', 'db', 'DATABASE'))
    expect(result.allowed).toBe(false)
    expect(result.reason).toBe('FIREWALL_DENY')
    expect(result.firewallDecisions.at(-1)?.defaultAction).toBe('DENY')
  })

  it('rejects a request for a service the target does not provide', () => {
    const result = evaluateCommunication(lateralScenario, request('pc01', 'web', 'DATABASE'))
    expect(result.allowed).toBe(false)
    expect(result.reason).toBe('SERVICE_UNAVAILABLE')
  })

  it('does not route same-VLAN communication through a Layer 3 device', () => {
    const result = evaluateCommunication(lateralScenario, request('pc01', 'pc03', 'INTERNAL'))
    expect(result.path).not.toContain('core')
    expect(result.path).not.toContain('edge-fw')
    expect(result.path).not.toContain('internal-fw')
  })

  it('does not use a physical BFS path to bypass a missing inter-subnet route', () => {
    const scenario = cloneScenario(lateralScenario)
    scenario.routes = scenario.routes.filter((route) => route.id !== 'core-to-data')
    const result = evaluateCommunication(scenario, request('pc01', 'db', 'DATABASE'))
    expect(result.allowed).toBe(false)
    expect(result.reason).toBe('NO_ROUTE')
    expect(result.path).not.toContain('db')
  })

  it('returns ISOLATED when a source, target, or transit device is isolated', () => {
    const scenario = cloneScenario(lateralScenario)
    scenario.nodes.find((node) => node.id === 'pc02')!.isolationEnabled = true
    const result = evaluateCommunication(scenario, request('pc01', 'pc02', 'INTERNAL'))
    expect(result.allowed).toBe(false)
    expect(result.reason).toBe('ISOLATED')
  })

  it('returns LINK_DISABLED when a required physical link is disabled', () => {
    const scenario = cloneScenario(lateralScenario)
    scenario.edges.find((edge) => edge.id === 'l-office-pc01')!.enabled = false
    const result = evaluateCommunication(scenario, request('pc01', 'pc02', 'INTERNAL'))
    expect(result.allowed).toBe(false)
    expect(result.reason).toBe('LINK_DISABLED')
  })

  it('returns VLAN_MISMATCH when physical connectivity exists but switch ports do not carry the VLAN', () => {
    const scenario = cloneScenario(lateralScenario)
    scenario.interfaces.find((intf) => intf.id === 'office-sw-pc02-port')!.accessVlanId = 20
    const result = evaluateCommunication(scenario, request('pc01', 'pc02', 'INTERNAL'))
    expect(result.allowed).toBe(false)
    expect(result.reason).toBe('VLAN_MISMATCH')
  })

  it('uses Longest Prefix Match to select a subnet route before the default route', () => {
    const result = lookupRoute(lateralScenario, 'core', '10.10.20.20')
    expect(result?.route.id).toBe('core-to-dmz')
    expect(result?.prefixLength).toBe(24)
  })

  it('does not mutate node status when communication is allowed', () => {
    const scenario = cloneScenario(lateralScenario)
    const before = scenario.nodes.map((node) => node.status)
    const result = evaluateCommunication(scenario, request('pc01', 'db', 'DATABASE'))
    expect(result.allowed).toBe(true)
    expect(scenario.nodes.map((node) => node.status)).toEqual(before)
  })

  it('returns deterministic paths and Firewall matches for identical inputs', () => {
    const req = request('pc01', 'db', 'DATABASE')
    expect(evaluateCommunication(lateralScenario, req)).toEqual(evaluateCommunication(lateralScenario, req))
  })

  it('parses valid IPv4 and rejects invalid octets', () => {
    expect(parseIPv4('10.10.10.21')?.value).toBe(ipv4ToInt('10.10.10.21'))
    expect(parseIPv4('10.10.10.256')).toBeNull()
    expect(parseIPv4('10.10.10')).toBeNull()
  })

  it('handles /24 and /30 masks and membership', () => {
    expect(prefixToMask(24)).toBe('255.255.255.0')
    expect(prefixToMask(30)).toBe('255.255.255.252')
    expect(isIpInCidr('10.10.10.21', '10.10.10.0/24')).toBe(true)
    expect(isIpInCidr('10.10.254.2', '10.10.254.0/30')).toBe(true)
    expect(sameSubnet('10.10.254.1', '10.10.254.2', 30)).toBe(true)
    expect(sameSubnet('10.10.254.1', '10.10.254.5', 30)).toBe(false)
  })

  it('validates the complete main scenario and detects invalid interface references, CIDR, and repeated order', () => {
    expect(validateScenario(lateralScenario)).toEqual([])
    const scenario = cloneScenario(lateralScenario)
    scenario.edges[0].sourceInterfaceId = 'missing-interface'
    scenario.vlans[0].subnetCidr = '10.10.10.0/99'
    internalPolicy(scenario).rules[1].order = internalPolicy(scenario).rules[2].order
    const errors = validateScenario(scenario).join(' ')
    expect(errors).toContain('sourceInterfaceId 不存在')
    expect(errors).toContain('Subnet CIDR 无效')
    expect(errors).toContain('order 重复')
  })

  it('reports an Edge whose source or target references a missing node', () => {
    const scenario = cloneScenario(lateralScenario)
    scenario.edges[0].target = 'missing-node'
    expect(validateScenario(scenario).join(' ')).toContain('target 不存在：missing-node')
  })
})
