import Database from 'better-sqlite3';
import path from 'path';

// Store the SQLite database file in the workdir root
const dbPath = path.join(process.cwd(), 'gpx_library.db');
const db = new Database(dbPath);

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
}

export function initDb() {
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
      has_timestamps INTEGER
    )
  `);

  // Run graceful schema migrations on existing database tables
  try {
    db.exec(`ALTER TABLE tracks ADD COLUMN max_slope REAL`);
  } catch (e) {
    // Column already exists, ignore
  }
  try {
    db.exec(`ALTER TABLE tracks ADD COLUMN color TEXT`);
  } catch (e) {
    // Column already exists, ignore
  }
  try {
    db.exec(`ALTER TABLE tracks ADD COLUMN has_timestamps INTEGER`);
  } catch (e) {
    // Column already exists, ignore
  }

  console.log('SQLite database initialized successfully at', dbPath);
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
}) {
  const statement = db.prepare(`
    INSERT OR REPLACE INTO tracks (
      id, name, distance, ascent, descent, duration, activity_type,
      description, tags, date_created, points_json, power_stats_json,
      surface_stats_json, climbs_json, original_filename, max_slope,
      color, has_timestamps
    ) VALUES (
      ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
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
    track.hasTimestamps ? 1 : 0
  );

  return track.id;
}

export function searchTracks(queryText: string = '', activityType?: string): DbTrackRecord[] {
  let sql = `SELECT id, name, distance, ascent, descent, duration, activity_type, description, tags, date_created, original_filename, max_slope, color, has_timestamps FROM tracks`;
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
  const statement = db.prepare('SELECT id, name, distance, ascent, descent, duration, activity_type, description, tags, date_created, original_filename, max_slope, color, has_timestamps, points_json FROM tracks');
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
