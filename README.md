# fxxk_file

fxxk_file 是一个本地运行的中英双向文档翻译与审校工具。它支持拖入 DOC、DOCX 和 PDF，自动提取文本、调用 OpenAI 或 Anthropic 兼容接口翻译，并在左右对照界面中逐段审校，最终导出 DOCX 译文。

原文件、工作状态和导出文件均保存在本机。服务默认只监听 `127.0.0.1`，不会主动把文档上传到翻译接口以外的服务。

## 主要功能

- 支持中文译英文、英文译中文，并自动判断原文语言。
- 中文译文可自动转换为简体或繁體（本机 zhconv 完成，不消耗模型额度），也可随时对整篇文档重跑转换。
- 支持 `.doc`、`.docx`、文本型 `.pdf`，单文件最大 80 MB。
- PDF 文本按版面坐标还原阅读顺序（pdfplumber），双栏排版不再串行。
- 可选离线 OCR：扫描版 PDF 可在本机用 RapidOCR 识别后再翻译，文档不离开本机。
- 支持 OpenAI Chat Completions 兼容接口、CCSwitch 网关和 Anthropic Messages 兼容接口。
- 自动批量翻译、失败重试、长段落拆分，并实时显示进度。
- 原件版面对照与逐段精确对照两种审校视图。
- 内置「双文件对比」：文档与图片并排对照，可选用 jsdiff 在本地高亮两份文档的文本差异。
- 内置「图片转换」工具：PNG→SVG 矢量化与 SVG→PNG 光栅化，全程在浏览器本地完成，图片不会上传到服务器。
- 内置「文件转换」工作区，六组小众转换全部在本机完成：
  - 中文排版：自动检测 GB18030／Big5／Shift-JIS 等遗留编码、全角↔半角、中英标点互转；
  - 表格互转：CSV、TSV、JSON、Markdown 表格、HTML 表格任意互转，来源格式可自动识别；
  - 字幕互转：SRT／VTT／ASS／SSA／LRC 互转，以及双语合并（按时间轴对齐）与双语拆分；
  - 文档互转：HTML → Markdown、DOCX → Markdown、Markdown → DOCX；
  - PDF 页面：合并、按页拆分、提取、删页、旋转、文字水印；
  - 数字与拼音：金额中文大写、整数转中文数字、汉字拼音标注。
- 内置 Markdown 查看器：支持全屏阅读、标题目录、表格自适应、源码编辑和实时预览；渲染引擎为 markdown-it，写入页面前经 DOMPurify 净化。
- 译文自动保存，可锁定段落、标记已审校或单独重译。
- 按状态筛选段落（待翻译／机器译文／已编辑／已审校／已锁定），并批量锁定、标记审校、撤销审校或清空译文；批量操作在服务端按筛选条件执行，长文档也不会漏改。
- 翻译过程可随时停止，已完成的段落全部保留。
- 顶部状态点显示保存状态，报错提示会附带「打开模型设置」或「重试翻译」按钮。
- 按 `?` 打开快捷键面板，面板只列出当前工作区可用的组合键。
- DOC/DOCX 译文基于原文副本回填，尽量保留版式、表格和图片。
- 支持 CSV、TSV、JSON 术语表以及项目级翻译风格指南。
- PDF.js、docx-preview、markdown-it、DOMPurify、jsdiff 等前端组件已内置，运行时无需访问 CDN。

## 环境要求

- Windows 10/11（桌面启动方式面向 Windows）
- Python 3.10 或更高版本
- 首次安装依赖时需要网络连接
- 可用的翻译模型接口或本地兼容网关
- 处理旧版 `.doc` 时需要安装 [LibreOffice](https://www.libreoffice.org/)

`.docx` 和文本型 `.pdf` 不要求安装 LibreOffice。扫描版 PDF 默认需要先添加文本层，也可以安装可选的离线 OCR 组件后由程序自动识别（见下文「可选：离线 OCR」）。

## 快速开始

### 方式一：双击启动（推荐）

1. 双击项目根目录中的 `翻译脚本.cmd`。
2. 首次启动会创建 `.venv` 并安装依赖，请等待安装完成。
3. 程序会自动打开 fxxk_file 桌面窗口。
4. 关闭窗口时，本地服务会一同退出。

### 方式二：PowerShell 启动

```powershell
Set-Location D:\github\fxxk_file
.\start.ps1
```

然后在浏览器中打开 <http://127.0.0.1:6670>。

### 手动安装与启动

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
Copy-Item .env.example .env
python tools\fxxk_file.py
```

## 首次配置模型

启动程序后，点击右上角“模型设置”，填写：

- 接口协议：OpenAI 兼容 / CCSwitch，或 Anthropic Messages 兼容。
- 网关地址：可填写基础地址，如 `http://127.0.0.1:8000/v1`，也可填写完整接口地址。
- 模型名称：填写网关实际提供的模型 ID。
- API Key：本地无鉴权网关可以留空。
- 批量参数：默认每批 3 段、最多 6000 个原文字符、失败重试 5 次。
- 译文中文：中文译文使用简体还是繁體，见「可选：离线 OCR」下方的「繁简转换」说明。

设置保存在本机 `.env` 文件中，保存后立即生效。不要提交含真实 API Key 的 `.env`。

OpenAI 兼容接口最终请求路径为 `/chat/completions`；Anthropic 兼容接口最终请求路径为 `/messages`。如果本地网关被系统代理拦截，关闭“使用系统代理”。

### 可选：离线 OCR（扫描版 PDF）

```powershell
.\.venv\Scripts\python.exe -m pip install -r requirements-ocr.txt
```

安装后左侧会出现可用的「扫描件自动 OCR（离线）」勾选项，扫描版 PDF 会在本机识别后再翻译。该组件约 200 MB，只在需要时安装；未安装时其余功能不受影响。

### 可选：文件转换依赖

```powershell
.\.venv\Scripts\python.exe -m pip install -r requirements-convert.txt
```

只有「字幕互转」「文档互转（HTML 方向）」「PDF 页面」「汉字转拼音」四组需要它；「中文排版」「表格互转」「中文数字」不依赖任何第三方包。未安装时对应的转换类型会置灰并显示安装命令。

### 繁简转换

左侧「译文中文」控制中文译文的字形（跟随目标语言／简体／繁體／不转换）。转换由本机 zhconv 完成，不消耗模型额度；工具栏的「繁简转换」按钮可对整篇文档立即重跑一次。

## 基本使用

1. 将一个或多个 DOC、DOCX 或 PDF 拖到页面中，也可以点击选择文件。
2. 根据需要勾选“上传后立即翻译”；扫描件可勾选“扫描件自动 OCR（离线）”。
3. 确认工具栏中的源语言、目标语言和左侧「译文中文」。
4. 在“原件版面对照”或“逐段精确对照”中查看原文和译文。
5. 直接编辑译文；停止输入约 0.65 秒后会自动保存并更新输出文件。
6. 点击“下载译文 DOCX”生成最新译文，并打开系统另存为窗口。

从顶部「功能」菜单还可以进入「双文件对比」（可勾选「高亮差异」在本地比对两份文档）、「文件转换」（六组小众转换）和「Markdown 查看」（markdown-it 渲染，进入页面前经 DOMPurify 净化）。

更完整的界面说明、快捷键、术语表格式和故障排查见 [使用手册](docs/USER_GUIDE.md)；界面视觉规范（字阶下限 12px、色彩、间距、动效、布局）见 [设计规范](docs/DESIGN.md)。

## 文件目录

```text
fxxk_file/
├─ app/                 Web 应用、翻译服务和静态页面
├─ tools/               浏览器版及桌面版启动入口
├─ tests/               服务层与集成回归测试
├─ originals/           上传后永久保留的原文件
├─ output/              生成的译文 DOCX
├─ workspace/           当前会话的任务状态
├─ glossaries/          术语表与风格指南
├─ inbox/               预留的待处理目录
├─ docs/                使用文档与设计规范
├─ .env.example         配置示例
├─ requirements.txt     Python 依赖
├─ requirements-ocr.txt 可选的离线 OCR 依赖
├─ requirements-convert.txt 可选的文件转换依赖
├─ start.ps1            PowerShell 启动脚本
└─ 翻译脚本.cmd          Windows 双击启动入口
```

前端页面按功能拆分的资源结构、脚本模块约定和 CI/CD 检查项见 [前端结构说明](docs/FRONTEND_STRUCTURE.md)。

原件存放在 `originals/`，译文存放在 `output/`，两者不会相互覆盖。正常关闭程序时，已完成的部分译文会先写入 `output/`，随后清除 `workspace/` 中的临时任务记录，因此下次启动时“最近文档”列表为空。

## 配置项

除网页设置外，也可以直接编辑 `.env`：

| 配置项 | 默认值 | 说明 |
|---|---:|---|
| `TRANSLATION_PROTOCOL` | `openai` | `openai` 或 `anthropic` |
| `TRANSLATION_BASE_URL` | `https://api.deepseek.com/v1` | 网关基础地址或完整请求地址 |
| `TRANSLATION_MODEL` | `deepseek-chat` | 网关提供的模型 ID |
| `TRANSLATION_API_KEY` | 空 | 接口密钥 |
| `TRANSLATION_USE_SYSTEM_PROXY` | `false` | 是否读取系统/环境代理 |
| `TRANSLATION_BATCH_SIZE` | `3` | 每次请求最多段落数，范围 1–10 |
| `TRANSLATION_REQUEST_CHAR_LIMIT` | `6000` | 单次请求原文字符上限，范围 500–20000 |
| `TRANSLATION_MAX_RETRIES` | `5` | 可重试错误的最大重试次数，范围 0–10 |
| `TRANSLATION_ZH_SCRIPT` | `auto` | 中文译文用字：`auto`、`simplified`、`traditional` 或 `off` |
| `APP_HOST` | `127.0.0.1` | 本地服务监听地址 |
| `APP_PORT` | `6670` | 本地服务端口 |
| `APP_DOWNLOAD_DIR` | `D:\` | 下载译文时另存为对话框的默认目录 |
| `TRANSLATION_PDF_LAYOUT_MODE` | `plain` | PDF 抽取方式：`plain` 速度优先，`layout` 按坐标还原多栏阅读顺序（约慢 2.5 倍） |

除非确实需要局域网访问，否则不要把 `APP_HOST` 改为 `0.0.0.0`。

## 大文件性能

- PDF 默认使用 pdfplumber 的快速抽取（`plain`）。此前的 `layout=True` 会把每一行视觉行当成独立段落，134 页的 GB 征求意见稿因此产生 1570 个段落（约 356 KB 首屏响应），导入时浏览器会卡住数秒；`plain` 对同一文件是 156 段。
- 需要恢复双栏阅读顺序时，把 `TRANSLATION_PDF_LAYOUT_MODE` 设为 `layout`。该模式改用词坐标重建行和分栏，段落数与 `plain` 相当。
- 译文行高按需测量：只有视口附近的行会写入 `height`，长文档滚动时逐步补齐，渲染 3000 段的耗时从数秒降到约 0.35 秒。

## 文档格式说明

- DOCX：可提取正文和表格单元格中的非空段落；导出时尽量保留原版式和图片。
- DOC：必须先由 LibreOffice 转换为 DOCX；也可自行在 Word/WPS 中另存为 DOCX。
- PDF：默认按 pdfplumber 的快速模式提取并直接翻译；需要双栏阅读顺序时切换 `layout` 模式。扫描件可开启离线 OCR 或先用其他工具添加文本层。PDF 的译文会输出为新的 DOCX，不保留原 PDF 版式。
- DOCX/DOC 导出要求模板段落数与导入时一致，程序会按 `w:tc` 元素稳定遍历，重复合并单元格不会导致计数漂移。
- 图片中的文字不会执行 OCR，也不会被翻译。文本框、批注、SmartArt、复杂域等 Word 特殊对象应人工复核。

## 术语与风格

将术语文件放入 `glossaries/`。程序会在每批翻译前自动读取，无需重启：

- `terms.csv` 或其他 CSV/TSV 文件：适合表格维护。
- JSON 文件：适合由其他系统生成。
- `style_guide.md`：填写语气、标点、大小写、日期等规则。

字段格式与示例见 [术语表说明](glossaries/README.md)。

## 常见问题

- 无法启动：确认 `python --version` 可执行且为 Python 3.10+，首次启动时保持网络可用。
- 端口被占用：关闭已有 fxxk_file 进程，或修改 `.env` 中的 `APP_PORT`。
- 模型返回 401/403：检查 API Key、模型权限、接口协议和网关地址。
- 本地网关返回 403：在模型设置中关闭“使用系统代理”。
- PDF 没有文字：该文件很可能是扫描件。开启“扫描件自动 OCR（离线）”（需先安装 `requirements-ocr.txt`），或先用其他工具添加文本层。
- 繁简转换选项置灰：说明 zhconv 未安装，执行 `python -m pip install -r requirements.txt`。
- DOC 无法读取：安装 LibreOffice，或将文件另存为 DOCX。
- 译文版式有差异：复杂 Word 对象无法保证与 Word/WPS 完全一致，请打开导出文件人工复核。

## 开发与测试

```powershell
.\.venv\Scripts\python.exe -m compileall -q app tools
.\.venv\Scripts\python.exe -m pytest tests -q
```

## 安全提示

- API Key 仅保存在本机 `.env`，但翻译文本会发送到你配置的模型服务。
- 使用敏感文档前，请确认模型服务的数据处理和保留政策符合要求。
- 默认仅监听本机回环地址；开放局域网访问前应自行增加访问控制和网络防护。

## 开源组件

文档预览使用内置的 PDF.js 3.11.174、docx-preview 0.3.6 和 JSZip 3.10.1；Markdown 渲染使用 markdown-it 15 与 markdown-it-task-lists 2.1.1，写入页面前由 DOMPurify 3 净化；双文件差异高亮使用 jsdiff 9。相应许可证位于 `app/static/vendor/`。

服务端集成的开源项目：zhconv（繁简转换）、pySBD（句子边界）、pdfplumber（PDF 版面抽取），以及可选的 RapidOCR 与 pypdfium2（扫描件离线 OCR）。文件转换使用 pysubs2（字幕，MIT）、markdownify（HTML，MIT）、pikepdf（PDF 页面，MPL-2.0）、pypinyin（拼音，MIT）与 charset-normalizer（编码检测，MIT）。模块边界与降级策略见 [后端结构说明](docs/BACKEND_STRUCTURE.md)。

Backend module boundaries and CI/CD checks are documented in [docs/BACKEND_STRUCTURE.md](docs/BACKEND_STRUCTURE.md).
