import { Result, err } from '../../../domain/core/result';
import { TrackEntity, TrackEntityProps } from '../../../domain/entities/track.entity';
import { RepositoryError, ValidationError } from '../../../domain/errors/domainErrors';
import { ITrackRepository } from '../../../domain/ports/trackRepository.port';

export class SaveTrackUseCase {
  constructor(private readonly trackRepo: ITrackRepository) {}

  public async execute(props: TrackEntityProps): Promise<Result<TrackEntity, ValidationError | RepositoryError>> {
    const entityResult = TrackEntity.create(props);
    if (!entityResult.success) {
      return err(entityResult.error);
    }

    const saveResult = await this.trackRepo.save(entityResult.data);
    if (!saveResult.success) {
      return err(saveResult.error);
    }

    return entityResult;
  }
}
