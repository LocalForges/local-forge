#!/usr/bin/env node
/*
 * 内核体积报告（A-1 交付物）。
 *
 * 目的：量化"构建产物体积"与"用户实际首装/运行时下载体积"的差异，验证
 * ffmpeg 双内核（MT + ST）的分级兜底策略是否达成瘦身目标。
 *
 * 关键结论模型：
 *   - 构建产物 = 所有内核文件的总和（含按需兜底内核）
 *   - 首装预缓存 = 应用外壳（SW SHELL_ASSETS），不含任何 WASM 内核
 *   - 运行时下载（跨源隔离环境，绝大多数用户）= 本地 MT 内核
 *   - 运行时下载（无隔离环境）= 本地 ST 内核（按需）
 *   - 兜底 = CDN（不计入本地体积）
 */
import { readdirSync, statSync, existsSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
// 优先用构建产物 dist/（真实体积），回退 public/（仅内核目录）。
const dist = join(root, 'dist')
const base = existsSync(dist) ? dist : join(root, 'public')
const pub = base

function dirSize(dir) {
  if (!existsSync(dir)) return { bytes: 0, files: [] }
  let bytes = 0
  const files = []
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    const st = statSync(p)
    if (st.isDirectory()) {
      const sub = dirSize(p)
      bytes += sub.bytes
      files.push(...sub.files)
    } else {
      bytes += st.size
      files.push({ name: relative(pub, p), size: st.size })
    }
  }
  return { bytes, files }
}

const mb = (b) => (b / 1048576).toFixed(1) + ' MB'

const groups = {
  'ffmpeg（多线程 · 主力内核）': join(pub, 'ffmpeg'),
  'ffmpeg-st（单线程 · 兜底内核）': join(pub, 'ffmpeg-st'),
  'tesseract（OCR 内核）': join(pub, 'tesseract'),
  'libarchive（解压内核）': join(pub, 'libarchive'),
}

console.log('\n=== LocalForge 内核体积报告 ===\n')

let buildTotal = 0
const rows = []
for (const [label, dir] of Object.entries(groups)) {
  const { bytes } = dirSize(dir)
  buildTotal += bytes
  rows.push({ label, bytes })
}

console.log('【构建产物 · 各内核体积】')
for (const { label, bytes } of rows) {
  console.log(`  ${label.padEnd(34, ' ')} ${mb(bytes).padStart(9, ' ')}`)
}
console.log(`  ${'—'.repeat(44)}`)
console.log(`  ${'内核合计（构建产物）'.padEnd(32, ' ')} ${mb(buildTotal).padStart(9, ' ')}`)

// 首装预缓存（与 public/sw.js 的 SHELL_ASSETS 保持一致）
const shell = ['/', '/index.html', '/manifest.webmanifest', '/favicon.svg',
  '/icons/icon-192.png', '/icons/icon-512.png', '/icons/maskable-512.png']
let shellBytes = 0
for (const f of shell) {
  const p = f === '/' ? join(pub, 'index.html') : join(pub, f)
  if (existsSync(p)) shellBytes += statSync(p).size
}
// 补充统计 Vite 生成的 JS/CSS 外壳资源（assets/*.js|css），它们构成首屏真实下载量。
const assetsDir = join(pub, 'assets')
let assetsBytes = 0
if (existsSync(assetsDir)) {
  for (const n of readdirSync(assetsDir)) {
    if (/\.(js|css)$/.test(n)) assetsBytes += statSync(join(assetsDir, n)).size
  }
}

console.log('\n【用户视角 · 实际下载体积】')
console.log(`  ${'首装预缓存（外壳 HTML/manifest/icons）'.padEnd(30, ' ')} ${mb(shellBytes).padStart(9, ' ')}`)
console.log(`  ${'首屏 JS/CSS（路由懒加载后）'.padEnd(30, ' ')} ${mb(assetsBytes).padStart(9, ' ')}`)
const mt = rows[0].bytes
const st = rows[1].bytes
console.log(`  ${'跨源隔离环境（绝大多数）→ 本地 MT'.padEnd(30, ' ')} ${mb(mt).padStart(9, ' ')}`)
console.log(`  ${'无隔离环境 → 本地 ST（按需）'.padEnd(30, ' ')} ${mb(st).padStart(9, ' ')}`)
console.log(`  ${'两级兜底 → CDN（不计本地体积）'.padEnd(30, ' ')} ${'0 MB'.padStart(9, ' ')}`)

const saved = st
console.log('\n【A-1 结论】')
console.log(`  · 分级兜底后，隔离环境用户运行时下载 ${mb(mt)}，`)
console.log(`    不再无条件下载单线程内核，单用户节省约 ${mb(saved)} 流量与磁盘。`)
console.log(`  · 首装包（外壳 + 首屏 JS/CSS）约 ${mb(shellBytes + assetsBytes)}，内核全部按需拉取，`)
console.log(`    契合"离线可感知"叙事：不用 ffmpeg/OCR 就不会为它们付出体积。`)
console.log(`  · 构建产物仍保留 ${mb(buildTotal)}（含兜底内核 + 词库），保证极端环境也能离线工作。\n`)
