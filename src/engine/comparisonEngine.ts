import { cloneScenario, getScenario, isBuiltInScenario } from '../data/scenarios'
import type { Scenario } from '../types/scenario'
import type { SimulationOptions, SimulationResult } from '../types/simulation'
import { runSimulation } from './simulationEngine'

export interface ComparisonRun {
  scenario: Scenario
  scenarioA: Scenario
  scenarioB: Scenario
  resultA: SimulationResult
  resultB: SimulationResult
}

export interface ComparisonScenarios {
  scenarioA: Scenario
  scenarioB: Scenario
  optionsA: SimulationOptions
  optionsB: SimulationOptions
}

export function hasComparisonBaseline(scenario: Scenario): boolean {
  return isBuiltInScenario(scenario.id)
}

function isolationOptions(scenario: Scenario): SimulationOptions {
  return {
    isolatedNodeIds: scenario.nodes
      .filter((node) => node.isolationEnabled || node.status === 'isolated')
      .map((node) => node.id),
  }
}

export function buildComparisonScenarios(current: Scenario): ComparisonScenarios {
  if (!hasComparisonBaseline(current)) {
    throw new Error('该自定义场景没有原始基线，无法执行有效的 A/B 对照。')
  }
  const baseline = getScenario(current.id)
  const scenarioA = cloneScenario(current)
  const scenarioB = cloneScenario(current)
  scenarioA.firewallPolicies = cloneScenario(baseline).firewallPolicies
  scenarioA.nodes = scenarioA.nodes.map((node) => {
    const original = baseline.nodes.find((item) => item.id === node.id)
    return {
      ...node,
      protectionEnabled: original?.protectionEnabled ?? false,
      isolationEnabled: original?.isolationEnabled ?? false,
      securityControls: original?.securityControls ? [...original.securityControls] : undefined,
    }
  })
  return {
    scenarioA,
    scenarioB,
    optionsA: isolationOptions(scenarioA),
    optionsB: isolationOptions(scenarioB),
  }
}

export function runComparison(current: Scenario): ComparisonRun {
  const { scenarioA, scenarioB, optionsA, optionsB } = buildComparisonScenarios(current)
  return {
    scenario: cloneScenario(current),
    scenarioA,
    scenarioB,
    resultA: runSimulation(scenarioA, optionsA),
    resultB: runSimulation(scenarioB, optionsB),
  }
}
