import { computed, ref } from 'vue'

const STORAGE_KEY = 'zhiyu-learning-progress'

export interface LearningProgress {
  /** 随堂练习答题记录：题目 id -> 选择的选项索引 */
  practiceAnswers: Record<number, number>
  /** 各次模拟考试百分制得分 */
  examScores: number[]
  /** 最佳得分 */
  bestExamScore: number
  /** 已获得成就 id 列表 */
  achievements: string[]
}

export interface Achievement {
  id: string
  icon: string
  title: string
  desc: string
  /** 判断是否达成 */
  check: (progress: LearningProgress) => boolean
}

const empty = (): LearningProgress => ({
  practiceAnswers: {},
  examScores: [],
  bestExamScore: 0,
  achievements: [],
})

function load(): LearningProgress {
  if (typeof window === 'undefined') return empty()
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return empty()
    const parsed = JSON.parse(raw) as Partial<LearningProgress>
    return { ...empty(), ...parsed }
  } catch {
    return empty()
  }
}

function persist(data: LearningProgress) {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(data))
}

/** 预设成就 */
export const ACHIEVEMENTS: Achievement[] = [
  { id: 'first-step', icon: '◈', title: '迈出第一步', desc: '完成第一道随堂练习', check: (p) => Object.keys(p.practiceAnswers).length >= 1 },
  { id: 'half-quiz', icon: '◐', title: '半程学员', desc: '完成一半以上随堂练习', check: (p) => Object.keys(p.practiceAnswers).length >= 10 },
  { id: 'quiz-master', icon: '●', title: '随堂全通', desc: '完成全部 20 道随堂练习', check: (p) => Object.keys(p.practiceAnswers).length >= 20 },
  { id: 'perfect-practice', icon: '★', title: '零失误', desc: '随堂练习全对', check: (p) => {
    const ids = Object.keys(p.practiceAnswers)
    return ids.length >= 1 && ids.every((key) => p.practiceAnswers[Number(key)] === 0)
  } },
  { id: 'first-exam', icon: '⛨', title: '首次应考', desc: '完成一次模拟考试', check: (p) => p.examScores.length >= 1 },
  { id: 'exam-90', icon: '◆', title: '优秀考生', desc: '模拟考试取得 90 分及以上', check: (p) => p.bestExamScore >= 90 },
  { id: 'exam-pass', icon: '✓', title: '及格上岸', desc: '模拟考试达到 60 分', check: (p) => p.bestExamScore >= 60 },
]

/** 学习进度组合式函数，负责读写在浏览器本地持久化的答题与考试进度。 */
export function useLearningProgress() {
  const state = ref<LearningProgress>(load())

  const answeredCount = computed(() => Object.keys(state.value.practiceAnswers).length)
  const correctCount = computed(() => {
    // 随堂练习的正确答案索引从外部传入，此处返回已答数量供展示用
    return Object.keys(state.value.practiceAnswers).length
  })
  const examTaken = computed(() => state.value.examScores.length > 0)
  const bestScore = computed(() => state.value.bestExamScore)
  const examAverage = computed(() => {
    if (!state.value.examScores.length) return 0
    return Math.round(state.value.examScores.reduce((s, n) => s + n, 0) / state.value.examScores.length)
  })
  const earned = computed(() => ACHIEVEMENTS.filter((a) => state.value.achievements.includes(a.id)))
  const lockCount = computed(() => ACHIEVEMENTS.length - earned.value.length)

  function syncAchievements() {
    const gained: string[] = []
    for (const a of ACHIEVEMENTS) {
      if (!state.value.achievements.includes(a.id) && a.check(state.value)) {
        state.value.achievements.push(a.id)
        gained.push(a.id)
      }
    }
    if (gained.length) persist(state.value)
    return gained
  }

  function recordPracticeAnswer(questionId: number, optionIndex: number) {
    state.value.practiceAnswers[questionId] = optionIndex
    persist(state.value)
    return syncAchievements()
  }

  function recordExamScore(score: number) {
    state.value.examScores.push(score)
    if (score > state.value.bestExamScore) state.value.bestExamScore = score
    persist(state.value)
    return syncAchievements()
  }

  function resetProgress() {
    state.value = empty()
    persist(state.value)
  }

  return {
    state,
    answeredCount,
    correctCount,
    examTaken,
    bestScore,
    examAverage,
    earned,
    lockCount,
    recordPracticeAnswer,
    recordExamScore,
    resetProgress,
  }
}
