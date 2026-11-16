export type SurfaceCategory =
  | 'Asphalt'
  | 'Fahrradweg'
  | 'Schotter'
  | 'Waldweg'
  | 'Kopfsteinpflaster'
  | 'Unbefestigt'
  | 'Unbekannt';

export type SurfaceAnalysisSource =
  | 'embedded'
  | 'valhalla+osm'
  | 'valhalla'
  | 'overpass'
  | 'unavailable';

export interface SurfaceInputPoint {
  lat: number;
  lng: number;
  ele?: number;
  surface?: string;
}

export interface SurfaceAnalysisResult {
  surfaces: SurfaceCategory[];
  surfaceStats: { type: string; distance: number }[];
  source: SurfaceAnalysisSource;
  coveragePct: number;
  isFallback: boolean;
  notice?: string;
}

const VALID_SURFACE_CATEGORIES = new Set<string>([
  'Asphalt',
  'Fahrradweg',
  'Schotter',
  'Waldweg',
  'Kopfsteinpflaster',
  'Unbefestigt',
  'Unbekannt',
]);

export function normalizeSurfaceLabel(raw?: string | null): SurfaceCategory {
  if (!raw) return 'Unbekannt';
  const trimmed = String(raw).trim();
  if (VALID_SURFACE_CATEGORIES.has(trimmed)) {
    return trimmed as SurfaceCategory;
  }
  const lower = trimmed.toLowerCase();
  if (lower.includes('asphalt') || lower.includes('paved') || lower.includes('beton') || lower.includes('tarmac') || lower.includes('straße')) {
    return 'Asphalt';
  }
  if (lower.includes('fahrrad') || lower.includes('radweg') || lower.includes('cycleway')) {
    return 'Fahrradweg';
  }
  if (lower.includes('schotter') || lower.includes('gravel') || lower.includes('kies') || lower.includes('compacted')) {
    return 'Schotter';
  }
  if (lower.includes('kopfstein') || lower.includes('pflaster') || lower.includes('cobble') || lower.includes('sett')) {
    return 'Kopfsteinpflaster';
  }
  if (lower.includes('wald') || lower.includes('trail') || lower.includes('dirt') || lower.includes('earth') || lower.includes('ground')) {
    return 'Waldweg';
  }
  if (lower.includes('unbefestigt') || lower.includes('unpaved') || lower.includes('sand') || lower.includes('matsch')) {
    return 'Unbefestigt';
  }
  return 'Unbekannt';
}

export function haversineMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000;
  const phi1 = (lat1 * Math.PI) / 180;
  const phi2 = (lat2 * Math.PI) / 180;
  const dPhi = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dPhi / 2) * Math.sin(dPhi / 2) +
    Math.cos(phi1) * Math.cos(phi2) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function pointToSegmentDistanceMeters(
  pLat: number,
  pLng: number,
  aLat: number,
  aLng: number,
  bLat: number,
  bLng: number
): number {
  const R = 6371000;
  const meanLat = ((pLat + aLat + bLat) / 3) * (Math.PI / 180);
  const cosLat = Math.cos(meanLat);

  const px = pLng * (Math.PI / 180) * R * cosLat;
  const py = pLat * (Math.PI / 180) * R;
  const ax = aLng * (Math.PI / 180) * R * cosLat;
  const ay = aLat * (Math.PI / 180) * R;
  const bx = bLng * (Math.PI / 180) * R * cosLat;
  const by = bLat * (Math.PI / 180) * R;

  const dx = bx - ax;
  const dy = by - ay;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) {
    const dX = px - ax;
    const dY = py - ay;
    return Math.sqrt(dX * dX + dY * dY);
  }
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lenSq));
  const projX = ax + t * dx;
  const projY = ay + t * dy;
  const distX = px - projX;
  const distY = py - projY;
  return Math.sqrt(distX * distX + distY * distY);
}

/**
 * Maps OSM tags honestly. Returns null when OSM lacks determinable surface metadata
 * so callers never falsely invent Asphalt or Schotter.
 */
export function mapOsmTagsToSurface(tags: Record<string, string> | undefined): SurfaceCategory | null {
  if (!tags) return null;
  const surface = (tags.surface || '').toLowerCase().trim();
  const highway = (tags.highway || '').toLowerCase().trim();
  const tracktype = (tags.tracktype || '').toLowerCase().trim();
  const sacScale = (tags.sac_scale || '').toLowerCase().trim();
  const smoothness = (tags.smoothness || '').toLowerCase().trim();

  if (
    [
      'asphalt',
      'paved',
      'concrete',
      'concrete:plates',
      'concrete:lanes',
      'tarmac',
      'chipseal',
    ].includes(surface)
  ) {
    return highway === 'cycleway' ? 'Fahrradweg' : 'Asphalt';
  }
  if (
    [
      'compacted',
      'fine_gravel',
      'gravel',
      'pebblestones',
      'crushed_stone',
      'grit',
    ].includes(surface)
  ) {
    return 'Schotter';
  }
  if (
    [
      'cobblestone',
      'cobblestone:flattened',
      'paving_stones',
      'sett',
      'unhewn_cobblestone',
    ].includes(surface)
  ) {
    return 'Kopfsteinpflaster';
  }
  if (
    ['dirt', 'earth', 'ground', 'grass', 'mud', 'wood', 'woodchips'].includes(surface)
  ) {
    return 'Waldweg';
  }
  if (['unpaved', 'sand', 'rock', 'scree'].includes(surface)) {
    return 'Unbefestigt';
  }

  // Fallback to explicit OSM tracktype grades
  if (tracktype === 'grade1') return 'Asphalt';
  if (tracktype === 'grade2' || tracktype === 'grade3') return 'Schotter';
  if (tracktype === 'grade4' || tracktype === 'grade5') return 'Waldweg';

  // Alpine hiking classification
  if (sacScale) return 'Waldweg';

  // Explicit cycleway without gravel/dirt tag
  if (highway === 'cycleway') return 'Fahrradweg';

  // Major classified arterial roads are reliably paved unless tagged otherwise above
  if (['motorway', 'trunk', 'primary', 'secondary', 'tertiary'].includes(highway)) {
    return 'Asphalt';
  }

  // Natural/trail ways
  if (['path', 'footway', 'bridleway', 'steps', 'via_ferrata'].includes(highway)) {
    if (['excellent', 'good'].includes(smoothness)) return 'Asphalt';
    return 'Waldweg';
  }

  // For tagless 'track', 'unclassified', 'residential', 'service', 'road' return null -> 'Unbekannt'
  return null;
}

function mapValhallaEdgeToSurface(edge: any): {
  surface: SurfaceCategory | null;
  needsOverpassEnrichment: boolean;
} {
  if (!edge || typeof edge !== 'object') {
    return { surface: null, needsOverpassEnrichment: true };
  }
  const edgeSurface = String(edge.surface || '').toLowerCase().trim();
  const roadClass = String(edge.road_class || '').toLowerCase().trim();
  const use = String(edge.use || '').toLowerCase().trim();
  const sacScale = String(edge.sac_scale || '').toLowerCase().trim();

  if (sacScale && sacScale !== 'none') {
    return { surface: 'Waldweg', needsOverpassEnrichment: false };
  }

  const isCycleway = roadClass === 'cycleway' || use === 'cycleway';

  switch (edgeSurface) {
    case 'paved_smooth':
    case 'paved':
      return {
        surface: isCycleway ? 'Fahrradweg' : 'Asphalt',
        needsOverpassEnrichment: false,
      };
    case 'paved_rough':
      // Could be cobblestone, concrete plates, or patched asphalt -> enrich via Overpass
      return {
        surface: isCycleway ? 'Fahrradweg' : 'Asphalt',
        needsOverpassEnrichment: true,
      };
    case 'compacted':
    case 'gravel':
      return { surface: 'Schotter', needsOverpassEnrichment: false };
    case 'dirt':
    case 'mud':
      return { surface: 'Waldweg', needsOverpassEnrichment: false };
    case 'sand':
    case 'impassable':
      return { surface: 'Unbefestigt', needsOverpassEnrichment: false };
    default:
      if (isCycleway) {
        return { surface: 'Fahrradweg', needsOverpassEnrichment: true };
      }
      if (['motorway', 'trunk', 'primary', 'secondary', 'tertiary'].includes(roadClass)) {
        return { surface: 'Asphalt', needsOverpassEnrichment: true };
      }
      return { surface: null, needsOverpassEnrichment: true };
  }
}

interface SampleNode {
  origIdx: number;
  lat: number;
  lng: number;
  cumDistM: number;
}

function buildSpacedSamples(points: SurfaceInputPoint[]): {
  samples: SampleNode[];
  pointCumDistM: number[];
  totalDistM: number;
} {
  const n = points.length;
  const pointCumDistM: number[] = new Array(n).fill(0);
  for (let i = 1; i < n; i++) {
    const d = haversineMeters(points[i - 1].lat, points[i - 1].lng, points[i].lat, points[i].lng);
    pointCumDistM[i] = pointCumDistM[i - 1] + (Number.isFinite(d) ? d : 0);
  }
  const totalDistM = pointCumDistM[n - 1] || 0;

  // Dynamic spacing: ~45m for standard routes, bounded at max ~1800 samples for ultra-long GPX
  const minSpacingM = Math.max(40, totalDistM / 1800);
  const samples: SampleNode[] = [];
  let lastPickedDist = -Infinity;

  for (let i = 0; i < n; i++) {
    const d = pointCumDistM[i];
    if (i === 0 || i === n - 1 || d - lastPickedDist >= minSpacingM) {
      samples.push({
        origIdx: i,
        lat: Number(points[i].lat),
        lng: Number(points[i].lng),
        cumDistM: d,
      });
      lastPickedDist = d;
    }
  }

  return { samples, pointCumDistM, totalDistM };
}

const VALHALLA_TRACE_URL = 'https://valhalla1.openstreetmap.de/trace_attributes';

const OVERPASS_SERVERS = [
  'https://overpass.private.coffee/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass-api.de/api/interpreter',
  'https://z.overpass-api.de/api/interpreter',
];

async function runValhallaStage(
  samples: SampleNode[],
  activityType?: string
): Promise<{
  surfaces: (SurfaceCategory | null)[];
  needsEnrichment: boolean[];
  matchedAny: boolean;
}> {
  const m = samples.length;
  const surfaces: (SurfaceCategory | null)[] = new Array(m).fill(null);
  const needsEnrichment: boolean[] = new Array(m).fill(true);

  if (m < 2) {
    return { surfaces, needsEnrichment, matchedAny: false };
  }

  const lowerType = (activityType || '').toLowerCase();
  const isFoot =
    lowerType.includes('run') ||
    lowerType.includes('walk') ||
    lowerType.includes('hik') ||
    lowerType.includes('wander');
  const costing = isFoot ? 'pedestrian' : 'bicycle';

  const CHUNK_SIZE = 320;
  const OVERLAP = 6;
  const chunks: { startIdx: number; endIdx: number }[] = [];
  let cursor = 0;
  while (cursor < m) {
    const endIdx = Math.min(m, cursor + CHUNK_SIZE);
    chunks.push({ startIdx: cursor, endIdx });
    if (endIdx >= m) break;
    cursor = endIdx - OVERLAP;
  }

  let matchedAny = false;

  // Execute chunks cleanly with concurrency <= 2 to stay polite to public Valhalla
  const processChunk = async (chunk: { startIdx: number; endIdx: number }) => {
    const slice = samples.slice(chunk.startIdx, chunk.endIdx);
    if (slice.length < 2) return;

    const bodyPayload: Record<string, any> = {
      costing,
      shape_match: 'map_snap',
      shape: slice.map((s) => ({ lat: Number(s.lat.toFixed(6)), lon: Number(s.lng.toFixed(6)) })),
      filters: {
        actions: ['include'],
        attributes: [
          'edge.surface',
          'edge.road_class',
          'edge.use',
          'edge.sac_scale',
          'edge.length',
          'matched.edge_index',
          'matched.type',
        ],
      },
    };
    if (costing === 'bicycle') {
      bodyPayload.costing_options = {
        bicycle: { bicycle_type: 'hybrid' },
      };
    }

    try {
      const resp = await fetch(VALHALLA_TRACE_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'GPXRouteMasterApplet/2.0',
        },
        body: JSON.stringify(bodyPayload),
        signal: AbortSignal.timeout(10000),
      });
      if (!resp.ok) {
        return;
      }
      const data = await resp.json();
      const edges = Array.isArray(data?.edges) ? data.edges : [];
      const matchedPoints = Array.isArray(data?.matched_points) ? data.matched_points : [];
      if (edges.length === 0 || matchedPoints.length === 0) return;

      for (let localIdx = 0; localIdx < Math.min(slice.length, matchedPoints.length); localIdx++) {
        const mp = matchedPoints[localIdx];
        const edgeIdx = typeof mp?.edge_index === 'number' ? mp.edge_index : -1;
        if (!mp || mp.type === 'unmatched' || edgeIdx < 0 || edgeIdx >= edges.length) {
          continue;
        }
        const mapped = mapValhallaEdgeToSurface(edges[edgeIdx]);
        const globalIdx = chunk.startIdx + localIdx;
        if (mapped.surface !== null) {
          surfaces[globalIdx] = mapped.surface;
          needsEnrichment[globalIdx] = mapped.needsOverpassEnrichment;
          matchedAny = true;
        }
      }
    } catch {
      // Timed out or Valhalla busy for this chunk -> Overpass stage handles it
    }
  };

  for (let i = 0; i < chunks.length; i += 2) {
    await Promise.all(chunks.slice(i, i + 2).map(processChunk));
  }

  return { surfaces, needsEnrichment, matchedAny };
}

async function queryOverpassCorridor(
  corridorCoords: { lat: number; lng: number }[]
): Promise<any[] | null> {
  if (corridorCoords.length === 0) return null;

  // Overpass QL around: filter on a sampled polyline within 25 meters
  const coordList = corridorCoords
    .map((c) => `${c.lat.toFixed(5)},${c.lng.toFixed(5)}`)
    .join(',');
  const overpassQuery = `[out:json][timeout:12];\nway["highway"](around:25,${coordList});\nout tags geom;`;

  for (const server of OVERPASS_SERVERS) {
    try {
      const response = await fetch(server, {
        method: 'POST',
        body: 'data=' + encodeURIComponent(overpassQuery),
        headers: {
          'User-Agent': 'GPXRouteMasterApplet/2.0',
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        signal: AbortSignal.timeout(9000),
      });
      if (!response.ok) continue;
      const json = await response.json();
      if (Array.isArray(json?.elements)) {
        return json.elements;
      }
    } catch {
      // Try next Overpass mirror
    }
  }
  return null;
}

async function runOverpassCorridorStage(
  samples: SampleNode[],
  surfaces: (SurfaceCategory | null)[],
  needsEnrichment: boolean[]
): Promise<boolean> {
  const m = samples.length;
  const targetIndices: number[] = [];
  for (let i = 0; i < m; i++) {
    if (surfaces[i] === null || needsEnrichment[i]) {
      targetIndices.push(i);
    }
  }
  if (targetIndices.length === 0) return false;

  // Group target indices into contiguous corridor spans (merge small gaps <= 4 samples)
  const spans: { startIdx: number; endIdx: number }[] = [];
  let spanStart = targetIndices[0];
  let spanPrev = targetIndices[0];
  for (let k = 1; k < targetIndices.length; k++) {
    const idx = targetIndices[k];
    if (idx - spanPrev <= 4 && idx - spanStart < 75) {
      spanPrev = idx;
    } else {
      spans.push({ startIdx: spanStart, endIdx: spanPrev });
      spanStart = idx;
      spanPrev = idx;
    }
  }
  spans.push({ startIdx: spanStart, endIdx: spanPrev });

  // Limit corridor queries to max 10 spans so very long unmapped tracks don't stall for minutes
  const cappedSpans = spans.slice(0, 10);
  let enrichedAny = false;

  for (const span of cappedSpans) {
    // Subsample polyline vertices inside the span (~1 vertex per ~80m, max 45 vertices)
    const spanLen = span.endIdx - span.startIdx + 1;
    const step = Math.max(1, Math.ceil(spanLen / 45));
    const corridorCoords: { lat: number; lng: number }[] = [];
    for (let i = span.startIdx; i <= span.endIdx; i += step) {
      corridorCoords.push({ lat: samples[i].lat, lng: samples[i].lng });
    }
    if (span.endIdx > span.startIdx) {
      corridorCoords.push({ lat: samples[span.endIdx].lat, lng: samples[span.endIdx].lng });
    }

    const elements = await queryOverpassCorridor(corridorCoords);
    if (!elements || elements.length === 0) continue;

    for (let i = span.startIdx; i <= span.endIdx; i++) {
      if (surfaces[i] !== null && !needsEnrichment[i]) continue;
      const pt = samples[i];
      let bestDist = 32; // meters snap threshold
      let bestSurface: SurfaceCategory | null = null;

      for (const elem of elements) {
        const geom = elem?.geometry;
        if (!Array.isArray(geom) || geom.length < 2) continue;
        for (let g = 0; g < geom.length - 1; g++) {
          const g1 = geom[g];
          const g2 = geom[g + 1];
          const d = pointToSegmentDistanceMeters(pt.lat, pt.lng, g1.lat, g1.lon, g2.lat, g2.lon);
          if (d < bestDist) {
            bestDist = d;
            bestSurface = mapOsmTagsToSurface(elem.tags);
          }
        }
      }

      if (bestSurface !== null) {
        surfaces[i] = bestSurface;
        enrichedAny = true;
      }
    }
  }

  return enrichedAny;
}

function finalizeSurfaceOutput(
  points: SurfaceInputPoint[],
  resolvedPerPoint: (SurfaceCategory | null)[],
  source: SurfaceAnalysisSource,
  customNotice?: string
): SurfaceAnalysisResult {
  const n = points.length;

  // Light 3-point isolated-spike smoother on resolved surfaces only (never erases Unbekannt blocks)
  const finalSurfaces: SurfaceCategory[] = resolvedPerPoint.map((s) => s ?? 'Unbekannt');
  for (let i = 1; i < n - 1; i++) {
    const prev = finalSurfaces[i - 1];
    const curr = finalSurfaces[i];
    const next = finalSurfaces[i + 1];
    if (prev === next && curr !== prev && prev !== 'Unbekannt') {
      finalSurfaces[i] = prev;
    }
  }

  const surfaceStatsMap: Record<string, number> = {};
  let totalDistKm = 0;
  let knownDistKm = 0;

  for (let i = 1; i < n; i++) {
    const p1 = points[i - 1];
    const p2 = points[i];
    const stepKm = haversineMeters(p1.lat, p1.lng, p2.lat, p2.lng) / 1000;
    if (!Number.isFinite(stepKm) || stepKm <= 0) continue;
    totalDistKm += stepKm;
    const sType = finalSurfaces[i] || 'Unbekannt';
    surfaceStatsMap[sType] = (surfaceStatsMap[sType] || 0) + stepKm;
    if (sType !== 'Unbekannt') {
      knownDistKm += stepKm;
    }
  }

  const surfaceStats = Object.entries(surfaceStatsMap)
    .map(([type, distance]) => ({ type, distance: Math.round(distance * 10) / 10 }))
    .filter((item) => item.distance > 0 || Object.keys(surfaceStatsMap).length === 1)
    .sort((a, b) => {
      if (a.type === 'Unbekannt' && b.type !== 'Unbekannt') return 1;
      if (b.type === 'Unbekannt' && a.type !== 'Unbekannt') return -1;
      return b.distance - a.distance;
    });

  const coveragePct =
    totalDistKm > 0.01 ? Math.max(0, Math.min(100, Math.round((knownDistKm / totalDistKm) * 100))) : 0;

  const effectiveSource: SurfaceAnalysisSource =
    coveragePct === 0 ? 'unavailable' : source;

  return {
    surfaces: finalSurfaces,
    surfaceStats,
    source: effectiveSource,
    coveragePct,
    isFallback: false,
    notice: customNotice,
  };
}

export async function analyzeRouteSurfacePipeline(
  rawPoints: SurfaceInputPoint[],
  options: { activityType?: string } = {}
): Promise<SurfaceAnalysisResult> {
  const points = rawPoints
    .map((p) => ({
      lat: Number(p.lat),
      lng: Number(p.lng),
      ele: p.ele !== undefined ? Number(p.ele) : undefined,
      surface: p.surface,
    }))
    .filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng));

  const n = points.length;
  if (n === 0) {
    throw new Error('Keine gültigen Koordinaten im Track vorhanden.');
  }

  // 1. Check embedded explicit GPX/XML surface metadata (>25% points tagged)
  const explicitEmbedded = points
    .map((p) => (p.surface ? normalizeSurfaceLabel(p.surface) : 'Unbekannt'))
    .filter((s) => s !== 'Unbekannt');
  if (explicitEmbedded.length > n * 0.25) {
    const resolved: (SurfaceCategory | null)[] = points.map((p) => {
      if (!p.surface) return null;
      const norm = normalizeSurfaceLabel(p.surface);
      return norm === 'Unbekannt' ? null : norm;
    });
    return finalizeSurfaceOutput(points, resolved, 'embedded');
  }

  // 2. Resample route trajectory along cumulative distance
  const { samples, pointCumDistM } = buildSpacedSamples(points);

  // 3. Stage A: Valhalla HMM Map Matching (trace_attributes)
  const valhallaRes = await runValhallaStage(samples, options.activityType);

  // 4. Stage B: Overpass Corridor (around:25) for unmatched/ambiguous samples
  const overpassEnriched = await runOverpassCorridorStage(
    samples,
    valhallaRes.surfaces,
    valhallaRes.needsEnrichment
  );

  // Determine honest provenance
  let source: SurfaceAnalysisSource = 'unavailable';
  if (valhallaRes.matchedAny && overpassEnriched) {
    source = 'valhalla+osm';
  } else if (valhallaRes.matchedAny) {
    source = 'valhalla';
  } else if (overpassEnriched) {
    source = 'overpass';
  }

  // 5. Align sample classifications back onto every point (honest Unbekannt where unmatched)
  const resolvedPerPoint: (SurfaceCategory | null)[] = new Array(n).fill(null);
  let samplePtr = 0;
  for (let i = 0; i < n; i++) {
    const ptDist = pointCumDistM[i];
    while (samplePtr < samples.length - 1) {
      const currDiff = Math.abs(samples[samplePtr].cumDistM - ptDist);
      const nextDiff = Math.abs(samples[samplePtr + 1].cumDistM - ptDist);
      if (nextDiff <= currDiff) {
        samplePtr++;
      } else {
        break;
      }
    }
    resolvedPerPoint[i] = valhallaRes.surfaces[samplePtr] ?? null;
  }

  const notice =
    source === 'unavailable'
      ? 'Keine OSM-/Valhalla-Oberflächendaten abrufbar — Abschnitte wurden ehrlich als Unbekannt markiert.'
      : undefined;

  return finalizeSurfaceOutput(points, resolvedPerPoint, source, notice);
}
