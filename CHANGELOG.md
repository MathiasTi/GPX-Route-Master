# Changelog

All notable changes to **GPX Route Master** are documented in this file.

The project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [2.5.2] - 2026-08-14

### Foldable Workspace Activity Cards
- **Foldable Activities Overview**: Set activity tracks in the workspace sidebar to be collapsed/folded by default, showing a concise high-level summary bar (Distance, Elevation Gain, Duration, Climbs) for a cleaner workspace overview.
- **Interactive Accordion Details**: Added intuitive chevron expansion toggle to unfold in-depth telemetry stats, bento grid metrics, heart rate/power distribution, OpenStreetMap surface analysis, and split/trim action controls on demand.

---

## [2.5.1] - 2026-08-14

### Map & Elevation Profile Marker Cleanup
- **Map Viewport De-cluttering**: Removed "Zeitlücke" time gap pins on the primary Leaflet map surface while keeping the dedicated Zeitlücken-Analyse tools accessible via modal and sidebar.
- **Elevation Profile Simplification**: Removed the "Neuen POI Marker erstellen" overlay and button from the elevation profile chart controls.

---

## [2.5.0] - 2026-08-14

### Architecture & Responsiveness Overhaul
- **Debounced Local Persistence**: Replaced synchronous heavy state writes in `localStorage` with a debounced persistence engine to prevent main-thread UI stutter on rapid route modifications or large track imports.
- **Elevation Profile Memoization & ResizeObserver Debounce**: Optimized multi-series rendering (Elevation, Watts, HR, Slope, Speed, Cadence) with memoized SVG path computations and `requestAnimationFrame` debounced `ResizeObserver` callbacks to eradicate layout thrashing.
- **Mobile & Tablet Responsive Layout**:
  - Implemented dynamic elevation profile sizing (`h-44 sm:h-48 md:h-56`) ensuring the map viewport retains prominent visibility across mobile handsets.
  - Standardized touch target sizes (minimum 44x44px hit-areas) for track actions, legend toggles, and floating HUD controls without requiring desktop hover.
  - Added safe responsive boundaries to modals (`max-h-[90vh] sm:max-h-[85vh]`) with smooth vertical momentum scrolling.
- **Leaflet Dynamic Container Resizer**: Enhanced `MapResizer` to track container dimensions, orientation changes, and split-pane toggles, preventing blank/gray tile clipping.
- **Architecture Documentation & ADRs**: Created comprehensive Mermaid system diagrams and four formal Architecture Decision Records (ADRs) covering RDP downsampling, modular state management, responsive design, and database self-healing.
- **Automated Verification**: Added comprehensive unit and integration tests in `tests/responsiveAndPerformance.test.ts` validating downsampling, rate-limiting, and responsiveness.

---

## [2.4.4] - 2026-08-14

### Startup Track Framing & Multi-Point Weather Engine
- **Startup Track Framing**: Automatic camera centering and bounding on the first available workspace track on app boot.
- **Multi-Point Weather Forecast**: Integrated 3-point weather forecasting (Start, Summit, End) querying live Open-Meteo APIs with offline fallback simulation.
- **Climb Zoom Interactivity**: Added one-click map focus on climb segments directly from the elevation profile and active track overlay.

---

## [2.4.0] - 2026-08-10

### Surface Heatmaps & Overpass OSM Integration
- Real-time road and trail surface classification (Asphalt, Schotter, Waldweg, Kopfsteinpflaster) using Overpass OSM API.
- Surface color-coded polyline maps with interactive segment inspection and legend breakdown.

---

## [2.0.0] - 2026-07-20

### Garmin Health SQLite & FIT Activity Engine
- Integrated SQLite database ingestion for Garmin Health metrics (Sleep, Stress, Body Composition, Resting Heart Rate, Steps).
- Multi-track timeline synchronization and power/cadence telemetry overlays.
- PWA offline caching with dedicated Service Worker.

---

## [1.0.0] - 2026-05-15

### Initial Release
- Multi-track GPX parsing, merging, splitting, and reordering with drag-and-drop.
- 2D interactive elevation profiles with crosshair cursor synchronization.
- Leaflet map layers (OpenStreetMap, Topo, Satellite, Dark mode).
