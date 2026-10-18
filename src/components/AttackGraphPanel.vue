<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { AttackSearchResult } from '../types/simulation'
import { buildAttackGraph, techniqueColor, type AttackGraphNode } from '../engine/attackGraphLayout'

const props = defineProps<{
  search: AttackSearchResult | null
  nodeName: (id: string) => string
}>()
const emit = defineEmits<{ (event: 'close'): void }>()

const model = computed(() => buildAttackGraph(props.search))
const selectedKey = ref<string | null>(null)
const hoveredKey = ref<string | null>(null)

const selectedNode = computed<AttackGraphNode | null>(() => {
  const key = selectedKey.value ?? hoveredKey.value
  return model.value?.nodes.find((node) => node.key === key) ?? null
})

const outgoing = computed(() => {
  const node = selectedNode.value
  if (!node || !model.value) return []
  return model.value.edges.filter((edge) => edge.from === node.key)
})

const incoming = computed(() => {
  const node = selectedNode.value
  if (!node || !model.value) return []
  return model.value.edges.filter((edge) => edge.to === node.key)
})

const objectiveNode = computed(() => model.value?.nodes.find((node) => node.isObjective) ?? null)

const summary = computed(() => {
  const value = model.value
  if (!value) return null
  return {
    states: value.nodes.length,
    transitions: value.edges.length,
    layers: value.layerCount,
    blocked: value.nodes.reduce((total, node) => total + node.blocked.length, 0),
  }
})

const activeKey = computed(() => hoveredKey.value ?? selectedKey.value)

const layerLabels = computed(() => {
  const value = model.value
  if (!value) return []
  const byDepth = new Map<number, number>()
  for (const node of value.nodes) {
    if (!byDepth.has(node.depth)) byDepth.set(node.depth, node.x + node.width / 2)
  }
  return [...byDepth.entries()].sort((a, b) => a[0] - b[0]).map(([depth, x]) => ({ depth, x }))
})

function colorOf(techniqueId: string) {
  return techniqueColor(model.value?.techniqueIds ?? [], techniqueId)
}

function edgeOpacity(from: string, to: string, onWitness: boolean) {
  const active = activeKey.value
  if (active) return from === active || to === active ? 1 : 0.14
  return onWitness ? 1 : 0.6
}

function edgeWidth(onWitness: boolean, from: string, to: string) {
  if (activeKey.value && (from === activeKey.value || to === activeKey.value)) return 3
  return onWitness ? 2.8 : 1.4
}

function privilegeLabel(privilege: string) {
  return ({ USER: '普通用户级', ADMIN: '管理员级', NONE: '无控制' } as Record<string, string>)[privilege] ?? privilege
}

function selectNode(key: string) {
  selectedKey.value = selectedKey.value === key ? null : key
}

function onKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') emit('close')
}

watch(() => props.search, () => { selectedKey.value = null })
onMounted(() => window.addEventListener('keydown', onKeydown))
onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown))
</script>

<template>
  <div class="ag-overlay" role="dialog" aria-modal="true" aria-label="攻击状态空间图" @click.self="emit('close')">
    <div class="ag-dialog">
      <header class="ag-header">
        <div class="ag-header-copy">
          <span class="ag-kicker">STATE SPACE</span>
          <h2>攻击状态空间图</h2>
          <p v-if="summary">
            本次搜索共展开 <b>{{ summary.states }}</b> 个不同安全状态、<b>{{ summary.transitions }}</b> 条成功转移，
            <b>{{ summary.blocked }}</b> 条行为被阻断。每个节点按权限与数据访问能力合并去重，横向为状态深度。
          </p>
        </div>
        <div class="ag-header-actions">
          <span v-if="model" class="ag-search-flag" :class="model.searchComplete ? 'ag-flag-complete' : 'ag-flag-partial'">
            {{ model.searchComplete ? '搜索完整' : '搜索触及边界' }}
          </span>
          <button class="ag-close" aria-label="关闭攻击状态空间图" @click="emit('close')">×</button>
        </div>
      </header>

      <div v-if="!model" class="ag-empty">
        <strong>还没有可绘制的状态空间</strong>
        <p>先运行一次实验；系统会把搜索到的每个 AttackState 与状态转移绘制成图。</p>
      </div>

      <template v-else>
        <div class="ag-legend">
          <span class="ag-legend-item"><i class="ag-dot ag-tone-initial"></i>初始状态</span>
          <span class="ag-legend-item"><i class="ag-dot ag-tone-controlled"></i>受控端点</span>
          <span class="ag-legend-item"><i class="ag-dot ag-tone-admin"></i>含管理员权限</span>
          <span class="ag-legend-item"><i class="ag-dot ag-tone-objective"></i>数据目标可达</span>
          <span class="ag-legend-divider"></span>
          <span v-for="technique in model.techniques" :key="technique.id" class="ag-legend-item">
            <i class="ag-line" :style="{ background: colorOf(technique.id) }"></i>{{ technique.name }}
          </span>
          <span class="ag-legend-divider"></span>
          <span class="ag-legend-item"><i class="ag-badge-dot">!</i>该状态下的阻断尝试</span>
        </div>

        <div class="ag-body">
          <div class="ag-canvas">
            <svg :width="model.width" :height="model.height" :viewBox="`0 0 ${model.width} ${model.height}`" role="img" aria-label="攻击状态转移图">
              <defs>
                <marker
                  v-for="id in model.techniqueIds"
                  :id="`ag-arrow-${id}`"
                  :key="id"
                  viewBox="0 0 10 10"
                  refX="9"
                  refY="5"
                  markerWidth="6"
                  markerHeight="6"
                  orient="auto-start-reverse"
                >
                  <path d="M1 1 L9 5 L1 9 Z" :fill="colorOf(id)" />
                </marker>
              </defs>

              <g class="ag-layer-labels">
                <text v-for="layer in layerLabels" :key="layer.depth" :x="layer.x" y="17" text-anchor="middle">深度 {{ layer.depth }}</text>
              </g>

              <g class="ag-edges">
                <path
                  v-for="edge in model.edges"
                  :key="edge.id"
                  :d="edge.path"
                  fill="none"
                  :stroke="colorOf(edge.techniqueId)"
                  :stroke-width="edgeWidth(edge.onWitness, edge.from, edge.to)"
                  :opacity="edgeOpacity(edge.from, edge.to, edge.onWitness)"
                  :marker-end="`url(#ag-arrow-${edge.techniqueId})`"
                />
              </g>

              <g
                v-for="node in model.nodes"
                :key="node.key"
                class="ag-node"
                :class="{ 'ag-node-active': activeKey === node.key, 'ag-node-witness': node.isOnWitness }"
                :data-state="node.order"
                @mouseenter="hoveredKey = node.key"
                @mouseleave="hoveredKey = null"
                @click.stop="selectNode(node.key)"
              >
                <rect
                  v-if="node.isObjective"
                  :x="node.x - 4"
                  :y="node.y - 4"
                  :width="node.width + 8"
                  :height="node.height + 8"
                  rx="12"
                  fill="none"
                  class="ag-objective-ring"
                />
                <rect :x="node.x" :y="node.y" :width="node.width" :height="node.height" rx="9" :class="`ag-tone-${node.tone}`" />
                <text class="ag-node-title" :x="node.x + 13" :y="node.y + 20">S{{ node.order }} · 受控 {{ node.controlled }}</text>
                <text class="ag-node-sub" :x="node.x + 13" :y="node.y + 36">管理员 {{ node.admin }} · 数据 {{ node.dataAccess }}</text>
                <g v-if="node.blocked.length" class="ag-node-blocks">
                  <circle :cx="node.x + node.width - 11" :cy="node.y + 11" r="8" />
                  <text :x="node.x + node.width - 11" :y="node.y + 15">{{ node.blocked.length }}</text>
                </g>
              </g>
            </svg>
          </div>

          <aside class="ag-detail">
            <template v-if="selectedNode">
              <div class="ag-detail-head">
                <span class="ag-detail-index">S{{ selectedNode.order }}</span>
                <div>
                  <strong>状态 {{ selectedNode.order }}</strong>
                  <small>深度 {{ selectedNode.depth }} · {{ selectedNode.controlled }} 个受控端点</small>
                </div>
              </div>

              <div class="ag-detail-tags">
                <span v-if="selectedNode.isInitial" class="ag-tag ag-tag-initial">实验初始状态</span>
                <span v-if="selectedNode.isObjective" class="ag-tag ag-tag-objective">数据目标已访问</span>
                <span v-if="selectedNode.isOnWitness" class="ag-tag ag-tag-witness">在代表链上</span>
              </div>

              <section class="ag-detail-section">
                <h4>受控端点</h4>
                <ul v-if="selectedNode.endpoints.length">
                  <li v-for="endpoint in selectedNode.endpoints" :key="endpoint.nodeId">
                    <span>{{ nodeName(endpoint.nodeId) }}</span>
                    <b :class="endpoint.privilege === 'ADMIN' ? 'ag-priv-admin' : 'ag-priv-user'">{{ privilegeLabel(endpoint.privilege) }}</b>
                  </li>
                </ul>
                <p v-else class="ag-detail-muted">无</p>
              </section>

              <section class="ag-detail-section">
                <h4>数据访问能力</h4>
                <ul v-if="selectedNode.dataNodeIds.length">
                  <li v-for="id in selectedNode.dataNodeIds" :key="id">
                    <span>{{ nodeName(id) }}</span><b class="ag-priv-data">DATA_ACCESS</b>
                  </li>
                </ul>
                <p v-else class="ag-detail-muted">尚未获得数据访问</p>
              </section>

              <section class="ag-detail-section">
                <h4>成功转移 · 入 {{ incoming.length }} / 出 {{ outgoing.length }}</h4>
                <ul v-if="outgoing.length" class="ag-detail-list">
                  <li v-for="edge in outgoing" :key="edge.id">
                    <i class="ag-line" :style="{ background: colorOf(edge.techniqueId) }"></i>
                    <span>{{ edge.techniqueName }}</span>
                    <small>→ {{ nodeName(edge.targetNodeId) }}</small>
                  </li>
                </ul>
                <p v-else class="ag-detail-muted">该状态没有后继成功转移</p>
              </section>

              <section v-if="selectedNode.blocked.length" class="ag-detail-section">
                <h4>此状态下的阻断尝试</h4>
                <ul class="ag-detail-blocks">
                  <li v-for="block in selectedNode.blocked" :key="block.techniqueId + block.targetNodeId">
                    <strong>{{ block.techniqueName }} → {{ nodeName(block.targetNodeId) }}</strong>
                    <p>{{ block.reason }}</p>
                  </li>
                </ul>
              </section>
            </template>

            <div v-else class="ag-detail-placeholder">
              <strong>点击任意状态节点</strong>
              <p>查看该状态下的受控端点、权限级别、数据访问能力，以及从这个状态出发被阻断的教学行为。</p>
              <div v-if="objectiveNode" class="ag-detail-hint">
                红色虚线环标记数据目标可达状态（S{{ objectiveNode.order }}）。
              </div>
            </div>
          </aside>
        </div>

        <footer class="ag-footer">
          <span v-if="model.truncated">状态数量超过 {{ model.nodes.length }} 个，已仅保留代表链；完整列表见实验分析页。</span>
          <span v-else>节点按「受控端点 + 权限 + 数据访问」合并去重，因此多条路径到达同一安全状态时只保留一个节点。</span>
          <span class="ag-footer-note">图中每条边均来自引擎的状态转移记录，未做二次推断。</span>
        </footer>
      </template>
    </div>
  </div>
</template>

<style scoped>
.ag-overlay { position: fixed; inset: 0; z-index: 220; display: grid; place-items: center; padding: 24px; background: rgba(6, 14, 22, .62); backdrop-filter: blur(4px); }
.ag-dialog { width: min(1500px, 100%); max-height: calc(100vh - 48px); display: flex; flex-direction: column; overflow: hidden; border: 1px solid var(--border-strong); border-radius: 14px; background: var(--panel-bg); box-shadow: 0 30px 90px rgba(0, 0, 0, .32); }
.ag-header { display: flex; align-items: flex-start; justify-content: space-between; gap: 24px; padding: 20px 24px 16px; border-bottom: 1px solid var(--border); }
.ag-kicker { color: var(--accent); font-size: 11px; font-weight: 700; letter-spacing: .16em; }
.ag-header-copy h2 { margin: 6px 0 6px; color: var(--text-primary); font-size: 20px; }
.ag-header-copy p { margin: 0; max-width: 780px; color: var(--text-muted); font-size: 13px; line-height: 1.7; }
.ag-header-copy b { color: var(--text-secondary); }
.ag-header-actions { display: flex; align-items: center; gap: 10px; flex: 0 0 auto; }
.ag-search-flag { padding: 5px 10px; border-radius: 999px; font-size: 12px; font-weight: 600; }
.ag-flag-complete { color: var(--success); background: color-mix(in srgb, var(--success) 14%, transparent); }
.ag-flag-partial { color: var(--warning); background: color-mix(in srgb, var(--warning) 16%, transparent); }
.ag-close { width: 34px; height: 34px; display: grid; place-items: center; border: 1px solid var(--border); border-radius: 8px; color: var(--text-secondary); background: var(--panel-raised); font-size: 20px; line-height: 1; cursor: pointer; }
.ag-close:hover { color: var(--text-primary); border-color: var(--border-strong); }
.ag-legend { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 16px; padding: 12px 24px; border-bottom: 1px solid var(--border); color: var(--text-muted); font-size: 12px; }
.ag-legend-item { display: inline-flex; align-items: center; gap: 7px; }
.ag-dot { width: 10px; height: 10px; border-radius: 3px; border: 1px solid var(--border-strong); }
.ag-line { width: 16px; height: 3px; border-radius: 2px; }
.ag-legend-divider { width: 1px; height: 14px; background: var(--border); }
.ag-badge-dot { width: 15px; height: 15px; display: grid; place-items: center; border-radius: 50%; color: #fff; background: var(--danger); font-size: 10px; font-style: normal; font-weight: 700; }
.ag-body { flex: 1; min-height: 0; display: grid; grid-template-columns: minmax(0, 1fr) 252px; }
.ag-canvas { overflow: auto; padding: 14px 18px 18px; background: color-mix(in srgb, var(--panel-raised) 60%, transparent); }
.ag-layer-labels text { fill: var(--text-muted); font-size: 10.5px; letter-spacing: .04em; }
.ag-node { cursor: pointer; }
.ag-node rect { stroke-width: 1.2; transition: filter .15s; }
.ag-node:hover rect { filter: brightness(1.06); }
.ag-node-active rect { stroke-width: 2; }
.ag-node-title { fill: var(--text-primary); font-size: 12.5px; font-weight: 600; }
.ag-node-sub { fill: var(--text-muted); font-size: 11.5px; }
.ag-tone-initial { fill: var(--panel-raised); stroke: var(--accent); }
.ag-tone-controlled { fill: color-mix(in srgb, var(--accent) 13%, var(--panel-bg)); stroke: var(--accent); }
.ag-tone-admin { fill: color-mix(in srgb, var(--warning) 15%, var(--panel-bg)); stroke: var(--warning); }
.ag-tone-objective { fill: color-mix(in srgb, var(--danger) 15%, var(--panel-bg)); stroke: var(--danger); }
.ag-objective-ring { stroke: var(--danger); stroke-width: 1.2; stroke-dasharray: 4 3; }
.ag-node-blocks circle { fill: var(--danger); }
.ag-node-blocks text { fill: #fff; font-size: 10px; font-weight: 700; text-anchor: middle; }
.ag-detail { overflow: auto; padding: 18px 20px; border-left: 1px solid var(--border); }
.ag-detail-head { display: flex; align-items: center; gap: 12px; }
.ag-detail-index { width: 40px; height: 40px; display: grid; place-items: center; border-radius: 9px; color: var(--accent); background: color-mix(in srgb, var(--accent) 12%, transparent); font-size: 13px; font-weight: 700; }
.ag-detail-head strong { display: block; color: var(--text-primary); font-size: 15px; }
.ag-detail-head small { color: var(--text-muted); font-size: 12px; }
.ag-detail-tags { display: flex; flex-wrap: wrap; gap: 6px; margin: 12px 0 4px; }
.ag-tag { padding: 4px 8px; border-radius: 5px; font-size: 11px; font-weight: 600; }
.ag-tag-initial { color: var(--accent); background: color-mix(in srgb, var(--accent) 12%, transparent); }
.ag-tag-objective { color: var(--danger); background: color-mix(in srgb, var(--danger) 12%, transparent); }
.ag-tag-witness { color: var(--success); background: color-mix(in srgb, var(--success) 12%, transparent); }
.ag-detail-section { margin-top: 18px; }
.ag-detail-section h4 { margin: 0 0 8px; color: var(--text-muted); font-size: 11.5px; font-weight: 600; letter-spacing: .04em; }
.ag-detail-section ul { margin: 0; padding: 0; list-style: none; }
.ag-detail-section li { display: flex; align-items: center; gap: 8px; padding: 6px 0; border-bottom: 1px dashed var(--border); color: var(--text-secondary); font-size: 12.5px; }
.ag-detail-section li span { flex: 1; }
.ag-detail-section li b { font-size: 11.5px; font-weight: 600; }
.ag-priv-user { color: var(--accent); }
.ag-priv-admin { color: var(--warning); }
.ag-priv-data { color: var(--danger); }
.ag-detail-list small { color: var(--text-muted); font-size: 11.5px; }
.ag-detail-blocks li { display: block; }
.ag-detail-blocks strong { display: block; color: var(--text-secondary); font-size: 12.5px; }
.ag-detail-blocks p { margin: 4px 0 0; color: var(--text-muted); font-size: 11.5px; line-height: 1.6; }
.ag-detail-muted { margin: 0; color: var(--text-muted); font-size: 12.5px; }
.ag-detail-placeholder strong { display: block; margin-bottom: 8px; color: var(--text-primary); font-size: 14px; }
.ag-detail-placeholder p { margin: 0; color: var(--text-muted); font-size: 12.5px; line-height: 1.75; }
.ag-detail-hint { margin-top: 14px; padding: 10px 12px; border-left: 2px solid var(--danger); color: var(--text-secondary); background: color-mix(in srgb, var(--danger) 8%, transparent); font-size: 12px; line-height: 1.6; }
.ag-footer { display: flex; align-items: center; justify-content: space-between; gap: 18px; padding: 10px 24px; border-top: 1px solid var(--border); color: var(--text-muted); font-size: 11.5px; }
.ag-footer-note { flex: 0 0 auto; color: var(--text-muted); opacity: .8; }
.ag-empty { padding: 64px 24px; text-align: center; }
.ag-empty strong { display: block; margin-bottom: 8px; color: var(--text-primary); font-size: 15px; }
.ag-empty p { margin: 0; color: var(--text-muted); font-size: 13px; }
@media (max-width: 1100px) {
  .ag-body { grid-template-columns: minmax(0, 1fr); }
  .ag-detail { border-left: 0; border-top: 1px solid var(--border); max-height: 260px; }
}
</style>
