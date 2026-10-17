import { createRouter, createWebHistory } from 'vue-router'
export const router = createRouter({
  history: createWebHistory(),
  scrollBehavior: () => ({ top: 0 }),
  routes: [
    { path: '/', name: 'home', component: () => import('../views/HomeView.vue') },
    { path: '/lab', name: 'lab', component: () => import('../views/LabView.vue') },
    { path: '/compare', name: 'compare', component: () => import('../views/CompareView.vue') },
    { path: '/analysis', name: 'analysis', component: () => import('../views/AnalysisView.vue') },
    { path: '/learn', name: 'learn', component: () => import('../views/LearnView.vue') },
    { path: '/about', name: 'about', component: () => import('../views/AboutView.vue') },
    { path: '/:pathMatch(.*)*', redirect: '/' },
  ],
})
