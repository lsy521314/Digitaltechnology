<script setup lang="ts">
import { computed, ref } from 'vue'
import type { QuizQuestion } from '../data/quizData'
import ChartPanel from './charts/ChartPanel.vue'

const props = defineProps<{ questions: QuizQuestion[] }>()
const emit = defineEmits<{ (e: 'exam-finished', score: number): void }>()

const answers = ref<Record<number, number>>({})
const current = ref(0)
const submitted = ref(false)

const question = computed(() => props.questions[current.value])
const answeredCount = computed(() => props.questions.filter((q) => answers.value[q.id] !== undefined).length)
const correctCount = computed(() => props.questions.filter((q) => answers.value[q.id] === q.correctIndex).length)
const wrongCount = computed(() => answeredCount.value - correctCount.value)
const blankCount = computed(() => props.questions.length - answeredCount.value)
const score = computed(() => (props.questions.length ? Math.round((correctCount.value / props.questions.length) * 100) : 0))
const grade = computed(() => (score.value >= 90 ? '优秀' : score.value >= 75 ? '良好' : score.value >= 60 ? '合格' : '待加强'))
const gradeColor = computed(() => (score.value >= 90 ? '#67c7a9' : score.value >= 75 ? '#6fcbd0' : score.value >= 60 ? '#dbb269' : '#e78172'))
const progressDeg = computed(() => `${score.value * 3.6}deg`)

function choose(optionIndex: number) {
  if (submitted.value) return
  answers.value = { ...answers.value, [question.value.id]: optionIndex }
}

function go(target: number) {
  current.value = Math.max(0, Math.min(props.questions.length - 1, target))
}

function submitExam() {
  submitted.value = true
  emit('exam-finished', score.value)
}

function restart() {
  answers.value = {}
  current.value = 0
  submitted.value = false
}

function sheetState(q: QuizQuestion) {
  const picked = answers.value[q.id]
  if (picked === undefined) return 'blank'
  if (submitted.value) return picked === q.correctIndex ? 'correct' : 'wrong'
  return 'answered'
}
</script>

<template>
  <div class="exam-panel">
    <template v-if="!submitted">
      <div class="exam-topbar">
        <div class="exam-topbar-copy"><span class="section-kicker">SIMULATED EXAM</span><strong>模拟考试 · 共 {{ questions.length }} 题</strong><small>满分 100 · 每题 {{ Math.round(100 / questions.length) }} 分 · 建议 {{ Math.ceil(questions.length / 5) }} 分钟内完成</small></div>
        <div class="exam-topbar-stat"><span class="exam-fill-state"><i></i>已答 <b>{{ answeredCount }}</b> / {{ questions.length }}</span><button class="exam-submit-button" :disabled="answeredCount === 0" @click="submitExam">交卷 <span>→</span></button></div>
      </div>

      <div class="exam-body">
        <aside class="exam-sheet">
          <div class="exam-sheet-head"><strong>答题卡</strong><small>{{ answeredCount }}/{{ questions.length }}</small></div>
          <div class="exam-sheet-grid">
            <button v-for="(q, qi) in questions" :key="q.id" class="exam-sheet-cell" :class="[sheetState(q), { active: qi === current }]" @click="go(qi)">{{ qi + 1 }}</button>
          </div>
          <div class="exam-sheet-legend">
            <span><i class="lg-answered"></i>已答</span><span><i class="lg-blank"></i>未答</span>
          </div>
          <div class="exam-sheet-tip">点击题号可跳转，左下方按钮顺序作答</div>
        </aside>

        <div class="exam-stage">
          <div class="exam-question-head"><span class="exam-question-no">Q{{ String(current + 1).padStart(2, '0') }}</span><span class="quiz-card-tag">{{ question.category }}</span><span class="exam-question-count">{{ current + 1 }} / {{ questions.length }}</span></div>
          <h3 class="exam-question">{{ question.question }}</h3>
          <div class="exam-options">
            <button v-for="(opt, oi) in question.options" :key="oi" class="exam-option" :class="{ 'exam-option-picked': answers[question.id] === oi }" @click="choose(oi)">
              <span class="exam-option-letter">{{ String.fromCharCode(65 + oi) }}</span><span class="exam-option-text">{{ opt }}</span><span v-if="answers[question.id] === oi" class="exam-option-check">✓</span>
            </button>
          </div>
          <div class="exam-nav">
            <button class="exam-nav-button" :disabled="current === 0" @click="go(current - 1)">← 上一题</button>
            <button v-if="current < questions.length - 1" class="exam-nav-button exam-nav-next" @click="go(current + 1)">下一题 →</button>
            <button v-else class="exam-nav-button exam-nav-submit" @click="submitExam">完成并交卷 →</button>
          </div>
        </div>
      </div>
    </template>

    <template v-else>
      <div class="exam-result">
        <div class="exam-result-head">
          <div class="exam-result-ring" :style="{ '--g': gradeColor, '--p': progressDeg }"><span>{{ score }}</span><small>分</small></div>
          <div class="exam-result-copy">
            <span class="section-kicker">EXAM REPORT</span>
            <h3>本次成绩 · <i :style="{ color: gradeColor }">{{ grade }}</i></h3>
            <p>正确 {{ correctCount }} 题 · 错误 {{ wrongCount }} 题 · 未答 {{ blankCount }} 题</p>
            <div class="exam-result-bars"><span class="result-bar result-bar-correct" :style="{ width: `${(correctCount / questions.length) * 100}%` }"></span><span class="result-bar result-bar-wrong" :style="{ width: `${(wrongCount / questions.length) * 100}%` }"></span><span class="result-bar result-bar-blank" :style="{ width: `${(blankCount / questions.length) * 100}%` }"></span></div>
            <div class="exam-result-actions"><RouterLink to="/lab" class="button-primary button-small">带着错题去实验 <span class="arrow">→</span></RouterLink><button class="exam-restart-button" @click="restart">重新考试 ↺</button></div>
          </div>
        </div>

        <div class="exam-review">
          <div class="exam-review-head"><span class="section-kicker">ANSWER REVIEW</span><h4>逐题回顾与可视化解析</h4></div>
          <article v-for="(q, qi) in questions" :key="q.id" class="exam-review-item" :class="{ 'review-correct': answers[q.id] === q.correctIndex, 'review-wrong': answers[q.id] !== undefined && answers[q.id] !== q.correctIndex }">
            <div class="exam-review-meta"><span class="exam-review-index">{{ String(qi + 1).padStart(2, '0') }}</span><span class="quiz-card-tag">{{ q.category }}</span><span class="exam-review-state">{{ answers[q.id] === undefined ? '未答' : answers[q.id] === q.correctIndex ? '✓ 正确' : '✕ 错误' }}</span></div>
            <h5>{{ q.question }}</h5>
            <ul class="exam-review-options">
              <li v-for="(opt, oi) in q.options" :key="oi" :class="{ 'li-correct': oi === q.correctIndex, 'li-picked-wrong': answers[q.id] === oi && oi !== q.correctIndex }"><span class="li-letter">{{ String.fromCharCode(65 + oi) }}</span>{{ opt }}<i v-if="oi === q.correctIndex">正确答案</i><i v-else-if="answers[q.id] === oi">你的选择</i></li>
            </ul>
            <div class="exam-review-explain"><span class="quiz-feedback-icon">{{ answers[q.id] === q.correctIndex ? '✓' : '✕' }}</span><p><strong>{{ answers[q.id] === q.correctIndex ? '解答正确：' : `正确答案 ${String.fromCharCode(65 + q.correctIndex)} · ` }}</strong>{{ q.explain }}</p></div>
            <div class="quiz-visualise">
              <div class="quiz-visualise-head"><span class="quiz-visualise-icon">▤</span><strong>{{ q.visual.title }}</strong><RouterLink :to="q.visual.linkPath" class="quiz-visualise-link">在系统中查看 <span>↗</span></RouterLink></div>
              <ChartPanel :option="q.visual.option" height="170px" />
              <p class="quiz-visualise-caption">{{ q.visual.caption }}</p>
            </div>
          </article>
        </div>
      </div>
    </template>
  </div>
</template>