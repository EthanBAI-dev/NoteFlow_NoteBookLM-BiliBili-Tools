import { useState, useEffect, useRef, useCallback } from 'react';
import { Check, ChevronDown, AlertCircle, Loader2, Plus, RefreshCw, User, Bug } from 'lucide-react';
import {
  type GoogleAccountSlot,
  type SlotDebugEvent,
  initializeSlots,
  getCachedSlots,
  activateSlot,
  removeSlot,
  onSlotsChanged,
  openAddAccount,
  getInitialsAvatar,
  checkAuthStatus,
} from '@/services/account-slots';
import { fetchNotebooks } from '@/services/notebook-api';

const DEBUG_LOG_KEY = 'dev_slots_debug_log';

/**
 * GoogleAccountSelector
 *
 * Placed above the NotebookLM notebook selector. Displays detected Google
 * accounts from ListAccounts cache, allows switching via authuser param.
 *
 * Debug: open DevTools → Application → Local Storage → dev_slots_debug_log
 * to trace every selection/sync/revert event.
 */
export function GoogleAccountSelector() {
  const [slots, setSlots] = useState<GoogleAccountSlot[]>([]);
  const [activeSlot, setActiveSlot] = useState<GoogleAccountSlot | null>(null);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [authValid, setAuthValid] = useState(true);
  const [authChecking, setAuthChecking] = useState(false);
  const [notebooks, setNotebooks] = useState<string[]>([]);
  const [notebooksLoading, setNotebooksLoading] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // ── Guard: track last user-initiated action timestamp ──
  // If storage fires `onSlotsChanged` within 500ms of a user action,
  // it's likely the user's own write bouncing back — ignore it to
  // prevent double-render confusion. If it fires AFTER 500ms, it
  // could be a background sync trying to revert — log it clearly.
  const lastUserActionRef = useRef(0);

  // ── Load slots on mount ──
  const loadSlots = useCallback(async () => {
    setLoading(true);
    try {
      const result = await initializeSlots();
      setSlots(result);
      const detected = result.find((s) => s.detected) || result[0] || null;
      setActiveSlot(detected);
    } catch (err) {
      console.error('[GoogleAccountSelector] Init failed:', err);
      const cached = await getCachedSlots();
      setSlots(cached);
      setActiveSlot(cached.find((s) => s.detected) || cached[0] || null);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    loadSlots();
  }, [loadSlots]);

  // ── Listen for storage changes (real-time sync, but guard against reverts) ──
  useEffect(() => {
    const unsub = onSlotsChanged((newSlots) => {
      const now = Date.now();
      const elapsed = now - lastUserActionRef.current;

      // Format the detected account for debugging
      const detected = newSlots.find((s) => s.detected);
      const detectedPreview = detected
        ? `${detected.email} (idx=${detected.index})`
        : 'none';

      console.log(
        `%c[🔍 GoogleAccountSelector::onSlotsChanged]`,
        'color:#f59e0b;font-weight:bold',
        `elapsedSinceUserAction=${elapsed}ms detected=${detectedPreview}`,
        `\n  ↳ newSlots:`,
        newSlots.map((s) => `${s.email.slice(0, 20)}… detected=${s.detected}`),
      );

      // Check if this storage change is reverting the user's selection
      const currentActiveEmail = activeSlot?.email;
      const revertHappening =
        currentActiveEmail &&
        detected &&
        detected.email !== currentActiveEmail &&
        elapsed > 100; // not the user's own write

      if (revertHappening) {
        console.warn(
          `%c⚠️ [GoogleAccountSelector] DETECTED AUTO-REVERT: active was "${currentActiveEmail}", storage now says "${detected.email}"`,
          'color:#ef4444;font-weight:bold',
          `\n  ↳ source=onSlotsChanged elapsedSinceUserAction=${elapsed}ms`,
        );
      }

      setSlots(newSlots);
      setActiveSlot(detected || newSlots[0] || null);
    });
    return unsub;
  }, [activeSlot?.email]);

  // ── Click outside to close ──
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // ── Auth status check ──
  const handleAuthCheck = useCallback(async () => {
    setAuthChecking(true);
    const result = await checkAuthStatus();
    setAuthValid(result.valid);
    setAuthChecking(false);
  }, []);

  // ── Switch account (NO PAGE NAVIGATION) ──
  const handleSwitchAccount = useCallback(async (slot: GoogleAccountSlot) => {
    lastUserActionRef.current = Date.now();
    setOpen(false);
    setActiveSlot(slot);
    await activateSlot(slot.email);
    console.log(
      `%c[🔍 GoogleAccountSelector::switchAccount]`,
      'color:#22c55e;font-weight:bold',
      `selected=${slot.email} (authuser=${slot.index})`,
      `\n  ↳ lastUserAction=${lastUserActionRef.current}`,
    );
  }, []);

  // ── Add new account ──
  const handleAddAccount = useCallback(() => {
    setOpen(false);
    openAddAccount();
  }, []);

  // ── Remove account ──
  const handleRemove = useCallback(async (email: string, e: React.MouseEvent) => {
    e.stopPropagation();
    await removeSlot(email);
    const updated = await getCachedSlots();
    setSlots(updated);
    const detected = updated.find((s) => s.detected) || updated[0] || null;
    setActiveSlot(detected);
  }, []);

  // ── Refresh detection ──
  const handleRefresh = useCallback(async () => {
    await handleAuthCheck();
    await loadSlots();
  }, [handleAuthCheck, loadSlots]);

  // ── Manual notebooks fetch ──
  const handleFetchNotebooks = useCallback(async () => {
    setNotebooksLoading(true);
    try {
      const items = await fetchNotebooks();
      const names = items.map((n) => n.title || n.id || 'untitled');
      setNotebooks(names);
      console.log(
        `%c[📓 GoogleAccountSelector::fetchNotebooks]`,
        'color:#8b5cf6;font-weight:bold',
        `count=${names.length}`,
        names,
      );
    } catch (err) {
      console.error('[📓 GoogleAccountSelector] fetch error:', err);
    }
    setNotebooksLoading(false);
  }, []);

  // ── Avatar image error fallback ──
  const handleImgError = useCallback(
    (e: React.SyntheticEvent<HTMLImageElement>, slot: GoogleAccountSlot) => {
      e.currentTarget.src = getInitialsAvatar(slot.name || slot.email);
    },
    [],
  );

  // ── Dump debug log to console ──
  const dumpDebugLog = useCallback(async () => {
    const result = await chrome.storage.local.get(DEBUG_LOG_KEY);
    const log: SlotDebugEvent[] = result[DEBUG_LOG_KEY] || [];
    console.log(
      `%c[🐛 DevLog] Account switch debug log (${log.length} events):`,
      'color:#f59e0b;font-weight:bold',
    );
    console.table(log.map((e) => ({
      time: new Date(e.at).toISOString().slice(11, 23),
      source: e.source,
      email: e.activeEmail?.slice(0, 25),
      detectedIdx: e.detectedIndex,
      total: e.totalSlots,
    })));
  }, []);

  // ── Login auto-refresh: when slots appear after being empty, fetch notebooks ──
  const hasSlotsAndActive = slots.length > 0 && activeSlot !== null;
  useEffect(() => {
    if (!loading && hasSlotsAndActive) {
      handleFetchNotebooks();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, hasSlotsAndActive]);

  // ── Loading state ──
  if (loading) {
    return (
      <div className="bg-slate-50 rounded-md border border-slate-200 p-4">
        <div className="space-y-3">
          <div className="h-3 w-28 bg-slate-200 rounded animate-pulse" />
          <div className="h-10 bg-white rounded-md border border-slate-200 flex items-center px-3 gap-2.5">
            <div className="w-6 h-6 rounded-full bg-slate-100 animate-pulse" />
            <div className="h-3.5 w-40 bg-slate-100 rounded animate-pulse" />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-slate-50 rounded-md border border-slate-200 p-4" ref={dropdownRef}>
      {/* Label row with debug button */}
      <div className="flex items-center justify-between mb-2">
        <label className="block text-[11px] font-medium text-slate-500 tracking-wide">
          NotebookLM Account
        </label>
        <button
          onClick={dumpDebugLog}
          className="text-[10px] text-slate-300 hover:text-amber-500 transition-colors"
          title="Dump debug log to console"
        >
          <Bug className="w-3 h-3" />
        </button>
      </div>

      {/* Dropdown trigger */}
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-2.5 bg-white rounded-md border border-slate-200 px-3 py-2 text-left hover:border-slate-300 transition-colors"
      >
        {activeSlot ? (
          <img
            src={activeSlot.photoUrl}
            alt=""
            className="w-6 h-6 rounded-full flex-shrink-0 bg-slate-100"
            onError={(e) => handleImgError(e, activeSlot)}
          />
        ) : (
          <div className="w-6 h-6 rounded-full bg-slate-100 flex items-center justify-center flex-shrink-0">
            <User className="w-3 h-3 text-slate-400" />
          </div>
        )}

        <div className="flex-1 min-w-0 flex items-center gap-1.5">
          {activeSlot ? (
            <>
              <span className="text-[13px] text-slate-700 truncate font-medium">
                {activeSlot.email}
              </span>
              {activeSlot.detected && (
                <span className="text-[9px] text-emerald-600 bg-emerald-50 px-1.5 py-0.5 rounded-full font-medium flex-shrink-0 leading-none">
                  detected
                </span>
              )}
            </>
          ) : (
            <span className="text-[13px] text-slate-400">No account detected</span>
          )}
        </div>

        <ChevronDown
          className={`w-3.5 h-3.5 text-slate-400 flex-shrink-0 transition-transform duration-200 ${
            open ? 'rotate-180' : ''
          }`}
        />
      </button>

      {/* Status line */}
      <div className="flex items-center justify-between mt-2">
        <div className="flex items-center gap-1.5">
          {authValid ? (
            <>
              <Check className="w-3 h-3 text-emerald-500" />
              <span className="text-[11px] text-emerald-600 font-medium">
                Using {activeSlot?.email || '...'}
              </span>
            </>
          ) : (
            <div className="flex items-center gap-1.5">
              <AlertCircle className="w-3 h-3 text-amber-500" />
              <span className="text-[11px] text-amber-600">Session may have expired</span>
            </div>
          )}
        </div>
        <button
          onClick={handleRefresh}
          disabled={authChecking}
          className="text-slate-400 hover:text-slate-600 transition-colors"
          title="Check auth status"
        >
          <RefreshCw className={`w-3 h-3 ${authChecking ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {/* Notebook list (auto-fetched when logged in) */}
      <div className="mt-3 pt-3 border-t border-slate-100">
        <div className="flex items-center justify-between">
          <label className="block text-[11px] font-medium text-slate-500 tracking-wide">
            Notebooks
          </label>
          <button
            onClick={handleFetchNotebooks}
            disabled={notebooksLoading}
            className="text-[10px] text-slate-400 hover:text-slate-600 transition-colors"
          >
            <RefreshCw className={`w-3 h-3 ${notebooksLoading ? 'animate-spin' : ''}`} />
          </button>
        </div>
        {notebooksLoading ? (
          <div className="flex items-center gap-2 mt-2">
            <Loader2 className="w-3 h-3 text-slate-400 animate-spin" />
            <span className="text-[11px] text-slate-400">Loading notebooks...</span>
          </div>
        ) : notebooks.length > 0 ? (
          <ul className="mt-2 space-y-1 max-h-32 overflow-y-auto">
            {notebooks.map((name, i) => (
              <li
                key={i}
                className="text-[11px] text-slate-600 truncate px-1 py-0.5 hover:bg-slate-50 rounded"
              >
                📓 {name}
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-2 text-[11px] text-slate-400">No notebooks loaded</p>
        )}
      </div>

      {/* Dropdown menu */}
      {open && (
        <div className="absolute z-30 mt-1 left-4 right-4 bg-white rounded-md border border-slate-200 shadow-lg overflow-hidden">
          <div className="max-h-48 overflow-y-auto">
            {slots.length === 0 && (
              <div className="px-3 py-4 text-center">
                <p className="text-[12px] text-slate-400">No accounts cached yet</p>
              </div>
            )}

            {slots.map((slot) => {
              const isActive = activeSlot?.email === slot.email;
              return (
                <button
                  key={slot.email}
                  onClick={() => handleSwitchAccount(slot)}
                  className={`w-full flex items-center gap-2.5 px-3 py-2.5 text-left transition-colors ${
                    isActive ? 'bg-blue-50/60' : 'hover:bg-slate-50'
                  }`}
                >
                  <img
                    src={slot.photoUrl}
                    alt=""
                    className="w-7 h-7 rounded-full flex-shrink-0 bg-slate-100"
                    onError={(e) => handleImgError(e, slot)}
                  />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span
                        className={`text-[12px] truncate ${
                          isActive ? 'text-blue-700 font-medium' : 'text-slate-600'
                        }`}
                      >
                        {slot.email}
                      </span>
                      {slot.detected && (
                        <span className="text-[8px] text-emerald-600 bg-emerald-50 px-1 py-0.5 rounded-full font-medium flex-shrink-0 leading-none">
                          detected
                        </span>
                      )}
                    </div>
                    {slot.name && (
                      <p className="text-[10px] text-slate-400 truncate mt-0.5">{slot.name}</p>
                    )}
                  </div>
                  {isActive && (
                    <Check className="w-3.5 h-3.5 text-blue-600 flex-shrink-0" />
                  )}
                  {slots.length > 1 && !slot.detected && (
                    <button
                      onClick={(e) => handleRemove(slot.email, e)}
                      className="text-[10px] text-slate-300 hover:text-red-400 transition-colors flex-shrink-0 px-1"
                      title="Remove this account"
                    >
                      ✕
                    </button>
                  )}
                </button>
              );
            })}
          </div>

          <div className="border-t border-slate-100" />

          <button
            onClick={handleAddAccount}
            className="w-full flex items-center gap-2.5 px-3 py-2.5 text-left hover:bg-slate-50 transition-colors"
          >
            <div className="w-7 h-7 rounded-full border border-dashed border-slate-300 flex items-center justify-center flex-shrink-0">
              <Plus className="w-3.5 h-3.5 text-slate-400" />
            </div>
            <span className="text-[12px] text-slate-500 font-medium">Add new account</span>
          </button>
        </div>
      )}
    </div>
  );
}
