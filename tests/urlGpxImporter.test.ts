import {
  isBlockedIpAddress,
  assertSafeExternalUrl,
  parseKomootTourUrl,
  parseKomootCollectionUrl,
  extractKomootTourFromPayload,
  extractKomootCollectionFromPayload,
  extractKomootTourTitleFromHtml,
  cleanKomootTourTitle,
  isGenericKomootTourName,
  buildGpxFromKomootTour,
  validateDirectGpxText,
  mapKomootSportToActivityType,
  UrlImportError
} from '../utils/urlGpxImporter';

export async function runUrlGpxImporterTests(): Promise<boolean> {
  console.log('🧪 Starting URL & Komoot GPX Importer Unit Tests...\n');
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

  // 1. SSRF IP blocking
  assert(isBlockedIpAddress('127.0.0.1') === true, 'Blocks IPv4 loopback 127.0.0.1');
  assert(isBlockedIpAddress('10.20.30.40') === true, 'Blocks private RFC1918 10.x.x.x');
  assert(isBlockedIpAddress('172.16.5.4') === true, 'Blocks private RFC1918 172.16.x.x');
  assert(isBlockedIpAddress('192.168.1.100') === true, 'Blocks private RFC1918 192.168.x.x');
  assert(isBlockedIpAddress('169.254.169.254') === true, 'Blocks cloud metadata link-local 169.254.169.254');
  assert(isBlockedIpAddress('100.64.0.1') === true, 'Blocks CGNAT 100.64.0.1');
  assert(isBlockedIpAddress('::1') === true, 'Blocks IPv6 loopback ::1');
  assert(isBlockedIpAddress('fe80::1') === true, 'Blocks IPv6 link-local fe80::1');
  assert(isBlockedIpAddress('fc00::1') === true, 'Blocks IPv6 unique local fc00::1');
  assert(isBlockedIpAddress('::ffff:127.0.0.1') === true, 'Blocks IPv4-mapped IPv6 ::ffff:127.0.0.1');
  assert(isBlockedIpAddress('0:0:0:0:0:ffff:127.0.0.1') === true, 'Blocks expanded IPv4-mapped IPv6 0:0:0:0:0:ffff:127.0.0.1');
  assert(isBlockedIpAddress('::ffff:0:127.0.0.1') === true, 'Blocks IPv4-translated IPv6 ::ffff:0:127.0.0.1');
  assert(isBlockedIpAddress('::127.0.0.1') === true, 'Blocks IPv4-compatible IPv6 ::127.0.0.1');
  assert(isBlockedIpAddress('64:ff9b::169.254.169.254') === true, 'Blocks NAT64 cloud metadata 64:ff9b::169.254.169.254');
  assert(isBlockedIpAddress('64:ff9b:1::1') === true, 'Blocks NAT64 local-use 64:ff9b:1::1');
  assert(isBlockedIpAddress('2002:7f00:0001::') === true, 'Blocks 6to4 loopback 2002:7f00:0001::');
  assert(isBlockedIpAddress('2001:0000:4136:e378:8000:63bf:3fff:fdd2') === true, 'Blocks Teredo IPv6 range');
  assert(isBlockedIpAddress('2001:db8::1') === true, 'Blocks IPv6 documentation range 2001:db8::/32');
  assert(isBlockedIpAddress('100::1') === true, 'Blocks IPv6 discard range 100::/64');
  assert(isBlockedIpAddress('fec0::1') === true, 'Blocks deprecated IPv6 site-local fec0::/10');
  assert(isBlockedIpAddress('93.184.216.34') === false, 'Allows public IPv4 93.184.216.34');
  assert(isBlockedIpAddress('2606:4700:4700::1111') === false, 'Allows public IPv6 2606:4700:4700::1111');
  assert(isBlockedIpAddress('2002:0101:0101::') === false, 'Allows public 6to4 2002:0101:0101:: (1.1.1.1)');

  // 2. SSRF URL + DNS guard
  let blockedLocalhost = false;
  try {
    await assertSafeExternalUrl('http://localhost:3000/api/tracks');
  } catch (err) {
    blockedLocalhost = err instanceof UrlImportError && err.statusCode === 403;
  }
  assert(blockedLocalhost, 'assertSafeExternalUrl blocks localhost');

  let blockedTrailingDotMetadata = false;
  try {
    await assertSafeExternalUrl('http://metadata.google.internal./computeMetadata/v1/');
  } catch (err) {
    blockedTrailingDotMetadata = err instanceof UrlImportError && err.statusCode === 403;
  }
  assert(blockedTrailingDotMetadata, 'assertSafeExternalUrl blocks trailing-dot metadata.google.internal.');

  let blockedTrailingDotLocalhost = false;
  try {
    await assertSafeExternalUrl('http://localhost./api/tracks');
  } catch (err) {
    blockedTrailingDotLocalhost = err instanceof UrlImportError && err.statusCode === 403;
  }
  assert(blockedTrailingDotLocalhost, 'assertSafeExternalUrl blocks trailing-dot localhost.');

  let blockedFileScheme = false;
  try {
    await assertSafeExternalUrl('file:///etc/passwd');
  } catch (err) {
    blockedFileScheme = err instanceof UrlImportError && err.statusCode === 400;
  }
  assert(blockedFileScheme, 'assertSafeExternalUrl rejects file:// scheme');

  let blockedDnsRebind = false;
  try {
    await assertSafeExternalUrl('https://evil.example.com/track.gpx', async () => [
      { address: '192.168.0.5', family: 4 }
    ]);
  } catch (err) {
    blockedDnsRebind = err instanceof UrlImportError && err.statusCode === 403;
  }
  assert(blockedDnsRebind, 'assertSafeExternalUrl blocks hostnames resolving to private IP');

  const safePublicUrl = await assertSafeExternalUrl('https://www.komoot.com/tour/123456', async () => [
    { address: '54.93.100.10', family: 4 }
  ]);
  assert(safePublicUrl.hostname === 'www.komoot.com', 'assertSafeExternalUrl allows public Komoot URL');

  // Out-of-range HTML numeric entities must never throw RangeError
  const safeDecodedTitle = cleanKomootTourTitle('Alpenrunde &#999999999; &#x110000; &amp; &#65;');
  assert(
    safeDecodedTitle.includes('Alpenrunde') && safeDecodedTitle.includes('& A'),
    'cleanKomootTourTitle safely handles out-of-range Unicode HTML entities without crashing'
  );

  // 3. Komoot URL parsing (multilingual domains + share_token + collections)
  const k1 = parseKomootTourUrl('https://www.komoot.de/tour/987654321?share_token=abcXYZ_123&ref=wtd');
  assert(
    k1 !== null && k1.tourId === '987654321' && k1.shareToken === 'abcXYZ_123',
    'parseKomootTourUrl extracts German domain tourId and share_token'
  );
  const k2 = parseKomootTourUrl('https://www.komoot.com/de-de/tour/555111222/zoom');
  assert(
    k2 !== null && k2.tourId === '555111222' && k2.shareToken === null,
    'parseKomootTourUrl extracts locale-prefixed /de-de/tour/... path'
  );
  assert(
    parseKomootTourUrl('https://example.com/routes/alpen.gpx') === null,
    'parseKomootTourUrl returns null for direct non-Komoot GPX URLs'
  );

  const c1 = parseKomootCollectionUrl(
    'https://www.komoot.de/de-de/collection/1489201/-alpencross-2026?share_token=tok_Col99'
  );
  assert(
    c1 !== null && c1.collectionId === '1489201' && c1.shareToken === 'tok_Col99',
    'parseKomootCollectionUrl extracts locale-prefixed collectionId and share_token'
  );
  const c2 = parseKomootCollectionUrl('https://www.komoot.com/user/998877/collections/334455');
  assert(
    c2 !== null && c2.collectionId === '334455' && c2.shareToken === null,
    'parseKomootCollectionUrl extracts /user/{id}/collections/{collectionId}'
  );
  assert(
    parseKomootCollectionUrl('https://www.komoot.com/tour/123456') === null,
    'parseKomootCollectionUrl returns null for single tour URLs'
  );

  // 4. Sport mapping
  assert(mapKomootSportToActivityType('racebike') === 'cycling', 'Maps Komoot racebike -> cycling');
  assert(mapKomootSportToActivityType('mtb') === 'cycling', 'Maps Komoot mtb -> cycling');
  assert(mapKomootSportToActivityType('jogging') === 'running', 'Maps Komoot jogging -> running');
  assert(mapKomootSportToActivityType('hiking') === 'running', 'Maps Komoot hiking -> running');

  // 5. Komoot kmtBoot HTML extraction & GPX 1.1 synthesis + downstream compatibility
  const mockKomootPayload = {
    pageProps: {
      tour: {
        name: 'Taunus & Feldberg Runde',
        sport: 'racebike',
        date: '2026-06-15T08:30:00.000Z',
        changed_at: '2026-06-18T14:22:00.000Z',
        _embedded: {
          coordinates: {
            items: [
              { lat: 50.110924, lng: 8.682127, alt: 112.4, t: 0 },
              { lat: 50.150120, lng: 8.590410, alt: 340.8, t: 900000 },
              { lat: 50.232100, lng: 8.457200, alt: 878.5, t: 2400000 }
            ]
          }
        }
      }
    }
  };
  const escapedJsonStr = JSON.stringify(JSON.stringify(mockKomootPayload));
  const mockHtml = `<!doctype html><html><head><title>Taunus | Komoot</title></head><body><script>kmtBoot.setProps(${escapedJsonStr});</script></body></html>`;

  const extracted = extractKomootTourFromPayload(mockHtml, '987654321');
  assert(extracted !== null, 'extractKomootTourFromPayload extracts tour from kmtBoot.setProps HTML');
  if (extracted) {
    assert(extracted.name === 'Taunus & Feldberg Runde', 'Extracted tour name matches');
    assert(extracted.changedAt === '2026-06-18T14:22:00.000Z', 'Extracted changed_at timestamp matches');
    assert(extracted.coordinates.length === 3, 'Extracted all 3 coordinates');
    const gpxXml = buildGpxFromKomootTour(extracted);
    validateDirectGpxText(gpxXml);
    assert(gpxXml.includes('<gpx version="1.1"'), 'Synthesized GPX uses GPX 1.1 header');
    assert(
      gpxXml.includes('<name>Taunus &amp; Feldberg Runde</name>'),
      'Synthesized GPX properly XML-escapes tour title'
    );
    assert(
      gpxXml.includes('<trkpt lat="50.110924" lon="8.682127">') &&
        gpxXml.includes('<ele>112.4</ele>') &&
        gpxXml.includes('<time>2026-06-15T08:30:00.000Z</time>') &&
        gpxXml.includes('<trkpt lat="50.232100" lon="8.457200">'),
      'Synthesized Komoot GPX preserves all trackpoints, elevation, and relative timestamps'
    );
  }

  // 6. Komoot Collection kmtBoot / HAL _embedded extraction
  const mockCollectionPayload = {
    pageProps: {
      collection: {
        id: 1489201,
        name: 'Alpencross 2026 – Etappen',
        _embedded: {
          contents: [
            {
              type: 'tour',
              tour: {
                id: 70001,
                name: 'Etappe 1: Garmisch – Imst',
                sport: 'mtb',
                distance: 78400,
                elevation_up: 1620,
                duration: 16200,
                share_token: 'subTok1'
              }
            },
            {
              type: 'highlight',
              id: 999999,
              name: 'Fernpass Aussichtspunkt'
            },
            {
              type: 'tour_planned',
              id: 70002,
              name: 'Etappe 2: Imst – Nauders (Trail)',
              sport: 'trail_running',
              distance: 32500,
              elevation_up: 1180,
              duration: 12600
            }
          ]
        }
      }
    }
  };
  const escapedCollectionStr = JSON.stringify(JSON.stringify(mockCollectionPayload));
  const mockCollectionHtml = `<!doctype html><html><head><title>Alpencross 2026 – Collection by Alex | Komoot</title></head><body><script>kmtBoot.setProps(${escapedCollectionStr});</script></body></html>`;

  const extractedCol = extractKomootCollectionFromPayload(mockCollectionHtml, '1489201', 'parentTok');
  assert(extractedCol !== null, 'extractKomootCollectionFromPayload parses Collection HTML');
  if (extractedCol) {
    assert(
      extractedCol.title === 'Alpencross 2026 – Etappen',
      'Extracts exact Collection title'
    );
    assert(
      extractedCol.tours.length === 2,
      `Extracts 2 tours while skipping non-tour highlight (got ${extractedCol.tours.length})`
    );
    assert(
      extractedCol.tours[0].id === '70001' &&
        extractedCol.tours[0].distanceKm === 78.4 &&
        extractedCol.tours[0].ascentM === 1620 &&
        extractedCol.tours[0].activityType === 'cycling' &&
        extractedCol.tours[0].shareToken === 'subTok1',
      'Normalizes tour stub 1 metrics, activityType, and sub-tour shareToken'
    );
    assert(
      extractedCol.tours[1].id === '70002' &&
        extractedCol.tours[1].activityType === 'running' &&
        extractedCol.tours[1].shareToken === 'parentTok',
      'Normalizes tour stub 2 running sport and inherits collection shareToken'
    );
  }

  // 7. Direct GPX validation rejects HTML error pages
  let rejectedHtml = false;
  try {
    validateDirectGpxText('<!DOCTYPE html><html><body>Login required</body></html>');
  } catch (err) {
    rejectedHtml = err instanceof UrlImportError && err.statusCode === 422;
  }
  assert(rejectedHtml, 'validateDirectGpxText rejects HTML pages');

  // 8. Komoot Share-Link Title Cleaning, Entity Decoding & Coordinates-Without-Name Fallback
  const kSmart = parseKomootTourUrl('https://www.komoot.de/de-de/smarttour/44332211?share_token=tok_Smart1');
  assert(
    kSmart !== null && kSmart.tourId === '44332211' && kSmart.shareToken === 'tok_Smart1',
    'parseKomootTourUrl parses /smarttour/ share link'
  );
  const kInvite = parseKomootTourUrl('https://www.komoot.com/invite-tour/88776655?share_token=tok_Inv2');
  assert(
    kInvite !== null && kInvite.tourId === '88776655' && kInvite.shareToken === 'tok_Inv2',
    'parseKomootTourUrl parses /invite-tour/ share link'
  );

  assert(
    cleanKomootTourTitle('Sauerland &amp; M&ouml;hnesee Runde | Rennrad-Tour | Komoot') === 'Sauerland & Möhnesee Runde',
    'cleanKomootTourTitle strips Komoot sport suffix and decodes HTML entities'
  );
  assert(
    isGenericKomootTourName('Komoot Tour 987654321', '987654321') === true &&
      isGenericKomootTourName('Sauerland & Möhnesee Runde', '987654321') === false,
    'isGenericKomootTourName distinguishes fallback ID titles from real tour titles'
  );

  // Reversed <meta content="..." property="og:title"> + embedded coordinates JSON lacking a tour name
  const shareHtmlWithoutJsonName = `<!doctype html>
    <html>
      <head>
        <meta content="Alpen&uuml;berquerung &amp; K&ouml;nigssee | Mountainbike-Tour | Komoot" property="og:title" />
      </head>
      <body>
        <script id="__NEXT_DATA__" type="application/json">${JSON.stringify({
          props: {
            creator: { username: 'max_muster', name: 'Max Mustermann' },
            coordinates: {
              items: [
                { lat: 47.5901, lng: 12.9892, alt: 610 },
                { lat: 47.6105, lng: 13.0014, alt: 890 }
              ]
            }
          }
        })}</script>
      </body>
    </html>`;
  assert(
    extractKomootTourTitleFromHtml(shareHtmlWithoutJsonName, '112233') === 'Alpenüberquerung & Königssee',
    'extractKomootTourTitleFromHtml handles reversed meta attribute order and decodes entities'
  );
  const shareExtracted = extractKomootTourFromPayload(shareHtmlWithoutJsonName, '112233');
  assert(
    shareExtracted !== null &&
      shareExtracted.name === 'Alpenüberquerung & Königssee' &&
      shareExtracted.coordinates.length === 2,
    'extractKomootTourFromPayload keeps real og:title instead of generic fallback or creator username'
  );

  console.log(`\nURL GPX Importer Tests: ${passed} passed, ${failed} failed\n`);
  return failed === 0;
}
