import { useState, useEffect, useRef, useCallback } from 'react';
import { Check, ChevronDown, Plus, User } from 'lucide-react';
import {
  type GoogleAccountSlot,
  initializeSlots,
  getCachedSlots,
  activateSlot,
  removeSlot,
  onSlotsChanged,
  openAddAccount,
  getInitialsAvatar,
} from '@/services/account-slots';

/** Consistent label style used across the panel */
const LABEL_CLS = 'text-[11px] font-medium text-gray-500 tracking-wide';

interface Props {
  compact?: boolean;
}

export function GoogleAccountSelector({ compact }: Props) {
  const [slots, setSlots] = useState<GoogleAccountSlot[]>([]);
  const [activeSlot, setActiveSlot] = useState<GoogleAccountSlot | null>(null);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(true);

  const dropdownRef = useRef<HTMLDivElement>(null);

  // ── Guard: track last user-initiated action timestamp ──
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

      const currentActiveEmail = activeSlot?.email;
      const revertHappening =
        currentActiveEmail &&
        detected &&
        detected.email !== currentActiveEmail &&
        elapsed > 100;

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

  // ── Switch account (NO PAGE NAVIGATION) ──
  const handleSwitchAccount = useCallback(async (slot: GoogleAccountSlot) => {
    lastUserActionRef.current = Date.now();
    setOpen(false);
    setActiveSlot(slot);
    await activateSlot(slot.email);

    window.dispatchEvent(new CustomEvent('nlm-account-switched', {
      detail: { email: slot.email, index: slot.index },
    }));

    await chrome.storage.local.remove('notebook_list_cache');

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

  // ── Avatar image error fallback ──
  const handleImgError = useCallback(
    (e: React.SyntheticEvent<HTMLImageElement>, slot: GoogleAccountSlot) => {
      e.currentTarget.src = getInitialsAvatar(slot.name || slot.email);
    },
    [],
  );

  // ── Loading state ──
  if (loading) {
    return compact ? (
      <div className="h-7 w-32 bg-gray-100 rounded animate-pulse" />
    ) : (
      <div className="space-y-2">
        <div className="h-3 w-28 bg-gray-100 rounded animate-pulse" />
        <div className="h-9 bg-white rounded-lg border border-gray-200 flex items-center px-3 gap-2">
          <div className="w-5 h-5 rounded-full bg-gray-100 animate-pulse" />
          <div className="h-3 w-36 bg-gray-100 rounded animate-pulse" />
        </div>
      </div>
    );
  }

  return (
    <div ref={dropdownRef} className={compact ? 'relative' : ''}>
      {/* "NotebookLM Account" label — skip in compact mode */}
      {!compact && <label className={LABEL_CLS}>NotebookLM Account</label>}

      {/* Dropdown trigger */}
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className={`flex items-center gap-1.5 bg-white rounded-lg border border-gray-200 text-left hover:border-gray-300 transition-colors ${
          compact
            ? 'px-1.5 py-1.5 text-xs max-w-[160px]'
            : 'w-full px-3 py-2 mt-1.5'
        }`}
      >
        {activeSlot ? (
          <img
            src={activeSlot.photoUrl}
            alt=""
            className={`rounded-full flex-shrink-0 bg-gray-100 ${compact ? 'w-4 h-4' : 'w-5 h-5'}`}
            onError={(e) => handleImgError(e, activeSlot)}
          />
        ) : (
          <div className={`rounded-full bg-gray-100 flex items-center justify-center flex-shrink-0 ${compact ? 'w-4 h-4' : 'w-5 h-5'}`}>
            <User className="w-2 h-2 text-gray-400" />
          </div>
        )}

        <div className="flex-1 min-w-0 flex items-center gap-1">
          {activeSlot ? (
            <>
              <span className="text-xs text-gray-700 truncate font-medium">
                {activeSlot.email}
              </span>
              {activeSlot.detected && (
                <span className="text-[8px] text-blue-600 bg-blue-50 px-1 py-0.5 rounded-full font-medium flex-shrink-0 leading-none">
                  当前
                </span>
              )}
            </>
          ) : (
            <span className="text-xs text-gray-400">No account</span>
          )}
        </div>

        <ChevronDown
          className={`w-3 h-3 text-gray-400 flex-shrink-0 transition-transform duration-200 ${
            open ? 'rotate-180' : ''
          }`}
        />
      </button>

      {/* Dropdown menu */}
      {open && (
        <div className={`absolute z-30 mt-1 bg-white rounded-md border border-slate-200 shadow-lg overflow-hidden ${
          compact ? 'left-0 w-100' : 'left-4 right-4'
        }`}>
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
                        <span className="text-[8px] text-blue-600 bg-blue-50 px-1 py-0.5 rounded-full font-medium flex-shrink-0 leading-none">
                          当前
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
