# GPX Route Master

**GPX Route Master** is a full-stack endurance sports, GPS route analysis, and Garmin health telemetry platform built with **React 19**, **Express**, **SQLite (WAL + FTS5)**, **Leaflet**, **MapLibre GL 3D**, and **Recharts**.

It combines an interactive 2D/3D GPX & FIT workspace, a Komoot-style Planned Tours library, a high-speed Activities Archive & Activities Dashboard, and a Garmin Fitness & Health Cockpit with bilingual **German / English (`DE` / `EN`)** support and **6 selectable UI style themes**.

---

## Key Features

### 1. Interactive 2D/3D Map & Route Workspace
- **GPX, FIT & ZIP Import**: Streamed XML & binary FIT decoding (`utils/gpxUtils.ts`, `utils/fitUtils.ts`) with unfinalized FIT repair, pause/gap detection (`computeActiveTrackStats`), and duplicate detection.
- **2D & 3D Map Engines**: Leaflet (OpenStreetMap, OpenTopoMap, Esri Satellite) and MapLibre GL 3D terrain with dynamic route framing (`fit-active-track`) and 3D flyover video export (`VideoExportModal.tsx`).
- **Dual-Track Map Comparison**: Load and compare any two tracks directly on the map and in side-by-side elevation/telemetry analytics (`TrackComparison.tsx`).
- **Elevation Profile & Surface Analysis**: Decoupled SVG/HTML elevation chart (`ElevationProfile.tsx`) with climb classification, time-gap splitting/closing, gradient repair, and OpenStreetMap Overpass surface breakdown.
- **Multi-Point Route Weather**: Live Open-Meteo forecasts, ERA5 historical archives, and offline terrain climate fallback across Start, Summit, and Finish waypoints (`WeatherOverlay.tsx`).

### 2. Planned Tours, Activities Archive & Activities Dashboard
- **Planned Tours (`Geplante Touren` / `Planned Tours`)**: Dedicated Komoot-style tour library (`PlannedToursView.tsx`) with solo/batch workspace loading, quick removal, and 2-track comparison.
- **Activities Archive (`Aktivitäten` / `Activities`)**: FTS5-indexed SQLite catalog (`activities_catalog`) supporting instant filtering by sport, country, month, and search query (`ActivitiesManagerView.tsx`).
- **Activities Dashboard (`Aktivitäten-Dashboard` / `Activities Dashboard`)**: Interactive Week / Month / Year / All-Time breakdown (`ActivitiesDashboardView.tsx`) of distance, elevation gain, VAM (calculated over climbing duration), moving speed, heart rate, active days, streaks, and top performances.

### 3. Fitness & Health Cockpit (`Fitness & Gesundheit` / `Fitness & Health`)
- **Health Cockpit (`GarminDashboard.tsx`)**: Readiness score, resting heart rate (RHR), sleep architecture & trends, step tracking, stress, 365-day activity heatmap, 5-axis Athlete Radar, and Personal Records.
- **Performance & Form (`FitnessPerformanceAnalysis.tsx`)**: Server-side precomputed 1 Hz power telemetry (`computePowerTelemetry`: Normalized Power, Variability Index, and `1s`–`1h` Mean Maximal Power curve peaks), Banister CTL/ATL/TSB fitness-fatigue modeling, and Coggan/Vance training zones.
- **Training Load & ACWR (`server.ts`)**: Calendar-aligned 4-week chronic baseline, rolling 7d/28d Acute-to-Chronic Workload Ratio, HR intensity zones, and aerobic efficiency trends.

### 4. Settings, Languages (`DE` / `EN`) & 6 UI Style Themes
- **Settings Modal (`AppSettingsModal.tsx`, shortcut `,`)**:
  - **UI Styles & Theme**: Choose from **Velo Royal**, **Aero Glass**, **Peloton Pro**, **Alpine Trail**, **Cyber Telemetry**, and **Nordic Minimal**, plus **Light / Dark / System** mode, **UI Density** (Compact / Normal / Spacious), **Corner Radius** (Sharp / Rounded / Soft Pill), and reduced-motion toggle.
  - **Language & Units**: 1-click **Deutsch (`DE`) ↔ English (`EN`)** toggle in the top bar and measurement unit preferences (**Metric** / **Imperial**).
  - **Athlete Profile**: FTP (`W` & live `W/kg`), body weight, bike/gear weight, age, max HR (with `220 − Age` and Tanaka formulas), resting HR baseline, and default touring speed.
  - **Workspace Defaults**: Default start page, default map layer, auto-fit on load, default elevation profile state, automatic OSM surface analysis, and mobile haptic feedback — persisted in both `localStorage` and SQLite (`/api/settings`).

---

## Tech Stack

| Layer | Technologies |
| :--- | :--- |
| **Frontend** | React 19, TypeScript, Vite 6, Tailwind CSS v4, Motion, Lucide React |
| **Mapping & Charts** | Leaflet, React-Leaflet, MapLibre GL, React-Map-GL, Three.js, Recharts |
| **Backend** | Node.js, Express 5, `tsx`, `esbuild` |
| **Database** | `better-sqlite3` (WAL mode, FTS5 full-text search, automatic schema migrations) |
| **File Processing** | `fit-decoder`, `fflate`, custom GPX/FIT parsers & RDP spatial downsampling |

---

## Getting Started

### Prerequisites
- **Node.js** (v20+ recommended)
- **npm**

### Quick Start (Recommended)

```bash
# Start local development server (automatically installs dependencies & initializes SQLite DB)
bash start-local.sh
```

By default, the app starts on `http://localhost:3000` (or the next available port if configured via `PORT`) and initializes the local database at `data/gpx_library.db`.

### Available Commands

| Command | Description |
| :--- | :--- |
| `bash start-local.sh` | Install dependencies if needed, run DB migrations, and launch the full-stack server |
| `bash start-local.sh --test` | Run `tsc --noEmit` typechecking and the complete automated test suite (`scripts/runTests.ts`) |
| `npm run dev` | Start Express + Vite dev middleware directly via `tsx server.ts` |
| `npm run build` | Build production frontend (`vite build`) and bundle backend (`dist/server.cjs`) |
| `npm start` | Run the production bundle (`node dist/server.cjs`) |
| `npm run lint` | Run TypeScript compiler typecheck (`tsc --noEmit`) |
| `npm test` | Execute all test suites (`tsx scripts/runTests.ts`) |

---

## Keyboard Shortcuts

| Key | Action |
| :--- | :--- |
| `,` | Open Settings, Language & UI Styles modal |
| `?` or `F1` | Open Keyboard Shortcuts help |
| `3` | Toggle 2D / 3D Terrain map mode |
| `P` | Toggle Fitness & Health Cockpit |
| `A` or `I` | Open Intensive Track Analysis modal |
| `G` | Open Sports Metrics Glossary & Calculators |
| `W` | Open Route Weather Forecast |
| `C` | Cycle & frame visible tracks on map |
| `M` | Focus map on currently hovered elevation point |
| `+` / `-` | Zoom map in / out |
| `←` / `→` | Step along active track points (or pan map) |
| `Ctrl/Cmd + S` | Save marked track to SQLite library |
| `Ctrl/Cmd + Z` | Undo last workspace track edit |
| `Esc` | Close active modal or clear selection |

---

## Project Structure

```text
├── App.tsx                       # Root SPA shell, navigation, state & SQLite settings sync
├── server.ts                     # Express 5 API gateway, SSE/downsampling & health analytics
├── index.css                     # Tailwind v4 setup + CSS variables for 6 UI styles & densities
├── start-local.sh                # Local launcher & --test runner
├── components/
│   ├── AppSettingsModal.tsx      # 4-tab Settings, Language, UI Style & Athlete modal
│   ├── ActivitiesDashboardView.tsx
│   ├── ActivitiesManagerView.tsx
│   ├── ElevationProfile.tsx
│   ├── FitnessPerformanceAnalysis.tsx
│   ├── GarminDashboard.tsx
│   ├── Map.tsx / Map3D.tsx
│   ├── PlannedToursView.tsx
│   ├── Sidebar.tsx
│   └── ...
├── utils/
│   ├── appSettings.ts            # AppPreferences, sanitization & DE<->EN DOM translator
│   ├── db.ts                     # SQLite schema, FTS5 catalog & migrations (through 2.9.7)
│   ├── fitUtils.ts               # Binary FIT parser & stationary workout guards
│   ├── gpxUtils.ts               # GPX parser, sport classification, RDP & elevation math
│   └── garminPersonalApi.ts      # Garmin Connect Personal API sync & FIT hydration
├── tests/                        # Automated unit & integration test suites
├── ARCHITECTURE.md               # Detailed system architecture & ADRs
├── ARCHIMATE.md                  # ArchiMate 3.1 enterprise architecture specification
└── CHANGELOG.md                  # Version history & release notes
```

---

## Further Documentation

- [**ARCHITECTURE.md**](./ARCHITECTURE.md) — System diagrams, data pipelines, SQLite schema, and Architectural Decision Records (ADRs).
- [**ARCHIMATE.md**](./ARCHIMATE.md) — Formal ArchiMate 3.1 enterprise viewpoint modeling.
- [**CHANGELOG.md**](./CHANGELOG.md) — Detailed changelog of features, performance optimizations, and bug fixes.
