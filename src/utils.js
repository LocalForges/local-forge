export function formatSize(bytes) {
  if (bytes == null || isNaN(bytes)) return ''
  if (bytes < 1024) return bytes + ' B'
  const units = ['KB', 'MB', 'GB', 'TB']
  let v = bytes / 1024
  let i = 0
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024
    i++
  }
  return v.toFixed(v < 10 ? 2 : 1) + ' ' + units[i]
}

// 下载钩子：外壳在挂载时接上，用于"最近处理"记录等（一次下载只触发一次）
let downloadHook = null
export function setDownloadHook(fn) { downloadHook = fn }

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
  if (downloadHook) {
    try { downloadHook({ filename }) } catch { /* 钩子异常不应阻断下载 */ }
  }
}

export function basename(path) {
  const clean = (path || '').replace(/\\/g, '/')
  return clean.split('/').pop() || clean
}
