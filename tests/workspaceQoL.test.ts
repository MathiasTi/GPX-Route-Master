import fs from 'node:fs';
import path from 'node:path';
import type { GPXTrack } from '../types';
import { attachKomootSourceToTrack, applyKomootRefreshToTrack } from '../utils/komootVersioning';
import {
  filterWorkspaceTracks,
  formatTrackQuickSummary,
  resolveRefreshedTrackName
} from '../utils/workspaceQoL';

function makeTrack(overrides: Partial<GPXTrack>): GPXTrack {
  return {
    id: 'track-1',
    name: 'Alpenrunde',
    points: [
      { lat: 47.5, lng: 11.1, ele: 700 },
      { lat: 47.51, lng: 11.12, ele: 950 }
    ],
    color: '#3b82f6',
    visible: true,
    distance: 42.5,
    ascent: 820,
    descent: 810,
    maxSlope: 8.5,
    activityType: 'cycling',
    ...overrides
  };
}

export async function runWorkspaceQoLTests(): Promise<boolean> {
  console.log('🧪 Starting Workspace QoL & Bugfix Regression Tests...\n');
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

  // 1. resolveRefreshedTrackName
  assert(
    resolveRefreshedTrackName('Komoot Tour 987654', 'Brennerpass Klassiker', 'Komoot Tour 987654') ===
      'Brennerpass Klassiker',
    'resolveRefreshedTrackName prefers real suggestedName over generic Komoot Tour <id>'
  );
  assert(
    resolveRefreshedTrackName('Alter Tourname', 'Neuer Komoot Tourname', 'Alter Tourname') ===
      'Neuer Komoot Tourname',
    'resolveRefreshedTrackName adopts updated Komoot title on refresh'
  );
  assert(
    resolveRefreshedTrackName('Echter GPX Titel', 'Komoot Tour 123456', 'fallback') ===
      'Echter GPX Titel',
    'resolveRefreshedTrackName does not overwrite real GPX title with generic Komoot Tour ID'
  );
  assert(
    resolveRefreshedTrackName('', '', 'fallback-route') === 'fallback-route',
    'resolveRefreshedTrackName falls back cleanly when names are empty'
  );

  // 2. Komoot refresh keeps versioning & adopts renamed tour title
  const baseKomootTrack = attachKomootSourceToTrack(
    makeTrack({ id: 'k-1', name: 'Alte Runde' }),
    {
      sourceType: 'komoot',
      sourceUrl: 'https://www.komoot.com/tour/555111',
      komootTourId: '555111'
    }
  );
  const incomingRenamed = makeTrack({
    id: 'temp-incoming',
    name: resolveRefreshedTrackName('Komoot Tour 555111', 'Neue Panorama Runde', 'Alte Runde'),
    points: [
      { lat: 47.5, lng: 11.1, ele: 700 },
      { lat: 47.52, lng: 11.14, ele: 1020 }
    ]
  });
  const refreshed = applyKomootRefreshToTrack(baseKomootTrack, incomingRenamed, {
    sourceType: 'komoot',
    sourceUrl: 'https://www.komoot.com/tour/555111',
    komootTourId: '555111'
  });
  assert(
    refreshed.updated && refreshed.newVersion === 2 && refreshed.track.name === 'Neue Panorama Runde',
    'applyKomootRefreshToTrack increments version and applies resolved Komoot tour name'
  );

  // 3. filterWorkspaceTracks
  const tracks: GPXTrack[] = [
    attachKomootSourceToTrack(
      makeTrack({
        id: 't-komoot-bike',
        name: 'Dolomiten Gravel Loop',
        activityType: 'cycling',
        tags: ['Komoot', 'Gravel']
      }),
      {
        sourceType: 'komoot',
        sourceUrl: 'https://www.komoot.com/tour/111222',
        komootTourId: '111222',
        komootCollectionTitle: 'Südtirol 2026'
      }
    ),
    makeTrack({
      id: 't-run-local',
      name: 'Isar Morgenlauf',
      activityType: 'running',
      tags: ['Intervall']
    }),
    makeTrack({
      id: 't-bike-local',
      name: 'Starnberger See Runde',
      activityType: 'cycling',
      tourGroup: 'Hausrunden'
    })
  ];

  assert(
    filterWorkspaceTracks(tracks, { query: 'dolomiten' }).length === 1,
    'filterWorkspaceTracks matches case-insensitive track name'
  );
  assert(
    filterWorkspaceTracks(tracks, { query: 'südtirol' })[0]?.id === 't-komoot-bike',
    'filterWorkspaceTracks matches Komoot collection title'
  );
  assert(
    filterWorkspaceTracks(tracks, { query: 'hausrunden' })[0]?.id === 't-bike-local',
    'filterWorkspaceTracks matches tourGroup'
  );
  assert(
    filterWorkspaceTracks(tracks, { activityFilter: 'running' }).length === 1 &&
      filterWorkspaceTracks(tracks, { activityFilter: 'running' })[0].id === 't-run-local',
    'filterWorkspaceTracks filters by running activity type'
  );
  assert(
    filterWorkspaceTracks(tracks, { sourceFilter: 'komoot' }).length === 1 &&
      filterWorkspaceTracks(tracks, { sourceFilter: 'komoot' })[0].id === 't-komoot-bike',
    'filterWorkspaceTracks filters Komoot-linked tracks'
  );
  assert(
    filterWorkspaceTracks(tracks, { activityFilter: 'running', sourceFilter: 'komoot' }).length === 0,
    'filterWorkspaceTracks combines activity and source filters accurately'
  );

  // 4. formatTrackQuickSummary
  const cyclingSummary = formatTrackQuickSummary(
    attachKomootSourceToTrack(
      makeTrack({
        name: 'Glockner Ausfahrt',
        distance: 84.32,
        ascent: 1650,
        descent: 1640,
        duration: 10800,
        points: [
          { lat: 47.5, lng: 11.1, ele: 700, hr: 146 },
          { lat: 47.51, lng: 11.12, ele: 950, hr: 150 }
        ],
        powerStats: {
          avgPower: 225,
          normalizedPower: 242,
          maxPower: 520,
          best20s: 410,
          best1m: 340,
          best20m: 265,
          intensityFactor: 0.85,
          tss: 180
        }
      }),
      {
        sourceType: 'komoot',
        sourceUrl: 'https://www.komoot.com/tour/999000',
        komootTourId: '999000'
      }
    )
  );
  assert(
    cyclingSummary.includes('Glockner Ausfahrt (Radsport)') &&
      cyclingSummary.includes('84.32 km') &&
      cyclingSummary.includes('+1650 hm') &&
      cyclingSummary.includes('3h 00m') &&
      cyclingSummary.includes('Ø Puls: 148 bpm') &&
      cyclingSummary.includes('Ø Leistung: 225 W') &&
      cyclingSummary.includes('Quelle: https://www.komoot.com/tour/999000'),
    'formatTrackQuickSummary formats full cycling metrics and Komoot link cleanly'
  );

  const runningSummary = formatTrackQuickSummary(
    makeTrack({
      name: 'Stadtpark 10k',
      activityType: 'running',
      distance: 10,
      ascent: 45,
      descent: 45,
      duration: 3000
    })
  );
  assert(
    runningSummary.includes('Stadtpark 10k (Laufen)') &&
      runningSummary.includes('Pace:') &&
      !runningSummary.includes('Schnitt:'),
    'formatTrackQuickSummary uses Pace for running tracks'
  );

  // 5. Regression checks for fixed bugs across source files
  const root = process.cwd();
  const garminDashboardSrc = fs.readFileSync(path.join(root, 'components/GarminDashboard.tsx'), 'utf8');
  assert(
    !garminDashboardSrc.includes('window.confirm'),
    'GarminDashboard.tsx no longer uses native window.confirm'
  );
  assert(
    garminDashboardSrc.includes('handleQuickSyncHealth30d') &&
      garminDashboardSrc.includes('/api/garmin/personal/sync-health'),
    'GarminDashboard.tsx supports direct 30-day health sync from empty health tabs'
  );

  const rawDataTabSrc = fs.readFileSync(path.join(root, 'components/analysis/RawDataTab.tsx'), 'utf8');
  assert(
    rawDataTabSrc.includes('URL.revokeObjectURL(url)'),
    'RawDataTab.tsx revokes CSV Blob URL after download'
  );

  const videoExportSrc = fs.readFileSync(path.join(root, 'components/VideoExportModal.tsx'), 'utf8');
  assert(
    /useEffect\(\(\) => \{\s*return \(\) => \{\s*if \(downloadUrl\)/.test(videoExportSrc),
    'VideoExportModal.tsx revokes downloadUrl on change and unmount'
  );

  const appSrc = fs.readFileSync(path.join(root, 'App.tsx'), 'utf8');
  assert(
    appSrc.includes('handleRefreshAllKomootTracks') &&
      appSrc.includes("window.dispatchEvent(new CustomEvent('library-updated'))"),
    'App.tsx provides Komoot bulk refresh and dispatches library-updated live event'
  );

  const urlImporterSrc = fs.readFileSync(path.join(root, 'utils/urlGpxImporter.ts'), 'utf8');
  assert(
    urlImporterSrc.includes('const redirectedCollection = parseKomootCollectionUrl(directRes.finalUrl)'),
    'urlGpxImporter.ts detects Komoot collections after shortlink redirects'
  );

  console.log(`\n📊 Workspace QoL & Bugfix Results: ${passed} passed, ${failed} failed\n`);
  return failed === 0;
}
