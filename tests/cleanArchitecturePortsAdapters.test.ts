import Database from 'better-sqlite3';
import { ok, err, isOk, isErr } from '../domain/core/result';
import { TrackEntity, DomainCoordinate } from '../domain/entities/track.entity';
import { ValidationError, EntityNotFoundError, RepositoryError, DomainError } from '../domain/errors/domainErrors';
import { ITrackRepository, TrackSearchFilterDTO, TrackSummaryDTO } from '../domain/ports/trackRepository.port';
import { GetTrackByIdUseCase } from '../application/usecases/track/getTrackById.usecase';
import { SaveTrackUseCase } from '../application/usecases/track/saveTrack.usecase';
import { SearchTracksUseCase } from '../application/usecases/track/searchTracks.usecase';
import { SqliteTrackRepository } from '../infrastructure/repositories/sqliteTrackRepository';

/**
 * In-Memory Mock Adapter implementing outbound port ITrackRepository
 */
class InMemoryTrackRepository implements ITrackRepository {
  private readonly store = new Map<string, TrackEntity>();

  public async findById(id: string) {
    const track = this.store.get(id);
    if (!track) {
      return err(new EntityNotFoundError('Track', id));
    }
    return ok(track);
  }

  public async findSummaries(filter?: TrackSearchFilterDTO) {
    const summaries: TrackSummaryDTO[] = [];
    for (const track of this.store.values()) {
      if (filter?.query && !track.name.toLowerCase().includes(filter.query.toLowerCase())) {
        continue;
      }
      if (filter?.activityType && track.activityType !== filter.activityType) {
        continue;
      }
      summaries.push({
        id: track.id,
        name: track.name,
        distanceKm: track.distanceKm,
        ascentM: track.ascentM,
        descentM: track.descentM,
        pointCount: track.points.length,
        color: track.color,
        visible: track.visible,
        activityType: track.activityType,
        durationSeconds: track.durationSeconds
      });
    }
    return ok(summaries);
  }

  public async save(track: TrackEntity) {
    this.store.set(track.id, track);
    return ok(undefined);
  }

  public async deleteById(id: string) {
    if (!this.store.has(id)) {
      return err(new EntityNotFoundError('Track', id));
    }
    this.store.delete(id);
    return ok(true);
  }

  public async clearAll() {
    const count = this.store.size;
    this.store.clear();
    return ok(count);
  }
}

export async function runCleanArchitecturePortsAdaptersTests(): Promise<boolean> {
  console.log('🏛️ Running Ports and Adapters (Clean Architecture) Test Suite...');
  let passed = 0;
  let failed = 0;

  function assert(condition: boolean, msg: string) {
    if (condition) {
      console.log(`  ✓ ${msg}`);
      passed++;
    } else {
      console.error(`  ✗ FAIL: ${msg}`);
      failed++;
    }
  }

  // --- 1. Domain Error Hierarchy ---
  console.log('  --- 1. Domain Error Hierarchy ---');
  const valErr = new ValidationError('Bad input');
  assert(valErr instanceof DomainError, 'ValidationError inherits from DomainError');
  assert(valErr.code === 'VALIDATION_ERROR', 'ValidationError has correct code');
  assert(!valErr.isRetryable, 'ValidationError is not retryable');

  const notFoundErr = new EntityNotFoundError('Track', 'tr-999');
  assert(notFoundErr.code === 'ENTITY_NOT_FOUND', 'EntityNotFoundError has correct code');
  assert(notFoundErr.details?.entityId === 'tr-999', 'EntityNotFoundError preserves entity ID');

  const repoErr = new RepositoryError('DB Timeout', true);
  assert(repoErr.isRetryable, 'RepositoryError flags transient retryable state');

  // --- 2. Pure Domain Entity Invariants ---
  console.log('  --- 2. TrackEntity Invariant Enforcement ---');
  const validPoints: DomainCoordinate[] = [
    { lat: 47.123, lng: 11.456, ele: 600 },
    { lat: 47.130, lng: 11.465, ele: 750 }
  ];

  const emptyIdRes = TrackEntity.create({
    id: '',
    name: 'Sample Tour',
    points: validPoints,
    color: '#3b82f6',
    distanceKm: 12.5,
    ascentM: 350,
    descentM: 200,
    maxSlopePercent: 8.5,
    visible: true
  });
  assert(isErr(emptyIdRes) && emptyIdRes.error.code === 'VALIDATION_ERROR', 'TrackEntity rejects empty id');

  const tooFewPointsRes = TrackEntity.create({
    id: 'tr-1',
    name: 'Single Point Track',
    points: [{ lat: 47.1, lng: 11.2 }],
    color: '#3b82f6',
    distanceKm: 0,
    ascentM: 0,
    descentM: 0,
    maxSlopePercent: 0,
    visible: true
  });
  assert(isErr(tooFewPointsRes), 'TrackEntity rejects tracks with fewer than 2 points');

  const negativeDistRes = TrackEntity.create({
    id: 'tr-1',
    name: 'Negative Distance',
    points: validPoints,
    color: '#3b82f6',
    distanceKm: -5,
    ascentM: 0,
    descentM: 0,
    maxSlopePercent: 0,
    visible: true
  });
  assert(isErr(negativeDistRes), 'TrackEntity rejects negative distance');

  const invalidCoordsRes = TrackEntity.create({
    id: 'tr-1',
    name: 'Off Planet Track',
    points: [
      { lat: 105.0, lng: 11.2 }, // Invalid lat > 90
      { lat: 47.0, lng: 11.3 }
    ],
    color: '#3b82f6',
    distanceKm: 10,
    ascentM: 100,
    descentM: 100,
    maxSlopePercent: 5,
    visible: true
  });
  assert(isErr(invalidCoordsRes), 'TrackEntity validates geographical boundary [-90,90]');

  const validEntityRes = TrackEntity.create({
    id: 'tr-100',
    name: 'Alpine Pass',
    points: validPoints,
    color: '#10b981',
    distanceKm: 24.8,
    ascentM: 890,
    descentM: 450,
    maxSlopePercent: 12.4,
    visible: true,
    activityType: 'cycling',
    durationSeconds: 3600,
    tags: ['alps', 'climb']
  });
  assert(isOk(validEntityRes), 'TrackEntity creates valid domain object');
  if (isOk(validEntityRes)) {
    const track = validEntityRes.data;
    assert(track.id === 'tr-100', 'Getter id matches');
    assert(track.distanceKm === 24.8, 'Getter distanceKm matches');
    assert(track.points.length === 2, 'Points collection intact');

    // Immutability
    const hiddenTrack = track.withVisibility(false);
    assert(!hiddenTrack.visible, 'withVisibility immutably toggles visibility');
    assert(track.visible, 'Original entity remains immutable (visible=true)');
  }

  // --- 3. Application Use Cases with In-Memory Mock Port ---
  console.log('  --- 3. Application Use Cases (Hexagonal Architecture) ---');
  const mockRepo = new InMemoryTrackRepository();
  const getByIdUseCase = new GetTrackByIdUseCase(mockRepo);
  const saveUseCase = new SaveTrackUseCase(mockRepo);
  const searchUseCase = new SearchTracksUseCase(mockRepo);

  // 3.1 Get non-existent
  const missingRes = await getByIdUseCase.execute('not-found-id');
  assert(isErr(missingRes) && missingRes.error.code === 'ENTITY_NOT_FOUND', 'GetTrackByIdUseCase returns EntityNotFoundError on miss');

  // 3.2 Get empty param
  const invalidParamRes = await getByIdUseCase.execute('');
  assert(isErr(invalidParamRes) && invalidParamRes.error.code === 'VALIDATION_ERROR', 'GetTrackByIdUseCase validates non-empty id');

  // 3.3 Save track
  const saveRes = await saveUseCase.execute({
    id: 'tour-alpha',
    name: 'Alpha Lake Tour',
    points: validPoints,
    color: '#ef4444',
    distanceKm: 42.195,
    ascentM: 600,
    descentM: 600,
    maxSlopePercent: 7.2,
    visible: true,
    activityType: 'running'
  });
  assert(isOk(saveRes), 'SaveTrackUseCase succeeds with valid domain data');

  // 3.4 Retrieve saved track
  const retrievedRes = await getByIdUseCase.execute('tour-alpha');
  assert(isOk(retrievedRes) && retrievedRes.data.name === 'Alpha Lake Tour', 'GetTrackByIdUseCase retrieves saved track by port');

  // 3.5 Search with filter
  const searchRes = await searchUseCase.execute({ query: 'Alpha' });
  assert(isOk(searchRes) && searchRes.data.length === 1, 'SearchTracksUseCase finds matching track summary');

  // 3.6 Search with invalid bounds
  const badBoundsRes = await searchUseCase.execute({
    bounds: { minLat: 50, maxLat: 40, minLng: 10, maxLng: 20 }
  });
  assert(isErr(badBoundsRes) && badBoundsRes.error.code === 'VALIDATION_ERROR', 'SearchTracksUseCase rejects inverted bounds');

  // --- 4. Infrastructure SQLite Adapter Integration ---
  console.log('  --- 4. Infrastructure SQLite Adapter Contract Tests ---');
  const testDb = new Database(':memory:');
  testDb.exec(`
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
    );
  `);
  const sqliteRepo = new SqliteTrackRepository(testDb);

  if (isOk(validEntityRes)) {
    const sqliteSaveRes = await sqliteRepo.save(validEntityRes.data);
    assert(isOk(sqliteSaveRes), 'SqliteTrackRepository.save persists TrackEntity to database');

    const sqliteFetchRes = await sqliteRepo.findById(validEntityRes.data.id);
    assert(isOk(sqliteFetchRes) && sqliteFetchRes.data.id === validEntityRes.data.id, 'SqliteTrackRepository.findById retrieves entity correctly');

    const summariesRes = await sqliteRepo.findSummaries({ query: 'Alpine' });
    assert(isOk(summariesRes) && summariesRes.data.some(s => s.id === validEntityRes.data.id), 'SqliteTrackRepository.findSummaries locates saved track');

    const deleteRes = await sqliteRepo.deleteById(validEntityRes.data.id);
    assert(isOk(deleteRes) && deleteRes.data === true, 'SqliteTrackRepository.deleteById deletes entity');

    const deletedFetchRes = await sqliteRepo.findById(validEntityRes.data.id);
    assert(isErr(deletedFetchRes) && deletedFetchRes.error.code === 'ENTITY_NOT_FOUND', 'SqliteTrackRepository returns EntityNotFoundError after deletion');
  }

  return failed === 0;
}
