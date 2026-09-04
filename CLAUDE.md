# CLAUDE.md

本文件为 Claude Code (claude.ai/code) 在此仓库中工作时提供指导。

## 构建与开发命令

```bash
pnpm build          # 用 esbuild 打包 TypeScript → dist/extension.js（CommonJS）
pnpm watch          # 监听模式，文件变更自动重新构建
pnpm package        # 生产构建（压缩）
pnpm vsix           # 构建并打包为 .vsix 扩展安装包
```

当前未配置测试框架。

## 架构

这是一个 VSCode 扩展，利用 OpenAI 兼容 API 自动生成 git commit 信息。

**数据流：** 用户触发命令 → `extension.ts` 编排流程 → `config.ts` 读取配置 → `gitApi.ts` 通过 VSCode 内置 Git 扩展 API 获取暂存区 diff → `aiProvider.ts` 调用 AI API → 结果写入 Git 输入框。

**核心模块：**
- `src/extension.ts` — 入口文件，在源代码管理标题栏注册 `potatoAiCommit.generate` 命令
- `src/gitApi.ts` — 封装 VSCode Git 扩展 API（非 shell 命令），获取仓库和 diff
- `src/config.ts` — 读取 `potatoAiCommit.*` 命名空间下的 VSCode 设置
- `src/aiProvider.ts` — OpenAI 兼容端点的 HTTP 客户端，使用 Node.js 内置 `fetch`
- `src/prompt.md` — 默认提示词模板（conventional commits 格式，中文输出）
- `src/git.d.ts` — VSCode Git 扩展 API 的类型定义

**构建：** esbuild 将所有 TypeScript 打包为单个 `dist/extension.js`。`.md` 提示词文件通过 esbuild loader 以文本方式导入。VSCode 模块标记为外部依赖。

## 配置项

扩展设置（均以 `potatoAiCommit.` 为前缀）：`apiBaseUrl`、`apiKey`、`model`、`prompt`、`maxTokens`。

## 开发约定

- 语言：UI 文案和文档使用中文
- 包管理器：pnpm
- TypeScript 严格模式，目标 ES2022
- 零运行时依赖——仅使用 Node.js 内置模块和 VSCode API
