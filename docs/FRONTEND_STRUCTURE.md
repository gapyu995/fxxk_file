# 前端结构说明

前端静态资源按“共享层 + 页面功能”组织，主页面仍由 FastAPI 直接提供，不需要引入打包器即可运行。

## 目录

```text
app/static/
├─ index.html                         # 页面骨架与各工作区容器
├─ styles.css                         # CSS 入口，仅负责按顺序导入样式
├─ styles/
│  ├─ tokens.css                      # 颜色、间距、字体和全局设计变量
│  ├─ base.css                        # reset、通用控件、按钮、弹窗、提示
│  ├─ layout.css                      # 顶栏、侧栏、主布局、空状态
│  ├─ translate.css                   # 文档翻译工作区
│  ├─ compare.css                     # 双文件对比工作区
│  ├─ images.css                      # 图片转换工作区
│  ├─ markdown.css                    # Markdown 查看、编辑、目录、表格
│  └─ responsive.css                  # 响应式媒体查询和容器查询
├─ app.js                             # 应用编排、共享状态、API 与翻译流程
└─ scripts/
   └─ features/
      ├─ markdown.js                  # Markdown 页面功能模块
      ├─ compare.js                   # 双文件对比页面功能模块
      └─ images.js                    # 图片转换页面功能模块
```

## CSS 约定

- `styles.css` 是唯一需要在 HTML 中引用的样式入口。
- 页面样式只能放在对应功能文件中，并使用页面前缀类名，例如 `.markdown-*`、`.compare-*`。
- 跨页面复用的控件放入 `base.css`；布局骨架放入 `layout.css`；不要在功能文件中复制全局变量。
- 导入顺序固定为：tokens → base → layout → translate → compare → images → markdown → responsive。
- 新增页面时，在 `index.html` 添加独立 workspace 容器，在 `styles/` 添加同名样式文件，再把它加入入口导入清单。

## JavaScript 约定

`app.js` 负责应用启动、共享状态、工作区切换和翻译功能。页面级逻辑应逐步移动到 `scripts/features/<feature>.js`，通过工厂函数接收 `state`、`elements` 和需要的回调，返回页面动作方法。

当前 Markdown 模块暴露：

- `openFiles`：打开本地 Markdown 文件
- `toggleEdit`：切换源码编辑与实时预览
- `updatePreview`：重新渲染 Markdown
- `toggleFullscreen`：进入/退出全屏
- `setFontScale`、`toggleTableFit`：阅读设置
- `updateLayout`、`updateStickyHeading`：布局和吸顶状态维护

`compare.js` 和 `images.js` 使用相同的工厂函数约定，分别暴露对比加载/缩放和图片工具切换方法。翻译流程暂时保留在 `app.js`，因为它与共享文档状态、自动保存和 API 轮询耦合较深；后续可在不改变页面契约的前提下继续迁移。

模块使用普通 `defer` 脚本加载，兼容当前无构建步骤的本地部署。后续如果引入 Vite/Webpack，只需将这些功能模块作为入口依赖，不需要改变页面结构。

## CI/CD 建议检查

提交前至少执行：

```powershell
node --check app/static/app.js
node --check app/static/scripts/features/markdown.js
node --check app/static/scripts/features/compare.js
node --check app/static/scripts/features/images.js
python -m compileall -q app tools
git diff --check
```

静态资源采用查询参数缓存版本，例如 `styles.css?v=...`。修改 CSS 模块或页面脚本后更新版本字符串，避免桌面端浏览器继续使用旧缓存。
