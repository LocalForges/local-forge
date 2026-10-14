import { reactive } from 'vue'

// 全局轻提示队列：视图里 import { pushToast } 即可，不参与布局、自动消失。
export const toasts = reactive([])
let seq = 0

export function pushToast(type, text, opts = {}) {
  const id = ++seq
  const t = { id, type, text, leaving: false }
  toasts.push(t)
  const ttl = opts.ttl || 3200
  setTimeout(() => dismissToast(id), ttl)
  return id
}

export function dismissToast(id) {
  const i = toasts.findIndex((t) => t.id === id)
  if (i === -1) return
  toasts[i].leaving = true
  setTimeout(() => {
    const j = toasts.findIndex((t) => t.id === id)
    if (j !== -1) toasts.splice(j, 1)
  }, 200)
}
