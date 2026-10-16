import { defineStore } from 'pinia'
import { runSimulation } from '../engine/simulationEngine'
import { useScenarioStore } from './scenario'
import type { SimulationResult } from '../types/simulation'
import type { Scenario } from '../types/scenario'

let playbackTimer: ReturnType<typeof setInterval> | undefined
const clearPlayback = () => {
  if (playbackTimer) clearInterval(playbackTimer)
  playbackTimer = undefined
}

type SavedComparison = {
  scenario: Scenario
  scenarioA: Scenario
  scenarioB: Scenario
  resultA: SimulationResult
  resultB: SimulationResult
}

export const useSimulationStore = defineStore('simulation', {
  state: () => ({
    result: null as SimulationResult | null,
    resultScenarioKey: null as string | null,
    lastComparison: null as SavedComparison | null,
    comparisonScenarioKey: null as string | null,
    cursor: -1,
    status: 'idle' as 'idle' | 'running' | 'paused' | 'completed',
    speed: 1 as 1 | 2 | 4,
  }),
  getters: {
    simulationStale: (state) => Boolean(state.result && state.resultScenarioKey !== JSON.stringify(useScenarioStore().current)),
    comparisonStale: (state) => Boolean(state.lastComparison && state.comparisonScenarioKey !== JSON.stringify(useScenarioStore().current)),
    currentEvent: (state) => state.result?.events[state.cursor] ?? null,
    progress: (state) => !state.result || !state.result.events.length ? 0 : Math.max(0, ((state.cursor + 1) / state.result.events.length) * 100),
    currentStatuses: (state) => {
      if (!state.result || state.cursor < 0) return null
      return state.result.snapshots[state.cursor]?.nodeStatuses ?? null
    },
    currentCompromisedNodeIds: (state) => {
      if (!state.result || state.cursor < 0) return []
      return state.result.snapshots[state.cursor]?.compromisedNodeIds ?? []
    },
  },
  actions: {
    makeResult() {
      const scenario = useScenarioStore().current
      this.result = runSimulation(scenario)
      this.resultScenarioKey = JSON.stringify(scenario)
      this.lastComparison = null
      this.comparisonScenarioKey = null
      this.cursor = -1
    },
    saveComparison(scenario: Scenario, scenarioA: Scenario, scenarioB: Scenario, resultA: SimulationResult, resultB: SimulationResult) {
      clearPlayback()
      this.lastComparison = {
        scenario: JSON.parse(JSON.stringify(scenario)) as Scenario,
        scenarioA: JSON.parse(JSON.stringify(scenarioA)) as Scenario,
        scenarioB: JSON.parse(JSON.stringify(scenarioB)) as Scenario,
        resultA,
        resultB,
      }
      this.comparisonScenarioKey = JSON.stringify(scenario)
      this.result = resultB
      this.resultScenarioKey = JSON.stringify(scenario)
      this.cursor = Math.max(-1, resultB.events.length - 1)
      this.status = 'completed'
    },
    advancePlayback() {
      if (!this.result) return
      this.cursor = Math.min(this.cursor + 1, this.result.events.length - 1)
      if (this.cursor >= this.result.events.length - 1) {
        this.status = 'completed'
        clearPlayback()
      }
    },
    step() {
      if (this.status === 'running') {
        clearPlayback()
        this.status = 'paused'
      }
      const currentScenario = useScenarioStore().current
      if (!this.result || this.resultScenarioKey !== JSON.stringify(currentScenario)) this.makeResult()
      if (!this.result) return
      this.status = 'paused'
      this.advancePlayback()
    },
    start() {
      clearPlayback()
      this.makeResult()
      if (!this.result?.events.length) {
        this.status = 'completed'
        return
      }
      this.status = 'running'
      this.advancePlayback()
      if (this.status === 'running') this.beginPlayback()
    },
    beginPlayback() {
      clearPlayback()
      playbackTimer = setInterval(() => {
        if (this.status !== 'running') return clearPlayback()
        this.advancePlayback()
      }, 1100 / this.speed)
    },
    pause() {
      clearPlayback()
      if (this.status === 'running') this.status = 'paused'
    },
    resume() {
      if (!this.result) return this.start()
      if (this.cursor >= this.result.events.length - 1) return
      this.status = 'running'
      this.beginPlayback()
    },
    setSpeed(speed: 1 | 2 | 4) {
      this.speed = speed
      if (this.status === 'running') this.beginPlayback()
    },
    seek(index: number) {
      if (!this.result) return
      clearPlayback()
      this.cursor = Math.max(-1, Math.min(index, this.result.events.length - 1))
      this.status = 'paused'
    },
    runToEnd() {
      clearPlayback()
      const currentScenario = useScenarioStore().current
      if (!this.result || this.resultScenarioKey !== JSON.stringify(currentScenario)) this.makeResult()
      if (!this.result) return
      this.cursor = this.result.events.length - 1
      this.status = 'completed'
    },
    reset() {
      clearPlayback()
      this.result = null
      this.resultScenarioKey = null
      this.lastComparison = null
      this.comparisonScenarioKey = null
      this.cursor = -1
      this.status = 'idle'
    },
  },
})
