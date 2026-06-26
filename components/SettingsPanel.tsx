import { useEffect, useState } from 'react';
import { Loader2, Settings2 } from 'lucide-react';
import { useI18n } from '@/lib/i18n';
import type { Settings } from '@/lib/settings';
import { getSettings, onSettingsChanged, updateSettings } from '@/lib/settings';

interface Props {
  onClose: () => void;
  onReplayTour?: () => void;
}

export function SettingsPanel({ onClose, onReplayTour }: Props) {
  const { t } = useI18n();
  const [settings, setSettings] = useState<Settings | null>(null);
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved'>('idle');

  useEffect(() => {
    let mounted = true;

    getSettings().then((value) => {
      if (mounted) setSettings(value);
    });

    const unsubscribe = onSettingsChanged((value) => {
      if (mounted) setSettings(value);
    });

    return () => {
      mounted = false;
      unsubscribe();
    };
  }, []);

  const persistSettings = async (patch: Partial<Settings>) => {
    setSaveState('saving');
    try {
      const next = await updateSettings(patch);
      setSettings(next);
      setSaveState('saved');
      window.setTimeout(() => setSaveState((prev) => (prev === 'saved' ? 'idle' : prev)), 1200);
    } catch {
      setSaveState('idle');
    }
  };

  const updateAutoRename = async (checked: boolean) => {
    if (!settings) return;
    setSettings({ ...settings, autoRenamePastedSources: checked });
    await persistSettings({ autoRenamePastedSources: checked });
  };

  const updateStripTimestamps = async (checked: boolean) => {
    if (!settings) return;
    setSettings({ ...settings, stripBilibiliTimestamps: checked });
    await persistSettings({ stripBilibiliTimestamps: checked });
  };

  const renderSaveState = () => {
    if (saveState === 'saving') {
      return <span className="text-[11px] text-gray-400">{t('more.saving')}</span>;
    }
    if (saveState === 'saved') {
      return <span className="text-[11px] text-emerald-600">{t('more.saved')}</span>;
    }
    return null;
  };

  return (
    <div className="fixed inset-0 bg-surface z-50 flex flex-col animate-fade-in">
      <div className="glass px-4 py-3 border-b border-border flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <Settings2 className="w-5 h-5 text-notebooklm-blue" />
          <span className="font-medium text-gray-900 tracking-tight">{t('more.settings')}</span>
        </div>
        <div className="flex items-center gap-3">
          {renderSaveState()}
          <button
            onClick={onClose}
            className="btn-press px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-100 rounded-lg transition-all duration-150"
          >
            {t('close')}
          </button>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto px-4 py-4">
        {!settings ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-6 h-6 text-notebooklm-blue/60 animate-spin" />
          </div>
        ) : (
          <div className="space-y-4">
            <div className="rounded-xl border border-border-strong bg-white p-4 shadow-soft">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-sm font-medium text-gray-900">{t('more.autoRenameTitle')}</div>
                  <p className="mt-1 text-xs leading-5 text-gray-500">{t('more.autoRenameDesc')}</p>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={settings.autoRenamePastedSources}
                  onClick={() => updateAutoRename(!settings.autoRenamePastedSources)}
                  className={`relative inline-flex h-6 w-11 flex-shrink-0 items-center rounded-full transition-colors ${settings.autoRenamePastedSources ? 'bg-notebooklm-blue' : 'bg-gray-300'}`}
                >
                  <span
                    className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${settings.autoRenamePastedSources ? 'translate-x-5' : 'translate-x-1'}`}
                  />
                </button>
              </div>
            </div>
            <div className="rounded-xl border border-border-strong bg-white p-4 shadow-soft">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-sm font-medium text-gray-900">{t('settings.stripTimestamps')}</div>
                  <p className="mt-1 text-xs leading-5 text-gray-500">{t('settings.stripTimestampsDesc')}</p>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={settings.stripBilibiliTimestamps}
                  onClick={() => updateStripTimestamps(!settings.stripBilibiliTimestamps)}
                  className={`relative inline-flex h-6 w-11 flex-shrink-0 items-center rounded-full transition-colors ${settings.stripBilibiliTimestamps ? 'bg-notebooklm-blue' : 'bg-gray-300'}`}
                >
                  <span
                    className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${settings.stripBilibiliTimestamps ? 'translate-x-5' : 'translate-x-1'}`}
                  />
                </button>
              </div>
            </div>
            <div className="rounded-xl border border-border-strong bg-white p-4 shadow-soft space-y-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-sm font-medium text-gray-900">{t('onboarding.replayTour')}</div>
                  <p className="mt-1 text-xs leading-5 text-gray-500">{t('onboarding.replayTourDesc')}</p>
                </div>
                <button
                  type="button"
                  onClick={onReplayTour}
                  className="btn-press px-3 py-1.5 text-xs text-notebooklm-blue hover:bg-notebooklm-light rounded-lg transition-all duration-150"
                >
                  {t('onboarding.replayTour')}
                </button>
              </div>
            </div>
            <div className="rounded-xl border border-border-strong bg-white p-4 shadow-soft">
              <p className="text-xs leading-5 text-gray-500">
                {t('more.aiPolishRemoved')}
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
