import React from 'react';
import emblemImage from '../../assets/image/anusyuti_emblem.png';
import fullImage from '../../assets/image/anusyuti_full.png';
import iconImage from '../../assets/image/anusyuti_icon.png';
import logoImage from '../../assets/image/anusyuti logo.png';

export interface AnusyutiLogoProps {
  className?: string;
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl';
  variant?: 'image' | 'full' | 'icon' | 'horizontal';
  showSubtitle?: boolean;
  subtitleText?: string;
  theme?: 'light' | 'dark' | 'auto';
}

export const AnusyutiLogo: React.FC<AnusyutiLogoProps> = ({
  className = '',
  size = 'md',
  variant = 'full',
  showSubtitle = false,
  subtitleText = '',
  theme = 'auto',
}) => {
  // Sizing scale with prominent dimensions
  const dimensions = {
    xs: { imgH: 26, iconBox: 28, text: 'text-xs', sub: 'text-[9px]' },
    sm: { imgH: 34, iconBox: 38, text: 'text-sm font-black', sub: 'text-[10px]' },
    md: { imgH: 48, iconBox: 52, text: 'text-lg font-black', sub: 'text-xs' },
    lg: { imgH: 72, iconBox: 76, text: 'text-2xl font-black', sub: 'text-xs' },
    xl: { imgH: 96, iconBox: 100, text: 'text-3xl font-black', sub: 'text-sm' },
  };

  const dim = dimensions[size] || dimensions.md;

  // Icon only variant
  if (variant === 'icon') {
    return (
      <div
        className={`inline-flex items-center justify-center rounded-xl bg-white/95 border border-slate-200/80 shadow-xs p-1.5 transition-transform duration-200 hover:scale-105 ${className}`}
        style={{ width: dim.iconBox, height: dim.iconBox }}
        title="Anusyuti"
      >
        <img
          src={emblemImage || iconImage || logoImage}
          alt="Anusyuti"
          referrerPolicy="no-referrer"
          className="object-contain w-full h-full drop-shadow-xs"
        />
      </div>
    );
  }

  // Direct image variant (clean transparent full logo)
  if (variant === 'image') {
    return (
      <div className={`inline-flex items-center justify-center ${className}`}>
        <img
          src={fullImage || logoImage}
          alt="Anusyuti"
          referrerPolicy="no-referrer"
          className="object-contain filter drop-shadow-xs transition-transform duration-200 hover:scale-[1.02]"
          style={{ height: dim.imgH, maxWidth: '100%' }}
        />
      </div>
    );
  }

  // Horizontal variant: Emblem + crisp bold typography
  if (variant === 'horizontal') {
    const isDark = theme === 'dark';
    return (
      <div className={`inline-flex items-center gap-2.5 select-none ${className}`}>
        <img
          src={emblemImage || iconImage || logoImage}
          alt="Anusyuti"
          referrerPolicy="no-referrer"
          className="object-contain shrink-0 filter drop-shadow-xs transition-transform duration-200 hover:scale-105"
          style={{ height: dim.imgH }}
        />
        <div className="flex flex-col leading-tight">
          <span
            className={`font-black tracking-tight ${dim.text} ${
              isDark ? 'text-white' : 'text-[#023b77]'
            }`}
          >
            ANUSYUTI
          </span>
          {showSubtitle && subtitleText && (
            <span
              className={`font-semibold tracking-wider uppercase ${dim.sub} ${
                isDark ? 'text-slate-300' : 'text-slate-500'
              }`}
            >
              {subtitleText}
            </span>
          )}
        </div>
      </div>
    );
  }

  // Full stacked variant (default)
  return (
    <div className={`inline-flex flex-col items-center justify-center gap-1.5 ${className}`}>
      <img
        src={fullImage || logoImage}
        alt="Anusyuti"
        referrerPolicy="no-referrer"
        className="object-contain rounded-lg transition-transform duration-200 hover:scale-[1.02] filter drop-shadow-xs shrink-0"
        style={{ height: dim.imgH, maxWidth: '100%' }}
      />
      {showSubtitle && subtitleText && (
        <span className="text-[11px] font-bold tracking-widest text-[#039583] uppercase mt-0.5">
          {subtitleText}
        </span>
      )}
    </div>
  );
};

export const SahakarLogo = AnusyutiLogo;

