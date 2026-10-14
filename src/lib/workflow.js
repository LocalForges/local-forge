// 跨工具工作流：注册"结果 → 下一步"的可达路径，并在内存中传递文件。
// 设计：
//  - FLOWS[fromTool] = [{ to, label }...]，label 为词条 key（wf.*），由视图渲染为"下一步"按钮
//  - pendingFiles 为模块级内存 store（不落盘，页面刷新即清，符合零上传叙事）
//  - goNext(router, fromPath, files) 负责写入 pending 并跳转
import { ref } from 'vue'

// 工具标识：用 NAV 路径作为 key，直观且与路由一致
export const FLOWS = {
  // ZIP：解出来的东西通常是图片/PDF/其他文件
  '/zip-extract': [
    { to: '/image-convert', labelKey: 'wf.toImage' },
    { to: '/pdf-tools', labelKey: 'wf.toPdf' },
    { to: '/hash', labelKey: 'wf.toHash' },
    { to: '/zip-compress', labelKey: 'wf.toZip' },
  ],
  '/archive': [
    { to: '/image-convert', labelKey: 'wf.toImage' },
    { to: '/pdf-tools', labelKey: 'wf.toPdf' },
    { to: '/hash', labelKey: 'wf.toHash' },
  ],
  // 图片：转完可继续压缩 → 打包 → 转二维码
  '/image-convert': [
    { to: '/zip-compress', labelKey: 'wf.toZip' },
    { to: '/pdf-pro?tab=img2pdf', labelKey: 'wf.toImgPdf' },
    { to: '/qr-code', labelKey: 'wf.toQr' },
    { to: '/exif', labelKey: 'wf.toExif' },
  ],
  '/exif': [
    { to: '/image-convert', labelKey: 'wf.toImage' },
    { to: '/zip-compress', labelKey: 'wf.toZip' },
  ],
  // PDF：处理后可 OCR、转图
  '/pdf-tools': [
    { to: '/ocr?tab=pdf', labelKey: 'wf.toOcr' },
    { to: '/pdf-pro?tab=pdf2img', labelKey: 'wf.toPdf2img' },
  ],
  '/pdf-pro': [
    { to: '/pdf-tools', labelKey: 'wf.toPdfTools' },
    { to: '/ocr?tab=pdf', labelKey: 'wf.toOcr' },
  ],
  // 媒体：抽出音频/帧后，可进一步压缩图片或打包
  '/media-convert': [
    { to: '/media-pro?tab=gif', labelKey: 'wf.toGif' },
    { to: '/zip-compress', labelKey: 'wf.toZip' },
  ],
  '/media-pro': [
    { to: '/image-convert', labelKey: 'wf.toImage' },
    { to: '/zip-compress', labelKey: 'wf.toZip' },
  ],
  // OCR 识别出的文本 → 文本工具箱
  '/ocr': [
    { to: '/text', labelKey: 'wf.toText' },
  ],
  // 二维码：识别结果可进文本工具箱处理
  '/qr-code': [
    { to: '/text', labelKey: 'wf.toText' },
  ],
  // 文本工具 → 生成二维码分享
  '/text': [
    { to: '/qr-code', labelKey: 'wf.toQr' },
  ],
}

export function flowsFrom(path) {
  const clean = path.split('?')[0]
  return FLOWS[clean] || []
}

// ---------- 文件传递（内存，仅当前会话） ----------
export const pendingFiles = ref([]) // File[]
export const pendingFrom = ref('')  // 来源工具路径
export const pendingText = ref('')  // 文本型工作流（OCR/二维码识别 → 文本工具）

export function stashFiles(files, fromPath) {
  pendingFiles.value = Array.from(files || [])
  pendingFrom.value = fromPath || ''
  pendingText.value = ''
}

export function stashText(text, fromPath) {
  pendingText.value = text || ''
  pendingFiles.value = []
  pendingFrom.value = fromPath || ''
}

export function takeFiles() {
  const files = pendingFiles.value
  pendingFiles.value = []
  return files
}

export function consumePending() {
  if (!pendingFiles.value.length) return null
  const files = pendingFiles.value
  const from = pendingFrom.value
  pendingFiles.value = []
  pendingFrom.value = ''
  return { files, from }
}

// 消费传递来的文本（供文本工具/二维码生成使用）
export function consumePendingText() {
  if (!pendingText.value) return null
  const text = pendingText.value
  const from = pendingFrom.value
  pendingText.value = ''
  pendingFrom.value = ''
  return { text, from }
}

// 工作流词条（避免 i18n 循环依赖，直接内置双语）
export const WF_LABELS = {
  'wf.toImage': { 'zh-CN': '送去图片工具', en: 'Send to Image Tools' },
  'wf.toPdf': { 'zh-CN': '送去 PDF 工具', en: 'Send to PDF Tools' },
  'wf.toZip': { 'zh-CN': '打包为 ZIP', en: 'Pack as ZIP' },
  'wf.toHash': { 'zh-CN': '校验哈希', en: 'Verify hashes' },
  'wf.toImgPdf': { 'zh-CN': '合成 PDF', en: 'Merge into PDF' },
  'wf.toQr': { 'zh-CN': '生成二维码', en: 'Make QR code' },
  'wf.toExif': { 'zh-CN': '清理隐私信息', en: 'Clean privacy data' },
  'wf.toOcr': { 'zh-CN': '送去 OCR 识别', en: 'Send to OCR' },
  'wf.toPdfTools': { 'zh-CN': '送去 PDF 工具', en: 'Send to PDF Tools' },
  'wf.toPdf2img': { 'zh-CN': '转为图片', en: 'Convert to images' },
  'wf.toGif': { 'zh-CN': '转为 GIF', en: 'Convert to GIF' },
  'wf.toText': { 'zh-CN': '送去文本工具', en: 'Send to Text Tools' },
}

// 提供 i18n 后挂接：如果 i18n 已加载且命中词条，优先用 i18n
export function wfLabel(labelKey, locale) {
  const map = WF_LABELS[labelKey]
  if (!map) return labelKey
  return map[locale] || map['zh-CN']
}
