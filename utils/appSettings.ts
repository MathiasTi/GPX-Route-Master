import { useEffect } from 'react';
import { safeGetItem, safeSetItem } from './storage';
import { MapLayer } from '../types';

export type AppLanguage = 'de' | 'en';
export type UiStyleId =
  | 'default'
  | 'aero-glass'
  | 'peloton-pro'
  | 'alpine-emerald'
  | 'cyber-telemetry'
  | 'minimal-paper';
export type UiDensity = 'compact' | 'comfortable' | 'spacious';
export type UiRadius = 'sharp' | 'rounded' | 'pill';
export type ColorMode = 'light' | 'dark' | 'system';
export type UnitSystem = 'metric' | 'imperial';
export type DefaultWorkspaceView = 'map' | 'planned' | 'activities' | 'dashboard' | 'fitness';

export interface AppPreferences {
  language: AppLanguage;
  uiStyle: UiStyleId;
  uiDensity: UiDensity;
  uiRadius: UiRadius;
  colorMode: ColorMode;
  unitSystem: UnitSystem;
  defaultView: DefaultWorkspaceView;
  defaultMapLayer: MapLayer;
  bikeWeight: number;
  rhrBaseline: number;
  autoFitOnLoad: boolean;
  autoSurfaceAnalysis: boolean;
  showElevationProfile: boolean;
  enableAnimations: boolean;
  enableHaptics: boolean;
  tileCacheEnabled: boolean;
  tileCacheMaxMb: number;
  tileCacheMaxCount: number;
  surfaceCacheEnabled: boolean;
  surfaceCacheTtlDays: number;
  surfaceCacheMaxEntries: number;
}

export const APP_PREFERENCES_STORAGE_KEY = 'velo_app_preferences_v1';

export const DEFAULT_APP_PREFERENCES: AppPreferences = {
  language: 'de',
  uiStyle: 'default',
  uiDensity: 'comfortable',
  uiRadius: 'rounded',
  colorMode: 'light',
  unitSystem: 'metric',
  defaultView: 'map',
  defaultMapLayer: MapLayer.OSM,
  bikeWeight: 8.5,
  rhrBaseline: 55,
  autoFitOnLoad: true,
  autoSurfaceAnalysis: false,
  showElevationProfile: true,
  enableAnimations: true,
  enableHaptics: true,
  tileCacheEnabled: true,
  tileCacheMaxMb: 150,
  tileCacheMaxCount: 3500,
  surfaceCacheEnabled: true,
  surfaceCacheTtlDays: 30,
  surfaceCacheMaxEntries: 400
};

export interface UiStylePresetMeta {
  id: UiStyleId;
  nameDe: string;
  nameEn: string;
  descDe: string;
  descEn: string;
  swatches: [string, string, string];
  badgeDe: string;
  badgeEn: string;
}

export const UI_STYLE_PRESETS: UiStylePresetMeta[] = [
  {
    id: 'default',
    nameDe: 'Velo Royal',
    nameEn: 'Velo Royal',
    descDe: 'Klassisches Indigo & klares Weiß – ausgewogener Kontrast für Karte und Analysen.',
    descEn: 'Classic indigo and crisp slate with balanced contrast for maps and analytics.',
    swatches: ['#4f46e5', '#6366f1', '#f8fafc'],
    badgeDe: 'Standard',
    badgeEn: 'Default'
  },
  {
    id: 'aero-glass',
    nameDe: 'Aero Glass',
    nameEn: 'Aero Glass',
    descDe: 'Transluzente Milchglas-Flächen mit Himmelblau-Akzent und moderner Tiefe.',
    descEn: 'Frosted glass panels with sky-blue accents and layered depth.',
    swatches: ['#0284c7', '#38bdf8', '#e0f2fe'],
    badgeDe: 'Modern',
    badgeEn: 'Modern'
  },
  {
    id: 'peloton-pro',
    nameDe: 'Peloton Pro',
    nameEn: 'Peloton Pro',
    descDe: 'Rennrad-Telemetry in Gold-Bernstein und sattem Carbon für maximale Lesbarkeit.',
    descEn: 'Road race telemetry aesthetic with amber gold highlights and deep carbon tones.',
    swatches: ['#d97706', '#f59e0b', '#18181b'],
    badgeDe: 'Pro Sport',
    badgeEn: 'Pro Sport'
  },
  {
    id: 'alpine-emerald',
    nameDe: 'Alpine Trail',
    nameEn: 'Alpine Trail',
    descDe: 'Frische Smaragd- und Waldgrün-Töne, ideal für Gravel-, Trail- und Bergtouren.',
    descEn: 'Fresh emerald and forest tones crafted for gravel, trail, and mountain adventures.',
    swatches: ['#059669', '#10b981', '#ecfdf5'],
    badgeDe: 'Outdoor',
    badgeEn: 'Outdoor'
  },
  {
    id: 'cyber-telemetry',
    nameDe: 'Cyber Telemetry',
    nameEn: 'Cyber Telemetry',
    descDe: 'Dynamisches Violett-Cyan-Cockpit inspiriert von Labor- und Powermeter-Suites.',
    descEn: 'Vibrant violet-cyan telemetry cockpit inspired by lab and power-analysis suites.',
    swatches: ['#7c3aed', '#06b6d4', '#0f172a'],
    badgeDe: 'High-Tech',
    badgeEn: 'High-Tech'
  },
  {
    id: 'minimal-paper',
    nameDe: 'Nordic Minimal',
    nameEn: 'Nordic Minimal',
    descDe: 'Reduzierter Editorial-Look mit ruhiger Papier-Textur und klaren Monochrom-Akzenten.',
    descEn: 'Calm editorial paper surface with sharp monochrome accents and zero clutter.',
    swatches: ['#18181b', '#52525b', '#fafaf9'],
    badgeDe: 'Minimal',
    badgeEn: 'Minimal'
  }
];

const VALID_LANGUAGES = new Set<AppLanguage>(['de', 'en']);
const VALID_UI_STYLES = new Set<UiStyleId>([
  'default',
  'aero-glass',
  'peloton-pro',
  'alpine-emerald',
  'cyber-telemetry',
  'minimal-paper'
]);
const VALID_DENSITIES = new Set<UiDensity>(['compact', 'comfortable', 'spacious']);
const VALID_RADII = new Set<UiRadius>(['sharp', 'rounded', 'pill']);
const VALID_COLOR_MODES = new Set<ColorMode>(['light', 'dark', 'system']);
const VALID_UNITS = new Set<UnitSystem>(['metric', 'imperial']);
const VALID_DEFAULT_VIEWS = new Set<DefaultWorkspaceView>([
  'map',
  'planned',
  'activities',
  'dashboard',
  'fitness'
]);
const VALID_MAP_LAYERS = new Set<MapLayer>(Object.values(MapLayer));

export function sanitizeAppPreferences(raw: unknown): AppPreferences {
  const input = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const bikeWeightNum = Number(input.bikeWeight);
  const rhrNum = Number(input.rhrBaseline);
  const tileMaxMbNum = Number(input.tileCacheMaxMb);
  const tileMaxCountNum = Number(input.tileCacheMaxCount);
  const surfaceTtlNum = Number(input.surfaceCacheTtlDays);
  const surfaceMaxNum = Number(input.surfaceCacheMaxEntries);

  return {
    language: VALID_LANGUAGES.has(input.language as AppLanguage)
      ? (input.language as AppLanguage)
      : DEFAULT_APP_PREFERENCES.language,
    uiStyle: VALID_UI_STYLES.has(input.uiStyle as UiStyleId)
      ? (input.uiStyle as UiStyleId)
      : DEFAULT_APP_PREFERENCES.uiStyle,
    uiDensity: VALID_DENSITIES.has(input.uiDensity as UiDensity)
      ? (input.uiDensity as UiDensity)
      : DEFAULT_APP_PREFERENCES.uiDensity,
    uiRadius: VALID_RADII.has(input.uiRadius as UiRadius)
      ? (input.uiRadius as UiRadius)
      : DEFAULT_APP_PREFERENCES.uiRadius,
    colorMode: VALID_COLOR_MODES.has(input.colorMode as ColorMode)
      ? (input.colorMode as ColorMode)
      : DEFAULT_APP_PREFERENCES.colorMode,
    unitSystem: VALID_UNITS.has(input.unitSystem as UnitSystem)
      ? (input.unitSystem as UnitSystem)
      : DEFAULT_APP_PREFERENCES.unitSystem,
    defaultView: VALID_DEFAULT_VIEWS.has(input.defaultView as DefaultWorkspaceView)
      ? (input.defaultView as DefaultWorkspaceView)
      : DEFAULT_APP_PREFERENCES.defaultView,
    defaultMapLayer: VALID_MAP_LAYERS.has(input.defaultMapLayer as MapLayer)
      ? (input.defaultMapLayer as MapLayer)
      : DEFAULT_APP_PREFERENCES.defaultMapLayer,
    bikeWeight:
      Number.isFinite(bikeWeightNum) && bikeWeightNum >= 0
        ? Number(bikeWeightNum.toFixed(1))
        : DEFAULT_APP_PREFERENCES.bikeWeight,
    rhrBaseline:
      Number.isFinite(rhrNum) && rhrNum > 0
        ? Math.round(rhrNum)
        : DEFAULT_APP_PREFERENCES.rhrBaseline,
    autoFitOnLoad:
      typeof input.autoFitOnLoad === 'boolean'
        ? input.autoFitOnLoad
        : DEFAULT_APP_PREFERENCES.autoFitOnLoad,
    autoSurfaceAnalysis:
      typeof input.autoSurfaceAnalysis === 'boolean'
        ? input.autoSurfaceAnalysis
        : DEFAULT_APP_PREFERENCES.autoSurfaceAnalysis,
    showElevationProfile:
      typeof input.showElevationProfile === 'boolean'
        ? input.showElevationProfile
        : DEFAULT_APP_PREFERENCES.showElevationProfile,
    enableAnimations:
      typeof input.enableAnimations === 'boolean'
        ? input.enableAnimations
        : DEFAULT_APP_PREFERENCES.enableAnimations,
    enableHaptics:
      typeof input.enableHaptics === 'boolean'
        ? input.enableHaptics
        : DEFAULT_APP_PREFERENCES.enableHaptics,
    tileCacheEnabled:
      typeof input.tileCacheEnabled === 'boolean'
        ? input.tileCacheEnabled
        : DEFAULT_APP_PREFERENCES.tileCacheEnabled,
    tileCacheMaxMb:
      Number.isFinite(tileMaxMbNum) && tileMaxMbNum >= 25 && tileMaxMbNum <= 1000
        ? Math.round(tileMaxMbNum)
        : DEFAULT_APP_PREFERENCES.tileCacheMaxMb,
    tileCacheMaxCount:
      Number.isFinite(tileMaxCountNum) && tileMaxCountNum >= 250 && tileMaxCountNum <= 25000
        ? Math.round(tileMaxCountNum)
        : DEFAULT_APP_PREFERENCES.tileCacheMaxCount,
    surfaceCacheEnabled:
      typeof input.surfaceCacheEnabled === 'boolean'
        ? input.surfaceCacheEnabled
        : DEFAULT_APP_PREFERENCES.surfaceCacheEnabled,
    surfaceCacheTtlDays:
      Number.isFinite(surfaceTtlNum) && surfaceTtlNum >= 1 && surfaceTtlNum <= 365
        ? Math.round(surfaceTtlNum)
        : DEFAULT_APP_PREFERENCES.surfaceCacheTtlDays,
    surfaceCacheMaxEntries:
      Number.isFinite(surfaceMaxNum) && surfaceMaxNum >= 50 && surfaceMaxNum <= 5000
        ? Math.round(surfaceMaxNum)
        : DEFAULT_APP_PREFERENCES.surfaceCacheMaxEntries
  };
}

export function loadAppPreferences(): AppPreferences {
  try {
    const raw = safeGetItem(APP_PREFERENCES_STORAGE_KEY);
    if (!raw) return { ...DEFAULT_APP_PREFERENCES };
    return sanitizeAppPreferences(JSON.parse(raw));
  } catch {
    return { ...DEFAULT_APP_PREFERENCES };
  }
}

export function saveAppPreferences(partial: Partial<AppPreferences>): AppPreferences {
  const current = loadAppPreferences();
  const merged = sanitizeAppPreferences({ ...current, ...partial });
  safeSetItem(APP_PREFERENCES_STORAGE_KEY, JSON.stringify(merged));
  return merged;
}

export function resolveSystemDarkPreference(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return false;
  }
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

export function resolveEffectiveTheme(colorMode: ColorMode): 'light' | 'dark' {
  if (colorMode === 'dark') return 'dark';
  if (colorMode === 'light') return 'light';
  return resolveSystemDarkPreference() ? 'dark' : 'light';
}

export function applyPreferencesToDom(prefs: AppPreferences, activeTheme: 'light' | 'dark'): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  root.lang = prefs.language;
  root.dataset.uiStyle = prefs.uiStyle;
  root.dataset.uiDensity = prefs.uiDensity;
  root.dataset.uiRadius = prefs.uiRadius;
  root.dataset.unitSystem = prefs.unitSystem;
  root.dataset.animations = prefs.enableAnimations ? 'true' : 'false';
  root.dataset.haptics = prefs.enableHaptics ? 'true' : 'false';
  if (activeTheme === 'dark') {
    root.classList.add('dark');
  } else {
    root.classList.remove('dark');
  }
}

export function tr(lang: AppLanguage, de: string, en: string): string {
  return lang === 'en' ? en : de;
}

/**
 * Exact German -> English dictionary for UI chrome, headings, charts, tooltips & controls.
 */
const DE_TO_EN_EXACT: Record<string, string> = {
  // Primary Navigation & Global Bar
  'Karte': 'Map',
  'Kartenansicht': 'Map View',
  'Geplante Touren': 'Planned Tours',
  'Aktivitäten': 'Activities',
  'Aktivitäten-Dashboard': 'Activities Dashboard',
  'Fitness & Gesundheit': 'Fitness & Health',
  'Garmin Sync': 'Garmin Sync',
  'Einstellungen': 'Settings',
  'Profil': 'Profile',
  'Import': 'Import',
  'Schließen': 'Close',
  'Fertig': 'Done',
  'Abbrechen': 'Cancel',
  'Speichern': 'Save',
  'Zurücksetzen': 'Reset',
  'Exportieren': 'Export',
  'Löschen': 'Delete',
  'Suchen': 'Search',
  'Filter': 'Filter',
  'Filter zurücksetzen': 'Reset Filters',
  'Aktualisieren': 'Refresh',
  'Laden...': 'Loading...',
  'Workspace wird geladen...': 'Loading workspace...',
  'App sperren': 'Lock App',
  'Theme umschalten': 'Toggle Theme',
  'Hellen Modus aktivieren': 'Enable Light Mode',
  'Dunklen Modus aktivieren': 'Enable Dark Mode',
  'Menü und Streckenliste öffnen': 'Open menu and track list',
  'Seitenleiste öffnen': 'Open sidebar',
  'Athleten-Profil & Schwellenwerte': 'Athlete Profile & Thresholds',
  'Athleten-Profil: Alter, Gewicht, FTP & Max. Puls': 'Athlete Profile: Age, Weight, FTP & Max HR',
  'GPX, FIT oder ZIP importieren': 'Import GPX, FIT or ZIP',
  'Garmin Connect Sync (Personal API)': 'Garmin Connect Sync (Personal API)',
  'Alle Einstellungen & UI-Stile...': 'All Settings & UI Styles...',
  'Alle Einstellungen öffnen': 'Open All Settings',
  'FTP (Watt)': 'FTP (Watts)',
  'Gewicht (kg)': 'Weight (kg)',
  'Alter (Jahre)': 'Age (Years)',
  'Max. Puls (bpm)': 'Max HR (bpm)',
  'Relativleistung:': 'Power-to-weight:',
  'Kurven': 'Series',
  'Kurven, Höhenfilter & Werkzeuge': 'Series, Elevation Filter & Tools',
  'Kurven, Höhenfilter & Aktionen': 'Series, Elevation Filter & Actions',
  'Kurve glätten': 'Smooth Curve',
  'GPX Export': 'GPX Export',
  'Reparieren': 'Repair',
  'Weitere Aktionen': 'More Actions',
  'Ansicht wechseln': 'Switch View',
  'Sprache': 'Language',
  'Design': 'Appearance',
  'Hell': 'Light',
  'Dunkel': 'Dark',
  'Einstellungen & Speicher': 'Settings & Storage',

  // Map, Sidebar & Elevation Profile
  'Höhenprofil': 'Elevation Profile',
  'Höhenprofil einblenden': 'Show Elevation Profile',
  'Höhenprofil anzeigen': 'Display Elevation Profile',
  'Höhenprofil ausblenden': 'Hide Elevation Profile',
  'Strecken im Workspace': 'Workspace Tracks',
  'Arbeitsbereich': 'Workspace',
  'Strecken': 'Tracks',
  'Strecke': 'Track',
  'Workspace leeren': 'Clear Workspace',
  'Alle entfernen': 'Remove All',
  'Versteckte entfernen': 'Remove Hidden',
  'Nur diese behalten': 'Keep Only This',
  'Auf Karte vergleichen': 'Compare on Map',
  'Vergleich beenden': 'Exit Comparison',
  'Strecken vergleichen': 'Compare Tracks',
  'Vergleichen': 'Compare',
  'Kartenebene': 'Map Layer',
  '3D-Gelände': '3D Terrain',
  '3D-Überflug': '3D Flyover',
  '3D-Überflug Video Studio starten': 'Launch 3D Flyover Video Studio',
  'Wetter & Routen-Prognose': 'Weather & Route Forecast',
  'Meteorologische Bedingungen & Empfehlungen': 'Weather conditions & riding recommendations',
  'Touren-Bibliothek': 'Tour Library',
  'Referenztouren laden': 'Load Reference Tours',
  'In Bibliothek speichern': 'Save to Library',
  'Auf Karte laden': 'Load on Map',
  'Im Workspace öffnen': 'Open in Workspace',
  'Solo öffnen': 'Open Solo',
  'Zum Workspace hinzufügen': 'Add to Workspace',
  'Aus Workspace entfernen': 'Remove from Workspace',
  'Belagsanalyse': 'Surface Analysis',
  'Oberfläche analysieren': 'Analyze Surface',
  'Steigung': 'Gradient',
  'Max. Steigung': 'Max Gradient',
  'Ø Steigung': 'Avg Gradient',
  'Anstieg': 'Ascent',
  'Abstieg': 'Descent',
  'Höhenmeter': 'Elevation Gain',
  'Höhenmeter (Anstieg)': 'Elevation Gain (Ascent)',
  'Distanz': 'Distance',
  'Gesamtdistanz': 'Total Distance',
  'Dauer': 'Duration',
  'Gesamtzeit': 'Total Time',
  'Bewegungszeit': 'Moving Time',
  'Geschwindigkeit': 'Speed',
  'Ø Geschwindigkeit': 'Avg Speed',
  'Leistung': 'Power',
  'Ø Leistung': 'Avg Power',
  'Max. Leistung': 'Max Power',
  'Herzfrequenz': 'Heart Rate',
  'Ø Herzfrequenz': 'Avg Heart Rate',
  'Max. Herzfrequenz': 'Max Heart Rate',
  'Trittfrequenz': 'Cadence',
  'Temperatur': 'Temperature',
  'Kalorien': 'Calories',
  'Schotter': 'Gravel',
  'Waldweg': 'Forest Road',
  'Pfad / Trail': 'Trail / Path',
  'Pflaster': 'Cobblestone',
  'Unbekannt': 'Unknown',
  'Verarbeite Aktivitäten...': 'Processing activities...',
  'Bitte lassen Sie dieses Fenster geöffnet, bis die Aktivitätsanalyse abgeschlossen ist.':
    'Please keep this window open until activity analysis completes.',
  'Offline-Modus:': 'Offline Mode:',
  'Tastenkürzel': 'Keyboard Shortcuts',
  'Sportmetrik-Glossar': 'Sports Metrics Glossary',
  'Strecke umkehren': 'Reverse Track',
  'Steigungsanomalien beheben': 'Fix Gradient Anomalies',
  'Zeitlücken-Analyse': 'Time Gap Analysis',
  'Track-Validierung': 'Track Validation',
  'Intensiv-Analyse': 'Deep Track Analysis',

  // Planned Tours & Activities Manager & Dashboard
  'Gespeicherte Touren': 'Saved Tours',
  'Touren-Planer & Bibliothek': 'Tour Planner & Library',
  'Alle Touren': 'All Tours',
  'Alle Aktivitäten': 'All Activities',
  'Alle Sportarten': 'All Sports',
  'Radfahren': 'Cycling',
  'Radsport': 'Cycling',
  'Laufen': 'Running',
  'Wandern': 'Hiking',
  'Sonstige': 'Other',
  'Krafttraining': 'Strength Training',
  'Fußball': 'Soccer',
  'Schwimmen': 'Swimming',
  'Rudern': 'Rowing',
  'Woche': 'Week',
  'Monat': 'Month',
  'Jahr': 'Year',
  'Gesamt': 'All Time',
  'Alle Jahre': 'All Years',
  'Zeitraum': 'Time Range',
  'Zurück': 'Back',
  'Weiter': 'Next',
  'Heute': 'Today',
  'Aktive Tage': 'Active Days',
  'Längste Serie': 'Longest Streak',
  'Top-Leistungen': 'Top Performances',
  'Längste Aktivität': 'Longest Activity',
  'Meiste Höhenmeter': 'Most Elevation Gain',
  'Schnellste Aktivität': 'Fastest Activity',
  'Neueste zuerst': 'Newest First',
  'Längste Distanz': 'Longest Distance',
  'Längste Dauer': 'Longest Duration',
  'Höchste Ø Geschw.': 'Highest Avg Speed',
  'Aktivitäts-Archiv': 'Activity Archive',
  'Aktivitäten-Übersicht': 'Activities Overview',
  'Load-Ratio (ACWR 7d/28d)': 'Load Ratio (ACWR 7d/28d)',
  'Aerobe Effizienz (EF)': 'Aerobic Efficiency (EF)',
  'Stärkster Trainingstag': 'Peak Training Day',
  'Belastung & Erholung (7d Akut vs. 28d Fitness)': 'Load & Recovery (7d Acute vs. 28d Fitness)',
  'Aerobe Effizienz (HF vs. Tempo)': 'Aerobic Efficiency (HR vs. Speed)',
  'Alle HF-Daten': 'All HR Data',
  'Jahres-Overlay (Kumulierte km Jan–Dez)': 'Year-over-Year Overlay (Cum. km Jan–Dec)',
  '12-Wochen Konsistenz-Matrix': '12-Week Consistency Matrix',
  'Diagramm-Filter aufheben': 'Clear Chart Filter',
  'Weniger': 'Less',
  'Mehr': 'More',
  'Optimaler Bereich': 'Optimal Zone',
  'Hohe Aufbaulast': 'High Build Load',
  'Erholungs-Phase': 'Recovery Phase',
  'Zu wenig Historie': 'Insufficient History',

  // Garmin Health & Fitness Cockpit
  'Cockpit': 'Cockpit',
  'Übersicht': 'Overview',
  'Performance & Form': 'Performance & Form',
  'Bestwerte & Rekorde': 'Personal Records',
  'Aktivitäts-Kalender': 'Activity Calendar',
  'Aktivitäten-Analyse': 'Activity Analysis',
  'Vergleich': 'Compare',
  'Korrelationen & Analysen': 'Correlations & Analytics',
  'Schlaf': 'Sleep',
  'Schlafverlauf': 'Sleep Trends',
  'Schlafarchitektur': 'Sleep Architecture',
  'Schlafqualität': 'Sleep Quality',
  'Schlafdauer': 'Sleep Duration',
  'Ø Schlafdauer': 'Avg Sleep',
  'Tiefschlaf': 'Deep Sleep',
  'Leichtschlaf': 'Light Sleep',
  'REM-Schlaf': 'REM Sleep',
  'Wachphasen': 'Awake',
  'Ruhepuls': 'Resting HR',
  'Ø Ruhepuls': 'Avg RHR',
  'Ø Ruhepuls (RHR)': 'Avg Resting HR (RHR)',
  'Schritte': 'Steps',
  'Ø Schritte': 'Avg Steps',
  'Tagesziel: 10.000': 'Daily Goal: 10,000',
  'Stress': 'Stress',
  'Ø Stress': 'Avg Stress',
  'Erholungsstatus': 'Recovery Status',
  'Readiness · Ø Stress': 'Readiness · Avg Stress',
  'Trainingsbelastung': 'Training Load',
  'Fitness (CTL)': 'Fitness (CTL)',
  'Ermüdung (ATL)': 'Fatigue (ATL)',
  'Form (TSB)': 'Form (TSB)',
  'Trainingszonen': 'Training Zones',
  'Leistungsdauer-Kurve': 'Power Duration Curve',
  'Athleten-Radar': 'Athlete Radar',
  'Umfang': 'Volume',
  'Bergfestigkeit': 'Climbing',
  'Kardio-Effizienz': 'Cardio Efficiency',
  'Schlaf-Qualität': 'Sleep Quality',
  'Resilienz': 'Resilience',
  'Letzte 7 Tage': 'Last 7 Days',
  'Letzte 14 Tage': 'Last 14 Days',
  'Letzte 30 Tage': 'Last 30 Days',
  'Letzte 90 Tage': 'Last 90 Days',
  '1 Jahr': '1 Year',
  'Alle Daten': 'All Data',
  '14 Tage': '14 Days',
  '30 Tage': '30 Days',
  '90 Tage': '90 Days',
  '365 Tage': '365 Days',
  'Optimal': 'Optimal',
  'Erholt': 'Recovered',
  'Leicht belastet': 'Mild Load',
  'Hohe Belastung': 'High Load',
  'Überbelastung': 'Overreaching',

  // Valhalla & OSM Surface Analysis
  'Valhalla & OSM abgeschlossen': 'Valhalla & OSM Completed',
  'Teilweise erfasst': 'Partially Mapped',
  'Per Valhalla & OSM analysieren': 'Analyze via Valhalla & OSM',
  'Unbekannt / Keine Daten': 'Unknown / No Data',
  'Unbekannt zurücksetzen': 'Reset to Unknown',
  'Oberflächen analysieren (Valhalla & OSM)': 'Analyze Surfaces (Valhalla & OSM)',
  'Valhalla & OSM läuft...': 'Analyzing Valhalla & OSM...',
  'Duplikate entfernen': 'Remove Duplicate Tracks',

  // URL & Komoot Importer
  'Dropzone oder URL': 'Dropzone or URL',
  'URL / Komoot importieren': 'Import URL / Komoot',
  'Route laden': 'Load Route',
  'Importiere...': 'Importing...',
  'Auf Karte öffnen': 'Open on Map',
  'Als Geplante Tour speichern': 'Save as Planned Tour',
  'Route geladen': 'Route Loaded',
  'Komoot-Tour-Link oder GPX-URL importieren': 'Import Komoot tour link or GPX URL',
  'Komoot-Tour, Collection oder GPX-URL importieren': 'Import Komoot tour, collection, or GPX URL',
  'Komoot Tour / Collection oder GPX-URL': 'Komoot Tour / Collection or GPX URL',
  'Komoot-Touren, Collections & .gpx-Links': 'Komoot Tours, Collections & .gpx Links',
  'Collection aktualisieren': 'Refresh Collection',
  'Als Tourengruppe organisieren:': 'Organize as Tour Group:',
  'Gruppenname...': 'Group name...',
  'Touren in dieser Collection filtern...': 'Filter tours in this collection...',
  'Alle auswählen': 'Select All',
  'Keine auswählen': 'Select None',
  'Importiere ausgewählte Komoot-Touren...': 'Importing selected Komoot tours...',
  'Lädt...': 'Loading...',
  'Bereit': 'Ready',

  // Map Zoom Controls
  'Karten-Zoom-Steuerung': 'Map Zoom Controls',
  'Karte vergrößern': 'Zoom In',
  'Karte verkleinern': 'Zoom Out',
  'Fein': 'Fine',
  'Mittel': 'Medium'
};

const SORTED_PHRASE_ENTRIES = Object.entries(DE_TO_EN_EXACT).sort(
  (a, b) => b[0].length - a[0].length
);

type PatternReplacer = string | ((match: string, ...args: string[]) => string);

const DE_TO_EN_PATTERN_REPLACEMENTS: Array<[RegExp, PatternReplacer]> = [
  [/\bDatei (\d+) von (\d+)\b/g, 'File $1 of $2'],
  [/\bvor (\d+) Tagen\b/g, '$1 days ago'],
  [/\bvor (\d+) Tag\b/g, '$1 day ago'],
  [/\bLetzte (\d+) Tage\b/g, 'Last $1 days'],
  [/\bZiel: 8 Std\. 00 Min\./g, 'Goal: 8h 00m'],
  [/\bTagesziel: 10\.000\b/g, 'Daily Goal: 10,000'],
  [/\bhm Abstieg\b/g, 'm Descent'],
  [/\bhm Anstieg\b/g, 'm Ascent'],
  [/\b(\d+) Aktivität(en)?\b/g, (_m, n, pl) => `${n} Activit${pl ? 'ies' : 'y'}`],
  [/\b(\d+) Tour(en)?\b/g, (_m, n, pl) => `${n} Tour${pl ? 's' : ''}`],
  [/\b(\d+) Strecken\b/g, '$1 Tracks'],
  [/\b(\d+) Std\.\b/g, '$1 hrs'],
  [/\b(\d+) Min\.\b/g, '$1 min']
];

const INLINE_WORD_REPLACEMENTS: Array<[RegExp, string]> = SORTED_PHRASE_ENTRIES
  .filter(([de]) => /^[A-Za-zÄÖÜäöüß0-9 .\-/()]+$/.test(de) && de.length >= 4)
  .map(([de, en]) => {
    const escaped = de.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return [new RegExp(`(^|[\\s(·,/])${escaped}(?=$|[\\s),·/:!?])`, 'g'), `$1${en}`];
  });

/**
 * Translates UI strings from German to English when `targetLang === 'en'`.
 * Idempotent for already-English text and preserves leading/trailing whitespace.
 */
export function translateUiText(text: string, targetLang: AppLanguage): string {
  if (!text || targetLang !== 'en') return text;
  const leading = text.match(/^\s*/)?.[0] ?? '';
  const trailing = text.match(/\s*$/)?.[0] ?? '';
  const core = text.trim();
  if (!core) return text;

  const direct = DE_TO_EN_EXACT[core];
  if (direct) {
    return `${leading}${direct}${trailing}`;
  }

  let out = core;
  for (const [pattern, replacement] of DE_TO_EN_PATTERN_REPLACEMENTS) {
    out =
      typeof replacement === 'string'
        ? out.replace(pattern, replacement)
        : out.replace(pattern, replacement);
  }
  if (out !== core) {
    return `${leading}${out}${trailing}`;
  }

  // Only attempt token-level substitution when German characters or known multi-char cues exist
  if (/[äöüß]|Aktivität|Tour|Strecke|Höhe|Geschw|Schlaf|Pul|Belastung|Erholung|Zonen|Dauer|Distanz|Kalorien|Schritte/i.test(out)) {
    for (const [pattern, replacement] of INLINE_WORD_REPLACEMENTS) {
      out = out.replace(pattern, replacement);
    }
  }

  return `${leading}${out}${trailing}`;
}

const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'CODE', 'PRE', 'TEXTAREA', 'NOSCRIPT']);

/**
 * Synchronizes all rendered UI text nodes and tooltip/placeholder attributes with `lang`.
 * Preserves exact original German strings in WeakMaps so switching back to `'de'` restores 1:1.
 */
export function useDomLanguageSync(lang: AppLanguage): void {
  useEffect(() => {
    if (typeof document === 'undefined') return;
    const root = document.getElementById('app-workspace-root') || document.body;
    if (!root) return;

    const originalTextNodes = new WeakMap<Text, string>();
    const translatedTextNodes = new WeakMap<Text, string>();
    const trackedNodes = new Set<Text>();
    const trackedElements = new Set<Element>();
    const translatableAttrs = ['title', 'placeholder', 'aria-label'] as const;
    let isMutating = false;

    const isInsideSkippedContainer = (node: Node | null): boolean => {
      let cur: Node | null = node;
      while (cur) {
        if (cur.nodeType === 1) {
          const el = cur as Element;
          if (SKIP_TAGS.has(el.tagName) || el.getAttribute('data-no-translate') === 'true') {
            return true;
          }
        }
        cur = cur.parentNode;
      }
      return false;
    };

    const syncElementAttrs = (el: Element) => {
      if (SKIP_TAGS.has(el.tagName) || el.getAttribute('data-no-translate') === 'true') return;
      for (const attr of translatableAttrs) {
        const val = el.getAttribute(attr);
        if (val === null) continue;
        const origKey = `data-orig-${attr}`;
        const prevTranslatedKey = `data-en-${attr}`;
        const storedOrig = el.getAttribute(origKey);
        const prevEn = el.getAttribute(prevTranslatedKey);

        if (lang === 'en') {
          if (storedOrig === null || (prevEn !== null && val !== prevEn)) {
            el.setAttribute(origKey, val);
          }
          const sourceVal = el.getAttribute(origKey) ?? val;
          const nextEn = translateUiText(sourceVal, 'en');
          if (nextEn !== sourceVal && val !== nextEn) {
            isMutating = true;
            el.setAttribute(prevTranslatedKey, nextEn);
            el.setAttribute(attr, nextEn);
            trackedElements.add(el);
            isMutating = false;
          }
        } else if (storedOrig !== null) {
          if (prevEn !== null && val === prevEn && val !== storedOrig) {
            isMutating = true;
            el.setAttribute(attr, storedOrig);
            isMutating = false;
          }
          el.removeAttribute(prevTranslatedKey);
        }
      }
    };

    const syncTextNode = (textNode: Text) => {
      if (isInsideSkippedContainer(textNode.parentNode)) return;
      const curVal = textNode.nodeValue ?? '';
      if (!curVal.trim()) return;

      const prevEn = translatedTextNodes.get(textNode);
      if (lang === 'en') {
        if (!originalTextNodes.has(textNode) || (prevEn !== undefined && curVal !== prevEn)) {
          originalTextNodes.set(textNode, curVal);
        }
        const source = originalTextNodes.get(textNode) ?? curVal;
        const nextEn = translateUiText(source, 'en');
        if (nextEn !== source && curVal !== nextEn) {
          isMutating = true;
          textNode.nodeValue = nextEn;
          translatedTextNodes.set(textNode, nextEn);
          trackedNodes.add(textNode);
          isMutating = false;
        }
      } else {
        const orig = originalTextNodes.get(textNode);
        if (orig !== undefined && prevEn !== undefined && curVal === prevEn && curVal !== orig) {
          isMutating = true;
          textNode.nodeValue = orig;
          isMutating = false;
        }
        translatedTextNodes.delete(textNode);
      }
    };

    const walkSubtree = (target: Node) => {
      if (target.nodeType === 3) {
        syncTextNode(target as Text);
        return;
      }
      if (target.nodeType !== 1) return;
      const el = target as Element;
      if (SKIP_TAGS.has(el.tagName) || el.getAttribute('data-no-translate') === 'true') return;
      syncElementAttrs(el);
      const walker = document.createTreeWalker(el, 5 /* SHOW_ELEMENT | SHOW_TEXT */);
      let cur: Node | null = walker.nextNode();
      while (cur) {
        if (cur.nodeType === 1) {
          syncElementAttrs(cur as Element);
        } else if (cur.nodeType === 3) {
          syncTextNode(cur as Text);
        }
        cur = walker.nextNode();
      }
    };

    walkSubtree(root);

    const observer = new MutationObserver((mutations) => {
      if (isMutating) return;
      for (const m of mutations) {
        if (m.type === 'characterData' && m.target.nodeType === 3) {
          syncTextNode(m.target as Text);
        } else if (m.type === 'attributes' && m.target.nodeType === 1) {
          syncElementAttrs(m.target as Element);
        } else if (m.type === 'childList') {
          m.addedNodes.forEach((n) => walkSubtree(n));
        }
      }
    });

    observer.observe(root, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
      attributeFilter: ['title', 'placeholder', 'aria-label']
    });

    return () => {
      observer.disconnect();
      if (lang === 'en') {
        isMutating = true;
        trackedNodes.forEach((node) => {
          const orig = originalTextNodes.get(node);
          const enVal = translatedTextNodes.get(node);
          if (orig !== undefined && enVal !== undefined && node.nodeValue === enVal) {
            node.nodeValue = orig;
          }
        });
        trackedElements.forEach((el) => {
          for (const attr of translatableAttrs) {
            const origVal = el.getAttribute(`data-orig-${attr}`);
            const enVal = el.getAttribute(`data-en-${attr}`);
            if (origVal !== null && enVal !== null && el.getAttribute(attr) === enVal) {
              el.setAttribute(attr, origVal);
            }
            el.removeAttribute(`data-en-${attr}`);
          }
        });
        isMutating = false;
      }
    };
  }, [lang]);
}
