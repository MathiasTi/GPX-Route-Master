import { PlannedWorkout, WorkoutStep } from './trainingPlanEngine';

export type GarminExportTargetMode = 'auto' | 'power' | 'hr' | 'pace';

export interface GarminWorkoutExportOptions {
  sport: 'running' | 'cycling';
  targetMode?: GarminExportTargetMode;
  ftp?: number;
  maxHr?: number;
  rhr?: number;
  createdAt?: Date;
}

const FIT_EPOCH_UNIX_SEC = 631065600; // 1989-12-31T00:00:00Z

const CRC_TABLE = [
  0x0000, 0xcc01, 0xd801, 0x1400, 0xf001, 0x3c00, 0x2800, 0xe401,
  0xa001, 0x6c00, 0x7800, 0xb401, 0x5000, 0x9c01, 0x8801, 0x4400,
];

function computeFitCrc16(bytes: Uint8Array, start = 0, end = bytes.length): number {
  let crc = 0;
  for (let i = start; i < end; i++) {
    const byte = bytes[i];
    let tmp = CRC_TABLE[crc & 0x0f];
    crc = (crc >> 4) & 0x0fff;
    crc = crc ^ tmp ^ CRC_TABLE[byte & 0x0f];
    tmp = CRC_TABLE[crc & 0x0f];
    crc = (crc >> 4) & 0x0fff;
    crc = crc ^ tmp ^ CRC_TABLE[(byte >> 4) & 0x0f];
  }
  return crc;
}

function toAsciiSafeName(input: string, maxBytes: number): string {
  const replaced = (input || '')
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/Ä/g, 'Ae')
    .replace(/Ö/g, 'Oe')
    .replace(/Ü/g, 'Ue')
    .replace(/ß/g, 'ss')
    .replace(/–|—/g, '-')
    .replace(/×/g, 'x')
    .replace(/[^\x20-\x7E]/g, '')
    .trim();
  return replaced.slice(0, Math.max(1, maxBytes - 1));
}

function writeFixedString(buf: Uint8Array, offset: number, size: number, value: string): void {
  buf.fill(0, offset, offset + size);
  const safe = toAsciiSafeName(value, size);
  for (let i = 0; i < safe.length && i < size - 1; i++) {
    buf[offset + i] = safe.charCodeAt(i);
  }
}

function inferStepIntensityCode(stepName: string): number {
  const lower = (stepName || '').toLowerCase();
  if (lower.includes('warm') || lower.includes('einlauf') || lower.includes('einfahr') || lower.includes('einroll')) {
    return 2; // warmup
  }
  if (lower.includes('cool') || lower.includes('auslauf') || lower.includes('ausfahr')) {
    return 3; // cooldown
  }
  if (lower.includes('erhol') || lower.includes('regeneration') || lower.includes('locker')) {
    return 4; // recovery
  }
  if (lower.includes('pause')) {
    return 1; // rest
  }
  return 0; // active
}

interface ResolvedTarget {
  targetType: number; // 0=speed, 1=heart_rate, 2=open, 4=power
  low: number;
  high: number;
  powerWatts?: [number, number];
  hrBpm?: [number, number];
  speedMs?: [number, number];
}

function resolveStepTarget(
  step: WorkoutStep,
  options: GarminWorkoutExportOptions,
  isRestStep = false
): ResolvedTarget {
  const sport = options.sport;
  const mode = options.targetMode || 'auto';
  const ftp = Math.max(80, Math.round(options.ftp || 250));
  const maxHr = Math.max(110, Math.round(options.maxHr || 185));
  const rhr = Math.max(35, Math.min(maxHr - 30, Math.round(options.rhr || 55)));

  const computePowerBounds = (): [number, number] | null => {
    if (isRestStep) {
      return [Math.round(ftp * 0.42), Math.round(ftp * 0.55)];
    }
    if (step.targetWattsRange) {
      const a = Math.max(40, Math.round(step.targetWattsRange[0]));
      const b = Math.max(a + 5, Math.round(step.targetWattsRange[1]));
      return [a, b];
    }
    if (step.targetFtpPercent) {
      const mid = (ftp * step.targetFtpPercent) / 100;
      return [Math.max(40, Math.round(mid * 0.94)), Math.round(mid * 1.06)];
    }
    return null;
  };

  const computeHrBounds = (): [number, number] | null => {
    if (isRestStep) {
      const lo = Math.max(rhr, Math.round(rhr + (maxHr - rhr) * 0.45));
      const hi = Math.max(lo + 5, Math.round(rhr + (maxHr - rhr) * 0.58));
      return [lo, hi];
    }
    if (step.targetHrBpmRange) {
      const lo = Math.max(rhr, Math.round(step.targetHrBpmRange[0]));
      const hi = Math.min(maxHr, Math.max(lo + 2, Math.round(step.targetHrBpmRange[1])));
      return [lo, hi];
    }
    if (step.targetHrPercent) {
      const mid = (maxHr * step.targetHrPercent) / 100;
      return [Math.max(rhr, Math.round(mid * 0.94)), Math.min(maxHr, Math.round(mid * 1.06))];
    }
    return null;
  };

  const computePaceSpeedBoundsMs = (): [number, number] | null => {
    if (!step.targetPaceRangeSecKm) return null;
    const slowSecKm = Math.max(step.targetPaceRangeSecKm[0], step.targetPaceRangeSecKm[1], 160);
    const fastSecKm = Math.max(150, Math.min(step.targetPaceRangeSecKm[0], step.targetPaceRangeSecKm[1]));
    const lowMs = Number((1000 / slowSecKm).toFixed(3));
    const highMs = Number((1000 / fastSecKm).toFixed(3));
    return lowMs <= highMs ? [lowMs, highMs] : [highMs, lowMs];
  };

  const power = computePowerBounds();
  const hr = computeHrBounds();
  const speedMs = computePaceSpeedBoundsMs();

  if ((mode === 'power' || (mode === 'auto' && sport === 'cycling')) && power) {
    return {
      targetType: 4, // power
      low: power[0] + 1000,
      high: power[1] + 1000,
      powerWatts: power,
    };
  }

  if ((mode === 'pace' || (mode === 'auto' && sport === 'running')) && speedMs) {
    const lowMmPerSec = Math.round(speedMs[0] * 1000);
    const highMmPerSec = Math.round(speedMs[1] * 1000);
    return {
      targetType: 0, // speed
      low: Math.min(lowMmPerSec, highMmPerSec),
      high: Math.max(lowMmPerSec, highMmPerSec),
      speedMs,
    };
  }

  if (hr) {
    return {
      targetType: 1, // heart_rate
      low: hr[0] + 100,
      high: hr[1] + 100,
      hrBpm: hr,
    };
  }

  if (power) {
    return {
      targetType: 4,
      low: power[0] + 1000,
      high: power[1] + 1000,
      powerWatts: power,
    };
  }

  if (speedMs) {
    return {
      targetType: 0,
      low: Math.round(speedMs[0] * 1000),
      high: Math.round(speedMs[1] * 1000),
      speedMs,
    };
  }

  return { targetType: 2, low: 0, high: 0 };
}

interface EncodedFitStep {
  messageIndex: number;
  name: string;
  durationType: number;
  durationValue: number;
  targetType: number;
  targetValue: number;
  customTargetLow: number;
  customTargetHigh: number;
  intensity: number;
}

function buildFitSteps(workout: PlannedWorkout, options: GarminWorkoutExportOptions): EncodedFitStep[] {
  const fitSteps: EncodedFitStep[] = [];
  let idx = 0;

  for (const step of workout.steps) {
    const reps = step.reps && step.reps > 1 ? Math.round(step.reps) : 1;
    const durationMs = Math.max(10_000, Math.round(step.durationMinutes * 60 * 1000));
    const target = resolveStepTarget(step, options, false);

    if (reps > 1) {
      const startIndex = idx;
      fitSteps.push({
        messageIndex: idx++,
        name: step.name,
        durationType: 0, // time
        durationValue: durationMs,
        targetType: target.targetType,
        targetValue: 0,
        customTargetLow: target.low,
        customTargetHigh: target.high,
        intensity: 0, // active
      });

      if (step.restDurationMinutes && step.restDurationMinutes > 0) {
        const restTarget = resolveStepTarget(step, options, true);
        fitSteps.push({
          messageIndex: idx++,
          name: 'Pause',
          durationType: 0, // time
          durationValue: Math.max(5_000, Math.round(step.restDurationMinutes * 60 * 1000)),
          targetType: restTarget.targetType,
          targetValue: 0,
          customTargetLow: restTarget.low,
          customTargetHigh: restTarget.high,
          intensity: 4, // recovery
        });
      }

      fitSteps.push({
        messageIndex: idx++,
        name: `Wdh ${reps}x`,
        durationType: 6, // repeat_until_steps_cmplt
        durationValue: startIndex,
        targetType: 2, // open
        targetValue: reps,
        customTargetLow: 0,
        customTargetHigh: 0,
        intensity: 0,
      });
    } else {
      fitSteps.push({
        messageIndex: idx++,
        name: step.name,
        durationType: 0, // time
        durationValue: durationMs,
        targetType: target.targetType,
        targetValue: 0,
        customTargetLow: target.low,
        customTargetHigh: target.high,
        intensity: inferStepIntensityCode(step.name),
      });
    }
  }

  return fitSteps;
}

/**
 * Encodes a PlannedWorkout directly into a binary Garmin FIT Workout file
 * (`file_id.type = 5`, `workout`, `workout_step` with native repeat loops).
 */
export function encodeWorkoutToFit(workout: PlannedWorkout, options: GarminWorkoutExportOptions): Uint8Array {
  const fitSteps = buildFitSteps(workout, options);
  const sportCode = options.sport === 'running' ? 1 : 2;
  const createdSec = Math.max(
    1,
    Math.floor((options.createdAt ? options.createdAt.getTime() : Date.now()) / 1000) - FIT_EPOCH_UNIX_SEC
  );

  // Build data records buffer cleanly via sequential parts
  const chunks: Uint8Array[] = [];
  const pushBytes = (arr: Uint8Array) => chunks.push(arr);

  // 1. Definition Local 0: file_id (global 0), 5 fields -> 6 + 15 = 21 bytes
  {
    const def = new Uint8Array(6 + 5 * 3);
    const dv = new DataView(def.buffer);
    def[0] = 0x40; // definition, local 0
    def[1] = 0x00;
    def[2] = 0x00; // little endian
    dv.setUint16(3, 0, true); // global 0 = file_id
    def[5] = 5;
    const fields = [
      [0, 1, 0x00], // type (enum)
      [1, 2, 0x84], // manufacturer (uint16)
      [2, 2, 0x84], // product (uint16)
      [3, 4, 0x8c], // serial_number (uint32z)
      [4, 4, 0x86], // time_created (uint32)
    ];
    fields.forEach(([num, size, base], i) => {
      def[6 + i * 3] = num;
      def[6 + i * 3 + 1] = size;
      def[6 + i * 3 + 2] = base;
    });
    pushBytes(def);

    // Data Local 0: 1 + 13 = 14 bytes
    const data = new Uint8Array(1 + 13);
    const ddv = new DataView(data.buffer);
    data[0] = 0x00;
    data[1] = 5; // workout
    ddv.setUint16(2, 1, true); // garmin
    ddv.setUint16(4, 0, true); // product 0
    ddv.setUint32(6, 20260001, true);
    ddv.setUint32(10, createdSec, true);
    pushBytes(data);
  }

  // 2. Definition Local 1: workout (global 26), 4 fields -> 6 + 12 = 18 bytes
  const WKT_NAME_BYTES = 48;
  {
    const def = new Uint8Array(6 + 4 * 3);
    const dv = new DataView(def.buffer);
    def[0] = 0x41; // definition, local 1
    def[1] = 0x00;
    def[2] = 0x00; // little endian
    dv.setUint16(3, 26, true); // global 26 = workout
    def[5] = 4;
    const fields = [
      [4, 1, 0x00], // sport (enum)
      [5, 4, 0x8c], // capabilities (uint32z)
      [6, 2, 0x84], // num_valid_steps (uint16)
      [8, WKT_NAME_BYTES, 0x07], // wkt_name (string)
    ];
    fields.forEach(([num, size, base], i) => {
      def[6 + i * 3] = num;
      def[6 + i * 3 + 1] = size;
      def[6 + i * 3 + 2] = base;
    });
    pushBytes(def);

    // Data Local 1: 1 + 55 = 56 bytes
    const data = new Uint8Array(1 + 1 + 4 + 2 + WKT_NAME_BYTES);
    const ddv = new DataView(data.buffer);
    data[0] = 0x01;
    data[1] = sportCode;
    ddv.setUint32(2, 32, true); // tc_workout_capabilities
    ddv.setUint16(6, fitSteps.length, true);
    writeFixedString(data, 8, WKT_NAME_BYTES, workout.title || 'Garmin Workout');
    pushBytes(data);
  }

  // 3. Definition Local 2: workout_step (global 27), 9 fields -> 6 + 27 = 33 bytes
  const STEP_NAME_BYTES = 32;
  {
    const def = new Uint8Array(6 + 9 * 3);
    const dv = new DataView(def.buffer);
    def[0] = 0x42; // definition, local 2
    def[1] = 0x00;
    def[2] = 0x00; // little endian
    dv.setUint16(3, 27, true); // global 27 = workout_step
    def[5] = 9;
    const fields = [
      [254, 2, 0x84], // message_index
      [0, STEP_NAME_BYTES, 0x07], // wkt_step_name
      [1, 1, 0x00], // duration_type
      [2, 4, 0x86], // duration_value
      [3, 1, 0x00], // target_type
      [4, 4, 0x86], // target_value
      [5, 4, 0x86], // custom_target_value_low
      [6, 4, 0x86], // custom_target_value_high
      [7, 1, 0x00], // intensity
    ];
    fields.forEach(([num, size, base], i) => {
      def[6 + i * 3] = num;
      def[6 + i * 3 + 1] = size;
      def[6 + i * 3 + 2] = base;
    });
    pushBytes(def);

    const recordPayloadBytes = 2 + STEP_NAME_BYTES + 1 + 4 + 1 + 4 + 4 + 4 + 1; // 53 bytes
    for (const st of fitSteps) {
      const data = new Uint8Array(1 + recordPayloadBytes);
      const ddv = new DataView(data.buffer);
      let p = 0;
      data[p++] = 0x02;
      ddv.setUint16(p, st.messageIndex, true);
      p += 2;
      writeFixedString(data, p, STEP_NAME_BYTES, st.name);
      p += STEP_NAME_BYTES;
      data[p++] = st.durationType;
      ddv.setUint32(p, st.durationValue >>> 0, true);
      p += 4;
      data[p++] = st.targetType;
      ddv.setUint32(p, st.targetValue >>> 0, true);
      p += 4;
      ddv.setUint32(p, st.customTargetLow >>> 0, true);
      p += 4;
      ddv.setUint32(p, st.customTargetHigh >>> 0, true);
      p += 4;
      data[p++] = st.intensity;
      pushBytes(data);
    }
  }

  const dataSize = chunks.reduce((sum, c) => sum + c.length, 0);
  const totalSize = 14 + dataSize + 2;
  const out = new Uint8Array(totalSize);
  const hdv = new DataView(out.buffer);

  // 14-byte FIT Header
  out[0] = 14; // header size
  out[1] = 0x20; // FIT protocol v2.0
  hdv.setUint16(2, 2100, true); // profile version 21.00
  hdv.setUint32(4, dataSize, true);
  out[8] = '.'.charCodeAt(0);
  out[9] = 'F'.charCodeAt(0);
  out[10] = 'I'.charCodeAt(0);
  out[11] = 'T'.charCodeAt(0);
  const headerCrc = computeFitCrc16(out, 0, 12);
  hdv.setUint16(12, headerCrc, true);

  // Copy data records
  let cursor = 14;
  for (const chunk of chunks) {
    out.set(chunk, cursor);
    cursor += chunk.length;
  }

  // Compute data/file CRC (equals computeFitCrc16(out, 0, totalSize - 2) when headerCrc is valid)
  const fileCrc = computeFitCrc16(out, 14, totalSize - 2);
  hdv.setUint16(totalSize - 2, fileCrc, true);

  return out;
}

function xmlEsc(str: string): string {
  return (str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Encodes a PlannedWorkout to Garmin Training Center Database (.TCX) v2 XML.
 */
export function encodeWorkoutToTcx(workout: PlannedWorkout, options: GarminWorkoutExportOptions): string {
  const sport = options.sport === 'running' ? 'Running' : 'Biking';

  const getTcxTargetXml = (step: WorkoutStep, isRest = false) => {
    const resolved = resolveStepTarget(step, options, isRest);
    if (resolved.powerWatts) {
      return `        <Target xsi:type="CustomPower_t">
          <CustomPowerZone xsi:type="CustomPowerZone_t">
            <Low>${resolved.powerWatts[0]}</Low>
            <High>${resolved.powerWatts[1]}</High>
          </CustomPowerZone>
        </Target>\n`;
    }
    if (resolved.speedMs) {
      return `        <Target xsi:type="Speed_t">
          <SpeedZone xsi:type="CustomSpeedZone_t">
            <LowInMetersPerSecond>${resolved.speedMs[0].toFixed(2)}</LowInMetersPerSecond>
            <HighInMetersPerSecond>${resolved.speedMs[1].toFixed(2)}</HighInMetersPerSecond>
          </SpeedZone>
        </Target>\n`;
    }
    if (resolved.hrBpm) {
      return `        <Target xsi:type="HeartRate_t">
          <HeartRateZone xsi:type="CustomHeartRateZone_t">
            <Low xsi:type="HeartRateInBeatsPerMinute_t">
              <Value>${resolved.hrBpm[0]}</Value>
            </Low>
            <High xsi:type="HeartRateInBeatsPerMinute_t">
              <Value>${resolved.hrBpm[1]}</Value>
            </High>
          </HeartRateZone>
        </Target>\n`;
    }
    return `        <Target xsi:type="None_t"/>\n`;
  };

  let xml = `<?xml version="1.0" encoding="UTF-8"?>
<TrainingCenterDatabase
  xmlns="http://www.garmin.com/xmlschemas/TrainingCenterDatabase/v2"
  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
  xsi:schemaLocation="http://www.garmin.com/xmlschemas/TrainingCenterDatabase/v2 http://www.garmin.com/xmlschemas/TrainingCenterDatabasev2.xsd">
  <Workouts>
    <Workout Sport="${sport}">
      <Name>${xmlEsc(toAsciiSafeName(workout.title, 16) || 'Workout')}</Name>
      <Notes>${xmlEsc(workout.description || 'Wissenschaftlicher Trainingsplan')}</Notes>
`;

  let stepId = 1;
  for (const step of workout.steps) {
    if (step.reps && step.reps > 1) {
      for (let r = 0; r < step.reps; r++) {
        xml += `      <Step xsi:type="Step_t">
        <StepId>${stepId++}</StepId>
        <Name>${xmlEsc(step.name.substring(0, 11))} ${r + 1}</Name>
        <Intensity>Active</Intensity>
        <Duration xsi:type="Time_t">
          <Seconds>${Math.round(step.durationMinutes * 60)}</Seconds>
        </Duration>
${getTcxTargetXml(step, false)}      </Step>\n`;

        if (step.restDurationMinutes && step.restDurationMinutes > 0) {
          xml += `      <Step xsi:type="Step_t">
        <StepId>${stepId++}</StepId>
        <Name>Pause</Name>
        <Intensity>Resting</Intensity>
        <Duration xsi:type="Time_t">
          <Seconds>${Math.round(step.restDurationMinutes * 60)}</Seconds>
        </Duration>
${getTcxTargetXml(step, true)}      </Step>\n`;
        }
      }
    } else {
      const code = inferStepIntensityCode(step.name);
      const tcxIntensity = code === 2 ? 'Warmup' : code === 3 ? 'Cooldown' : code === 4 || code === 1 ? 'Resting' : 'Active';
      xml += `      <Step xsi:type="Step_t">
        <StepId>${stepId++}</StepId>
        <Name>${xmlEsc(step.name.substring(0, 15))}</Name>
        <Intensity>${tcxIntensity}</Intensity>
        <Duration xsi:type="Time_t">
          <Seconds>${Math.round(step.durationMinutes * 60)}</Seconds>
        </Duration>
${getTcxTargetXml(step, false)}      </Step>\n`;
    }
  }

  xml += `    </Workout>
  </Workouts>
</TrainingCenterDatabase>`;
  return xml;
}

/**
 * Encodes a cycling PlannedWorkout to Zwift / Smart-Trainer (.ZWO) XML.
 */
export function encodeWorkoutToZwo(workout: PlannedWorkout, options: GarminWorkoutExportOptions): string {
  const ftp = Math.max(80, Math.round(options.ftp || 250));
  const stepFtpRatio = (step: WorkoutStep): number => {
    if (step.targetFtpPercent) return Math.max(0.4, Math.min(1.6, step.targetFtpPercent / 100));
    if (step.targetWattsRange) {
      return Math.max(0.4, Math.min(1.6, (step.targetWattsRange[0] + step.targetWattsRange[1]) / (2 * ftp)));
    }
    return 0.65;
  };

  let body = '';
  for (const step of workout.steps) {
    const durSec = Math.max(60, Math.round(step.durationMinutes * 60));
    const powerRatio = stepFtpRatio(step);
    const code = inferStepIntensityCode(step.name);

    if (step.reps && step.reps > 1) {
      const offSec = Math.max(30, Math.round((step.restDurationMinutes || 2) * 60));
      body += `    <IntervalsT Repeat="${step.reps}" OnDuration="${durSec}" OffDuration="${offSec}" OnPower="${powerRatio.toFixed(2)}" OffPower="0.50" />\n`;
    } else if (code === 2) {
      body += `    <Warmup Duration="${durSec}" PowerLow="0.48" PowerHigh="${powerRatio.toFixed(2)}" />\n`;
    } else if (code === 3) {
      body += `    <Cooldown Duration="${durSec}" PowerLow="${powerRatio.toFixed(2)}" PowerHigh="0.45" />\n`;
    } else {
      body += `    <SteadyState Duration="${durSec}" Power="${powerRatio.toFixed(2)}" />\n`;
    }
  }

  return `<?xml version="1.0" encoding="UTF-8"?>
<workout_file>
  <author>GPX Route Master</author>
  <name>${xmlEsc(workout.title)}</name>
  <description>${xmlEsc(workout.description)}</description>
  <sportType>bike</sportType>
  <workout>
${body}  </workout>
</workout_file>`;
}

function triggerBlobDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

function safeFileSlug(title: string): string {
  return toAsciiSafeName(title, 40).replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'Workout';
}

export function downloadWorkoutAsFit(workout: PlannedWorkout, options: GarminWorkoutExportOptions): void {
  const bytes = encodeWorkoutToFit(workout, options);
  const exactBuffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  triggerBlobDownload(new Blob([exactBuffer], { type: 'application/octet-stream' }), `Garmin_${safeFileSlug(workout.title)}.fit`);
}

export function downloadWorkoutAsTcx(workout: PlannedWorkout, options: GarminWorkoutExportOptions): void {
  const xml = encodeWorkoutToTcx(workout, options);
  triggerBlobDownload(new Blob([xml], { type: 'application/xml' }), `Garmin_${safeFileSlug(workout.title)}.tcx`);
}

export function downloadWorkoutAsZwo(workout: PlannedWorkout, options: GarminWorkoutExportOptions): void {
  const xml = encodeWorkoutToZwo(workout, options);
  triggerBlobDownload(new Blob([xml], { type: 'application/xml' }), `${safeFileSlug(workout.title)}.zwo`);
}
