<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import ChartPanel from '../components/charts/ChartPanel.vue'
import QuizExam from '../components/QuizExam.vue'
import { quizQuestions } from '../data/quizData'
import { scenarios } from '../data/scenarios'
import { useScenarioStore } from '../stores/scenario'
import { useSimulationStore } from '../stores/simulation'
import { useLearningProgress } from '../composables/useLearningProgress'

const router = useRouter()
const scenarioStore = useScenarioStore()
const simulationStore = useSimulationStore()
const progress = useLearningProgress()
const concepts = [
  { icon: '▧', number: '01', title: '网络分区', tag: '架构设计', text: '把办公、应用与数据资源划分到不同区域，限制风险跨区扩散。', scenario: 'segmentation', accent: 'violet' },
  { icon: '▤', number: '02', title: '防火墙', tag: '访问控制', text: '根据来源区域、目标区域和服务类型判断连接是否允许。', scenario: 'firewall', accent: 'blue' },
  { icon: '⛨', number: '03', title: '终端防护', tag: '端点安全', text: '通过教学防护模型，观察受保护终端如何改变传播结果。', scenario: 'lateral', accent: 'green' },
  { icon: '◆', number: '04', title: '关键资产', tag: '资产治理', text: '识别需要重点保护的服务器与数据节点，跟踪其最终状态。', scenario: 'lateral', accent: 'amber' },
  { icon: '⌁', number: '05', title: '横向传播', tag: '风险路径', text: '从初始受影响终端出发，沿网络关系观察风险触达范围。', scenario: 'lateral', accent: 'coral' },
  { icon: '⇥', number: '06', title: '最小权限', tag: '策略原则', text: '只开放必要的业务路径，让合法访问可用、非必要访问受限。', scenario: 'segmentation', accent: 'cyan' },
]

const learningScenarios = scenarios.map((scenario, index) => ({ ...scenario, number: `0${index + 1}` }))

const examMode = ref(false)

const quizAnswers = ref<Record<number, number>>({ ...progress.state.value.practiceAnswers })
const quizAnsweredCount = computed(() => Object.keys(quizAnswers.value).length)
const quizCorrectCount = computed(() => quizQuestions.filter((question) => quizAnswers.value[question.id] === question.correctIndex).length)
const quizProgress = computed(() => Math.round((quizAnsweredCount.value / quizQuestions.length) * 100))
const quizDone = computed(() => quizAnsweredCount.value === quizQuestions.length)

function answerQuestion(id: number, optionIndex: number) {
  if (quizAnswers.value[id] !== undefined) return
  quizAnswers.value = { ...quizAnswers.value, [id]: optionIndex }
  const question = quizQuestions.find((q) => q.id === id)
  if (question) progress.recordPracticeAnswer(id, optionIndex)
}

function resetQuiz() {
  quizAnswers.value = {}
}

function onExamFinished(score: number) {
  progress.recordExamScore(score)
}

function enter(id: string) {
  scenarioStore.selectScenario(id)
  simulationStore.reset()
  router.push('/lab')
}
</script>

<template>
  <div class="content-page learn-page">
    <section class="learn-hero"><div class="learn-hero-copy"><div class="breadcrumb">仿真工作台 <span>/</span> 学习中心</div><div class="eyebrow"><span class="eyebrow-line"></span> LEARNING CENTER</div><h1>从概念开始，<br /><span>在场景中验证</span></h1><p>用短小的知识卡片了解关键安全概念，再进入三维实验观察策略如何影响网络事件。</p><div class="learn-hero-meta"><span><i></i>6 个知识模块</span><span><i></i>20 道题库自测</span><span><i></i>06 个交互实验</span></div></div><div class="learn-hero-visual"><div class="learn-orbit orbit-one"></div><div class="learn-orbit orbit-two"></div><div class="learn-core"><span>SEC</span><i></i><i></i><i></i></div><div class="learn-orbit-node learn-node-a">⛨<small>DEFEND</small></div><div class="learn-orbit-node learn-node-b">⌁<small>OBSERVE</small></div><div class="learn-orbit-node learn-node-c">⇄<small>COMPARE</small></div><div class="learn-visual-caption">NETWORK SECURITY<br /><b>LEARNING PATH</b></div></div></section>

    <section class="learning-path panel-surface"><div class="path-heading"><div><span class="section-kicker">YOUR LEARNING PATH</span><h2>建议学习路径</h2></div><div class="path-heading-right"><span class="path-estimate">约 20 分钟 <i>·</i> 3 个阶段</span><a href="#quiz" class="path-quiz-link">前往随堂自测 <span>↘</span></a></div></div><div class="path-steps"><div class="path-step"><span class="path-step-number">01</span><div><strong>认识网络结构</strong><small>从三维拓扑理解节点、区域与连接</small></div><i></i></div><div class="path-connector"></div><div class="path-step"><span class="path-step-number">02</span><div><strong>观察风险事件</strong><small>跟随事件时间线追踪传播路径</small></div><i></i></div><div class="path-connector"></div><div class="path-step"><span class="path-step-number">03</span><div><strong>调整策略并验证</strong><small>运行 A/B 对照，比较防御与业务效果</small></div><i></i></div></div></section>

    <section class="learning-modules-section"><div class="section-heading"><div><span class="section-kicker">CORE CONCEPTS</span><h2>核心知识模块</h2></div><p>每张卡片对应一个可操作的实验，<br />把概念放回真实的网络关系里。</p></div><div class="concept-grid"><article v-for="item in concepts" :key="item.number" class="concept-card" :class="`concept-${item.accent}`"><div class="concept-top"><span class="concept-icon">{{ item.icon }}</span><span class="concept-number">{{ item.number }}</span></div><div class="concept-tag">{{ item.tag }}</div><h3>{{ item.title }}</h3><p>{{ item.text }}</p><button @click="enter(item.scenario)">进入关联实验 <span>→</span></button></article></div></section>

    <section id="quiz" class="quiz-section"><div class="section-heading quiz-heading"><div><span class="section-kicker">KNOWLEDGE CHECK</span><h2>随堂自测 · 20 题题库</h2><p>选择「随堂练习」获得即时反馈，或进入「模拟考试」交卷评分；每道题作答后都会附上本系统的可视化解析。</p></div><div class="quiz-heading-right"><div class="quiz-mode-tabs"><button :class="{ active: !examMode }" @click="examMode = false">随堂练习</button><button :class="{ active: examMode }" @click="examMode = true">模拟考试</button></div><div v-if="!examMode" class="quiz-score-panel"><div class="quiz-score-ring" :style="{ '--p': `${quizProgress * 3.6}deg` }"><span>{{ quizProgress }}</span><small>%</small></div><div class="quiz-score-copy"><strong>{{ quizCorrectCount }} / {{ quizAnsweredCount }} 正确</strong><small>已答 {{ quizAnsweredCount }} / {{ quizQuestions.length }} · 正确 {{ quizCorrectCount }} 题</small><button v-if="quizAnsweredCount > 0" @click="resetQuiz">重新挑战 ↺</button></div></div></div></div><div v-show="!examMode" class="quiz-progress-bar"><i :style="{ width: `${quizProgress}%` }"></i></div><div v-show="!examMode" class="quiz-grid"><article v-for="(q, qi) in quizQuestions" :key="q.id" class="quiz-card" :class="{ 'quiz-correct': quizAnswers[q.id] !== undefined && quizAnswers[q.id] === q.correctIndex, 'quiz-wrong': quizAnswers[q.id] !== undefined && quizAnswers[q.id] !== q.correctIndex }"><div class="quiz-card-head"><span class="quiz-card-no">Q{{ String(qi + 1).padStart(2, '0') }}</span><span class="quiz-card-tag">{{ q.category }}</span><span v-if="quizAnswers[q.id] !== undefined" class="quiz-card-state">{{ quizAnswers[q.id] === q.correctIndex ? '✓ 回答正确' : '✕ 回答错误' }}</span></div><h3 class="quiz-question">{{ q.question }}</h3><div class="quiz-options"><button v-for="(opt, oi) in q.options" :key="oi" class="quiz-option" :class="{ 'quiz-option-selected': quizAnswers[q.id] === oi, 'quiz-option-correct': quizAnswers[q.id] !== undefined && oi === q.correctIndex, 'quiz-option-wrong': quizAnswers[q.id] === oi && oi !== q.correctIndex, 'quiz-option-dimmed': quizAnswers[q.id] !== undefined && oi !== q.correctIndex && oi !== quizAnswers[q.id] }" :disabled="quizAnswers[q.id] !== undefined" @click="answerQuestion(q.id, oi)"><span class="quiz-option-letter">{{ String.fromCharCode(65 + oi) }}</span><span class="quiz-option-text">{{ opt }}</span><span v-if="quizAnswers[q.id] !== undefined && oi === q.correctIndex" class="quiz-option-mark">✓</span></button></div><div v-if="quizAnswers[q.id] !== undefined" class="quiz-feedback"><span class="quiz-feedback-icon">{{ quizAnswers[q.id] === q.correctIndex ? '✓' : '✕' }}</span><p><strong>{{ quizAnswers[q.id] === q.correctIndex ? '解答正确：' : `正确答案 ${String.fromCharCode(65 + q.correctIndex)} · ` }}</strong>{{ q.explain }}</p></div><div v-if="quizAnswers[q.id] !== undefined" class="quiz-visualise"><div class="quiz-visualise-head"><span class="quiz-visualise-icon">▤</span><strong>{{ q.visual.title }}</strong><RouterLink :to="q.visual.linkPath" class="quiz-visualise-link">在系统中查看 <span>↗</span></RouterLink></div><ChartPanel :option="q.visual.option" height="150px" /><p class="quiz-visualise-caption">{{ q.visual.caption }}</p></div></article></div><div v-if="!examMode && quizDone" class="quiz-done-banner"><span>{{ quizCorrectCount === quizQuestions.length ? '✔' : '△' }}</span><p v-if="quizCorrectCount === quizQuestions.length">满分完成！全部知识点已掌握，现在进入实验场景进行实战验证吧。</p><p v-else>已答完全部题目：正确 {{ quizCorrectCount }} / {{ quizQuestions.length }} 题。回顾错题解析后可重新挑战，再进入场景实践。</p><button @click="resetQuiz">重新挑战</button></div><div v-show="examMode" class="quiz-exam-host"><QuizExam :questions="quizQuestions" @exam-finished="onExamFinished" /></div></section>

    <section class="learning-experiments"><div class="section-heading"><div><span class="section-kicker">HANDS-ON LABS</span><h2>六个实验，逐步建立安全思维</h2></div><RouterLink to="/lab" class="section-link">打开三维实验室 <span>↗</span></RouterLink></div><div class="learning-experiment-list"><article v-for="item in learningScenarios" :key="item.id" class="learning-experiment-row"><span class="experiment-row-number">{{ item.number }}</span><span class="experiment-row-icon">{{ item.id === 'lateral' ? '⌁' : item.id === 'firewall' ? '▤' : item.id === 'supply-chain' ? '⇄' : item.id === 'ransomware' ? '⛨' : item.id === 'industrial' ? '▧' : '▥' }}</span><div class="experiment-row-copy"><div><span class="scenario-level">{{ item.difficulty }}</span><span class="experiment-row-duration">{{ item.duration }}</span></div><h3>{{ item.name }}</h3><p>{{ item.learningObjectives.join(' · ') }}</p></div><button class="experiment-row-button" @click="enter(item.id)">进入实验 <span>↗</span></button></article></div></section>
    <section class="learning-disclaimer"><span>i</span><p>本学习中心中的网络事件均为教学型抽象仿真，不会连接真实网络，也不会执行扫描或攻击行为。</p><RouterLink to="/">返回平台总览 →</RouterLink></section>
    <footer class="home-footer"><span>智御网络 · 让网络安全知识可观察、可干预、可验证</span><span>LEARN <i></i> EXPERIMENT <i></i> VERIFY</span></footer>
  </div>
</template>
