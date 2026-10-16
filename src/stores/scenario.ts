import { defineStore } from 'pinia'
import { cloneScenario, getScenario, lateralScenario } from '../data/scenarios'
import { validateScenario } from '../engine/scenarioValidator'
import type { NetworkEdge, NetworkNode, SecurityRule } from '../types/network'
import type { Scenario } from '../types/scenario'

const STORAGE_KEY = 'zhiyu-network-scenario-v2'

function persist(scenario: Scenario) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(scenario))
}

export const useScenarioStore = defineStore('scenario', {
  state: () => ({
    current: cloneScenario(lateralScenario) as Scenario,
    selectedNodeId: 'pc01' as string | null,
    hydrated: false,
  }),
  getters: {
    selectedNode: (state) => state.current.nodes.find((node) => node.id === state.selectedNodeId),
  },
  actions: {
    hydrate() {
      if (this.hydrated || typeof localStorage === 'undefined') return
      const raw = localStorage.getItem(STORAGE_KEY)
      if (raw) {
        try {
          const saved = JSON.parse(raw) as Scenario
          const errors = validateScenario(saved)
          if (!errors.length) this.current = saved
          else localStorage.removeItem(STORAGE_KEY)
        } catch {
          localStorage.removeItem(STORAGE_KEY)
        }
      }
      this.hydrated = true
    },
    selectScenario(id: string) {
      this.current = getScenario(id)
      this.selectedNodeId = this.current.nodes[0]?.id ?? null
      persist(this.current)
    },
    selectNode(id: string | null) {
      this.selectedNodeId = id
    },
    updateNode(id: string, changes: Partial<NetworkNode>) {
      const node = this.current.nodes.find((item) => item.id === id)
      if (node) Object.assign(node, changes)
      persist(this.current)
    },
    moveNode(id: string, position: NetworkNode['position']) {
      const node = this.current.nodes.find((item) => item.id === id)
      if (node) node.position = { ...position }
      persist(this.current)
    },
    updateEdge(id: string, changes: Partial<NetworkEdge>) {
      const edge = this.current.edges.find((item) => item.id === id)
      if (edge) Object.assign(edge, changes)
      persist(this.current)
    },
    updateRule(id: string, changes: Partial<SecurityRule>) {
      const rule = this.current.rules.find((item) => item.id === id)
      if (rule) Object.assign(rule, changes)
      persist(this.current)
    },
    addRule(input: Omit<SecurityRule, 'id' | 'enabled'> & { enabled?: boolean }) {
      const used = new Set(this.current.rules.map((rule) => rule.id))
      let index = 1
      while (used.has('custom-' + index)) index += 1
      this.current.rules.push({ ...input, id: 'custom-' + index, enabled: input.enabled ?? true })
      persist(this.current)
    },
    removeRule(id: string) {
      this.current.rules = this.current.rules.filter((rule) => rule.id !== id)
      persist(this.current)
    },
    save() {
      persist(this.current)
    },
    restoreDefaults() {
      this.current = getScenario(this.current.id)
      this.selectedNodeId = this.current.nodes[0]?.id ?? null
      persist(this.current)
    },
    importScenario(scenario: Scenario) {
      const errors = validateScenario(scenario)
      if (errors.length) throw new Error('场景 JSON 校验失败：' + errors.join(' '))
      this.current = scenario
      this.selectedNodeId = scenario.nodes[0]?.id ?? null
      persist(this.current)
    },
  },
})
