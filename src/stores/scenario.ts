import { defineStore } from 'pinia'
import { cloneScenario, getScenario, lateralScenario } from '../data/scenarios'
import { validateScenario } from '../engine/scenarioValidator'
import type { FirewallPolicy, FirewallRule, NetworkEdge, NetworkInterface, NetworkNode } from '../types/network'
import type { Scenario } from '../types/scenario'

const STORAGE_KEY = 'zhiyu-network-scenario-v3'

function persist(scenario: Scenario) {
  if (typeof localStorage !== 'undefined') localStorage.setItem(STORAGE_KEY, JSON.stringify(scenario))
}

export const useScenarioStore = defineStore('scenario', {
  state: () => ({
    current: cloneScenario(lateralScenario) as Scenario,
    selectedNodeId: 'pc01' as string | null,
    hydrated: false,
    revision: 0,
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
      this.revision += 1
      persist(this.current)
    },
    selectNode(id: string | null) {
      this.selectedNodeId = id
    },
    updateNode(id: string, changes: Partial<NetworkNode>) {
      const node = this.current.nodes.find((item) => item.id === id)
      if (node) Object.assign(node, changes)
      this.revision += 1
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
      this.revision += 1
      persist(this.current)
    },
    updateInterface(id: string, changes: Partial<NetworkInterface>) {
      const intf = this.current.interfaces.find((item) => item.id === id)
      if (intf) Object.assign(intf, changes)
      this.revision += 1
      persist(this.current)
    },
    updateFirewallRule(id: string, changes: Partial<FirewallRule>) {
      const rule = this.current.firewallPolicies.flatMap((policy) => policy.rules).find((item) => item.id === id)
      if (rule) Object.assign(rule, changes)
      this.revision += 1
      persist(this.current)
    },
    setFirewallDefault(firewallId: string, defaultAction: FirewallPolicy['defaultAction']) {
      const policy = this.current.firewallPolicies.find((item) => item.firewallId === firewallId)
      if (policy) policy.defaultAction = defaultAction
      this.revision += 1
      persist(this.current)
    },
    moveFirewallRule(id: string, direction: -1 | 1) {
      const policy = this.current.firewallPolicies.find((item) => item.rules.some((rule) => rule.id === id))
      if (!policy) return
      const ordered = [...policy.rules].sort((a, b) => a.order - b.order)
      const index = ordered.findIndex((rule) => rule.id === id)
      const other = ordered[index + direction]
      if (!other) return
      const currentOrder = ordered[index].order
      ordered[index].order = other.order
      other.order = currentOrder
      policy.rules = ordered.sort((a, b) => a.order - b.order)
      this.revision += 1
      persist(this.current)
    },
    addFirewallRule(firewallId: string, input: Omit<FirewallRule, 'id' | 'firewallId' | 'enabled' | 'order'> & { enabled?: boolean }) {
      const policy = this.current.firewallPolicies.find((item) => item.firewallId === firewallId)
      if (!policy) return
      const used = new Set(policy.rules.map((rule) => rule.id))
      let index = 1
      while (used.has(firewallId + '-custom-' + index)) index += 1
      const order = Math.max(0, ...policy.rules.map((rule) => rule.order)) + 10
      policy.rules.push({ ...input, id: firewallId + '-custom-' + index, firewallId, order, enabled: input.enabled ?? true })
      this.revision += 1
      persist(this.current)
    },
    removeFirewallRule(id: string) {
      for (const policy of this.current.firewallPolicies) policy.rules = policy.rules.filter((rule) => rule.id !== id)
      this.revision += 1
      persist(this.current)
    },
    save() {
      persist(this.current)
    },
    restoreDefaults() {
      this.current = getScenario(this.current.id)
      this.selectedNodeId = this.current.nodes[0]?.id ?? null
      this.revision += 1
      persist(this.current)
    },
    importScenario(scenario: Scenario) {
      const errors = validateScenario(scenario)
      if (errors.length) throw new Error('场景 JSON 校验失败：' + errors.join(' '))
      this.current = scenario
      this.selectedNodeId = scenario.nodes[0]?.id ?? null
      this.revision += 1
      persist(this.current)
    },
  },
})
