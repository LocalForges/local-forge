// 主题：localStorage 优先，其次系统偏好；在 main.js 挂载前调用 bootstrapTheme() 防闪烁。
const KEY = 'lf-theme'

export function currentTheme() {
  return document.documentElement.getAttribute('data-theme') || 'dark'
}

export function setTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme)
  try { localStorage.setItem(KEY, theme) } catch { /* 忽略隐私模式写入失败 */ }
}

export function toggleTheme() {
  const next = currentTheme() === 'light' ? 'dark' : 'light'
  setTheme(next)
  return next
}

// 在 <head> 解析样式前调用，避免浅色主题下的白屏闪烁
export function bootstrapTheme() {
  let theme = null
  try { theme = localStorage.getItem(KEY) } catch { /* ignore */ }
  if (!theme) {
    const prefersLight = window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches
    theme = prefersLight ? 'light' : 'dark'
  }
  document.documentElement.setAttribute('data-theme', theme)
}

// ---------- 导航布局偏好：'topbar'（默认，照顾习惯）| 'sidebar' ----------
const LAYOUT_KEY = 'lf-layout'

export function currentLayout() {
  try { return localStorage.getItem(LAYOUT_KEY) || 'topbar' } catch { return 'topbar' }
}
export function setLayout(v) {
  try { localStorage.setItem(LAYOUT_KEY, v) } catch { /* ignore */ }
}
