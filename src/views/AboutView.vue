<script setup lang="ts">
import { RouterLink } from 'vue-router'

const painPoints = [
  { icon: '◱', title: '网络太抽象', text: '防火墙规则、路由表、传播路径都是一堆配置文本，学生很难在大脑中拼出网络全貌。' },
  { icon: '⌁', title: '风险不可视', text: '传统教学只能看到最终结论，看不到风险究竟沿着哪条边、哪一步扩散而来。' },
  { icon: '↯', title: '学习很被动', text: '单向观看与死记硬背，缺少“自己动手调策略、看结果”的主动验证过程。' },
]

const ideals = [
  { number: '01', title: '可观察', text: '3D 拓扑、事件飞行动画、时间线曲线，把抽象的传播过程变为可见。' },
  { number: '02', title: '可干预', text: '随时调整分区、防火墙规则、终端防护与隔离，立即重算结果。' },
  { number: '03', title: '可验证', text: '挑战关卡以关键资产收尾验收，防护是否有效一测便知。' },
  { number: '04', title: '可对比', text: '同一初始条件下运行 A/B 两套方案，用雷达图与差异矩阵量化差距。' },
]

const innovations = [
  { icon: '◆', title: '三维拓扑实时仿真', tag: '可视化', text: 'Three.js 管束连线、粒子特效与事件飞行，配画质三级自适应，把每次传播都渲染成可观察的过程。' },
  { icon: '⛨', title: '防守视角挑战关卡', tag: '教学法', text: '以“保护关键资产 + 保全业务路径”为目标设计挑战，失败时自动给出根因诊断与排查建议。' },
  { icon: '▤', title: '工业控制网 OT 场景', tag: '内容广度', text: '新增 SCADA/PLC 工控网独立场景：HMI 初始失陷、工控防火墙多 VLAN 隔离、Historian 关键资产。' },
  { icon: '✔', title: '双模式学习中心', tag: '学习闭环', text: '20 题题库 + 随堂自测与模拟考试，每道题作答后附本系统的可视化解析，直达对应实验页面。' },
]

const layers = [
  { name: '界面层', tech: 'Vue 3 · Vue Router · Pinia', items: ['总览 · 实验室 · 方案对比 · 分析 · 学习中心'], accent: 'violet' },
  { name: '可视化层', tech: 'Three.js (WebGL) · ECharts', items: ['3D 拓扑与特效 · 雷达图 · 热力图 · 时间线 · 仪表盘'], accent: 'teal' },
  { name: '仿真引擎层', tech: 'TypeScript 核心引擎', items: ['传播引擎 · 规则引擎 · 路由引擎 · 通信引擎 · 指标引擎'], accent: 'green' },
  { name: '数据层', tech: '场景定义 · 题库 · 本地持久化', items: ['IT 企业场景 ×5 · 工控 OT 场景 ×1 · 20 题题库 · 设置/进度存储'], accent: 'amber' },
]

const modules = [
  { path: '/', icon: '▧', name: '平台总览', desc: '作品门面：三维预览、场景入口、学习中心入口' },
  { path: '/lab', icon: '⌁', name: '三维实验室', desc: '运行仿真、调策略、看传播、挑战关键资产' },
  { path: '/compare', icon: '⇄', name: '方案对比', desc: 'A/B 同起点对照 · 五维雷达 · 差异矩阵' },
  { path: '/analysis', icon: '▥', name: '分析中心', desc: '事件时间线 · 状态分布 · 区域影响热力' },
  { path: '/learn', icon: '⛨', name: '学习中心', desc: '知识卡片 · 20 题自测 · 模拟考试与可视化解析' },
]

const compareRows = [
  { dimension: '呈现方式', traditional: '静态图 / 文字', ours: '可旋转 3D 拓扑 · 实时动画' },
  { dimension: '学习方式', traditional: '单向观看', ours: '动手干预 · 立即重算反馈' },
  { dimension: '验证手段', traditional: '背诵结论', ours: '挑战关卡 · 客观指标(可达率/阻断率)' },
  { dimension: '对比实验', traditional: '难以复现', ours: '同起点 A/B 对照 · 雷达图差异矩阵' },
  { dimension: '门槛与安全', traditional: 'CTF 偏向攻击、门槛高', ours: '防守视角 · 教学抽象仿真 · 零真实流量' },
]
</script>

<template>
  <div class="content-page about-page">
    <section class="about-hero"><div class="about-hero-copy"><div class="breadcrumb">作品中心 <span>/</span> 关于作品</div><div class="eyebrow"><span class="eyebrow-line"></span> ABOUT THE PROJECT</div><h1>读懂每一跳传播，<br /><span>验证每一次防御</span></h1><p>「智御网络」是一个面向安全教学的 3D 网络策略仿真平台：以可视化拓扑承载仿真引擎，让抽象的策略关键词变成看得见、改得动、验得出的实验。</p><div class="about-hero-meta"><span><i>3D</i> WebGL 实时渲染</span><span><i>TS</i> 类型安全引擎</span><span><i>v1.0</i> 当前版本</span></div><div class="about-hero-actions"><RouterLink to="/lab" class="button-primary">进入实验室 <span class="arrow">→</span></RouterLink><RouterLink to="/learn" class="about-quiet-link">先去学习中心了解概念 <span>↗</span></RouterLink></div></div><div class="about-hero-stack"><div class="about-stack-core"><span>智御网络</span><i>ENGINE</i><i>SIM</i><i>3D</i><i>EDU</i></div><div class="about-stack-ring ring-a"></div><div class="about-stack-ring ring-b"></div><div class="about-stack-node n1">▧<small>VIEW</small></div><div class="about-stack-node n2">⌁<small>SIM</small></div><div class="about-stack-node n3">⛨<small>DEFEND</small></div><div class="about-stack-node n4">⇄<small>COMPARE</small></div><div class="about-stack-caption">3D VISUAL SIMULATION<br /><b>SECURITY LEARNING LAB</b></div></div></section>

    <section class="about-section"><div class="section-heading"><div><span class="section-kicker">WHY WE BUILD</span><h2>背景与痛点</h2></div><p>网络安全的难点不在概念，而在“看不到过程”。</p></div><div class="about-pain-grid"><article v-for="item in painPoints" :key="item.title" class="about-pain-card"><span class="about-pain-icon">{{ item.icon }}</span><h3>{{ item.title }}</h3><p>{{ item.text }}</p></article></div></section>

    <section class="about-section"><div class="section-heading"><div><span class="section-kicker">DESIGN PHILOSOPHY</span><h2>设计理念</h2></div><p>四个关键词贯穿全部功能。</p></div><div class="about-ideal-grid"><article v-for="item in ideals" :key="item.number" class="about-ideal-card"><span class="about-ideal-number">{{ item.number }}</span><h3>{{ item.title }}</h3><p>{{ item.text }}</p></article></div></section>

    <section class="about-section"><div class="section-heading"><div><span class="section-kicker">INNOVATIONS</span><h2>创新点</h2></div><p>四个方向共同构成作品的差异化。</p></div><div class="about-innov-grid"><article v-for="item in innovations" :key="item.title" class="about-innov-card"><div class="about-innov-top"><span class="about-innov-icon">{{ item.icon }}</span><span class="about-innov-tag">{{ item.tag }}</span></div><h3>{{ item.title }}</h3><p>{{ item.text }}</p></article></div></section>

    <section class="about-section"><div class="section-heading"><div><span class="section-kicker">TECHNICAL ARCHITECTURE</span><h2>技术架构</h2></div><p>四层解耦，数据 → 引擎 → 可视化 → 界面。</p></div><div class="about-layer-stack"><div v-for="(layer, index) in layers" :key="layer.name" class="about-layer" :class="`layer-${layer.accent}`"><span class="about-layer-index">L{{ layers.length - index }}</span><div class="about-layer-copy"><strong>{{ layer.name }}</strong><small>{{ layer.tech }}</small><span>{{ layer.items }}</span></div></div></div></section>

    <section class="about-section"><div class="section-heading"><div><span class="section-kicker">MODULES</span><h2>功能导览</h2></div><p>五个模块串联完整的教学闭环。</p></div><div class="about-module-list"><RouterLink v-for="(item, index) in modules" :key="item.path" :to="item.path" class="about-module-row"><span class="about-module-number">{{ String(index + 1).padStart(2, '0') }}</span><span class="about-module-icon">{{ item.icon }}</span><div class="about-module-copy"><strong>{{ item.name }}</strong><small>{{ item.desc }}</small></div><span class="about-module-go">进入 <span>→</span></span></RouterLink></div></section>

    <section class="about-section"><div class="section-heading"><div><span class="section-kicker">COMPARISON</span><h2>与同类教学方式对比</h2></div><p>为什么需要一台“看得见的实验室”。</p></div><div class="about-compare panel-surface"><div class="about-compare-head"><span class="about-compare-col-dim">对比维度</span><span class="about-compare-col-traditional">传统教学 / CTF</span><span class="about-compare-col-ours">智御网络</span></div><div v-for="row in compareRows" :key="row.dimension" class="about-compare-row"><span class="about-compare-col-dim">{{ row.dimension }}</span><span class="about-compare-col-traditional">{{ row.traditional }}</span><span class="about-compare-col-ours">{{ row.ours }}</span></div></div></section>

    <section class="about-disclaimer"><span>i</span><p>本作品所有场景均为教学型抽象仿真：不连接真实网络、不执行扫描或攻击行为，所有节点与事件均为参数化模型数据。</p></section>
    <footer class="home-footer"><span>智御网络 · 让网络安全知识可观察、可干预、可验证</span><span>ABOUT <i></i> EXPERIMENT <i></i> VERIFY</span></footer>
  </div>
</template>