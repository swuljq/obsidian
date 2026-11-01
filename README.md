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
```

插件启用及实际界面显示仍需在 Obsidian 中检查；修改插件 JavaScript 后，
可以关闭再启用对应插件，或重新加载应用。
