/**
 * Pure offline Country resolver for cycling, running, and hiking activities.
 * Combines compact point-in-polygon European/world region detection from GPS coordinates
 * with fast location/name/tag keyword fallback for GPS-less or virtual tracks.
 */

export interface CountryResolveInput {
  explicitCountry?: string | null;
  points?: any[] | null;
  pointsJson?: string | null;
  location?: string | null;
  name?: string | null;
  tags?: string | null;
  isVirtual?: boolean;
}

interface CountryPolygonDef {
  country: string;
  minLat: number;
  maxLat: number;
  minLng: number;
  maxLng: number;
  /** [lat, lng] vertices */
  polygon: Array<[number, number]>;
}

// Ordered carefully from smaller / nestled Alpine & Benelux countries to larger neighbors
// so border regions (e.g. Switzerland, Austria, Luxembourg, Belgium, Netherlands) resolve accurately.
const COUNTRY_POLYGONS: CountryPolygonDef[] = [
  {
    country: 'Liechtenstein',
    minLat: 47.04,
    maxLat: 47.27,
    minLng: 9.47,
    maxLng: 9.64,
    polygon: [
      [47.05, 9.48],
      [47.27, 9.52],
      [47.26, 9.59],
      [47.07, 9.64]
    ]
  },
  {
    country: 'Luxemburg',
    minLat: 49.44,
    maxLat: 50.19,
    minLng: 5.73,
    maxLng: 6.53,
    polygon: [
      [49.45, 5.82],
      [50.18, 5.74],
      [50.18, 6.14],
      [49.82, 6.53],
      [49.45, 6.37]
    ]
  },
  {
    country: 'Schweiz',
    minLat: 45.81,
    maxLat: 47.81,
    minLng: 5.95,
    maxLng: 10.50,
    polygon: [
      [46.13, 5.96],
      [46.46, 6.08],
      [47.45, 7.05],
      [47.81, 8.58],
      [47.55, 9.60],
      [47.05, 9.50],
      [46.85, 10.49],
      [46.62, 10.47],
      [46.57, 10.35],
      [46.42, 10.15],
      [46.22, 10.12],
      [46.45, 9.40],
      [45.82, 9.02],
      [46.30, 8.40],
      [45.86, 7.12]
    ]
  },
  {
    country: 'Österreich',
    minLat: 46.37,
    maxLat: 49.02,
    minLng: 9.53,
    maxLng: 17.16,
    polygon: [
      [47.05, 9.53],
      [47.55, 9.65],
      [47.56, 10.55],
      [47.39, 11.40],
      [47.75, 12.90],
      [48.58, 13.78],
      [49.02, 15.02],
      [48.80, 16.95],
      [48.00, 17.16],
      [46.85, 16.10],
      [46.63, 14.95],
      [46.40, 13.72],
      [46.68, 12.40],
      [47.05, 12.15],
      [46.85, 10.49]
    ]
  },
  {
    country: 'Belgien',
    minLat: 49.49,
    maxLat: 51.51,
    minLng: 2.54,
    maxLng: 6.41,
    polygon: [
      [51.09, 2.54],
      [51.48, 4.45],
      [51.25, 5.75],
      [50.75, 6.08],
      [50.15, 6.41],
      [49.50, 5.82],
      [49.95, 4.82],
      [50.30, 3.65],
      [50.78, 2.75]
    ]
  },
  {
    country: 'Niederlande',
    minLat: 50.75,
    maxLat: 53.56,
    minLng: 3.35,
    maxLng: 7.23,
    polygon: [
      [51.35, 3.36],
      [53.55, 4.70],
      [53.55, 7.20],
      [52.20, 7.08],
      [51.85, 6.18],
      [50.76, 6.02],
      [50.76, 5.65],
      [51.46, 4.45]
    ]
  },
  {
    country: 'Slowenien',
    minLat: 45.42,
    maxLat: 46.88,
    minLng: 13.37,
    maxLng: 16.61,
    polygon: [
      [46.50, 13.38],
      [46.88, 16.10],
      [46.48, 16.61],
      [45.42, 15.15],
      [45.47, 13.55]
    ]
  },
  {
    country: 'Dänemark',
    minLat: 54.55,
    maxLat: 57.76,
    minLng: 8.07,
    maxLng: 15.20,
    polygon: [
      [54.82, 8.60],
      [57.15, 8.08],
      [57.75, 10.65],
      [56.05, 12.65],
      [55.00, 15.20],
      [54.55, 11.95],
      [54.80, 9.45]
    ]
  },
  {
    country: 'Tschechien',
    minLat: 48.55,
    maxLat: 51.06,
    minLng: 12.09,
    maxLng: 18.86,
    polygon: [
      [50.32, 12.10],
      [51.05, 14.35],
      [50.25, 17.65],
      [49.55, 18.86],
      [48.62, 16.95],
      [48.56, 14.35],
      [49.40, 12.75]
    ]
  },
  {
    country: 'Deutschland',
    minLat: 47.27,
    maxLat: 55.06,
    minLng: 5.86,
    maxLng: 15.05,
    polygon: [
      [55.06, 8.35],
      [54.82, 9.85],
      [54.45, 13.75],
      [53.75, 14.42],
      [52.60, 14.65],
      [51.15, 15.04],
      [50.32, 12.10],
      [48.58, 13.84],
      [47.72, 12.95],
      [47.38, 11.40],
      [47.27, 10.18],
      [47.55, 9.65],
      [47.57, 7.58],
      [48.98, 8.20],
      [49.45, 6.37],
      [50.18, 6.14],
      [50.76, 6.02],
      [51.85, 6.08],
      [53.55, 7.15]
    ]
  },
  {
    country: 'Italien',
    minLat: 36.60,
    maxLat: 47.10,
    minLng: 6.62,
    maxLng: 18.55,
    polygon: [
      [45.80, 6.63],
      [46.00, 7.80],
      [45.85, 9.02],
      [46.50, 9.42],
      [46.22, 10.12],
      [46.55, 10.48],
      [47.09, 12.18],
      [46.65, 12.45],
      [46.50, 13.72],
      [45.65, 13.85],
      [44.40, 12.40],
      [41.90, 16.15],
      [40.10, 18.55],
      [37.90, 16.10],
      [36.65, 15.10],
      [37.55, 12.35],
      [41.20, 8.15],
      [42.40, 11.10],
      [44.40, 8.95],
      [43.78, 7.52],
      [44.80, 6.72]
    ]
  },
  {
    country: 'Frankreich',
    minLat: 41.33,
    maxLat: 51.09,
    minLng: -5.15,
    maxLng: 9.56,
    polygon: [
      [51.09, 2.54],
      [50.30, 3.65],
      [49.95, 4.82],
      [49.45, 6.37],
      [48.98, 8.23],
      [47.57, 7.58],
      [46.46, 6.08],
      [45.85, 6.85],
      [44.80, 6.72],
      [43.78, 7.52],
      [42.95, 9.56],
      [41.35, 9.25],
      [42.42, 3.16],
      [42.65, 0.25],
      [43.38, -1.79],
      [46.15, -1.35],
      [48.45, -5.14],
      [50.10, 1.50]
    ]
  },
  {
    country: 'Spanien',
    minLat: 27.60,
    maxLat: 43.80,
    minLng: -18.20,
    maxLng: 4.35,
    polygon: [
      [43.38, -1.79],
      [42.65, 0.25],
      [42.42, 3.18],
      [41.35, 2.25],
      [39.85, 4.35],
      [38.70, 1.50],
      [36.70, -2.10],
      [36.00, -5.62],
      [37.20, -7.42],
      [38.95, -7.05],
      [41.95, -8.90],
      [43.75, -7.85],
      [43.45, -4.00]
    ]
  },
  {
    country: 'Portugal',
    minLat: 36.95,
    maxLat: 42.16,
    minLng: -9.55,
    maxLng: -6.18,
    polygon: [
      [42.15, -8.20],
      [41.88, -6.55],
      [40.25, -6.85],
      [38.95, -7.05],
      [37.20, -7.42],
      [37.00, -8.98],
      [38.75, -9.52],
      [41.90, -8.90]
    ]
  },
  {
    country: 'Großbritannien',
    minLat: 49.90,
    maxLat: 60.86,
    minLng: -8.65,
    maxLng: 1.78,
    polygon: [
      [49.95, -5.75],
      [54.50, -5.60],
      [58.65, -5.05],
      [58.65, -2.95],
      [55.80, -2.00],
      [52.75, 1.77],
      [51.12, 1.42],
      [50.10, -5.15]
    ]
  },
  {
    country: 'Irland',
    minLat: 51.40,
    maxLat: 55.45,
    minLng: -10.60,
    maxLng: -5.98,
    polygon: [
      [51.45, -9.80],
      [54.25, -10.20],
      [55.40, -7.25],
      [53.30, -5.98],
      [52.15, -6.30]
    ]
  },
  {
    country: 'Polen',
    minLat: 49.00,
    maxLat: 54.84,
    minLng: 14.12,
    maxLng: 24.15,
    polygon: [
      [53.95, 14.22],
      [54.83, 18.40],
      [54.35, 22.80],
      [52.00, 23.65],
      [49.02, 22.85],
      [49.55, 18.86],
      [50.25, 17.65],
      [51.05, 14.80]
    ]
  },
  {
    country: 'Norwegen',
    minLat: 57.95,
    maxLat: 71.20,
    minLng: 4.50,
    maxLng: 31.15,
    polygon: [
      [58.00, 6.80],
      [62.50, 4.95],
      [68.40, 14.00],
      [71.15, 25.80],
      [70.10, 31.10],
      [68.80, 21.00],
      [64.00, 14.00],
      [60.00, 12.40],
      [59.00, 11.45]
    ]
  },
  {
    country: 'Schweden',
    minLat: 55.33,
    maxLat: 69.06,
    minLng: 10.95,
    maxLng: 24.18,
    polygon: [
      [55.35, 12.80],
      [59.00, 11.20],
      [64.00, 13.80],
      [68.85, 20.60],
      [65.80, 24.15],
      [60.50, 18.40],
      [56.00, 16.50]
    ]
  },
  {
    country: 'Kroatien',
    minLat: 42.38,
    maxLat: 46.55,
    minLng: 13.48,
    maxLng: 19.45,
    polygon: [
      [45.45, 13.50],
      [46.52, 16.45],
      [45.85, 19.45],
      [45.00, 19.15],
      [44.60, 15.80],
      [42.42, 18.50],
      [43.45, 16.20]
    ]
  }
];

function pointInPolygon(lat: number, lng: number, polygon: Array<[number, number]>): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i][0];
    const yi = polygon[i][1];
    const xj = polygon[j][0];
    const yj = polygon[j][1];

    const intersect =
      yi > lng !== yj > lng &&
      lat < ((xj - xi) * (lng - yi)) / (yj - yi + 1e-12) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

function normalizeCoordValue(val: number): number {
  if (!Number.isFinite(val)) return NaN;
  const abs = Math.abs(val);
  if (abs <= 180) return val;
  if (abs > 1e8) return (val * 180) / 2147483648;
  if (abs > 1e6) return val / 10000000;
  return val;
}

function extractFirstValidGpsPoint(points?: any[] | null, pointsJson?: string | null): { lat: number; lng: number } | null {
  let arr = Array.isArray(points) ? points : null;
  if ((!arr || arr.length === 0) && typeof pointsJson === 'string' && pointsJson.length > 10) {
    try {
      const parsed = JSON.parse(pointsJson);
      if (Array.isArray(parsed)) {
        arr = parsed;
      } else if (parsed && typeof parsed === 'object') {
        const key = Object.keys(parsed).find((k) => Array.isArray(parsed[k]));
        if (key) arr = parsed[key];
      }
    } catch {
      return null;
    }
  }

  if (!arr || arr.length < 2) return null;

  const limit = Math.min(arr.length, 25);
  for (let i = 0; i < limit; i++) {
    const p = arr[i];
    if (!p) continue;
    let rawLat: number | undefined;
    let rawLng: number | undefined;

    if (Array.isArray(p) && p.length >= 2) {
      const a = Number(p[0]);
      const b = Number(p[1]);
      if (Number.isFinite(a) && Number.isFinite(b)) {
        rawLat = a;
        rawLng = b;
      }
    } else if (typeof p === 'object') {
      const latCandidate = p.lat ?? p.latitude ?? p.position_lat ?? p.position_latitude ?? p.y;
      const lngCandidate = p.lng ?? p.lon ?? p.longitude ?? p.position_long ?? p.position_lon ?? p.position_longitude ?? p.x;
      if (latCandidate !== undefined && lngCandidate !== undefined) {
        rawLat = Number(latCandidate);
        rawLng = Number(lngCandidate);
      }
    }

    if (rawLat === undefined || rawLng === undefined) continue;
    const lat = normalizeCoordValue(rawLat);
    const lng = normalizeCoordValue(rawLng);

    if (
      Number.isFinite(lat) &&
      Number.isFinite(lng) &&
      Math.abs(lat) <= 90 &&
      Math.abs(lng) <= 180 &&
      !(Math.abs(lat) < 0.0001 && Math.abs(lng) < 0.0001)
    ) {
      return { lat, lng };
    }
  }

  return null;
}

export function lookupCountryByCoordinates(lat: number, lng: number): string {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return '';

  // Canary Islands (Spain)
  if (lat >= 27.6 && lat <= 29.5 && lng >= -18.2 && lng <= -13.3) {
    return 'Spanien';
  }
  // Balearic Islands (Mallorca, Ibiza, Menorca -> Spain)
  if (lat >= 38.6 && lat <= 40.2 && lng >= 1.1 && lng <= 4.4) {
    return 'Spanien';
  }
  // Corsica (France)
  if (lat >= 41.3 && lat <= 43.1 && lng >= 8.5 && lng <= 9.6) {
    return 'Frankreich';
  }
  // Sardinia / Sicily (Italy)
  if ((lat >= 38.8 && lat <= 41.3 && lng >= 8.1 && lng <= 9.9) || (lat >= 36.6 && lat <= 38.4 && lng >= 12.3 && lng <= 15.7)) {
    return 'Italien';
  }

  for (const def of COUNTRY_POLYGONS) {
    if (lat < def.minLat || lat > def.maxLat || lng < def.minLng || lng > def.maxLng) {
      continue;
    }
    if (pointInPolygon(lat, lng, def.polygon)) {
      return def.country;
    }
  }

  // Broad fallback boxes for outer regions
  if (lat >= 34.8 && lat <= 41.8 && lng >= 19.3 && lng <= 28.5) return 'Griechenland';
  if (lat >= 47.7 && lat <= 49.6 && lng >= 16.8 && lng <= 22.6) return 'Slowakei';
  if (lat >= 45.7 && lat <= 48.6 && lng >= 16.1 && lng <= 22.9) return 'Ungarn';
  if (lat >= 59.7 && lat <= 70.1 && lng >= 20.5 && lng <= 31.6) return 'Finnland';
  if (lat >= 24.5 && lat <= 49.4 && lng >= -125.0 && lng <= -66.9) return 'USA';
  if (lat >= 41.7 && lat <= 72.0 && lng >= -141.0 && lng <= -52.6) return 'Kanada';
  if (lat >= 30.0 && lat <= 45.6 && lng >= 129.0 && lng <= 146.0) return 'Japan';
  if (lat >= -43.8 && lat <= -10.5 && lng >= 113.0 && lng <= 154.0) return 'Australien';
  if (lat >= -47.5 && lat <= -34.0 && lng >= 166.0 && lng <= 179.0) return 'Neuseeland';

  return '';
}

const KEYWORD_COUNTRY_RULES: Array<{ country: string; patterns: RegExp }> = [
  {
    country: 'Deutschland',
    patterns: /\b(deutschland|germany|dortmund|münchen|munich|berlin|hamburg|köln|cologne|frankfurt|stuttgart|düsseldorf|bochum|essen|duisburg|münster|ruhrgebiet|pott|pottrunde|isar|schwarzwald|eifel|allgäu|harz|eibsee|feldberg|zugspitze|teutoburg|sauerland|bremen|leipzig|dresden|nürnberg|freiburg|heidelberg|bodensee)\b/i
  },
  {
    country: 'Österreich',
    patterns: /\b(österreich|austria|tirol|tyrol|innsbruck|salzburg|wien|vienna|graz|linz|bregenz|vorarlberg|kärnten|steiermark|zillertal|ötztal|sölden|kitzbühel|grossglockner|großglockner|arlsberg|arlberg)\b/i
  },
  {
    country: 'Schweiz',
    patterns: /\b(schweiz|switzerland|suisse|svizzera|zürich|zurich|genf|geneva|basel|bern|luzern|lugano|engadin|st\.?\s*moritz|davos|zermatt|andermatt|gotthard|sustenpass|furkapass|grimsel|graubünden|wallis)\b/i
  },
  {
    country: 'Italien',
    patterns: /\b(italien|italy|italia|stelvio|stilfser|südtirol|dolomiten|dolomites|bormio|cortina|gavia|mortirolo|zoncolan|gardasee|garda|como|mailand|milan|rom|rome|florenz|toskana|tuscany|bozen|bolzano|meran)\b/i
  },
  {
    country: 'Frankreich',
    patterns: /\b(frankreich|france|alpe\s*d'?huez|tourmalet|galibier|ventoux|mont\s*ventoux|izoard|madeleine|chamonix|annecy|grenoble|nizza|nice|paris|lyon|pyrenäen|pyrenees|vogesen|vosges|elsass|alsace)\b/i
  },
  {
    country: 'Spanien',
    patterns: /\b(spanien|spain|españa|mallorca|sa\s*calobra|soller|sóller|girona|teneriffa|tenerife|gran\s*canaria|lanzarote|madrid|barcelona|valencia|andalusien|sierra\s*nevada|kanaren)\b/i
  },
  {
    country: 'Niederlande',
    patterns: /\b(niederlande|netherlands|holland|amsterdam|rotterdam|utrecht|den\s*haag|eindhoven|maastricht|limburg|venlo)\b/i
  },
  {
    country: 'Belgien',
    patterns: /\b(belgien|belgium|belgique|brüssel|brussels|antwerpen|gent|ghent|brügge|flanders|flandern|ardennen|ardennes|oudenaarde|luik|liège)\b/i
  },
  {
    country: 'Luxemburg',
    patterns: /\b(luxemburg|luxembourg|esch|vianden|müllerthal)\b/i
  },
  {
    country: 'Großbritannien',
    patterns: /\b(großbritannien|united\s*kingdom|england|schottland|scotland|wales|london|manchester|edinburgh|yorkshire)\b/i
  },
  {
    country: 'USA',
    patterns: /\b(usa|united\s*states|new\s*york|california|kalifornien|colorado|utah|san\s*francisco|los\s*angeles|boulder)\b/i
  }
];

export function normalizeCountryLabel(raw?: string | null): string {
  if (!raw || typeof raw !== 'string') return '';
  const trimmed = raw.trim();
  if (!trimmed) return '';
  const lower = trimmed.toLowerCase();
  if (lower === 'germany' || lower === 'de') return 'Deutschland';
  if (lower === 'austria' || lower === 'at') return 'Österreich';
  if (lower === 'switzerland' || lower === 'ch' || lower === 'suisse') return 'Schweiz';
  if (lower === 'italy' || lower === 'it' || lower === 'italia') return 'Italien';
  if (lower === 'france' || lower === 'fr') return 'Frankreich';
  if (lower === 'spain' || lower === 'es' || lower === 'españa') return 'Spanien';
  if (lower === 'netherlands' || lower === 'nl' || lower === 'holland') return 'Niederlande';
  if (lower === 'belgium' || lower === 'be') return 'Belgien';
  if (lower === 'luxembourg' || lower === 'lu') return 'Luxemburg';
  if (lower === 'united kingdom' || lower === 'uk' || lower === 'gb' || lower === 'great britain') return 'Großbritannien';
  if (lower === 'united states' || lower === 'us') return 'USA';
  return trimmed.slice(0, 80);
}

export function resolveActivityCountry(input: CountryResolveInput): string {
  const explicit = normalizeCountryLabel(input.explicitCountry);
  if (explicit) return explicit;

  if (!input.isVirtual) {
    const pt = extractFirstValidGpsPoint(input.points, input.pointsJson);
    if (pt) {
      const geoCountry = lookupCountryByCoordinates(pt.lat, pt.lng);
      if (geoCountry) return geoCountry;
    }
  }

  const combinedText = [input.location, input.name, input.tags]
    .filter((v): v is string => typeof v === 'string' && v.trim().length > 0)
    .join(' ');

  if (combinedText) {
    for (const rule of KEYWORD_COUNTRY_RULES) {
      if (rule.patterns.test(combinedText)) {
        return rule.country;
      }
    }
  }

  return '';
}
