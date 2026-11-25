import fs from 'node:fs';
import path from 'node:path';
import {
  DirectWaypointRouteEngine,
  addRouteWaypoint,
  buildGpxTrackFromPlannedRoute,
  closeRouteLoop,
  formatRouteDuration,
  formatRoutePacePerKm,
  haversineDistanceKm,
  moveRouteWaypoint,
  removeRouteWaypoint,
  reverseRouteWaypoints
} from '../utils/routePlanner';
import {
  buildValhallaRoutePayload,
  computeRouteElevationMetrics,
  decodePolyline6,
  mapValhallaManeuverType,
  validateValhallaRouteRequest
} from '../utils/valhallaRouting';
import {
  OFF_ROUTE_ENTER_METERS,
  OFF_ROUTE_EXIT_METERS,
  computeLiveTrackProgress,
  extractGeometricTurnCues,
  formatTurnDistance,
  resolveTrackTurnCues
} from '../utils/liveNavigation';
import { resolveBottomSheetSnap } from '../utils/mobileSheet';
import type { GPXTrack } from '../types';

export function runMobileAndRoutingTests(): boolean {
  console.log('📱 Running Mobile UI, OSM Valhalla Routing & Live GPS Test Suite...\n');
  let passed = 0;
  let failed = 0;

  function assert(condition: boolean, name: string) {
    if (condition) {
      console.log(`  ✅ [PASS] ${name}`);
      passed++;
    } else {
      console.error(`  ❌ [FAIL] ${name}`);
      failed++;
    }
  }

  // 1. Route Planner pure waypoint operations
  let wps = addRouteWaypoint([], 48.1351, 11.582); // Munich Marienplatz
  wps = addRouteWaypoint(wps, 48.1642, 11.6056); // Englischer Garten North (~3.7 km)
  wps = addRouteWaypoint(wps, 48.1755, 11.5518); // Olympiapark (~4.2 km)
  assert(wps.length === 3, 'addRouteWaypoint appends 3 valid waypoints');

  const moved = moveRouteWaypoint(wps, wps[1].id, 48.165, 11.606);
  assert(
    moved[1].lat === 48.165 && moved[1].lng === 11.606,
    'moveRouteWaypoint updates target waypoint coordinates cleanly'
  );

  const removed = removeRouteWaypoint(moved, moved[1].id);
  assert(removed.length === 2 && removed[1].id === wps[2].id, 'removeRouteWaypoint removes middle waypoint');

  const reversed = reverseRouteWaypoints(wps);
  assert(
    reversed[0].id === wps[2].id && reversed[2].id === wps[0].id,
    'reverseRouteWaypoints reverses waypoint order without mutating original'
  );

  const looped = closeRouteLoop(wps);
  assert(
    looped.length === 4 &&
      haversineDistanceKm(looped[0], looped[looped.length - 1]) < 0.001,
    'closeRouteLoop appends closing waypoint matching start'
  );
  const loopedAgain = closeRouteLoop(looped);
  assert(loopedAgain.length === 4, 'closeRouteLoop is idempotent when route is already closed');

  // 2. DirectWaypointRouteEngine cycling vs running profiles & densification
  const cyclingPreview = DirectWaypointRouteEngine.computeRoute(wps, 'cycling', {
    cyclingSpeedKmh: 25
  });
  const runningPreview = DirectWaypointRouteEngine.computeRoute(wps, 'running', {
    runningSpeedKmh: 10
  });
  const gravelPreview = DirectWaypointRouteEngine.computeRoute(wps, 'gravel');
  const mtbPreview = DirectWaypointRouteEngine.computeRoute(wps, 'mtb');

  assert(
    cyclingPreview.totalDistanceKm > 6 && cyclingPreview.totalDistanceKm < 10,
    `DirectWaypointRouteEngine calculates realistic Munich distance (${cyclingPreview.totalDistanceKm} km)`
  );
  assert(
    cyclingPreview.totalDistanceKm === runningPreview.totalDistanceKm &&
      gravelPreview.estimatedSpeedKmh === 20 &&
      mtbPreview.estimatedSpeedKmh === 16,
    'All 4 profiles share route distance and apply profile-specific speeds'
  );
  assert(
    runningPreview.estimatedDurationSec > cyclingPreview.estimatedDurationSec * 2,
    'Running profile estimates longer duration than cycling profile'
  );
  assert(
    runningPreview.pacePerKmFormatted === '6:00 /km',
    `formatRoutePacePerKm computes 6:00 /km for 10 km/h (got ${runningPreview.pacePerKmFormatted})`
  );
  assert(
    cyclingPreview.points.length > wps.length &&
      cyclingPreview.points[0].dist === 0 &&
      (cyclingPreview.points[cyclingPreview.points.length - 1].dist ?? 0) > 6000,
    'DirectWaypointRouteEngine densifies segments with monotonic cumulative meters'
  );
  assert(
    formatRoutePacePerKm(12) === '5:00 /km' && formatRouteDuration(3900) === '1h 05m',
    'Route pace & duration formatters format cleanly'
  );

  // 3. GPXTrack synthesis from planned route
  const cyclingTrack = buildGpxTrackFromPlannedRoute({
    waypoints: wps,
    profile: 'cycling',
    customName: 'Isar Feierabendrunde',
    language: 'de',
    options: { cyclingSpeedKmh: 26 }
  });
  assert(
    cyclingTrack !== null &&
      cyclingTrack.name === 'Isar Feierabendrunde' &&
      cyclingTrack.activityType === 'cycling' &&
      cyclingTrack.visible === true &&
      cyclingTrack.distance > 6 &&
      cyclingTrack.points.length > 10,
    'buildGpxTrackFromPlannedRoute builds valid cycling GPXTrack'
  );

  const runningTrack = buildGpxTrackFromPlannedRoute({
    waypoints: wps,
    profile: 'running',
    language: 'en'
  });
  assert(
    runningTrack !== null &&
      runningTrack.activityType === 'running' &&
      runningTrack.name.startsWith('Planned Run'),
    'buildGpxTrackFromPlannedRoute generates localized running fallback title'
  );

  assert(
    buildGpxTrackFromPlannedRoute({ waypoints: [wps[0]], profile: 'cycling' }) === null,
    'buildGpxTrackFromPlannedRoute returns null with fewer than 2 waypoints'
  );

  // 4. OSM Valhalla request validation, payload profiles, polyline6 & elevation math
  const validReq = validateValhallaRouteRequest({
    waypoints: [
      { lat: 48.1351, lng: 11.582 },
      { lat: 48.1642, lng: 11.6056 }
    ],
    profile: 'gravel',
    language: 'en-US'
  });
  assert(
    validReq.ok && validReq.data.profile === 'gravel' && validReq.data.language === 'en-US',
    'validateValhallaRouteRequest accepts valid waypoints, gravel profile, and language'
  );
  assert(
    !validateValhallaRouteRequest({ waypoints: [{ lat: 48.1, lng: 11.5 }], profile: 'road' }).ok,
    'validateValhallaRouteRequest rejects fewer than 2 waypoints'
  );
  assert(
    !validateValhallaRouteRequest({
      waypoints: Array.from({ length: 26 }, (_, i) => ({ lat: 48 + i * 0.001, lng: 11.5 })),
      profile: 'road'
    }).ok,
    'validateValhallaRouteRequest rejects more than 25 waypoints'
  );
  assert(
    !validateValhallaRouteRequest({
      waypoints: [
        { lat: 95, lng: 11.5 },
        { lat: 48.1, lng: 11.6 }
      ],
      profile: 'mtb'
    }).ok,
    'validateValhallaRouteRequest rejects out-of-bounds coordinates'
  );
  assert(
    !validateValhallaRouteRequest({
      waypoints: [
        { lat: 48.1, lng: 11.5 },
        { lat: 48.2, lng: 11.6 }
      ],
      profile: 'helicopter'
    }).ok,
    'validateValhallaRouteRequest rejects unsupported profiles'
  );

  const roadPayload = buildValhallaRoutePayload(wps, 'road', 'de-DE') as any;
  const gravelPayload = buildValhallaRoutePayload(wps, 'gravel', 'de-DE') as any;
  const mtbPayload = buildValhallaRoutePayload(wps, 'mtb', 'de-DE') as any;
  const runPayload = buildValhallaRoutePayload(wps, 'running', 'en-US') as any;
  assert(
    roadPayload.costing === 'bicycle' &&
      roadPayload.costing_options.bicycle.bicycle_type === 'Road' &&
      gravelPayload.costing_options.bicycle.bicycle_type === 'Cross' &&
      mtbPayload.costing_options.bicycle.bicycle_type === 'Mountain' &&
      runPayload.costing === 'pedestrian' &&
      roadPayload.locations[1].type === 'through',
    'buildValhallaRoutePayload maps Road, Gravel, MTB, and Running to exact Valhalla costings'
  );

  // Polyline6 roundtrip check (encode [48.135100, 11.582000] & [48.136100, 11.583000])
  const encodeSigned6 = (val: number) => {
    let v = val < 0 ? ~(val << 1) : val << 1;
    let out = '';
    while (v >= 0x20) {
      out += String.fromCharCode((0x20 | (v & 0x1f)) + 63);
      v >>= 5;
    }
    out += String.fromCharCode(v + 63);
    return out;
  };
  const encodedSample =
    encodeSigned6(48135100) +
    encodeSigned6(11582000) +
    encodeSigned6(1000) +
    encodeSigned6(1000);
  const decodedSample = decodePolyline6(encodedSample);
  assert(
    decodedSample.length === 2 &&
      Math.abs(decodedSample[0].lat - 48.1351) < 1e-6 &&
      Math.abs(decodedSample[1].lng - 11.583) < 1e-6,
    'decodePolyline6 accurately decodes precision-6 Valhalla polylines'
  );
  assert(
    mapValhallaManeuverType(15) === 'left' &&
      mapValhallaManeuverType(10) === 'right' &&
      mapValhallaManeuverType(4) === 'arrive',
    'mapValhallaManeuverType maps Valhalla maneuver codes to semantic turn directions'
  );

  const eleMetrics = computeRouteElevationMetrics([
    { lat: 48.135, lng: 11.58, ele: 500 },
    { lat: 48.136, lng: 11.58, ele: 512 },
    { lat: 48.137, lng: 11.58, ele: 518 },
    { lat: 48.138, lng: 11.58, ele: 505 }
  ]);
  assert(
    eleMetrics.ascentM === 18 && eleMetrics.descentM === 13 && eleMetrics.maxSlope > 5,
    `computeRouteElevationMetrics computes realistic ascent (+${eleMetrics.ascentM}m), descent (-${eleMetrics.descentM}m), and slope`
  );

  // 5. Live GPS Follow-Track math, turn cues & off-route hysteresis
  const lTrackPoints = [
    { lat: 48.135, lng: 11.58, ele: 500 },
    { lat: 48.136, lng: 11.58, ele: 506 },
    { lat: 48.137, lng: 11.58, ele: 512 },
    { lat: 48.138, lng: 11.58, ele: 518 }, // 90 deg right turn here (North -> East)
    { lat: 48.138, lng: 11.582, ele: 525 },
    { lat: 48.138, lng: 11.584, ele: 532 }
  ];
  const syntheticTrack: GPXTrack = {
    id: 'test-live-track',
    name: 'Test L-Route',
    points: lTrackPoints,
    color: '#4f46e5',
    visible: true,
    distance: 0.63,
    ascent: 32,
    descent: 0,
    maxSlope: 6,
    activityType: 'cycling'
  };

  const geoCues = extractGeometricTurnCues(lTrackPoints, 'en');
  assert(
    geoCues.some((c) => c.direction === 'right') &&
      geoCues[geoCues.length - 1]?.direction === 'arrive',
    'extractGeometricTurnCues detects 90-degree right turn and finish arrival cue'
  );
  assert(
    resolveTrackTurnCues(syntheticTrack, 'en').length === geoCues.length &&
      formatTurnDistance(182) === '180 m' &&
      formatTurnDistance(1450) === '1.5 km',
    'resolveTrackTurnCues falls back to geometric cues and formatTurnDistance formats cleanly'
  );

  const onRouteProgress = computeLiveTrackProgress(
    { lat: 48.1355, lng: 11.58, accuracyM: 8, speedKmh: 22 },
    syntheticTrack,
    geoCues,
    { wasOffRoute: false }
  );
  assert(
    onRouteProgress !== null &&
      !onRouteProgress.isOffRoute &&
      onRouteProgress.distanceToTrackM < 5 &&
      onRouteProgress.distanceRemainingKm > 0.5 &&
      onRouteProgress.ascentRemainingM >= 20 &&
      onRouteProgress.nextTurn?.cue.direction === 'right',
    'computeLiveTrackProgress reports on-route remaining distance, ascent, and upcoming right turn'
  );

  const offRouteEnter = computeLiveTrackProgress(
    { lat: 48.1355, lng: 11.581, accuracyM: 10 }, // ~74m East of track (> 45m)
    syntheticTrack,
    geoCues,
    { wasOffRoute: false }
  );
  const offRouteHold = computeLiveTrackProgress(
    { lat: 48.1355, lng: 11.5805, accuracyM: 10 }, // ~37m East of track (between 30m and 45m)
    syntheticTrack,
    geoCues,
    { wasOffRoute: true }
  );
  const offRouteExit = computeLiveTrackProgress(
    { lat: 48.1355, lng: 11.5802, accuracyM: 10 }, // ~15m East of track (< 30m)
    syntheticTrack,
    geoCues,
    { wasOffRoute: true }
  );
  assert(
    OFF_ROUTE_ENTER_METERS === 45 &&
      OFF_ROUTE_EXIT_METERS === 30 &&
      Boolean(offRouteEnter?.isOffRoute) &&
      Boolean(offRouteHold?.isOffRoute) &&
      offRouteExit?.isOffRoute === false,
    'computeLiveTrackProgress enforces off-route enter (>45m) and exit (<30m) hysteresis'
  );

  // 6. Draggable Elevation Bottom Sheet snap math
  assert(
    resolveBottomSheetSnap({ currentSnap: 'standard', deltaY: 10, velocityY: 0.05 }) === 'standard',
    'Small jitter within deadzone preserves current bottom sheet snap'
  );
  assert(
    resolveBottomSheetSnap({ currentSnap: 'mini', deltaY: -80, velocityY: -0.2, viewportHeight: 800 }) ===
      'standard',
    'Upward drag from mini steps cleanly to standard'
  );
  assert(
    resolveBottomSheetSnap({ currentSnap: 'mini', deltaY: -70, velocityY: -0.8, viewportHeight: 800 }) ===
      'expanded',
    'Fast upward flick jumps directly to expanded'
  );
  assert(
    resolveBottomSheetSnap({ currentSnap: 'expanded', deltaY: 85, velocityY: 0.2, viewportHeight: 800 }) ===
      'standard',
    'Moderate downward drag from expanded steps down to standard'
  );
  assert(
    resolveBottomSheetSnap({ currentSnap: 'mini', deltaY: 75, velocityY: 0.25, viewportHeight: 800 }) ===
      'collapsed',
    'Downward drag from mini collapses the bottom sheet'
  );

  // 7. Structural & regression checks for Mobile UI, Valhalla Routing & Live Navigation
  const root = process.cwd();
  const bottomNavSrc = fs.readFileSync(path.join(root, 'components/mobile/MobileBottomNav.tsx'), 'utf8');
  assert(
    bottomNavSrc.includes('mobile-nav-tab-map') &&
      bottomNavSrc.includes('mobile-nav-tab-planned') &&
      bottomNavSrc.includes('mobile-nav-tab-activities') &&
      bottomNavSrc.includes('mobile-nav-tab-dashboard') &&
      bottomNavSrc.includes('mobile-nav-tab-fitness') &&
      bottomNavSrc.includes('min-h-[48px]') &&
      bottomNavSrc.includes('env(safe-area-inset-bottom'),
    'MobileBottomNav renders all 5 primary views with 48px touch targets and safe-area padding'
  );

  const appSrc = fs.readFileSync(path.join(root, 'App.tsx'), 'utf8');
  assert(
    appSrc.includes('<MobileBottomNav') &&
      !appSrc.includes('btn-mobile-nav-switcher') &&
      appSrc.includes('onMobileSheetDragOffset') &&
      appSrc.includes('onSavePlannedRoute={handleSavePlannedRoute}') &&
      appSrc.includes('isLiveNavActive={isLiveNavActive}'),
    'App.tsx wires persistent MobileBottomNav, draggable elevation sheet, Tap-to-Route, and Live GPS Nav'
  );

  const elevationSrc = fs.readFileSync(path.join(root, 'components/ElevationProfile.tsx'), 'utf8');
  assert(
    elevationSrc.includes('id="mobile-elevation-drag-handle"') &&
      elevationSrc.includes('touch-none') &&
      elevationSrc.includes('resolveBottomSheetSnap'),
    'ElevationProfile.tsx provides touch-none pointer-draggable bottom sheet grab handle'
  );

  const serverSrc = fs.readFileSync(path.join(root, 'server.ts'), 'utf8');
  assert(
    serverSrc.includes('app.post("/api/routing/valhalla"') &&
      serverSrc.includes('validateValhallaRouteRequest') &&
      serverSrc.includes('fetchValhallaSnappedRoute'),
    'server.ts exposes validated POST /api/routing/valhalla proxy route'
  );

  const dockSrc = fs.readFileSync(path.join(root, 'components/RoutePlannerDock.tsx'), 'utf8');
  assert(
    dockSrc.includes('btn-route-snap-toggle') &&
      dockSrc.includes("id: 'road'") &&
      dockSrc.includes("id: 'gravel'") &&
      dockSrc.includes("id: 'mtb'") &&
      dockSrc.includes("id: 'running'"),
    'RoutePlannerDock renders 4 sport profiles and Road Snap vs Direct toggle'
  );

  const mapSrc = fs.readFileSync(path.join(root, 'components/Map.tsx'), 'utf8');
  assert(
    mapSrc.includes('RoutePlannerClickBridge') &&
      mapSrc.includes('<RoutePlannerDock') &&
      mapSrc.includes('id="btn-map-route-planner"') &&
      mapSrc.includes('/api/routing/valhalla') &&
      mapSrc.includes('<LiveNavigationHUD') &&
      mapSrc.includes('watchPosition') &&
      mapSrc.includes('wakeLock'),
    'Map.tsx integrates Valhalla road snapping, Live GPS watchPosition, Wake Lock, and LiveNavigationHUD'
  );

  const hudSrc = fs.readFileSync(path.join(root, 'components/mobile/LiveNavigationHUD.tsx'), 'utf8');
  assert(
    hudSrc.includes('live-nav-top-banner') &&
      hudSrc.includes('live-nav-off-route-banner') &&
      hudSrc.includes('btn-live-nav-autocenter') &&
      hudSrc.includes('btn-live-nav-stop') &&
      !hudSrc.includes('dangerouslySetInnerHTML'),
    'LiveNavigationHUD renders turn cues, off-route alert, auto-center, and stop controls safely without raw HTML injection'
  );

  const thumbBarSrc = fs.readFileSync(path.join(root, 'components/mobile/MobileThumbBar.tsx'), 'utf8');
  const sidebarSrc = fs.readFileSync(path.join(root, 'components/Sidebar.tsx'), 'utf8');
  assert(
    appSrc.includes('mobileSheetContainerRef') &&
      appSrc.includes('translate3d(0,') &&
      !appSrc.includes('setMobileSheetDragOffset'),
    'App.tsx drives mobile bottom-sheet drag via direct GPU translate3d ref without triggering React re-renders'
  );
  assert(
    mapSrc.includes('React.memo(Map)') &&
      elevationSrc.includes('React.memo(ElevationProfile)') &&
      sidebarSrc.includes('React.memo(Sidebar)') &&
      !mapSrc.includes('animate-ping'),
    'Heavy map/elevation/sidebar views are memoized and map start marker avoids infinite animate-ping GPU burn'
  );
  assert(
    !bottomNavSrc.includes('backdrop-blur-xl') &&
      !thumbBarSrc.includes('backdrop-blur-xl') &&
      !sidebarSrc.includes('backdrop-blur-sm'),
    'Mobile navigation bars and sidebar scrim avoid heavy GPU backdrop-blur readbacks'
  );

  const cssSrc = fs.readFileSync(path.join(root, 'index.css'), 'utf8');
  assert(
    cssSrc.includes('.map-overlay-layer') &&
      cssSrc.includes('will-change: transform, opacity') &&
      cssSrc.includes('translate3d(0, 0, 0)') &&
      cssSrc.includes('.map-gpu-host.map-interacting') &&
      mapSrc.includes('MapInteractionCompositorBridge') &&
      mapSrc.includes('map-gpu-host') &&
      mapSrc.includes('map-overlay-layer') &&
      dockSrc.includes('map-overlay-layer') &&
      hudSrc.includes('map-overlay-layer'),
    'Map overlays use CSS will-change, GPU translate3d transforms, and non-blocking interaction compositing'
  );

  console.log(`\n📊 Mobile UI, Routing & Live GPS Results: ${passed} passed, ${failed} failed\n`);
  return failed === 0;
}

