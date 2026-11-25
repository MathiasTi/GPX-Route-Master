import React from 'react';
import { Map as MapIcon, Compass, ListFilter, BarChart3, Activity } from 'lucide-react';
import { triggerHaptic } from '../../utils/haptics';

export type MobileWorkspaceView = 'map' | 'planned' | 'activities' | 'dashboard' | 'fitness';

export interface MobileBottomNavProps {
  activeView: MobileWorkspaceView;
  onNavigate: (view: MobileWorkspaceView) => void;
  language: 'de' | 'en';
  trackCount?: number;
  plannedToursCount?: number | null;
}

interface NavItemConfig {
  id: MobileWorkspaceView;
  domId: string;
  labelDe: string;
  labelEn: string;
  accentActiveClass: string;
  indicatorClass: string;
  Icon: React.ComponentType<{ size?: number; className?: string; strokeWidth?: number }>;
}

const NAV_ITEMS: NavItemConfig[] = [
  {
    id: 'map',
    domId: 'mobile-nav-tab-map',
    labelDe: 'Karte',
    labelEn: 'Map',
    accentActiveClass: 'text-indigo-600 dark:text-indigo-400',
    indicatorClass: 'bg-indigo-600 dark:bg-indigo-400',
    Icon: MapIcon
  },
  {
    id: 'planned',
    domId: 'mobile-nav-tab-planned',
    labelDe: 'Touren',
    labelEn: 'Planned',
    accentActiveClass: 'text-emerald-600 dark:text-emerald-400',
    indicatorClass: 'bg-emerald-600 dark:bg-emerald-400',
    Icon: Compass
  },
  {
    id: 'activities',
    domId: 'mobile-nav-tab-activities',
    labelDe: 'Aktivitäten',
    labelEn: 'Activities',
    accentActiveClass: 'text-indigo-600 dark:text-indigo-400',
    indicatorClass: 'bg-indigo-600 dark:bg-indigo-400',
    Icon: ListFilter
  },
  {
    id: 'dashboard',
    domId: 'mobile-nav-tab-dashboard',
    labelDe: 'Dashboard',
    labelEn: 'Dashboard',
    accentActiveClass: 'text-indigo-600 dark:text-indigo-400',
    indicatorClass: 'bg-indigo-600 dark:bg-indigo-400',
    Icon: BarChart3
  },
  {
    id: 'fitness',
    domId: 'mobile-nav-tab-fitness',
    labelDe: 'Fitness',
    labelEn: 'Fitness',
    accentActiveClass: 'text-orange-600 dark:text-orange-400',
    indicatorClass: 'bg-orange-500 dark:bg-orange-400',
    Icon: Activity
  }
];

export const MobileBottomNav: React.FC<MobileBottomNavProps> = React.memo(({
  activeView,
  onNavigate,
  language,
  trackCount = 0
}) => {
  return (
    <nav
      id="mobile-bottom-nav"
      aria-label={language === 'en' ? 'Primary Mobile Navigation' : 'Mobile Hauptnavigation'}
      className="lg:hidden fixed bottom-0 left-0 right-0 z-[95] bg-white/98 dark:bg-slate-950/98 border-t border-slate-200/90 dark:border-slate-800 shadow-[0_-4px_16px_-6px_rgba(15,23,42,0.12)] select-none pb-[env(safe-area-inset-bottom,0px)] mobile-contain"
    >
      <div className="grid grid-cols-5 items-center h-[60px] max-w-2xl mx-auto px-1">
        {NAV_ITEMS.map(({ id, domId, labelDe, labelEn, accentActiveClass, indicatorClass, Icon }) => {
          const isActive = activeView === id;
          const label = language === 'en' ? labelEn : labelDe;

          return (
            <button
              key={id}
              id={domId}
              type="button"
              aria-current={isActive ? 'page' : undefined}
              onClick={() => {
                triggerHaptic('light');
                onNavigate(id);
              }}
              className={`relative flex flex-col items-center justify-center min-h-[48px] min-w-[44px] px-1 py-1 rounded-xl transition-colors touch-manipulation active:scale-95 cursor-pointer ${
                isActive
                  ? `${accentActiveClass} font-bold`
                  : 'text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200 font-medium'
              }`}
            >
              {isActive && (
                <span
                  aria-hidden="true"
                  className={`absolute top-0.5 w-6 h-[2.5px] rounded-full ${indicatorClass}`}
                />
              )}
              <div className="relative flex items-center justify-center">
                <Icon size={20} strokeWidth={isActive ? 2.4 : 1.9} />
                {id === 'map' && trackCount > 0 && (
                  <span
                    className={`absolute -top-1 -right-2.5 font-mono tabular-nums text-[9px] font-bold leading-none ${
                      isActive ? 'text-indigo-600 dark:text-indigo-300' : 'text-slate-400 dark:text-slate-500'
                    }`}
                  >
                    {trackCount > 99 ? '99+' : trackCount}
                  </span>
                )}
              </div>
              <span className="text-[10px] leading-tight mt-1 whitespace-nowrap truncate max-w-full tracking-tight">
                {label}
              </span>
            </button>
          );
        })}
      </div>
    </nav>
  );
});
