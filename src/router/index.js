import { createRouter, createWebHistory } from 'vue-router'
import Home from '../views/Home.vue'
import ZipCompress from '../views/ZipCompress.vue'
import ZipExtract from '../views/ZipExtract.vue'
import ArchiveTool from '../views/ArchiveTool.vue'
import MediaConvert from '../views/MediaConvert.vue'
import MediaPro from '../views/MediaPro.vue'
import ImageConvert from '../views/ImageConvert.vue'
import PdfTools from '../views/PdfTools.vue'
import PdfPro from '../views/PdfPro.vue'
import ShareFiles from '../views/ShareFiles.vue'
import PasswordRecovery from '../views/PasswordRecovery.vue'
import Repair from '../views/Repair.vue'
import QrCode from '../views/QrCode.vue'
import HashTool from '../views/HashTool.vue'
import ExifTool from '../views/ExifTool.vue'
import TextTool from '../views/TextTool.vue'
import OcrTool from '../views/OcrTool.vue'
import About from '../views/About.vue'
import Privacy from '../views/Privacy.vue'

const routes = [
  { path: '/', name: 'home', component: Home },
  { path: '/zip-compress', name: 'zip-compress', component: ZipCompress, meta: { title: '压缩为 ZIP' } },
  { path: '/zip-extract', name: 'zip-extract', component: ZipExtract, meta: { title: '解压 ZIP' } },
  { path: '/archive', name: 'archive', component: ArchiveTool, meta: { title: '归档工具箱' } },
  { path: '/media-convert', name: 'media-convert', component: MediaConvert, meta: { title: '媒体转换' } },
  { path: '/media-pro', name: 'media-pro', component: MediaPro, meta: { title: '音视频进阶' } },
  { path: '/image-convert', name: 'image-convert', component: ImageConvert, meta: { title: '图片工具' } },
  { path: '/pdf-tools', name: 'pdf-tools', component: PdfTools, meta: { title: 'PDF 工具' } },
  { path: '/pdf-pro', name: 'pdf-pro', component: PdfPro, meta: { title: 'PDF 进阶' } },
  { path: '/share-files', name: 'share-files', component: ShareFiles, meta: { title: 'P2P 分享' } },
  { path: '/password-recovery', name: 'password-recovery', component: PasswordRecovery, meta: { title: '密码恢复' } },
  { path: '/repair', name: 'repair', component: Repair, meta: { title: '修复归档' } },
  { path: '/qr-code', name: 'qr-code', component: QrCode, meta: { title: '二维码工具箱' } },
  { path: '/hash', name: 'hash', component: HashTool, meta: { title: '文件哈希 / 校验' } },
  { path: '/exif', name: 'exif', component: ExifTool, meta: { title: '照片隐私清理' } },
  { path: '/text', name: 'text', component: TextTool, meta: { title: '文本 / 编码工具箱' } },
  { path: '/ocr', name: 'ocr', component: OcrTool, meta: { title: 'OCR 文字识别' } },
  { path: '/about', name: 'about', component: About, meta: { title: '关于' } },
  { path: '/privacy', name: 'privacy', component: Privacy, meta: { title: '隐私协议' } },
]

export default createRouter({
  history: createWebHistory(),
  routes,
  scrollBehavior: () => ({ top: 0 }),
})
