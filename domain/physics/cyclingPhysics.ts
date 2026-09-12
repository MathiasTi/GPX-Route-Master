import { Result, ok, err } from '../core/result';

export class PhysicsCalculationError extends Error {
  constructor(message: string, public readonly code: 'INVALID_WEIGHT' | 'INVALID_SPEED' | 'PHYSICAL_LIMIT_EXCEEDED') {
    super(message);
    this.name = 'PhysicsCalculationError';
  }
}

export interface PhysicsRideConditions {
  readonly riderWeightKg: number;
  readonly bikeWeightKg: number;
  readonly speedKmh: number;
  readonly gradientPercent: number;
  readonly crr?: number; // Rolling resistance coefficient (default 0.004)
  readonly cda?: number; // Aerodynamic drag area (default 0.32 m²)
  readonly windSpeedKmh?: number; // Headwind (+) / Tailwind (-)
  readonly airDensityKgM3?: number; // default 1.225 kg/m³
  readonly drivetrainLossPercent?: number; // default 3% (0.03)
}

export interface PowerBreakdownWatts {
  readonly gravityWatts: number;
  readonly rollingWatts: number;
  readonly aeroWatts: number;
  readonly drivetrainLossWatts: number;
  readonly totalWatts: number;
}

const GRAVITY_M_S2 = 9.80665;

/**
 * Calculates deterministic mechanical power breakdown (Gravity, Rolling Resistance, Aero, Drivetrain)
 * based on physical laws of motion and fluid dynamics.
 */
export function calculateMechanicalPower(
  params: PhysicsRideConditions
): Result<PowerBreakdownWatts, PhysicsCalculationError> {
  const { riderWeightKg, bikeWeightKg, speedKmh, gradientPercent } = params;

  if (riderWeightKg <= 0 || riderWeightKg > 300) {
    return err(new PhysicsCalculationError('Rider weight must be between 1 and 300 kg.', 'INVALID_WEIGHT'));
  }
  if (bikeWeightKg < 0 || bikeWeightKg > 50) {
    return err(new PhysicsCalculationError('Bike weight must be between 0 and 50 kg.', 'INVALID_WEIGHT'));
  }
  if (speedKmh < 0 || speedKmh > 160) {
    return err(new PhysicsCalculationError('Speed must be a realistic non-negative value <= 160 km/h.', 'INVALID_SPEED'));
  }

  const totalMassKg = riderWeightKg + bikeWeightKg;
  const speedM_S = speedKmh / 3.6;
  const windSpeedM_S = (params.windSpeedKmh ?? 0) / 3.6;
  const apparentAirSpeedM_S = Math.max(0, speedM_S + windSpeedM_S);

  const crr = params.crr ?? 0.004;
  const cda = params.cda ?? 0.32;
  const rho = params.airDensityKgM3 ?? 1.225;
  const drivetrainLoss = params.drivetrainLossPercent ?? 0.03;

  // Grade angle theta: tan(theta) = gradientPercent / 100
  const gradientFraction = gradientPercent / 100;
  const slopeAngleRad = Math.atan(gradientFraction);

  // 1. Gravity power: P_grav = m * g * v * sin(theta)
  const gravityWatts = totalMassKg * GRAVITY_M_S2 * speedM_S * Math.sin(slopeAngleRad);

  // 2. Rolling resistance power: P_roll = crr * m * g * cos(theta) * v
  const rollingWatts = crr * totalMassKg * GRAVITY_M_S2 * Math.cos(slopeAngleRad) * speedM_S;

  // 3. Aerodynamic drag power: P_aero = 0.5 * rho * CdA * v_apparent^2 * v_ground
  const aeroWatts = 0.5 * rho * cda * Math.pow(apparentAirSpeedM_S, 2) * speedM_S;

  // Net resistance at the wheels
  const netWheelWatts = gravityWatts + rollingWatts + aeroWatts;

  // Drivetrain efficiency loss
  let drivetrainLossWatts = 0;
  let totalWatts = 0;

  if (netWheelWatts > 0) {
    drivetrainLossWatts = (netWheelWatts / (1 - drivetrainLoss)) - netWheelWatts;
    totalWatts = netWheelWatts + drivetrainLossWatts;
  } else {
    // Coasting / descent downhill
    totalWatts = 0;
  }

  return ok({
    gravityWatts: Math.round(gravityWatts * 10) / 10,
    rollingWatts: Math.round(rollingWatts * 10) / 10,
    aeroWatts: Math.round(aeroWatts * 10) / 10,
    drivetrainLossWatts: Math.round(drivetrainLossWatts * 10) / 10,
    totalWatts: Math.round(totalWatts * 10) / 10
  });
}
