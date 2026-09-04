import type { Config } from './config';

function readTextContent(value: unknown): string {
    if (typeof value === 'string') {
        return value;
    }
    if (!Array.isArray(value)) {
        return '';
    }

    return value
        .map(part => {
            if (typeof part === 'string') {
                return part;
            }
            if (part && typeof part === 'object' && 'text' in part) {
                return typeof part.text === 'string' ? part.text : '';
            }
            return '';
        })
        .filter(Boolean)
        .join('\n');
}

/** 兼容常见的 OpenAI Chat Completions 响应变体。 */
export function extractMessageContent(data: unknown): string {
    if (!data || typeof data !== 'object') {
        return '';
    }

    const result = data as Record<string, any>;
    const choice = result.choices?.[0];
    const content = readTextContent(choice?.message?.content).trim()
        || readTextContent(choice?.text)
        || readTextContent(result.output_text);

    return content.replace(/\n*---\s*$/, '').trim();
}

function describeApiError(status: number, body: string): string {
    try {
        const parsed = JSON.parse(body) as Record<string, any>;
        const detail = parsed?.error?.message || parsed?.message;
        if (typeof detail === 'string' && detail.trim()) {
            return `API 请求失败 (${status}): ${detail.trim()}`;
        }
    } catch {
        // 非 JSON 响应会在下方使用原始文本。
    }

    const detail = body.trim().slice(0, 1_000);
    return `API 请求失败 (${status})${detail ? `: ${detail}` : ''}`;
}

function getProviderDefaults(config: Config): Record<string, unknown> {
    const hasThinkingSetting = Object.prototype.hasOwnProperty.call(config.extraBody, 'thinking')
        || Object.prototype.hasOwnProperty.call(config.extraBody, 'reasoning_effort')
        || Object.prototype.hasOwnProperty.call(config.extraBody, 'enable_thinking')
        || Object.prototype.hasOwnProperty.call(config.extraBody, 'reasoning');

    if (!config.disableThinking || hasThinkingSetting) {
        return {};
    }

    const model = config.model.toLowerCase();

    if (/^deepseek-v4-(?:flash|pro)(?:-|$)/.test(model)) {
        return { thinking: { type: 'disabled' } };
    }

    if (/^qwen(?:3(?:\.\d+)?|-(?:plus|flash|max))(?:-|$)/.test(model)
        && !/(?:thinking|qwq)/.test(model)) {
        return { enable_thinking: false };
    }

    const supportsNoReasoning = /^gpt-(?:5\.(?:[1-9]\d*)|[6-9])(?:-|$)/.test(model)
        && !/-pro(?:-|$)/.test(model);
    if (supportsNoReasoning) {
        return { reasoning_effort: 'none' };
    }

    // OpenAI 兼容接口没有统一的思考开关。未知模型不注入参数，避免服务端返回 400。
    return {};
}

async function chatCompletion(
    config: Config,
    systemPrompt: string,
    userContent: string,
    log: (msg: string) => void
): Promise<string> {
    const url = `${config.apiBaseUrl.replace(/\/+$/, '')}/chat/completions`;

    const controller = new AbortController();
    const timeoutSeconds = Number.isFinite(config.requestTimeout) && config.requestTimeout > 0
        ? config.requestTimeout : 120;
    let timedOut = false;
    const timeoutId = setTimeout(() => {
        timedOut = true;
        controller.abort();
    }, timeoutSeconds * 1_000);

    try {
        log(`请求 API: ${url}`);
        const startedAt = performance.now();

        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${config.apiKey}`,
            },
            body: JSON.stringify({
                ...config.extraBody,
                ...getProviderDefaults(config),
                ...(config.maxTokens > 0 ? { max_tokens: config.maxTokens } : {}),
                model: config.model,
                stream: false,
                messages: [
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: userContent },
                ],
            }),
            signal: controller.signal,
        });

        log(`API 已响应: status=${response.status}, 首字节=${Math.round(performance.now() - startedAt)}ms`);

        const responseText = await response.text();
        if (!response.ok) {
            throw new Error(describeApiError(response.status, responseText));
        }

        let data: unknown;
        try {
            data = JSON.parse(responseText);
        } catch {
            throw new Error(`API 返回了无效 JSON：${responseText.slice(0, 500)}`);
        }
        const elapsed = Math.round(performance.now() - startedAt);
        const usage = (data as Record<string, any>)?.usage;
        const usageText = usage
            ? `, 输入=${usage.prompt_tokens ?? usage.input_tokens ?? '?'} tokens, 输出=${usage.completion_tokens ?? usage.output_tokens ?? '?'} tokens`
            : '';
        log(`API 响应完成: 总耗时=${elapsed}ms${usageText}`);
        const content = extractMessageContent(data);
        if (!content) {
            const responsePreview = JSON.stringify(data).slice(0, 2_000);
            log(`API 空响应: ${responsePreview}`);
            throw new Error('API 未返回可用的提交信息，请检查模型或增加 maxTokens，详情见日志');
        }

        return content;
    } catch (error) {
        if (timedOut) {
            throw new Error(`API 请求超时（${timeoutSeconds} 秒），可在设置中增大 requestTimeout`);
        }
        if (error instanceof TypeError) {
            throw new Error(`无法连接 API：${error.message}`);
        }
        throw error;
    } finally {
        clearTimeout(timeoutId);
    }
}

export async function generateCommitMessage(config: Config, diff: string, log: (msg: string) => void): Promise<string> {
    return chatCompletion(config, config.prompt, `以下为修改内容:\n\n${diff}`, log);
}

export async function translateCommitMessage(
    config: Config,
    message: string,
    log: (msg: string) => void
): Promise<string> {
    const systemPrompt = config.translatePrompt.replace(/\{\{targetLanguage\}\}/g, config.targetLanguage);
    return chatCompletion(config, systemPrompt, `待翻译的 commit message:\n\n${message}`, log);
}
