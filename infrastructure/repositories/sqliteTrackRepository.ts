import type Database from 'better-sqlite3';
import { Result, ok, err } from '../../domain/core/result';
import { TrackEntity, DomainCoordinate } from '../../domain/entities/track.entity';
import { EntityNotFoundError, RepositoryError, ValidationError } from '../../domain/errors/domainErrors';
import { ITrackRepository, TrackSearchFilterDTO, TrackSummaryDTO } from '../../domain/ports/trackRepository.port';
import { db, getDb } from '../../utils/db';
import { safeJsonParse } from '../../domain/serialization/safeJson';

interface SqliteTrackRow {
  readonly id: string;
  readonly name: string;
  readonly distance: number;
  readonly ascent: number;
  readonly descent: number;
  readonly color: string | null;
  readonly duration: number | null;
  readonly activity_type: string | null;
  readonly points_json?: string;
  readonly tags?: string | null;
  readonly max_slope?: number | null;
}

export class SqliteTrackRepository implements ITrackRepository {
  private get database(): Database.Database {
    return this.customDb || getDb() || db;
  }

  constructor(private readonly customDb?: Database.Database) {}

  public async findById(id: string): Promise<Result<TrackEntity, EntityNotFoundError | RepositoryError>> {
    try {
      const stmt = this.database.prepare(`
        SELECT id, name, distance, ascent, descent, color, duration,
               activity_type, points_json, tags, max_slope
        FROM tracks
        WHERE id = ?
      `);
      const row = stmt.get(id) as SqliteTrackRow | undefined;

      if (!row) {
        return err(new EntityNotFoundError('Track', id));
      }

      let parsedPoints: DomainCoordinate[] = [];
      if (row.points_json) {
        const pointsParse = safeJsonParse<DomainCoordinate[]>(row.points_json, []);
        if (pointsParse.success && Array.isArray(pointsParse.data)) {
          parsedPoints = pointsParse.data;
        }
      }

      let tags: string[] | undefined;
      if (row.tags) {
        tags = row.tags.split(',').map(t => t.trim()).filter(Boolean);
      }

      const entityResult = TrackEntity.create({
        id: row.id,
        name: row.name,
        points: parsedPoints,
        color: row.color || '#3b82f6',
        distanceKm: row.distance,
        ascentM: row.ascent,
        descentM: row.descent,
        maxSlopePercent: row.max_slope ?? 0,
        visible: true,
        activityType: (row.activity_type === 'cycling' || row.activity_type === 'running') ? row.activity_type : undefined,
        durationSeconds: row.duration ?? undefined,
        tags
      });

      if (!entityResult.success) {
        return err(new RepositoryError(`Data corruption in track entity "${id}": ${entityResult.error.message}`, false, entityResult.error.details));
      }

      return ok(entityResult.data);
    } catch (sqliteErr: unknown) {
      const message = sqliteErr instanceof Error ? sqliteErr.message : String(sqliteErr);
      return err(new RepositoryError(`Failed to fetch track by id: ${message}`, true));
    }
  }

  public async findSummaries(filter?: TrackSearchFilterDTO): Promise<Result<readonly TrackSummaryDTO[], RepositoryError>> {
    try {
      let query = `
        SELECT id, name, distance, ascent, descent, color, duration, activity_type, points_json
        FROM tracks
        WHERE 1=1
      `;
      const params: unknown[] = [];

      if (filter?.query) {
        query += ` AND (name LIKE ? OR description LIKE ? OR tags LIKE ?)`;
        const wild = `%${filter.query}%`;
        params.push(wild, wild, wild);
      }

      if (filter?.activityType) {
        query += ` AND activity_type = ?`;
        params.push(filter.activityType);
      }

      query += ` ORDER BY date_created DESC LIMIT ? OFFSET ?`;
      params.push(filter?.limit ?? 100, filter?.offset ?? 0);

      const stmt = this.database.prepare(query);
      const rows = stmt.all(...params) as SqliteTrackRow[];

      const summaries: TrackSummaryDTO[] = rows.map((row) => {
        let pointCount = 0;
        if (row.points_json) {
          const parsed = safeJsonParse<unknown[]>(row.points_json, []);
          if (parsed.success && Array.isArray(parsed.data)) {
            pointCount = parsed.data.length;
          }
        }
        return {
          id: row.id,
          name: row.name,
          distanceKm: row.distance,
          ascentM: row.ascent,
          descentM: row.descent,
          pointCount,
          color: row.color || '#3b82f6',
          visible: true,
          activityType: (row.activity_type === 'cycling' || row.activity_type === 'running') ? row.activity_type : undefined,
          durationSeconds: row.duration ?? undefined
        };
      });

      return ok(summaries);
    } catch (sqliteErr: unknown) {
      const message = sqliteErr instanceof Error ? sqliteErr.message : String(sqliteErr);
      return err(new RepositoryError(`Failed to query track summaries: ${message}`, true));
    }
  }

  public async save(track: TrackEntity): Promise<Result<void, ValidationError | RepositoryError>> {
    try {
      const stmt = this.database.prepare(`
        INSERT INTO tracks (
          id, name, distance, ascent, descent, duration,
          activity_type, description, tags, points_json, max_slope, color,
          date_created
        ) VALUES (
          ?, ?, ?, ?, ?, ?,
          ?, '', ?, ?, ?, ?,
          strftime('%Y-%m-%d %H:%M:%f', 'now')
        )
        ON CONFLICT(id) DO UPDATE SET
          name = excluded.name,
          distance = excluded.distance,
          ascent = excluded.ascent,
          descent = excluded.descent,
          duration = excluded.duration,
          activity_type = excluded.activity_type,
          tags = excluded.tags,
          points_json = excluded.points_json,
          max_slope = excluded.max_slope,
          color = excluded.color
      `);

      stmt.run(
        track.id,
        track.name,
        track.distanceKm,
        track.ascentM,
        track.descentM,
        track.durationSeconds ?? null,
        track.activityType ?? 'cycling',
        track.tags ? track.tags.join(',') : '',
        JSON.stringify(track.points),
        track.maxSlopePercent,
        track.color
      );

      return ok(undefined);
    } catch (sqliteErr: unknown) {
      const message = sqliteErr instanceof Error ? sqliteErr.message : String(sqliteErr);
      return err(new RepositoryError(`Failed to save track: ${message}`, true));
    }
  }

  public async deleteById(id: string): Promise<Result<boolean, EntityNotFoundError | RepositoryError>> {
    try {
      const stmt = this.database.prepare(`DELETE FROM tracks WHERE id = ?`);
      const info = stmt.run(id);
      if (info.changes === 0) {
        return err(new EntityNotFoundError('Track', id));
      }
      return ok(true);
    } catch (sqliteErr: unknown) {
      const message = sqliteErr instanceof Error ? sqliteErr.message : String(sqliteErr);
      return err(new RepositoryError(`Failed to delete track "${id}": ${message}`, true));
    }
  }

  public async clearAll(): Promise<Result<number, RepositoryError>> {
    try {
      const stmt = this.database.prepare(`DELETE FROM tracks`);
      const info = stmt.run();
      return ok(info.changes);
    } catch (sqliteErr: unknown) {
      const message = sqliteErr instanceof Error ? sqliteErr.message : String(sqliteErr);
      return err(new RepositoryError(`Failed to clear tracks: ${message}`, true));
    }
  }
}
