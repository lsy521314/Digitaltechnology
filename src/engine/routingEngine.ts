import type { NetworkEdge, NetworkInterface, NetworkNode, RouteEntry } from '../types/network'
import type { Scenario } from '../types/scenario'
import { cidrContainsCidr, isIpInCidr, prefixOfCidr } from './ipv4'

export interface RouteLookup {
  route: RouteEntry
  prefixLength: number
}

export function getDirectRoutes(scenario: Pick<Scenario, 'interfaces'>, deviceId: string): RouteEntry[] {
  return scenario.interfaces
    .filter((intf) => intf.nodeId === deviceId && intf.enabled
      && (intf.kind === 'L3_INTERFACE' || intf.kind === 'VLAN_GATEWAY')
      && intf.ipv4Address !== undefined && intf.prefixLength !== undefined)
    .map((intf) => ({
      id: 'direct:' + intf.id,
      deviceId,
      kind: 'DIRECT' as const,
      destinationCidr: intf.ipv4Address + '/' + intf.prefixLength,
      outInterfaceId: intf.id,
    }))
}

export function getRoutingTable(scenario: Pick<Scenario, 'interfaces' | 'routes'>, deviceId: string): RouteEntry[] {
  return [...getDirectRoutes(scenario, deviceId), ...scenario.routes.filter((route) => route.deviceId === deviceId)]
}

/** Longest Prefix Match; DIRECT wins only when the prefix length is identical. */
export function lookupRoute(scenario: Pick<Scenario, 'interfaces' | 'routes'>, deviceId: string, destinationIp: string): RouteLookup | null {
  const candidates = getRoutingTable(scenario, deviceId)
    .filter((route) => isIpInCidr(destinationIp, route.destinationCidr))
    .map((route) => ({ route, prefixLength: prefixOfCidr(route.destinationCidr) }))
    .sort((a, b) => b.prefixLength - a.prefixLength
      || Number(b.route.kind === 'DIRECT') - Number(a.route.kind === 'DIRECT'))
  return candidates[0] ?? null
}

export function findNextHop(
  scenario: Pick<Scenario, 'interfaces' | 'nodes'>,
  edges: NetworkEdge[],
  currentDeviceId: string,
  route: RouteEntry,
): { node: NetworkNode; edge: NetworkEdge; localInterface: NetworkInterface; remoteInterface: NetworkInterface } | null {
  if (!route.nextHopIp) return null
  const local = scenario.interfaces.find((intf) => intf.id === route.outInterfaceId && intf.nodeId === currentDeviceId)
  if (!local) return null
  for (const edge of edges) {
    if (!edge.enabled) continue
    const localId = edge.source === currentDeviceId ? edge.sourceInterfaceId : edge.target === currentDeviceId ? edge.targetInterfaceId : null
    if (localId !== local.id) continue
    const remoteId = edge.sourceInterfaceId === local.id ? edge.targetInterfaceId : edge.sourceInterfaceId
    const remote = scenario.interfaces.find((intf) => intf.id === remoteId)
    if (remote?.ipv4Address !== route.nextHopIp) continue
    const nextNodeId = remote.nodeId
    const node = scenario.nodes.find((item) => item.id === nextNodeId)
    if (node) return { node, edge, localInterface: local, remoteInterface: remote }
  }
  return null
}

export function validateRouteNetwork(route: RouteEntry): boolean {
  if (route.kind === 'DEFAULT') return route.destinationCidr === '0.0.0.0/0'
  if (route.kind === 'DIRECT') return true
  return cidrContainsCidr(route.destinationCidr, route.destinationCidr)
}
