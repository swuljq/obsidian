# ASCII Diagram to Mermaid v1.1.0

在阅读视图的 `plain` / `text` / `txt` 代码块右上角点击“转 Mermaid”，直接调用 OpenAI 兼容 API，将当前 ASCII / Unicode 框图转换成 Mermaid 并原地替换代码块。不再依赖 OpenCode、Python 或外部命令行。

## 配置与使用

1. 更新后在 Obsidian 中关闭并重新启用插件。
2. 打开“设置 → ASCII Diagram to Mermaid”。
3. API 地址默认为 `https://subapi1.amshymb.com/v1`，不要追加 `/chat/completions`。
4. 填写自己的 API Key，模型默认为 `gemini-3.8-flash-high`。
5. 点击“测试连接”。测试会发送一次简短请求，产生少量 API 用量。
6. 在阅读视图中点击框图右上角的“转 Mermaid”。

API 地址和模型可修改为其他 OpenAI Chat Completions 兼容服务。旧版 OpenCode 路径和模型配置不再使用。

## 转换与错误处理

- 使用 HTTPS、Bearer 鉴权和非流式 `POST /chat/completions` 请求。
- 保留原有转换规则、4 至 8 节点线性流程的两列蛇形布局及 Mermaid 全屏查看功能。
- 仅发送当前选中的框图及转换提示词，不发送整篇笔记或其他知识库文件。
- 遇到请求失败、无效响应、输出截断或缺少 Mermaid 代码时，不替换原始代码块。
- 最长等待 120 秒；超时后恢复按钮并忽略迟到的回答。Obsidian 原生请求不支持取消，服务端可能仍继续处理并计费。
- 替换前保留原有的位置及内容检查，防止覆盖转换期间发生变化的代码块。

## 密钥安全

API Key 通过密码框输入，但保存时仍是本机 `data.json` 中的明文，不是加密存储。当前仓库已忽略 `plugins/*/data.json`，不要强制提交、分享或公开同步这个文件。插件不会将 API Key 写入源码，也不会输出原始网络错误、请求头或服务端错误正文。

## 本地测试

在仓库根目录执行 `node --test scripts/ascii-diagram-to-mermaid.test.cjs`。测试使用模拟接口，不读取真实密钥、不请求中转站、不产生 API 费用。
