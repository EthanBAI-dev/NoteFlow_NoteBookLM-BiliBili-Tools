/**
 * YouTube SPA navigation watcher.
 *
 * YouTube uses its own SPA router. When the user navigates between video pages,
 * playlists, or channel tabs, the page doesn't reload — only the URL changes.
 * This content script detects those changes and notifies the background script
 * so it can debounce + fetch video info proactively.
 *
 * Detection strategies (in order of reliability):
 *   1. YouTube's custom `yt-navigate-finish` event (fired after each SPA nav)
 *   2. `popstate` event (browser back/forward)
 *   3. Monkeyspatch `history.pushState` / `history.replaceState`
 */

let lastUrl = location.href;

function notifyBackground(url: string): void {
  if (url === lastUrl) return;
  lastUrl = url;
  console.log(`[YouTube Content] URL changed: ${url.slice(0, 80)}`);
  chrome.runtime.sendMessage({ type: 'YT_URL_CHANGED', url, tabId: -1 });
}

export default defineContentScript({
  matches: ['https://www.youtube.com/*'],
  runAt: 'document_idle',

  main() {
    // 1. YouTube's own SPA event — most reliable
    window.addEventListener('yt-navigate-finish', () => {
      notifyBackground(location.href);
    });

    // 2. Browser back/forward
    window.addEventListener('popstate', () => {
      notifyBackground(location.href);
    });

    // 3. Monkeyspatch pushState/replaceState for programmatic navigation
    const origPush = history.pushState.bind(history);
    history.pushState = (...args) => {
      origPush(...args);
      notifyBackground(location.href);
    };

    const origReplace = history.replaceState.bind(history);
    history.replaceState = (...args) => {
      origReplace(...args);
      notifyBackground(location.href);
    };

    console.log('[YouTube Content] SPA watcher active');
  },
});
