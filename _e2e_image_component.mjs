// 组件级端到端测试：真正渲染 ImageConvert.vue（而非只测 lib 函数），
// 模拟用户上传→点击"开始"→断言结果图渲染且全程无 pageerror。
import puppeteer from 'puppeteer-core'

const BASE = process.env.BASE || 'http://localhost:5173'
const CHROME = process.env.CHROMIUM_PATH || '/usr/bin/chromium'
const TEST_PNG = '/tmp/test_alpha.png'

const errors = []
const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  args: ['--no-sandbox', '--disable-setuid-sandbox', '--enable-features=SharedArrayBuffer'],
})
const page = await browser.newPage()
page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message))
page.on('console', (m) => { if (m.type() === 'error') errors.push('CONSOLE.ERROR: ' + m.text()) })

try {
  await page.goto(`${BASE}/image-convert?mode=compress`, { waitUntil: 'networkidle0' })

  // 1) 初始渲染不应有错误
  const initialErr = [...errors]

  // 2) 模拟上传真实 PNG 文件（DropZone 内部隐藏 file input）
  const input = await page.$('input[type=file]')
  if (!input) throw new Error('找不到文件选择 input')
  await input.uploadFile(TEST_PNG)

  // 3) 等待组件进入已选文件状态（panel 出现）
  await page.waitForSelector('.panel', { timeout: 15000 })

  // 4) 点击"开始"按钮
  await page.click('button.btn:not(.green)')

  // 5) 等待结果图渲染（resultUrl 绑定到 <img>）
  await page.waitForFunction(
    () => {
      const img = document.querySelector('.img-preview img')
      return img && img.complete && img.naturalWidth > 0
    },
    { timeout: 20000 },
  )

  const info = await page.evaluate(() => {
    const img = document.querySelector('.img-preview img')
    const msg = document.querySelector('.msg.ok')
    return {
      resultImgW: img ? img.naturalWidth : 0,
      resultImgH: img ? img.naturalHeight : 0,
      msgText: msg ? msg.textContent : null,
    }
  })

  console.log('=== ImageConvert.vue 组件级测试结果 ===')
  console.log('初始渲染错误:', initialErr.length ? initialErr : '无')
  console.log('结果图尺寸:', info.resultImgW + 'x' + info.resultImgH)
  console.log('完成提示:', info.msgText)
  console.log('全程 pageerror / console.error:', errors.length ? errors : '无')

  const pass = errors.length === 0 && info.resultImgW > 0 && info.resultImgH > 0 && info.msgText && info.msgText.includes('完成')
  console.log(pass ? '\n✅ 组件渲染 + 压缩流程通过' : '\n❌ 存在问题')
  await browser.close()
  process.exit(pass ? 0 : 1)
} catch (e) {
  console.log('测试异常:', e.message)
  if (errors.length) console.log('捕获到的错误:', errors)
  await browser.close()
  process.exit(1)
}
