<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { init, use } from 'echarts/core'
import type { ECharts } from 'echarts/core'
import type { EChartsOption } from 'echarts'
import { BarChart, GaugeChart, GraphChart, LineChart, PieChart, RadarChart } from 'echarts/charts'
import { GridComponent, LegendComponent, RadarComponent, TitleComponent, TooltipComponent } from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'

const props = withDefaults(defineProps<{ option: EChartsOption; height?: string }>(), { height: '250px' })
const host = ref<HTMLDivElement>()
use([BarChart, GaugeChart, GraphChart, LineChart, PieChart, RadarChart, GridComponent, LegendComponent, RadarComponent, TitleComponent, TooltipComponent, CanvasRenderer])

let chart: ECharts | undefined
let observer: ResizeObserver | undefined

function paint() {
  if (!chart) return
  chart.setOption(props.option, { notMerge: true, lazyUpdate: true })
}

onMounted(() => {
  if (!host.value) return
  chart = init(host.value, undefined, { renderer: 'canvas' })
  paint()
  observer = new ResizeObserver(() => chart?.resize())
  observer.observe(host.value)
})
watch(() => props.option, paint, { deep: true })
onBeforeUnmount(() => {
  observer?.disconnect()
  chart?.dispose()
  chart = undefined
})
</script>

<template><div ref="host" class="chart-host" :style="{ height }"></div></template>
