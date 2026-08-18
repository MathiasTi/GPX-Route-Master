# Changelog

All notable changes to **GPX Route Master** are documented in this file.

The project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [2.7.8] - 2026-08-18

### Sport-Metriken Glossar & Interaktive Rechner (VAM, TSS, FTP, EF, VI, PMC)
- **Sport-Metriken Glossar & Wissensdatenbank (`components/SportMetricsGlossaryModal.tsx`)**:
  - Wissenschaftlich fundiertes und detailliertes Nachschlagewerk für alle zentralen Leistungs-, Berg- und Physiologiemetriken im Ausdauersport:
    - **Bergsteigen & Klettern**: VAM (Velocità Ascensionale Media in m/h), Gradient / Steigung (%), UCI & TdF Climb Categories (HC, Kat 1–4).
    - **Leistung & Power**: FTP (Functional Threshold Power in W & W/kg), NP (Normalized Power in Watt), Max/Avg Power.
    - **Trainingsbelastung & PMC**: TSS (Training Stress Score), IF (Intensity Factor), VI (Variability Index), CTL (Fitness / Chronic Training Load), ATL (Ermüdung / Acute Training Load), TSB (Form / Training Stress Balance).
    - **Cardio & Stoffwechsel**: VO2max (Maximale Sauerstoffaufnahme in ml/kg/min), EF (Efficiency Factor in W/bpm), Pw:HR (Aerobe Entkopplung / Decoupling in %), HRmax & Ruhepuls.
    - **Ernährung & Energetik**: Mechanische Arbeit (kJ), Kalorienverbrauch (kcal), Kohlenhydrate (g/h), Flüssigkeits- & Natriumbedarf.
  - **Umfassende Detailansichten**:
    - Mathematische Formeln und physiologische Grundlagen.
    - Benchmarks & Richtwerte vom Hobbysportler über ambitionierte Amateure bis hin zu WorldTour-Profis.
    - Interpretation, Belastungssteuerung und konkrete Praxistipps für Training und Wettkampf.
    - Suchfunktion mit Live-Filterung und Kategorien-Tabs.
- **4 Interaktive Sportwissenschaftliche Simulatoren & Rechner**:
  - **VAM & Steigleistung-Rechner**: Berechnung der Steigrate in Höhenmetern pro Stunde mit physiologischer Leistungs-Einstufung.
  - **TSS & Intensity Factor Rechner**: Direkte Kalkulation von TSS und IF für gegebene Dauer, FTP und Normalized Power inkl. Erholungszeit-Prognose.
  - **Pacing & Variabilitäts-Rechner (VI)**: Analyse der Gleichmäßigkeit des Krafteinsatzes bei Zeitfahren vs. Kriterium/Gran Fondo.
  - **UCI Bergwertungs-Klassifikator**: Automatische Einstufung von Anstiegen (HC, Kat 1, 2, 3, 4) anhand von Länge, Höhenmetern und Durchschnittssteigung.
- **Nahtlose UI-Integration**:
  - Neuer prominenter Button in der Seitenleiste (`components/Sidebar.tsx`) unter *Werkzeuge & Analyse*.
  - Schnellzugriff-Button direkt in der Intensiven Streckenanalyse (`components/IntensiveTrackAnalysisModal.tsx`).
  - Vollständige Tastatursteuerung (`Escape`-Taste zum Schließen) und barrierefreies modales Overlay.
- **Automatisierte Testsuite (`tests/sportMetricsGlossary.test.ts`)**:
  - 14 automatisierte Tests zur Validierung aller Berechnungsformeln (VAM, TSS, IF, VI, EF, Decoupling, Climb Score), Benchmark-Integrität und Suchfilterung. Gesamte Testsuite (220 Tests) läuft zu 100% grün.

---

## [2.7.7] - 2026-08-18

### 3D Terrain Hover-Preview & Instantaneous Slope Readout HUD
- **3D-Terrain Hover-Vorschau in der Seitenleiste (`components/TerrainHoverPreview3D.tsx`)**:
  - Nahtlose Einbettung eines 3D-MapLibre GL Raster-DEM-Kartenfensters direkt in die Seitenleiste (`components/Sidebar.tsx`).
  - **Echtzeit-Synchronisierung mit dem Höhenprofil**: Beim Überfahren des Höhenprofils mit der Maus oder per Touch (`ElevationProfile.tsx`) wird die Kameraansicht mit weichen Übergängen (`easeTo`) zentriert auf die Koordinate ausgerichtet und der Blickwinkel entlang der Streckenrichtung (Kompass-Bearing) ausgerichtet.
  - **Instantaneous Slope & Altitude HUD**:
    - Sofortige Berechnung der Momentansteigung am Cursor: $\text{slope} = \frac{\Delta\text{ele}}{\Delta\text{dist}} \times 100$.
    - Farbkodiertes Steigungs-Badge mit dynamischer Klassifizierung (Flach, Mäßiger Anstieg, Steilanstieg, Extrem-Rampe, Gefälle, Steilabfahrt).
    - Direkte Anzeige von Höhe ü.NN, Entfernung zum Start, Kompassausrichtung und aktuellem Untergrund (OSM).
    - Dynamische Sensor-Telemetrie für Leistung (Watt), Puls (bpm), Trittfrequenz (rpm) und Geschwindigkeit (km/h).
  - **Interaktive Geländesteuerung**:
    - Umschalten von Kamera-Neigung (Pitch: 30° / 60° / 75°).
    - Konfigurierbare Höhenüberhöhung (Terrain Exaggeration: 1.0x / 1.8x / 2.5x).
    - Umschalten zwischen Satelliten- und Outdoor-Topographie-Kartenstilen.
    - 1-Klick Fokus-Button zur Ausrichtung der Hauptkarte auf die aktuelle Position.
- **Erweiterte Datenmodelle & Callbacks (`types.ts`, `ElevationProfile.tsx`)**:
  - Erweiterung des `GPXPoint`-Modells um optionale `slope`- und `dist`-Felder.
  - Ergänzung der `onHoverPoint`-Payloads in Maus- und Touch-Event-Handlern.
- **Automatisierte Testsuite (`tests/terrainHoverPreview.test.ts`)**:
  - 15 dedizierte Unit-Tests für Momentansteigung, Kompasspeilung, Steigungskategorien und Telemetrie-Extraktion. Alle 206 Tests laufen zu 100% grün (`npm test`).

---

## [2.7.6] - 2026-08-18

### Security Hardening, Vulnerability Audit & Defense-in-Depth
- **Umfassender Sicherheits-Audit aller Server-Endpunkte (`server.ts`)**:
  - **Erweiterte HTTP-Sicherheitsheader**: `X-Content-Type-Options: nosniff`, `X-XSS-Protection: 1; mode=block`, `Referrer-Policy: strict-origin-when-cross-origin` und `Permissions-Policy: camera=(), microphone=()`.
  - **CORS & Origin-Sanitisierung**: Bereinigung des `Origin`-Headers gegen CRLF-Injection / Header-Splitting und saubere Trennung von Wildcard- vs. Credential-Handling in sandboxed Iframes.
  - **JSON-Parser Fehlertoleranz**: Eigener Express-Fehler-Handler für Syntaxfehler bei fehlerhaften JSON-Payloads zur Vermeidung von sensiblen Stacktrace-Leaks.
  - **Path Traversal & Datei-Schutz (`validateWorkspaceFilePath`)**:
    - Strikte Erweiterungs-Whitelist (`.db`, `.sqlite`, `.sqlite3`, `.fit`, `.gpx`, `.json`, `.csv`).
    - Schutz sensibler Konfigurations- und Systemdateien (`.env`, `package.json`, `server.ts`, `.git/`, `.aistudio/`, `data/gpx_library.db`).
    - Schutz gegen Null-Byte-Injection (`\0`) und Pfadlängenbegrenzung.
  - **Verzeichnis-Scan-Schutz (`scanLocalDbs`)**:
    - Ignoriert versteckte Dateien/Ordner (`.*`), Systemordner (`node_modules`, `dist`) und die interne Anwendungsdatenbank (`gpx_library.db`).
  - **Eingabevalidierung & Bounds-Enforcement**:
    - Strikte Längen- und Typvalidierung für Track-IDs, Namen, Beschreibungen, Tags und Punktezahlen auf `/api/library`, `/api/analyze-surface`, `/api/intensive-analysis`, `/api/versions` und `/api/settings`.
    - Sanitisierung und Begrenzung von Track-Metadaten vor der Übergabe an externe AI-Prompts.
- **Datenbank & Prototype Pollution Schutz (`utils/db.ts`)**:
  - `getAllSettings`, `saveSetting` und `getSetting` blockieren `__proto__`, `constructor` und `prototype` Keys und verwenden `Object.create(null)` für saubere Wörterbücher.
  - Begrenzung von Suchstring-Längen in `searchTracks` und `searchGarminActivities`.
- **Client-Side Link-Validierung (`components/WeatherOverlay.tsx`)**:
  - Externe Datenquellen-Links werden auf striktes `https://`-Protokoll validiert.
- **Automatisierte Sicherheits-Testsuite (`tests/security.test.ts`)**:
  - 7 dedizierte Sicherheits-Regressionstests für Prototype Pollution, Pfadvalidierung, SQL-Injection-Resistenz, GPS-Datenintegrität und Begrenzung von Suchfeldern. Alle 191 Tests laufen zu 100% grün (`npm test`).

---

## [2.7.5] - 2026-08-18

### Real-World Reference Benchmark Test Suite & Scientific Model Verification
- **Automatisierte Referenz-Testsuite für reale Strecken & Pässe (`tests/realWorldBenchmarks.test.ts`)**:
  - Implementierung von realen Referenz-Benchmarks mit exakter geodätischer und physikalischer Verifikation:
    - **Monumentale HC-Pässe**: Alpe d'Huez (13,8 km, +1.110 Hm, 8,04% Ø-Steigung), Passo dello Stelvio (24,3 km, +1.808 Hm, 7,44% Ø-Steigung) und Col de la Madeleine (19,2 km, +1.520 Hm, 7,92% Ø-Steigung). Verifikation von HC-Einstufung (`score >= 200`), VAM-Steigleistung (~800–1.400 m/h) und Farbzuweisung (`#9333ea`).
    - **Gestaffelte Bergkategorien**: Vollständige Testabdeckung der Klassifizierungsstufen Kategorie 1 (Kategorie-1-Pass, Score ~172 $\ge$ 120), Kategorie 2 (Kategorie-2-Anstieg, Score ~91 $\ge$ 50), Kategorie 3 (Kategorie-3-Hügel, Score ~36 $\ge$ 20) und Kategorie 4 (Kategorie-4-Rampe, Score ~13 < 20).
    - **Geodätische Haversine-Referenzstrecken**: Validierung gegen reale GPS-Geodäten (München Marienplatz nach Garmisch-Partenkirchen mit 80,20 km, Berlin Brandenburger Tor nach Potsdam Sanssouci mit 26,14 km, sowie 1°-Meridian- und Breitenkreis-Schritte).
    - **Multi-Pass Königsetappen-Isolation**: Verifikation der Pass- und Talerkennung bei aufeinanderfolgenden Alpenpässen ohne Pass-Verschmelzung oder vorzeitigen Abbruch.
    - **Aerodynamik- & Energie-Physikmodell**: Validierung des $P_{\text{aero}} + P_{\text{roll}}$-Modells bei 40 km/h Einzelzeitfahren (~340 W mechanische Leistung, 1.286 kJ Arbeit) sowie 10-km-Laufbelastungen (~730 kcal für 70 kg Läufer).
- **Physikalische Kalorienbereinigung in `utils/intensiveAnalysis.ts`**:
  - Korrektur der metabolischen Energieformel zur Vermeidung doppelter Zählung von Höhengewinn-Arbeit bei integrierter Pedal-Wattmessung.
- **100% Grüne Testsuite**:
  - Sämtliche 184 Unit- und Benchmark-Tests in allen 7 Testsuiten laufen vollständig automatisiert grün durch (`npm test`).

---

## [2.7.4] - 2026-08-18

### Farbige Anstiegsmarkierung im Höhenprofil der Intensiven Streckenanalyse
- **Visuelle Segment-Hervorhebung im Höhenprofil (`IntensiveElevationChart`)**:
  - Im Höhenprofil der Intensiven Streckenanalyse werden alle identifizierten Bergwertungen und Anstiege visuell mit farbigen Bändern (`ReferenceArea`) und Start-/Gipfellinien (`ReferenceLine`) hervorgehoben.
  - Farbkodierung entsprechend den offiziellen Bergkategorien:
    - **HC (Hors Catégorie)**: Violett (`#9333ea`)
    - **Kategorie 1**: Tiefrot (`#e11d48`)
    - **Kategorie 2**: Orange (`#f97316`)
    - **Kategorie 3**: Bernstein/Gelb (`#f59e0b`)
    - **Kategorie 4**: Blau (`#3b82f6`)
    - **Unkategorisiert**: Smaragdgrün (`#10b981`)
- **Interaktive Tooltips & Synchronisation**:
  - Maßgeschneiderter Chart-Tooltip (`CustomElevationTooltip`), der beim Hovern über Anstiege detaillierte Metriken (Kategorie-Badge, Höhengewinn in Hm, Ø-Steigung, Maximal-Rampe, VAM-Steigrate und Kilometerabschnitt) anzeigt.
  - Interaktive Anstiegs-Schnellwahl-Chips unterhalb des Diagramms zur selektiven Markierung einzelner Anstiege mit optischer Fokus-Umrandung.
  - Nahtlose Verknüpfung zwischen Höhenprofil und Einzelanstiegs-Karten im Reiter "Anstiege": Klick auf eine Anstiegskarte hebt den jeweiligen Abschnitt im Höhenprofil hervor und umgekehrt.
  - Integrierter Schalter zum flexiblen Ein- und Ausblenden der farbigen Markierungen ("Anstiege aktiv" / "Anstiege ausblenden") sowie integrierte Kategorie-Farblegende.
- **Automatisierte Verifikation**:
  - Unit-Tests in `tests/intensiveAnalysis.test.ts` erweitert zur Verifikation der Kategorie-Hex-Farben und korrekten Zuweisung in den Analyse-Ergebnissen.

---

## [2.7.3] - 2026-08-18

### Intensive Streckenanalyse: Anstiegs- & Bergwertungs-Integration & Z-Index-Korrektur
- **Bergwertungen & Anstiegs-Fokus in der Intensiven Streckenanalyse**:
  - Vollständige Integration von Bergwertungen (`findClimbs`) und Klassifizierungen (HC, Cat 1, Cat 2, Cat 3, Cat 4, Uncategorized) in die Intensive Streckenanalyse (`utils/intensiveAnalysis.ts`).
  - Neuer Reiter **"Anstiege & Bergwertungen"** im Modal mit aggregierten KPI-Karten (Höhenmeter in Anstiegen, Bergauf-Distanz, steilste Rampe, VAM-Steigleistung) und detaillierten Einzelanstiegs-Karten.
  - Berechnete Metriken pro Anstieg: Start-/Gipfelhöhe, Distanz, Höhengewinn, Durchschnitts- und Maximalsteigung, VAM (m/h), geschätzte Fahrzeit und Wattprognose.
  - Interaktive Steuerungen: 1-Click-Kartenzentrierung & Zoom auf den gewählten Anstieg sowie POI-Wegpunkt-Setzen für Start- und Gipfelpunkte.
  - Übersichtliche Bergwertungs-Vorschau in der Hauptübersicht ("Fahrzeit & Physis") mit Schnellzugriff auf alle erkannten Anstiege.
- **Z-Index Layering Korrektur**:
  - Modal-Z-Index auf `z-[2000]` und Backdrop auf `z-[1990]` angehoben, um Überlappungen mit der Kartenlegende (`z-[400]`), dem linken Sidebar-Einklapp-Button (`z-[400]`) und Leaflet-Steuerelementen zuverlässig zu verhindern.
- **Automatisierte Tests**:
  - Erweiterte Testfälle in `tests/intensiveAnalysis.test.ts` zur Validierung der Anstiegserkennung, VAM-Berechnung, Höhensummen und Leistungsabschätzungen.

---

## [2.7.2] - 2026-08-18

### Elevation Anomaly Auto-Repair & Peak-Preserving Savitzky-Golay Filtering
- **Automated Anomaly Repair Engine**: Implemented `repairGradientAnomalies` and `repairTrackGradientAnomalies` utilizing distance-weighted monotonic smoothstep interpolation across barometric cliff jumps and artificial needle summit spikes. Automatically recalculates elevation stats, climb categories, and power models.
- **Peak-Preserving Multi-Stage Noise Filter**: Implemented `filterElevationProfile` and `applyElevationFilterToTrack` with moving-median and distance-weighted Gaussian / Savitzky-Golay smoothing. Features prominence thresholding (≥2.0m) to preserve true mountain summits and passes while eliminating barometric sensor jitter.
- **Interactive Elevation Profile Integration**:
  - Added one-click **"Auto-Reparieren"** buttons to the anomaly counter badge and the interactive anomaly diagnostic inspection popover.
  - Added **Höhenfilter-Regler** (Off, Light, Medium, Alpine) to the elevation profile settings popover with a one-click *"Filter dauerhaft in Track sichern"* action.
  - Integrated direct **OSM-Oberflächenanalyse** trigger button inside the profile settings popover.
- **Automated Verification**: Added comprehensive unit tests in `tests/gradientAnomaly.test.ts` verifying cliff jump repair, summit needle attenuation, metric recalculation, and peak-preserving noise filtering (total suite: 141 tests passing 100% green).

---

## [2.7.1] - 2026-08-17

### Impossible Gradient & Bad Summit Elevation Anomaly Detection Overlay
- **Physics & Gradient Anomaly Engine**: Implemented `detectImpossibleGradientAnomalies` algorithm analyzing track points for severe barometric cliffs (gradients > 40–50% over short distances) and needle summit anomalies (instantaneous gradient reversals > 55% over ≤200m).
- **Interactive SVG Warning Overlays**: Added rose-striped warning columns (`#warning-stripe`), dashed perimeter highlight frames, and pulsing peak indicators across the SVG elevation graph.
- **Top-Margin Quick-Jump Pills & Diagnostic Popovers**: Interactive anomaly pills (`Δ +XX%`) and rich inspection cards detailing location span, calculated gradient, and vertical shift with one-click map synchronization.
- **Profile Controls & Summary Counter**: Added "Warnungen" toggle checkbox in profile header with dynamic anomaly count badge and top-bar alert button.
- **Automated Verification**: Added 7 unit tests in `tests/gradientAnomaly.test.ts` covering clean tracks, cliff spikes, needle summit identification, and edge cases.

---

## [2.7.0] - 2026-08-17

### Pan-To & Track Cycling Keyboard Navigation
- **Point Pan Shortcut ('M')**: Centers map instantly on the currently hovered elevation trackpoint preserving zoom level.
- **Track Cycling Shortcut ('C')**: Cycles sequentially through visible tracks with automatic viewport bounding box recalculation.

---

## [2.6.1] - 2026-08-17

### Intensive Analysis Modal Lifecycle & AnimatePresence Fix
- **Motion Component Integration**: Standardized `IntensiveTrackAnalysisModal` to utilize `motion.div` root with smooth entrance and exit transitions (`initial={{ opacity: 0 }}`, `animate={{ opacity: 1 }}`, `exit={{ opacity: 0 }}`) matching other modal dialogues.
- **AnimatePresence Key Stability**: Fixed React 19 dispatcher conflict caused by unkeyed modal measuring in `AnimatePresence` by declaring explicit stable keying and native backdrop click handling.
- **Keyboard & Body Scroll Management**: Added Escape key shortcut handling and automatic body overflow locking on mount with cleanup on unmount.
- **Type Signature Resolution**: Corrected POI marker schema assignment (`label` mapping) and added optional server enrichment properties to `IntensiveAnalysisResult`.
- **Test Suite Verification**: Fixed `time` Date type compatibility in unit tests; all 88 unit tests across the entire suite pass 100% clean.

---

## [2.6.0] - 2026-08-15

### Intensive Streckenanalyse & Pacing Pro
- **Physics-Based Speed & Duration Modeling**: Deterministic aerodynamic, gravitational, and rolling-resistance engine for cycling (FTP/Watt-based) and slope-energy cost running algorithms (Minetti model).
- **Metabolism, Calorie & Nutrition Calculator**: Accurately computes total energy expenditure (kcal), carbohydrate/fat oxidation split, hourly carb intake guidelines (g/h), and sweat/hydration requirements (L) adjusted for temperature.
- **Stage Splits & Terrain Segmentation**: Generates dynamic 2km/5km/10km stage tables detailing split elevation gain, average gradients, digital split durations, and terrain classification badges.
- **Tactical Guidance & Caution Zones**: Automated tactical tips for pacing, climbing cadences, gear/braking checks, hydration intervals, and identified mountain caution zones.
- **Interactive POI Keypoint Integration**: Automatically spots track summits, halfway points, and rest stations, with one-click injection into custom map markers.
- **Automated Verification**: Added 16 new automated unit tests in `tests/intensiveAnalysis.test.ts` bringing total test suite to 88 passing tests (100% GREEN).

---

## [2.5.4] - 2026-08-14

### Full-Stack Architecture Hardening & System Stability
- **SQLite Performance & Concurrency Pragmas**: Configured `WAL` (Write-Ahead Logging), `synchronous = NORMAL`, `busy_timeout = 5000ms`, `temp_store = MEMORY`, and dedicated cache buffers for fast, corruption-immune database read/write operations.
- **Graceful Process Shutdown**: Implemented `SIGTERM` and `SIGINT` signal listeners on the Express backend ensuring SQLite database handles close cleanly during container restarts, updates, or scaling events.
- **Global Backend Exception Shielding**: Added top-level API error handling middleware preventing uncaught async rejections from terminating server processes and ensuring standard structured JSON responses.
- **Top-Level React Error Boundary & Rescue Flow**: Wrapped application root in `ErrorBoundary` with instant state recovery and one-click JSON rescue data export.
- **Storage Quota & Payload Sanitization Architecture**: Created `/utils/storage.ts` with progressive payload optimization and quota exceeded handling to prevent browser localStorage exceptions on large multi-track imports.
- **Automated Stability Test Suite**: Added dedicated unit tests in `tests/storageAndArchitecture.test.ts` validating sanitization, storage fallbacks, and schema protection.

---

## [2.5.3] - 2026-08-14

### Master Fold/Unfold Toggle & One-Click Route Reversal
- **Master Fold / Unfold All**: Added global header toggle button in the Workspace sidebar tab allowing instant expansion or collapse of all loaded activities simultaneously.
- **Route Direction Reversal Tool**: Integrated a one-click route inversion feature that flips track direction, preserves forward chronological time sequences, recalculates ascent/descent, and updates power/climb metrics.
- **Enhanced Test Coverage**: Added automated unit tests verifying track reversal mechanics, coordinates inversion, and name suffix handling.

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
