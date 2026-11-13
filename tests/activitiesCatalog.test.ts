import {
  initDb,
  saveTrack,
  saveGarminActivity,
  queryActivitiesCatalog,
  getFilteredActivityRefs,
  getActivitiesBulkFull,
  updateCatalogActivityMetadata,
  bulkDeleteCatalogActivities,
  repairStoredActivityDates,
  db
} from '../utils/db';
import { hydrateGarminActivityPayload, hydrateLibraryTrackPayload } from '../utils/activityHydration';
import { hasRealGpsData, parseGPXStream } from '../utils/gpxUtils';

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

export async function runActivitiesCatalogTests(): Promise<boolean> {
  const testUser = '__test_catalog_suite__';
  console.log('🧪 Running High-Speed Activities Catalog & Hydration Tests...');

  try {
    initDb();

    // Clean any leftover test rows for the isolated test user
    db.prepare('DELETE FROM tracks WHERE user_id = ?').run(testUser);
    db.prepare('DELETE FROM garmin_activities WHERE user_id = ?').run(testUser);

    // 1. Seed mixed library + garmin test records including Dortmund Garmin activity + 1,500 bulk rows for speed verification
    const t0 = performance.now();
    const insertMany = db.transaction(() => {
      for (let i = 0; i < 1500; i++) {
        const month = String((i % 12) + 1).padStart(2, '0');
        const day = String((i % 28) + 1).padStart(2, '0');
        const year = i % 2 === 0 ? '2026' : '2025';
        const hour = String(i % 24).padStart(2, '0');
        const dateStr = `${year}-${month}-${day} ${hour}:15:00`;

        if (i % 3 === 0) {
          saveTrack(
            {
              id: `lib-${i}`,
              name: i === 0 ? 'Alpenpass Teststrecke' : `GPX Tour ${i}`,
              distance: 45 + (i % 60),
              ascent: 800 + (i % 1200),
              descent: 800,
              duration: 7200,
              activityType: 'cycling',
              description: i === 0 ? 'Kombiniert mit Schotterpass' : 'Trainingsfahrt',
              tags: i === 0 ? 'Alpen,Tempo' : 'Training',
              dateCreated: `${year}-${month}-${day}`,
              originalFilename: `tour_${i}.gpx`,
              points: [
                { lat: 47.5, lng: 11.1, ele: 900 },
                { lat: 47.52, lng: 11.12, ele: 1050 }
              ]
            },
            testUser
          );
        } else {
          saveGarminActivity(
            `garmin-${i}`,
            i === 1 ? 'Dortmund Laufen' : `Garmin Einheit ${i}`,
            i % 2 === 0 ? 'running' : 'cycling',
            dateStr,
            10 + (i % 35),
            2400 + (i % 3600),
            120 + (i % 400),
            115,
            550,
            148,
            i === 1 ? 'Abendlauf am Phönixsee' : 'Standardeinheit',
            i === 1 ? 'Dortmund' : 'München',
            JSON.stringify([
              { lat: 51.491, lng: 7.508, ele: 95 },
              { lat: 51.495, lng: 7.515, ele: 105 }
            ]),
            testUser
          );
        }
      }

      // Specific newest entry matching exact user scenario
      saveGarminActivity(
        'garmin-dortmund-latest',
        'Dortmund Laufen',
        'running',
        '2026-11-12 18:33:42',
        11.4,
        3240,
        92,
        90,
        740,
        154,
        'Abendlauf Westfalenpark',
        'Dortmund',
        JSON.stringify([
          { position_lat: Math.round(51.5136 * (2147483648 / 180)), position_long: Math.round(7.4653 * (2147483648 / 180)), ele: 88 },
          { position_lat: Math.round(51.5160 * (2147483648 / 180)), position_long: Math.round(7.4700 * (2147483648 / 180)), ele: 94 }
        ]),
        testUser
      );
    });
    insertMany();
    const seedMs = performance.now() - t0;

    // 2. Test speed & chronological newest-first sorting across 1,501 records
    const qStart = performance.now();
    const firstPage = queryActivitiesCatalog({ limit: 150, offset: 0, sortBy: 'date-desc' }, testUser);
    const queryMs = performance.now() - qStart;

    assert(firstPage.totalCount === 1501, `Expected 1501 totalCount, got ${firstPage.totalCount}`);
    assert(firstPage.databaseTotalCount === 1501, `Expected 1501 databaseTotalCount`);
    assert(firstPage.items.length === 150, `Expected page size 150, got ${firstPage.items.length}`);
    assert(firstPage.hasMore === true, 'Expected hasMore to be true');
    assert(firstPage.monthSummaries.length >= 12, 'Expected month summaries across dataset');

    // Verify newest Garmin entry is first (2026-12-... comes after 2026-11-12 in calendar, wait: looped months generated 2026-12!)
    // Verify timestamps are strictly non-increasing when sorted date-desc
    for (let i = 1; i < firstPage.items.length; i++) {
      const prev = firstPage.items[i - 1].timestampIso.replace('T', ' ').slice(0, 19);
      const curr = firstPage.items[i].timestampIso.replace('T', ' ').slice(0, 19);
      assert(prev >= curr, `Expected descending date order at index ${i}: ${prev} >= ${curr}`);
    }

    // 3. Test multi-word search across name, location, description, tags, filename
    const dortmundSearch = queryActivitiesCatalog({ q: 'Dortmund Westfalenpark', source: 'garmin' }, testUser);
    assert(dortmundSearch.totalCount === 1, `Expected 1 Dortmund Westfalenpark match, got ${dortmundSearch.totalCount}`);
    assert(dortmundSearch.items[0].id === 'garmin-dortmund-latest', 'Expected exact Dortmund activity');

    const filenameSearch = queryActivitiesCatalog({ q: 'tour_0.gpx Schotterpass' }, testUser);
    assert(filenameSearch.totalCount === 1 && filenameSearch.items[0].source === 'library', 'Expected search across originalFilename and description');

    // 4. Test metric & date-range filters
    const filtered = queryActivitiesCatalog(
      {
        activityType: 'cycling',
        minDistance: 80,
        minAscent: 1200,
        startDate: '2026-01-01',
        endDate: '2026-12-31'
      },
      testUser
    );
    assert(filtered.items.every((item) => item.distanceKm >= 80 && item.ascentM >= 1200), 'Expected metric filters enforced in SQL');

    // 5. Test bulk-load preserves raw points_json & Garmin semicircle hydration converts cleanly to Dortmund coordinates
    const bulkFull = getActivitiesBulkFull(
      [
        { source: 'garmin', id: 'garmin-dortmund-latest' },
        { source: 'library', id: 'lib-0' }
      ],
      testUser
    );
    assert(bulkFull.garminRecords.length === 1, 'Expected 1 full garmin record');
    assert(bulkFull.libraryRecords.length === 1, 'Expected 1 full library record');

    const hydratedGarmin = hydrateGarminActivityPayload(bulkFull.garminRecords[0]);
    assert(hydratedGarmin.points.length === 2, 'Expected 2 real hydrated Garmin points');
    assert(
      Math.abs(hydratedGarmin.points[0].lat - 51.5136) < 0.01 &&
        Math.abs(hydratedGarmin.points[0].lng - 7.4653) < 0.01,
      `Expected Dortmund semicircle points hydrated to ~(51.5136, 7.4653), got (${hydratedGarmin.points[0].lat}, ${hydratedGarmin.points[0].lng})`
    );
    assert(hydratedGarmin.isVirtual === false, 'Expected real GPS track (not virtual)');

    // 6. Test inline metadata update without touching points_json
    const rawBefore = bulkFull.garminRecords[0].points_json;
    const updatedOk = updateCatalogActivityMetadata(
      'garmin',
      'garmin-dortmund-latest',
      {
        name: 'Dortmund Westfalenpark Lauf',
        description: 'Aktualisierte Notiz',
        activityType: 'running',
        date: '2026-11-12 18:33:42',
        location: 'Dortmund'
      },
      testUser
    );
    assert(updatedOk, 'Expected inline metadata update to succeed');
    const afterBulk = getActivitiesBulkFull([{ source: 'garmin', id: 'garmin-dortmund-latest' }], testUser);
    assert(afterBulk.garminRecords[0].name === 'Dortmund Westfalenpark Lauf', 'Expected updated name persisted');
    assert(afterBulk.garminRecords[0].points_json === rawBefore, 'Expected raw points_json untouched in DB');

    // 7. Test transactional bulk delete with filtered refs
    const refsToDelete = getFilteredActivityRefs({}, 5000, testUser);
    assert(refsToDelete.length === 1501, `Expected 1501 refs for cleanup delete, got ${refsToDelete.length}`);
    const deletedCount = bulkDeleteCatalogActivities(refsToDelete, testUser);
    assert(deletedCount === 1501, `Expected 1501 deleted rows, got ${deletedCount}`);

    const emptyCheck = queryActivitiesCatalog({}, testUser);
    assert(emptyCheck.databaseTotalCount === 0, 'Expected clean test database after bulk delete');

    // 8. Test GPS-less map isolation (hasRealGpsData + catalog hasGps + hydration)
    saveGarminActivity(
      'garmin-indoor-no-gps',
      'Indoor Cycling Rollentraining',
      'cycling',
      '2026-10-05 19:00:00',
      28.5,
      3600,
      0,
      0,
      620,
      142,
      'Zwift Ergometer',
      'Dortmund',
      '[]',
      testUser
    );
    const indoorCatalog = queryActivitiesCatalog({ q: 'Rollentraining' }, testUser);
    assert(indoorCatalog.totalCount === 1, 'Expected indoor activity in catalog');
    assert(indoorCatalog.items[0].hasGps === false, 'Expected indoor activity with empty points_json to have hasGps === false');

    const hydratedIndoor = hydrateGarminActivityPayload(
      getActivitiesBulkFull([{ source: 'garmin', id: 'garmin-indoor-no-gps' }], testUser).garminRecords[0]
    );
    assert(hydratedIndoor.isVirtual === true, 'Expected indoor Garmin hydration to set isVirtual === true');
    assert(hasRealGpsData(hydratedIndoor) === false, 'Expected hasRealGpsData(hydratedIndoor) === false so 2D/3D maps hide it');

    const hydratedTaggedLib = hydrateLibraryTrackPayload({
      id: 'lib-virtual-fit',
      name: 'Indoor FIT Unit',
      tags: ['Indoor/Virtuell'],
      points: [
        { lat: 48.137154, lng: 11.576124, ele: 500 },
        { lat: 48.140000, lng: 11.580000, ele: 505 }
      ]
    });
    assert(hydratedTaggedLib.isVirtual === true && !hasRealGpsData(hydratedTaggedLib), 'Expected Indoor/Virtuell library track to be hidden from maps');

    assert(
      !hasRealGpsData({
        id: 'stationary-1pt',
        points: [{ lat: 51.5, lng: 7.4 }, { lat: 51.5, lng: 7.4 }]
      }),
      'Expected identical stationary points to fail hasRealGpsData'
    );

    // 9. Test parseGPXStream preserves authentic historical timestamps without shifting to 'now'
    const samplePottrundeGpx = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="TestUnit">
  <metadata><name>Pottrunde</name><time>2025-05-18T08:15:00.000Z</time></metadata>
  <trk><name>Pottrunde</name><trkseg>
    <trkpt lat="51.4910" lon="7.5080"><ele>95.0</ele><time>2025-05-18T08:15:10.000Z</time></trkpt>
    <trkpt lat="51.4950" lon="7.5150"><ele>105.0</ele><time>2025-05-18T08:17:10.000Z</time></trkpt>
  </trkseg></trk>
</gpx>`;
    const parsedPottrunde = await parseGPXStream(new Blob([samplePottrundeGpx], { type: 'application/gpx+xml' }), 'Pottrunde.gpx');
    assert(parsedPottrunde !== null, 'Expected Pottrunde GPX stream to parse');
    assert(
      parsedPottrunde!.dateCreated === '2025-05-18T08:15:10.000Z',
      `Expected authentic dateCreated 2025-05-18T08:15:10.000Z, got ${parsedPottrunde!.dateCreated}`
    );
    assert(
      new Date(parsedPottrunde!.points[0].time as any).toISOString() === '2025-05-18T08:15:10.000Z',
      'Expected GPX point timestamp preserved untouched (no shift to now)'
    );
    assert(hasRealGpsData(parsedPottrunde!) === true, 'Expected Pottrunde GPX with 2 distinct coordinates to satisfy hasRealGpsData');

    // 10. Test saveTrack authentic fallback & repairStoredActivityDates fixes historical Pottrunde import-date bug
    saveTrack(
      {
        id: 'pottrunde-auto-date',
        name: 'Pottrunde Auto',
        distance: 12.5,
        ascent: 110,
        descent: 110,
        activityType: 'cycling',
        points: parsedPottrunde!.points,
        rawFileDetails: parsedPottrunde!.rawFileDetails
      },
      testUser
    );
    const pottrundeAutoCat = queryActivitiesCatalog({ q: 'Pottrunde Auto' }, testUser);
    assert(
      pottrundeAutoCat.items[0]?.timestampIso.startsWith('2025-05-18'),
      `Expected saveTrack without explicit dateCreated to infer 2025-05-18, got ${pottrundeAutoCat.items[0]?.timestampIso}`
    );

    // Simulate legacy Pottrunde row stored with import date (2026-11-12) while points/metadata hold 2025-05-18
    saveTrack(
      {
        id: 'pottrunde-legacy-import-bug',
        name: 'Pottrunde',
        distance: 42.1,
        ascent: 320,
        descent: 320,
        activityType: 'cycling',
        dateCreated: '2026-11-12',
        points: parsedPottrunde!.points,
        rawFileDetails: parsedPottrunde!.rawFileDetails
      },
      testUser
    );
    repairStoredActivityDates();
    const repairedPottrundeCat = queryActivitiesCatalog({ q: 'Pottrunde' }, testUser);
    const repairedLegacyItem = repairedPottrundeCat.items.find((i) => i.id === 'pottrunde-legacy-import-bug');
    assert(
      Boolean(repairedLegacyItem && repairedLegacyItem.timestampIso.startsWith('2025-05-18')),
      `Expected repairStoredActivityDates to restore Pottrunde date to 2025-05-18, got ${repairedLegacyItem?.timestampIso}`
    );

    // Clean up extra test rows
    db.prepare('DELETE FROM tracks WHERE user_id = ?').run(testUser);
    db.prepare('DELETE FROM garmin_activities WHERE user_id = ?').run(testUser);

    console.log(
      `✅ Activities Catalog tests passed (1,501 rows seeded in ${seedMs.toFixed(1)}ms, metadata query in ${queryMs.toFixed(1)}ms + GPS/Date integrity checks)`
    );
    return true;
  } catch (err) {
    console.error('❌ Activities Catalog test failed:', err);
    try {
      db.prepare('DELETE FROM tracks WHERE user_id = ?').run(testUser);
      db.prepare('DELETE FROM garmin_activities WHERE user_id = ?').run(testUser);
    } catch {}
    return false;
  }
}
