import { useState, useEffect, useRef, useCallback } from 'react';
import { Check, ChevronDown, AlertCircle, Loader2, Plus, RefreshCw, User } from 'lucide-react';
import {
  type GoogleAccountSlot,
  initializeSlots,
  getCachedSlots,
  activateSlot,
  removeSlot,
  onSlotsChanged,
  openAddAccount,
  getInitialsAvatar,
  checkAuthStatus,
  getCurrentAuthuser,
} from '@/services/account-slots';

/**
 * GoogleAccountSelector
 *
 * A polished dropdown component that detects the current Google account,
 * displays cached account slots, and allows the user to switch accounts.
 * Placed above the NotebookLM notebook selector.
 *
 * Design: Modern efficiency tool aesthetic, slate-50 background,
 * white card with subtle border, clean typography.
 */
export function GoogleAccountSelector() {
  const [slots, setSlots] = useState<GoogleAccountSlot[]>([]);
  const [activeSlot, setActiveSlot] = useState<GoogleAccountSlot | null>(null);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [authValid, setAuthValid] = useState(true);
  const [authChecking, setAuthChecking] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // ── Load slots on mount ──
  const loadSlots = useCallback(async () => {
    setLoading(true);
    try {
      const initialized = await initializeSlots();
      setSlots(initialized);
      const detected = initialized.find((s) => s.detected) || initialized[0] || null;
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

  // ── Listen for storage changes (real-time sync) ──
  useEffect(() => {
    const unsub = onSlotsChanged((newSlots) => {
      setSlots(newSlots);
      const detected = newSlots.find((s) => s.detected) || newSlots[0] || null;
      setActiveSlot(detected);
    });
    return unsub;
  }, []);

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

  // ── Switch account ──
  const handleSwitchAccount = useCallback(async (slot: GoogleAccountSlot) => {
    setOpen(false);
    setActiveSlot(slot);
    await activateSlot(slot.email);
    // No navigation — the browser already has cookies for all accounts.
    // All subsequent NotebookLM API calls will use ?authuser=X
    // where X = the selected account's index.
    console.log(`[AccountSelector] Switched to ${slot.email} (authuser=${slot.index})`);
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

  // ── Avatar image error fallback ──
  const handleImgError = useCallback((e: React.SyntheticEvent<HTMLImageElement>, slot: GoogleAccountSlot) => {
    e.currentTarget.src = getInitialsAvatar(slot.name || slot.email);
  }, []);

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
      {/* Label */}
      <label className="block text-[11px] font-medium text-slate-500 tracking-wide mb-2">
        NotebookLM Account
      </label>

      {/* Dropdown trigger */}
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-2.5 bg-white rounded-md border border-slate-200 px-3 py-2 text-left hover:border-slate-300 transition-colors"
      >
        {/* Avatar */}
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

        {/* Email + detected badge */}
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

      {/* Dropdown menu */}
      {open && (
        <div className="absolute z-30 mt-1 left-4 right-4 bg-white rounded-md border border-slate-200 shadow-lg animate-scale-in overflow-hidden">
          {/* Account list */}
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

          {/* Divider */}
          <div className="border-t border-slate-100" />

          {/* Add new account */}
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
