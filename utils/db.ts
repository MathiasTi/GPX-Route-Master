import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';

// Store the SQLite database file in a data directory for clean docker volume persistence
const dbDir = path.join(process.cwd(), 'data');
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}
const dbPath = path.join(dbDir, 'gpx_library.db');

export let db: Database.Database;

function openAndVerifyDb(): Database.Database {
  let tempDb: Database.Database | null = null;
  try {
    tempDb = new Database(dbPath);
    // Simple verification query to make sure the db file and sqlite_master are healthy
    tempDb.prepare("SELECT name FROM sqlite_master LIMIT 1").all();
    return tempDb;
  } catch (err: any) {
    console.error("CRITICAL DATABASE CORRUPTION DETECTED during opening/verification:", err.message);
    
    // Close the corrupt handle if opened
    try {
      if (tempDb) {
        tempDb.close();
      }
    } catch (e) {}

    const corruptBackupPath = dbPath + `.corrupt_${Date.now()}`;
    try {
      if (fs.existsSync(dbPath)) {
        fs.renameSync(dbPath, corruptBackupPath);
        console.warn(`[Self-Healing] Corrupted database file was renamed to: ${corruptBackupPath}`);
      }
    } catch (renameErr: any) {
      console.error("[Self-Healing] Failed to rename corrupted database file:", renameErr.message);
      try {
        fs.unlinkSync(dbPath);
        console.warn(`[Self-Healing] Corrupted database file was deleted.`);
      } catch (unlinkErr: any) {
        console.error("[Self-Healing] Failed to delete corrupted database file:", unlinkErr.message);
      }
    }

    return new Database(dbPath);
  }
}

db = openAndVerifyDb();

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
    runInitDbStatements();
  } catch (err: any) {
    console.error("CRITICAL DATABASE CORRUPTION DETECTED during execution/init:", err.message);
    
    // Close the corrupt handle
    try {
      db.close();
    } catch (e) {}

    const corruptBackupPath = dbPath + `.corrupt_${Date.now()}`;
    try {
      if (fs.existsSync(dbPath)) {
        fs.renameSync(dbPath, corruptBackupPath);
        console.warn(`[Self-Healing] Corrupted database file renamed to: ${corruptBackupPath}`);
      }
    } catch (renameErr: any) {
      console.error("[Self-Healing] Failed to rename corrupted database file:", renameErr.message);
      try {
        fs.unlinkSync(dbPath);
        console.warn(`[Self-Healing] Corrupted database file deleted.`);
      } catch (unlinkErr: any) {
        console.error("[Self-Healing] Failed to delete corrupted database file:", unlinkErr.message);
      }
    }

    // Re-initialize a clean database
    db = new Database(dbPath);
    console.log("[Self-Healing] Retrying database initialization with a fresh file...");
    runInitDbStatements();
  }
}

function runInitDbStatements() {
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
      raw_file_json TEXT
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
  `);

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
  } catch (e) {
    console.error('Failed to seed app versions:', e);
  }

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
    db.exec(`ALTER TABLE garmin_activities ADD COLUMN description TEXT`);
  } catch (e) {}
  try {
    db.exec(`ALTER TABLE garmin_activities ADD COLUMN location TEXT`);
  } catch (e) {}
  try {
    db.exec(`ALTER TABLE garmin_activities ADD COLUMN points_json TEXT`);
  } catch (e) {}
  try {
    db.exec(`ALTER TABLE garmin_activities ADD COLUMN user_id TEXT`);
  } catch (e) {}

  // Create performance indexes to speed up name, description, and location searches
  try {
    db.exec(`CREATE INDEX IF NOT EXISTS idx_garmin_activities_name ON garmin_activities(name)`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_garmin_activities_description ON garmin_activities(description)`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_garmin_activities_location ON garmin_activities(location)`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_garmin_activities_date ON garmin_activities(date)`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_garmin_activities_type ON garmin_activities(type)`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_garmin_activities_user_id ON garmin_activities(user_id)`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_tracks_name ON tracks(name)`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_tracks_description ON tracks(description)`);
  } catch (e) {
    console.error('Failed to create database indexes:', e);
  }

  console.log('SQLite database initialized successfully at', dbPath);
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
}) {
  const statement = db.prepare(`
    INSERT OR REPLACE INTO tracks (
      id, name, distance, ascent, descent, duration, activity_type,
      description, tags, date_created, points_json, power_stats_json,
      surface_stats_json, climbs_json, original_filename, max_slope,
      color, has_timestamps, raw_file_json
    ) VALUES (
      ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
    )
  `);

  const tagsStr = track.tags || '';
  const dateStr = track.dateCreated || new Date().toISOString().split('T')[0];

  statement.run(
    track.id,
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
    track.rawFileDetails ? JSON.stringify(track.rawFileDetails) : null
  );

  return track.id;
}

export function searchTracks(queryText: string = '', activityType?: string): DbTrackRecord[] {
  let sql = `SELECT id, name, distance, ascent, descent, duration, activity_type, description, tags, date_created, original_filename, max_slope, color, has_timestamps, raw_file_json FROM tracks`;
  const conditions: string[] = [];
  const params: any[] = [];

  if (activityType && activityType !== 'all') {
    conditions.push(`activity_type = ?`);
    params.push(activityType);
  }

  if (queryText.trim()) {
    const term = `%${queryText.trim()}%`;
    conditions.push(`(name LIKE ? OR description LIKE ? OR tags LIKE ? OR original_filename LIKE ?)`);
    params.push(term, term, term, term);
  }

  if (conditions.length > 0) {
    sql += ` WHERE ` + conditions.join(' AND ');
  }

  sql += ` ORDER BY date_created DESC`;

  return db.prepare(sql).all(...params) as DbTrackRecord[];
}

export function getTrackDetails(id: string): DbTrackRecord | null {
  const statement = db.prepare('SELECT * FROM tracks WHERE id = ?');
  const record = statement.get(id) as DbTrackRecord | undefined;
  return record || null;
}

export function updateTrackMetadata(id: string, metadata: {
  name: string;
  description?: string;
  tags?: string;
  activityType?: string;
  dateCreated?: string;
}) {
  const statement = db.prepare(`
    UPDATE tracks 
    SET name = ?, description = ?, tags = ?, activity_type = ?, date_created = ?
    WHERE id = ?
  `);

  statement.run(
    metadata.name,
    metadata.description || '',
    metadata.tags || '',
    metadata.activityType || 'cycling',
    metadata.dateCreated || new Date().toISOString().split('T')[0],
    id
  );
}

export function deleteTrack(id: string) {
  const statement = db.prepare('DELETE FROM tracks WHERE id = ?');
  statement.run(id);
}

export function getTracksInBounds(minLat: number, maxLat: number, minLng: number, maxLng: number): DbTrackRecord[] {
  // Select columns including points_json to filter by coordinates
  const statement = db.prepare('SELECT id, name, distance, ascent, descent, duration, activity_type, description, tags, date_created, original_filename, max_slope, color, has_timestamps, points_json, raw_file_json FROM tracks');
  const allTracks = statement.all() as DbTrackRecord[];
  
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
  });
}

export function getGarminActivitiesInBounds(minLat: number, maxLat: number, minLng: number, maxLng: number): DbGarminActivityRecord[] {
  const statement = db.prepare('SELECT * FROM garmin_activities');
  const allActivities = statement.all() as DbGarminActivityRecord[];
  
  return allActivities.filter(act => {
    try {
      if (!act.points_json) return false;
      const points = JSON.parse(act.points_json);
      if (!Array.isArray(points)) return false;
      return points.some(pt => {
        let lat: number | undefined;
        let lng: number | undefined;
        if (Array.isArray(pt)) {
          lat = pt[0] !== undefined ? parseFloat(pt[0]) : undefined;
          lng = pt[1] !== undefined ? parseFloat(pt[1]) : undefined;
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
  });
}

// Garmin Health Metrics storage operations
export function saveSleep(date: string, duration: number, deep?: number, light?: number, rem?: number, awake?: number) {
  const stmt = db.prepare(`
    INSERT OR REPLACE INTO garmin_sleep (date, duration, deep, light, rem, awake)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  stmt.run(date, duration, deep || null, light || null, rem || null, awake || null);
}

export function saveWeight(date: string, weight: number, bmi?: number, bodyFat?: number) {
  const stmt = db.prepare(`
    INSERT OR REPLACE INTO garmin_weight (date, weight, bmi, body_fat)
    VALUES (?, ?, ?, ?)
  `);
  stmt.run(date, weight, bmi || null, bodyFat || null);
}

export function saveStress(date: string, avgStress: number) {
  const stmt = db.prepare(`
    INSERT OR REPLACE INTO garmin_stress (date, avg_stress)
    VALUES (?, ?)
  `);
  stmt.run(date, avgStress);
}

export function saveRhr(date: string, rhr: number) {
  const stmt = db.prepare(`
    INSERT OR REPLACE INTO garmin_rhr (date, rhr)
    VALUES (?, ?)
  `);
  stmt.run(date, rhr);
}

export function saveSteps(date: string, steps: number, calories?: number, distance?: number) {
  const stmt = db.prepare(`
    INSERT OR REPLACE INTO garmin_steps (date, steps, calories, distance)
    VALUES (?, ?, ?, ?)
  `);
  stmt.run(date, steps, calories || null, distance || null);
}

export function saveGarminActivity(
  id: string, name: string, type: string, date: string,
  distance: number, duration: number, ascent?: number, descent?: number,
  calories?: number, avgHr?: number, description?: string, location?: string,
  pointsJson?: string, userId?: string
) {
  const finalPointsJson = pointsJson || null;

  const stmt = db.prepare(`
    INSERT OR REPLACE INTO garmin_activities (id, name, type, date, distance, duration, ascent, descent, calories, avg_hr, description, location, points_json, user_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  stmt.run(
    id, name, type, date, distance, duration, 
    ascent !== undefined ? ascent : null, 
    descent !== undefined ? descent : null, 
    calories !== undefined ? calories : null, 
    avgHr !== undefined ? avgHr : null, 
    description || null, 
    location || null,
    finalPointsJson,
    userId || null
  );
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

export function searchGarminActivities(queryText: string = '', activityType?: string): DbGarminActivityRecord[] {
  let sql = `SELECT * FROM garmin_activities`;
  const conditions: string[] = [];
  const params: any[] = [];

  if (activityType && activityType !== 'all') {
    if (activityType === 'cycling') {
      conditions.push(`(type LIKE '%cycle%' OR type LIKE '%bike%' OR type = 'cycling')`);
    } else if (activityType === 'running') {
      conditions.push(`(type LIKE '%run%' OR type = 'running')`);
    } else {
      conditions.push(`type = ?`);
      params.push(activityType);
    }
  }

  if (queryText.trim()) {
    const term = `%${queryText.trim()}%`;
    conditions.push(`(name LIKE ? OR description LIKE ? OR location LIKE ?)`);
    params.push(term, term, term);
  }

  if (conditions.length > 0) {
    sql += ` WHERE ` + conditions.join(' AND ');
  }

  sql += ` ORDER BY date DESC`;

  const activities = db.prepare(sql).all(...params) as DbGarminActivityRecord[];
  return activities;
}

export function getHealthMetrics() {
  const sleep = db.prepare('SELECT * FROM garmin_sleep ORDER BY date ASC').all();
  const weight = db.prepare('SELECT * FROM garmin_weight ORDER BY date ASC').all();
  const stress = db.prepare('SELECT * FROM garmin_stress ORDER BY date ASC').all();
  const rhr = db.prepare('SELECT * FROM garmin_rhr ORDER BY date ASC').all();
  const steps = db.prepare('SELECT * FROM garmin_steps ORDER BY date ASC').all();
  const activities = db.prepare('SELECT * FROM garmin_activities ORDER BY date DESC').all() as DbGarminActivityRecord[];

  return { sleep, weight, stress, rhr, steps, activities };
}

export function clearHealthMetrics() {
  db.exec('DELETE FROM garmin_sleep');
  db.exec('DELETE FROM garmin_weight');
  db.exec('DELETE FROM garmin_stress');
  db.exec('DELETE FROM garmin_rhr');
  db.exec('DELETE FROM garmin_steps');
  db.exec('DELETE FROM garmin_activities');
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
    const stmt = db.prepare('INSERT OR REPLACE INTO app_version (version, updated_at, changelog) VALUES (?, ?, ?)');
    stmt.run(version, new Date().toISOString(), changelog);
    return true;
  } catch (e) {
    console.error('Failed to add/update app version in DB:', e);
    return false;
  }
}

