# ASCII Diagram to Mermaid v1.0.10

## 本版修复

v1.0.10 不再只依赖 OpenCode 遵守布局提示。插件会在本地识别 4 至 8 节点的纯线性流程，并确定性重写为带空白行列的两列蛇形布局；即使模型漏掉 `space` 或返回 `flowchart LR/TB`，也会自动修正。分支、循环和字段较多的数据实体图不会被重写。

## v1.0.9

v1.0.9 对 4 至 8 节点的纯线性流程使用带箭头通道的两列蛇形 `block-beta`：节点列之间保留一个空白列，每两行节点之间保留一个完整空白行。这样既不会横向超出页面，也不会因节点紧贴而丢失连接线。

## v1.0.8

v1.0.8 将 4 个以上的纯线性流程改为可靠的 `flowchart LR` 横向布局。此前的 `block-beta` 紧凑网格会让相邻节点间的连接线过短，在 Obsidian 中可能只显示箭头或完全看不到线段。Mermaid 容器现在也允许横向滚动。

## v1.0.7

v1.0.7 将自动紧凑布局门槛降到 4 个节点：4 节点线性流程使用 `2×2` 蛇形布局，5 个以上使用 3 列蛇形布局；阅读视图中的 Mermaid SVG 同时自动居中，减少单侧留白。

## v1.0.6

v1.0.6 增加自动紧凑布局：5 个以上且没有分支、合并或循环的线性流程会优先使用 `block-beta` 蛇形分行；其他关系图继续使用 `flowchart LR/TB`。同时增加中英文标签智能换行，并支持提取未带围栏的 `block-beta` 输出。

## v1.0.5

v1.0.5 关闭 OpenCode 子进程的标准输入，避免 CLI 等待输入结束而一直显示“转换中”；同时增加 120 秒超时，超时后会终止本次转换并恢复按钮。

## v1.0.4

v1.0.4 修复插件关闭并重新启用后，当前阅读视图中的旧按钮仍调用旧版代码的问题。插件卸载时现在会移除按钮及其事件监听器。

## v1.0.3

v1.0.3 修复 OpenCode 将位置提示词误认为第二个 `--file` 文件路径的问题，并清理错误提示中的 ANSI 颜色控制码。

调用参数现在按以下顺序传递：

`opencode run <message> --file <task.txt>`

## v1.0.2

v1.0.1 在 Windows 上直接通过 `cmd.exe /c` 启动 npm 全局安装的 `opencode.cmd`。
某些机器会因为 `cmd.exe` 的引号解析规则导致路径被当成错误的命令；同时中文错误信息还可能出现乱码。

v1.0.2 改为：

1. Windows 的 `.cmd/.bat` 通过 PowerShell 调用，不再手工拼接 `cmd.exe` 命令行；
2. OpenCode 路径和参数通过环境变量传递，避免路径空格、引号和 Unicode 造成解析错误；
3. 自动把误粘贴的外层引号去掉，例如：
   `"C:\\Users\\Ljq\\AppData\\Roaming\\npm\\opencode.cmd"`；
4. Windows 子进程切换 UTF-8 输出，错误信息尽量不再以乱码显示；
5. “检测 OpenCode”现在不只是检查文件存在，而是真正执行 `opencode --version`。

## Windows 推荐设置

OpenCode 路径填写：

`C:\\Users\\Ljq\\AppData\\Roaming\\npm\\opencode.cmd`

**不要手动加双引号。** 即使加了，本版也会自动去除外层引号。

然后点击：

`设置 -> ASCII Diagram to Mermaid -> 检测 OpenCode`

看到 `OpenCode 正常：...` 后再转换框图。

## 使用

在阅读视图的 `plain` / `text` / `txt` 代码块右上角点击 `转 Mermaid`。
插件会调用 OpenCode，将当前框图转换成 Mermaid 并原地替换代码块。
