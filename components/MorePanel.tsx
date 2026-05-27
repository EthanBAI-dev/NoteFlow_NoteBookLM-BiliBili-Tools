import { useState, useEffect } from 'react';
import {
  ChevronDown,
  ChevronUp,
  ExternalLink,
  Youtube,
  Github,
  Heart,
  HelpCircle,
  Star,
  PlayCircle,
  Edit3,
  Sparkles,
  Eye,
  EyeOff,
} from 'lucide-react';
import type { ImportProgress } from '@/lib/types';
import { t } from '@/lib/i18n';
import { resetOnboarding } from '@/components/OnboardingTour';
import { getSettings, updateSettings } from '@/lib/settings';
import { AI_PROVIDERS, PROVIDER_MODELS, PROMPT_STYLES } from '@/services/ai-polish';

interface Props {
  onProgress: (progress: ImportProgress | null) => void;
}

export function MorePanel({ onProgress: _onProgress }: Props) {
  const [autoRename, setAutoRename] = useState(true);
  const [showAIPolish, setShowAIPolish] = useState(false);
  const [aiEnabled, setAiEnabled] = useState(false);
  const [aiProvider, setAiProvider] = useState('deepseek');
  const [aiApiKey, setAiApiKey] = useState('');
  const [aiModel, setAiModel] = useState('');
  const [aiPromptStyle, setAiPromptStyle] = useState('smooth');
  const [aiCustomPrompt, setAiCustomPrompt] = useState('');
  const [showApiKey, setShowApiKey] = useState(false);

  useEffect(() => {
    getSettings().then((s) => {
      setAutoRename(s.autoRenamePastedSources);
      setAiEnabled(s.ai.enabled);
      setAiProvider(s.ai.provider);
      setAiApiKey(s.ai.apiKey);
      setAiModel(s.ai.model);
      setAiPromptStyle(s.ai.promptStyle);
      setAiCustomPrompt(s.ai.customPrompt);
    });
  }, []);

  const toggleAutoRename = async () => {
    const next = !autoRename;
    setAutoRename(next);
    await updateSettings({ autoRenamePastedSources: next });
  };

  const saveAISetting = async (key: string, value: unknown) => {
    const patch: Record<string, unknown> = { [key]: value };
    await updateSettings({ ai: { enabled: aiEnabled, provider: aiProvider, apiKey: aiApiKey, model: aiModel, promptStyle: aiPromptStyle, customPrompt: aiCustomPrompt, ...patch } as any });
  };

  const models = PROVIDER_MODELS[aiProvider] || [];

  return (
    <div className="space-y-4">
      {/* AI Polish Settings — collapsible section */}
      <div className="border border-border rounded-lg overflow-hidden shadow-soft">
        <button
          onClick={() => setShowAIPolish(!showAIPolish)}
          className="w-full flex items-center justify-between px-3 py-2.5 bg-surface-sunken hover:bg-gray-100/80 transition-colors"
        >
          <div className="flex items-center gap-2 text-sm font-medium text-gray-700">
            <Sparkles className="w-4 h-4 text-purple-500" />
            {t('more.aiPolish')}
          </div>
          {showAIPolish ? <ChevronUp className="w-4 h-4 text-gray-400" /> : <ChevronDown className="w-4 h-4 text-gray-400" />}
        </button>

        {showAIPolish && (
          <div className="p-3 space-y-3 border-t border-gray-200">
            <div className="flex items-center justify-between">
              <span className="text-sm text-gray-700">{t('more.aiEnable')}</span>
              <button
                onClick={async () => {
                  const next = !aiEnabled;
                  setAiEnabled(next);
                  await saveAISetting('enabled', next);
                }}
                role="switch"
                aria-checked={aiEnabled}
                className={`relative inline-flex h-5 w-9 flex-shrink-0 items-center rounded-full transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-purple-500/40 ${
                  aiEnabled ? 'bg-purple-500' : 'bg-gray-300'
                }`}
              >
                <span
                  className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform duration-200 ${
                    aiEnabled ? 'translate-x-4' : 'translate-x-0.5'
                  }`}
                />
              </button>
            </div>

            {aiEnabled && (
              <>
                {/* Provider */}
                <div>
                  <label className="block text-xs text-gray-500 mb-1">{t('more.aiProvider')}</label>
                  <select
                    value={aiProvider}
                    onChange={async (e) => {
                      setAiProvider(e.target.value);
                      setAiModel('');
                      await saveAISetting('provider', e.target.value);
                      await updateSettings({ ai: { enabled: aiEnabled, provider: e.target.value, apiKey: aiApiKey, model: '', promptStyle: aiPromptStyle, customPrompt: aiCustomPrompt } as any });
                    }}
                    className="w-full text-sm border border-gray-200/60 rounded-lg px-2 py-1.5 bg-white text-gray-700 focus:outline-none focus:ring-1 focus:ring-purple-500/40"
                  >
                    {AI_PROVIDERS.map((p) => (
                      <option key={p.value} value={p.value}>{p.label}</option>
                    ))}
                  </select>
                </div>

                {/* API Key */}
                <div>
                  <label className="block text-xs text-gray-500 mb-1">{t('more.aiApiKey')}</label>
                  <div className="flex gap-1">
                    <div className="flex-1 relative">
                      <input
                        type={showApiKey ? 'text' : 'password'}
                        value={aiApiKey}
                        onChange={(e) => setAiApiKey(e.target.value)}
                        onBlur={() => saveAISetting('apiKey', aiApiKey)}
                        placeholder={t('more.aiApiKeyPlaceholder')}
                        className="w-full text-sm border border-gray-200/60 rounded-lg px-2 py-1.5 bg-white text-gray-700 focus:outline-none focus:ring-1 focus:ring-purple-500/40 pr-8"
                      />
                      <button
                        type="button"
                        onClick={() => setShowApiKey(!showApiKey)}
                        className="absolute right-1.5 top-1/2 -translate-y-1/2 p-0.5 text-gray-400 hover:text-gray-600"
                      >
                        {showApiKey ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                      </button>
                    </div>
                  </div>
                </div>

                {/* Model — dropdown */}
                <div>
                  <label className="block text-xs text-gray-500 mb-1">{t('more.aiModel')}</label>
                  <select
                    value={aiModel}
                    onChange={async (e) => {
                      setAiModel(e.target.value);
                      await saveAISetting('model', e.target.value);
                    }}
                    className="w-full text-sm border border-gray-200/60 rounded-lg px-2 py-1.5 bg-white text-gray-700 focus:outline-none focus:ring-1 focus:ring-purple-500/40"
                  >
                    <option value="">{t('more.aiModelPlaceholder')}</option>
                    {models.map((m) => (
                      <option key={m.value} value={m.value}>{m.label}</option>
                    ))}
                  </select>
                </div>

                {/* Prompt Style Bubbles */}
                <div>
                  <label className="block text-xs text-gray-500 mb-2">{t('more.aiPromptStyle')}</label>
                  <div className="flex flex-wrap gap-1.5">
                    {PROMPT_STYLES.map((style) => (
                      <button
                        key={style.value}
                        onClick={async () => {
                          setAiPromptStyle(style.value);
                          await saveAISetting('promptStyle', style.value);
                        }}
                        className={`px-2.5 py-1.5 text-[11px] rounded-full border transition-colors duration-150 ${
                          aiPromptStyle === style.value
                            ? 'bg-purple-500 text-white border-purple-500'
                            : 'bg-white text-gray-500 border-gray-200 hover:border-purple-300 hover:text-purple-600'
                        }`}
                        title={style.description}
                      >
                        {style.label}
                      </button>
                    ))}
                    <button
                      onClick={async () => {
                        setAiPromptStyle('custom');
                        await saveAISetting('promptStyle', 'custom');
                      }}
                      className={`px-2.5 py-1.5 text-[11px] rounded-full border transition-colors duration-150 ${
                        aiPromptStyle === 'custom'
                          ? 'bg-purple-500 text-white border-purple-500'
                          : 'bg-white text-gray-500 border-gray-200 hover:border-purple-300 hover:text-purple-600'
                      }`}
                    >
                      {t('more.aiPromptCustom')}
                    </button>
                  </div>
                </div>

                {/* Custom Prompt */}
                {aiPromptStyle === 'custom' && (
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">{t('more.aiCustomPrompt')}</label>
                    <textarea
                      value={aiCustomPrompt}
                      onChange={(e) => setAiCustomPrompt(e.target.value)}
                      onBlur={() => saveAISetting('customPrompt', aiCustomPrompt)}
                      placeholder={t('more.aiCustomPromptPlaceholder')}
                      rows={3}
                      className="w-full text-sm border border-gray-200/60 rounded-lg px-2 py-1.5 bg-white text-gray-700 focus:outline-none focus:ring-1 focus:ring-purple-500/40 resize-none"
                    />
                  </div>
                )}

                <p className="text-[10px] text-gray-400 leading-relaxed">
                  {t('more.aiPolishNote')}
                </p>
              </>
            )}
          </div>
        )}
      </div>

      {/* Replay Tour */}
      <button
        onClick={async () => {
          await resetOnboarding();
          window.location.reload();
        }}
        className="w-full flex items-center gap-3 p-2.5 bg-blue-50/60 border border-blue-100/40 rounded-xl hover:bg-blue-100/80 transition-colors group"
      >
        <div className="w-8 h-8 bg-notebooklm-blue rounded-lg flex items-center justify-center flex-shrink-0">
          <HelpCircle className="w-4 h-4 text-white" />
        </div>
        <div className="flex-1 min-w-0 text-left">
          <p className="text-sm font-medium text-gray-800 group-hover:text-notebooklm-blue">{t('onboarding.replayTour')}</p>
          <p className="text-xs text-gray-500">{t('onboarding.replayTourDesc')}</p>
        </div>
      </button>

      {/* Tutorial Video */}
      <a
        href="https://youtu.be/9gPTuJZRHJk"
        target="_blank"
        rel="noopener noreferrer"
        className="flex items-center gap-3 p-2.5 bg-red-50/60 border border-red-100/40 rounded-xl hover:bg-red-100/80 transition-colors group"
      >
        <div className="w-8 h-8 bg-red-500 rounded-lg flex items-center justify-center flex-shrink-0">
          <PlayCircle className="w-4 h-4 text-white" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-gray-800 group-hover:text-red-700">{t('more.tutorial')}</p>
          <p className="text-xs text-gray-500">{t('more.tutorialDesc')}</p>
        </div>
        <ExternalLink className="w-3.5 h-3.5 text-gray-400 group-hover:text-red-500 flex-shrink-0" />
      </a>

      {/* Settings: Auto-rename pasted sources */}
      <div className="flex items-center gap-3 p-2.5 bg-slate-50/60 border border-slate-100/60 rounded-xl">
        <div className="w-8 h-8 bg-slate-500 rounded-lg flex items-center justify-center flex-shrink-0">
          <Edit3 className="w-4 h-4 text-white" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-gray-800">{t('more.autoRenameTitle')}</p>
          <p className="text-xs text-gray-500">{t('more.autoRenameDesc')}</p>
        </div>
        <button
          onClick={toggleAutoRename}
          role="switch"
          aria-checked={autoRename}
          className={`relative inline-flex h-5 w-9 flex-shrink-0 items-center rounded-full transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-notebooklm-blue/40 ${
            autoRename ? 'bg-notebooklm-blue' : 'bg-gray-300'
          }`}
        >
          <span
            className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform duration-200 ${
              autoRename ? 'translate-x-4' : 'translate-x-0.5'
            }`}
          />
        </button>
      </div>

      {/* Rate on Chrome Web Store */}
      <div className="flex items-center gap-3 p-2.5 bg-amber-50/60 border border-amber-100/40 rounded-xl">
        <div className="w-8 h-8 bg-amber-500 rounded-lg flex items-center justify-center flex-shrink-0">
          <Star className="w-4 h-4 text-white" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-gray-800">{t('more.rateTitle')}</p>
          <p className="text-xs text-gray-500">{t('more.rateDesc')}</p>
        </div>
        <a
          href="https://chromewebstore.google.com/detail/notebooklm-jetpack/jgjgpfgcbdblgejodmooigkhlciejjhg/reviews"
          target="_blank"
          rel="noopener noreferrer"
          className="btn-press px-3 py-1.5 bg-amber-500 text-white text-xs font-medium rounded-lg hover:bg-amber-600 transition-colors shadow-btn hover:shadow-btn-hover flex-shrink-0"
        >
          {t('more.rateBtn')}
        </a>
      </div>

      {/* Footer — version, credit & links */}
      <div className="flex flex-col items-center gap-1.5 pt-1">
        <p className="text-[10px] text-gray-300 font-mono tabular-nums">
          v{__VERSION__}+{__GIT_HASH__}
        </p>
        <div className="flex items-center gap-2 text-xs text-gray-400">
          <span className="flex items-center gap-1">
            Made with <Heart className="w-3 h-3 text-red-400" /> by {t('more.madeBy')}
          </span>
          <span className="text-gray-200">|</span>
          <a
            href="https://www.youtube.com/@greentrainpodcast"
            target="_blank"
            rel="noopener noreferrer"
            className="p-1 text-gray-400 hover:text-red-500 transition-colors rounded-md hover:bg-red-50"
            title={t('more.ytChannel')}
          >
            <Youtube className="w-3.5 h-3.5" />
          </a>
          <a
            href="https://github.com/crazynomad/notebooklm-jetpack"
            target="_blank"
            rel="noopener noreferrer"
            className="p-1 text-gray-400 hover:text-gray-800 transition-colors rounded-md hover:bg-gray-100"
            title="GitHub"
          >
            <Github className="w-3.5 h-3.5" />
          </a>
        </div>
      </div>
    </div>
  );
}
