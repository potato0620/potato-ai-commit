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

export function buildFileSummary(changes: readonly FileChange[]): string {
    if (changes.length === 0) {
        return '';
    }

    return changes.map(c => {
        const label = STATUS_LABELS[c.status];
        if (c.status === 'renamed' && c.oldPath) {
            return `[${label}] ${c.oldPath} → ${c.path}`;
        }
        if (c.status === 'copied' && c.oldPath) {
            return `[${label}] ${c.oldPath} → ${c.path}`;
        }
        return `[${label}] ${c.path}`;
    }).join('\n');
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

    const included: string[] = [];
    let totalLength = 0;
    let truncated = false;

    for (const chunk of chunks) {
        const separator = included.length > 0 ? '\n\n' : '';
        const addedLength = separator.length + chunk.length;

        if (totalLength + addedLength <= budget) {
            included.push(chunk);
            totalLength += addedLength;
        } else {
            truncated = true;
            break;
        }
    }

    let content = included.join('\n\n');
    if (truncated) {
        content += '\n\n... (部分文件的详细 diff 已省略，请根据文件清单生成)';
    }

    return { content, truncated };
}

const MAX_DIFF_BUDGET = 10_000;

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
