import { createApp } from 'vue'
import App from './App.vue'
import router from './router'
import { bootstrapTheme } from './lib/theme.js'
import 'bootstrap-icons/font/bootstrap-icons.css'
import './styles/main.css'

// 在挂载前设置主题，避免浅色主题下的白屏闪烁
bootstrapTheme()

createApp(App).use(router).mount('#app')
