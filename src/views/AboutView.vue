<script setup lang="ts">
import { RouterLink } from 'vue-router'

const architecture = [
  { name: '网络语义层', keywords: '节点 · VLAN · 路由' },
  { name: '安全策略层', keywords: 'Firewall · 通信判定 · 安全控制' },
  { name: '攻击状态层', keywords: '权限状态 · 教学行为 · 代表链' },
  { name: '策略验证层', keywords: '挑战条件 · 必要业务 · A/B 对照' },
  { name: '三维交互层', keywords: 'Three.js · 事件路径 · 结果回看' },
]

const capabilities = ['可观察网络路径', '可修改安全策略', '可解释状态变化', '可比较验证结果']
</script>

<template>
  <div class="content-page about-final-page">
    <section class="about-final-hero">
      <span class="about-final-kicker">作品介绍</span>
      <h1>智御网络</h1>
      <p class="about-final-subtitle">面向网络安全教育的三维交互式策略验证平台</p>
      <p class="about-final-description">将抽象的网络拓扑、访问策略与教学攻击状态转化为可观察、可干预、可验证的实验过程。</p>
      <div class="about-final-actions"><RouterLink to="/lab" class="button-primary">进入核心实验 <span class="arrow">→</span></RouterLink><RouterLink to="/learn" class="about-final-link">学习内容与练习 <span>↗</span></RouterLink></div>
    </section>

    <section class="about-final-section">
      <div class="about-final-heading"><span>平台解决的问题</span><h2>从配置文本走向可观察验证</h2></div>
      <p>学习者可以查看网络通信路径、修改安全控制，再根据模型产生的事件和结果判断策略效果。</p>
      <div class="about-final-capabilities"><span v-for="item in capabilities" :key="item"><i>✓</i>{{ item }}</span></div>
    </section>

    <section class="about-final-section">
      <div class="about-final-heading"><span>核心架构</span><h2>五层串联策略验证过程</h2></div>
      <ol class="about-final-architecture"><li v-for="(layer, index) in architecture" :key="layer.name"><span>{{ String(index + 1).padStart(2, '0') }}</span><strong>{{ layer.name }}</strong><small>{{ layer.keywords }}</small><i v-if="index < architecture.length - 1">↓</i></li></ol>
    </section>

    <section class="about-final-boundary"><span>模型边界</span><p>本系统采用教学型抽象网络安全模型，不等同于真实网络中的漏洞利用、恶意代码执行或网络风险预测。核心实验使用教学攻击状态转移；扩展实验保留各自的教学传播模型。</p></section>
  </div>
</template>

<style scoped>
.about-final-page { max-width:1120px; margin:0 auto; padding-top:42px; }
.about-final-hero { padding:38px 42px 42px; border-left:3px solid var(--accent); background:linear-gradient(100deg,color-mix(in srgb,var(--accent) 7%,var(--panel-bg)),transparent 85%); }
.about-final-kicker,.about-final-heading>span,.about-final-boundary>span { color:var(--accent); font-size:14px; font-weight:650; }
.about-final-hero h1 { margin:14px 0 6px; color:var(--text-primary); font-size:48px; letter-spacing:-.04em; }
.about-final-subtitle { margin:0; color:var(--text-secondary); font-size:20px; }
.about-final-description { max-width:780px; margin:17px 0 0; color:var(--text-muted); font-size:16px; line-height:1.75; }
.about-final-actions { margin-top:25px; display:flex; align-items:center; gap:22px; }.about-final-link { color:var(--text-secondary); font-size:15px; }.about-final-link span { color:var(--accent); }
.about-final-section { padding:35px 4px 0; }.about-final-heading h2 { margin:7px 0 0; color:var(--text-primary); font-size:22px; }.about-final-section>p { margin:12px 0 17px; color:var(--text-secondary); font-size:15px; line-height:1.65; }
.about-final-capabilities { display:flex; flex-wrap:wrap; gap:20px; padding:14px 0; border-block:1px solid var(--border); }.about-final-capabilities span { display:flex; align-items:center; gap:8px; color:var(--text-secondary); font-size:15px; }.about-final-capabilities i { color:var(--success); font-style:normal; }
.about-final-architecture { margin:15px 0 0; padding:0; display:grid; grid-template-columns:repeat(5,minmax(0,1fr)); list-style:none; }.about-final-architecture li { min-height:118px; position:relative; padding:17px 16px 15px; display:flex; flex-direction:column; gap:9px; border-top:1px solid var(--border-strong); }.about-final-architecture li>span { color:var(--accent); font:12px 'DM Mono',monospace; }.about-final-architecture strong { color:var(--text-primary); font-size:16px; }.about-final-architecture small { color:var(--text-muted); font-size:13px; line-height:1.5; }.about-final-architecture li>i { position:absolute; top:13px; right:-8px; z-index:1; color:var(--accent); font-size:17px; font-style:normal; }
.about-final-boundary { margin-top:24px; padding:17px 20px; border:1px solid var(--border); border-radius:8px; background:var(--panel-bg); }.about-final-boundary p { margin:7px 0 0; color:var(--text-muted); font-size:14px; line-height:1.65; }
@media(max-width:900px) { .about-final-architecture { grid-template-columns:1fr; }.about-final-architecture li { min-height:76px; }.about-final-architecture li>i { top:auto; right:20px; bottom:-6px; transform:rotate(90deg); } }
</style>
