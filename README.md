# fxxk_file

fxxk_file 是一个本地运行的中英双向文档翻译与审校工具。它支持拖入 DOC、DOCX 和 PDF，自动提取文本、调用 OpenAI 或 Anthropic 兼容接口翻译，并在左右对照界面中逐段审校，最终导出 DOCX 译文。

原文件、工作状态和导出文件均保存在本机。服务默认只监听 `127.0.0.1`，不会主动把文档上传到翻译接口以外的服务。

## 主要功能

- 支持中文译英文、英文译中文，并自动判断原文语言。
- 支持 `.doc`、`.docx`、文本型 `.pdf`，单文件最大 80 MB。
- 支持 OpenAI Chat Completions 兼容接口、CCSwitch 网关和 Anthropic Messages 兼容接口。
- 自动批量翻译、失败重试、长段落拆分，并实时显示进度。
- 原件版面对照与逐段精确对照两种审校视图。
- 译文自动保存，可锁定段落、标记已审校或单独重译。
- DOC/DOCX 译文基于原文副本回填，尽量保留版式、表格和图片。
- 支持 CSV、TSV、JSON 术语表以及项目级翻译风格指南。
- PDF.js、docx-preview 等前端组件已内置，预览时无需访问 CDN。

## 环境要求

- Windows 10/11（桌面启动方式面向 Windows）
- Python 3.10 或更高版本
- 首次安装依赖时需要网络连接
- 可用的翻译模型接口或本地兼容网关
- 处理旧版 `.doc` 时需要安装 [LibreOffice](https://www.libreoffice.org/)

`.docx` 和文本型 `.pdf` 不要求安装 LibreOffice。扫描版 PDF 必须先用 OCR 工具添加文本层。

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

设置保存在本机 `.env` 文件中，保存后立即生效。不要提交含真实 API Key 的 `.env`。

OpenAI 兼容接口最终请求路径为 `/chat/completions`；Anthropic 兼容接口最终请求路径为 `/messages`。如果本地网关被系统代理拦截，关闭“使用系统代理”。

## 基本使用

1. 将一个或多个 DOC、DOCX 或 PDF 拖到页面中，也可以点击选择文件。
2. 根据需要勾选“上传后立即翻译”。
3. 确认工具栏中的源语言和目标语言。
4. 在“原件版面对照”或“逐段精确对照”中查看原文和译文。
5. 直接编辑译文；停止输入约 0.65 秒后会自动保存并更新输出文件。
6. 点击“下载译文 DOCX”生成最新译文，并打开系统另存为窗口。

更完整的界面说明、快捷键、术语表格式和故障排查见 [使用手册](docs/USER_GUIDE.md)。

## 文件目录

```text
fxxk_file/
├─ app/                 Web 应用、翻译服务和静态页面
├─ tools/               浏览器版及桌面版启动入口
├─ originals/           上传后永久保留的原文件
├─ output/              生成的译文 DOCX
├─ workspace/           当前会话的任务状态
├─ glossaries/          术语表与风格指南
├─ inbox/               预留的待处理目录
├─ docs/                使用文档
├─ .env.example         配置示例
├─ requirements.txt     Python 依赖
├─ start.ps1            PowerShell 启动脚本
└─ 翻译脚本.cmd          Windows 双击启动入口
```

原件存放在 `originals/`，译文存放在 `output/`，两者不会相互覆盖。正常关闭程序时，已完成的部分译文会先写入 `output/`，随后清除 `workspace/` 中的临时任务记录，因此下次启动时“最近文档”列表为空。

## 配置项

除网页设置外，也可以直接编辑 `.env`：

| 配置项 | 默认值 | 说明 |
|---|---:|---|
| `TRANSLATION_PROTOCOL` | `openai` | `openai` 或 `anthropic` |
| `TRANSLATION_BASE_URL` | 示例地址 | 网关基础地址或完整请求地址 |
| `TRANSLATION_MODEL` | 示例模型名 | 网关提供的模型 ID |
| `TRANSLATION_API_KEY` | 空 | 接口密钥 |
| `TRANSLATION_USE_SYSTEM_PROXY` | `false` | 是否读取系统/环境代理 |
| `TRANSLATION_BATCH_SIZE` | `3` | 每次请求最多段落数，范围 1–10 |
| `TRANSLATION_REQUEST_CHAR_LIMIT` | `6000` | 单次请求原文字符上限，范围 500–20000 |
| `TRANSLATION_MAX_RETRIES` | `5` | 可重试错误的最大重试次数，范围 0–10 |
| `APP_HOST` | `127.0.0.1` | 本地服务监听地址 |
| `APP_PORT` | `6670` | 本地服务端口 |

除非确实需要局域网访问，否则不要把 `APP_HOST` 改为 `0.0.0.0`。

## 文档格式说明

- DOCX：可提取正文和表格单元格中的非空段落；导出时尽量保留原版式和图片。
- DOC：必须先由 LibreOffice 转换为 DOCX；也可自行在 Word/WPS 中另存为 DOCX。
- PDF：文本型 PDF 可直接翻译；扫描件需先 OCR。PDF 的译文会输出为新的 DOCX，不保留原 PDF 版式。
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
- PDF 没有文字：该文件很可能是扫描件，请先 OCR。
- DOC 无法读取：安装 LibreOffice，或将文件另存为 DOCX。
- 译文版式有差异：复杂 Word 对象无法保证与 Word/WPS 完全一致，请打开导出文件人工复核。

## 安全提示

- API Key 仅保存在本机 `.env`，但翻译文本会发送到你配置的模型服务。
- 使用敏感文档前，请确认模型服务的数据处理和保留政策符合要求。
- 默认仅监听本机回环地址；开放局域网访问前应自行增加访问控制和网络防护。

## 开源组件

文档预览使用内置的 PDF.js 3.11.174、docx-preview 0.3.6 和 JSZip 3.10.1。相应许可证位于 `app/static/vendor/`。
