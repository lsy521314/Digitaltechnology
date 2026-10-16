import type { NetworkEdge, NetworkNode, ServiceType } from '../types/network'

export interface NetworkPath {
  nodeIds: string[]
  edgeIds: string[]
}

export interface TopologyQueryOptions {
  service?: ServiceType
  nodes?: NetworkNode[]
  ignoreIsolation?: boolean
}

function isUnavailable(node: NetworkNode | undefined, ignoreIsolation: boolean): boolean {
  return Boolean(node && !ignoreIsolation && (node.status === 'isolated' || node.isolationEnabled))
}

function canTransit(node: NetworkNode | undefined): boolean {
  if (!node) return true
  return !['Internet', 'Workstation', 'Server', 'Database'].includes(node.type)
}

export function getNeighbors(nodeId: string, edges: NetworkEdge[]): Array<{ nodeId: string; edge: NetworkEdge }> {
  const neighbors: Array<{ nodeId: string; edge: NetworkEdge }> = []
  for (const edge of edges) {
    if (!edge.enabled) continue
    if (edge.source === nodeId) neighbors.push({ nodeId: edge.target, edge })
    else if (edge.bidirectional && edge.target === nodeId) neighbors.push({ nodeId: edge.source, edge })
  }
  return neighbors
}

export function findPath(
  sourceId: string,
  targetId: string,
  edges: NetworkEdge[],
  options: TopologyQueryOptions = {},
): NetworkPath | null {
  const { nodes = [], service, ignoreIsolation = false } = options
  if (isUnavailable(nodes.find((node) => node.id === sourceId), ignoreIsolation)
    || isUnavailable(nodes.find((node) => node.id === targetId), ignoreIsolation)) return null
  if (sourceId === targetId) return { nodeIds: [sourceId], edgeIds: [] }

  const queue = [sourceId]
  const previous = new Map<string, { nodeId: string; edgeId: string }>()
  const visited = new Set([sourceId])
  while (queue.length) {
    const current = queue.shift()!
    for (const { nodeId: next, edge } of getNeighbors(current, edges)) {
      // Service labels describe the access segment at the destination boundary.
      // Transit links may carry other services while routing through a network zone.
      if (next === targetId && service && service !== 'ANY'
        && (service === 'INTERNAL' ? edge.service !== 'INTERNAL' : edge.service !== 'INTERNAL' && edge.service !== service)) continue
      if (next !== targetId && !canTransit(nodes.find((node) => node.id === next))) continue
      if (visited.has(next) || isUnavailable(nodes.find((node) => node.id === next), ignoreIsolation)) continue
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

export function findServicePath(
  sourceId: string,
  targetId: string,
  service: ServiceType,
  edges: NetworkEdge[],
  nodes: NetworkNode[] = [],
  options: Pick<TopologyQueryOptions, 'ignoreIsolation'> = {},
): NetworkPath | null {
  return findPath(sourceId, targetId, edges, { nodes, service, ignoreIsolation: options.ignoreIsolation })
}

export function hasPath(sourceId: string, targetId: string, edges: NetworkEdge[], nodes: NetworkNode[] = []): boolean {
  return findPath(sourceId, targetId, edges, { nodes }) !== null
}

export function findReachableNodes(
  sourceId: string,
  nodes: NetworkNode[],
  edges: NetworkEdge[],
  service: ServiceType = 'ANY',
): Array<{ nodeId: string; path: NetworkPath }> {
  return nodes.flatMap((node) => {
    const path = service === 'ANY'
      ? findPath(sourceId, node.id, edges, { nodes })
      : findServicePath(sourceId, node.id, service, edges, nodes)
    return path ? [{ nodeId: node.id, path }] : []
  })
}
