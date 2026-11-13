import Database from 'better-sqlite3';
import crypto from 'crypto';
import path from 'path';
import fs from 'fs';
import { calculateSurfaceStatsFromPoints, hydratePointsWithSurface } from './gpxUtils';
import { getCuratedSeedTours } from './seedTours';

// Store the SQLite database file in a data directory for clean docker volume persistence
const dbDir = path.join(process.cwd(), 'data');
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}
const dbPath = path.join(dbDir, 'gpx_library.db');

export let db: Database.Database;

export function getDb(): Database.Database {
  return db;
}

function configureDbPragmas(database: Database.Database): void {
  try {
    database.pragma('journal_mode = WAL');
    database.pragma('synchronous = NORMAL');
    database.pragma('busy_timeout = 5000');
    database.pragma('temp_store = MEMORY');
    database.pragma('cache_size = -20000');
  } catch (err: any) {
    console.warn('[SQLite PRAGMA] Warning configuring performance pragmas:', err.message);
  }
}

function purgeDatabaseFiles(): void {
  const exts = ['', '-wal', '-shm'];
  const timestamp = Date.now();
  for (const ext of exts) {
    const p = dbPath + ext;
    if (fs.existsSync(p)) {
      const backupPath = `${dbPath}.corrupt_${timestamp}${ext}`;
      try {
        fs.renameSync(p, backupPath);
        console.warn(`[Self-Healing] Archived corrupted SQLite file: ${p} -> ${backupPath}`);
      } catch {
        try {
          fs.unlinkSync(p);
          console.warn(`[Self-Healing] Deleted corrupted SQLite file: ${p}`);
        } catch (e: any) {
          console.error(`[Self-Healing] Failed to remove corrupt file ${p}:`, e.message);
        }
      }
    }
  }
}

export function verifyDatabaseIntegrity(database: Database.Database): boolean {
  try {
    const res = database.pragma('quick_check') as Array<{ quick_check: string }>;
    if (!res || res.length === 0 || res[0].quick_check !== 'ok') {
      console.warn('[SQLite Integrity] quick_check detected database corruption:', res);
      return false;
    }
    const hasTracks = database.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='tracks'").get();
    if (hasTracks) {
      database.prepare("SELECT COUNT(*) FROM tracks").get();
    }
    return true;
  } catch (err: any) {
    console.warn('[SQLite Integrity] Database integrity check failed:', err.message);
    return false;
  }
}

export function recoverCorruptDatabase(): Database.Database {
  console.warn('[Self-Healing] Recovering corrupt SQLite database...');
  try {
    if (db && db.open) {
      db.close();
    }
  } catch {}

  purgeDatabaseFiles();

  db = new Database(dbPath);
  configureDbPragmas(db);
  runInitDbStatements();
  try {
    seedCuratedTours(true);
  } catch (e: any) {
    console.error('[Self-Healing] Error re-seeding curated tours after recovery:', e.message);
  }
  console.log('[Self-Healing] Database recovery complete and verified healthy.');
  return db;
}

export function executeWithCorruptionRecovery<T>(operation: () => T): T {
  try {
    return operation();
  } catch (err: any) {
    const msg = String(err?.message || '').toLowerCase();
    const isCorrupt = msg.includes('malformed') || msg.includes('corrupt') || err?.code === 'SQLITE_CORRUPT';
    if (isCorrupt) {
      console.error('[Self-Healing] SQLite corruption detected during operation. Triggering auto-recovery:', err.message);
      recoverCorruptDatabase();
      return operation();
    }
    throw err;
  }
}

function openAndVerifyDb(): Database.Database {
  let tempDb: Database.Database | null = null;
  try {
    if (fs.existsSync(dbPath)) {
      tempDb = new Database(dbPath);
      configureDbPragmas(tempDb);
      if (!verifyDatabaseIntegrity(tempDb)) {
        throw new Error('Database file is corrupt according to integrity verification.');
      }
      return tempDb;
    }
  } catch (err: any) {
    console.error("CRITICAL DATABASE CORRUPTION DETECTED during opening/verification:", err.message);
    if (tempDb) {
      try {
        tempDb.close();
      } catch {}
      tempDb = null;
    }
    purgeDatabaseFiles();
  }

  const freshDb = new Database(dbPath);
  configureDbPragmas(freshDb);
  return freshDb;
}

db = openAndVerifyDb();
try {
  ensureCoreSchema();
} catch {}

export function closeDb(): void {
  try {
    if (db && db.open) {
      db.close();
      console.log('[SQLite] Connection cleanly closed.');
    }
  } catch (e: any) {
    console.error('[SQLite] Error during closeDb:', e.message);
  }
}

export interface DbTrackRecord {
  id: string;
  name: string;
  distance: number;
  ascent: number;
  descent: number;
  duration?: number;
  activity_type?: string;
  description?: string;
  tags?: string;
  date_created?: string;
  original_filename?: string;
  points_json: string;
  power_stats_json?: string;
  surface_stats_json?: string;
  climbs_json?: string;
  max_slope?: number;
  color?: string;
  has_timestamps?: number;
  raw_file_json?: string;
}

export function initDb() {
  try {
    if (!verifyDatabaseIntegrity(db)) {
      throw new Error("Database failed integrity check during initDb.");
    }
    runInitDbStatements();
  } catch (err: any) {
    console.error("CRITICAL DATABASE CORRUPTION DETECTED during execution/init:", err.message);
    recoverCorruptDatabase();
  }
}

function ensureCoreSchema() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS tracks (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      distance REAL NOT NULL,
      ascent REAL NOT NULL,
      descent REAL NOT NULL,
      duration REAL,
      activity_type TEXT,
      description TEXT,
      tags TEXT,
      date_created TEXT,
      points_json TEXT NOT NULL,
      power_stats_json TEXT,
      surface_stats_json TEXT,
      climbs_json TEXT,
      original_filename TEXT,
      max_slope REAL,
      color TEXT,
      has_timestamps INTEGER,
      raw_file_json TEXT,
      user_id TEXT DEFAULT 'default'
    )
  `);

  // Create tables for Garmin Health Data
  db.exec(`
    CREATE TABLE IF NOT EXISTS garmin_sleep (
      date TEXT PRIMARY KEY,
      duration REAL,
      deep REAL,
      light REAL,
      rem REAL,
      awake REAL
    );
    CREATE TABLE IF NOT EXISTS garmin_weight (
      date TEXT PRIMARY KEY,
      weight REAL,
      bmi REAL,
      body_fat REAL
    );
    CREATE TABLE IF NOT EXISTS garmin_stress (
      date TEXT PRIMARY KEY,
      avg_stress REAL
    );
    CREATE TABLE IF NOT EXISTS garmin_rhr (
      date TEXT PRIMARY KEY,
      rhr REAL
    );
    CREATE TABLE IF NOT EXISTS garmin_steps (
      date TEXT PRIMARY KEY,
      steps INTEGER,
      calories REAL,
      distance REAL
    );
    CREATE TABLE IF NOT EXISTS garmin_activities (
      id TEXT PRIMARY KEY,
      name TEXT,
      type TEXT,
      date TEXT,
      distance REAL,
      duration REAL,
      ascent REAL,
      descent REAL,
      calories REAL,
      avg_hr REAL,
      description TEXT,
      location TEXT,
      points_json TEXT,
      user_id TEXT
    );

    CREATE TABLE IF NOT EXISTS app_version (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      version TEXT NOT NULL UNIQUE,
      updated_at TEXT NOT NULL,
      changelog TEXT
    );
    CREATE TABLE IF NOT EXISTS user_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS user_settings_scoped (
      user_id TEXT NOT NULL,
      key TEXT NOT NULL,
      value TEXT NOT NULL,
      updated_at TEXT DEFAULT (strftime('%Y-%m-%d %H:%M:%f', 'now')),
      PRIMARY KEY (user_id, key)
    );
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      provider TEXT NOT NULL,
      provider_id TEXT NOT NULL,
      email TEXT NOT NULL,
      name TEXT NOT NULL,
      avatar_url TEXT,
      created_at TEXT DEFAULT (strftime('%Y-%m-%d %H:%M:%f', 'now')),
      last_login_at TEXT DEFAULT (strftime('%Y-%m-%d %H:%M:%f', 'now')),
      UNIQUE(provider, provider_id)
    );
    CREATE TABLE IF NOT EXISTS auth_sessions (
      token TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      expires_at INTEGER NOT NULL,
      created_at TEXT DEFAULT (strftime('%Y-%m-%d %H:%M:%f', 'now')),
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
    );
  `);

  // Run graceful schema migrations on existing database tables
  try {
    db.exec(`ALTER TABLE tracks ADD COLUMN max_slope REAL`);
  } catch (e) {}
  try {
    db.exec(`ALTER TABLE tracks ADD COLUMN color TEXT`);
  } catch (e) {}
  try {
    db.exec(`ALTER TABLE tracks ADD COLUMN has_timestamps INTEGER`);
  } catch (e) {}
  try {
    db.exec(`ALTER TABLE tracks ADD COLUMN raw_file_json TEXT`);
  } catch (e) {}
  try {
    db.exec(`ALTER TABLE tracks ADD COLUMN user_id TEXT DEFAULT 'default'`);
  } catch (e) {}
  try {
    db.exec(`ALTER TABLE garmin_activities ADD COLUMN description TEXT`);
  } catch (e) {}
  try {
    db.exec(`ALTER TABLE garmin_activities ADD COLUMN location TEXT`);
  } catch (e) {}
  try {
    db.exec(`ALTER TABLE garmin_activities ADD COLUMN points_json TEXT`);
  } catch (e) {}
  try {
    db.exec(`ALTER TABLE garmin_activities ADD COLUMN user_id TEXT DEFAULT 'default'`);
  } catch (e) {}
  try {
    db.exec(`ALTER TABLE garmin_sleep ADD COLUMN user_id TEXT DEFAULT 'default'`);
  } catch (e) {}
  try {
    db.exec(`ALTER TABLE garmin_weight ADD COLUMN user_id TEXT DEFAULT 'default'`);
  } catch (e) {}
  try {
    db.exec(`ALTER TABLE garmin_stress ADD COLUMN user_id TEXT DEFAULT 'default'`);
  } catch (e) {}
  try {
    db.exec(`ALTER TABLE garmin_rhr ADD COLUMN user_id TEXT DEFAULT 'default'`);
  } catch (e) {}
  try {
    db.exec(`ALTER TABLE garmin_steps ADD COLUMN user_id TEXT DEFAULT 'default'`);
  } catch (e) {}

  // Backfill NULL user_id values to 'default'
  try {
    db.exec(`UPDATE tracks SET user_id = 'default' WHERE user_id IS NULL OR user_id = ''`);
    db.exec(`UPDATE garmin_activities SET user_id = 'default' WHERE user_id IS NULL OR user_id = ''`);
    db.exec(`UPDATE garmin_sleep SET user_id = 'default' WHERE user_id IS NULL OR user_id = ''`);
    db.exec(`UPDATE garmin_weight SET user_id = 'default' WHERE user_id IS NULL OR user_id = ''`);
    db.exec(`UPDATE garmin_stress SET user_id = 'default' WHERE user_id IS NULL OR user_id = ''`);
    db.exec(`UPDATE garmin_rhr SET user_id = 'default' WHERE user_id IS NULL OR user_id = ''`);
    db.exec(`UPDATE garmin_steps SET user_id = 'default' WHERE user_id IS NULL OR user_id = ''`);
  } catch (e) {}

  // Create performance indexes to speed up name, description, and location searches
  try {
    db.exec(`CREATE INDEX IF NOT EXISTS idx_garmin_activities_name ON garmin_activities(name)`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_garmin_activities_description ON garmin_activities(description)`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_garmin_activities_location ON garmin_activities(location)`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_garmin_activities_date ON garmin_activities(date)`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_garmin_activities_type ON garmin_activities(type)`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_garmin_activities_user_id ON garmin_activities(user_id)`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_garmin_activities_user_date ON garmin_activities(user_id, date DESC)`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_garmin_activities_user_type_dist ON garmin_activities(user_id, type, distance)`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_tracks_name ON tracks(name)`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_tracks_description ON tracks(description)`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_tracks_user_id ON tracks(user_id)`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_tracks_user_date ON tracks(user_id, date_created DESC)`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_tracks_user_type_dist ON tracks(user_id, activity_type, distance)`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_auth_sessions_user_id ON auth_sessions(user_id)`);
  } catch (e) {
    console.error('Failed to create database indexes:', e);
  }
}

function runInitDbStatements() {
  ensureCoreSchema();

  // Seed with initial versions if empty
  try {
    const row = db.prepare('SELECT COUNT(*) as count FROM app_version').get() as { count: number };
    if (row.count === 0) {
      const stmt = db.prepare('INSERT INTO app_version (version, updated_at, changelog) VALUES (?, ?, ?)');
      stmt.run('1.0.0', '2026-05-15T10:00:00.000Z', 'Initial release of GPX Route Master featuring GPX parsing, route metrics visualization, elevation profiling, and Leaflet interactive maps.');
      stmt.run('1.1.0', '2026-06-10T14:30:00.000Z', 'Added Garmin SQLite health database imports, including sleep, weight, stress levels, resting heart rate, and step tracking metrics.');
      stmt.run('1.2.0', '2026-06-28T09:15:00.000Z', 'Integrated smart fallback engine to auto-generate virtual routes for activities lacking native GPS coordinates, maintaining beautiful layout continuity.');
      stmt.run('1.3.0', '2026-07-02T12:00:00.000Z', 'Added SQLite path query extraction for activity_path tables containing JSON path_json fields, preventing circular rendering and standardizing coordinates.');
    }

    // Always ensure the latest minor version representing this update (v1.3.2) is present
    const checkStmt = db.prepare('SELECT COUNT(*) as count FROM app_version WHERE version = ?');
    const hasV131 = (checkStmt.get('1.3.1') as { count: number }).count > 0;
    if (!hasV131) {
      const insertStmt = db.prepare('INSERT INTO app_version (version, updated_at, changelog) VALUES (?, ?, ?)');
      insertStmt.run('1.3.1', '2026-07-12T00:00:00.000Z', 'Added dynamic build date and time tracking with automatic versioning for continuous deployment transparency.');
    }
    const hasV132 = (checkStmt.get('1.3.2') as { count: number }).count > 0;
    if (!hasV132) {
      const insertStmt = db.prepare('INSERT INTO app_version (version, updated_at, changelog) VALUES (?, ?, ?)');
      insertStmt.run('1.3.2', new Date().toISOString(), 'Performance-Optimierung: Automatische adaptive GPS-Punkt-Downsampling-Technik für extrem große SQLite-Datenbanken integriert, um V8-Limitierungen ("Invalid string length") vollständig zu verhindern und RAM-Auslastung um bis zu 90% zu reduzieren.');
    }
    
    const hasV244 = (checkStmt.get('2.4.4') as { count: number }).count > 0;
    if (!hasV244) {
      const insertStmt = db.prepare('INSERT INTO app_version (version, updated_at, changelog) VALUES (?, ?, ?)');
      insertStmt.run('2.4.4', '2026-08-14T00:00:00.000Z', 'Startup Track Framing & Weather Engine: Added automatic camera focus to first workspace track on app startup; built multi-point route weather forecasting (Start, Summit, End) with Open-Meteo live API integration, quick date presets, and offline climate simulation fallback.');
    }

    const hasV261 = (checkStmt.get('2.6.1') as { count: number }).count > 0;
    if (!hasV261) {
      const insertStmt = db.prepare('INSERT INTO app_version (version, updated_at, changelog) VALUES (?, ?, ?)');
      insertStmt.run('2.6.1', '2026-08-16T00:00:00.000Z', 'Intensive Analysis Modal Lifecycle & AnimatePresence Fix: Standardized motion container animation, resolved React 19 dispatcher hook issue, added Escape shortcut and body scroll locking, and corrected marker label schema.');
    }

    const hasV271 = (checkStmt.get('2.7.1') as { count: number }).count > 0;
    if (!hasV271) {
      const insertStmt = db.prepare('INSERT INTO app_version (version, updated_at, changelog) VALUES (?, ?, ?)');
      insertStmt.run('2.7.1', '2026-08-17T00:00:00.000Z', 'Steigungs- & Gipfel-Anomalieerkennung: Visuelle Warnungen und Diagnose-Overlays für physikalisch unmögliche Steigungssprünge, barometrische Höhenfehler und fehlerhafte Gipfelkraxler direkt im Höhenprofil.');
    }

    const hasV272 = (checkStmt.get('2.7.2') as { count: number }).count > 0;
    if (!hasV272) {
      const insertStmt = db.prepare('INSERT INTO app_version (version, updated_at, changelog) VALUES (?, ?, ?)');
      insertStmt.run('2.7.2', '2026-08-18T00:00:00.000Z', 'Elevation Anomaly Auto-Repair & Savitzky-Golay Filtering: 1-Click-Korrektur für Steigungsklippen und falsche Gipfelnadeln sowie konfigurierbare gipfelerhaltende Höhenfilterung (Leicht/Mittel/Alpin).');
    }

    const hasV273 = (checkStmt.get('2.7.3') as { count: number }).count > 0;
    if (!hasV273) {
      const insertStmt = db.prepare('INSERT INTO app_version (version, updated_at, changelog) VALUES (?, ?, ?)');
      insertStmt.run('2.7.3', '2026-08-18T00:00:00.000Z', 'Intensive Streckenanalyse: Vollständige Anstiegs- & Bergwertungs-Integration (Kategorien, VAM, Watt- & Zeitprognosen, interaktiver Kartenzentrierung) und Behebung des Z-Index-Overlays.');
    }

    const hasV274 = (checkStmt.get('2.7.4') as { count: number }).count > 0;
    if (!hasV274) {
      const insertStmt = db.prepare('INSERT INTO app_version (version, updated_at, changelog) VALUES (?, ?, ?)');
      insertStmt.run('2.7.4', '2026-08-18T00:00:00.000Z', 'Farbige Anstiegsmarkierung im Höhenprofil: Visuelle Hervorhebung identifizierter Bergwertungen mittels farbkodierter ReferenceAreas (HC/Kat 1-4), synchronisiertem Hover-Tooltip, Schnellwahl-Chips und interaktivem Climb-Highlighting.');
    }

    const hasV275 = (checkStmt.get('2.7.5') as { count: number }).count > 0;
    if (!hasV275) {
      const insertStmt = db.prepare('INSERT INTO app_version (version, updated_at, changelog) VALUES (?, ?, ?)');
      insertStmt.run('2.7.5', '2026-08-18T00:00:00.000Z', 'Real-World Reference Benchmark Test Suite & Scientific Validation: Umfassende automatisierte Testabdeckung für weltbekannte Monumentalanstiege (Alpe d\'Huez, Passo dello Stelvio, Col de la Madeleine), standardisierte Bergpass-Kategorisierungen (HC / Kat 1–4), geodätische Haversine-Distanzen und aerodynamische Leistungsmodelle.');
    }

    const hasV276 = (checkStmt.get('2.7.6') as { count: number }).count > 0;
    if (!hasV276) {
      const insertStmt = db.prepare('INSERT INTO app_version (version, updated_at, changelog) VALUES (?, ?, ?)');
      insertStmt.run('2.7.6', '2026-08-18T00:00:00.000Z', 'Security Hardening & Comprehensive Vulnerability Audit: Umfassende Absicherung aller REST-Endpunkte, Dateipfad-Validierung (Path Traversal & Whitelist), Prototype Pollution Schutz in Settings & SQLite-Queries, bereinigte CORS- und Security-Header (X-Content-Type-Options, Referrer-Policy, Permissions-Policy), JSON-Fehler-Handler und dedizierte Sicherheits-Regressionstests.');
    }

    const hasV277 = (checkStmt.get('2.7.7') as { count: number }).count > 0;
    if (!hasV277) {
      const insertStmt = db.prepare('INSERT INTO app_version (version, updated_at, changelog) VALUES (?, ?, ?)');
      insertStmt.run('2.7.7', '2026-08-18T00:00:00.000Z', '3D-Terrain Hover-Preview & Instantaneous Slope HUD: Nahtlos in die Seitenleiste integrierte 3D-Relief-Vorschau mit MapLibre GL Raster-DEM, die synchron beim Überfahren des Höhenprofils mit der Maus aktualisiert wird, inklusive Echtzeit-Anzeige von momentaner Steigung (farbkodiert), Höhe ü.NN, Kompass-Richtung, Distanz und Sensor-Telemetrie.');
    }

    const hasV278 = (checkStmt.get('2.7.8') as { count: number }).count > 0;
    if (!hasV278) {
      const insertStmt = db.prepare('INSERT INTO app_version (version, updated_at, changelog) VALUES (?, ?, ?)');
      insertStmt.run('2.7.8', '2026-08-20T00:00:00.000Z', 'Sport-Metriken & Trainingswissenschaftliches Glossar: Umfassendes Nachschlagewerk für Leistungs- und Physiologiemetriken (VAM, TSS, FTP, NP, IF, VI, CTL/ATL/TSB, VO2max, EF, Pw:HR Decoupling, Climb Categories HC-4, kJ/kcal) mit mathematischen Formeln, Referenz-Skalen, Praxistipps und 4 interaktiven Simulatoren (VAM-, TSS-, Pacing- und Bergwertungs-Rechner).');
    }

    const hasV279 = (checkStmt.get('2.7.9') as { count: number }).count > 0;
    if (!hasV279) {
      const insertStmt = db.prepare('INSERT INTO app_version (version, updated_at, changelog) VALUES (?, ?, ?)');
      insertStmt.run('2.7.9', '2026-08-22T00:00:00.000Z', 'Tastaturkürzel-Übersicht & Accessibility-Modal: Interaktives Shortcuts-Modal (Taste ? oder F1) mit Kategoriefilterung und Schnellsuche zur einfachen Entdeckung von Tastenkombinationen wie C (Strecken durchwechseln), M (auf Punkt zentrieren), 3 (3D-Gelände), F (Flugmodus), G (Glossar), Pfeiltasten zur Punktnavigation und Schnellzugriff-Buttons in Sidebar und Karte.');
    }

    const hasV280 = (checkStmt.get('2.8.0') as { count: number }).count > 0;
    if (!hasV280) {
      const insertStmt = db.prepare('INSERT INTO app_version (version, updated_at, changelog) VALUES (?, ?, ?)');
      insertStmt.run('2.8.0', new Date().toISOString(), 'Workspace Summary Dashboard & Multi-Track Aggregation: Interaktive Gesamtübersicht aller im Workspace sichtbaren Strecken mit kumulierter Gesamtdistanz, Gesamtaufstieg/-abstieg, Netto-Höhenmeter, berechneter Gesamtdauer, Kalorienverbrauch, Min/Max-Gipfelhöhe, 1-Click Bounding-Box Kamera-Fokus (Fit to View), globaler Strecken-Sichtbarkeitsschaltung (Alle Ein/Aus) und interaktivem HUD-Karten-Overlay (Taste D).');
    }

    const hasV281 = (checkStmt.get('2.8.1') as { count: number }).count > 0;
    if (!hasV281) {
      const insertStmt = db.prepare('INSERT INTO app_version (version, updated_at, changelog) VALUES (?, ?, ?)');
      insertStmt.run('2.8.1', new Date().toISOString(), 'GPX-Touren-Bibliothek & Touren-Seeding: Integrierte Sammlung kuratierter GPX-Referenzrouten (Alpe d’Huez, Stilfser Joch, Col du Tourmalet, Isar-Radweg, Feldberg-Gravel, Berlin Marathon, Sa Calobra, Eibsee-Trailrun) mit detaillierten Höhenprofilen, Anstiegssegmenten, Telemetrie und Untergrundanalysen. 1-Klick Workspace-zu-Bibliothek Sicherung und Touren-Wiederherstellung.');
    }

    const hasV290 = (checkStmt.get('2.9.0') as { count: number }).count > 0;
    if (!hasV290) {
      const insertStmt = db.prepare('INSERT INTO app_version (version, updated_at, changelog) VALUES (?, ?, ?)');
      insertStmt.run('2.9.0', new Date().toISOString(), 'Google & Apple Authentifizierung (OAuth 2.0 / OIDC) & Mandantenfähige Nutzerisolation: Verpflichtendes Login-Gate mit Google- und Apple-Anmeldung, kryptographisch gesicherten Sitzungen und strikter Trennung von GPX-Bibliothek, Garmin-Aktivitäten, Gesundheitsdaten und Nutzereinstellungen pro Konto.');
    } else {
      const updateStmt = db.prepare('UPDATE app_version SET updated_at = ? WHERE version = ?');
      updateStmt.run(new Date().toISOString(), '2.9.0');
    }
  } catch (e) {
    console.error('Failed to seed app versions:', e);
  }

  // Ensure surface stats and point surfaces for ALL tracks in database
  try {
    const allTracks = db.prepare(`SELECT id, name, distance, activity_type, points_json, surface_stats_json FROM tracks`).all() as any[];
    for (const rt of allTracks) {
      let pts: any[] = [];
      try {
        pts = JSON.parse(rt.points_json || '[]');
      } catch (e) {
        continue;
      }
      if (!pts || pts.length === 0) continue;

      let surfaceStats: any[] = [];
      try {
        if (rt.surface_stats_json) surfaceStats = JSON.parse(rt.surface_stats_json);
      } catch (e) {}

      let needsUpdate = false;
      const calculated = calculateSurfaceStatsFromPoints(pts);

      if (calculated.length > 0) {
        if (JSON.stringify(calculated) !== JSON.stringify(surfaceStats)) {
          surfaceStats = calculated;
          needsUpdate = true;
        }
      }

      // Check if any point lacks surface property
      const missingPointSurface = pts.some((p: any) => !p.surface);
      if (missingPointSurface && surfaceStats && surfaceStats.length > 0) {
        hydratePointsWithSurface(pts, surfaceStats, rt.distance);
        needsUpdate = true;
      }

      if (needsUpdate) {
        db.prepare(`UPDATE tracks SET surface_stats_json = ?, points_json = ? WHERE id = ?`).run(JSON.stringify(surfaceStats), JSON.stringify(pts), rt.id);
      }
    }
  } catch (e) {
    console.error('Error auto-sanitizing road track surface stats:', e);
  }

  // Clean up legacy synthetic curated tours and old timestamp-based gpx IDs
  try {
    const deletedLegacy = db.prepare("DELETE FROM tracks WHERE id LIKE 'tour-%' OR id LIKE 'curated-%' OR id LIKE 'gpx-2026-%'").run();
    if (deletedLegacy.changes > 0) {
      console.log(`[DB Migration] Removed ${deletedLegacy.changes} legacy tour record(s) from database.`);
    }
  } catch (e) {}

  // Auto-seed real GPX files from /gpx folder on database initialization with verified start points
  try {
    seedCuratedTours(true, 'default');
  } catch (e) {
    console.error('Error auto-seeding GPX folder tours:', e);
  }

  // One-time backfill migration (2.9.1): Repair stored import-date fallbacks (e.g. Pottrunde) from GPS/metadata timestamps
  try {
    const checkMigration = db.prepare('SELECT COUNT(*) as count FROM app_version WHERE version = ?');
    const hasV291 = (checkMigration.get('2.9.1') as { count: number }).count > 0;
    if (!hasV291) {
      const repairResult = repairStoredActivityDates();
      if (repairResult.repairedTracks > 0 || repairResult.repairedGarmin > 0) {
        console.log(
          `[DB Migration 2.9.1] Repaired stored activity dates: ${repairResult.repairedTracks} library track(s), ${repairResult.repairedGarmin} Garmin activity(s).`
        );
      }
      db.prepare('INSERT INTO app_version (version, updated_at, changelog) VALUES (?, ?, ?)').run(
        '2.9.1',
        new Date().toISOString(),
        'Authentic Activity Timestamp Preservation & DB Date Repair: Preserves original GPX/FIT timestamps on import, backfills historical import-date rows from GPS/metadata timestamps, and isolates GPS-less tracks from 2D/3D maps.'
      );
    }
  } catch (e) {
    console.error('Failed to run 2.9.1 activity date repair migration:', e);
  }

  console.log('SQLite database initialized successfully at', dbPath);
}

function parsePlausibleIsoDate(value: unknown): Date | null {
  if (!value) return null;
  if (value instanceof Date) {
    const y = value.getUTCFullYear();
    return !isNaN(value.getTime()) && y >= 1995 && y <= 2100 ? value : null;
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    // Handle Unix epoch ms vs s
    const ms = value > 1e12 ? value : value > 1e9 ? value * 1000 : NaN;
    if (!Number.isFinite(ms)) return null;
    const d = new Date(ms);
    const y = d.getUTCFullYear();
    return !isNaN(d.getTime()) && y >= 1995 && y <= 2100 ? d : null;
  }
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = new Date(trimmed);
  if (isNaN(parsed.getTime())) return null;
  const y = parsed.getUTCFullYear();
  return y >= 1995 && y <= 2100 ? parsed : null;
}

export function extractAuthenticTimestampFromTrackData(
  points: any[] | undefined,
  rawFileDetails: any,
  isVirtualHint: boolean = false
): string | undefined {
  // 1. Prefer raw metadata timestamps (GPX <metadata><time>, FIT session/activity/file_id)
  // because they remain authentic even if point timestamps were previously shifted during legacy imports.
  const rawRecords = rawFileDetails?.metadata?.rawRecords;
  if (Array.isArray(rawRecords)) {
    const priorityTypes = ['metadata_time', 'session', 'activity', 'file_id'];
    for (const pType of priorityTypes) {
      for (const rec of rawRecords) {
        if (!rec || rec.type !== pType || !rec.data || typeof rec.data !== 'object') continue;
        const candidate =
          parsePlausibleIsoDate(rec.data.start_time) ||
          parsePlausibleIsoDate(rec.data.timestamp) ||
          parsePlausibleIsoDate(rec.data.time_created) ||
          parsePlausibleIsoDate(rec.data.local_timestamp);
        if (candidate) {
          return candidate.toISOString();
        }
      }
    }
  }

  // 2. Otherwise inspect earliest valid point timestamp (skip synthetic virtual routes unless they carry genuine times)
  if (!isVirtualHint && Array.isArray(points) && points.length > 0) {
    for (let i = 0; i < Math.min(points.length, 50); i++) {
      const pt = points[i];
      if (!pt) continue;
      const candidate = parsePlausibleIsoDate(pt.time) || parsePlausibleIsoDate(pt.timestamp);
      if (candidate) {
        return candidate.toISOString();
      }
    }
  }

  return undefined;
}

export function repairStoredActivityDates(): { repairedTracks: number; repairedGarmin: number } {
  return executeWithCorruptionRecovery(() => {
    let repairedTracks = 0;
    let repairedGarmin = 0;

    const rows = db
      .prepare('SELECT id, name, date_created, tags, points_json, raw_file_json FROM tracks')
      .all() as {
      id: string;
      name: string;
      date_created: string | null;
      tags: string | null;
      points_json: string | null;
      raw_file_json: string | null;
    }[];

    const updateTrackDateStmt = db.prepare('UPDATE tracks SET date_created = ? WHERE id = ?');

    const repairTrx = db.transaction(() => {
      for (const row of rows) {
        const cleanId = stripScopedKey(row.id);
        // Preserve curated multi-stage Alpentour sequential dates intentionally assigned by seedTours
        if (cleanId.startsWith('gpx-alpentour-tag-')) continue;

        let pts: any[] = [];
        let rawDetails: any = undefined;
        try {
          if (row.points_json) pts = JSON.parse(row.points_json);
        } catch {}
        try {
          if (row.raw_file_json) rawDetails = JSON.parse(row.raw_file_json);
        } catch {}

        const isVirtualRow =
          (row.tags || '').toLowerCase().includes('indoor/virtuell') ||
          rawDetails?.metadata?.isVirtual === true;

        const authenticIso = extractAuthenticTimestampFromTrackData(pts, rawDetails, isVirtualRow);
        if (!authenticIso) continue;

        const stored = (row.date_created || '').trim();
        const isDateOnlyFallback = /^\d{4}-\d{2}-\d{2}$/.test(stored);
        const storedDatePart = stored.slice(0, 10);
        const authenticDatePart = authenticIso.slice(0, 10);

        // Repair if date_created was missing, stored as date-only fallback YYYY-MM-DD (previous saveTrack bug),
        // or its calendar date differs from the authentic recorded timestamp.
        if (!stored || isDateOnlyFallback || storedDatePart !== authenticDatePart) {
          updateTrackDateStmt.run(authenticIso, row.id);
          repairedTracks++;
        }
      }

      const garminRows = db
        .prepare('SELECT id, date, points_json FROM garmin_activities WHERE points_json IS NOT NULL')
        .all() as { id: string; date: string | null; points_json: string | null }[];
      const updateGarminDateStmt = db.prepare('UPDATE garmin_activities SET date = ? WHERE id = ?');

      for (const g of garminRows) {
        let pts: any[] = [];
        try {
          if (g.points_json) pts = JSON.parse(g.points_json);
        } catch {}
        if (!Array.isArray(pts) || pts.length < 2) continue;

        const firstPtDate = parsePlausibleIsoDate(pts[0]?.time) || parsePlausibleIsoDate(pts[0]?.timestamp);
        if (!firstPtDate) continue;

        const storedDate = parsePlausibleIsoDate(g.date);
        // Only overwrite Garmin local date if stored date is missing or > 24h newer than GPS points (import-date fallback)
        if (!storedDate || storedDate.getTime() - firstPtDate.getTime() > 24 * 3600 * 1000) {
          updateGarminDateStmt.run(firstPtDate.toISOString(), g.id);
          repairedGarmin++;
        }
      }
    });

    repairTrx();
    return { repairedTracks, repairedGarmin };
  });
}

export function normalizeUserId(userId?: string): string {
  const clean = typeof userId === 'string' ? userId.trim() : '';
  return clean || 'default';
}

export function toScopedKey(rawKey: string, userId?: string): string {
  const uid = normalizeUserId(userId);
  if (uid === 'default') return rawKey;
  const prefix = `${uid}::`;
  return rawKey.startsWith(prefix) ? rawKey : `${prefix}${rawKey}`;
}

export function stripScopedKey(scopedKey: string, userId?: string): string {
  if (!scopedKey || typeof scopedKey !== 'string') return '';
  const uid = normalizeUserId(userId);
  if (uid !== 'default') {
    const prefix = `${uid}::`;
    if (scopedKey.startsWith(prefix)) {
      return scopedKey.slice(prefix.length);
    }
  }
  const sepIdx = scopedKey.indexOf('::');
  if (sepIdx > 0 && scopedKey.startsWith('usr_')) {
    return scopedKey.slice(sepIdx + 2);
  }
  return scopedKey;
}

export interface DbUserRecord {
  id: string;
  provider?: string;
  provider_id: string;
  email: string;
  name: string;
  avatar_url?: string | null;
  created_at?: string;
  last_login_at?: string;
}

export function upsertOAuthUser(profile: {
  provider?: string;
  providerId: string;
  email: string;
  name: string;
  avatarUrl?: string;
}): DbUserRecord {
  return executeWithCorruptionRecovery(() => {
    const provider = profile.provider || 'local';
    const providerId = String(profile.providerId).trim().slice(0, 255);
    const email = String(profile.email || '').trim().toLowerCase().slice(0, 255);
    const name = String(profile.name || email.split('@')[0] || 'Nutzer').trim().slice(0, 255);
    const avatarUrl = profile.avatarUrl ? String(profile.avatarUrl).trim().slice(0, 1024) : null;

    const existing = db.prepare(
      'SELECT * FROM users WHERE provider = ? AND provider_id = ?'
    ).get(provider, providerId) as DbUserRecord | undefined;

    if (existing) {
      db.prepare(`
        UPDATE users
        SET email = ?, name = ?, avatar_url = COALESCE(?, avatar_url), last_login_at = strftime('%Y-%m-%d %H:%M:%f', 'now')
        WHERE id = ?
      `).run(email, name, avatarUrl, existing.id);

      ensureUserCuratedTours(existing.id);
      return db.prepare('SELECT * FROM users WHERE id = ?').get(existing.id) as DbUserRecord;
    }

    const digest = crypto.createHash('sha256').update(`${provider}:${providerId}`).digest('hex').slice(0, 20);
    const newId = `usr_${digest}`;

    db.prepare(`
      INSERT INTO users (id, provider, provider_id, email, name, avatar_url)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(newId, provider, providerId, email, name, avatarUrl);

    ensureUserCuratedTours(newId);
    return db.prepare('SELECT * FROM users WHERE id = ?').get(newId) as DbUserRecord;
  });
}

export function verifyAppPassword(candidate: unknown): boolean {
  if (typeof candidate !== 'string' || !candidate) return false;
  const expected = (process.env.APP_PASSWORD || 'mathias').trim() || 'mathias';
  const candidateHash = crypto.createHash('sha256').update(candidate.trim(), 'utf8').digest();
  const expectedHash = crypto.createHash('sha256').update(expected, 'utf8').digest();
  return crypto.timingSafeEqual(candidateHash, expectedHash);
}

export function createAuthSession(userId: string = 'default', ttlMs: number = 30 * 24 * 60 * 60 * 1000): {
  token: string;
  expiresAt: number;
} {
  return executeWithCorruptionRecovery(() => {
    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = Date.now() + ttlMs;
    const uid = normalizeUserId(userId);

    try {
      db.prepare('DELETE FROM auth_sessions WHERE expires_at < ?').run(Date.now());
    } catch {}

    db.prepare(`
      INSERT OR IGNORE INTO users (id, provider, provider_id, email, name)
      VALUES (?, 'password', ?, 'mathias@local', 'Mathias')
    `).run(uid, uid);

    db.prepare(`
      INSERT INTO auth_sessions (token, user_id, expires_at)
      VALUES (?, ?, ?)
    `).run(token, uid, expiresAt);

    return { token, expiresAt };
  });
}

export function verifyAuthSessionToken(token?: string | null): { valid: boolean; expiresAt?: number } {
  if (!token || typeof token !== 'string' || token.trim().length < 16) {
    return { valid: false };
  }
  return executeWithCorruptionRecovery(() => {
    const cleanToken = token.trim();
    const row = db.prepare(`
      SELECT token, expires_at
      FROM auth_sessions
      WHERE token = ? AND expires_at > ?
    `).get(cleanToken, Date.now()) as { token: string; expires_at: number } | undefined;

    if (!row) {
      return { valid: false };
    }
    return { valid: true, expiresAt: row.expires_at };
  });
}

export function getUserBySessionToken(token?: string | null): DbUserRecord | null {
  if (!token || typeof token !== 'string' || token.trim().length < 16) {
    return null;
  }
  return executeWithCorruptionRecovery(() => {
    const cleanToken = token.trim();
    const row = db.prepare(`
      SELECT u.*
      FROM auth_sessions s
      JOIN users u ON u.id = s.user_id
      WHERE s.token = ? AND s.expires_at > ?
    `).get(cleanToken, Date.now()) as DbUserRecord | undefined;

    return row || null;
  });
}

export function deleteAuthSession(token?: string | null): boolean {
  if (!token || typeof token !== 'string') return false;
  return executeWithCorruptionRecovery(() => {
    const info = db.prepare('DELETE FROM auth_sessions WHERE token = ?').run(token.trim());
    return info.changes > 0;
  });
}

export function ensureUserCuratedTours(userId: string): void {
  const uid = normalizeUserId(userId);
  if (uid === 'default') return;
  try {
    const alreadyInit = getSetting('curated_tours_initialized', '', uid);
    if (alreadyInit === 'true') return;

    const countRow = db.prepare('SELECT COUNT(*) as cnt FROM tracks WHERE user_id = ?').get(uid) as { cnt: number } | undefined;
    if (!countRow || countRow.cnt === 0) {
      seedCuratedTours(false, uid);
    }
    saveSetting('curated_tours_initialized', 'true', uid);
  } catch (e) {
    console.warn(`[DB] Could not initialize curated tours for user ${uid}:`, e);
  }
}

export function seedCuratedTours(force: boolean = false, userId: string = 'default'): { seeded: number; total: number } {
  const uid = normalizeUserId(userId);
  try {
    if (force) {
      if (uid === 'default') {
        db.prepare("DELETE FROM tracks WHERE (user_id = 'default' OR user_id IS NULL) AND (id LIKE 'tour-%' OR id LIKE 'curated-%' OR id LIKE 'gpx-%')").run();
      } else {
        db.prepare("DELETE FROM tracks WHERE user_id = ? AND (id LIKE ? OR id LIKE ? OR id LIKE ?)").run(
          uid,
          `${uid}::tour-%`,
          `${uid}::curated-%`,
          `${uid}::gpx-%`
        );
      }
    }
  } catch (e) {}

  const tours = getCuratedSeedTours();
  let seeded = 0;

  for (const tour of tours) {
    const scopedId = toScopedKey(tour.id, uid);
    if (!force) {
      const existing = db.prepare('SELECT id FROM tracks WHERE id = ? AND user_id = ?').get(scopedId, uid);
      if (existing) {
        seeded++;
        continue;
      }
    }

    saveTrack({
      id: tour.id,
      name: tour.name,
      distance: tour.distance,
      ascent: tour.ascent,
      descent: tour.descent,
      duration: tour.duration,
      activityType: tour.activityType,
      description: tour.description,
      tags: Array.isArray(tour.tags) ? tour.tags.join(', ') : tour.tags,
      dateCreated: tour.dateCreated,
      originalFilename: tour.originalFilename,
      points: tour.points,
      powerStats: tour.powerStats,
      surfaceStats: tour.surfaceStats,
      climbs: tour.climbs,
      maxSlope: tour.maxSlope,
      color: tour.color,
      hasTimestamps: tour.hasTimestamps
    }, uid);
    seeded++;
  }

  console.log(`GPX folder tours loaded for user ${uid}: ${seeded} of ${tours.length}`);
  return { seeded, total: tours.length };
}

export function downsamplePoints(points: any[], maxPoints: number = 1000): any[] {
  if (!points || !Array.isArray(points) || points.length <= maxPoints) {
    return points;
  }
  
  const len = points.length;
  const keep: any[] = [];
  const factor = (len - 1) / (maxPoints - 1);
  
  keep.push(points[0]);
  for (let i = 1; i < maxPoints - 1; i++) {
    const idx = Math.round(i * factor);
    if (idx > 0 && idx < len - 1) {
      keep.push(points[idx]);
    }
  }
  keep.push(points[len - 1]);
  return keep;
}

export function saveTrack(track: {
  id: string;
  name: string;
  distance: number;
  ascent: number;
  descent: number;
  duration?: number;
  activityType?: string;
  description?: string;
  tags?: string;
  dateCreated?: string;
  originalFilename?: string;
  points: any[];
  powerStats?: any;
  surfaceStats?: any[];
  climbs?: any[];
  maxSlope?: number;
  color?: string;
  hasTimestamps?: boolean;
  rawFileDetails?: any;
}, userId: string = 'default') {
  return executeWithCorruptionRecovery(() => {
    const uid = normalizeUserId(userId);
    const cleanRawId = stripScopedKey(track.id, uid);
    const scopedId = toScopedKey(cleanRawId, uid);

    const statement = db.prepare(`
      INSERT OR REPLACE INTO tracks (
        id, name, distance, ascent, descent, duration, activity_type,
        description, tags, date_created, points_json, power_stats_json,
        surface_stats_json, climbs_json, original_filename, max_slope,
        color, has_timestamps, raw_file_json, user_id
      ) VALUES (
        ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
      )
    `);

    const tagsStr = track.tags || '';
    const isVirtualHint =
      tagsStr.toLowerCase().includes('indoor/virtuell') ||
      track.rawFileDetails?.metadata?.isVirtual === true;
    const explicitDate =
      typeof track.dateCreated === 'string' && track.dateCreated.trim().length >= 8
        ? track.dateCreated.trim()
        : undefined;
    const inferredDate = extractAuthenticTimestampFromTrackData(
      track.points,
      track.rawFileDetails,
      isVirtualHint
    );
    const dateStr = explicitDate || inferredDate || new Date().toISOString().split('T')[0];

    statement.run(
      scopedId,
      track.name,
      track.distance,
      track.ascent,
      track.descent,
      track.duration || null,
      track.activityType || 'cycling',
      track.description || '',
      tagsStr,
      dateStr,
      JSON.stringify(track.points),
      track.powerStats ? JSON.stringify(track.powerStats) : null,
      track.surfaceStats ? JSON.stringify(track.surfaceStats) : null,
      track.climbs ? JSON.stringify(track.climbs) : null,
      track.originalFilename || null,
      track.maxSlope !== undefined && track.maxSlope !== null ? parseFloat(String(track.maxSlope)) : null,
      track.color || null,
      track.hasTimestamps ? 1 : 0,
      track.rawFileDetails ? JSON.stringify(track.rawFileDetails) : null,
      uid
    );

    return cleanRawId;
  });
}

export function searchTracks(queryText: string = '', activityType?: string, userId: string = 'default'): DbTrackRecord[] {
  return executeWithCorruptionRecovery(() => {
    const uid = normalizeUserId(userId);
    if (uid !== 'default') {
      ensureUserCuratedTours(uid);
    }

    let sql = `SELECT id, name, distance, ascent, descent, duration, activity_type, description, tags, date_created, original_filename, max_slope, color, has_timestamps, surface_stats_json, raw_file_json FROM tracks`;
    const conditions: string[] = [`user_id = ?`];
    const params: any[] = [uid];

    const cleanActivity = activityType && typeof activityType === 'string' ? activityType.slice(0, 50) : undefined;
    if (cleanActivity && cleanActivity !== 'all') {
      conditions.push(`activity_type = ?`);
      params.push(cleanActivity);
    }

    const cleanQuery = typeof queryText === 'string' ? queryText.trim().slice(0, 128) : '';
    if (cleanQuery) {
      const term = `%${cleanQuery}%`;
      conditions.push(`(name LIKE ? OR description LIKE ? OR tags LIKE ? OR original_filename LIKE ?)`);
      params.push(term, term, term, term);
    }

    if (conditions.length > 0) {
      sql += ` WHERE ` + conditions.join(' AND ');
    }

    sql += ` ORDER BY date_created DESC, name ASC`;

    const rows = db.prepare(sql).all(...params) as DbTrackRecord[];
    return rows.map(r => ({
      ...r,
      id: stripScopedKey(r.id, uid)
    }));
  });
}

export function getAllTracksFull(limit: number = 20, userId: string = 'default'): DbTrackRecord[] {
  return executeWithCorruptionRecovery(() => {
    const uid = normalizeUserId(userId);
    if (uid !== 'default') {
      ensureUserCuratedTours(uid);
    }
    const statement = db.prepare('SELECT * FROM tracks WHERE user_id = ? AND points_json IS NOT NULL ORDER BY date_created DESC, name ASC LIMIT ?');
    const rows = statement.all(uid, limit) as DbTrackRecord[];
    return rows.map(r => ({
      ...r,
      id: stripScopedKey(r.id, uid)
    }));
  });
}

export function getTrackDetails(id: string, userId: string = 'default'): DbTrackRecord | null {
  return executeWithCorruptionRecovery(() => {
    const uid = normalizeUserId(userId);
    const cleanId = stripScopedKey(id, uid);
    const scopedId = toScopedKey(cleanId, uid);
    const statement = db.prepare('SELECT * FROM tracks WHERE (id = ? OR id = ?) AND user_id = ?');
    const record = statement.get(scopedId, cleanId, uid) as DbTrackRecord | undefined;
    if (!record) return null;
    return {
      ...record,
      id: stripScopedKey(record.id, uid)
    };
  });
}

export function updateTrackMetadata(id: string, metadata: {
  name: string;
  description?: string;
  tags?: string;
  activityType?: string;
  dateCreated?: string;
}, userId: string = 'default') {
  return executeWithCorruptionRecovery(() => {
    const uid = normalizeUserId(userId);
    const cleanId = stripScopedKey(id, uid);
    const scopedId = toScopedKey(cleanId, uid);
    const statement = db.prepare(`
      UPDATE tracks 
      SET name = ?, description = ?, tags = ?, activity_type = ?, date_created = ?
      WHERE (id = ? OR id = ?) AND user_id = ?
    `);

    statement.run(
      metadata.name,
      metadata.description || '',
      metadata.tags || '',
      metadata.activityType || 'cycling',
      metadata.dateCreated || new Date().toISOString().split('T')[0],
      scopedId,
      cleanId,
      uid
    );
  });
}

export function deleteTrack(id: string, userId: string = 'default'): boolean {
  return executeWithCorruptionRecovery(() => {
    const uid = normalizeUserId(userId);
    const cleanId = stripScopedKey(id, uid);
    const scopedId = toScopedKey(cleanId, uid);
    const statement = db.prepare('DELETE FROM tracks WHERE (id = ? OR id = ?) AND user_id = ?');
    const info = statement.run(scopedId, cleanId, uid);
    return info.changes > 0;
  });
}

export function clearAllTracks(userId: string = 'default'): number {
  return executeWithCorruptionRecovery(() => {
    const uid = normalizeUserId(userId);
    const count = (db.prepare('SELECT COUNT(*) as count FROM tracks WHERE user_id = ?').get(uid) as { count: number }).count;
    db.prepare('DELETE FROM tracks WHERE user_id = ?').run(uid);
    return count;
  });
}

export function getTracksInBounds(minLat: number, maxLat: number, minLng: number, maxLng: number, userId: string = 'default'): DbTrackRecord[] {
  return executeWithCorruptionRecovery(() => {
    const uid = normalizeUserId(userId);
    const statement = db.prepare('SELECT id, name, distance, ascent, descent, duration, activity_type, description, tags, date_created, original_filename, max_slope, color, has_timestamps, points_json, raw_file_json FROM tracks WHERE user_id = ?');
    const allTracks = statement.all(uid) as DbTrackRecord[];
    
    return allTracks.filter(track => {
      try {
        const points = JSON.parse(track.points_json);
        if (!Array.isArray(points)) return false;
        return points.some(pt => 
          pt.lat >= minLat && pt.lat <= maxLat && 
          pt.lng >= minLng && pt.lng <= maxLng
        );
      } catch (e) {
        return false;
      }
    }).map(r => ({
      ...r,
      id: stripScopedKey(r.id, uid)
    }));
  });
}

export function getGarminActivitiesInBounds(minLat: number, maxLat: number, minLng: number, maxLng: number, userId: string = 'default'): DbGarminActivityRecord[] {
  return executeWithCorruptionRecovery(() => {
    const uid = normalizeUserId(userId);
    const statement = db.prepare('SELECT * FROM garmin_activities WHERE user_id = ?');
    const allActivities = statement.all(uid) as DbGarminActivityRecord[];
    
    return allActivities.filter(act => {
      try {
        if (!act.points_json) return false;
        const points = JSON.parse(act.points_json);
        if (!Array.isArray(points)) return false;
        return points.some(pt => {
          let lat: number | undefined;
          let lng: number | undefined;
          if (Array.isArray(pt)) {
            lat = pt[1] !== undefined ? parseFloat(pt[1]) : undefined;
            lng = pt[0] !== undefined ? parseFloat(pt[0]) : undefined;
          } else if (pt && typeof pt === 'object') {
            lat = pt.lat !== undefined ? parseFloat(pt.lat) : (pt.latitude !== undefined ? parseFloat(pt.latitude) : undefined);
            lng = pt.lng !== undefined ? parseFloat(pt.lng) : (pt.longitude !== undefined ? parseFloat(pt.longitude) : undefined);
          }
          if (lat === undefined || lng === undefined || isNaN(lat) || isNaN(lng)) return false;
          return lat >= minLat && lat <= maxLat && lng >= minLng && lng <= maxLng;
        });
      } catch (e) {
        return false;
      }
    }).map(act => ({
      ...act,
      id: stripScopedKey(act.id, uid)
    }));
  });
}

// Garmin Health Metrics storage operations
export function saveSleep(date: string, duration: number, deep?: number, light?: number, rem?: number, awake?: number, userId: string = 'default') {
  const uid = normalizeUserId(userId);
  const cleanDate = stripScopedKey(date, uid);
  const scopedDate = toScopedKey(cleanDate, uid);
  const stmt = db.prepare(`
    INSERT OR REPLACE INTO garmin_sleep (date, duration, deep, light, rem, awake, user_id)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  stmt.run(scopedDate, duration, deep || null, light || null, rem || null, awake || null, uid);
}

export function saveWeight(date: string, weight: number, bmi?: number, bodyFat?: number, userId: string = 'default') {
  const uid = normalizeUserId(userId);
  const cleanDate = stripScopedKey(date, uid);
  const scopedDate = toScopedKey(cleanDate, uid);
  const stmt = db.prepare(`
    INSERT OR REPLACE INTO garmin_weight (date, weight, bmi, body_fat, user_id)
    VALUES (?, ?, ?, ?, ?)
  `);
  stmt.run(scopedDate, weight, bmi || null, bodyFat || null, uid);
}

export function saveStress(date: string, avgStress: number, userId: string = 'default') {
  const uid = normalizeUserId(userId);
  const cleanDate = stripScopedKey(date, uid);
  const scopedDate = toScopedKey(cleanDate, uid);
  const stmt = db.prepare(`
    INSERT OR REPLACE INTO garmin_stress (date, avg_stress, user_id)
    VALUES (?, ?, ?)
  `);
  stmt.run(scopedDate, avgStress, uid);
}

export function saveRhr(date: string, rhr: number, userId: string = 'default') {
  const uid = normalizeUserId(userId);
  const cleanDate = stripScopedKey(date, uid);
  const scopedDate = toScopedKey(cleanDate, uid);
  const stmt = db.prepare(`
    INSERT OR REPLACE INTO garmin_rhr (date, rhr, user_id)
    VALUES (?, ?, ?)
  `);
  stmt.run(scopedDate, rhr, uid);
}

export function saveSteps(date: string, steps: number, calories?: number, distance?: number, userId: string = 'default') {
  const uid = normalizeUserId(userId);
  const cleanDate = stripScopedKey(date, uid);
  const scopedDate = toScopedKey(cleanDate, uid);
  const stmt = db.prepare(`
    INSERT OR REPLACE INTO garmin_steps (date, steps, calories, distance, user_id)
    VALUES (?, ?, ?, ?, ?)
  `);
  stmt.run(scopedDate, steps, calories || null, distance || null, uid);
}

export function saveGarminActivity(
  id: string, name: string, type: string, date: string,
  distance: number, duration: number, ascent?: number, descent?: number,
  calories?: number, avgHr?: number, description?: string, location?: string,
  pointsJson?: string, userId: string = 'default'
) {
  const uid = normalizeUserId(userId);
  const cleanId = stripScopedKey(id, uid);
  const scopedId = toScopedKey(cleanId, uid);
  const finalPointsJson = pointsJson || null;

  const stmt = db.prepare(`
    INSERT OR REPLACE INTO garmin_activities (id, name, type, date, distance, duration, ascent, descent, calories, avg_hr, description, location, points_json, user_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  stmt.run(
    scopedId, name, type, date, distance, duration, 
    ascent !== undefined ? ascent : null, 
    descent !== undefined ? descent : null, 
    calories !== undefined ? calories : null, 
    avgHr !== undefined ? avgHr : null, 
    description || null, 
    location || null,
    finalPointsJson,
    uid
  );
}

export function claimUnassignedGarminDataForUser(userId?: string): void {
  const uid = normalizeUserId(userId);
  if (uid === 'default') return;

  executeWithCorruptionRecovery(() => {
    const trx = db.transaction(() => {
      const dateTables = ['garmin_sleep', 'garmin_weight', 'garmin_stress', 'garmin_rhr', 'garmin_steps'];
      for (const tbl of dateTables) {
        const rows = db.prepare(`SELECT * FROM ${tbl} WHERE user_id IS NULL OR user_id = 'default'`).all() as any[];
        for (const row of rows) {
          const rawDate = stripScopedKey(String(row.date || ''), uid);
          if (!rawDate) continue;
          const scopedDate = toScopedKey(rawDate, uid);
          db.prepare(`DELETE FROM ${tbl} WHERE date = ? AND user_id = ?`).run(scopedDate, uid);
          db.prepare(`UPDATE ${tbl} SET date = ?, user_id = ? WHERE date = ? AND (user_id IS NULL OR user_id = 'default')`).run(scopedDate, uid, row.date);
        }
      }

      const actRows = db.prepare(`SELECT id FROM garmin_activities WHERE user_id IS NULL OR user_id = 'default'`).all() as { id: string }[];
      for (const row of actRows) {
        const rawId = stripScopedKey(String(row.id || ''), uid);
        if (!rawId) continue;
        const scopedId = toScopedKey(rawId, uid);
        db.prepare(`DELETE FROM garmin_activities WHERE id = ? AND user_id = ?`).run(scopedId, uid);
        db.prepare(`UPDATE garmin_activities SET id = ?, user_id = ? WHERE id = ? AND (user_id IS NULL OR user_id = 'default')`).run(scopedId, uid, row.id);
      }
    });
    trx();
  });
}

export interface DbGarminActivityRecord {
  id: string;
  name: string;
  type: string;
  date: string;
  distance: number;
  duration: number;
  ascent?: number;
  descent?: number;
  calories?: number;
  avg_hr?: number;
  max_hr?: number;
  avg_temp?: number;
  description?: string;
  location?: string;
  max_slope?: number;
  points_json?: string;
  user_id?: string;
}

export interface GarminSearchFilterOptions {
  queryText?: string;
  activityType?: string;
  startDate?: string;
  endDate?: string;
  minDistance?: number;
  maxDistance?: number;
  minAscent?: number;
  hasGps?: boolean;
}

export function searchGarminActivities(
  queryText: string = '',
  activityType?: string,
  extraFilters?: Omit<GarminSearchFilterOptions, 'queryText' | 'activityType'>,
  userId: string = 'default'
): DbGarminActivityRecord[] {
  const uid = normalizeUserId(userId);
  let sql = `SELECT * FROM garmin_activities`;
  const conditions: string[] = [`user_id = ?`];
  const params: any[] = [uid];

  const cleanActivity = activityType && typeof activityType === 'string' ? activityType.slice(0, 50) : undefined;
  if (cleanActivity && cleanActivity !== 'all') {
    if (cleanActivity === 'cycling') {
      conditions.push(`(LOWER(type) LIKE '%cycle%' OR LOWER(type) LIKE '%bike%' OR LOWER(type) LIKE '%rad%' OR LOWER(type) = 'cycling')`);
    } else if (cleanActivity === 'running') {
      conditions.push(`(LOWER(type) LIKE '%run%' OR LOWER(type) LIKE '%lauf%' OR LOWER(type) = 'running')`);
    } else if (cleanActivity === 'hiking') {
      conditions.push(`(LOWER(type) LIKE '%hike%' OR LOWER(type) LIKE '%walk%' OR LOWER(type) LIKE '%wander%')`);
    } else {
      conditions.push(`LOWER(type) LIKE ?`);
      params.push(`%${cleanActivity.toLowerCase()}%`);
    }
  }

  const cleanQuery = typeof queryText === 'string' ? queryText.trim().slice(0, 128) : '';
  if (cleanQuery) {
    const term = `%${cleanQuery}%`;
    conditions.push(`(name LIKE ? OR description LIKE ? OR location LIKE ? OR type LIKE ?)`);
    params.push(term, term, term, term);
  }

  if (extraFilters) {
    if (extraFilters.startDate && /^\d{4}-\d{2}-\d{2}/.test(extraFilters.startDate)) {
      conditions.push(`substr(date, 1, 10) >= ?`);
      params.push(extraFilters.startDate.slice(0, 10));
    }
    if (extraFilters.endDate && /^\d{4}-\d{2}-\d{2}/.test(extraFilters.endDate)) {
      conditions.push(`substr(date, 1, 10) <= ?`);
      params.push(extraFilters.endDate.slice(0, 10));
    }
    if (typeof extraFilters.minDistance === 'number' && !isNaN(extraFilters.minDistance) && extraFilters.minDistance > 0) {
      conditions.push(`distance >= ?`);
      params.push(extraFilters.minDistance);
    }
    if (typeof extraFilters.maxDistance === 'number' && !isNaN(extraFilters.maxDistance) && extraFilters.maxDistance > 0) {
      conditions.push(`distance <= ?`);
      params.push(extraFilters.maxDistance);
    }
    if (typeof extraFilters.minAscent === 'number' && !isNaN(extraFilters.minAscent) && extraFilters.minAscent > 0) {
      conditions.push(`COALESCE(ascent, 0) >= ?`);
      params.push(extraFilters.minAscent);
    }
    if (extraFilters.hasGps === true) {
      conditions.push(`points_json IS NOT NULL AND length(points_json) > 10`);
    }
  }

  if (conditions.length > 0) {
    sql += ` WHERE ` + conditions.join(' AND ');
  }

  sql += ` ORDER BY date DESC`;

  const activities = db.prepare(sql).all(...params) as DbGarminActivityRecord[];
  return activities.map(act => ({
    ...act,
    id: stripScopedKey(act.id, uid)
  }));
}

export function searchGarminHealthMetrics(startDate?: string, endDate?: string, userId: string = 'default') {
  const uid = normalizeUserId(userId);
  const startFilter = startDate && /^\d{4}-\d{2}-\d{2}/.test(startDate) ? startDate.slice(0, 10) : null;
  const endFilter = endDate && /^\d{4}-\d{2}-\d{2}/.test(endDate) ? endDate.slice(0, 10) : null;

  const queryTable = (tableName: string) => {
    const rows = db.prepare(`SELECT * FROM ${tableName} WHERE user_id = ?`).all(uid) as any[];
    return rows
      .map(r => ({
        ...r,
        date: stripScopedKey(String(r.date || ''), uid)
      }))
      .filter(r => {
        const d = r.date.slice(0, 10);
        if (startFilter && d < startFilter) return false;
        if (endFilter && d > endFilter) return false;
        return true;
      })
      .sort((a, b) => b.date.localeCompare(a.date));
  };

  return {
    sleep: queryTable('garmin_sleep'),
    weight: queryTable('garmin_weight'),
    stress: queryTable('garmin_stress'),
    rhr: queryTable('garmin_rhr'),
    steps: queryTable('garmin_steps')
  };
}


export function getGarminActivityById(id: string, userId: string = 'default'): DbGarminActivityRecord | null {
  try {
    const uid = normalizeUserId(userId);
    const cleanId = stripScopedKey(typeof id === 'string' ? id.slice(0, 128) : '', uid);
    const scopedId = toScopedKey(cleanId, uid);
    const row = db.prepare('SELECT * FROM garmin_activities WHERE (id = ? OR id = ?) AND user_id = ?').get(scopedId, cleanId, uid) as DbGarminActivityRecord | undefined;
    if (!row) return null;
    return {
      ...row,
      id: stripScopedKey(row.id, uid)
    };
  } catch (e) {
    console.error('Failed to get Garmin activity by ID:', e);
    return null;
  }
}

export function getHealthMetrics(userId: string = 'default') {
  const uid = normalizeUserId(userId);
  const normalizeDateRows = (tableName: string) => {
    const rows = db.prepare(`SELECT * FROM ${tableName} WHERE user_id = ?`).all(uid) as any[];
    return rows
      .map(r => ({ ...r, date: stripScopedKey(String(r.date || ''), uid) }))
      .sort((a, b) => a.date.localeCompare(b.date));
  };

  const sleep = normalizeDateRows('garmin_sleep');
  const weight = normalizeDateRows('garmin_weight');
  const stress = normalizeDateRows('garmin_stress');
  const rhr = normalizeDateRows('garmin_rhr');
  const steps = normalizeDateRows('garmin_steps');
  const activities = (db.prepare('SELECT * FROM garmin_activities WHERE user_id = ? ORDER BY date DESC').all(uid) as DbGarminActivityRecord[]).map(act => ({
    ...act,
    id: stripScopedKey(act.id, uid)
  }));

  return { sleep, weight, stress, rhr, steps, activities };
}

export function clearHealthMetrics(userId: string = 'default') {
  const uid = normalizeUserId(userId);
  db.prepare('DELETE FROM garmin_sleep WHERE user_id = ?').run(uid);
  db.prepare('DELETE FROM garmin_weight WHERE user_id = ?').run(uid);
  db.prepare('DELETE FROM garmin_stress WHERE user_id = ?').run(uid);
  db.prepare('DELETE FROM garmin_rhr WHERE user_id = ?').run(uid);
  db.prepare('DELETE FROM garmin_steps WHERE user_id = ?').run(uid);
  db.prepare('DELETE FROM garmin_activities WHERE user_id = ?').run(uid);
}

export function runInTransaction(fn: () => void) {
  const trx = db.transaction(fn);
  trx();
}

export interface AppVersionRecord {
  id: number;
  version: string;
  updated_at: string;
  changelog: string;
}

export function getAppVersions(): AppVersionRecord[] {
  try {
    return db.prepare('SELECT * FROM app_version ORDER BY id DESC').all() as AppVersionRecord[];
  } catch (e) {
    console.error('Failed to get app versions from DB:', e);
    return [];
  }
}

export function addAppVersion(version: string, changelog: string): boolean {
  try {
    const safeVer = String(version || '').slice(0, 32);
    const safeChangelog = String(changelog || '').slice(0, 50000);
    const stmt = db.prepare('INSERT OR REPLACE INTO app_version (version, updated_at, changelog) VALUES (?, ?, ?)');
    stmt.run(safeVer, new Date().toISOString(), safeChangelog);
    return true;
  } catch (e) {
    console.error('Failed to add/update app version in DB:', e);
    return false;
  }
}

const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const SENSITIVE_SETTINGS_KEYS = new Set([
  'garmin_personal_api_key',
  'garmin_personal_api_key_enc',
  'garmin_personal_api_base_url',
  'garmin_personal_token_expires_at'
]);

export function getSetting(key: string, defaultValue: string, userId: string = 'default'): string {
  try {
    if (!key || typeof key !== 'string' || FORBIDDEN_KEYS.has(key)) {
      return defaultValue;
    }
    const uid = normalizeUserId(userId);
    const cleanKey = key.slice(0, 128);

    const scopedRow = db.prepare('SELECT value FROM user_settings_scoped WHERE user_id = ? AND key = ?').get(uid, cleanKey) as { value: string } | undefined;
    if (scopedRow) {
      return scopedRow.value;
    }

    if (uid === 'default') {
      const row = db.prepare('SELECT value FROM user_settings WHERE key = ?').get(cleanKey) as { value: string } | undefined;
      return row ? row.value : defaultValue;
    }

    return defaultValue;
  } catch (e) {
    return defaultValue;
  }
}

export function saveSetting(key: string, value: string, userId: string = 'default'): boolean {
  try {
    if (!key || typeof key !== 'string' || FORBIDDEN_KEYS.has(key)) {
      return false;
    }
    const uid = normalizeUserId(userId);
    const cleanKey = key.slice(0, 128);
    const cleanValue = typeof value === 'string' ? value.slice(0, 50000) : String(value ?? '').slice(0, 50000);

    db.prepare(`
      INSERT OR REPLACE INTO user_settings_scoped (user_id, key, value, updated_at)
      VALUES (?, ?, ?, strftime('%Y-%m-%d %H:%M:%f', 'now'))
    `).run(uid, cleanKey, cleanValue);

    if (uid === 'default') {
      db.prepare('INSERT OR REPLACE INTO user_settings (key, value) VALUES (?, ?)').run(cleanKey, cleanValue);
    }
    return true;
  } catch (e) {
    console.error(`Failed to save setting ${key}:`, e);
    return false;
  }
}

export function deleteSetting(key: string, userId: string = 'default'): boolean {
  try {
    if (!key || typeof key !== 'string' || FORBIDDEN_KEYS.has(key)) {
      return false;
    }
    const uid = normalizeUserId(userId);
    const cleanKey = key.slice(0, 128);
    const infoScoped = db.prepare('DELETE FROM user_settings_scoped WHERE user_id = ? AND key = ?').run(uid, cleanKey);
    let changes = infoScoped.changes;

    if (uid === 'default') {
      const infoLegacy = db.prepare('DELETE FROM user_settings WHERE key = ?').run(cleanKey);
      changes += infoLegacy.changes;
    }
    return changes > 0;
  } catch (e) {
    console.error(`Failed to delete setting ${key}:`, e);
    return false;
  }
}

export function getAllSettings(userId: string = 'default'): Record<string, string> {
  try {
    const uid = normalizeUserId(userId);
    const settings: Record<string, string> = Object.create(null);

    if (uid === 'default') {
      const legacyRows = db.prepare('SELECT key, value FROM user_settings').all() as { key: string; value: string }[];
      for (const row of legacyRows) {
        if (row.key && typeof row.key === 'string' && !FORBIDDEN_KEYS.has(row.key) && !SENSITIVE_SETTINGS_KEYS.has(row.key)) {
          settings[row.key] = row.value;
        }
      }
    }

    const scopedRows = db.prepare('SELECT key, value FROM user_settings_scoped WHERE user_id = ?').all(uid) as { key: string; value: string }[];
    for (const row of scopedRows) {
      if (row.key && typeof row.key === 'string' && !FORBIDDEN_KEYS.has(row.key) && !SENSITIVE_SETTINGS_KEYS.has(row.key)) {
        settings[row.key] = row.value;
      }
    }
    return settings;
  } catch (e) {
    return Object.create(null);
  }
}

// ============================================================================
// HIGH-SPEED UNIFIED ACTIVITIES CATALOG (METADATA-ONLY QUERIES & BULK OPS)
// ============================================================================

export type CatalogSource = 'library' | 'garmin';
export type CatalogActivityCategory = 'cycling' | 'running' | 'hiking' | 'other';
export type CatalogSortBy =
  | 'date-desc'
  | 'date-asc'
  | 'distance-desc'
  | 'ascent-desc'
  | 'duration-desc'
  | 'name-asc';

export interface CatalogQueryOptions {
  q?: string;
  source?: 'all' | CatalogSource;
  activityType?: 'all' | CatalogActivityCategory;
  startDate?: string;
  endDate?: string;
  minDistance?: number;
  maxDistance?: number;
  minAscent?: number;
  hasGpsOnly?: boolean;
  sortBy?: CatalogSortBy;
  limit?: number;
  offset?: number;
}

export interface CatalogActivityItem {
  key: string; // `${source}:${id}`
  source: CatalogSource;
  id: string;
  workspaceTrackId: string;
  name: string;
  rawType: string;
  activityCategory: CatalogActivityCategory;
  timestampIso: string;
  monthKey: string;
  distanceKm: number;
  ascentM: number;
  descentM: number;
  durationSec: number;
  avgHr: number | null;
  calories: number | null;
  location: string;
  description: string;
  tags: string[];
  originalFilename: string;
  color: string;
  hasGps: boolean;
}

export interface CatalogMonthSummary {
  monthKey: string;
  count: number;
  totalDistanceKm: number;
  totalAscentM: number;
}

export interface CatalogQueryResult {
  items: CatalogActivityItem[];
  totalCount: number;
  databaseTotalCount: number;
  hasMore: boolean;
  summaryStats: {
    totalDistanceKm: number;
    totalAscentM: number;
    totalDurationSec: number;
    garminCount: number;
    libraryCount: number;
  };
  monthSummaries: CatalogMonthSummary[];
}

export interface CatalogActivityRef {
  source: CatalogSource;
  id: string;
}

const CATALOG_UNIFIED_CTE = `
  WITH unified_catalog AS (
    SELECT
      'library' AS source,
      id AS raw_id,
      COALESCE(NULLIF(TRIM(name), ''), 'Unbenannte Route') AS name,
      COALESCE(activity_type, 'cycling') AS raw_type,
      CASE
        WHEN LOWER(COALESCE(activity_type, '')) LIKE '%run%' OR LOWER(COALESCE(activity_type, '')) LIKE '%lauf%' OR LOWER(COALESCE(activity_type, '')) LIKE '%jog%' THEN 'running'
        WHEN LOWER(COALESCE(activity_type, '')) LIKE '%hike%' OR LOWER(COALESCE(activity_type, '')) LIKE '%walk%' OR LOWER(COALESCE(activity_type, '')) LIKE '%wander%' THEN 'hiking'
        WHEN LOWER(COALESCE(activity_type, '')) LIKE '%cycle%' OR LOWER(COALESCE(activity_type, '')) LIKE '%bike%' OR LOWER(COALESCE(activity_type, '')) LIKE '%rad%' OR LOWER(COALESCE(activity_type, '')) LIKE '%gravel%' OR LOWER(COALESCE(activity_type, '')) LIKE '%mtb%' THEN 'cycling'
        ELSE 'other'
      END AS activity_category,
      COALESCE(NULLIF(TRIM(date_created), ''), '') AS timestamp_iso,
      REPLACE(SUBSTR(COALESCE(NULLIF(TRIM(date_created), ''), '1970-01-01 00:00:00'), 1, 19), 'T', ' ') AS timestamp_sort,
      CASE
        WHEN LENGTH(TRIM(COALESCE(date_created, ''))) >= 7 AND SUBSTR(TRIM(date_created), 1, 4) GLOB '[0-9][0-9][0-9][0-9]'
        THEN SUBSTR(TRIM(date_created), 1, 7)
        ELSE 'unknown'
      END AS month_key,
      COALESCE(distance, 0) AS distance_km,
      COALESCE(ascent, 0) AS ascent_m,
      COALESCE(descent, 0) AS descent_m,
      COALESCE(duration, 0) AS duration_sec,
      NULL AS avg_hr,
      NULL AS calories,
      '' AS location,
      COALESCE(description, '') AS description,
      COALESCE(tags, '') AS tags,
      COALESCE(original_filename, '') AS original_filename,
      COALESCE(color, '#3b82f6') AS color,
      CASE
        WHEN points_json IS NOT NULL
          AND length(points_json) > 20
          AND LOWER(COALESCE(tags, '')) NOT LIKE '%indoor/virtuell%'
          AND LOWER(COALESCE(raw_file_json, '')) NOT LIKE '%"isvirtual":true%'
          AND (NOT json_valid(points_json) OR json_array_length(points_json) >= 2)
        THEN 1
        ELSE 0
      END AS has_gps
    FROM tracks
    WHERE user_id = ?

    UNION ALL

    SELECT
      'garmin' AS source,
      id AS raw_id,
      COALESCE(NULLIF(TRIM(name), ''), 'Garmin Aktivität') AS name,
      COALESCE(type, 'cycling') AS raw_type,
      CASE
        WHEN LOWER(COALESCE(type, '') || ' ' || COALESCE(name, '')) LIKE '%hike%'
          OR LOWER(COALESCE(type, '') || ' ' || COALESCE(name, '')) LIKE '%walk%'
          OR LOWER(COALESCE(type, '') || ' ' || COALESCE(name, '')) LIKE '%wander%' THEN 'hiking'
        WHEN LOWER(COALESCE(type, '') || ' ' || COALESCE(name, '')) LIKE '%run%'
          OR LOWER(COALESCE(type, '') || ' ' || COALESCE(name, '')) LIKE '%lauf%'
          OR LOWER(COALESCE(type, '') || ' ' || COALESCE(name, '')) LIKE '%jog%' THEN 'running'
        WHEN LOWER(COALESCE(type, '') || ' ' || COALESCE(name, '')) LIKE '%cycle%'
          OR LOWER(COALESCE(type, '') || ' ' || COALESCE(name, '')) LIKE '%bike%'
          OR LOWER(COALESCE(type, '') || ' ' || COALESCE(name, '')) LIKE '%rad%'
          OR LOWER(COALESCE(type, '') || ' ' || COALESCE(name, '')) LIKE '%gravel%'
          OR LOWER(COALESCE(type, '') || ' ' || COALESCE(name, '')) LIKE '%mtb%' THEN 'cycling'
        ELSE 'other'
      END AS activity_category,
      COALESCE(NULLIF(TRIM(date), ''), '') AS timestamp_iso,
      REPLACE(SUBSTR(COALESCE(NULLIF(TRIM(date), ''), '1970-01-01 00:00:00'), 1, 19), 'T', ' ') AS timestamp_sort,
      CASE
        WHEN LENGTH(TRIM(COALESCE(date, ''))) >= 7 AND SUBSTR(TRIM(date), 1, 4) GLOB '[0-9][0-9][0-9][0-9]'
        THEN SUBSTR(TRIM(date), 1, 7)
        ELSE 'unknown'
      END AS month_key,
      COALESCE(distance, 0) AS distance_km,
      COALESCE(ascent, 0) AS ascent_m,
      COALESCE(descent, 0) AS descent_m,
      COALESCE(duration, 0) AS duration_sec,
      avg_hr,
      calories,
      COALESCE(location, '') AS location,
      COALESCE(description, '') AS description,
      '' AS tags,
      '' AS original_filename,
      '#f97316' AS color,
      CASE
        WHEN points_json IS NOT NULL
          AND length(points_json) > 20
          AND (NOT json_valid(points_json) OR json_array_length(points_json) >= 2)
        THEN 1
        ELSE 0
      END AS has_gps
    FROM garmin_activities
    WHERE user_id = ?
  )
`;

function buildCatalogWhereClause(options: CatalogQueryOptions): { whereSql: string; params: any[] } {
  const conditions: string[] = [];
  const params: any[] = [];

  if (options.source === 'library' || options.source === 'garmin') {
    conditions.push(`source = ?`);
    params.push(options.source);
  }

  if (
    options.activityType === 'cycling' ||
    options.activityType === 'running' ||
    options.activityType === 'hiking' ||
    options.activityType === 'other'
  ) {
    conditions.push(`activity_category = ?`);
    params.push(options.activityType);
  }

  const rawQuery = typeof options.q === 'string' ? options.q.trim().slice(0, 160) : '';
  if (rawQuery) {
    const tokens = rawQuery.split(/\s+/).filter(Boolean).slice(0, 8);
    for (const token of tokens) {
      const pattern = `%${token.toLowerCase()}%`;
      conditions.push(
        `(LOWER(name) LIKE ? OR LOWER(location) LIKE ? OR LOWER(description) LIKE ? OR LOWER(tags) LIKE ? OR LOWER(original_filename) LIKE ? OR LOWER(raw_type) LIKE ?)`
      );
      params.push(pattern, pattern, pattern, pattern, pattern, pattern);
    }
  }

  if (options.startDate && /^\d{4}-\d{2}-\d{2}/.test(options.startDate)) {
    conditions.push(`SUBSTR(timestamp_sort, 1, 10) >= ?`);
    params.push(options.startDate.slice(0, 10));
  }

  if (options.endDate && /^\d{4}-\d{2}-\d{2}/.test(options.endDate)) {
    conditions.push(`SUBSTR(timestamp_sort, 1, 10) <= ?`);
    params.push(options.endDate.slice(0, 10));
  }

  if (typeof options.minDistance === 'number' && !isNaN(options.minDistance) && options.minDistance > 0) {
    conditions.push(`distance_km >= ?`);
    params.push(options.minDistance);
  }

  if (typeof options.maxDistance === 'number' && !isNaN(options.maxDistance) && options.maxDistance > 0) {
    conditions.push(`distance_km <= ?`);
    params.push(options.maxDistance);
  }

  if (typeof options.minAscent === 'number' && !isNaN(options.minAscent) && options.minAscent > 0) {
    conditions.push(`ascent_m >= ?`);
    params.push(options.minAscent);
  }

  if (options.hasGpsOnly === true) {
    conditions.push(`has_gps = 1`);
  }

  const whereSql = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  return { whereSql, params };
}

function getCatalogOrderBySql(sortBy?: CatalogSortBy): string {
  switch (sortBy) {
    case 'date-asc':
      return `timestamp_sort ASC, name COLLATE NOCASE ASC`;
    case 'distance-desc':
      return `distance_km DESC, timestamp_sort DESC`;
    case 'ascent-desc':
      return `ascent_m DESC, timestamp_sort DESC`;
    case 'duration-desc':
      return `duration_sec DESC, timestamp_sort DESC`;
    case 'name-asc':
      return `name COLLATE NOCASE ASC, timestamp_sort DESC`;
    case 'date-desc':
    default:
      return `timestamp_sort DESC, name COLLATE NOCASE ASC`;
  }
}

export function getTotalCatalogCount(userId: string = 'default'): number {
  return executeWithCorruptionRecovery(() => {
    const uid = normalizeUserId(userId);
    const row = db
      .prepare(
        `SELECT
          (SELECT COUNT(*) FROM tracks WHERE user_id = ?) +
          (SELECT COUNT(*) FROM garmin_activities WHERE user_id = ?) AS total`
      )
      .get(uid, uid) as { total: number } | undefined;
    return Number(row?.total || 0);
  });
}

export function queryActivitiesCatalog(
  options: CatalogQueryOptions = {},
  userId: string = 'default'
): CatalogQueryResult {
  return executeWithCorruptionRecovery(() => {
    const uid = normalizeUserId(userId);
    const limit = Math.min(500, Math.max(10, Math.round(Number(options.limit || 150))));
    const offset = Math.max(0, Math.round(Number(options.offset || 0)));

    const { whereSql, params } = buildCatalogWhereClause(options);
    const orderBySql = getCatalogOrderBySql(options.sortBy);
    const baseParams = [uid, uid, ...params];

    const databaseTotalCount = getTotalCatalogCount(uid);

    const summaryRow = db
      .prepare(
        `${CATALOG_UNIFIED_CTE}
         SELECT
           COUNT(*) AS total_count,
           COALESCE(SUM(distance_km), 0) AS total_distance_km,
           COALESCE(SUM(ascent_m), 0) AS total_ascent_m,
           COALESCE(SUM(duration_sec), 0) AS total_duration_sec,
           COALESCE(SUM(CASE WHEN source = 'garmin' THEN 1 ELSE 0 END), 0) AS garmin_count,
           COALESCE(SUM(CASE WHEN source = 'library' THEN 1 ELSE 0 END), 0) AS library_count
         FROM unified_catalog
         ${whereSql}`
      )
      .get(...baseParams) as any;

    const totalCount = Number(summaryRow?.total_count || 0);

    const monthRows = db
      .prepare(
        `${CATALOG_UNIFIED_CTE}
         SELECT
           month_key,
           COUNT(*) AS count,
           COALESCE(SUM(distance_km), 0) AS total_distance_km,
           COALESCE(SUM(ascent_m), 0) AS total_ascent_m
         FROM unified_catalog
         ${whereSql}
         GROUP BY month_key
         ORDER BY month_key DESC`
      )
      .all(...baseParams) as any[];

    const rawItems = db
      .prepare(
        `${CATALOG_UNIFIED_CTE}
         SELECT
           source,
           raw_id,
           name,
           raw_type,
           activity_category,
           timestamp_iso,
           month_key,
           distance_km,
           ascent_m,
           descent_m,
           duration_sec,
           avg_hr,
           calories,
           location,
           description,
           tags,
           original_filename,
           color,
           has_gps
         FROM unified_catalog
         ${whereSql}
         ORDER BY ${orderBySql}
         LIMIT ? OFFSET ?`
      )
      .all(...baseParams, limit, offset) as any[];

    const items: CatalogActivityItem[] = rawItems.map((r) => {
      const cleanId = stripScopedKey(String(r.raw_id || ''), uid);
      const source = r.source as CatalogSource;
      const tagsList =
        typeof r.tags === 'string' && r.tags.trim().length > 0
          ? r.tags
              .split(',')
              .map((t: string) => t.trim())
              .filter(Boolean)
          : [];

      return {
        key: `${source}:${cleanId}`,
        source,
        id: cleanId,
        workspaceTrackId: source === 'garmin' ? `garmin-act-${cleanId}` : cleanId,
        name: String(r.name || ''),
        rawType: String(r.raw_type || ''),
        activityCategory: (r.activity_category || 'other') as CatalogActivityCategory,
        timestampIso: String(r.timestamp_iso || ''),
        monthKey: String(r.month_key || 'unknown'),
        distanceKm: Number(r.distance_km || 0),
        ascentM: Math.round(Number(r.ascent_m || 0)),
        descentM: Math.round(Number(r.descent_m || 0)),
        durationSec: Math.round(Number(r.duration_sec || 0)),
        avgHr: r.avg_hr !== null && r.avg_hr !== undefined ? Math.round(Number(r.avg_hr)) : null,
        calories: r.calories !== null && r.calories !== undefined ? Math.round(Number(r.calories)) : null,
        location: String(r.location || ''),
        description: String(r.description || ''),
        tags: tagsList,
        originalFilename: String(r.original_filename || ''),
        color: String(r.color || (source === 'garmin' ? '#f97316' : '#3b82f6')),
        hasGps: r.has_gps === 1
      };
    });

    return {
      items,
      totalCount,
      databaseTotalCount,
      hasMore: offset + items.length < totalCount,
      summaryStats: {
        totalDistanceKm: Number(summaryRow?.total_distance_km || 0),
        totalAscentM: Math.round(Number(summaryRow?.total_ascent_m || 0)),
        totalDurationSec: Math.round(Number(summaryRow?.total_duration_sec || 0)),
        garminCount: Number(summaryRow?.garmin_count || 0),
        libraryCount: Number(summaryRow?.library_count || 0)
      },
      monthSummaries: monthRows.map((m) => ({
        monthKey: String(m.month_key || 'unknown'),
        count: Number(m.count || 0),
        totalDistanceKm: Number(m.total_distance_km || 0),
        totalAscentM: Math.round(Number(m.total_ascent_m || 0))
      }))
    };
  });
}

export function getFilteredActivityRefs(
  options: CatalogQueryOptions = {},
  maxLimit: number = 10000,
  userId: string = 'default'
): CatalogActivityRef[] {
  return executeWithCorruptionRecovery(() => {
    const uid = normalizeUserId(userId);
    const { whereSql, params } = buildCatalogWhereClause(options);
    const orderBySql = getCatalogOrderBySql(options.sortBy);
    const safeLimit = Math.min(20000, Math.max(1, Math.round(maxLimit)));

    const rows = db
      .prepare(
        `${CATALOG_UNIFIED_CTE}
         SELECT source, raw_id
         FROM unified_catalog
         ${whereSql}
         ORDER BY ${orderBySql}
         LIMIT ?`
      )
      .all(uid, uid, ...params, safeLimit) as { source: CatalogSource; raw_id: string }[];

    return rows.map((r) => ({
      source: r.source,
      id: stripScopedKey(String(r.raw_id || ''), uid)
    }));
  });
}

export function getActivitiesBulkFull(
  refs: CatalogActivityRef[],
  userId: string = 'default'
): { libraryRecords: DbTrackRecord[]; garminRecords: DbGarminActivityRecord[] } {
  return executeWithCorruptionRecovery(() => {
    const uid = normalizeUserId(userId);
    const libraryRecords: DbTrackRecord[] = [];
    const garminRecords: DbGarminActivityRecord[] = [];

    const libStmt = db.prepare('SELECT * FROM tracks WHERE (id = ? OR id = ?) AND user_id = ?');
    const garminStmt = db.prepare('SELECT * FROM garmin_activities WHERE (id = ? OR id = ?) AND user_id = ?');

    for (const ref of refs) {
      if (!ref || !ref.id) continue;
      const cleanId = stripScopedKey(String(ref.id).slice(0, 128), uid);
      const scopedId = toScopedKey(cleanId, uid);
      if (ref.source === 'library') {
        const rec = libStmt.get(scopedId, cleanId, uid) as DbTrackRecord | undefined;
        if (rec) {
          libraryRecords.push({
            ...rec,
            id: stripScopedKey(rec.id, uid)
          });
        }
      } else if (ref.source === 'garmin') {
        const rec = garminStmt.get(scopedId, cleanId, uid) as DbGarminActivityRecord | undefined;
        if (rec) {
          garminRecords.push({
            ...rec,
            id: stripScopedKey(rec.id, uid)
          });
        }
      }
    }

    return { libraryRecords, garminRecords };
  });
}

export function updateCatalogActivityMetadata(
  source: CatalogSource,
  id: string,
  metadata: {
    name: string;
    description?: string;
    tags?: string;
    activityType?: string;
    date?: string;
    location?: string;
  },
  userId: string = 'default'
): boolean {
  return executeWithCorruptionRecovery(() => {
    const uid = normalizeUserId(userId);
    const cleanId = stripScopedKey(id, uid);
    const scopedId = toScopedKey(cleanId, uid);

    if (source === 'library') {
      const info = db
        .prepare(
          `UPDATE tracks
           SET name = ?, description = ?, tags = ?, activity_type = ?, date_created = ?
           WHERE (id = ? OR id = ?) AND user_id = ?`
        )
        .run(
          metadata.name,
          metadata.description ?? '',
          metadata.tags ?? '',
          metadata.activityType || 'cycling',
          metadata.date || new Date().toISOString().split('T')[0],
          scopedId,
          cleanId,
          uid
        );
      return info.changes > 0;
    }

    const info = db
      .prepare(
        `UPDATE garmin_activities
         SET name = ?, description = ?, type = ?, date = ?, location = ?
         WHERE (id = ? OR id = ?) AND user_id = ?`
      )
      .run(
        metadata.name,
        metadata.description ?? null,
        metadata.activityType || 'cycling',
        metadata.date || new Date().toISOString().slice(0, 19).replace('T', ' '),
        metadata.location ?? null,
        scopedId,
        cleanId,
        uid
      );
    return info.changes > 0;
  });
}

export function bulkDeleteCatalogActivities(
  refs: CatalogActivityRef[],
  userId: string = 'default'
): number {
  return executeWithCorruptionRecovery(() => {
    if (!Array.isArray(refs) || refs.length === 0) return 0;
    const uid = normalizeUserId(userId);
    let deletedCount = 0;

    const trx = db.transaction((items: CatalogActivityRef[]) => {
      const delLib = db.prepare('DELETE FROM tracks WHERE (id = ? OR id = ?) AND user_id = ?');
      const delGarmin = db.prepare('DELETE FROM garmin_activities WHERE (id = ? OR id = ?) AND user_id = ?');

      for (const item of items) {
        if (!item || !item.id) continue;
        const cleanId = stripScopedKey(String(item.id).slice(0, 128), uid);
        const scopedId = toScopedKey(cleanId, uid);
        if (item.source === 'library') {
          deletedCount += delLib.run(scopedId, cleanId, uid).changes;
        } else if (item.source === 'garmin') {
          deletedCount += delGarmin.run(scopedId, cleanId, uid).changes;
        }
      }
    });

    trx(refs);
    return deletedCount;
  });
}
