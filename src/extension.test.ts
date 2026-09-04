import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    commands: new Map<string, () => Promise<void>>(),
    showErrorMessage: vi.fn(), showWarningMessage: vi.fn(), showOutput: vi.fn(),
    getConfig: vi.fn(), getApiKey: vi.fn(), getGitAPI: vi.fn(), getRepository: vi.fn(),
    generate: vi.fn(), translate: vi.fn(),
    repo: {
        state: { indexChanges: [{ uri: 'file.ts', status: 0 }] },
        inputBox: { value: 'existing message' },
        diff: vi.fn(),
    },
}));

vi.mock('vscode', () => ({
    commands: { registerCommand: (name: string, handler: () => Promise<void>) => {
        mocks.commands.set(name, handler);
        return { dispose() {} };
    } },
    window: {
        showErrorMessage: mocks.showErrorMessage,
        showWarningMessage: mocks.showWarningMessage,
        withProgress: async (_options: unknown, callback: () => Promise<void>) => callback(),
    },
    workspace: { asRelativePath: (uri: string) => uri },
    ProgressLocation: { SourceControl: 1 },
}));
vi.mock('./config', () => ({
    getConfig: mocks.getConfig, getApiKey: mocks.getApiKey,
    setApiKey: vi.fn(), deleteApiKey: vi.fn(),
}));
vi.mock('./gitApi', () => ({ getGitAPI: mocks.getGitAPI, getRepository: mocks.getRepository }));
vi.mock('./aiProvider', () => ({ generateCommitMessage: mocks.generate, translateCommitMessage: mocks.translate }));
vi.mock('./logger', () => ({ initOutputChannel: vi.fn(), log: vi.fn(), showOutput: mocks.showOutput }));

import { activate } from './extension';

beforeEach(() => {
    vi.resetAllMocks();
    mocks.commands.clear();
    mocks.getConfig.mockReturnValue({});
    mocks.getApiKey.mockResolvedValue('test-key');
    mocks.getGitAPI.mockResolvedValue({});
    mocks.getRepository.mockResolvedValue(mocks.repo);
    mocks.repo.inputBox.value = 'existing message';
    mocks.repo.diff.mockResolvedValue('');
    mocks.generate.mockResolvedValue('fix: 更新文件');
    activate({ secrets: {}, subscriptions: [] } as any);
});

describe('commit message commands', () => {
    it('API 失败会显示通知并保留原有输入', async () => {
        mocks.generate.mockRejectedValue(new Error('API 请求失败 (401)'));
        mocks.showErrorMessage.mockResolvedValue('查看日志');
        await mocks.commands.get('potatoAiCommit.generate')!();
        expect(mocks.showErrorMessage).toHaveBeenCalledWith(expect.stringContaining('401'), '查看日志');
        expect(mocks.showOutput).toHaveBeenCalled();
        expect(mocks.repo.inputBox.value).toBe('existing message');
    });

    it('无文本 diff 时仍根据暂存文件清单生成', async () => {
        await mocks.commands.get('potatoAiCommit.generate')!();
        expect(mocks.generate).toHaveBeenCalledWith(expect.anything(), expect.stringContaining('[修改] file.ts'), expect.any(Function));
        expect(mocks.repo.inputBox.value).toBe('fix: 更新文件');
    });

    it('读取 Git diff 失败会显示通知', async () => {
        mocks.repo.diff.mockRejectedValue(new Error('Git unavailable'));
        await mocks.commands.get('potatoAiCommit.generate')!();
        expect(mocks.showErrorMessage).toHaveBeenCalledWith(expect.stringContaining('Git unavailable'), '查看日志');
    });

    it('进度条之前的配置异常也会显示通知', async () => {
        mocks.getConfig.mockImplementation(() => { throw new Error('extraBody 不是有效的 JSON'); });
        await mocks.commands.get('potatoAiCommit.generate')!();
        expect(mocks.showErrorMessage).toHaveBeenCalledWith(expect.stringContaining('extraBody'), '查看日志');
    });

    it('翻译失败也会提示且保留输入', async () => {
        mocks.translate.mockRejectedValue(new Error('API 请求超时'));
        await mocks.commands.get('potatoAiCommit.translate')!();
        expect(mocks.showErrorMessage).toHaveBeenCalledWith(expect.stringContaining('翻译 commit message 失败'), '查看日志');
        expect(mocks.repo.inputBox.value).toBe('existing message');
    });
});
