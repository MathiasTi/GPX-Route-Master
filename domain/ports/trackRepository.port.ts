import { Result } from '../core/result';
import { TrackEntity } from '../entities/track.entity';
import { EntityNotFoundError, RepositoryError, ValidationError } from '../errors/domainErrors';

export interface GeoBoundsDTO {
  readonly minLat: number;
  readonly maxLat: number;
  readonly minLng: number;
  readonly maxLng: number;
}

export interface TrackSummaryDTO {
  readonly id: string;
  readonly name: string;
  readonly distanceKm: number;
  readonly ascentM: number;
  readonly descentM: number;
  readonly pointCount: number;
  readonly activityType?: 'cycling' | 'running';
  readonly color: string;
  readonly visible: boolean;
  readonly durationSeconds?: number;
}

export interface TrackSearchFilterDTO {
  readonly query?: string;
  readonly activityType?: 'cycling' | 'running';
  readonly bounds?: GeoBoundsDTO;
  readonly limit?: number;
  readonly offset?: number;
}

/**
 * Outbound Port: Repository Contract for Track Persistence.
 * Concrete implementations reside in the Infrastructure layer.
 */
export interface ITrackRepository {
  findById(id: string): Promise<Result<TrackEntity, EntityNotFoundError | RepositoryError>>;
  findSummaries(filter?: TrackSearchFilterDTO): Promise<Result<readonly TrackSummaryDTO[], RepositoryError>>;
  save(track: TrackEntity): Promise<Result<void, ValidationError | RepositoryError>>;
  deleteById(id: string): Promise<Result<boolean, EntityNotFoundError | RepositoryError>>;
  clearAll(): Promise<Result<number, RepositoryError>>;
}
