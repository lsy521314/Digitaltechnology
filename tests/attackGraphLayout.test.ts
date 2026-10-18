import { describe, expect, it } from 'vitest'
import { cloneScenario, lateralScenario } from '../src/data/scenarios'
import { runSimulation } from '../src/engine/simulationEngine'
import { ATTACK_GRAPH_NODE_LIMIT, buildAttackGraph, techniqueColor } from '../src/engine/attackGraphLayout'

const searchOf = (scenario = cloneScenario(lateralScenario)) => runSimulation(scenario).attackSearchResult!

describe('attack graph layout', () => {
  it('lays out the lateral state space as a layered DAG rooted at the initial state', () => {
    const model = buildAttackGraph(searchOf())!
    expect(model).not.toBeNull()
    const roots = model.nodes.filter((node) => node.isInitial)
    expect(roots).toHaveLength(1)
    expect(roots[0].depth).toBe(0)
    expect(model.layerCount).toBeGreaterThan(1)
    for (const edge of model.edges) {
      const from = model.nodes.find((node) => node.key === edge.from)!
      const to = model.nodes.find((node) => node.key === edge.to)!
      expect(to.depth).toBeGreaterThan(from.depth)
    }
  })

  it('never draws two nodes for the same security state', () => {
    const model = buildAttackGraph(searchOf())!
    expect(new Set(model.nodes.map((node) => node.key)).size).toBe(model.nodes.length)
    expect(new Set(model.nodes.map((node) => node.order)).size).toBe(model.nodes.length)
  })

  it('marks the objective state and keeps the witness chain distinguishable', () => {
    const model = buildAttackGraph(searchOf())!
    expect(model.objectiveReached).toBe(true)
    expect(model.nodes.some((node) => node.isObjective)).toBe(true)
    expect(model.nodes.some((node) => node.isOnWitness)).toBe(true)
    expect(model.edges.some((edge) => edge.onWitness)).toBe(true)
  })

  it('attaches blocked attempts to the state they started from', () => {
    const scenario = cloneScenario(lateralScenario)
    scenario.nodes.find((node) => node.id === 'db')!.securityControls = ['DATA_ACCESS_CONTROL']
    const model = buildAttackGraph(searchOf(scenario))!
    const blocked = model.nodes.flatMap((node) => node.blocked)
    expect(blocked.length).toBeGreaterThan(0)
    expect(blocked.some((item) => item.techniqueId === 'database-access')).toBe(true)
    expect(model.objectiveReached).toBe(false)
  })

  it('is deterministic for identical input', () => {
    const first = buildAttackGraph(searchOf())!
    const second = buildAttackGraph(searchOf())!
    expect(JSON.stringify(first)).toBe(JSON.stringify(second))
  })

  it('keeps every node inside the computed canvas', () => {
    const model = buildAttackGraph(searchOf())!
    for (const node of model.nodes) {
      expect(node.x).toBeGreaterThanOrEqual(0)
      expect(node.y).toBeGreaterThanOrEqual(0)
      expect(node.x + node.width).toBeLessThanOrEqual(model.width)
      expect(node.y + node.height).toBeLessThanOrEqual(model.height)
    }
  })

  it('degrades to the witness chain instead of overflowing on a wide state space', () => {
    const model = buildAttackGraph(searchOf())!
    if (model.nodes.length > ATTACK_GRAPH_NODE_LIMIT) {
      expect(model.truncated).toBe(true)
      expect(model.nodes.every((node) => node.isInitial || node.isOnWitness)).toBe(true)
    } else {
      expect(model.truncated).toBe(false)
    }
  })

  it('returns null when there is no search result to draw', () => {
    expect(buildAttackGraph(null)).toBeNull()
  })

  it('assigns a stable colour per technique', () => {
    const model = buildAttackGraph(searchOf())!
    expect(techniqueColor(model.techniqueIds, model.techniqueIds[0])).toBe('#4f9fd6')
    expect(techniqueColor(model.techniqueIds, 'missing')).toBe('#4f9fd6')
  })

  it('reports graph size for UI sizing', () => {
    const model = buildAttackGraph(searchOf())!
    // eslint-disable-next-line no-console
    console.log('ATTACK GRAPH', JSON.stringify({
      nodes: model.nodes.length,
      edges: model.edges.length,
      layers: model.layerCount,
      width: model.width,
      height: model.height,
      truncated: model.truncated,
      techniques: model.techniqueIds,
    }))
    expect(model.width).toBeGreaterThan(200)
  })
})
