# Obsidian 配置、主题与插件

lojiq 的 Obsidian 配置仓库。仓库根目录对应知识库中的 `.obsidian`，
不包含知识库根目录的笔记正文或附件。

## 目录

| 路径 | 内容 |
| --- | --- |
| `themes/lojiqUI/` | 自定义的软件界面主题，作者 lojiq |
| `themes/Baseline/` | 保留的 Baseline 主题，便于参考与对比 |
| `snippets/` | 字体、代码、图片、列表、引用和表格排版，以及本地字体文件 |
| `plugins/` | 已安装插件、自定义插件与测试 |
| `docs/` | 自定义功能设计文档 |
| `appearance.json` | 当前主题及启用的 CSS 片段 |
| `community-plugins.json` | 第三方插件启用列表 |
| `core-plugins.json` | 内置插件开关 |
| `app.json`、`hotkeys.json` | 基础设置与快捷键 |
| `bookmarks.json`、`graph.json` | 书签与图谱设置 |

## 样式分工

`lojiqUI` 只负责软件界面的框架、面板、侧栏、标签页、菜单和设置窗口。
笔记正文继续由这些 CSS 片段负责：

- `reading-layout`：阅读与编辑视图的纸张宽度、页边距和背景。
- `typography`：字体、标题、正文排版。
- `code-style`：代码块外观。
- `content-style`：引用和内容块。
- `image-style`：图片对齐。
- `list-hierarchy`：列表层级。
- `better-table-style`：表格样式。

## 自定义功能

- `lojiq-floating-outline`：笔记内可拖动调整宽度的大纲、标题折叠与章节跳转。
- `schedule-countdown`：日程倒计时和任务完成时间记录。
- `code-title-fence`：渲染代码块的标题与行号。
- 其他插件的说明见各自目录；第三方插件及主题的署名、版权归原作者所有。

## 本机数据与安全

`.gitignore` 排除工作区布局、最近打开记录、插件 `data.json`、迁移状态、
ZIP 历史包、日志、依赖目录以及常见凭证文件。

因此，插件中的 API Key、Token、终端路径、OpenCode 本机路径和大纲宽度
不会随仓库同步。换电脑后，这些设置需要在 Obsidian 中单独配置。
书签仍然会同步，其中包含笔记名称和路径；共享仓库前应确认这些信息可以公开。

不要在主题、脚本或其他受版本管理的文件中直接写入密钥。

## 日常管理

在这个 `.obsidian` 目录中执行：

```powershell
git status
git diff
git add .
git commit -m "Update Obsidian configuration"
git push
```

同步远程修改前，先处理本地未提交内容，再执行 `git pull --ff-only`。
本仓库已经连接 `origin`，`main` 跟踪远程的 `main` 分支。
不要将整个知识库初始化为本仓库，以免把私人笔记一并提交。

## 测试

需要本机安装 Node.js：

```powershell
node plugins/lojiq-floating-outline/outline.test.js
node plugins/schedule-countdown/countdown-core.test.js
node plugins/schedule-countdown/task-completion.test.js
node scripts/typography-fonts.test.cjs
```

插件启用及实际界面显示仍需在 Obsidian 中检查；修改插件 JavaScript 后，
可以关闭再启用对应插件，或重新加载应用。
纸张高度的浏览器回归页为 `tests/reading-layout.html`，自动检查浅深色、
长短笔记及不同面板高度；测试保留原生外层的自动高度，避免错误地预设为撑满。

## 字体资源

`typography.css` 末尾的自动生成区内嵌三份字体，只启用该片段即可使用，
不依赖操作系统安装字体、额外插件或本机绝对路径。
排版规则位于字体数据之前，可以正常编辑；不要手动编辑内嵌数据。
正文基准字号由片段前部的 `--typography-body-size` 控制，默认 18px，
标题按现有比例随之缩放，不改变软件界面或大纲字号。
替换 `snippets/font.css/fonts/` 中的原始字体后，执行
`node scripts/build-typography-fonts.cjs` 重新生成，再运行字体测试。

## 阅读布局

`reading-layout.css` 为阅读、实时预览和源码编辑提供相同的连续宽版纸张，
不是固定尺寸的 A4 页面。
最大外宽 1040px，左右页边距默认各 32px，上下各 28px，正文最大宽度约 976px。
窗口较窄时纸张自动缩小，左右页边距也会收紧；浅深色背景分别适配。
短笔记的纸张至少铺满可见区域，长笔记随内容延伸，滚到文末后只留
`--reading-canvas-gutter` 指定的灰色外边距（默认 16px）。
阅读外层、编辑外层和滚动容器均明确继承笔记面板高度，避免白纸随短文本缩成卡片。
屏幕视图取消原生的额外半屏底部滚动留白，纸张内部仍保留 28px 页边距。
参数集中在文件开头的 `--reading-*` 变量中，字体仍由 `typography.css` 控制。

大纲显示时纸张靠分隔线对齐，由纸张自身提供左侧页边距，避免重复居中或
累加留白；大纲隐藏时纸张居中。编辑器的纸张、内容容器和每一行文字均解除
原生的 700px 最大行宽限制，避免纸张变宽但文字提前换行、右侧留白。
但不修改光标、选择区、折叠按钮、代码行内容或笔记内嵌预览的样式。
本片段也不设置固定纸张高度、打印样式或 PDF 导出的纸张大小。
