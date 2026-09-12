import { Result, err } from '../../../domain/core/result';
import { TrackEntity } from '../../../domain/entities/track.entity';
import { EntityNotFoundError, RepositoryError, ValidationError } from '../../../domain/errors/domainErrors';
import { ITrackRepository } from '../../../domain/ports/trackRepository.port';

export class GetTrackByIdUseCase {
  constructor(private readonly trackRepo: ITrackRepository) {}

  public async execute(trackId: string): Promise<Result<TrackEntity, EntityNotFoundError | ValidationError | RepositoryError>> {
    if (!trackId || trackId.trim().length === 0) {
      return err(new ValidationError('trackId parameter must be a non-empty string.'));
    }

    return this.trackRepo.findById(trackId.trim());
  }
}
