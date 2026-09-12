import { Result } from '../core/result';
import { ExternalServiceError } from '../errors/domainErrors';

export interface WeatherQueryDTO {
  readonly lat: number;
  readonly lng: number;
  readonly date?: string; // ISO date string YYYY-MM-DD
}

export interface HourlyWeatherDTO {
  readonly time: string;
  readonly tempC: number;
  readonly windSpeedKmh: number;
  readonly windDirectionDeg: number;
  readonly precipitationMm: number;
  readonly weatherCode: number;
}

export interface TrackWeatherSnapshotDTO {
  readonly latitude: number;
  readonly longitude: number;
  readonly hourly: readonly HourlyWeatherDTO[];
}

/**
 * Outbound Port: External Weather Provider Contract.
 */
export interface IWeatherService {
  fetchWeatherAtPoint(query: WeatherQueryDTO): Promise<Result<TrackWeatherSnapshotDTO, ExternalServiceError>>;
}
