import * as vscode from 'vscode';
import { getGitAPI, getRepository } from './gitApi';
import { getConfig, getApiKey, setApiKey, deleteApiKey } from './config';
import { generateCommitMessage, translateCommitMessage } from './aiProvider';
import { initOutputChannel, log, showOutput } from './logger';
import { processDiff, FileChange } from './diffProcessor';

// 对应 git.d.ts 中 Status const enum 的值
const STATUS_INDEX_MODIFIED = 0;
const STATUS_INDEX_ADDED = 1;
const STATUS_INDEX_DELETED = 2;
const STATUS_INDEX_RENAMED = 3;
const STATUS_INDEX_COPIED = 4;

const STATUS_MAP: Record<number, FileChange['status']> = {
    [STATUS_INDEX_MODIFIED]: 'modified',
    [STATUS_INDEX_ADDED]: 'added',
    [STATUS_INDEX_DELETED]: 'deleted',
    [STATUS_INDEX_RENAMED]: 'renamed',
    [STATUS_INDEX_COPIED]: 'copied',
};

function getErrorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

async function reportFailure(action: '生成' | '翻译', error: unknown): Promise<void> {
    const message = getErrorMessage(error);
    log(`${action}失败: ${message}`);
    const selected = await vscode.window.showErrorMessage(
        `${action} commit message 失败：${message}`,
        '查看日志'
    );
    if (selected === '查看日志') {
        showOutput();
    }
}

function registerMessageCommand(command: string, action: '生成' | '翻译', handler: () => Promise<void>) {
    return vscode.commands.registerCommand(command, async () => {
        try {
            await handler();
        } catch (error) {
            await reportFailure(action, error);
        }
    });
}

function toFileChanges(indexChanges: readonly import('./git').Change[]): FileChange[] {
    return indexChanges.map(c => {
        const path = vscode.workspace.asRelativePath(c.uri);
        const status = STATUS_MAP[c.status] ?? 'modified';
        const result: FileChange = { path, status };
        if (c.status === STATUS_INDEX_RENAMED || c.status === STATUS_INDEX_COPIED) {
            result.oldPath = vscode.workspace.asRelativePath(c.originalUri);
        }
        return result;
    });
}

export function activate(context: vscode.ExtensionContext) {
    initOutputChannel(context);

    const generateCmd = registerMessageCommand('potatoAiCommit.generate', '生成', async () => {
        log('=== 开始生成 commit message ===');

        const config = getConfig(context.secrets);
        config.apiKey = await getApiKey(context.secrets);
        log(`配置: apiBaseUrl=${config.apiBaseUrl}, model=${config.model}, maxTokens=${config.maxTokens}`);

        if (!config.apiKey) {
            log('错误: 未配置 apiKey');
            vscode.window.showErrorMessage('请先配置 API Key：运行命令 "Potato AI Commit: 设置 API Key"');
            return;
        }

        const gitApi = await getGitAPI();
        if (!gitApi) {
            log('错误: 无法获取 Git 扩展 API');
            vscode.window.showErrorMessage('无法获取 Git 扩展 API');
            return;
        }

        const repo = await getRepository(gitApi);
        if (!repo) {
            log('错误: 未找到 Git 仓库');
            vscode.window.showErrorMessage('未找到 Git 仓库');
            return;
        }

        if (repo.state.indexChanges.length === 0) {
            log('警告: 没有暂存的文件');
            vscode.window.showWarningMessage('没有暂存的文件，请先 stage 要提交的更改');
            return;
        }

        log(`暂存文件数: ${repo.state.indexChanges.length}`);

        await vscode.window.withProgress(
            {
                location: vscode.ProgressLocation.SourceControl,
                title: '正在生成 commit message...',
            },
            async () => {
                const gitStartedAt = performance.now();
                const rawDiff = await repo.diff(true);
                const gitElapsed = Math.round(performance.now() - gitStartedAt);
                const processStartedAt = performance.now();
                const fileChanges = toFileChanges(repo.state.indexChanges);
                const diff = processDiff(rawDiff, fileChanges);
                const processElapsed = Math.round(performance.now() - processStartedAt);
                if (!diff.trim()) {
                    throw new Error('无法读取暂存区变更，请确认文件已暂存后重试');
                }
                if (!rawDiff.trim()) {
                    log('暂存区无文本 diff，将根据文件变更清单生成');
                } else {
                    log(`原始 diff 长度: ${rawDiff.length} 字符`);
                }
                log(`准备输入: Git=${gitElapsed}ms, 处理=${processElapsed}ms, 原始=${rawDiff.length} 字符, 发送=${diff.length} 字符`);

                const message = await generateCommitMessage(config, diff, log);
                log(`生成成功: ${message}`);
                repo.inputBox.value = message;
            }
        );
    });

    const translateCmd = registerMessageCommand('potatoAiCommit.translate', '翻译', async () => {
        log('=== 开始翻译 commit message ===');

        const config = getConfig(context.secrets);
        config.apiKey = await getApiKey(context.secrets);
        log(`配置: apiBaseUrl=${config.apiBaseUrl}, model=${config.model}, targetLanguage=${config.targetLanguage}`);

        if (!config.apiKey) {
            log('错误: 未配置 apiKey');
            vscode.window.showErrorMessage('请先配置 API Key：运行命令 "Potato AI Commit: 设置 API Key"');
            return;
        }

        const gitApi = await getGitAPI();
        if (!gitApi) {
            log('错误: 无法获取 Git 扩展 API');
            vscode.window.showErrorMessage('无法获取 Git 扩展 API');
            return;
        }

        const repo = await getRepository(gitApi);
        if (!repo) {
            log('错误: 未找到 Git 仓库');
            vscode.window.showErrorMessage('未找到 Git 仓库');
            return;
        }

        const message = repo.inputBox.value.trim();
        if (!message) {
            log('警告: commit 输入框为空');
            vscode.window.showWarningMessage('提交信息输入框为空，请先输入或生成 commit message');
            return;
        }

        log(`待翻译内容长度: ${message.length} 字符`);

        await vscode.window.withProgress(
            {
                location: vscode.ProgressLocation.SourceControl,
                title: `正在翻译 commit message（${config.targetLanguage}）...`,
            },
            async () => {
                const translated = await translateCommitMessage(config, message, log);
                log(`翻译成功: ${translated}`);
                repo.inputBox.value = translated;
            }
        );
    });

    const setKeyCmd = vscode.commands.registerCommand('potatoAiCommit.setApiKey', async () => {
        const input = await vscode.window.showInputBox({
            prompt: '输入 API Key（将安全存储在系统密钥链中）',
            password: true,
            ignoreFocusOut: true,
        });
        if (input !== undefined) {
            await setApiKey(context.secrets, input);
            vscode.window.showInformationMessage('API Key 已安全保存');
        }
    });

    const deleteKeyCmd = vscode.commands.registerCommand('potatoAiCommit.deleteApiKey', async () => {
        const current = await getApiKey(context.secrets);
        if (!current) {
            vscode.window.showInformationMessage('当前未存储 API Key');
            return;
        }
        const confirm = await vscode.window.showWarningMessage(
            '确定要删除已存储的 API Key 吗？',
            { modal: true },
            '删除'
        );
        if (confirm === '删除') {
            await deleteApiKey(context.secrets);
            vscode.window.showInformationMessage('API Key 已删除');
        }
    });

    const showOutputCmd = vscode.commands.registerCommand('potatoAiCommit.showOutput', () => {
        showOutput();
    });

    context.subscriptions.push(generateCmd, translateCmd, setKeyCmd, deleteKeyCmd, showOutputCmd);
}

export function deactivate() {}
