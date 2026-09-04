export interface DiffChunk {
    filePath: string;
    content: string;
}

export interface FileChange {
    path: string;
    status: 'added' | 'modified' | 'deleted' | 'renamed' | 'copied';
    oldPath?: string;
}

const STATUS_LABELS: Record<FileChange['status'], string> = {
    added: '新增',
    modified: '修改',
    deleted: '删除',
    renamed: '重命名',
    copied: '复制',
};

const MAX_SUMMARY_BUDGET = 4_000;
const MAX_DIFF_BUDGET = 8_000;
const TRUNCATION_MARKER = '... (详细 diff 已按文件均衡截断，请结合文件清单生成)';
const LOW_VALUE_DETAIL_PATTERN = /(?:^|\/)(?:pnpm-lock\.yaml|package-lock\.json|yarn\.lock|bun\.lockb?|[^/]+\.min\.(?:js|css)|[^/]+\.map)$/i;

export function parseDiffChunks(rawDiff: string): DiffChunk[] {
    const trimmed = rawDiff.trim();
    if (!trimmed) {
        return [];
    }

    const positions: number[] = [];
    let searchFrom = 0;
    while (true) {
        const idx = trimmed.indexOf('diff --git', searchFrom);
        if (idx === -1) break;
        positions.push(idx);
        searchFrom = idx + 1;
    }

    if (positions.length === 0) {
        return [];
    }

    const chunks: DiffChunk[] = [];
    for (let i = 0; i < positions.length; i++) {
        const start = positions[i];
        const end = i + 1 < positions.length ? positions[i + 1] : trimmed.length;
        const content = trimmed.slice(start, end).trim();

        const match = content.match(/^diff --git a\/(.+?) b\/(.+)/m);
        if (match) {
            chunks.push({
                filePath: match[2],
                content,
            });
        }
    }

    return chunks;
}

export function buildFileSummary(changes: readonly FileChange[], budget = MAX_SUMMARY_BUDGET): string {
    if (changes.length === 0) {
        return '';
    }

    const lines = changes.map(c => {
        const label = STATUS_LABELS[c.status];
        if (c.status === 'renamed' && c.oldPath) {
            return `[${label}] ${c.oldPath} → ${c.path}`;
        }
        if (c.status === 'copied' && c.oldPath) {
            return `[${label}] ${c.oldPath} → ${c.path}`;
        }
        return `[${label}] ${c.path}`;
    });

    const included: string[] = [];
    let length = 0;
    for (const line of lines) {
        const addedLength = (included.length ? 1 : 0) + line.length;
        if (length + addedLength > budget) break;
        included.push(line);
        length += addedLength;
    }

    const omitted = lines.length - included.length;
    if (omitted > 0) {
        included.push(`... 另有 ${omitted} 个文件未列出`);
    }
    return included.join('\n');
}

export function processChunk(chunk: DiffChunk, status: FileChange['status']): string {
    if (chunk.content.includes('Binary files')) {
        const statusLabel = STATUS_LABELS[status];
        return `[二进制文件 ${statusLabel}]: ${chunk.filePath}`;
    }

    if (isDeletionChunk(chunk.content)) {
        const lineCount = countRemovedLines(chunk.content);
        return `[删除] ${chunk.filePath} (共 ${lineCount} 行)`;
    }

    if (LOW_VALUE_DETAIL_PATTERN.test(chunk.filePath)) {
        return `[${STATUS_LABELS[status]}] ${chunk.filePath}（省略生成文件的详细 diff）`;
    }

    return chunk.content;
}

function isDeletionChunk(content: string): boolean {
    return content.includes('+++ /dev/null') || content.includes('deleted file mode');
}

function countRemovedLines(content: string): number {
    let count = 0;
    for (const line of content.split('\n')) {
        if (line.startsWith('-') && !line.startsWith('---')) {
            count++;
        }
    }
    return count;
}

interface TruncateResult {
    content: string;
    truncated: boolean;
}

export function smartTruncate(chunks: string[], budget: number): TruncateResult {
    if (chunks.length === 0) {
        return { content: '', truncated: false };
    }

    const joined = chunks.join('\n\n');
    if (joined.length <= budget) {
        return { content: joined, truncated: false };
    }
    if (budget <= TRUNCATION_MARKER.length) {
        return { content: TRUNCATION_MARKER.slice(0, Math.max(0, budget)), truncated: true };
    }

    // 将预算均分给每个文件，避免排在前面的大文件吞掉全部上下文。
    const separatorsLength = Math.max(0, chunks.length - 1) * 2;
    const contentBudget = Math.max(0, budget - TRUNCATION_MARKER.length - 2 - separatorsLength);
    const perChunkBudget = Math.max(1, Math.floor(contentBudget / chunks.length));
    const included = chunks.map(chunk => chunk.slice(0, perChunkBudget));
    const content = `${included.join('\n\n')}\n\n${TRUNCATION_MARKER}`;

    return { content, truncated: true };
}

export function processDiff(rawDiff: string, changes: readonly FileChange[]): string {
    const summary = buildFileSummary(changes);

    if (!rawDiff.trim()) {
        return summary ? `## 文件变更清单\n${summary}` : '';
    }

    const chunks = parseDiffChunks(rawDiff);

    const statusMap = new Map(changes.map(c => [c.path, c.status]));

    const processed = chunks.map(chunk => {
        const status = statusMap.get(chunk.filePath) ?? 'modified';
        return processChunk(chunk, status);
    });

    const { content: diffContent } = smartTruncate(processed, MAX_DIFF_BUDGET);

    const parts: string[] = [];
    if (summary) {
        parts.push(`## 文件变更清单\n${summary}`);
    }
    if (diffContent) {
        parts.push(`## 详细变更\n${diffContent}`);
    }

    return parts.join('\n\n');
}
