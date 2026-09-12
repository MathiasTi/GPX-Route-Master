import { Result, ok, err } from '../core/result';
import { ValidationError } from '../errors/domainErrors';

export interface DomainCoordinate {
  readonly lat: number;
  readonly lng: number;
  readonly ele?: number;
  readonly time?: Date;
  readonly hr?: number;
  readonly power?: number;
  readonly cadence?: number;
  readonly speed?: number;
  readonly slope?: number;
  readonly dist?: number;
}

export interface TrackEntityProps {
  readonly id: string;
  readonly name: string;
  readonly points: readonly DomainCoordinate[];
  readonly color: string;
  readonly distanceKm: number;
  readonly ascentM: number;
  readonly descentM: number;
  readonly maxSlopePercent: number;
  readonly visible: boolean;
  readonly activityType?: 'cycling' | 'running';
  readonly durationSeconds?: number;
  readonly tags?: readonly string[];
}

/**
 * Pure Domain Entity representing a GPX/FIT Activity Track.
 * Invariants:
 * - ID must be non-empty string.
 * - Points must contain at least 2 valid coordinates.
 * - Distance, ascent, and descent must be non-negative.
 * - Invariant violations return typed Result.err(ValidationError).
 */
export class TrackEntity {
  private constructor(private readonly props: TrackEntityProps) {}

  public static create(props: TrackEntityProps): Result<TrackEntity, ValidationError> {
    if (!props.id || props.id.trim().length === 0) {
      return err(new ValidationError('Track id must not be empty.'));
    }
    if (!props.name || props.name.trim().length === 0) {
      return err(new ValidationError('Track name must not be empty.'));
    }
    if (!props.points || props.points.length < 2) {
      return err(new ValidationError('Track must contain at least 2 coordinate points.', { pointCount: props.points?.length ?? 0 }));
    }
    if (props.distanceKm < 0 || !Number.isFinite(props.distanceKm)) {
      return err(new ValidationError('Track distance must be a non-negative finite number.', { distanceKm: props.distanceKm }));
    }
    if (props.ascentM < 0 || !Number.isFinite(props.ascentM)) {
      return err(new ValidationError('Track ascent must be a non-negative finite number.', { ascentM: props.ascentM }));
    }
    if (props.descentM < 0 || !Number.isFinite(props.descentM)) {
      return err(new ValidationError('Track descent must be a non-negative finite number.', { descentM: props.descentM }));
    }

    // Validate coordinates boundaries
    for (let i = 0; i < props.points.length; i++) {
      const p = props.points[i];
      if (p.lat < -90 || p.lat > 90 || p.lng < -180 || p.lng > 180) {
        return err(new ValidationError(`Coordinate at index ${i} exceeds geographical bounds [-90,90] / [-180,180].`, { index: i, lat: p.lat, lng: p.lng }));
      }
    }

    return ok(new TrackEntity(Object.freeze({ ...props, points: Object.freeze([...props.points]) })));
  }

  get id(): string { return this.props.id; }
  get name(): string { return this.props.name; }
  get points(): readonly DomainCoordinate[] { return this.props.points; }
  get color(): string { return this.props.color; }
  get distanceKm(): number { return this.props.distanceKm; }
  get ascentM(): number { return this.props.ascentM; }
  get descentM(): number { return this.props.descentM; }
  get maxSlopePercent(): number { return this.props.maxSlopePercent; }
  get visible(): boolean { return this.props.visible; }
  get activityType(): 'cycling' | 'running' | undefined { return this.props.activityType; }
  get durationSeconds(): number | undefined { return this.props.durationSeconds; }
  get tags(): readonly string[] | undefined { return this.props.tags; }

  public withVisibility(visible: boolean): TrackEntity {
    return new TrackEntity({
      ...this.props,
      visible
    });
  }

  public withColor(color: string): TrackEntity {
    return new TrackEntity({
      ...this.props,
      color
    });
  }
}
