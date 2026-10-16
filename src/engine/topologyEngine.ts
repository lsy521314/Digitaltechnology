import type { NetworkEdge, NetworkInterface, NetworkNode } from '../types/network'

export interface NetworkPath {
  nodeIds: string[]
  edgeIds: string[]
}

export function getNeighbors(nodeId: string, edges: NetworkEdge[], includeDisabled = false): Array<{ nodeId: string; edge: NetworkEdge }> {
  const neighbors: Array<{ nodeId: string; edge: NetworkEdge }> = []
  for (const edge of edges) {
    if (!edge.enabled && !includeDisabled) continue
    if (edge.source === nodeId) neighbors.push({ nodeId: edge.target, edge })
    else if (edge.target === nodeId) neighbors.push({ nodeId: edge.source, edge })
  }
  return neighbors
}

export function interfaceCarriesVlan(intf: NetworkInterface | undefined, vlanId: number): boolean {
  if (!intf || !intf.enabled) return false
  if (intf.kind === 'ENDPOINT_NIC' || intf.kind === 'L3_INTERFACE' || intf.kind === 'VLAN_GATEWAY') return intf.vlanId === vlanId
  if (intf.kind !== 'SWITCH_PORT') return false
  return intf.switchportMode === 'ACCESS'
    ? intf.accessVlanId === vlanId
    : Boolean(intf.allowedVlanIds?.includes(vlanId))
}

function isIsolated(node: NetworkNode | undefined): boolean {
  return Boolean(node && (node.status === 'isolated' || node.isolationEnabled))
}

/** L2 forwarding only. Intermediate devices must be L2 switches; endpoints never relay. */
export function findLayer2Path(
  sourceId: string,
  targetId: string,
  vlanId: number,
  nodes: NetworkNode[],
  edges: NetworkEdge[],
  interfaces: NetworkInterface[],
  options: { ignoreIsolation?: boolean } = {},
): NetworkPath | null {
  const nodeById = new Map(nodes.map((node) => [node.id, node]))
  const interfaceById = new Map(interfaces.map((intf) => [intf.id, intf]))
  if (!nodeById.has(sourceId) || !nodeById.has(targetId)) return null
  if (!options.ignoreIsolation && (isIsolated(nodeById.get(sourceId)) || isIsolated(nodeById.get(targetId)))) return null
  if (sourceId === targetId) return { nodeIds: [sourceId], edgeIds: [] }

  const queue = [sourceId]
  const previous = new Map<string, { nodeId: string; edgeId: string }>()
  const visited = new Set([sourceId])
  while (queue.length) {
    const current = queue.shift()!
    for (const { nodeId: next, edge } of getNeighbors(current, edges)) {
      const currentInterfaceId = edge.source === current ? edge.sourceInterfaceId : edge.targetInterfaceId
      const nextInterfaceId = edge.source === next ? edge.sourceInterfaceId : edge.targetInterfaceId
      if (!interfaceCarriesVlan(interfaceById.get(currentInterfaceId), vlanId)
        || !interfaceCarriesVlan(interfaceById.get(nextInterfaceId), vlanId)) continue
      const nextNode = nodeById.get(next)
      if (!nextNode || (!options.ignoreIsolation && isIsolated(nextNode)) || visited.has(next)) continue
      if (next !== targetId && nextNode.deviceRole !== 'L2_SWITCH') continue
      visited.add(next)
      previous.set(next, { nodeId: current, edgeId: edge.id })
      if (next === targetId) {
        const nodeIds = [targetId]
        const edgeIds: string[] = []
        let cursor = targetId
        while (cursor !== sourceId) {
          const step = previous.get(cursor)
          if (!step) return null
          edgeIds.unshift(step.edgeId)
          nodeIds.unshift(step.nodeId)
          cursor = step.nodeId
        }
        return { nodeIds, edgeIds }
      }
      queue.push(next)
    }
  }
  return null
}

export function findPhysicalPath(sourceId: string, targetId: string, edges: NetworkEdge[], includeDisabled = false): NetworkPath | null {
  if (sourceId === targetId) return { nodeIds: [sourceId], edgeIds: [] }
  const queue = [sourceId]
  const previous = new Map<string, { nodeId: string; edgeId: string }>()
  const visited = new Set([sourceId])
  while (queue.length) {
    const current = queue.shift()!
    for (const { nodeId: next, edge } of getNeighbors(current, edges, includeDisabled)) {
      if (visited.has(next)) continue
      visited.add(next)
      previous.set(next, { nodeId: current, edgeId: edge.id })
      if (next === targetId) {
        const nodeIds = [targetId]
        const edgeIds: string[] = []
        let cursor = targetId
        while (cursor !== sourceId) {
          const step = previous.get(cursor)
          if (!step) return null
          edgeIds.unshift(step.edgeId)
          nodeIds.unshift(step.nodeId)
          cursor = step.nodeId
        }
        return { nodeIds, edgeIds }
      }
      queue.push(next)
    }
  }
  return null
}
