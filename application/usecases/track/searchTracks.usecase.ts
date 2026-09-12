import { Result, err } from '../../../domain/core/result';
import { RepositoryError, ValidationError } from '../../../domain/errors/domainErrors';
import { ITrackRepository, TrackSearchFilterDTO, TrackSummaryDTO } from '../../../domain/ports/trackRepository.port';

export class SearchTracksUseCase {
  constructor(private readonly trackRepo: ITrackRepository) {}

  public async execute(filter?: TrackSearchFilterDTO): Promise<Result<readonly TrackSummaryDTO[], ValidationError | RepositoryError>> {
    if (filter?.bounds) {
      const { minLat, maxLat, minLng, maxLng } = filter.bounds;
      if (minLat > maxLat || minLng > maxLng) {
        return err(new ValidationError('Invalid bounding box coordinates: min exceeds max.', { bounds: filter.bounds }));
      }
    }

    const sanitizedFilter: TrackSearchFilterDTO = {
      ...filter,
      query: filter?.query ? filter.query.trim().slice(0, 100) : undefined,
      limit: Math.min(Math.max(filter?.limit ?? 100, 1), 500)
    };

    return this.trackRepo.findSummaries(sanitizedFilter);
  }
}
