import { Globe, MessageCircle, Tv2, Youtube, Headphones, type LucideIcon } from 'lucide-react';

/** Platform identifier for color/icon theming */
export type SourcePlatform = 'bilibili' | 'youtube' | 'podcast' | 'ai' | 'web';

interface SourceInfoCardProps {
  /** Platform determines icon and color scheme */
  platform: SourcePlatform;
  /** Source title (e.g. video title, notebook name, page title) */
  title: string;
  /** Optional favicon/thumbnail URL — overrides the platform icon when set */
  favicon?: string;
  /** Subtitle line — usually URL, author, or metadata tags */
  subtitle?: string;
  /** Optional tags rendered as small badges */
  tags?: string[];
  /** Click handler (e.g. open source URL) */
  onClick?: () => void;
  /** When true, shows a red "没有检测到音视频内容" badge at top-right */
  noContent?: boolean;
  /** Subtitle availability status — shows a warning at the subtitle line when unavailable */
  subtitleStatus?: 'available' | 'unavailable' | 'checking';
}

/** Color/icon map matching BilibiliImport/YouTubeImport design conventions */
const PLATFORM_STYLES: Record<SourcePlatform, {
  icon: LucideIcon;
  bg: string;       // card background
  border: string;   // card border
  iconBg: string;   // icon container background
  iconColor: string; // icon color
  titleColor: string; // title text color
  subtitleColor: string;
}> = {
  bilibili: {
    icon: Tv2,
    bg: 'bg-sky-50',
    border: 'border-sky-100/60',
    iconBg: 'bg-[#00a1d6]/10',
    iconColor: 'text-[#00a1d6]',
    titleColor: 'text-sky-900',
    subtitleColor: 'text-sky-600',
  },
  youtube: {
    icon: Youtube,
    bg: 'bg-red-50',
    border: 'border-red-100/60',
    iconBg: 'bg-red-100',
    iconColor: 'text-red-500',
    titleColor: 'text-red-900',
    subtitleColor: 'text-red-600',
  },
  podcast: {
    icon: Headphones,
    bg: 'bg-amber-50',
    border: 'border-amber-100/60',
    iconBg: 'bg-amber-100',
    iconColor: 'text-amber-500',
    titleColor: 'text-amber-900',
    subtitleColor: 'text-amber-600',
  },
  ai: {
    icon: MessageCircle,
    bg: 'bg-violet-50',
    border: 'border-violet-100/60',
    iconBg: 'bg-violet-100',
    iconColor: 'text-violet-500',
    titleColor: 'text-violet-900',
    subtitleColor: 'text-violet-600',
  },
  web: {
    icon: Globe,
    bg: 'bg-slate-50',
    border: 'border-slate-200/60',
    iconBg: 'bg-slate-200/60',
    iconColor: 'text-slate-500',
    titleColor: 'text-slate-800',
    subtitleColor: 'text-slate-500',
  },
};

/**
 * Upgrade a favicon URL to higher resolution via Google's service.
 * Only applied to YouTube for crisp 64×64 rendering.
 * Other platforms use the original favicon (16×16 is sufficient).
 */
function upgradeFavicon(url: string | undefined, platform: SourcePlatform): string | undefined {
  if (!url) return undefined;
  if (platform === 'youtube') {
    try {
      const parsed = new URL(url);
      return `https://www.google.com/s2/favicons?domain=${parsed.hostname}&sz=64`;
    } catch {
      return url;
    }
  }
  return url; // Use original favicon for all other platforms
}

/**
 * SourceInfoCard — unified source information card.
 *
 * Design follows BilibiliImport/YouTubeImport conventions:
 * - Left: large colored icon container (w-10 h-10 rounded-lg)
 * - Right: title (truncated) + subtitle line + optional tags
 * - Platform-specific color theming
 *
 * Usage:
 * ```tsx
 * <SourceInfoCard
 *   platform="web"
 *   title="Page Title"
 *   favicon="https://..."
 *   subtitle="https://example.com"
 *   onClick={() => chrome.tabs.update(tabId, { active: true })}
 * />
 * ```
 */
export function SourceInfoCard({
  platform,
  title,
  favicon,
  subtitle,
  tags,
  onClick,
  noContent,
  subtitleStatus,
}: SourceInfoCardProps) {
  const styles = PLATFORM_STYLES[platform];
  const Icon = styles.icon;
  const highResFavicon = upgradeFavicon(favicon, platform);

  // Determine what to show in the subtitle/second-row position
  const renderSubtitleLine = () => {
    if (subtitleStatus === 'unavailable') {
      return (
        <p className="text-xs text-red-500 font-medium mt-0.5 flex items-center gap-1">
          <span className="inline-block w-1.5 h-1.5 rounded-full bg-red-500 flex-shrink-0" />
          当前视频没有字幕
        </p>
      );
    }
    if (subtitleStatus === 'checking') {
      return (
        <p className="text-xs text-amber-500 mt-0.5 flex items-center gap-1">
          <span className="inline-block w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse flex-shrink-0" />
          检测字幕中...
        </p>
      );
    }
    if (subtitle) {
      return (
        <p className={`text-xs ${styles.subtitleColor} truncate mt-0.5`}>
          {subtitle}
        </p>
      );
    }
    return null;
  };

  return (
    <div
      className={`${styles.bg} ${styles.border} border rounded-lg p-3 flex items-center gap-3 shadow-soft relative ${
        onClick ? 'cursor-pointer hover:opacity-80 transition-opacity' : ''
      }`}
      onClick={onClick}
    >
      {/* No-content badge — top-right */}
      {noContent && (
        <span className="absolute top-2 right-2 text-[9px] font-semibold px-1.5 py-0.5 rounded-full bg-red-50 text-red-500 border border-red-200/60">
          没有检测到音视频内容
        </span>
      )}
      {/* Icon / Favicon */}
      {highResFavicon ? (
        <img
          src={highResFavicon}
          alt=""
          className="w-10 h-10 rounded-lg flex-shrink-0 bg-white object-cover"
          onError={(e) => {
            // Fallback to platform icon on load failure
            (e.target as HTMLImageElement).style.display = 'none';
            (e.target as HTMLImageElement).nextElementSibling?.classList.remove('hidden');
          }}
        />
      ) : null}

      {/* Fallback icon container */}
      <div
        className={`w-10 h-10 rounded-lg ${styles.iconBg} flex items-center justify-center flex-shrink-0 ${
          highResFavicon ? 'hidden' : ''
        }`}
      >
        <Icon className={`w-5 h-5 ${styles.iconColor}`} />
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <p className={`text-sm font-medium ${styles.titleColor} truncate leading-snug`}>
          {title || 'Untitled'}
        </p>
        {renderSubtitleLine()}
        {tags && tags.length > 0 && (
          <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
            {tags.map((tag, i) => (
              <span
                key={i}
                className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${
                  platform === 'bilibili'
                    ? 'bg-sky-100 text-sky-700'
                    : platform === 'youtube'
                    ? 'bg-red-100 text-red-700'
                    : platform === 'ai'
                    ? 'bg-violet-100 text-violet-700'
                    : 'bg-slate-200/60 text-slate-600'
                }`}
              >
                {tag}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * SourceInfoCardSkeleton — skeleton/loading placeholder for SourceInfoCard.
 * Shows the correct platform icon + animated shimmer lines so the user sees
 * the card frame immediately while data loads.
 */
export function SourceInfoCardSkeleton({ platform }: { platform: SourcePlatform }) {
  const styles = PLATFORM_STYLES[platform];
  const Icon = styles.icon;

  return (
    <div className={`${styles.bg} ${styles.border} border rounded-lg p-3 flex items-center gap-3 shadow-soft`}>
      {/* Platform icon */}
      <div className={`w-10 h-10 rounded-lg ${styles.iconBg} flex items-center justify-center flex-shrink-0`}>
        <Icon className={`w-5 h-5 ${styles.iconColor}`} />
      </div>
      {/* Skeleton text lines with pulse animation */}
      <div className="flex-1 min-w-0 space-y-2">
        <div className="h-4 bg-gray-200/60 rounded animate-pulse-soft w-3/4" />
        <div className="h-3 bg-gray-200/40 rounded animate-pulse-soft w-1/2" />
      </div>
    </div>
  );
}
