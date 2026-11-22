import { GPXTrack } from '../types';
import { exportToGPX } from '../utils/gpxUtils';
import {
  computeCanonicalTrackContentHash,
  attachKomootSourceToTrack,
  applyKomootRefreshToTrack,
  findMatchingExistingKomootTrack,
  getKomootSourceMeta,
  getVersionedGpxFilename
} from '../utils/komootVersioning';

function makeTrack(overrides: Partial<GPXTrack> = {}): GPXTrack {
  return {
    id: overrides.id || 'track-1',
    name: overrides.name || 'Alpen Etappe 1',
    points: overrides.points || [
      { lat: 47.491234, lng: 11.095678, ele: 710 },
      { lat: 47.501234, lng: 11.125678, ele: 920 },
      { lat: 47.515, lng: 11.15, ele: 1150 }
    ],
    color: overrides.color || '#10b981',
    distance: overrides.distance ?? 18.4,
    ascent: overrides.ascent ?? 440,
    descent: overrides.descent ?? 0,
    maxSlope: overrides.maxSlope ?? 12.5,
    visible: overrides.visible ?? true,
    activityType: overrides.activityType || 'cycling',
    tags: overrides.tags || ['Komoot', 'Geplante Tour'],
    tourGroup: overrides.tourGroup || 'Alpencross 2026',
    ...overrides
  };
}

export function runKomootVersioningTests(): boolean {
  console.log('🧪 Starting Komoot & GPX Versioning Unit Tests...\n');
  let passed = 0;
  let failed = 0;

  function assert(condition: boolean, testName: string) {
    if (condition) {
      console.log(`  ✅ [PASS] ${testName}`);
      passed++;
    } else {
      console.error(`  ❌ [FAIL] ${testName}`);
      failed++;
    }
  }

  // 1. Canonical content hash determinism & change sensitivity
  const t1 = makeTrack();
  const hash1a = computeCanonicalTrackContentHash(t1);
  const hash1b = computeCanonicalTrackContentHash(makeTrack());
  assert(hash1a.startsWith('kh_') && hash1a === hash1b, 'Canonical content hash is deterministic for identical tracks');

  const tChangedCoords = makeTrack({
    points: [
      { lat: 47.491234, lng: 11.095678, ele: 710 },
      { lat: 47.505, lng: 11.129, ele: 960 },
      { lat: 47.515, lng: 11.15, ele: 1150 }
    ]
  });
  const hashChanged = computeCanonicalTrackContentHash(tChangedCoords);
  assert(hashChanged !== hash1a, 'Canonical content hash changes when GPS coordinates change');

  const tChangedName = makeTrack({ name: 'Alpen Etappe 1 (Umfahrung)' });
  assert(
    computeCanonicalTrackContentHash(tChangedName) !== hash1a,
    'Canonical content hash changes when track name changes'
  );

  // 2. Attach initial Komoot source metadata (v1)
  const v1Track = attachKomootSourceToTrack(t1, {
    sourceType: 'komoot',
    sourceUrl: 'https://www.komoot.com/tour/70001?share_token=subTok1',
    komootTourId: '70001',
    komootShareToken: 'subTok1',
    komootCollectionId: '1489201',
    komootCollectionTitle: 'Alpencross 2026',
    komootCollectionUrl: 'https://www.komoot.com/collection/1489201',
    nowIso: '2026-06-01T10:00:00.000Z'
  });
  const metaV1 = getKomootSourceMeta(v1Track);
  assert(
    metaV1 !== null &&
      metaV1.version === 1 &&
      metaV1.komootTourId === '70001' &&
      metaV1.komootCollectionId === '1489201' &&
      metaV1.versionHistory.length === 1 &&
      v1Track.rawFileDetails?.metadata?.version === 'v1',
    'attachKomootSourceToTrack initializes v1 metadata, collection info, and history'
  );

  // 3. Refresh when Komoot track is unchanged -> version stays v1, lastCheckedAt updates
  const unchangedRes = applyKomootRefreshToTrack(v1Track, makeTrack({ id: 'incoming-temp' }), {
    sourceType: 'komoot',
    sourceUrl: 'https://www.komoot.com/tour/70001?share_token=subTok1',
    komootTourId: '70001',
    nowIso: '2026-06-02T12:00:00.000Z'
  });
  const metaUnchanged = getKomootSourceMeta(unchangedRes.track);
  assert(
    unchangedRes.updated === false &&
      unchangedRes.previousVersion === 1 &&
      unchangedRes.newVersion === 1 &&
      unchangedRes.track.id === 'track-1' &&
      metaUnchanged?.lastCheckedAt === '2026-06-02T12:00:00.000Z' &&
      metaUnchanged?.versionHistory.length === 1,
    'applyKomootRefreshToTrack keeps v1 and updates lastCheckedAt when content is unchanged'
  );

  // 4. Refresh when Komoot track was updated -> version increments v1 -> v2, history recorded, id/color/group preserved
  const updatedIncoming = makeTrack({
    id: 'incoming-new-id',
    color: '#ff0000',
    tourGroup: undefined,
    points: [
      { lat: 47.491234, lng: 11.095678, ele: 710 },
      { lat: 47.508888, lng: 11.132222, ele: 980 },
      { lat: 47.52, lng: 11.16, ele: 1210 }
    ],
    distance: 21.3,
    ascent: 500
  });
  const v2Res = applyKomootRefreshToTrack(v1Track, updatedIncoming, {
    sourceType: 'komoot',
    sourceUrl: 'https://www.komoot.com/tour/70001?share_token=subTok1',
    komootTourId: '70001',
    remoteUpdatedAt: '2026-06-03T09:15:00.000Z',
    nowIso: '2026-06-03T10:00:00.000Z'
  });
  const metaV2 = getKomootSourceMeta(v2Res.track);
  assert(
    v2Res.updated === true &&
      v2Res.previousVersion === 1 &&
      v2Res.newVersion === 2 &&
      v2Res.track.id === 'track-1' &&
      v2Res.track.color === '#10b981' &&
      v2Res.track.tourGroup === 'Alpencross 2026' &&
      v2Res.track.distance === 21.3 &&
      metaV2?.version === 2 &&
      metaV2?.versionHistory.length === 2 &&
      metaV2?.versionHistory[1].version === 2 &&
      metaV2?.remoteUpdatedAt === '2026-06-03T09:15:00.000Z' &&
      v2Res.track.rawFileDetails?.metadata?.version === 'v2',
    'applyKomootRefreshToTrack increments v1 -> v2, appends history, and preserves id/color/tourGroup'
  );

  // 5. Find matching existing Komoot track across tourId / URL
  const foundByTourId = findMatchingExistingKomootTrack([v2Res.track], { komootTourId: '70001' });
  const foundByUrl = findMatchingExistingKomootTrack([v2Res.track], {
    sourceUrl: 'https://www.komoot.com/tour/70001?share_token=subTok1'
  });
  const notFound = findMatchingExistingKomootTrack([v2Res.track], { komootTourId: '99999' });
  assert(
    foundByTourId?.id === 'track-1' && foundByUrl?.id === 'track-1' && notFound === null,
    'findMatchingExistingKomootTrack matches by komootTourId and sourceUrl'
  );

  // 6. Versioned filename and GPX XML extension metadata
  const v2Filename = getVersionedGpxFilename(v2Res.track);
  assert(
    v2Filename === 'Alpen_Etappe_1_v2.gpx',
    `getVersionedGpxFilename produces versioned filename (got "${v2Filename}")`
  );

  const nonVersionedFilename = getVersionedGpxFilename(makeTrack({ rawFileDetails: undefined }));
  assert(
    nonVersionedFilename === 'Alpen_Etappe_1.gpx',
    'getVersionedGpxFilename omits version suffix for regular local tracks'
  );

  const exportedXml = exportToGPX(v2Res.track);
  assert(
    exportedXml.includes('<gpxx:SourceVersionExtension>') &&
      exportedXml.includes('<gpxx:Version>v2</gpxx:Version>') &&
      exportedXml.includes('<gpxx:KomootTourId>70001</gpxx:KomootTourId>') &&
      exportedXml.includes('<gpxx:KomootCollectionId>1489201</gpxx:KomootCollectionId>'),
    'exportToGPX embeds SourceVersionExtension with version, tour ID, and collection ID'
  );

  console.log(`\nKomoot & GPX Versioning Tests: ${passed} passed, ${failed} failed\n`);
  return failed === 0;
}
