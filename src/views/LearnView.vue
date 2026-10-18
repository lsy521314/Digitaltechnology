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
  { icon: '▤', number: '02', title: '防火墙', tag: '访问控制', text: '根据来源、目标和服务类型判断通信是否允许。', scenario: 'firewall', accent: 'blue' },
  { icon: '⛨', number: '03', title: '终端防护', tag: '端点安全', text: '通过教学防护模型观察安全控制如何影响状态变化。', scenario: 'lateral', accent: 'green' },
  { icon: '◆', number: '04', title: '关键资产', tag: '资产治理', text: '跟踪重点主机和数据目标在实验中的最终状态。', scenario: 'lateral', accent: 'amber' },
  { icon: '⌁', number: '05', title: '横向传播', tag: '风险路径', text: '从初始状态出发，观察教学行为如何满足前置条件。', scenario: 'lateral', accent: 'coral' },
  { icon: '⇥', number: '06', title: '最小权限', tag: '策略原则', text: '在保持必要业务可用的同时限制不必要访问。', scenario: 'segmentation', accent: 'cyan' },
]
const learningScenarios = scenarios.map((scenario, index) => ({ ...scenario, number: `0${index + 1}` }))
const examMode = ref(false)
const quizAnswers = ref<Record<number, number>>({ ...progress.state.value.practiceAnswers })
const quizAnsweredCount = computed(() => Object.keys(quizAnswers.value).length)
const quizCorrectCount = computed(() => quizQuestions.filter((question) => quizAnswers.value[question.id] === question.correctIndex).length)
const quizProgress = computed(() => Math.round((quizAnsweredCount.value / quizQuestions.length) * 100))
const quizDone = computed(() => quizAnsweredCount.value === quizQuestions.length)
const examAttemptCount = computed(() => progress.state.value.examScores.length)
const examBestScore = computed(() => progress.state.value.bestExamScore)

function answerQuestion(id: number, optionIndex: number) {
  if (quizAnswers.value[id] !== undefined) return
  quizAnswers.value = { ...quizAnswers.value, [id]: optionIndex }
  const question = quizQuestions.find((item) => item.id === id)
  if (question) progress.recordPracticeAnswer(id, optionIndex, question.correctIndex === optionIndex)
}
function resetQuiz() { quizAnswers.value = {} }
function onExamFinished(score: number) { progress.recordExamScore(score) }
function enter(id: string) {
  scenarioStore.selectScenario(id)
  simulationStore.reset()
  router.push('/lab')
}
</script>

<template>
  <div class="content-page learn-page learn-final-page">
    <section class="learn-hero learn-final-hero">
      <div class="learn-hero-copy"><div class="eyebrow">学习中心</div><h1>从概念开始，<br /><span>在场景中验证</span></h1><p>用知识卡片建立基础，再通过三维实验观察策略如何影响网络事件。</p></div>
      <div class="learn-final-visual"><span>LEARN</span><i></i><b>→</b><strong>VERIFY</strong></div>
    </section>

    <section class="learn-progress-overview" aria-label="学习进度概览">
      <div><span>知识内容</span><strong>06 <small>个模块</small></strong></div>
      <div><span>随堂练习</span><strong>{{ quizAnsweredCount }} <small>/ {{ quizQuestions.length }} 题</small></strong></div>
      <div><span>练习进度</span><strong>{{ quizProgress }}<small>%</small></strong></div>
      <div><span>模拟考试</span><strong>{{ examAttemptCount ? `${examBestScore} 分` : '未参加' }}</strong></div>
    </section>

    <section class="learning-modules-section learn-final-modules">
      <div class="section-heading"><div><span class="section-kicker">CORE CONCEPTS</span><h2>核心知识模块</h2></div><p>每张卡片对应一个可操作的教学实验。</p></div>
      <div class="concept-grid"><article v-for="item in concepts" :key="item.number" class="concept-card" :class="`concept-${item.accent}`"><div class="concept-top"><span class="concept-icon">{{ item.icon }}</span><span class="concept-number">{{ item.number }}</span></div><div class="concept-tag">{{ item.tag }}</div><h3>{{ item.title }}</h3><p>{{ item.text }}</p><button @click="enter(item.scenario)">进入关联实验 <span>→</span></button></article></div>
    </section>

    <details id="quiz" class="learn-exercise-disclosure">
      <summary><span><strong>练习与测评</strong><small>20 道随堂练习 · 模拟考试 · 本地记录</small></span><b>{{ quizAnsweredCount }}/{{ quizQuestions.length }} 已答 <i>⌄</i></b></summary>
      <section class="quiz-section learn-final-quiz">
        <div class="section-heading quiz-heading"><div><h2>随堂练习 · 20 题题库</h2><p>作答后查看知识解析；模拟考试提交后显示评分。</p><small class="static-chart-note">题目附图为静态教学示意，不读取当前实验结果。</small></div><div class="quiz-heading-right"><div class="quiz-mode-tabs"><button :class="{ active: !examMode }" @click="examMode = false">随堂练习</button><button :class="{ active: examMode }" @click="examMode = true">模拟考试</button></div><div v-if="!examMode" class="quiz-score-panel"><div class="quiz-score-ring" :style="{ '--p': `${quizProgress * 3.6}deg` }"><span>{{ quizProgress }}</span><small>%</small></div><div class="quiz-score-copy"><strong>{{ quizCorrectCount }} / {{ quizAnsweredCount }} 正确</strong><small>已答 {{ quizAnsweredCount }} / {{ quizQuestions.length }} 题</small><button v-if="quizAnsweredCount > 0" @click="resetQuiz">重置本次答题视图 ↺</button></div></div></div></div>
        <div v-show="!examMode" class="quiz-progress-bar"><i :style="{ width: `${quizProgress}%` }"></i></div>
        <div v-show="!examMode" class="quiz-grid"><article v-for="(q, qi) in quizQuestions" :key="q.id" class="quiz-card" :class="{ 'quiz-correct': quizAnswers[q.id] !== undefined && quizAnswers[q.id] === q.correctIndex, 'quiz-wrong': quizAnswers[q.id] !== undefined && quizAnswers[q.id] !== q.correctIndex }"><div class="quiz-card-head"><span class="quiz-card-no">Q{{ String(qi + 1).padStart(2, '0') }}</span><span class="quiz-card-tag">{{ q.category }}</span><span v-if="quizAnswers[q.id] !== undefined" class="quiz-card-state">{{ quizAnswers[q.id] === q.correctIndex ? '✓ 回答正确' : '✕ 回答错误' }}</span></div><h3 class="quiz-question">{{ q.question }}</h3><div class="quiz-options"><button v-for="(opt, oi) in q.options" :key="oi" class="quiz-option" :class="{ 'quiz-option-selected': quizAnswers[q.id] === oi, 'quiz-option-correct': quizAnswers[q.id] !== undefined && oi === q.correctIndex, 'quiz-option-wrong': quizAnswers[q.id] === oi && oi !== q.correctIndex, 'quiz-option-dimmed': quizAnswers[q.id] !== undefined && oi !== q.correctIndex && oi !== quizAnswers[q.id] }" :disabled="quizAnswers[q.id] !== undefined" @click="answerQuestion(q.id, oi)"><span class="quiz-option-letter">{{ String.fromCharCode(65 + oi) }}</span><span class="quiz-option-text">{{ opt }}</span><span v-if="quizAnswers[q.id] !== undefined && oi === q.correctIndex" class="quiz-option-mark">✓</span></button></div><div v-if="quizAnswers[q.id] !== undefined" class="quiz-feedback"><span class="quiz-feedback-icon">{{ quizAnswers[q.id] === q.correctIndex ? '✓' : '✕' }}</span><p><strong>{{ quizAnswers[q.id] === q.correctIndex ? '解答正确：' : `正确答案 ${String.fromCharCode(65 + q.correctIndex)} · ` }}</strong>{{ q.explain }}</p></div><div v-if="quizAnswers[q.id] !== undefined" class="quiz-visualise"><div class="quiz-visualise-head"><span class="quiz-visualise-icon">▤</span><strong>{{ q.visual.title }}</strong><span class="quiz-static-tag">静态示意</span><RouterLink :to="q.visual.linkPath" class="quiz-visualise-link">在系统中查看 <span>↗</span></RouterLink></div><ChartPanel :option="q.visual.option" height="150px" /><p class="quiz-visualise-caption">题库预设静态示意，用于辅助理解“{{ q.category }}”相关概念；不读取当前场景或仿真结果。</p></div></article></div>
        <div v-if="!examMode && quizDone" class="quiz-done-banner"><span>{{ quizCorrectCount === quizQuestions.length ? '✔' : '△' }}</span><p>{{ quizCorrectCount === quizQuestions.length ? '全部答对。可以进入核心实验验证策略效果。' : `已完成全部题目：正确 ${quizCorrectCount} / ${quizQuestions.length} 题。` }}</p><button @click="resetQuiz">重新练习</button></div>
        <div v-show="examMode" class="quiz-exam-host"><QuizExam :questions="quizQuestions" @exam-finished="onExamFinished" /></div>
      </section>
    </details>

    <details class="learn-extra-scenarios">
      <summary><span><strong>扩展实验</strong><small>其他教学场景仍可从这里进入</small></span><b>{{ learningScenarios.length }} 个场景 <i>⌄</i></b></summary>
      <div class="learning-experiment-list"><article v-for="item in learningScenarios" :key="item.id" class="learning-experiment-row"><span class="experiment-row-number">{{ item.number }}</span><span class="experiment-row-icon">{{ item.id === 'lateral' ? '⌁' : item.id === 'firewall' ? '▤' : item.id === 'supply-chain' ? '⇄' : item.id === 'ransomware' ? '⛨' : item.id === 'industrial-ics' ? '▧' : '▥' }}</span><div class="experiment-row-copy"><div><span class="scenario-level">{{ item.difficulty }}</span><span class="experiment-row-duration">{{ item.duration }}</span></div><h3>{{ item.name }}</h3><p>{{ item.learningObjectives.join(' · ') }}</p></div><button class="experiment-row-button" @click="enter(item.id)">进入实验 <span>↗</span></button></article></div>
    </details>
    <section class="learning-disclaimer"><span>i</span><p>学习中心中的图表为静态教学示意；实际实验结果以三维实验室和方案对比页面为准。</p><RouterLink to="/">返回总览 →</RouterLink></section>
  </div>
</template>

<style scoped>
.learn-final-page { max-width:1240px; margin:0 auto; }
.learn-final-hero { min-height:260px; padding:33px 38px; grid-template-columns:1fr 300px; background:linear-gradient(110deg,var(--panel-bg),color-mix(in srgb,var(--accent) 7%,var(--panel-bg))); }
.learn-final-hero .learn-hero-copy h1 { margin:10px 0; color:var(--text-primary); font-size:34px; }.learn-final-hero .learn-hero-copy>p { max-width:620px; color:var(--text-secondary); font-size:15px; }
.learn-final-visual { width:250px; height:170px; justify-self:center; display:flex; align-items:center; justify-content:center; gap:9px; color:var(--accent); }.learn-final-visual span,.learn-final-visual strong { font:600 13px 'DM Mono',monospace; letter-spacing:.08em; }.learn-final-visual i { width:60px; height:1px; background:linear-gradient(90deg,transparent,var(--accent)); }.learn-final-visual b { color:var(--text-muted); font-weight:400; }.learn-final-visual strong { color:var(--success); }
.learn-progress-overview { margin-top:18px; padding:18px 20px; display:grid; grid-template-columns:repeat(4,1fr); border-block:1px solid var(--border); }.learn-progress-overview>div { padding:2px 18px; display:flex; flex-direction:column; gap:7px; }.learn-progress-overview>div+div { border-left:1px solid var(--border); }.learn-progress-overview span { color:var(--text-muted); font-size:13px; }.learn-progress-overview strong { color:var(--text-primary); font-size:20px; }.learn-progress-overview small { color:var(--text-secondary); font-size:13px; font-weight:500; }
.learn-final-modules { padding-top:31px; }.learn-final-modules .section-heading { margin-bottom:16px; }.learn-final-modules .section-heading h2 { color:var(--text-primary); font-size:21px; }.learn-final-modules .section-heading p { color:var(--text-muted); font-size:14px; }
.learn-final-modules .concept-card { min-height:188px; background:var(--panel-bg); }.learn-final-modules .concept-tag { font-size:13px; font-weight:600; line-height:1.4; letter-spacing:0; }.learn-final-modules .concept-card h3 { margin:6px 0; color:var(--text-primary); font-size:18px; }.learn-final-modules .concept-card p { min-height:44px; color:var(--text-secondary); font-size:14px; line-height:1.55; }.learn-final-modules .concept-card button { font-size:14px; }
.learn-final-modules .concept-number { font-size:12px; }
.learn-exercise-disclosure,.learn-extra-scenarios { margin-top:17px; border:1px solid var(--border); border-radius:9px; background:var(--panel-bg); }.learn-exercise-disclosure>summary,.learn-extra-scenarios>summary { min-height:68px; padding:10px 18px; display:flex; align-items:center; justify-content:space-between; gap:16px; cursor:pointer; list-style:none; }.learn-exercise-disclosure>summary::-webkit-details-marker,.learn-extra-scenarios>summary::-webkit-details-marker { display:none; }.learn-exercise-disclosure>summary>span,.learn-extra-scenarios>summary>span { display:flex; flex-direction:column; gap:4px; }.learn-exercise-disclosure summary strong,.learn-extra-scenarios summary strong { color:var(--text-primary); font-size:17px; }.learn-exercise-disclosure summary small,.learn-extra-scenarios summary small { color:var(--text-muted); font-size:13px; }.learn-exercise-disclosure summary>b,.learn-extra-scenarios summary>b { color:var(--text-secondary); font-size:13px; font-weight:500; }.learn-exercise-disclosure summary>b i,.learn-extra-scenarios summary>b i { margin-left:8px; color:var(--accent); font-size:17px; font-style:normal; }.learn-exercise-disclosure[open]>summary,.learn-extra-scenarios[open]>summary { border-bottom:1px solid var(--border); }
.learn-final-quiz { padding:20px; }.learn-final-quiz .section-heading { margin:0 0 16px; }.learn-final-quiz .section-heading h2 { margin:0; color:var(--text-primary); font-size:19px; }.learn-final-quiz .section-heading p { font-size:14px; }.static-chart-note { display:block; margin-top:8px; color:var(--text-muted); font-size:14px; }.quiz-static-tag { padding:3px 6px; border-radius:4px; color:var(--text-muted); background:var(--panel-raised); font-size:12px; }.quiz-visualise-head { gap:8px; }.quiz-visualise-link { margin-left:auto; }
.learn-final-quiz .quiz-question { min-height:0; color:var(--text-primary); font-size:16px; line-height:1.5; }.learn-final-quiz .quiz-card-tag,.learn-final-quiz .quiz-card-state { font-size:13px; }.learn-final-quiz .quiz-option { min-height:38px; color:var(--text-secondary); }.learn-final-quiz .quiz-option-text { font-size:14px; }.learn-final-quiz .quiz-feedback p { color:var(--text-secondary); font-size:14px; }.learn-final-quiz .quiz-visualise-head strong { color:var(--text-primary); font-size:14px; }.learn-final-quiz .quiz-visualise-caption { color:var(--text-muted); font-size:14px; line-height:1.5; }.learn-final-quiz .quiz-mode-tabs button { font-size:13px; }.learn-final-quiz .quiz-score-copy strong { color:var(--text-primary); font-size:14px; }.learn-final-quiz .quiz-score-copy small,.learn-final-quiz .quiz-score-copy button { font-size:13px; }
.learn-final-quiz .quiz-score-ring { width:52px; height:52px; }.learn-final-quiz .quiz-score-ring::before { width:40px; height:40px; }.learn-final-quiz .quiz-score-ring span { font-size:14px; }.learn-final-quiz .quiz-score-ring small { font-size:12px; }
.learn-final-quiz .quiz-card-no { font-size:12px; }.learn-final-quiz .quiz-option-letter { width:20px; height:20px; font-size:12px; }
.learn-final-quiz .quiz-option-text { font-size:14px; }.learn-final-quiz .quiz-feedback p { font-size:14px; }
.learn-extra-scenarios { overflow:hidden; }.learn-extra-scenarios .learning-experiment-list { padding:3px 18px 13px; }.learn-extra-scenarios .experiment-row-copy h3 { font-size:17px; }.learn-extra-scenarios .experiment-row-copy p { font-size:14px; line-height:1.45; }.learn-extra-scenarios .experiment-row-duration,.learn-extra-scenarios .experiment-row-copy .scenario-level { font-size:13px; }.learn-extra-scenarios .experiment-row-button { min-height:38px; font-size:14px; }
.learn-final-page .learning-disclaimer { margin-top:16px; padding:12px 14px; }.learn-final-page .learning-disclaimer p,.learn-final-page .learning-disclaimer a { font-size:14px; }
:global(html[data-theme='light']) .learn-final-modules .concept-card { border-color:var(--border); background:#fff; }
:global(html[data-theme='light']) .learn-final-modules .concept-tag { color:#527e89; }
:global(html[data-theme='light']) .learn-final-modules .concept-card p { color:#536973; }
:global(html[data-theme='light']) .learn-final-quiz .quiz-card { border-color:var(--border); background:#fff; }
:global(html[data-theme='light']) .learn-final-quiz .quiz-question { color:var(--text-primary); }
:global(html[data-theme='light']) .learn-final-quiz .quiz-option { border-color:var(--border); background:#f6f9fa; }
:global(html[data-theme='light']) .learn-final-quiz .quiz-feedback { background:#eff8f4; }
@media(max-width:900px) { .learn-final-hero { grid-template-columns:1fr; }.learn-final-visual { display:none; }.learn-progress-overview { grid-template-columns:1fr 1fr; row-gap:14px; }.learn-progress-overview>div:nth-child(3) { border-left:0; }.quiz-heading { align-items:flex-start; flex-direction:column; }.quiz-grid { grid-template-columns:1fr; } }
</style>
