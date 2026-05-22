# 📖 PDF Smart Outliner (智能 PDF 书签大纲生成与编辑器)

> **极简视觉，极致内核。** 专为大文件、学术教材、技术文档与扫描版 PDF 打造的智能目录提取、页码偏移矫正与大纲增量补录系统。

[![Build Status](https://img.shields.io/badge/Build-Success-emerald?style=flat-square)](#) 
[![Tech](https://img.shields.io/badge/Tech-React19%20%7C%20Vite%20%7C%20TailwindCSS%20%7C%20Express-blue?style=flat-square)](#)
[![Model](https://img.shields.io/badge/AI-Gemini%203.5-orange?style=flat-square)](#)

---

## 🌟 核心特色与亮点设计

### 1. 🤖 AI 智能多模态分批扫描与「无损增量补充」
*   **分批吞吐流**：针对超长 PDF，打破主流 AI 模型的上下文窗口和单次输出 Tokens 限制，采用自动分批滑窗技术，实现 200+ 页文档的平滑吞吐和多级大纲重塑。
*   **无损增量扫描模式（新）**：支持在已有书签大纲的基础进行「再次断点扫描」。系统会自动跳过已有书签的物理页面，只分析缺漏章节；同时在合并时利用内存去重网格，**杜绝生成相同物理页的冗余书签**，完美解决 AI 一次生成不全的痛点。

### 2. 🔏 终极兼容：100% 完美的中文 PDF 书签硬编码
*   **痛点**：传统 `pdf-lib` 在注入含有括号、特殊字符或双字节中文（CJK）的字符串时，常因 PDF 规范中的括号未转义或 unicode 双字节截断导致文件损坏、闪退。
*   **高阶解法**：底层自研 `encodePdfString` 编码器。采用 **UTF-16BE (with BOM `0xFEFF`) 字节流进行全量 Hex 十六进制编码（`PDFHexString`）**，彻底绕过 PDF 原生 Parentheses 解析边界，100% 保证任何中文字符、符号、多国文字均可 100% 被 Acrobat/Foxit/PDF.js 正确还原，不报任何异常。

### 3. 📐 动态页码偏移系统 (Offset Alignment)
*   专为书籍类型 PDF 打造的物理页码 (Physical) 与逻辑页码 (Logical) 对齐算法。支持一键将扫描出的目录页码统一加上/减去正负偏移量，直达正文真实页码，精准跳转不偏航。

### 4. 🗂️ 敏捷的多级树状交互编辑轨道
*   支持直接在 UI 交互界面对书签进行实时精细化微调：
    *   **深度拖改/一键变级 (Shift Nesting Level)**：一键缩进 (L1 $\rightarrow$ L2 $\rightarrow$ L3) 或提升大纲深度。
    *   **精准插针**：支持在任意行中间向上/向下追加新书签。
    *   **即改即显**：点击标题与页码直接进入内联编辑模式，回车即刻保存，右侧配备随动预览器，提供完美的人机协同体验。

---

## 🛠️ 技术栈蓝图

```
                       ┌─────────────────────────┐
                       │   React 19 SPA Client   │ (Vite Built)
                       └────────────┬────────────┘
                                    │ HTTP / JSON
                                    ▼
                       ┌─────────────────────────┐
                       │   Express Server App    │ (NodeJS / tsx)
                       └────────────┬────────────┘
                                    │
            ┌───────────────────────┴───────────────────────┐
            ▼                                               ▼
┌───────────────────────┐                       ┌───────────────────────┐
│ @google/genai SDK     │                       │ pdf-lib Binary Engine │
│ Gemini 3.5 API Models │                       │ Unicode (Hex) Outlines│
└───────────────────────┘                       └───────────────────────┘
```

---

## 🚀 开发者快速启动 (Local Development)

### 1. 配置环境
在项目根目录创建 `.env` 文件（或直接将 `.env.example` 重命名为 `.env`）并写入您的 **Gemini API 金钥**：
```env
GEMINI_API_KEY=your_gemini_api_key_here
```

### 2. 安装依赖
```bash
npm install
```

### 3. 本地启动服务（Vite + Express 双剑合璧开发模式）
```bash
npm run dev
```
打开浏览器访问 [http://localhost:3000](http://localhost:3000) 即可开始使用。

---

## 📦 桌面端打包指南: 如何将本项目变成 `.exe` 独立程序本地运行

为了彻底摆脱浏览器的限制，并实现在 Windows/macOS 下的双击独立窗口运行（摆脱命令行），您可以选择以下两种主流方式将本全栈项目封装为桌面客户端：

### 方案 A：使用 Electron (推荐，原生桌面级别体验)

由于本项目是 Full-stack 架构（React 静态编译 $\boldsymbol{+}$ Express 后端 API），使用 Electron 是最契合的方式：

#### 第一步：在项目目录安装 Electron 依赖
```bash
npm install electron electron-is-dev --save-dev
```

#### 第二步：在根目录创建 `electron-main.js` 用于承载本地服务器和渲染窗口
创建文件 `/electron-main.js` 入口：
```js
const { app, BrowserWindow } = require('electron');
const path = require('path');
const isDev = require('electron-is-dev');

// 导入我们的本地服务器
process.env.NODE_ENV = 'production';
// 绑定本地环境所需的 API KEY（也可以让用户在 Electron UI 里配置输入）
process.env.GEMINI_API_KEY = process.env.GEMINI_API_KEY || ""; 

// 启动打包后的 Express CJS 后端服务
require('./dist/server.cjs'); 

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    title: "PDF Smart Outliner - 智能书签大纲编辑器",
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    }
  });

  // 指向 Express 代理服务的 3000 端口
  mainWindow.loadURL('http://localhost:3000');

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.on('ready', createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (mainWindow === null) {
    createWindow();
  }
});
```

#### 第三步：添加构建配置与脚本
在 `package.json` 中，添加控制 Electron 的命令与入口：
```json
{
  "main": "electron-main.js",
  "scripts": {
    "build": "vite build && esbuild server.ts --bundle --platform=node --format=cjs --packages=external --sourcemap --outfile=dist/server.cjs",
    "electron:dev": "npm run build && electron .",
    "electron:pack": "npm run build && electron-builder"
  }
}
```
安装打包工具 `electron-builder`：
```bash
npm install electron-builder --save-dev
```
在 `package.json` 尾部加入 builder 的具体配置：
```json
"build": {
  "appId": "com.pdf.smartoutliner",
  "productName": "PDF-Smart-Outliner",
  "files": [
    "dist/**/*",
    "electron-main.js",
    "package.json"
  ],
  "directories": {
    "output": "release"
  },
  "win": {
    "target": "nsis"
  },
  "mac": {
    "target": "dmg"
  }
}
```

#### 第四步：一键打包生成 `.exe` 安装包！
```bash
npm run electron:pack
```
运行完成后，`release/` 文件夹下将会生成一个绿色的 **`PDF-Smart-Outliner Setup.exe`** 一键安装程序！双击即可畅快享受本地独立运行体验！

---

### 方案 B：轻量化替代（使用 Nativefier 一键封装网页）

如果您不需要将 Express 引擎和客户端打包成同一个二进制程序（即：您把这个 Express 跑在局域网服务器、或通过命令行终端在后台启动完成后，单纯想拥有一个精致的桌面独立窗口图标），可使用 **`Nativefier`** 这一极速打包方案：

1.  全局安装 Nativefier：
    ```bash
    npm install -y -g nativefier
    ```
2.  确保您的 Express 本地服务器已启动（能在浏览器正常访问 `http://localhost:3000`）；
3.  运行打包命令，将其一键转化为包含 Windows 图标的 `.exe` 专属高阶浏览器窗口：
    ```bash
    nativefier --name "智能PDF书签编辑器" "http://localhost:3000" --internal-urls ".*?localhost.*?" --single-instance
    ```
4.  这会产生一个便携文件夹，打开即是一个完美的独立应用界面。

---

## 🎨 视觉美学设计
本软件选用中性自然的 **雅致暖灰 & 奶油白纸质 (Creamy warm minimalist & Natural slate)** 双态设计：
*   **书卷墨香肌理**：告别市面上冷酷的纯黑或廉价的大红大紫网页。外层采用具有纸质感的淡雅背景色（`bg-natural-bg`），搭配富有品质感的学术衬线与极简 mono 字体混排。
*   **随动微动效 (Micro-interactions)**：采用了 `motion` 渲染引擎。每一次书签节点的点击跳转、展开缩进和增量补充，都伴随着细腻的卡片弹性阻尼动效，让重度 PDF 信息抽取工作变得轻松惬意。

---
*本项目采用 MIT 开源协议发布。立即开始本地运行，赋予您的 PDF 学习资料全新、极速触达的灵魂大纲！*
