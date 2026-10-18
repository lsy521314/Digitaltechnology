import type { AttackSearchResult, AttackState, AttackTransition } from '../types/simulation'
import { attackStateSignature } from './attackStateEngine'

/**
 * Deterministic layout for the reachable AttackState graph.
 *
 * Every node is a distinct security state (deduplicated by attackStateSignature),
 * every solid edge is one successful teaching transition, and every dashed stub is
 * a BLOCKED attempt that originates from that state. The layout is presentation
 * only: it never re-runs or re-interprets the search result.
 */

export const ATTACK_GRAPH_NODE_LIMIT = 28

const NODE_WIDTH = 140
const NODE_HEIGHT = 48
const COLUMN_PITCH = 200
const ROW_PITCH = 78
const PADDING_X = 24
const PADDING_TOP = 34
const PADDING_BOTTOM = 24

export type AttackGraphTone = 'initial' | 'controlled' | 'admin' | 'objective'

export interface AttackGraphBlock {
  techniqueId: string
  techniqueName: string
  targetNodeId: string
  reason: string
}

export interface AttackGraphEndpoint {
  nodeId: string
  privilege: string
}

export interface AttackGraphNode {
  key: string
  order: number
  depth: number
  x: number
  y: number
  width: number
  height: number
  tone: AttackGraphTone
  controlled: number
  admin: number
  dataAccess: number
  endpoints: AttackGraphEndpoint[]
  dataNodeIds: string[]
  isInitial: boolean
  isObjective: boolean
  isOnWitness: boolean
  blocked: AttackGraphBlock[]
}

export interface AttackGraphEdge {
  id: string
  from: string
  to: string
  techniqueId: string
  techniqueName: string
  sourceNodeId: string
  targetNodeId: string
  onWitness: boolean
  path: string
}

export interface AttackGraphModel {
  nodes: AttackGraphNode[]
  edges: AttackGraphEdge[]
  width: number
  height: number
  layerCount: number
  truncated: boolean
  objectiveReached: boolean
  searchComplete: boolean
  techniqueIds: string[]
  techniques: Array<{ id: string; name: string }>
}

interface DraftNode {
  key: string
  state: AttackState
  depth: number
  isInitial: boolean
  isOnWitness: boolean
  blocked: AttackGraphBlock[]
}

function summarize(state: AttackState) {
  const endpoints = Object.entries(state.controlledEndpoints)
    .map(([nodeId, endpoint]) => ({ nodeId, privilege: endpoint.privilege }))
    .sort((a, b) => a.nodeId.localeCompare(b.nodeId))
  const dataNodeIds = Object.entries(state.assetAccess)
    .filter(([, access]) => access === 'DATA_ACCESS')
    .map(([nodeId]) => nodeId)
    .sort()
  return {
    endpoints,
    dataNodeIds,
    controlled: endpoints.length,
    admin: endpoints.filter((endpoint) => endpoint.privilege === 'ADMIN').length,
    dataAccess: dataNodeIds.length,
  }
}

function toneOf(summary: ReturnType<typeof summarize>, isInitial: boolean): AttackGraphTone {
  if (isInitial) return 'initial'
  if (summary.dataAccess > 0) return 'objective'
  if (summary.admin > 0) return 'admin'
  return 'controlled'
}

function collectBlocks(search: AttackSearchResult): Map<string, AttackGraphBlock[]> {
  const blocks = new Map<string, AttackGraphBlock[]>()
  const seen = new Set<string>()
  for (const transition of search.blockedTransitions) {
    const key = attackStateSignature(transition.beforeState)
    const signature = `${key}|${transition.techniqueId}|${transition.targetNodeId}`
    if (seen.has(signature)) continue
    seen.add(signature)
    const list = blocks.get(key) ?? []
    list.push({
      techniqueId: transition.techniqueId,
      techniqueName: transition.techniqueName,
      targetNodeId: transition.targetNodeId,
      reason: transition.preconditionChecks.find((check) => !check.passed && (check.id === 'communication' || check.id === 'security-controls'))?.reason
        ?? transition.reason,
    })
    blocks.set(key, list)
  }
  for (const list of blocks.values()) list.sort((a, b) => a.techniqueId.localeCompare(b.techniqueId) || a.targetNodeId.localeCompare(b.targetNodeId))
  return blocks
}

function witnessKeys(search: AttackSearchResult): Set<string> {
  const chain: AttackTransition[] = search.objectiveWitnessChain ?? search.representativeChain ?? []
  const keys = new Set<string>()
  for (const transition of chain) {
    keys.add(attackStateSignature(transition.beforeState))
    keys.add(attackStateSignature(transition.afterState))
  }
  return keys
}

function edgePath(from: AttackGraphNode, to: AttackGraphNode): string {
  const x1 = from.x + from.width
  const y1 = from.y + from.height / 2
  const x2 = to.x
  const y2 = to.y + to.height / 2
  const bend = Math.max(28, (x2 - x1) * 0.55)
  return `M ${x1} ${y1} C ${x1 + bend} ${y1}, ${x2 - bend} ${y2}, ${x2} ${y2}`
}

export function buildAttackGraph(search: AttackSearchResult | null | undefined): AttackGraphModel | null {
  if (!search || !search.successfulTransitions.length && !search.blockedTransitions.length) return null

  const initialKey = attackStateSignature(search.initialState)
  const witness = witnessKeys(search)
  const blocks = collectBlocks(search)
  const drafts = new Map<string, DraftNode>()

  const ensure = (state: AttackState): DraftNode => {
    const key = attackStateSignature(state)
    const existing = drafts.get(key)
    if (existing) return existing
    const draft: DraftNode = {
      key,
      state,
      depth: 0,
      isInitial: key === initialKey,
      isOnWitness: witness.has(key),
      blocked: blocks.get(key) ?? [],
    }
    drafts.set(key, draft)
    return draft
  }

  ensure(search.initialState)
  for (const transition of search.successfulTransitions) {
    ensure(transition.beforeState)
    ensure(transition.afterState)
  }
  for (const transition of search.blockedTransitions) ensure(transition.beforeState)

  const adjacency = new Map<string, string[]>()
  for (const transition of search.successfulTransitions) {
    const from = attackStateSignature(transition.beforeState)
    const to = attackStateSignature(transition.afterState)
    if (from === to) continue
    const list = adjacency.get(from) ?? []
    list.push(to)
    adjacency.set(from, list)
  }

  const depthByKey = new Map<string, number>([[initialKey, 0]])
  const queue = [initialKey]
  while (queue.length) {
    const current = queue.shift()!
    const depth = depthByKey.get(current) ?? 0
    for (const next of adjacency.get(current) ?? []) {
      if (depthByKey.has(next)) continue
      depthByKey.set(next, depth + 1)
      queue.push(next)
    }
  }

  let truncated = false
  let selected = [...drafts.values()]
  if (selected.length > ATTACK_GRAPH_NODE_LIMIT) {
    truncated = true
    selected = selected.filter((draft) => draft.isInitial || draft.isOnWitness)
  }
  for (const draft of selected) draft.depth = depthByKey.get(draft.key) ?? 0
  const layers = new Map<number, DraftNode[]>()
  for (const draft of selected) {
    const list = layers.get(draft.depth) ?? []
    list.push(draft)
    layers.set(draft.depth, list)
  }

  const summaryByKey = new Map<string, ReturnType<typeof summarize>>()
  for (const draft of selected) summaryByKey.set(draft.key, summarize(draft.state))

  const orderedDepths = [...layers.keys()].sort((a, b) => a - b)
  const maxRows = Math.max(...orderedDepths.map((depth) => layers.get(depth)!.length), 1)

  const nodes: AttackGraphNode[] = []
  for (const depth of orderedDepths) {
    const layer = layers.get(depth)!
    layer.sort((a, b) => {
      const left = summaryByKey.get(a.key)!
      const right = summaryByKey.get(b.key)!
      return right.dataAccess - left.dataAccess
        || right.admin - left.admin
        || right.controlled - left.controlled
        || a.key.localeCompare(b.key)
    })
    const offset = ((maxRows - layer.length) * ROW_PITCH) / 2
    layer.forEach((draft, index) => {
      const summary = summaryByKey.get(draft.key)!
      nodes.push({
        key: draft.key,
        order: nodes.length,
        depth,
        x: PADDING_X + depth * COLUMN_PITCH,
        y: PADDING_TOP + offset + index * ROW_PITCH,
        width: NODE_WIDTH,
        height: NODE_HEIGHT,
        tone: toneOf(summary, draft.isInitial),
        controlled: summary.controlled,
        admin: summary.admin,
        dataAccess: summary.dataAccess,
        endpoints: summary.endpoints,
        dataNodeIds: summary.dataNodeIds,
        isInitial: draft.isInitial,
        isObjective: summary.dataAccess > 0,
        isOnWitness: draft.isOnWitness,
        blocked: draft.blocked,
      })
    })
  }

  const nodeByKey = new Map(nodes.map((node) => [node.key, node]))
  const edges: AttackGraphEdge[] = []
  for (const transition of search.successfulTransitions) {
    const from = nodeByKey.get(attackStateSignature(transition.beforeState))
    const to = nodeByKey.get(attackStateSignature(transition.afterState))
    if (!from || !to || from.key === to.key) continue
    edges.push({
      id: transition.id,
      from: from.key,
      to: to.key,
      techniqueId: transition.techniqueId,
      techniqueName: transition.techniqueName,
      sourceNodeId: transition.sourceNodeId,
      targetNodeId: transition.targetNodeId,
      onWitness: from.isOnWitness && to.isOnWitness,
      path: edgePath(from, to),
    })
  }

  const layerCount = orderedDepths.length
  const width = PADDING_X * 2 + Math.max(0, layerCount - 1) * COLUMN_PITCH + NODE_WIDTH
  const height = PADDING_TOP + Math.max(0, maxRows - 1) * ROW_PITCH + NODE_HEIGHT + PADDING_BOTTOM

  const techniqueIds = [...new Set(edges.map((edge) => edge.techniqueId))].sort()
  const nameById = new Map<string, string>()
  for (const edge of edges) if (!nameById.has(edge.techniqueId)) nameById.set(edge.techniqueId, edge.techniqueName)

  return {
    nodes,
    edges,
    width,
    height,
    layerCount,
    truncated,
    objectiveReached: search.objectiveReached,
    searchComplete: search.searchComplete,
    techniqueIds,
    techniques: techniqueIds.map((id) => ({ id, name: nameById.get(id) ?? id })),
  }
}

/** Short, stable colour assignment so the legend and the edges always agree. */
export const ATTACK_GRAPH_COLORS = ['#4f9fd6', '#59b98f', '#d0a04f', '#b07fd8', '#d97b6c']

export function techniqueColor(techniqueIds: string[], techniqueId: string): string {
  const index = techniqueIds.indexOf(techniqueId)
  return ATTACK_GRAPH_COLORS[(index < 0 ? 0 : index) % ATTACK_GRAPH_COLORS.length]
}
