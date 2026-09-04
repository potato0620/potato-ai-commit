import { afterEach, describe, expect, it, vi } from 'vitest';
import { extractMessageContent, generateCommitMessage } from './aiProvider';
import type { Config } from './config';

const config: Config = {
    apiBaseUrl: 'https://example.com/v1', apiKey: 'test-key', model: 'test-model',
    prompt: 'generate', maxTokens: 0, requestTimeout: 1, extraBody: {},
    targetLanguage: 'English', translatePrompt: 'translate',
};

afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
});

describe('extractMessageContent', () => {
    it('读取标准 Chat Completions 文本', () => {
        expect(extractMessageContent({
            choices: [{ message: { content: 'feat: 添加登录功能' } }],
        })).toBe('feat: 添加登录功能');
    });

    it('兼容数组形式的 content', () => {
        expect(extractMessageContent({
            choices: [{ message: { content: [{ type: 'text', text: 'fix: 修复空响应' }] } }],
        })).toBe('fix: 修复空响应');
    });

    it('不会将仅有的推理过程写入提交信息', () => {
        expect(extractMessageContent({
            choices: [{ message: { content: '', reasoning_content: 'refactor: 优化生成流程' } }],
        })).toBe('');
    });

    it('无可用文本时返回空字符串', () => {
        expect(extractMessageContent({ choices: [] })).toBe('');
    });
});

describe('generateCommitMessage', () => {
    it('请求固定使用非流式响应并返回提交信息', async () => {
        const fetchMock = vi.fn().mockResolvedValue(Response.json({
            choices: [{ message: { content: 'fix: 修复生成失败' } }],
        }));
        vi.stubGlobal('fetch', fetchMock);
        const result = await generateCommitMessage({ ...config, extraBody: { stream: true } }, 'diff', vi.fn());
        expect(result).toBe('fix: 修复生成失败');
        expect(JSON.parse(fetchMock.mock.calls[0][1].body).stream).toBe(false);
    });

    it('HTTP 错误包含状态码和服务端原因', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({
            error: { message: 'Invalid API key' },
        }, { status: 401 })));
        await expect(generateCommitMessage(config, 'diff', vi.fn()))
            .rejects.toThrow('API 请求失败 (401): Invalid API key');
    });

    it('空白结果不会被当成生成成功', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({
            choices: [{ message: { content: '   ' } }],
        })));
        await expect(generateCommitMessage(config, 'diff', vi.fn()))
            .rejects.toThrow('API 未返回可用的提交信息');
    });

    it('超时返回明确错误并取消请求', async () => {
        vi.useFakeTimers();
        vi.stubGlobal('fetch', vi.fn((_url, options) => new Promise((_resolve, reject) => {
            options.signal.addEventListener('abort', () => reject(new Error('aborted')));
        })));
        const request = generateCommitMessage(config, 'diff', vi.fn());
        const assertion = expect(request).rejects.toThrow('API 请求超时（1 秒）');
        await vi.advanceTimersByTimeAsync(1_000);
        await assertion;
    });
});
