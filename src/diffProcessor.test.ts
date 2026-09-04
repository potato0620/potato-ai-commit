import { describe, it, expect } from 'vitest';
import {
    parseDiffChunks,
    buildFileSummary,
    processChunk,
    smartTruncate,
    processDiff,
    DiffChunk,
    FileChange,
} from './diffProcessor';

describe('diffProcessor', () => {
    it('smoke test', () => {
        expect(1 + 1).toBe(2);
    });
});

describe('parseDiffChunks', () => {
    it('应将多文件 diff 拆分为独立 chunk', () => {
        const rawDiff = `diff --git a/file1.ts b/file1.ts
index abc..def 100644
--- a/file1.ts
+++ b/file1.ts
@@ -1,3 +1,3 @@
 aaa
-bbb
+BBB
 ccc

diff --git a/file2.ts b/file2.ts
index 123..456 100644
--- a/file2.ts
+++ b/file2.ts
@@ -1,2 +1,3 @@
 xxx
+yyy
 zzz`;

        const chunks = parseDiffChunks(rawDiff);
        expect(chunks).toHaveLength(2);
        expect(chunks[0].filePath).toBe('file1.ts');
        expect(chunks[0].content).toContain('-bbb');
        expect(chunks[1].filePath).toBe('file2.ts');
        expect(chunks[1].content).toContain('+yyy');
    });

    it('空 diff 应返回空数组', () => {
        expect(parseDiffChunks('')).toHaveLength(0);
        expect(parseDiffChunks('   ')).toHaveLength(0);
    });

    it('单文件 diff 应返回单个 chunk', () => {
        const rawDiff = `diff --git a/solo.ts b/solo.ts
--- a/solo.ts
+++ b/solo.ts
@@ -1 +1 @@
-old
+new`;

        const chunks = parseDiffChunks(rawDiff);
        expect(chunks).toHaveLength(1);
        expect(chunks[0].filePath).toBe('solo.ts');
    });

    it('应正确提取含子目录的文件路径', () => {
        const rawDiff = `diff --git a/src/utils/helper.ts b/src/utils/helper.ts
--- a/src/utils/helper.ts
+++ b/src/utils/helper.ts
@@ -1 +1 @@
-a
+b`;

        const chunks = parseDiffChunks(rawDiff);
        expect(chunks[0].filePath).toBe('src/utils/helper.ts');
    });
});

describe('buildFileSummary', () => {
    it('应生成文件变更摘要', () => {
        const changes: FileChange[] = [
            { path: 'src/auth.ts', status: 'added' },
            { path: 'src/api.ts', status: 'modified' },
            { path: 'src/old.ts', status: 'deleted' },
            { path: 'src/utils.ts', status: 'renamed', oldPath: 'src/helpers.ts' },
        ];

        const summary = buildFileSummary(changes);
        expect(summary).toContain('[新增] src/auth.ts');
        expect(summary).toContain('[修改] src/api.ts');
        expect(summary).toContain('[删除] src/old.ts');
        expect(summary).toContain('[重命名] src/helpers.ts → src/utils.ts');
    });

    it('空列表应返回空字符串', () => {
        expect(buildFileSummary([])).toBe('');
    });

    it('应处理 copied 状态', () => {
        const changes: FileChange[] = [
            { path: 'src/copy.ts', status: 'copied', oldPath: 'src/orig.ts' },
        ];
        const summary = buildFileSummary(changes);
        expect(summary).toContain('[复制] src/orig.ts → src/copy.ts');
    });
});

describe('processChunk', () => {
    it('二进制文件应替换为一行说明', () => {
        const chunk: DiffChunk = {
            filePath: 'assets/logo.png',
            content: `diff --git a/assets/logo.png b/assets/logo.png
new file mode 100644
index 0000000..abc1234
Binary files /dev/null and b/assets/logo.png differ`,
        };
        const result = processChunk(chunk, 'added');
        expect(result).toBe('[二进制文件 新增]: assets/logo.png');
    });

    it('二进制文件修改应显示修改状态', () => {
        const chunk: DiffChunk = {
            filePath: 'public/favicon.ico',
            content: `diff --git a/public/favicon.ico b/public/favicon.ico
index abc..def 100644
Binary files a/public/favicon.ico and b/public/favicon.ico differ`,
        };
        const result = processChunk(chunk, 'modified');
        expect(result).toBe('[二进制文件 修改]: public/favicon.ico');
    });

    it('删除文件应替换为一行摘要含行数', () => {
        const chunk: DiffChunk = {
            filePath: 'src/deprecated.ts',
            content: `diff --git a/src/deprecated.ts b/src/deprecated.ts
deleted file mode 100644
index abc..000
--- a/src/deprecated.ts
+++ /dev/null
@@ -1,5 +0,0 @@
-line1
-line2
-line3
-line4
-line5`,
        };
        const result = processChunk(chunk, 'deleted');
        expect(result).toBe('[删除] src/deprecated.ts (共 5 行)');
    });

    it('普通文件应保留完整 diff', () => {
        const content = `diff --git a/src/api.ts b/src/api.ts
index abc..def 100644
--- a/src/api.ts
+++ b/src/api.ts
@@ -1,3 +1,3 @@
 aaa
-bbb
+BBB
 ccc`;
        const chunk: DiffChunk = {
            filePath: 'src/api.ts',
            content,
        };
        const result = processChunk(chunk, 'modified');
        expect(result).toBe(content);
    });
});

describe('smartTruncate', () => {
    it('未超预算应原样返回', () => {
        const chunks = ['chunk1', 'chunk2'];
        const result = smartTruncate(chunks, 1000);
        expect(result.content).toBe('chunk1\n\nchunk2');
        expect(result.truncated).toBe(false);
    });

    it('超预算应截断并标记', () => {
        const chunks = [
            'a'.repeat(6000),
            'b'.repeat(6000),
        ];
        const result = smartTruncate(chunks, 10000);
        expect(result.truncated).toBe(true);
        expect(result.content).toContain('a'.repeat(6000));
        expect(result.content).not.toContain('b'.repeat(6000));
        expect(result.content).toContain('部分文件的详细 diff 已省略');
    });

    it('空 chunks 应返回空', () => {
        const result = smartTruncate([], 1000);
        expect(result.content).toBe('');
        expect(result.truncated).toBe(false);
    });
});

describe('processDiff', () => {
    it('应生成包含文件清单和 diff 的结构化输出', () => {
        const rawDiff = `diff --git a/src/auth.ts b/src/auth.ts
new file mode 100644
--- /dev/null
+++ b/src/auth.ts
@@ -0,0 +1,3 @@
+import { Auth } from './lib';
+
+export const auth = new Auth();`;

        const changes: FileChange[] = [
            { path: 'src/auth.ts', status: 'added' },
        ];

        const result = processDiff(rawDiff, changes);

        expect(result).toContain('## 文件变更清单');
        expect(result).toContain('[新增] src/auth.ts');
        expect(result).toContain('## 详细变更');
        expect(result).toContain('+import { Auth }');
    });

    it('二进制文件和删除文件应被精简处理', () => {
        const rawDiff = `diff --git a/assets/logo.png b/assets/logo.png
new file mode 100644
index 0000000..abc1234
Binary files /dev/null and b/assets/logo.png differ

diff --git a/src/old.ts b/src/old.ts
deleted file mode 100644
index abc..000
--- a/src/old.ts
+++ /dev/null
@@ -1,10 +0,0 @@
-line1
-line2
-line3`;

        const changes: FileChange[] = [
            { path: 'assets/logo.png', status: 'added' },
            { path: 'src/old.ts', status: 'deleted' },
        ];

        const result = processDiff(rawDiff, changes);

        expect(result).toContain('[二进制文件 新增]: assets/logo.png');
        expect(result).toContain('[删除] src/old.ts (共 3 行)');
        expect(result).not.toContain('Binary files /dev/null');
    });

    it('空 diff 应返回仅含文件清单', () => {
        const changes: FileChange[] = [
            { path: 'README.md', status: 'modified' },
        ];

        const result = processDiff('', changes);

        expect(result).toContain('## 文件变更清单');
        expect(result).toContain('[修改] README.md');
    });
});
