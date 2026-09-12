# GPX Route Master — ArchiMate 3.1 Architecture Specification

This document specifies the enterprise, system, and solution architecture of **GPX Route Master** according to the **The Open Group ArchiMate® 3.1 Standard**.

The architecture adheres to Clean Architecture / Hexagonal Architecture principles, decoupling domain and calculation engines from framework and infrastructural concerns.

---

## 1. ArchiMate Standard Color Conventions

In accordance with the official ArchiMate 3.1 standard visualization scheme, elements are categorized into distinct conceptual layers:

| Layer | Color Code | Standard Hex | Role & Description |
| :--- | :--- | :--- | :--- |
| **Strategy & Motivation** | Light Violet / Lilac | `#EDE7F6` / `#7E57C2` | Stakeholders, Drivers, Goals, Capabilities, and Requirements |
| **Business Layer** | Warm Yellow / Gold | `#FFF9C4` / `#FBC02D` | Business Actors, Roles, Processes, Services, and Business Objects |
| **Application Layer** | Cool Sky Blue | `#E1F5FE` / `#0288D1` | Application Components, Interfaces, Services, and Data Objects |
| **Technology Layer** | Mint / Leaf Green | `#E8F5E9` / `#388E3C` | Nodes, System Software, Execution Environments, and Artifacts |
| **Physical & External** | Soft Neutral Green | `#DCEDC8` / `#689F38` | Sensors, Devices, and External Third-Party APIs |
| **Implementation** | Peach / Warm Coral | `#FFE0B2` / `#FB8C00` | Work Packages, Deliverables, and Migration Plateaus |

---

## 2. Layered Architecture Viewpoint (Multi-Layer Overview)

The Layered Viewpoint connects the **Business Layer** (User goals & athletic analysis), the **Application Layer** (Hexagonal Domain, Frontend Components & Backend Services), and the **Technology Layer** (Container, Browser, SQLite, External APIs).

```mermaid
flowchart TD
    %% Styling conforming to ArchiMate 3.1 specifications
    classDef business fill:#FFF9C4,stroke:#FBC02D,stroke-width:2px,color:#374151;
    classDef application fill:#E1F5FE,stroke:#0288D1,stroke-width:2px,color:#0F172A;
    classDef tech fill:#E8F5E9,stroke:#388E3C,stroke-width:2px,color:#1B5E20;
    classDef dataObj fill:#EDE7F6,stroke:#7E57C2,stroke-width:2px,color:#311B92;
    classDef extServ fill:#DCEDC8,stroke:#689F38,stroke-width:2px,color:#2E4A1D;

    subgraph BL ["🟡 1. BUSINESS LAYER (Geschäftsebene)"]
        BA1["👤 Endurance Athlete / Cyclist<br><b>(Business Actor)</b>"]:::business
        BP1["🗺️ Route Planning & Analysis<br><b>(Business Process)</b>"]:::business
        BP2["⚡ Pacing & Performance Diagnostics<br><b>(Business Process)</b>"]:::business
        BP3["🔧 Track Cleansing & Gap Repair<br><b>(Business Process)</b>"]:::business
        BS1["🚴 GPS Track Inspection Service<br><b>(Business Service)</b>"]:::business
        BS2["📊 Training Diagnostics Service<br><b>(Business Service)</b>"]:::business

        BA1 -->|assigned to| BP1
        BA1 -->|assigned to| BP2
        BA1 -->|assigned to| BP3
        BP1 -->|realizes| BS1
        BP3 -->|realizes| BS1
        BP2 -->|realizes| BS2
    end

    subgraph AL ["🔷 2. APPLICATION LAYER (Anwendungsebene)"]
        subgraph FrontEnd ["GPX Route Master SPA (React 19 / Vite)"]
            AC_Map["Map & 3D Terrain Viewer<br><b>(Application Component)</b>"]:::application
            AC_Elev["Elevation & Climb Profile Engine<br><b>(Application Component)</b>"]:::application
            AC_Clean["Hexagonal Clean Domain Core<br><b>(Application Component)</b>"]:::application
            AC_Garmin["Health & Activities Manager<br><b>(Application Component)</b>"]:::application
        end

        subgraph BackEnd ["Express Server Application (Node.js)"]
            AC_Server["Express REST Gateway<br><b>(Application Component)</b>"]:::application
            AS_Surface["Surface Enrichment Service<br><b>(Application Service)</b>"]:::application
            AS_Weather["Meteorological Route Service<br><b>(Application Service)</b>"]:::application
            AS_TrackRepo["Track Repository Service<br><b>(Application Service)</b>"]:::application
        end

        DO_Track["GPXTrack / GeoJSON Record<br><b>(Data Object)</b>"]:::dataObj
        DO_Metrics["Performance & Health Metrics<br><b>(Data Object)</b>"]:::dataObj

        BS1 -.->|serviced by| AC_Map
        BS1 -.->|serviced by| AC_Elev
        BS2 -.->|serviced by| AC_Garmin
        
        AC_Map <-->|consumes| AC_Server
        AC_Elev -->|accesses| DO_Track
        AC_Clean -->|manipulates| DO_Track
        AC_Garmin -->|accesses| DO_Metrics
        AC_Garmin <-->|consumes| AC_Server
        
        AC_Server -->|serves| AS_Surface
        AC_Server -->|serves| AS_Weather
        AC_Server -->|serves| AS_TrackRepo
    end

    subgraph TL ["🟢 3. TECHNOLOGY LAYER (Technologieebene)"]
        NODE_Client["💻 End-User Device & Browser<br><b>(Device / Node)</b>"]:::tech
        SW_Browser["🌐 WebKit / Blink JS Engine<br><b>(System Software)</b>"]:::tech
        SW_PWA["⚡ PWA Service Worker & Cache<br><b>(System Software)</b>"]:::tech
        
        NODE_Server["🖥️ Linux Container (Port 3000)<br><b>(Execution Environment)</b>"]:::tech
        SW_Node["🟢 Node.js v20+ / tsx Runtime<br><b>(System Software)</b>"]:::tech
        ART_DB["🗄️ activities.db (SQLite / WAL)<br><b>(Artifact)</b>"]:::tech
        
        EXT_OSM["☁️ OpenStreetMap / Overpass API<br><b>(External Technology Service)</b>"]:::extServ
        EXT_Weather["☁️ Open-Meteo Weather API<br><b>(External Technology Service)</b>"]:::extServ

        NODE_Client --> SW_Browser
        SW_Browser --> SW_PWA
        SW_Browser --> FrontEnd
        
        NODE_Server --> SW_Node
        SW_Node --> BackEnd
        BackEnd --> ART_DB
        
        AS_Surface -->|communicates with| EXT_OSM
        AS_Weather -->|communicates with| EXT_Weather
    end
```

---

## 3. Application Cooperation Viewpoint (Hexagonal Architecture)

The application adheres to **Hexagonal (Ports & Adapters)** principles:
- **Domain Core**: Pure mathematical calculations, physics formulas (aerodynamic drag, rolling resistance), Savitzky-Golay filtering, Haversine metrics, and UCI climb category formulas.
- **Inbound Ports / Use Cases**: High-level orchestrators (`HydrateTrackUseCase`, `AnalyzeClimbsUseCase`, `SplitTrackOnGapsUseCase`).
- **Outbound Ports**: Abstractions for persistence and telemetry (`ITrackRepository`, `IWeatherService`).
- **Adapters**: REST controllers, Leaflet/MapLibre UI components, and SQLite implementations.

```mermaid
flowchart LR
    classDef domain fill:#FFE082,stroke:#FFA000,stroke-width:2px,color:#3E2723;
    classDef port fill:#FFF59D,stroke:#FBC02D,stroke-width:2px,color:#263238;
    classDef adapter fill:#BBDEFB,stroke:#1976D2,stroke-width:2px,color:#0D47A1;
    classDef infra fill:#C8E6C9,stroke:#388E3C,stroke-width:2px,color:#1B5E20;

    subgraph AdaptersPrimary ["Primary Adapters (Driving UI)"]
        UI_Map["Map.tsx (Leaflet/MapLibre)"]:::adapter
        UI_Elev["ElevationProfile.tsx (SVG)"]:::adapter
        UI_Sidebar["Sidebar.tsx (Controls)"]:::adapter
    end

    subgraph Hexagon ["Hexagonal Application Core"]
        subgraph InboundPorts ["Inbound Ports (API)"]
            P_InTrack["TrackManagementPort"]:::port
            P_InClimb["ClimbAnalysisPort"]:::port
            P_InGap["GapDetectionPort"]:::port
        end

        subgraph DomainCore ["Pure Domain Layer"]
            D_Track["Track & Point Entities"]:::domain
            D_Physics["Aerodynamic Power Engine"]:::domain
            D_Filter["Savitzky-Golay Filter"]:::domain
            D_UCI["UCI Climb Score Algorithm"]:::domain
        end

        subgraph OutboundPorts ["Outbound Ports (SPI)"]
            P_OutRepo["ITrackRepository"]:::port
            P_OutWeather["IWeatherService"]:::port
        end
    end

    subgraph AdaptersSecondary ["Secondary Adapters (Driven Infra)"]
        Infra_SQLite["SQLiteTrackRepository<br>(better-sqlite3)"]:::infra
        Infra_OpenMeteo["OpenMeteoWeatherService<br>(REST Client)"]:::infra
        Infra_Overpass["OverpassSurfaceAdapter<br>(OSM API)"]:::infra
    end

    AdaptersPrimary -->|invokes| InboundPorts
    InboundPorts --> DomainCore
    DomainCore --> OutboundPorts
    OutboundPorts --> AdaptersSecondary
```

---

## 4. Information Structure Viewpoint

This viewpoint maps conceptual **Business Objects** down to software **Data Objects** and physical database **Artifacts**.

```mermaid
classDiagram
    class BusinessObjects {
        <<Business Layer>>
        Radsportstrecke (Route)
        Höhenprofil (Elevation Profile)
        Bergwertung (Categorized Climb)
        Leistungsdiagnostik (Power Diagnostics)
    }

    class DataObjects {
        <<Application Layer>>
        +GPXTrack
        +GPXPoint
        +ClimbSegment
        +SurfaceStatistics
        +GarminHealthRecord
    }

    class DatabaseArtifacts {
        <<Technology Layer>>
        +activities (Table)
        +track_points (Table)
        +climb_segments (Table)
        +app_settings (Table)
        +app_versions (Table)
    }

    BusinessObjects ..> DataObjects : realized by
    DataObjects ..> DatabaseArtifacts : persisted in
```

### Key Data Attributes Mapping

| Data Object | Entity Attributes | Schema Realization |
| :--- | :--- | :--- |
| **`GPXTrack`** | `id`, `name`, `distance_km`, `ascent_m`, `descent_m`, `moving_time`, `surface_stats` | `activities` table & JSON fields |
| **`GPXPoint`** | `lat`, `lng`, `ele`, `time`, `hr`, `cadence`, `power`, `temp`, `speed_kmh`, `grade_pct` | In-memory point array / `points_json` |
| **`ClimbSegment`**| `id`, `start_dist`, `end_dist`, `length_km`, `avg_grade`, `gain_m`, `uci_score`, `category` (HC/1-4) | `climb_segments` table |
| **`AppSettings`** | `theme_mode`, `power_ftp`, `user_weight`, `user_age`, `user_max_hr`, `velo_text_markers` | `app_settings` key-value store |

---

## 5. Technology & Infrastructure Viewpoint

This viewpoint specifies the deployment environment, container runtime, network gateways, and security controls.

```mermaid
flowchart TD
    classDef client fill:#E0F2FE,stroke:#0284C7,stroke-width:2px;
    classDef edge fill:#EDE9FE,stroke:#7C3AED,stroke-width:2px;
    classDef container fill:#DCFCE7,stroke:#16A34A,stroke-width:2px;
    classDef ext fill:#FEE2E2,stroke:#DC2626,stroke-width:2px;

    subgraph ClientHost ["Client Infrastructure"]
        Browser["User Agent (Chromium / Safari / Firefox)"]:::client
        LocalStorage["Browser Storage (localStorage / IndexedDB)"]:::client
    end

    subgraph EdgeProxy ["Ingress & Reverse Proxy"]
        Nginx["Nginx Reverse Proxy (Port 8080/3000)<br>• CSP Headers (frame-ancestors)<br>• CORS Preflight Handlers"]:::edge
    end

    subgraph NodeContainer ["Cloud Run Execution Container (Linux AMD64)"]
        NodeRuntime["Node.js v20 LTS / Express Engine"]:::container
        ViteMiddleware["Vite Development & Static Asset Pipeline"]:::container
        SQLiteEngine["better-sqlite3 Engine with WAL Mode"]:::container
        FileSystem["Persistent Storage (/app/activities.db)"]:::container
    end

    subgraph ExternalThirdParties ["External Services"]
        OSM["OpenStreetMap Overpass Servers"]:::ext
        OpenMeteo["Open-Meteo Forecast & Archive APIs"]:::ext
    end

    Browser <-->|HTTP/HTTPS Port 3000| Nginx
    Browser <-->|Synchronous Cache| LocalStorage
    Nginx <--> NodeRuntime
    NodeRuntime <--> ViteMiddleware
    NodeRuntime <--> SQLiteEngine
    SQLiteEngine <--> FileSystem
    NodeRuntime <-->|Server-to-Server Proxy| OSM
    NodeRuntime <-->|Server-to-Server Proxy| OpenMeteo
```

---

## 6. Motivation & Strategy Viewpoint

The motivation viewpoint traces functional requirements and software quality attributes back to overarching stakeholder goals.

```mermaid
flowchart TD
    classDef stakeholder fill:#EDE7F6,stroke:#7E57C2,stroke-width:2px;
    classDef driver fill:#FFF9C4,stroke:#FBC02D,stroke-width:2px;
    classDef goal fill:#C5CAE9,stroke:#3F51B5,stroke-width:2px;
    classDef requirement fill:#B2DFDB,stroke:#00897B,stroke-width:2px;

    SH["Stakeholder: Endurance Athlete & Coach"]:::stakeholder
    DR1["Driver: Inaccurate GPS files & pacing errors"]:::driver
    DR2["Driver: Slow rendering on huge 100k-point tracks"]:::driver

    G1["Goal: Professional Route Cleansing & Elevation Accuracy"]:::goal
    G2["Goal: 60 FPS Fluid Pan/Zoom Map Performance"]:::goal
    G3["Goal: Scientific Power & Climb Categorization"]:::goal

    R1["Requirement: Savitzky-Golay Elevation Smoothing"]:::requirement
    R2["Requirement: Ramer-Douglas-Peucker (RDP) Downsampling"]:::requirement
    R3["Requirement: UCI Climb Categorization (HC, 1-4) & VAM Calculator"]:::requirement
    R4["Requirement: Air Drag & Rolling Resistance Power Modeling"]:::requirement

    SH -->|motivated by| DR1
    SH -->|motivated by| DR2
    DR1 -->|addressed by| G1
    DR1 -->|addressed by| G3
    DR2 -->|addressed by| G2

    G1 -->|realized by| R1
    G2 -->|realized by| R2
    G3 -->|realized by| R3
    G3 -->|realized by| R4
```

---

## 7. ArchiMate Element Catalogue

| Element Name | ArchiMate Element Type | Layer | Architectural Realization |
| :--- | :--- | :--- | :--- |
| **Endurance Athlete** | Business Actor | Business | End-user using browser interface |
| **Route Planning** | Business Process | Business | GPX editing, multi-track workspace |
| **Track Inspection** | Business Service | Business | Instant elevation, distance, and surface analysis |
| **Map & 3D Terrain Viewer** | Application Component | Application | Leaflet & MapLibre GL 3D integration |
| **Elevation Profile Engine** | Application Component | Application | Two-layer SVG & HTML typography overlay |
| **Hexagonal Domain Core** | Application Component | Application | `domain/entities`, `physics`, `telemetry` |
| **Track Repository Service** | Application Service | Application | `infrastructure/repositories/sqliteTrackRepository` |
| **REST API Gateway** | Application Interface | Application | `server.ts` Express routing layer |
| **GPXTrack Data Object** | Data Object | Application | TypeScript interface `GPXTrack` |
| **Node.js Execution Node** | Execution Environment | Technology | Cloud Run Linux container |
| **SQLite Database** | Artifact | Technology | `better-sqlite3` file `/app/activities.db` |
| **Overpass OSM Service** | Technology Service | External | Remote OpenStreetMap data queries |
| **Open-Meteo Weather** | Technology Service | External | Route weather & wind forecasting |
