import { createApp } from 'vue'
import { createPinia } from 'pinia'
import { ElDropdown, ElDropdownItem, ElDropdownMenu } from 'element-plus/es/components/dropdown/index.mjs'
import { ElOption, ElSelect } from 'element-plus/es/components/select/index.mjs'
import { ElSwitch } from 'element-plus/es/components/switch/index.mjs'
import 'element-plus/es/components/select/style/css'
import 'element-plus/es/components/dropdown/style/css'
import 'element-plus/es/components/switch/style/css'
import 'element-plus/es/components/message/style/css'
import 'element-plus/es/components/message-box/style/css'
import 'element-plus/theme-chalk/dark/css-vars.css'
import App from './App.vue'
import { router } from './router'
import './styles/main.css'
import { useScenarioStore } from './stores/scenario'

const app = createApp(App)
const pinia = createPinia()
app.use(pinia)
useScenarioStore(pinia).hydrate()
app.use(router)
app.component('ElDropdown', ElDropdown)
app.component('ElDropdownItem', ElDropdownItem)
app.component('ElDropdownMenu', ElDropdownMenu)
app.component('ElOption', ElOption)
app.component('ElSelect', ElSelect)
app.component('ElSwitch', ElSwitch)
app.mount('#app')
