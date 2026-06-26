// Document site framework types
import type { BilibiliSourceInfo } from '@/services/bilibili';

// Import item
export interface ImportItem {
  url: string;
  title?: string;
  status: 'pending' | 'importing' | 'success' | 'error';
  error?: string;
}

// Import progress
export interface ImportProgress {
  total: number;
  completed: number;
  current?: ImportItem;
  items: ImportItem[];
}

// YouTube types
export interface YouTubeVideoItem {
  id: string;
  url: string;
  title: string;
  publishedAt?: string;
}

export interface YouTubeSourceInfo {
  type: 'video' | 'playlist' | 'channel';
  id: string;
  title: string;
  videoCount?: number;
}

export interface YouTubeResult {
  source: YouTubeSourceInfo;
  videos: YouTubeVideoItem[];
  continuation?: string;
}

// Bilibili video item (for subtitle extraction)
export interface BilibiliVideoItem {
  bvid: string;
  cid: number;
  aid?: number;
  title: string;
  part?: string;
  page: number;
  url: string;
  duration?: number;
}

// Message types for communication between popup and background
export type MessageType =
  | { type: 'IMPORT_URL'; url: string }
  | { type: 'IMPORT_BATCH'; urls: string[] }
  | { type: 'GET_CURRENT_TAB' }
  | { type: 'GET_ALL_TABS' }
  | { type: 'GET_HISTORY'; limit?: number }
  | { type: 'CLEAR_HISTORY' }
  | { type: 'EXTRACT_CLAUDE_CONVERSATION'; tabId: number }
  | { type: 'IMPORT_CLAUDE_CONVERSATION'; conversation: ClaudeConversation; selectedMessageIds: string[] }
  | { type: 'FETCH_PODCAST'; url: string; count?: number }
  | { type: 'FETCH_YOUTUBE'; url: string }
  | { type: 'FETCH_YOUTUBE_MORE'; continuation: string }
  | { type: 'DETECT_YOUTUBE_SUBTITLES'; tabId: number }
  | { type: 'FETCH_BILIBILI'; url: string }
  | { type: 'FETCH_BILIBILI_SPACE'; mid: string }
  | { type: 'DOWNLOAD_BILIBILI_SUBTITLES'; videos: BilibiliVideoItem[]; ownerName: string; desc: string }
  | { type: 'DOWNLOAD_BILIBILI_ZIP'; videos: BilibiliVideoItem[]; ownerName: string; desc: string }
  | { type: 'DOWNLOAD_BILIBILI_MERGED'; videos: BilibiliVideoItem[]; ownerName: string; desc: string; source: BilibiliSourceInfo }
  | { type: 'UPLOAD_BILIBILI_TO_DRIVE'; videos: BilibiliVideoItem[]; ownerName: string; desc: string; source: BilibiliSourceInfo }
  | { type: 'IMPORT_BILIBILI_SUBTITLES'; videos: BilibiliVideoItem[]; ownerName: string; desc: string }
  | { type: 'IMPORT_BILIBILI_MERGED'; videos: BilibiliVideoItem[]; ownerName: string; desc: string; source: BilibiliSourceInfo }
  | { type: 'DOWNLOAD_PODCAST' }
  | { type: 'GET_FAILED_SOURCES'; tabId: number }
  | { type: 'RESCUE_SOURCES'; urls: string[] }
  | { type: 'GET_WECHAT_SOURCES'; tabId: number }
  | { type: 'REPAIR_WECHAT_SOURCES'; urls: string[] }
  | { type: 'ADD_BOOKMARK'; url: string; title: string; favicon?: string; collection?: string }
  | { type: 'REMOVE_BOOKMARK'; id: string }
  | { type: 'REMOVE_BOOKMARKS'; ids: string[] }
  | { type: 'MOVE_BOOKMARK'; id: string; collection: string }
  | { type: 'MOVE_BOOKMARKS'; ids: string[]; collection: string }
  | { type: 'GET_BOOKMARKS' }
  | { type: 'GET_COLLECTIONS' }
  | { type: 'CREATE_COLLECTION'; name: string }
  | { type: 'IS_BOOKMARKED'; url: string }
  // Notebook info
  | { type: 'GET_NOTEBOOKS'; force?: boolean }
  // YouTube SPA navigation (content script → background)
  | { type: 'YT_URL_CHANGED'; url: string; tabId: number }
  // YouTube fetch result (background → sidepanel)
  | { type: 'YT_FETCH_RESULT'; url: string; result: YouTubeResult | null; error?: string };

// Notebook info returned from content script
export interface NotebookInfo {
  id: string;
  title: string;
  url: string;
}

export type MessageResponse =
  | { success: true; data: unknown }
  | { success: false; error: string };

// Import history item
export interface HistoryItem {
  id: string;
  url: string;
  title?: string;
  importedAt: number;
  status: 'success' | 'error';
  error?: string;
}

// AI conversation types (Claude / ChatGPT / Gemini)
export type ClaudeRole = 'human' | 'assistant';

export interface ClaudeMessage {
  id: string;
  role: ClaudeRole;
  content: string;
  timestamp?: string;
}

/** A question-answer pair (basic import unit) */
export interface QAPair {
  id: string;
  question: string;
  answer: string;
  questionTimestamp?: string;
  answerTimestamp?: string;
}

export interface ClaudeConversation {
  id: string;
  title: string;
  url: string;
  messages: ClaudeMessage[];
  /** Grouped Q&A pairs for import */
  pairs?: QAPair[];
  extractedAt: number;
}
