import * as vscode from 'vscode';
import defaultPrompt from './prompt.md';
import defaultTranslatePrompt from './translate-prompt.md';

const SECTION = 'generateGitMessage';
const SECRET_KEY = 'apiKey';

export interface Config {
    apiBaseUrl: string;
    apiKey: string;
    model: string;
    prompt: string;
    maxTokens: number;
    requestTimeout: number;
    extraBody: Record<string, unknown>;
    targetLanguage: string;
    translatePrompt: string;
}

function parseExtraBody(raw: string): Record<string, unknown> {
    if (!raw.trim()) return {};
    let parsed: unknown;
    try {
        parsed = JSON.parse(raw);
    } catch {
        throw new Error('extraBody 不是有效的 JSON，请检查 Generate Git Message 设置');
    }
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        throw new Error('extraBody 必须是 JSON 对象');
    }
    return parsed as Record<string, unknown>;
}

export function getConfig(secrets: vscode.SecretStorage): Config {
    const cfg = vscode.workspace.getConfiguration(SECTION);
    return {
        apiBaseUrl: cfg.get<string>('apiBaseUrl', 'https://api.openai.com/v1'),
        apiKey: '', // 需要通过 getApiKey 异步获取
        model: cfg.get<string>('model', 'gpt-4o-mini'),
        prompt: cfg.get<string>('prompt', '') || defaultPrompt,
        maxTokens: cfg.get<number>('maxTokens', 0),
        requestTimeout: cfg.get<number>('requestTimeout', 120),
        extraBody: parseExtraBody(cfg.get<string>('extraBody', '')),
        targetLanguage: cfg.get<string>('targetLanguage', 'English'),
        translatePrompt: cfg.get<string>('translatePrompt', '') || defaultTranslatePrompt,
    };
}

/** 优先级: SecretStorage > 环境变量 */
export async function getApiKey(secrets: vscode.SecretStorage): Promise<string> {
    const stored = await secrets.get(SECRET_KEY);
    if (stored) return stored;

    return process.env.GENERATE_GIT_MESSAGE_API_KEY || '';
}

export async function setApiKey(secrets: vscode.SecretStorage, key: string): Promise<void> {
    await secrets.store(SECRET_KEY, key);
}

export async function deleteApiKey(secrets: vscode.SecretStorage): Promise<void> {
    await secrets.delete(SECRET_KEY);
}
