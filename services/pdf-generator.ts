import { ensureOffscreen, sendOffscreenMessage } from '@/services/offscreen';

export async function convertHtmlToMarkdown(html: string): Promise<{ markdown: string; title: string }> {
  await ensureOffscreen();
  return sendOffscreenMessage<{ success: true; markdown: string; title: string }>(
    { type: 'HTML_TO_MARKDOWN', html },
  ).then(r => ({ markdown: r.markdown, title: r.title }));
}
