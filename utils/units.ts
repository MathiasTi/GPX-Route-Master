import type { AppLanguage, UnitSystem } from './appSettings';

export const KM_TO_MI = 0.621371;
export const M_TO_FT = 3.28084;
export const KG_TO_LBS = 2.20462;

/**
 * Returns the canonical BCP 47 locale tag for number and date formatting.
 */
export function getLocale(lang: AppLanguage): string {
  return lang === 'en' ? 'en-US' : 'de-DE';
}

export function convertDistance(km: number, unitSystem: UnitSystem): number {
  const safeKm = Number.isFinite(km) ? km : 0;
  return unitSystem === 'imperial' ? safeKm * KM_TO_MI : safeKm;
}

export function distanceUnit(unitSystem: UnitSystem): 'km' | 'mi' {
  return unitSystem === 'imperial' ? 'mi' : 'km';
}

export function formatDistance(
  km: number,
  unitSystem: UnitSystem,
  lang: AppLanguage = 'de',
  decimals: number = 1
): string {
  const val = convertDistance(km, unitSystem);
  const rounded = Number(val.toFixed(decimals));
  return `${rounded.toLocaleString(getLocale(lang), {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals
  })} ${distanceUnit(unitSystem)}`;
}

export function convertElevation(meters: number, unitSystem: UnitSystem): number {
  const safeM = Number.isFinite(meters) ? meters : 0;
  return unitSystem === 'imperial' ? safeM * M_TO_FT : safeM;
}

export function elevationUnit(unitSystem: UnitSystem, lang: AppLanguage = 'de'): 'hm' | 'm' | 'ft' {
  if (unitSystem === 'imperial') return 'ft';
  return lang === 'en' ? 'm' : 'hm';
}

export function formatElevation(
  meters: number,
  unitSystem: UnitSystem,
  lang: AppLanguage = 'de',
  includeSign: boolean = false
): string {
  const val = Math.round(convertElevation(meters, unitSystem));
  const prefix = includeSign ? (val >= 0 ? '+' : '') : '';
  return `${prefix}${val.toLocaleString(getLocale(lang))} ${elevationUnit(unitSystem, lang)}`;
}

export function convertSpeed(kmh: number, unitSystem: UnitSystem): number {
  const safe = Number.isFinite(kmh) ? kmh : 0;
  return unitSystem === 'imperial' ? safe * KM_TO_MI : safe;
}

export function speedUnit(unitSystem: UnitSystem): 'km/h' | 'mph' {
  return unitSystem === 'imperial' ? 'mph' : 'km/h';
}

export function formatSpeed(
  kmh: number,
  unitSystem: UnitSystem,
  decimals: number = 1
): string {
  const val = convertSpeed(kmh, unitSystem);
  return `${val.toFixed(decimals)} ${speedUnit(unitSystem)}`;
}

export function paceUnit(unitSystem: UnitSystem): 'min/km' | 'min/mi' {
  return unitSystem === 'imperial' ? 'min/mi' : 'min/km';
}

/**
 * Formats a pace given in seconds per kilometer into either `M:SS /km` or `M:SS /mi`,
 * rounding total seconds first to guarantee `:60` never occurs.
 */
export function formatPaceFromSecPerKm(
  secPerKm: number,
  unitSystem: UnitSystem,
  includeUnit: boolean = true
): string {
  if (!Number.isFinite(secPerKm) || secPerKm <= 0) {
    return includeUnit ? `--:-- ${paceUnit(unitSystem)}` : '--:--';
  }
  const scaledSec = unitSystem === 'imperial' ? secPerKm / KM_TO_MI : secPerKm;
  if (scaledSec > 3600) {
    return includeUnit ? `>60:00 ${paceUnit(unitSystem)}` : '>60:00';
  }
  const roundedTotalSec = Math.round(scaledSec);
  const mins = Math.floor(roundedTotalSec / 60);
  const secs = roundedTotalSec % 60;
  const formatted = `${mins}:${String(secs).padStart(2, '0')}`;
  return includeUnit ? `${formatted} ${paceUnit(unitSystem)}` : formatted;
}

export function formatPaceFromSpeed(
  kmh: number,
  unitSystem: UnitSystem,
  includeUnit: boolean = true
): string {
  if (!Number.isFinite(kmh) || kmh <= 0.1) {
    return includeUnit ? `--:-- ${paceUnit(unitSystem)}` : '--:--';
  }
  return formatPaceFromSecPerKm(3600 / kmh, unitSystem, includeUnit);
}

export function formatVam(
  mPerHour: number,
  unitSystem: UnitSystem,
  lang: AppLanguage = 'de'
): string {
  const safe = Number.isFinite(mPerHour) ? mPerHour : 0;
  if (unitSystem === 'imperial') {
    const ftHr = Math.round(safe * M_TO_FT);
    return `${ftHr.toLocaleString(getLocale(lang))} ft/h`;
  }
  return `${Math.round(safe).toLocaleString(getLocale(lang))} VAM`;
}

export function convertWeight(kg: number, unitSystem: UnitSystem): number {
  const safe = Number.isFinite(kg) ? kg : 0;
  return unitSystem === 'imperial' ? safe * KG_TO_LBS : safe;
}

export function weightUnit(unitSystem: UnitSystem): 'kg' | 'lbs' {
  return unitSystem === 'imperial' ? 'lbs' : 'kg';
}

export function formatWeight(
  kg: number,
  unitSystem: UnitSystem,
  decimals: number = 1
): string {
  const val = convertWeight(kg, unitSystem);
  const out = decimals === 0 ? Math.round(val).toString() : val.toFixed(decimals);
  return `${out} ${weightUnit(unitSystem)}`;
}

export function formatTemp(celsius: number, unitSystem: UnitSystem): string {
  const safe = Number.isFinite(celsius) ? celsius : 0;
  if (unitSystem === 'imperial') {
    const f = Math.round((safe * 9) / 5 + 32);
    return `${f} °F`;
  }
  return `${Math.round(safe)} °C`;
}
