import { getSettings } from '@/lib/settings';

const CHUNK_MIN_CHARS = 1500;
const CHUNK_MAX_CHARS = 2000;
const OVERLAP_CHARS = 200;
const CONCURRENCY_LIMIT = 3;
const LONG_PAUSE_SEC = 0.8;

export const AI_PROVIDERS: { value: string; label: string }[] = [
  { value: 'deepseek', label: 'DeepSeek' },
  { value: 'openai', label: 'OpenAI' },
  { value: 'zhipu', label: '智谱AI (GLM)' },
  { value: 'moonshot', label: 'Moonshot (Kimi)' },
];

export const PROVIDER_MODELS: Record<string, { value: string; label: string }[]> = {
  deepseek: [
    { value: 'deepseek-v4-flash', label: 'DeepSeek-V4 Flash' },
    { value: 'deepseek-v4-pro', label: 'DeepSeek-V4 Pro' },
  ],
  openai: [
    { value: 'gpt-4o', label: 'GPT-4o' },
    { value: 'gpt-4o-mini', label: 'GPT-4o Mini' },
    { value: 'gpt-4-turbo', label: 'GPT-4 Turbo' },
    { value: 'o3-mini', label: 'o3-mini' },
  ],
  zhipu: [
    { value: 'glm-4-flash', label: 'GLM-4-Flash (免费)' },
    { value: 'glm-4-plus', label: 'GLM-4-Plus' },
    { value: 'glm-4-air', label: 'GLM-4-Air' },
  ],
  moonshot: [
    { value: 'moonshot-v1-8k', label: 'Moonshot v1-8K' },
    { value: 'moonshot-v1-32k', label: 'Moonshot v1-32K' },
    { value: 'moonshot-v1-128k', label: 'Moonshot v1-128K' },
  ],
};

const PROVIDER_ENDPOINTS: Record<string, string> = {
  openai: 'https://api.openai.com/v1/chat/completions',
  deepseek: 'https://api.deepseek.com/chat/completions',
  zhipu: 'https://open.bigmodel.cn/api/paas/v4/chat/completions',
  moonshot: 'https://api.moonshot.cn/v1/chat/completions',
};

const DEFAULT_MODELS: Record<string, string> = {
  deepseek: 'deepseek-v4-flash',
  openai: 'gpt-4o-mini',
  zhipu: 'glm-4-flash',
  moonshot: 'moonshot-v1-8k',
};

export interface AIPolishResult {
  success: boolean;
  polished: string;
  error?: string;
}

interface SubtitleLine {
  from: number;
  to: number;
  content: string;
}

interface Chunk {
  lines: SubtitleLine[];
  text: string;
  prevOverlap: string;
}

/**
 * ============================================================================
 * 提示词（Prompt）定义 — 这里定义每个“气泡”风格背后的 System Prompt
 *
 * 修改提示词只需要改动下面这个 buildSystemPrompt 函数中的 stylePrompts。
 * 提示词位置：services/ai-polish.ts → buildSystemPrompt()
 *
 * 气泡标签 & 描述定义在文件末尾的 PROMPT_STYLES 导出中，只影响 UI 显示。
 * ============================================================================
 */
async function buildSystemPrompt(): Promise<string> {
  const settings = await getSettings();
  const ai = settings.ai;

  if (ai.customPrompt) return ai.customPrompt;

  const basePrompt = '你是一位严谨的文字编辑校对专家。你的任务是将语音识别（ASR）生成的字幕文本进行标点补全、错别字修正、段落划分，以提升易读性。';

  const style = ai.promptStyle || 'smooth';
  const stylePrompts: Record<string, string> = {
    smooth: [
      '补全标点符号，使语句更流畅自然',
      '修正明显的错别字和语法错误',
      '去除ASR产生的不自然重复',
      '保持原意和所有信息不变，不添加任何额外内容',
      '你的输出长度必须与输入文本的长度基本一致',
    ].join('\n'),
    concise: [
      '去除UP主的口头禅、重复口头语和语气词（如“就是说”、“这个”、“那个”、“对吧”、“嗯”、“啊”等）',
      '去除冗余和重复的内容，但保留核心观点和关键信息',
      '使表达更简洁有力',
      '绝对不能删除或修改讲师原有的核心知识点',
      '保留 Markdown 格式',
    ].join('\n'),
    academic: [
      '使用正式、严谨的学术语言',
      '优化段落结构和逻辑',
      '补充必要的过渡衔接',
      '绝对不能删除或修改讲师原有的核心知识点',
      '保留 Markdown 格式',
    ].join('\n'),
    summary: [
      '对输入内容进行结构化摘要',
      '提取核心观点和关键结论',
      '保留重要的数据和事实',
      '使用层级结构组织内容',
      '保留 Markdown 格式',
    ].join('\n'),
  };

  const styleInstruction = stylePrompts[style] || stylePrompts.smooth;

  return `${basePrompt}

【绝对禁止的红线指令】：
- 绝对禁止总结、缩写或遗漏任何信息
- 绝对不能删除或修改讲师原有的核心知识点
- 你的输出长度必须与输入文本的长度基本一致
- 保留 Markdown 格式

【处理要求】：
${styleInstruction}

【输入格式】：
[前文参考]：（仅供你理解上下文逻辑，不要输出这部分内容的修改）
...（上一个 Chunk 的最后内容）

[需要润色的正文]：
...（当前 Chunk）

请直接输出处理后的【正文】，不要包含任何其他的解释性废话。`;
}

/**
 * Split a markdown document into header + body or header + chapters.
 *
 * For single-P format (`## 视频正文` delimiter): header is before, body is after.
 * For Kapture merged format (multiple `---` separated chapters with `## Title`):
 *   header = overall metadata before first `---`
 *   For each chapter, `## Title` is preserved, body gets polished.
 */
function splitHeaderBody(text: string): { header: string; body: string } {
  const bodyMatch = text.match(/^([\s\S]*?)\n## 视频正文\n\n([\s\S]+)$/);
  if (bodyMatch) {
    return { header: bodyMatch[1].trim(), body: bodyMatch[2].trim() };
  }
  return { header: '', body: text };
}

function reassembleMarkdown(header: string, polishedBody: string): string {
  if (!header) return polishedBody;
  return `${header}\n\n## 视频正文\n\n${polishedBody}`;
}

/**
 * Polish merged subtitles (Kapture format with multiple `---` separated chapters).
 * Preserves per-chapter `## Title` headers.
 */
async function polishMergedMarkdown(
  text: string,
  subtitleLines: SubtitleLine[] | undefined,
  systemPrompt: string,
  provider: string,
  apiKey: string,
  model: string,
  onProgress?: (current: number, total: number) => void,
): Promise<{ success: boolean; polished: string; error?: string }> {
  // Split at the first `---` to get overall header
  const headerMatch = text.match(/^([\s\S]*?)\n---\n\n([\s\S]+)$/);
  if (!headerMatch) {
    // Fall back to normal polishing
    return polishSingleWithChunks(text, subtitleLines, systemPrompt, provider, apiKey, model, onProgress);
  }

  const overallHeader = headerMatch[1].trim(); // # Kapture ... + metadata
  const bodyWithChapters = headerMatch[2];      // ## P1 ... \n---\n ## P2 ...

  // Split the remaining by `\n---\n` to get individual chapters
  const chapterBlocks = bodyWithChapters.split(/\n---\n/).map(b => b.trim()).filter(Boolean);

  // Each chapter block: `## P1 Title\n\ncontent...`
  const chapterParts: { title: string; body: string }[] = [];
  for (const block of chapterBlocks) {
    const titleMatch = block.match(/^(## [^\n]+)\n\n([\s\S]+)$/);
    if (titleMatch) {
      chapterParts.push({ title: titleMatch[1].trim(), body: titleMatch[2].trim() });
    } else {
      // Whole block as body (shouldn't happen, but safe fallback)
      chapterParts.push({ title: '', body: block });
    }
  }

  const totalChapters = chapterParts.length;
  const polishedChapters: string[] = [];

  for (let i = 0; i < chapterParts.length; i++) {
    const { title, body } = chapterParts[i];
    onProgress?.(i + 1, totalChapters);

    if (body.length < 100) {
      polishedChapters.push(title ? `${title}\n\n${body}` : body);
      continue;
    }

    try {
      const lines = subtitleLines && subtitleLines.length > 0
        ? subtitleLines
        : body.split('\n').filter(Boolean).map((content, idx) => ({
            from: idx,
            to: idx + 1,
            content,
          }));

      const chunks = chunkSubtitles(lines);

      if (chunks.length <= 1) {
        const result = await polishChunk(
          { lines: [], text: body, prevOverlap: '' },
          0, 1, systemPrompt, provider, apiKey, model,
        );
        polishedChapters.push(title ? `${title}\n\n${result}` : result);
      } else {
        const chunkResults = await polishChunksConcurrently(
          chunks, systemPrompt, provider, apiKey, model,
          (c, t) => onProgress?.(i + c / chunks.length, totalChapters),
        );
        const polishedBody = chunkResults.join('\n\n');
        polishedChapters.push(title ? `${title}\n\n${polishedBody}` : polishedBody);
      }
    } catch (err: any) {
      return { success: false, polished: text, error: err.message || String(err) };
    }
  }

  const finalText = `${overallHeader}\n\n---\n\n${polishedChapters.join('\n\n---\n\n')}`;
  return { success: true, polished: finalText };
}

/**
 * Polish a single text (no chapter splitting needed).
 */
async function polishSingleWithChunks(
  text: string,
  subtitleLines: SubtitleLine[] | undefined,
  systemPrompt: string,
  provider: string,
  apiKey: string,
  model: string,
  onProgress?: (current: number, total: number) => void,
): Promise<{ success: boolean; polished: string; error?: string }> {
  if (text.length < 300) {
    try {
      const result = await polishChunk(
        { lines: [], text, prevOverlap: '' },
        0, 1, systemPrompt, provider, apiKey, model,
      );
      return { success: true, polished: result };
    } catch (err: any) {
      return { success: false, polished: text, error: err.message || String(err) };
    }
  }

  const lines = subtitleLines && subtitleLines.length > 0
    ? subtitleLines
    : text.split('\n').filter(Boolean).map((content, i) => ({
        from: i,
        to: i + 1,
        content,
      }));

  const chunks = chunkSubtitles(lines);

  if (chunks.length <= 1) {
    try {
      const result = await polishChunk(
        chunks[0], 0, 1, systemPrompt, provider, apiKey, model,
      );
      return { success: true, polished: result };
    } catch (err: any) {
      return { success: false, polished: text, error: err.message || String(err) };
    }
  }

  try {
    const polishedChunks = await polishChunksConcurrently(
      chunks, systemPrompt, provider, apiKey, model, onProgress,
    );
    return { success: true, polished: polishedChunks.join('\n\n') };
  } catch (err: any) {
    return { success: false, polished: text, error: err.message || String(err) };
  }
}

/**
 * Split subtitle lines into chunks based on timestamp pauses.
 */
function chunkSubtitles(lines: SubtitleLine[]): Chunk[] {
  const chunks: Chunk[] = [];
  let currentLines: SubtitleLine[] = [];
  let currentText = '';
  let prevOverlap = '';

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const text = line.content?.trim() || '';
    if (!text) continue;

    currentLines.push(line);
    currentText += text;

    const charCount = currentText.length;
    const nextLine = lines[i + 1];

    if (charCount >= CHUNK_MIN_CHARS && nextLine) {
      const timeGap = nextLine.from - line.to;
      if (timeGap > LONG_PAUSE_SEC) {
        chunks.push({ lines: currentLines, text: currentText, prevOverlap });
        prevOverlap = currentText.slice(-OVERLAP_CHARS);
        currentLines = [];
        currentText = '';
        continue;
      }
    }

    if (charCount >= CHUNK_MAX_CHARS && nextLine) {
      chunks.push({ lines: currentLines, text: currentText, prevOverlap });
      prevOverlap = currentText.slice(-OVERLAP_CHARS);
      currentLines = [];
      currentText = '';
    }
  }

  if (currentLines.length > 0) {
    chunks.push({ lines: currentLines, text: currentText, prevOverlap });
  }

  return chunks;
}

async function polishChunk(
  chunk: Chunk,
  chunkIndex: number,
  totalChunks: number,
  systemPrompt: string,
  provider: string,
  apiKey: string,
  model: string,
): Promise<string> {
  const endpoint = PROVIDER_ENDPOINTS[provider];
  if (!endpoint) throw new Error(`Unknown provider: ${provider}`);

  const userContent = chunk.prevOverlap
    ? `[前文参考]：
${chunk.prevOverlap}

[需要润色的正文]：
${chunk.text}`
    : `[需要润色的正文]：
${chunk.text}`;

  const resp = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: `这是第 ${chunkIndex + 1}/${totalChunks} 个片段。${userContent}` },
      ],
      temperature: 0.3,
      max_tokens: 8192,
    }),
    signal: AbortSignal.timeout(120000),
  }).catch((err: Error) => {
    if (err.name === 'AbortError' || err.name === 'TimeoutError') {
      throw new Error(`AI 请求超时，网络较慢，请稍后重试`);
    }
    if (err.message?.includes('fetch') || err.message?.includes('network') || err.message?.includes('Failed to fetch')) {
      throw new Error(`网络连接失败，请检查网络后重试`);
    }
    throw err;
  });

  if (!resp.ok) {
    const status = resp.status;
    if (status === 429) {
      throw new Error(`AI 接口繁忙（限流），请稍后重试`);
    }
    if (status === 401 || status === 403) {
      throw new Error(`AI API Key 无效或已过期，请检查设置`);
    }
    if (status === 402) {
      throw new Error(`AI 账户余额不足，请充值后重试`);
    }
    if (status >= 500) {
      throw new Error(`AI 服务器错误(${status})，请稍后重试`);
    }
    throw new Error(`AI 请求失败(${status})，请稍后重试`);
  }

  const data = await resp.json();
  const content = data?.choices?.[0]?.message?.content;
  if (!content || content.trim().length === 0) {
    throw new Error('AI returned empty content');
  }
  return content.trim();
}

async function polishChunksConcurrently(
  chunks: Chunk[],
  systemPrompt: string,
  provider: string,
  apiKey: string,
  model: string,
  onProgress?: (current: number, total: number) => void,
): Promise<string[]> {
  const results: string[] = new Array(chunks.length);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < chunks.length) {
      const idx = nextIndex++;
      results[idx] = await polishChunk(chunks[idx], idx, chunks.length, systemPrompt, provider, apiKey, model);
      onProgress?.(idx + 1, chunks.length);
    }
  }

  const workers = Array.from({ length: Math.min(CONCURRENCY_LIMIT, chunks.length) }, () => worker());
  await Promise.all(workers);

  return results;
}

/**
 * Main export: polish subtitles with sliding window chunking.
 * Preserves header info (title, URL, UP主, word count) by only polishing the body.
 */
export async function polishSubtitlesWithChunks(
  text: string,
  subtitleLines?: SubtitleLine[],
  onProgress?: (current: number, total: number) => void,
): Promise<AIPolishResult> {
  const settings = await getSettings();
  const ai = settings.ai;

  if (!ai?.enabled || !ai?.apiKey || !ai?.provider) {
    return { success: false, polished: text, error: 'AI 润色未配置，请在“更多”标签页中设置' };
  }

  const provider = ai.provider;
  const endpoint = PROVIDER_ENDPOINTS[provider];
  if (!endpoint) {
    return { success: false, polished: text, error: `不支持的 AI 服务商: ${provider}` };
  }

  const model = ai.model || DEFAULT_MODELS[provider] || '';
  const systemPrompt = await buildSystemPrompt();

  // Detect Kapture merged format: has `# Kapture 提取：...` header + multiple `---` + `## Title` sections
  const isKaptureMerged = /^# 字幕 提取：/.test(text) && (text.match(/\n---\n/g)?.length || 0) >= 1;

  if (isKaptureMerged) {
    return polishMergedMarkdown(text, subtitleLines, systemPrompt, provider, ai.apiKey, model, onProgress);
  }

  // Single-P or single video: split header and body — only polish the body to preserve metadata
  const { header, body } = splitHeaderBody(text);
  const polishTarget = body || text;

  const result = await polishSingleWithChunks(polishTarget, subtitleLines, systemPrompt, provider, ai.apiKey, model, onProgress);
  if (!result.success) return result;
  const final = header ? reassembleMarkdown(header, result.polished) : result.polished;
  return { success: true, polished: final };
}

export async function polishSubtitles(text: string): Promise<AIPolishResult> {
  return polishSubtitlesWithChunks(text);
}

/**
 * ============================================================================
 * PROMPT_STYLES — 提示词气泡的 UI 标签和描述
 *
 * value 对应后端 buildSystemPrompt() 里的 style key（smooth/concise/academic/summary）
 * 实际提示词内容在 buildSystemPrompt() → stylePrompts 中定义
 * ============================================================================
 */
export const PROMPT_STYLES: { value: string; label: string; description: string }[] = [
  { value: 'smooth', label: '原味润色', description: '补全标点、修正错别字，保持原汁原味' },
  { value: 'concise', label: '精简表达', description: '去掉口癖和冗余，让文章更干净' },
  { value: 'academic', label: '学术风格', description: '改写为正式严谨的学术语言' },
  { value: 'summary', label: '生成摘要', description: '提取核心观点，生成结构化摘要' },
];
