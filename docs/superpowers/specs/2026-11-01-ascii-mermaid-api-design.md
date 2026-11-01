# ASCII 框图直接调用 API 转换

## 已确认的方案

用户同意移除 OpenCode 调用，改为直接使用自建 Sub2API 中转站提供的 OpenAI 兼容 Chat Completions 接口。以用户提供的 Python 脚本作为协议参考，不复制脚本中的密钥，不修改脚本。

## 请求与设置

- 默认基础地址：`https://subapi1.amshymb.com/v1`。
- 默认模型：`gemini-3.8-flash-high`。
- 设置提供基础地址、密码框 API Key、模型和测试连接按钮。
- 使用 Obsidian 原生 `requestUrl`，发送 HTTPS `POST /chat/completions`，Bearer 鉴权、`messages`、非流式响应、4096 输出 token 上限。
- 仅发送当前框图和已有转换规则，提取 `choices[0].message.content`，随后沿用原 Mermaid 提取、布局和替换逻辑。
- 不保留 CLI 双模式；旧 OpenCode 路径和模型字段不参与新请求。

## 安全与失败处理

API Key 由用户自行填写，保存在 Git 已忽略的插件 `data.json`。密码框仅隐藏显示，不等于加密；设置及文档明确提示明文保存。错误信息不展示原始网络异常、请求头或服务端响应正文。

缺少配置、鉴权失败、限流、服务器故障、无效 JSON、空回答、截断和无 Mermaid 输出均不替换原文。最长等待 120 秒，恢复按钮，忽略迟到结果；原生请求无法取消，服务端可能继续计费。原有转换期间的位置与内容检查保持不变。

## 验证

使用 Node 内置测试和模拟 Obsidian API 检查请求协议、配置默认值与验证、异常脱敏、超时、输出提取、紧凑布局、按钮恢复、原文保护和连接测试。不在自动测试中读取真实密钥或访问真实模型；真实连接由用户在插件设置中填写密钥后测试。
