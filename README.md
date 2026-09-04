# Generate Git Message

一个 VSCode 扩展，利用 OpenAI 兼容 API 根据 Git 暂存区的代码变更自动生成规范的 commit message。

## 功能特性

- 一键生成符合 Conventional Commits 规范的中文 commit message
- 支持所有 OpenAI 兼容的 API 端点（OpenAI、DeepSeek、Ollama 等）
- 自定义提示词模板
- 支持自定义 API 请求体参数（适配不同模型的特殊参数）
- 在源代码管理工具栏提供快捷按钮
- 零运行时依赖

## 使用方式

1. 在 VSCode 源代码管理面板中暂存（stage）要提交的文件
2. 点击源代码管理标题栏上的 ✨ 图标，或通过命令面板执行 `生成提交记录`
3. 等待生成完成，commit message 会自动填入输入框

## 配置 API Key

提供两种方式，按优先级依次尝试：

1. **命令设置（推荐）**：在命令面板（`Cmd+Shift+P`）运行 `Generate Git Message: 设置 API Key`，密钥将安全存储在系统密钥链中（macOS Keychain / Windows Credential Manager / Linux libsecret）
2. **环境变量**：设置 `GENERATE_GIT_MESSAGE_API_KEY` 环境变量

可通过命令 `Generate Git Message: 删除 API Key` 移除已存储的密钥。

## 配置项

在 VSCode 设置中搜索 `Generate Git Message` 进行配置：

| 配置项 | 说明 | 默认值 |
|--------|------|--------|
| `generateGitMessage.apiBaseUrl` | OpenAI 兼容 API 的基础 URL | `https://api.openai.com/v1` |
| `generateGitMessage.model` | 模型名称 | `gpt-4o-mini` |
| `generateGitMessage.prompt` | 自定义提示词（为空则使用内置模板） | （空） |
| `generateGitMessage.maxTokens` | 最大生成 token 数（0 表示不限制） | `0` |
| `generateGitMessage.requestTimeout` | API 请求超时时间（秒） | `120` |
| `generateGitMessage.extraBody` | 额外的请求体参数（JSON 字符串，会合并到 API 请求体中） | （空） |

## 排查生成失败

生成或翻译失败时会显示错误通知，点击「查看日志」可打开详细输出。也可以在命令面板执行 `Generate Git Message: 查看日志`。

- 超时：检查 API 服务是否可用，较慢的模型可调大 `requestTimeout`。
- 空响应：检查模型名称和 `maxTokens`；推理模型需要为最终答案保留足够的 token。
- `extraBody`：必须是有效的 JSON 对象。扩展固定使用非流式响应（`stream: false`）。

失败时会保留输入框原有内容；暂存区只有文件变更清单而没有文本 diff 时，也会尝试生成。

## 开发

```bash
pnpm install       # 安装依赖
pnpm build         # 构建
pnpm watch         # 监听模式
pnpm package       # 生产构建（压缩）
pnpm vsix          # 构建并打包为 .vsix 安装包
```

## 许可证

MIT
