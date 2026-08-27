# fxxk_file 结构与功能扩展说明

本文档用于后续添加新功能时快速定位代码。fxxk_file 是一个本地运行的 FastAPI + 原生 JavaScript 前端应用。

## 1. 总体结构

```text
fxxk_file/
├─ app/
│  ├─ main.py                 # FastAPI 路由、预览页面和翻译任务入口
│  ├─ config.py               # .env 配置读取与保存
│  ├─ services/               # 文档解析、存储、翻译等业务服务
│  └─ static/
│     ├─ index.html           # 主页面结构、顶部功能菜单、各工作区容器
│     ├─ app.js               # 前端状态、事件、API 调用和工作区切换
│     ├─ scripts/features/    # 按页面拆分的前端功能模块
│     │  ├─ markdown.js       # Markdown 查看、编辑和实时预览
│     │  ├─ compare.js        # 双文件对比加载和缩放
│     │  └─ images.js         # 图片转换工具切换
│     ├─ styles.css           # CSS 入口文件，仅负责导入模块
│     └─ styles/              # tokens、布局和各功能页面样式
├─ tools/fxxk_file.py         # 启动 FastAPI 服务
├─ originals/                 # 上传后的原文件
├─ workspace/                 # 文档状态和临时工作数据
├─ output/                    # 导出的译文文件
└─ docs/                      # 使用说明和开发说明
```

## 2. 顶部功能菜单

顶部菜单位于 `app/static/index.html` 的 `.top-actions` 中，当前功能选择器为 `#functionSelect`：

- `translate`：显示文档翻译工作区 `#reviewWorkspace`
- `compare`：显示双文件对比工作区 `#compareWorkspace`

切换逻辑位于 `app/static/app.js` 的 `bindEvents()`。新增功能时，建议为每个功能建立独立的工作区容器，并在 `functionSelect` 的 change 事件中统一切换显示状态。

推荐模式：

```js
if (value === "new-feature") {
  elements.reviewWorkspace.classList.add("hidden");
  elements.compareWorkspace.classList.add("hidden");
  elements.newFeatureWorkspace.classList.remove("hidden");
}
```

## 3. 双文件对比功能

双文件对比的入口是 `#compareWorkspace`。用户选择两个文件后，`startFileCompare()` 会检查文件类型：

- 文档只能和文档比较：DOC、DOCX、PDF
- 图片只能和图片比较：浏览器支持的图片格式
- 文档和图片不能混合

文档通过现有 `/api/documents` 上传，再使用 `/api/documents/{id}/preview` 预览；图片使用浏览器 `URL.createObjectURL()` 本地加载，不上传服务器。页面逻辑位于 `app/static/scripts/features/compare.js`，左右面板的滚动同步由 `bindCompareScroll()` 完成，缩放由 `setCompareZoom()` 完成。

## 4. 新增功能的建议步骤

1. 在 `index.html` 增加功能选项和独立工作区。
2. 在 `app.js` 的 `elements` 中注册 DOM 元素。
3. 在 `bindEvents()` 中添加入口、关闭和交互事件。
4. 为功能增加独立的状态字段，避免复用其他工作区的临时状态。
5. 如需服务端能力，在 `app/main.py` 增加 `/api/...` 路由；复杂逻辑放入 `app/services/`。
6. 在 `styles/` 中为功能创建独立 CSS 文件，并使用功能前缀类名，例如 `.export-workspace`，避免覆盖已有翻译和对比样式。
7. 页面级 JavaScript 放入 `scripts/features/`，由 `app.js` 负责注入共享状态和编排调用。
8. 更新本文件和 `docs/USER_GUIDE.md`，说明用户操作方法。

## 5. 配置与启动

服务地址由 `.env` 中的 `APP_HOST` 和 `APP_PORT` 控制，当前默认端口为 `6670`。启动入口是 `start.ps1`，开发时也可以直接运行：

```powershell
.\.venv\Scripts\python.exe tools\fxxk_file.py
```

修改前端后无需重新构建；刷新浏览器即可看到静态文件变化。修改 Python 后需要重启服务。

## 6. 修改检查清单

- 新功能是否能从顶部菜单进入和退出？
- 是否不会影响已有文档翻译工作区？
- 是否处理空文件、错误格式和取消操作？
- 是否避免把不必要的文件上传到服务器？
- 是否更新使用说明和本结构文档？
- 是否运行 `node --check app/static/app.js` 检查前端语法？
