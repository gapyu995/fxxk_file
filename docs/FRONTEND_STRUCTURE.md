# 前端结构说明

前端静态资源按“共享层 + 页面功能”组织，主页面仍由 FastAPI 直接提供，不需要引入打包器即可运行。

**视觉与交互规范见 [DESIGN.md](DESIGN.md)**：字阶（下限 12px）、字重、间距、圆角、动效、
布局与 z-index 阶梯都在那里定义，本文只描述代码结构与模块职责。

## 目录

```text
app/static/
├─ index.html                         # 页面骨架与各工作区容器
├─ styles.css                         # CSS 入口，仅负责按顺序导入样式
├─ styles/
│  ├─ tokens.css                      # 颜色、字号、字重、间距、圆角、动效令牌
│  ├─ base.css                        # reset、通用控件、按钮、弹窗、提示
│  ├─ layout.css                      # 顶栏、侧栏、主布局、空状态
│  ├─ translate.css                   # 文档翻译工作区
│  ├─ compare.css                     # 双文件对比工作区
│  ├─ images.css                      # 图片转换工作区
│  ├─ markdown.css                    # Markdown 查看、编辑、目录、表格
│  ├─ convert.css                     # 文件转换工作区
│  └─ responsive.css                  # 响应式媒体查询和容器查询
├─ app.js                             # 应用编排、共享状态、API 与翻译流程
├─ vendor/                            # 内置第三方脚本（离线可用，附带许可证）
│  ├─ purify.min.js                   # DOMPurify，渲染前净化 HTML
│  ├─ diff.min.js                     # jsdiff，对比视图文本差异
│  ├─ markdown-it.min.js              # markdown-it，Markdown 解析引擎
│  └─ markdown-it-task-lists.min.js   # 任务列表（- [x]）插件
└─ scripts/
   └─ features/
      ├─ markdown.js                  # Markdown 页面功能模块
      ├─ compare.js                   # 双文件对比页面功能模块
      ├─ convert.js                   # 文件转换页面功能模块
      └─ images.js                    # 图片转换页面功能模块
```

`convert.js` 是六个转换组的唯一前端入口：`GROUPS` 驱动侧栏列表，`fillStaticOptions()` 用模块内的格式表填充各个下拉框（因此新增格式只改一处），`RUNNERS` 把组名映射到各自的提交函数。所有实际转换都调用 `/api/convert/*`，浏览器端不复制规则——一套实现、一套测试，避免前后端行为漂移。转换能力由 `GET /api/convert/capabilities` 返回，缺依赖的组会置灰并显示安装命令。

## 第三方脚本（vendor）

预览、Markdown 和对比功能不访问 CDN，第三方脚本全部放在 `app/static/vendor/`，与 PDF.js、docx-preview、JSZip 同一约定：

| 文件 | 项目 | 许可证 | 用途 |
|---|---|---|---|
| `purify.min.js` | [DOMPurify](https://github.com/cure53/DOMPurify) | Apache-2.0 / MPL-2.0 | Markdown 渲染结果写入 DOM 前净化 |
| `diff.min.js` | [jsdiff](https://github.com/kpdecker/jsdiff) | BSD-3-Clause | 双文件对比的文本差异（`window.Diff`） |
| `markdown-it.min.js` | [markdown-it](https://github.com/markdown-it/markdown-it) | MIT | Markdown 解析（`window.markdownit`） |
| `markdown-it-task-lists.min.js` | [markdown-it-task-lists](https://github.com/revin/markdown-it-task-lists) | ISC | `- [x]` 任务列表 |

每个脚本旁的 `*.LICENSE.txt` 是原始许可证文本，升级版本时必须同步替换。脚本在 `index.html` 中以普通 `<script>` 在功能模块之前加载，因此 `markdown.js` / `compare.js` 通过 `window` 全局对象访问它们，并对缺失情况做降级处理。

## CSS 约定

- `styles.css` 是唯一需要在 HTML 中引用的样式入口。
- 页面样式只能放在对应功能文件中，并使用页面前缀类名，例如 `.markdown-*`、`.compare-*`。
- 跨页面复用的控件放入 `base.css`；布局骨架放入 `layout.css`；不要在功能文件中复制全局变量。
- 导入顺序固定为：tokens → base → layout → translate → compare → images → markdown → convert → responsive。
- 新增页面时，在 `index.html` 添加独立 workspace 容器，在 `styles/` 添加同名样式文件，再把它加入入口导入清单。

### 对话框与浮层

三个对话框（`#shortcutDialog`、`#settingsDialog`、`#compareDialog`）共用 `base.css` 里的三段式结构，新增对话框时直接复用，不要另起一套：

| 类名 | 作用 |
|---|---|
| `.dialog-heading` | 固定头部：标题、说明、右上角关闭按钮 |
| `.dialog-body` | 唯一可滚动区（`overflow-y: auto`），长表单在这里滚动 |
| `.dialog-actions` | 固定底部操作条，保存／取消始终可见 |

`dialog[open]` 被设为 flex 纵向布局，并限制最大高度为 `calc(100dvh - 48px)`；这样在 560px 高的窗口里表单内部滚动，而底部按钮不会被挤出屏幕。表单本身用 `.dialog-form`（flex 纵向、`min-height: 0`）承载，保证 `.dialog-body` 能正确收缩。

### 设计令牌

**视觉规范见 [docs/DESIGN.md](DESIGN.md)。** 该文档是字阶、字重、间距、圆角、动效与
布局的唯一依据，并说明每条规则的理由；本节不再重复维护一份令牌表。

落地约束：

- `app/static/styles/tokens.css` 是唯一定义颜色、字号、字重、圆角、间距、动效时长的地方，
  功能样式表只引用 `var(--*)`。
- 字号下限 **12px**；`font-size` / `font-weight` / `border-radius` 必须取令牌、`clamp()`
  或百分比，`transition` / `animation` 时长必须取 `--motion-*`。
- 以上三条由 CI 的「Check design tokens are used everywhere」强制，本地等价脚本是
  `.tmp/integration/token-check.py`。

工作区工具栏（`.document-toolbar`、`.markdown-toolbar`、`.convert-toolbar`、`*.toolbar`）统一 `flex-wrap: wrap`，窗口变窄时按钮换行而不是被裁切；译文工具栏的按钮按意图分成 `.toolbar-group`（语言方向／执行／视图／输出），组间用 1px 竖线分隔，「原件版面对照 / 逐段精确对照」用 `.view-switch` 表现为单一分段控件。

Markdown 阅读器没有行长上限：`#markdownContent` 的宽度全部给正文。目录的**显隐**与
**宽度**是两个独立控件（`docs/DESIGN.md` §7.6）：工具栏的 `#markdownTocToggle`（`Ctrl+\`）
负责显隐，正文左侧的 `#markdownTocSplitter` 只负责宽度（140–420px）。两者分别写入
`fxxk_file-display-preferences-v1` 的 `markdownTocVisible` 与 `markdownTocWidth`。
目录还会按滚动位置高亮当前标题（`#markdownTocCurrent` 显示节名，右缘为阅读进度条）。

## JavaScript 约定

`app.js` 负责应用启动、共享状态、工作区切换和翻译功能。页面级逻辑应逐步移动到 `scripts/features/<feature>.js`，通过工厂函数接收 `state`、`elements` 和需要的回调，返回页面动作方法。

译文区新增的段落筛选与批量操作也在 `app.js` 中：

- `matchesFilter(segment, mode)` 与后端 `segment_batch.matches_filter` 保持同一套语义（`untranslated` 含 `queued`）；改一处必须同步另一处。
- `renderRows(segments)` 按当前筛选渲染，`mergeRows(segments)` 在筛选结果发生变化时改走重渲染，因此轮询过程中段落进出筛选都能正确显示。
- `runBulkAction(action)` 只发一次请求，然后用响应里的 `document` 重建界面，避免本地状态与服务端漂移。
- 顶部状态点通过 `setSaveState(text, status)` 写入，`status` 决定 `data-state`（`saving`/`saved`/`dirty`/`error`）。
- 快捷键集中在 `SHORTCUTS` 数组，`renderShortcutList()` 只渲染当前工作区可用的组合键。
- `showToast` 支持第三个参数传入 `{label, run}` 操作按钮；`ERROR_ACTIONS` 会把鉴权、代理、连接类错误映射到「打开模型设置」或「重试翻译」。
- 功能切换集中在一处：`WORKSPACES` 数组声明每个工作区的 `pages`，`renderFunctionNav()` 渲染侧栏的一级导航，`renderPageTabs()` 渲染顶栏的二级页签，`functionSelect` 的 change 分支负责显示对应工作区并调用 `applyFunctionTheme()`。新增工作区要同时加入 `WORKSPACES`、`index.html` 的 `functionSelect` 选项和侧栏的 `data-sidebar`，缺一项都会让面板显示不出来。
- `activePageKey()` 由实时状态（`state.viewMode`、`state.imageTool`、`state.markdownEditMode`）推导当前页签，不记录"最后点击的页签"，因此用快捷键或工具栏进入某页时高亮同样正确。
- 主题（`applyTheme`）与侧栏折叠（`setSidebarCollapsed`）各写入一次 `<html data-theme>` / `body.sidebar-collapsed`，首屏由 `index.html` 的内联脚本落地，刷新不闪。

当前 Markdown 模块暴露：

- `openFiles`：打开本地 Markdown 文件
- `toggleEdit`：切换源码编辑与实时预览
- `updatePreview`：重新渲染 Markdown
- `toggleFullscreen`：进入/退出全屏
- `setFontScale`、`toggleTableFit`：阅读设置
- `updateLayout`、`updateStickyHeading`：布局和吸顶状态维护

表格列宽拖拽实现在 `markdown.js` 内部（`bindTableColumnResize`，事件委托 + 闭包状态机）：渲染时生成 `<colgroup><col data-col-index>`，拖动第 1..N-1 列右缘手柄调整该列与右邻列宽度（clamp 80px 下限），`dblclick` 复位单列；`manual-col-widths` 类强制 `table-layout:fixed`，仅当前会话生效，重新渲染（编辑输入、切换文档）后恢复默认。`updateMarkdownLayout` 跳过带手动宽度的表格，`toggleTableFit` 切换时清除全部手动宽度。

Markdown 解析使用内置的 markdown-it（`getMarkdownEngine`），`markdownToHtml` 只负责把引擎输出转换为既有 DOM 约定，因此下游的目录、表格列宽拖拽和状态栏统计无需改动：

1. `engine.render(source)` 生成 HTML（`html:false`，源文件里的原始 HTML 仍按文本转义）。
2. `sanitizeMarkdownHtml` 交给 DOMPurify（`ADD_TAGS: input/col/colgroup`，`ADD_ATTR: style/target/rel`，禁用事件属性）。
3. `applyMarkdownDomContract` 为标题补 `markdown-heading-N` id 与目录数据、对 `javascript:` 等非白名单链接降级为纯文本、给每个 `<table>` 包裹 `.markdown-table-wrap` 并生成 `<colgroup><col>`。
4. 返回值中的 `fragment` 由 `renderMarkdownInto` 用 `replaceChildren` 挂载，不再使用 `innerHTML`。

`markdownToHtmlLegacy` 保留原有手写解析器，仅在 markdown-it 缺失时兜底。

`compare.js` 和 `images.js` 使用相同的工厂函数约定。`compare.js` 新增 `refreshDiff`：两份文档经 `/api/documents` 上传并由服务端统一抽取文本，浏览器端用 jsdiff 做行级差异，渲染到 `#compareDiffPanel`（开关为工具栏的「高亮差异」）。

模块使用普通 `defer` 脚本加载，兼容当前无构建步骤的本地部署。后续如果引入 Vite/Webpack，只需将这些功能模块作为入口依赖，不需要改变页面结构。

## CI/CD 建议检查

提交前至少执行：

```powershell
node --check app/static/app.js
node --check app/static/scripts/features/markdown.js
node --check app/static/scripts/features/compare.js
node --check app/static/scripts/features/images.js
python -m compileall -q app tools
python -m pytest tests -q
git diff --check
```

静态资源采用查询参数缓存版本，例如 `styles.css?v=...`。修改 CSS 模块或页面脚本后更新版本字符串，避免桌面端浏览器继续使用旧缓存。
