import puppeteer from 'puppeteer-core'
const BASE = 'http://127.0.0.1:4173/'
const browser = await puppeteer.launch({ executablePath: '/usr/bin/chromium', headless: 'new', args: ['--no-sandbox', '--disable-setuid-sandbox'] })
const page = await browser.newPage()
const shot = (n) => page.screenshot({ path: `/workspace/shots/${n}.png` })
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
await page.evaluateOnNewDocument(() => { try { localStorage.setItem('lf-locale', 'zh-CN') } catch {} })

// 桌面 · 默认顶栏布局
await page.setViewport({ width: 1280, height: 900 })
await page.goto(BASE, { waitUntil: 'networkidle0' }); await wait(500)
await shot('desktop-topbar')

// 桌面 · 侧栏（切过去 + 悬停展开）
await page.click('[data-testid="layout-toggle"]'); await wait(300)
await shot('desktop-sidebar-collapsed')
await page.hover('.sidebar'); await wait(350)
await shot('desktop-sidebar-expanded')
await page.click('[data-testid="layout-toggle"]'); await wait(250)

// 英文界面（i18n）
await page.click('[data-testid="locale-toggle"]'); await wait(400)
await shot('desktop-english')
await page.click('[data-testid="locale-toggle"]'); await wait(300)

// 最近处理 · 类型筛选（注入历史记录后看首页）
await page.evaluate(async () => {
  const recs = [
    { path: '/image-convert', name: 'holiday-photo.png', type: 'image', t: Date.now() - 60_000 },
    { path: '/pdf-tools', name: 'report.pdf', type: 'pdf', t: Date.now() - 3_600_000 },
    { path: '/zip-compress', name: 'archive.zip', type: 'archive', t: Date.now() - 7_200_000 },
    { path: '/media-convert', name: 'clip.mp4', type: 'video', t: Date.now() - 86_400_000 },
  ]
  await new Promise((resolve) => {
    const req = indexedDB.open('lf-history', 1)
    req.onupgradeneeded = () => { const db = req.result; if (!db.objectStoreNames.contains('records')) db.createObjectStore('records', { keyPath: 'id', autoIncrement: true }) }
    req.onsuccess = () => {
      const db = req.result
      const tx = db.transaction('records', 'readwrite')
      const store = tx.objectStore('records')
      recs.forEach((r) => store.add(r))
      tx.oncomplete = () => resolve(); tx.onerror = () => resolve()
    }
    req.onerror = () => resolve()
  })
})
await page.reload({ waitUntil: 'networkidle0' }); await wait(800)
const recentBox = await page.$('.recent')
if (recentBox) await recentBox.screenshot({ path: '/workspace/shots/recent-filters.png' })

// 跨工具工作流：图片工具跑一次，截取"下一步"区
await page.goto(BASE + 'image-convert', { waitUntil: 'networkidle0' })
await page.waitForSelector('.dropzone input[type=file]', { timeout: 15000 }); await wait(400)
await page.evaluate(async () => {
  const c = document.createElement('canvas'); c.width = 96; c.height = 96
  const ctx = c.getContext('2d'); ctx.fillStyle = '#38bdf8'; ctx.fillRect(0, 0, 96, 96); ctx.fillStyle = '#a78bfa'; ctx.fillRect(24, 24, 48, 48)
  const blob = await new Promise((res) => c.toBlob(res, 'image/png'))
  const file = new File([blob], 'demo.png', { type: 'image/png' })
  const input = document.querySelector('.dropzone input[type=file]')
  const dt = new DataTransfer(); dt.items.add(file); input.files = dt.files
  input.dispatchEvent(new Event('change', { bubbles: true }))
})
await wait(500)
await page.evaluate(() => {
  const btn = Array.from(document.querySelectorAll('.panel .btn')).find((b) => /开始/.test(b.textContent || ''))
  if (btn) btn.click()
})
await wait(1500)
const wfBox = await page.$('.next-steps')
if (wfBox) await wfBox.screenshot({ path: '/workspace/shots/workflow-nextsteps.png' })

// 手机 · 顶栏 + 底部标签栏
await page.evaluate(() => localStorage.setItem('lf-layout', 'topbar'))
await page.setViewport({ width: 390, height: 844 })
await page.goto(BASE, { waitUntil: 'networkidle0' }); await wait(500)
await shot('mobile-tabbar')

await browser.close()
console.log('shots saved')
