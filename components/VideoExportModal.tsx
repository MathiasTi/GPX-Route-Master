import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import * as THREE from 'three';
import { motion, AnimatePresence } from 'motion/react';
import {
  Camera,
  Clock,
  Sparkles,
  Play,
  Pause,
  RotateCcw,
  Download,
  Sliders,
  Mountain,
  Compass,
  Palette,
  Layers,
  Film,
  Zap,
  Award,
  Eye
} from 'lucide-react';
import { GPXTrack, ClimbSegment } from '../types';
import { calculateDistance } from '../utils/gpxUtils';
import { toValidTimestampMs } from '../domain/telemetry/safeTime';
import { RidgereelThreeEngine } from '../utils/ridgereelThreeEngine';

interface VideoExportModalProps {
  track: GPXTrack | undefined;
  isOpen: boolean;
  onClose: () => void;
  userWeight?: number;
  estimatedSpeed?: number;
}

type ThemeMode = 'tactical' | 'neon' | 'sport-light';
type ResolutionOption = '720p' | '1080p' | '4k';
type ExportFps = 30 | 60;
type MapStyle = 'satellite' | 'topo' | 'relief' | 'outdoor' | 'streets-dark' | 'streets-light';
type CameraPresetId = 'helicopter' | 'chase' | 'tactical' | 'orbit' | 'map2d';
type RouteColorMode = 'gradient' | 'speed' | 'power' | 'classic';
type StudioTab = 'camera' | 'pacing' | 'style';

interface CameraPresetConfig {
  id: CameraPresetId;
  label: string;
  badge?: string;
  description: string;
  pitch: number; // 25 to 75 degrees
  altitudeZoom: number; // 0.5 to 2.0x
  smoothing: number; // 0.1 to 0.95
  exaggeration: number; // 1.0 to 3.0x
  orbitIntensity: number; // 0 to 1
  is2D?: boolean;
}

const CAMERA_PRESETS: Record<CameraPresetId, CameraPresetConfig> = {
  helicopter: {
    id: 'helicopter',
    label: 'Drone (Ridgereel)',
    badge: '55° Drone',
    description: 'Ridgereel-Drohnenflug über echtes 3D-DEM-Bergrelief mit weiter Tal-Vorausschau',
    pitch: 55,
    altitudeZoom: 1.0,
    smoothing: 0.80,
    exaggeration: 1.7,
    orbitIntensity: 0.35,
    is2D: false
  },
  chase: {
    id: 'chase',
    label: 'Follow (Verfolger)',
    badge: '65° Follow',
    description: 'Dynamische Ridgereel Follow-Cam nah hinter dem 3D-Fahrer für steile Anstiege & Abfahrten',
    pitch: 65,
    altitudeZoom: 0.65,
    smoothing: 0.55,
    exaggeration: 2.0,
    orbitIntensity: 0.2,
    is2D: false
  },
  orbit: {
    id: 'orbit',
    label: 'Overview (360° Orbit)',
    badge: '48° Overview',
    description: 'Kreisender Ridgereel Panorama-Überblick über das gesamte 3D-Gebirgs-Diorama',
    pitch: 48,
    altitudeZoom: 1.35,
    smoothing: 0.90,
    exaggeration: 1.9,
    orbitIntensity: 0.90,
    is2D: false
  },
  tactical: {
    id: 'tactical',
    label: 'Top-Down Taktik',
    badge: '36° Steil',
    description: 'Steile Vogelperspektive für maximale topografische Streckenübersicht',
    pitch: 36,
    altitudeZoom: 1.4,
    smoothing: 0.88,
    exaggeration: 1.4,
    orbitIntensity: 0.1,
    is2D: false
  },
  map2d: {
    id: 'map2d',
    label: '2D Draufsicht',
    badge: 'Senkrecht',
    description: 'Senkrechte Draufsicht von oben auf das 3D-Terrain ohne Perspektivneigung',
    pitch: 0,
    altitudeZoom: 1.15,
    smoothing: 0.75,
    exaggeration: 1.0,
    orbitIntensity: 0,
    is2D: true
  }
};

interface MilestonePin {
  id: string;
  pointIndex: number;
  progressU: number; // 0..1 along track
  type: 'start' | 'summit' | 'climb' | 'speed' | 'power' | 'finish';
  title: string;
  subtitle: string;
  color: string;
  icon: string;
}

const clamp = (val: number, min: number, max: number) => Math.max(min, Math.min(max, val));

const easeInOutCubic = (t: number) =>
  t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

const lerpAngle = (a: number, b: number, t: number) => {
  let diff = ((b - a + Math.PI) % (Math.PI * 2)) - Math.PI;
  if (diff < -Math.PI) diff += Math.PI * 2;
  return a + diff * t;
};

// Dynamic color helper for gradient, speed, or power
const getPointRouteColor = (
  mode: RouteColorMode,
  gradientPct: number,
  speedKmh: number,
  powerW: number,
  hrBpm: number,
  theme: ThemeMode
): string => {
  if (mode === 'classic') {
    if (theme === 'sport-light') return '#2563eb';
    if (theme === 'neon') return '#a3e635';
    return '#f97316';
  }

  if (mode === 'gradient') {
    if (gradientPct < -2) return '#38bdf8'; // Descent sky blue
    if (gradientPct < 2.5) return '#10b981'; // Flat emerald
    if (gradientPct < 6.0) return '#eab308'; // Moderate climb yellow
    if (gradientPct < 9.5) return '#f97316'; // Steep climb orange
    return '#ef4444'; // Extreme wall crimson
  }

  if (mode === 'speed') {
    if (speedKmh < 14) return '#3b82f6'; // Slow climb blue
    if (speedKmh < 24) return '#06b6d4'; // Endurance cyan
    if (speedKmh < 34) return '#10b981'; // Tempo emerald
    if (speedKmh < 45) return '#f59e0b'; // Fast amber
    return '#ef4444'; // High speed sprint red
  }

  // Power or HR mode
  const val = powerW > 0 ? powerW : hrBpm > 0 ? (hrBpm - 90) * 3.2 : speedKmh * 7.5;
  if (val < 130) return '#38bdf8';
  if (val < 190) return '#10b981';
  if (val < 250) return '#eab308';
  if (val < 320) return '#f97316';
  return '#ec4899';
};

// Converts hex color to rgba string
const hexToRgba = (hex: string, alpha: number): string => {
  if (hex.startsWith('#') && hex.length >= 7) {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    if (!isNaN(r) && !isNaN(g) && !isNaN(b)) {
      return `rgba(${r}, ${g}, ${b}, ${alpha})`;
    }
  }
  return hex;
};

export const VideoExportModal: React.FC<VideoExportModalProps> = ({
  track,
  isOpen,
  onClose,
  userWeight = 75,
  estimatedSpeed = 22
}) => {
  // Studio UI Navigation
  const [activeTab, setActiveTab] = useState<StudioTab>('camera');

  // Camera & Perspective Settings (Default: Panorama-Helikopter 55°)
  const [cameraPreset, setCameraPreset] = useState<CameraPresetId>('helicopter');
  const [cameraPitch, setCameraPitch] = useState<number>(55);
  const [cameraAltitudeZoom, setCameraAltitudeZoom] = useState<number>(1.0);
  const [cameraSmoothing, setCameraSmoothing] = useState<number>(0.80);
  const [terrainExaggeration, setTerrainExaggeration] = useState<number>(1.6);
  const [orbitIntensity, setOrbitIntensity] = useState<number>(0.35);

  // Duration & Pacing Settings
  const [videoLength, setVideoLength] = useState<number>(45);
  const [isAutoDuration, setIsAutoDuration] = useState<boolean>(true);
  const [adaptivePacing, setAdaptivePacing] = useState<boolean>(true);
  const [includeIntroOutro, setIncludeIntroOutro] = useState<boolean>(true);

  // Style & Storytelling Settings
  const [theme, setTheme] = useState<ThemeMode>('tactical');
  const [mapStyle, setMapStyle] = useState<MapStyle>('satellite');
  const [routeColorMode, setRouteColorMode] = useState<RouteColorMode>('gradient');
  const [showMilestones, setShowMilestones] = useState<boolean>(true);
  const [showElevationCurtain, setShowElevationCurtain] = useState<boolean>(true);
  const [showContourLines, setShowContourLines] = useState<boolean>(true);
  const [autoDirector, setAutoDirector] = useState<boolean>(true);
  const [showRiderAvatar, setShowRiderAvatar] = useState<boolean>(true);
  const [showProTelemetry, setShowProTelemetry] = useState<boolean>(true);
  const [resolution, setResolution] = useState<ResolutionOption>('1080p');
  const [fps, setFps] = useState<ExportFps>(60);
  const [enableMotionBlur, setEnableMotionBlur] = useState<boolean>(true);
  const [enableSunGlow, setEnableSunGlow] = useState<boolean>(true);
  const [exportFormat, setExportFormat] = useState<'webm' | 'mp4'>('mp4');
  const [actualExt, setActualExt] = useState<string>('mp4');

  // Interactive Live Preview & Scrubber State
  const [isPlayingPreview, setIsPlayingPreview] = useState<boolean>(true);
  const [previewProgress, setPreviewProgress] = useState<number>(0); // 0 to 1
  const [previewSpeedMultiplier, setPreviewSpeedMultiplier] = useState<1 | 2>(1);
  const isScrubbingRef = useRef<boolean>(false);
  const previewProgressRef = useRef<number>(0);

  // Tile Loading & Export State
  const [tilesLoaded, setTilesLoaded] = useState(0);
  const [tilesTotal, setTilesTotal] = useState(0);
  const [tilesLoading, setTilesLoading] = useState(false);

  // Interactive Mouse Orbit & Zoom in 3D Live Preview (Ridgereel style)
  const [hasCustomOrbit, setHasCustomOrbit] = useState(false);
  const isDraggingOrbitRef = useRef(false);
  const dragLastPosRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const userOrbitYawRef = useRef<number>(0); // radians
  const userOrbitPitchRef = useRef<number>(0); // degrees
  const userOrbitZoomRef = useRef<number>(1.0); // multiplier

  const resetCustomOrbit = useCallback(() => {
    userOrbitYawRef.current = 0;
    userOrbitPitchRef.current = 0;
    userOrbitZoomRef.current = 1.0;
    setHasCustomOrbit(false);
  }, []);

  const engineRef = useRef<RidgereelThreeEngine | null>(null);

  const [exporting, setExporting] = useState(false);
  const isExportingRef = useRef(false);
  const [exportProgress, setExportProgress] = useState(0);
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const livePreviewCanvasRef = useRef<HTMLCanvasElement>(null);
  const animationFrameRef = useRef<number | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordedChunksRef = useRef<Blob[]>([]);

  // Apply Camera Preset
  const handleSelectCameraPreset = useCallback((presetId: CameraPresetId) => {
    const p = CAMERA_PRESETS[presetId];
    setCameraPreset(presetId);
    setCameraPitch(p.pitch);
    setCameraAltitudeZoom(p.altitudeZoom);
    setCameraSmoothing(p.smoothing);
    setTerrainExaggeration(p.exaggeration);
    setOrbitIntensity(p.orbitIntensity);
    userOrbitYawRef.current = 0;
    userOrbitPitchRef.current = 0;
    userOrbitZoomRef.current = 1.0;
    setHasCustomOrbit(false);
    setDownloadUrl(null);
  }, []);

  // Precompute rich track telemetry, smoothed gradients, milestones, and spatial DEM grid
  const precomputedStats = useMemo(() => {
    if (!track || !track.points || track.points.length === 0) return null;
    const points = track.points;
    const n = points.length;

    let minLat = Infinity,
      maxLat = -Infinity;
    let minLng = Infinity,
      maxLng = -Infinity;
    let minEle = Infinity,
      maxEle = -Infinity;

    const cumulativeDistances = new Float64Array(n);
    const cumulativeAscents = new Float64Array(n);
    const rawSpeeds = new Float32Array(n);
    const rawGradients = new Float32Array(n);
    const rawPowers = new Float32Array(n);
    const rawHrs = new Float32Array(n);

    let totalDist = 0;
    let totalAscent = 0;

    for (let i = 0; i < n; i++) {
      const pt = points[i];
      if (pt.lat < minLat) minLat = pt.lat;
      if (pt.lat > maxLat) maxLat = pt.lat;
      if (pt.lng < minLng) minLng = pt.lng;
      if (pt.lng > maxLng) maxLng = pt.lng;

      const ele = pt.ele !== undefined ? pt.ele : 0;
      if (ele < minEle) minEle = ele;
      if (ele > maxEle) maxEle = ele;

      rawPowers[i] = pt.power !== undefined ? pt.power : 0;
      rawHrs[i] = pt.hr !== undefined ? pt.hr : 0;

      if (i > 0) {
        const prev = points[i - 1];
        const d = calculateDistance(prev, pt) * 1000; // meters
        totalDist += d;

        const prevEle = prev.ele !== undefined ? prev.ele : 0;
        const dEle = ele - prevEle;
        if (dEle > 0) {
          totalAscent += dEle;
        }

        const slopePct = d > 1.5 ? clamp((dEle / d) * 100, -35, 35) : rawGradients[i - 1];
        rawGradients[i] = slopePct;

        let speed = pt.speed !== undefined && pt.speed > 0 ? pt.speed : 0;
        if (!speed) {
          const ptMs = toValidTimestampMs(pt.time);
          const prevMs = toValidTimestampMs(prev.time);
          if (ptMs !== undefined && prevMs !== undefined) {
            const dt = (ptMs - prevMs) / 1000;
            if (dt > 0.5 && dt < 180 && d > 0) {
              speed = (d / dt) * 3.6;
            }
          }
        }
        if (!speed || speed <= 0 || speed > 105) {
          const slopeFrac = slopePct / 100;
          if (slopeFrac > 0) {
            speed = Math.max(7, estimatedSpeed / (1 + slopeFrac * 10));
          } else {
            speed = Math.min(68, estimatedSpeed * (1 - slopeFrac * 3.2));
          }
        }
        rawSpeeds[i] = speed;
      } else {
        rawSpeeds[0] = estimatedSpeed;
        rawGradients[0] = 0;
      }

      cumulativeDistances[i] = totalDist;
      cumulativeAscents[i] = totalAscent;
    }

    // Smooth speeds and gradients for stable HUD & route coloring
    const smoothedSpeeds = new Float32Array(n);
    const smoothedGradients = new Float32Array(n);
    const smoothedElevations = new Float32Array(n);
    const wSize = Math.max(4, Math.min(18, Math.floor(n / 80)));

    let maxSpeedIdx = 0;
    let maxSpeedVal = 0;
    let maxPowerIdx = 0;
    let maxPowerVal = 0;
    let maxEleIdx = 0;
    let minEleIdx = 0;

    for (let i = 0; i < n; i++) {
      let sumSpd = 0,
        sumGrad = 0,
        sumEle = 0,
        count = 0;
      for (let j = Math.max(0, i - wSize); j <= Math.min(n - 1, i + wSize); j++) {
        sumSpd += rawSpeeds[j];
        sumGrad += rawGradients[j];
        sumEle += points[j].ele !== undefined ? points[j].ele! : minEle;
        count++;
      }
      smoothedSpeeds[i] = count > 0 ? sumSpd / count : estimatedSpeed;
      smoothedGradients[i] = count > 0 ? sumGrad / count : 0;
      smoothedElevations[i] = count > 0 ? sumEle / count : minEle;

      if (smoothedSpeeds[i] > maxSpeedVal && i > n * 0.05 && i < n * 0.95) {
        maxSpeedVal = smoothedSpeeds[i];
        maxSpeedIdx = i;
      }
      if (rawPowers[i] > maxPowerVal) {
        maxPowerVal = rawPowers[i];
        maxPowerIdx = i;
      }
      const ele = points[i].ele !== undefined ? points[i].ele! : 0;
      if (ele === maxEle) maxEleIdx = i;
      if (ele === minEle) minEleIdx = i;
    }

    // Smart Auto-Duration formula (Komoot / Relive style)
    const distKm = totalDist / 1000;
    const autoDurationSec = clamp(
      Math.round(20 + distKm * 0.65 + totalAscent / 60),
      25,
      120
    );

    // Build 3D Milestone Pins
    const milestones: MilestonePin[] = [];
    milestones.push({
      id: 'start',
      pointIndex: 0,
      progressU: 0,
      type: 'start',
      title: 'START',
      subtitle: `${Math.round(points[0].ele || minEle)} m`,
      color: '#10b981',
      icon: '🟢'
    });

    // Add major climbs from track.climbs (up to 3 most significant climbs)
    if (track.climbs && track.climbs.length > 0) {
      const sortedClimbs = [...track.climbs]
        .sort((a, b) => b.ascent - a.ascent)
        .slice(0, 3);
      sortedClimbs.forEach((c: ClimbSegment, idx: number) => {
        const midIdx = Math.min(n - 1, Math.floor((c.startIndex + c.endIndex) / 2));
        // Avoid overlapping right on the summit pin
        if (Math.abs(midIdx - maxEleIdx) > n * 0.06) {
          milestones.push({
            id: `climb-${idx}`,
            pointIndex: midIdx,
            progressU: midIdx / Math.max(1, n - 1),
            type: 'climb',
            title: `ANSTIEG #${idx + 1}`,
            subtitle: `+${Math.round(c.ascent)} Hm · Ø ${c.avgGradient.toFixed(1)}%`,
            color: '#f97316',
            icon: '🏔️'
          });
        }
      });
    }

    // Highest Summit Pin
    if (maxEle > minEle + 15) {
      milestones.push({
        id: 'summit',
        pointIndex: maxEleIdx,
        progressU: maxEleIdx / Math.max(1, n - 1),
        type: 'summit',
        title: `GIPFEL · ${Math.round(maxEle)} m`,
        subtitle: `Höchster Punkt der Tour`,
        color: '#f59e0b',
        icon: '⛰️'
      });
    }

    // Max Speed Pin (if distinct from summit)
    if (
      maxSpeedVal > 28 &&
      Math.abs(maxSpeedIdx - maxEleIdx) > n * 0.07
    ) {
      milestones.push({
        id: 'max-speed',
        pointIndex: maxSpeedIdx,
        progressU: maxSpeedIdx / Math.max(1, n - 1),
        type: 'speed',
        title: `TOP SPEED`,
        subtitle: `${maxSpeedVal.toFixed(1)} km/h`,
        color: '#38bdf8',
        icon: '⚡'
      });
    }

    // Max Power Pin (if power sensor data exists)
    if (
      maxPowerVal > 200 &&
      Math.abs(maxPowerIdx - maxEleIdx) > n * 0.06 &&
      Math.abs(maxPowerIdx - maxSpeedIdx) > n * 0.06
    ) {
      milestones.push({
        id: 'max-power',
        pointIndex: maxPowerIdx,
        progressU: maxPowerIdx / Math.max(1, n - 1),
        type: 'power',
        title: `MAX POWER`,
        subtitle: `${Math.round(maxPowerVal)} Watt`,
        color: '#ec4899',
        icon: '🔥'
      });
    }

    // Kilometer Milestone Split Markers (every 5 km or 10 km)
    const kmStep = distKm > 70 ? 10 : distKm > 20 ? 5 : distKm > 8 ? 2 : 1;
    let nextKm = kmStep;
    for (let i = 0; i < n; i++) {
      const curKm = cumulativeDistances[i] / 1000;
      if (curKm >= nextKm && nextKm <= distKm - 0.8) {
        milestones.push({
          id: `km-${nextKm}`,
          pointIndex: i,
          progressU: i / Math.max(1, n - 1),
          type: 'climb',
          title: `KM ${nextKm}`,
          subtitle: `${Math.round(smoothedElevations[i])} m · +${Math.round(cumulativeAscents[i])} Hm`,
          color: '#38bdf8',
          icon: '📍'
        });
        nextKm += kmStep;
      }
    }

    milestones.push({
      id: 'finish',
      pointIndex: n - 1,
      progressU: 1,
      type: 'finish',
      title: 'ZIEL',
      subtitle: `${distKm.toFixed(1)} km · +${Math.round(totalAscent)} Hm`,
      color: '#ef4444',
      icon: '🏁'
    });

    milestones.sort((a, b) => a.pointIndex - b.pointIndex);

    // Precompute sub-sampled spatial reference points (120 points) for fast 3D terrain elevation & hillshade queries
    const sampleStep = Math.max(1, Math.floor(n / 120));
    const spatialSamples: { lat: number; lng: number; ele: number }[] = [];
    for (let i = 0; i < n; i += sampleStep) {
      spatialSamples.push({
        lat: points[i].lat,
        lng: points[i].lng,
        ele: smoothedElevations[i]
      });
    }

    const latRad = (((minLat + maxLat) / 2) * Math.PI) / 180;
    const latSpan = maxLat - minLat;
    const lngSpan = maxLng - minLng;
    const maxSpanDeg = Math.max(latSpan, lngSpan * Math.cos(latRad));
    const zoomLevel = clamp(
      Math.round(Math.log2(85 / (maxSpanDeg || 0.001))),
      12,
      15
    );

    return {
      minLat,
      maxLat,
      minLng,
      maxLng,
      minEle: minEle === Infinity ? 0 : minEle,
      maxEle: maxEle === -Infinity ? 100 : maxEle,
      maxEleIdx,
      minEleIdx,
      maxSpeedIdx,
      maxSpeedVal,
      maxPowerIdx,
      maxPowerVal,
      zoomLevel,
      cumulativeDistances,
      cumulativeAscents,
      smoothedSpeeds,
      smoothedGradients,
      smoothedElevations,
      rawPowers,
      rawHrs,
      totalDist,
      totalAscent,
      autoDurationSec,
      milestones,
      spatialSamples
    };
  }, [track, estimatedSpeed]);

  // Sync Smart Auto-Duration when track changes or auto-duration is toggled on
  useEffect(() => {
    if (precomputedStats && isAutoDuration) {
      setVideoLength(precomputedStats.autoDurationSec);
    }
  }, [precomputedStats, isAutoDuration]);

  // Precompute Adaptive Climb Pacing Time-Warp Lookup Table (maps normalized flight time 0..1 -> track progress u 0..1)
  const timeWarpLUT = useMemo(() => {
    const lutSize = 1000;
    const lut = new Float32Array(lutSize + 1);
    if (!precomputedStats || !track || track.points.length < 2) {
      for (let i = 0; i <= lutSize; i++) lut[i] = i / lutSize;
      return lut;
    }

    if (!adaptivePacing) {
      for (let i = 0; i <= lutSize; i++) lut[i] = i / lutSize;
      return lut;
    }

    const n = track.points.length;
    const weights = new Float32Array(n);
    const cumWeights = new Float64Array(n);
    let totalWeight = 0;

    const summitU = precomputedStats.maxEleIdx / Math.max(1, n - 1);

    for (let i = 0; i < n; i++) {
      const u = i / Math.max(1, n - 1);
      const grad = precomputedStats.smoothedGradients[i];

      // Base pacing weight
      let w = 1.0;
      if (grad > 4.0) {
        // Slow down on climbs (>4%) so steep mountain sections get more screen time
        w += Math.min(1.65, (grad - 4.0) * 0.16);
      } else if (grad < 0.5) {
        // Move briskly across flat transfer sections & gentle descents
        w = 0.72;
      }

      // Summit linger bump so the 3D summit orbit feels unhurried and majestic
      const distFromSummit = Math.abs(u - summitU);
      if (distFromSummit < 0.035) {
        const summitFactor = Math.cos((distFromSummit / 0.035) * (Math.PI / 2));
        w += summitFactor * 1.15;
      }

      weights[i] = w;
      totalWeight += w;
      cumWeights[i] = totalWeight;
    }

    // Invert cumulative weight distribution into lut[0..lutSize]
    lut[0] = 0;
    lut[lutSize] = 1;
    let ptCursor = 0;
    for (let k = 1; k < lutSize; k++) {
      const targetW = (k / lutSize) * totalWeight;
      while (ptCursor < n - 1 && cumWeights[ptCursor] < targetW) {
        ptCursor++;
      }
      const prevIdx = Math.max(0, ptCursor - 1);
      const w0 = cumWeights[prevIdx];
      const w1 = cumWeights[ptCursor];
      const frac = w1 > w0 ? (targetW - w0) / (w1 - w0) : 0;
      lut[k] = clamp((prevIdx + frac) / Math.max(1, n - 1), 0, 1);
    }

    return lut;
  }, [precomputedStats, track, adaptivePacing]);

  // Precompute Smoothed Camera Trajectory & Bearings across 500 path steps
  const cameraPathLUT = useMemo(() => {
    if (!track || !track.points || track.points.length === 0 || !precomputedStats) return null;
    const points = track.points;
    const n = points.length;
    const steps = 500;

    const camLats = new Float64Array(steps + 1);
    const camLngs = new Float64Array(steps + 1);
    const camEles = new Float32Array(steps + 1);
    const camBearings = new Float32Array(steps + 1);

    // Smoothing window radius controlled by user's cameraSmoothing slider (0.10 .. 0.95)
    const radiusFrac = 0.008 + Math.pow(cameraSmoothing, 1.6) * 0.085;
    const windowRadius = Math.max(3, Math.floor(n * radiusFrac));
    const lookAheadOffset = Math.max(4, Math.floor(n * (0.018 + cameraSmoothing * 0.035)));

    let prevBearing = 0;

    for (let s = 0; s <= steps; s++) {
      const u = s / steps;
      const centerIdx = Math.min(n - 1, Math.floor(u * (n - 1)));

      // Gaussian-weighted moving average around a slightly look-ahead center point
      const focusIdx = Math.min(n - 1, centerIdx + Math.floor(lookAheadOffset * 0.35));
      let sumLat = 0,
        sumLng = 0,
        sumEle = 0,
        sumW = 0;

      const startI = Math.max(0, focusIdx - windowRadius);
      const endI = Math.min(n - 1, focusIdx + windowRadius);
      for (let i = startI; i <= endI; i++) {
        const normDist = (i - focusIdx) / Math.max(1, windowRadius);
        const w = Math.exp(-2.2 * normDist * normDist);
        sumLat += points[i].lat * w;
        sumLng += points[i].lng * w;
        sumEle += precomputedStats.smoothedElevations[i] * w;
        sumW += w;
      }

      camLats[s] = sumW > 0 ? sumLat / sumW : points[centerIdx].lat;
      camLngs[s] = sumW > 0 ? sumLng / sumW : points[centerIdx].lng;
      camEles[s] = sumW > 0 ? sumEle / sumW : precomputedStats.smoothedElevations[centerIdx];

      // Compute forward vector for camera bearing
      const idxBehind = Math.max(0, centerIdx - Math.floor(windowRadius * 0.6));
      const idxAhead = Math.min(n - 1, centerIdx + lookAheadOffset + Math.floor(windowRadius * 0.6));
      const p1 = points[idxBehind];
      const p2 = points[idxAhead];
      let rawBearing = prevBearing;
      if (p1 && p2) {
        const dLat = p2.lat - p1.lat;
        const dLng = (p2.lng - p1.lng) * Math.cos((p1.lat * Math.PI) / 180);
        if (Math.abs(dLat) > 1e-7 || Math.abs(dLng) > 1e-7) {
          rawBearing = Math.atan2(dLng, dLat);
        }
      }

      if (s === 0) {
        prevBearing = rawBearing;
      } else {
        // Exponential angular damping so hairpins glide smoothly without whipping
        const alpha = clamp(1.0 - cameraSmoothing * 0.88, 0.08, 0.65);
        prevBearing = lerpAngle(prevBearing, rawBearing, alpha);
      }
      camBearings[s] = prevBearing;
    }

    return { steps, camLats, camLngs, camEles, camBearings };
  }, [track, precomputedStats, cameraSmoothing]);

  // Initialize & Dispose RidgereelThreeEngine WebGL 3D Engine
  useEffect(() => {
    if (!isOpen) {
      if (engineRef.current) {
        engineRef.current.dispose();
        engineRef.current = null;
      }
      return;
    }
    if (!engineRef.current) {
      engineRef.current = new RidgereelThreeEngine();
    }
    return () => {
      if (engineRef.current) {
        engineRef.current.dispose();
        engineRef.current = null;
      }
    };
  }, [isOpen]);

  // Build 3D AWS Terrarium DEM Terrain Block & 3D Route Tube Mesh
  useEffect(() => {
    if (!isOpen || !track || !track.points || track.points.length === 0 || !precomputedStats) return;

    let active = true;
    if (!engineRef.current) {
      engineRef.current = new RidgereelThreeEngine();
    }
    const engine = engineRef.current;

    setTilesLoading(true);
    setTilesLoaded(0);
    setTilesTotal(1);

    engine
      .buildTerrainAndRoute(
        {
          points: track.points,
          smoothedElevations: precomputedStats.smoothedElevations,
          smoothedGradients: precomputedStats.smoothedGradients,
          smoothedSpeeds: precomputedStats.smoothedSpeeds,
          rawPowers: precomputedStats.rawPowers,
          rawHrs: precomputedStats.rawHrs,
          minLat: precomputedStats.minLat,
          maxLat: precomputedStats.maxLat,
          minLng: precomputedStats.minLng,
          maxLng: precomputedStats.maxLng,
          minEle: precomputedStats.minEle,
          maxEle: precomputedStats.maxEle,
          mapStyle,
          routeColorMode,
          theme
        },
        (loaded, total) => {
          if (active) {
            setTilesLoaded(loaded);
            setTilesTotal(total);
          }
        }
      )
      .then(() => {
        if (active) {
          setTilesLoading(false);
        }
      })
      .catch(() => {
        if (active) {
          setTilesLoading(false);
        }
      });

    return () => {
      active = false;
    };
  }, [isOpen, track, mapStyle, routeColorMode, theme, precomputedStats]);

  const cancelActiveRendering = useCallback(() => {
    isExportingRef.current = false;
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
      clearTimeout(animationFrameRef.current);
      animationFrameRef.current = null;
    }
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
    }
    setExporting(false);
    setExportProgress(0);
  }, []);

  const handleClose = useCallback(() => {
    cancelActiveRendering();
    if (downloadUrl) {
      URL.revokeObjectURL(downloadUrl);
      setDownloadUrl(null);
    }
    onClose();
  }, [cancelActiveRendering, downloadUrl, onClose]);

  const drawRoundedRect = (
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    w: number,
    h: number,
    r: number
  ) => {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
  };

  // Core 3D Flyover Studio Frame Compositor (Ridgereel Three.js WebGL + Broadcast HUD)
  const renderFrameToContext = useCallback(
    (
      ctx: CanvasRenderingContext2D,
      rawVideoProgress: number, // 0 to 1 of total video time
      width: number,
      height: number,
      previewMode: boolean = false
    ) => {
      if (!track || !track.points || track.points.length === 0 || !precomputedStats || !cameraPathLUT)
        return;

      const engine = engineRef.current;
      if (!engine) return;

      const points = track.points;
      const n = points.length;
      const stats = precomputedStats;
      const is2DMode = CAMERA_PRESETS[cameraPreset]?.is2D || cameraPitch <= 5;
      const routeDrawStep = Math.max(1, Math.floor(n / 450));

      // 1. Determine Flight Choreography Phase (Intro -> Active Flyover -> Outro)
      let introFactor = 0;
      let outroFactor = 0;
      let activeFlightT = rawVideoProgress;

      if (includeIntroOutro) {
        const introEnd = 0.07;
        const outroStart = 0.92;
        if (rawVideoProgress < introEnd) {
          const t = rawVideoProgress / introEnd;
          introFactor = 1 - easeInOutCubic(t);
          activeFlightT = 0;
        } else if (rawVideoProgress > outroStart) {
          const t = (rawVideoProgress - outroStart) / (1 - outroStart);
          outroFactor = easeInOutCubic(t);
          activeFlightT = 1;
        } else {
          activeFlightT = (rawVideoProgress - introEnd) / (outroStart - introEnd);
        }
      }

      // 2. Map activeFlightT (0..1) through Adaptive Climb Pacing LUT -> track progress u (0..1)
      const lutIdx = clamp(activeFlightT * 1000, 0, 1000);
      const lutFloor = Math.floor(lutIdx);
      const lutCeil = Math.min(1000, lutFloor + 1);
      const lutFrac = lutIdx - lutFloor;
      const routeU = lerp(timeWarpLUT[lutFloor], timeWarpLUT[lutCeil], lutFrac);

      const currentIdx = Math.min(n - 1, Math.floor(routeU * (n - 1)));
      const currentPoint = points[currentIdx];

      // Active Telemetry Values
      const currentDistanceKm = stats.cumulativeDistances[currentIdx] / 1000;
      const currentAscentM = stats.cumulativeAscents[currentIdx];
      const currentSpeedKmh = stats.smoothedSpeeds[currentIdx];
      const currentGradientPct = stats.smoothedGradients[currentIdx];
      const currentAltitude = stats.smoothedElevations[currentIdx];
      const currentPowerW = stats.rawPowers[currentIdx];
      const currentHrBpm = stats.rawHrs[currentIdx];

      // 3. Interpolate Smoothed Camera Bearing from cameraPathLUT
      const camStepIdx = clamp(routeU * cameraPathLUT.steps, 0, cameraPathLUT.steps);
      const cFloor = Math.floor(camStepIdx);
      const cCeil = Math.min(cameraPathLUT.steps, cFloor + 1);
      const cFrac = camStepIdx - cFloor;

      const macroOverviewFactor = Math.max(introFactor, outroFactor);
      const latRad = (((stats.minLat + stats.maxLat) / 2) * Math.PI) / 180;

      const baseBearing = lerpAngle(
        cameraPathLUT.camBearings[cFloor],
        cameraPathLUT.camBearings[cCeil],
        cFrac
      );

      // 4. Auto-Director & Summit Orbit Choreography
      const summitU = stats.maxEleIdx / Math.max(1, n - 1);
      const maxSpeedU = stats.maxSpeedIdx / Math.max(1, n - 1);
      const distFromSummit = routeU - summitU;
      const distFromSprint = routeU - maxSpeedU;

      let summitOrbitRad = 0;
      let directorPitchDelta = 0;
      let directorZoomMult = 1.0;
      let autoDirectorLabel = '';

      if (!is2DMode && autoDirector && macroOverviewFactor < 0.25) {
        if (Math.abs(distFromSummit) < 0.05) {
          const env = 0.5 + 0.5 * Math.cos((distFromSummit / 0.05) * Math.PI);
          const phase = (distFromSummit / 0.05) * Math.PI;
          summitOrbitRad = Math.sin(phase) * 0.65;
          directorPitchDelta = -8 * env;
          directorZoomMult = 1.0 - 0.18 * env;
          autoDirectorLabel = 'GIPFEL-PANORAMA';
        } else if (Math.abs(distFromSprint) < 0.045 && stats.maxSpeedVal > 30) {
          const env = 0.5 + 0.5 * Math.cos((distFromSprint / 0.045) * Math.PI);
          directorPitchDelta = 9 * env;
          directorZoomMult = 1.0 - 0.26 * env;
          autoDirectorLabel = 'SPRINT-CAM';
        } else if (currentGradientPct >= 5.5) {
          const climbIntensity = clamp((currentGradientPct - 5.5) / 6.0, 0, 1);
          directorPitchDelta = 7 * climbIntensity;
          directorZoomMult = 1.0 - 0.22 * climbIntensity;
          autoDirectorLabel = 'BERG-VERFOLGER';
        } else if (currentSpeedKmh >= 38 && currentGradientPct < -1.5) {
          const descIntensity = clamp((currentSpeedKmh - 38) / 18, 0, 1);
          directorPitchDelta = 6 * descIntensity;
          directorZoomMult = 1.0 - 0.16 * descIntensity;
          autoDirectorLabel = 'AERO-ABFAHRT';
        } else {
          autoDirectorLabel = cameraPreset === 'chase' ? 'FOLLOW-CAM' : 'DRONE-REGIE';
        }
      } else if (adaptivePacing && Math.abs(distFromSummit) < 0.045) {
        const phase = (distFromSummit / 0.045) * Math.PI;
        summitOrbitRad = Math.sin(phase) * 0.55;
      }

      // Continuous 360° orbit when Overview ('orbit') mode is selected
      const continuousOrbitRad =
        cameraPreset === 'orbit' ? rawVideoProgress * Math.PI * 2 * Math.max(0.4, orbitIntensity) : 0;
      const introOutroSpinRad = introFactor * -0.45 + outroFactor * 0.55;
      const finalBearing =
        baseBearing +
        summitOrbitRad +
        continuousOrbitRad +
        introOutroSpinRad +
        userOrbitYawRef.current;

      // Curve Banking / Roll Angle
      const prevLookBearing = cameraPathLUT.camBearings[Math.max(0, cFloor - 2)];
      const nextLookBearing = cameraPathLUT.camBearings[Math.min(cameraPathLUT.steps, cCeil + 2)];
      let turnDelta = nextLookBearing - prevLookBearing;
      while (turnDelta > Math.PI) turnDelta -= Math.PI * 2;
      while (turnDelta < -Math.PI) turnDelta += Math.PI * 2;
      const curveBankingRoll = clamp(-turnDelta * 0.22, -0.10, 0.10);
      const totalRollRad = is2DMode || cameraPreset === 'orbit' ? 0 : curveBankingRoll;

      // 5. Compute Three.js 3D Camera Position & Target (Ridgereel Follow / Drone / Overview)
      const directedPitch = clamp(
        cameraPitch + directorPitchDelta + userOrbitPitchRef.current,
        15,
        78
      );
      const effectivePitch = is2DMode ? 2 : lerp(directedPitch, 38, macroOverviewFactor * 0.65);
      const pitchNorm = clamp((effectivePitch - 20) / 55, 0, 1);
      const elevRad = ((90 - effectivePitch) * Math.PI) / 180; // angle above horizontal ground

      const riderWorldPos = engine.getPointWorldPosition(
        currentPoint.lat,
        currentPoint.lng,
        currentAltitude,
        terrainExaggeration
      );

      // Forward unit vector in Three.js world space (X = East, -Z = North)
      const fwdX = Math.sin(finalBearing);
      const fwdZ = -Math.cos(finalBearing);

      const terrainSpan = Math.max(2500, Math.hypot(engine.worldWidthM, engine.worldDepthM));
      const overviewBlend =
        cameraPreset === 'orbit'
          ? 0.65
          : macroOverviewFactor * 0.78;

      // Look-ahead shift so active rider stays in lower-center of screen and mountains ahead fill the frame
      const lookAheadMeters = is2DMode
        ? 0
        : lerp(180, 420, pitchNorm) * cameraAltitudeZoom * (1 - overviewBlend);

      const followTarget = new THREE.Vector3(
        riderWorldPos.x + fwdX * lookAheadMeters,
        riderWorldPos.y + lerp(10, 45, pitchNorm),
        riderWorldPos.z + fwdZ * lookAheadMeters
      );

      const dioramaCenterTarget = new THREE.Vector3(
        0,
        ((stats.maxEle - stats.minEle) * 0.35) * engine.baseAutoExag * terrainExaggeration,
        0
      );

      const cameraTarget = new THREE.Vector3().lerpVectors(
        followTarget,
        dioramaCenterTarget,
        overviewBlend
      );

      // Camera Standoff Radius in 3D World Meters
      const baseFollowDist = clamp(terrainSpan * 0.16, 480, 2200);
      const overviewDist = clamp(terrainSpan * 0.62, 1800, 9500);
      const rawDist = lerp(baseFollowDist, overviewDist, overviewBlend);
      const effectiveDist =
        rawDist * cameraAltitudeZoom * directorZoomMult * userOrbitZoomRef.current;

      const horizBack = effectiveDist * Math.cos(elevRad);
      const vertUp = effectiveDist * Math.sin(elevRad);

      const cameraPosition = new THREE.Vector3(
        cameraTarget.x - fwdX * horizBack,
        cameraTarget.y + vertUp,
        cameraTarget.z - fwdZ * horizBack
      );

      // Prevent camera from clipping below the 3D DEM terrain surface
      const camGroundEle = engine.getTerrainHeightAtWorld(cameraPosition.x, cameraPosition.z);
      const minCamY =
        Math.max(0, camGroundEle - engine.baseEle) * engine.baseAutoExag * terrainExaggeration + 45;
      if (cameraPosition.y < minCamY) {
        cameraPosition.y = minCamY;
      }

      const activePointColor = getPointRouteColor(
        routeColorMode,
        currentGradientPct,
        currentSpeedKmh,
        currentPowerW,
        currentHrBpm,
        theme
      );

      // 6. Render Hardware-Accelerated 3D WebGL Frame via RidgereelThreeEngine
      const webglCanvas = engine.renderFrame(width, height, {
        routeU,
        currentIdx,
        cameraPosition,
        cameraTarget,
        cameraRollRad: totalRollRad,
        terrainExaggeration,
        showElevationCurtain,
        showContourLines,
        showRiderAvatar,
        enableSunGlow,
        theme,
        routeColorMode,
        activeColorHex: activePointColor
      });

      // Composite 3D WebGL Scene onto the 2D Broadcast Canvas
      ctx.drawImage(webglCanvas, 0, 0, width, height);

      // Optional Atmospheric Sun Glow Corona overlay in upper sky
      if (!is2DMode && enableSunGlow) {
        ctx.save();
        const sunAngle = finalBearing - 0.78;
        const sunScreenX = width * 0.5 + Math.sin(sunAngle) * (width * 0.38);
        const sunScreenY = height * 0.08;
        const sunRadius = previewMode ? 220 : 420;
        const coronaRad = ctx.createRadialGradient(
          sunScreenX,
          sunScreenY,
          8,
          sunScreenX,
          sunScreenY,
          sunRadius
        );
        if (theme === 'sport-light') {
          coronaRad.addColorStop(0, 'rgba(255, 255, 255, 0.42)');
          coronaRad.addColorStop(0.4, 'rgba(254, 240, 138, 0.16)');
          coronaRad.addColorStop(1, 'rgba(255, 255, 255, 0)');
        } else {
          coronaRad.addColorStop(0, 'rgba(254, 215, 170, 0.28)');
          coronaRad.addColorStop(0.4, 'rgba(245, 158, 11, 0.09)');
          coronaRad.addColorStop(1, 'rgba(0, 0, 0, 0)');
        }
        ctx.fillStyle = coronaRad;
        ctx.beginPath();
        ctx.arc(sunScreenX, sunScreenY, sunRadius, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }

      // Subtle curve motion blur on sharp hairpins when enabled
      if (!is2DMode && enableMotionBlur && Math.abs(turnDelta) > 0.015) {
        ctx.save();
        const blurAlpha = clamp(Math.abs(turnDelta) * 1.6, 0.03, 0.11);
        ctx.globalAlpha = blurAlpha;
        ctx.translate(width / 2, height * 0.6);
        ctx.rotate(-turnDelta * 0.2);
        ctx.translate(-width / 2, -height * 0.6);
        ctx.drawImage(ctx.canvas, 0, 0);
        ctx.restore();
      }

      // 7. Project 3D Milestone Pins from Three.js World Space onto the 2D HUD
      let activeMilestoneBanner: MilestonePin | null = null;
      if (showMilestones) {
        stats.milestones.forEach((m) => {
          const pt = points[m.pointIndex];
          const ele = stats.smoothedElevations[m.pointIndex];
          const mWorld = engine.getPointWorldPosition(pt.lat, pt.lng, ele, terrainExaggeration);
          const posTop = engine.projectWorldToScreen(mWorld, width, height);

          const uDiff = Math.abs(routeU - m.progressU);
          const isNearActive = uDiff < 0.038 && macroOverviewFactor < 0.3;
          if (isNearActive && m.type !== 'start' && m.type !== 'finish') {
            activeMilestoneBanner = m;
          }

          if (
            posTop.visible &&
            posTop.x >= -60 &&
            posTop.x <= width + 60 &&
            posTop.y >= 40 &&
            posTop.y <= height - 60
          ) {
            ctx.save();
            const pinScale = (isNearActive ? 1.22 : 1.0) * (previewMode ? 0.75 : 1.0);
            const poleHeight = (isNearActive ? 36 : 24) * pinScale;

            // Vertical stem from 3D terrain point up to floating badge
            ctx.strokeStyle = m.color;
            ctx.lineWidth = isNearActive ? 2.5 : 1.5;
            ctx.beginPath();
            ctx.moveTo(posTop.x, posTop.y);
            ctx.lineTo(posTop.x, posTop.y - poleHeight);
            ctx.stroke();

            // Ground anchor ring
            ctx.fillStyle = m.color;
            ctx.beginPath();
            ctx.arc(posTop.x, posTop.y, 4 * pinScale, 0, Math.PI * 2);
            ctx.fill();

            // Floating Glass Callout Pill
            const badgeW = (isNearActive ? 148 : 118) * pinScale;
            const badgeH = (isNearActive ? 32 : 22) * pinScale;
            const badgeX = posTop.x - badgeW / 2;
            const badgeY = posTop.y - poleHeight - badgeH;

            ctx.fillStyle =
              theme === 'sport-light' ? 'rgba(255, 255, 255, 0.94)' : 'rgba(15, 23, 42, 0.92)';
            ctx.strokeStyle = m.color;
            ctx.lineWidth = isNearActive ? 2 : 1.2;
            drawRoundedRect(ctx, badgeX, badgeY, badgeW, badgeH, 7 * pinScale);
            ctx.fill();
            ctx.stroke();

            ctx.fillStyle = theme === 'sport-light' ? '#0f172a' : '#ffffff';
            ctx.textAlign = 'center';
            ctx.font = `800 ${Math.round(10 * pinScale)}px system-ui, sans-serif`;
            ctx.fillText(
              `${m.icon} ${m.title}`,
              posTop.x,
              badgeY + (isNearActive ? 13 * pinScale : 14 * pinScale)
            );

            if (isNearActive) {
              ctx.fillStyle = m.color;
              ctx.font = `700 ${Math.round(8.5 * pinScale)}px monospace`;
              ctx.fillText(m.subtitle, posTop.x, badgeY + 25 * pinScale);
            }
            ctx.restore();
          }
        });
      }

      // Project active rider screen coordinates for crisp 2D sonar ring reinforcement
      const userPos = engine.projectWorldToScreen(riderWorldPos, width, height);
      if (userPos.visible && userPos.x >= 0 && userPos.x <= width && userPos.y >= 0 && userPos.y <= height) {
        ctx.save();
        const pulseRadius =
          (previewMode ? 12 : 20) + Math.sin(rawVideoProgress * 90) * (previewMode ? 3.5 : 6);
        ctx.strokeStyle = activePointColor;
        ctx.lineWidth = previewMode ? 2 : 3;
        ctx.globalAlpha = 0.55;
        ctx.beginPath();
        ctx.arc(userPos.x, userPos.y, pulseRadius, 0, Math.PI * 2);
        ctx.stroke();

        ctx.globalAlpha = 1.0;
        ctx.fillStyle = '#ffffff';
        ctx.strokeStyle = activePointColor;
        ctx.lineWidth = previewMode ? 3 : 4.5;
        ctx.beginPath();
        ctx.arc(userPos.x, userPos.y, previewMode ? 5 : 8, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        ctx.restore();
      }

      // 15. HUD Styling Tokens
      const textPrimary = theme === 'sport-light' ? '#0f172a' : '#f8fafc';
      const textSecondary = theme === 'sport-light' ? '#475569' : '#94a3b8';
      const hudBg = theme === 'sport-light' ? 'rgba(255, 255, 255, 0.88)' : 'rgba(15, 23, 42, 0.82)';
      const hudBorder =
        theme === 'sport-light' ? 'rgba(203, 213, 225, 0.9)' : 'rgba(255, 255, 255, 0.12)';
      const pad = previewMode ? 16 : 32;

      // 16. TOP BAR: Compact Tour Header + Active Milestone Highlight Pill + Camera Angle Tag
      ctx.save();
      const topBarH = previewMode ? 38 : 56;
      const topBarW = previewMode ? 330 : 550;
      ctx.fillStyle = hudBg;
      ctx.strokeStyle = hudBorder;
      ctx.lineWidth = 1.2;
      drawRoundedRect(ctx, pad, pad * 0.75, topBarW, topBarH, 12);
      ctx.fill();
      ctx.stroke();

      // Tour Name
      ctx.fillStyle = textPrimary;
      ctx.textAlign = 'left';
      ctx.font = `800 ${previewMode ? 12 : 18}px system-ui, sans-serif`;
      const rawTitle = (track.name || 'Aktivität').toUpperCase();
      const truncatedTitle = rawTitle.length > 28 ? rawTitle.slice(0, 26) + '…' : rawTitle;
      ctx.fillText(truncatedTitle, pad + (previewMode ? 12 : 20), pad * 0.75 + (previewMode ? 16 : 24));

      // Sub-info: Distance progress + Camera Pitch / Auto-Director indicator
      const camModeBadge = is2DMode
        ? '2D MAP'
        : autoDirector && autoDirectorLabel
          ? `🎬 ${autoDirectorLabel} (${Math.round(effectivePitch)}°)`
          : `🎥 ${Math.round(effectivePitch)}° HELI`;
      ctx.fillStyle = textSecondary;
      ctx.font = `700 ${previewMode ? 8.5 : 12}px monospace`;
      ctx.fillText(
        `${currentDistanceKm.toFixed(1)} / ${(stats.totalDist / 1000).toFixed(1)} km  •  ${camModeBadge}`,
        pad + (previewMode ? 12 : 20),
        pad * 0.75 + (previewMode ? 30 : 44)
      );

      // Top-Right Route Color Legend Pill
      const legW = previewMode ? 165 : 265;
      const legX = width - legW - pad;
      const legY = pad * 0.75;
      ctx.fillStyle = hudBg;
      ctx.strokeStyle = hudBorder;
      drawRoundedRect(ctx, legX, legY, legW, topBarH, 12);
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = textSecondary;
      ctx.font = `800 ${previewMode ? 7.5 : 10}px system-ui, sans-serif`;
      const modeTitle =
        routeColorMode === 'gradient'
          ? 'STEIGUNG (FARBSKALA)'
          : routeColorMode === 'speed'
            ? 'TEMPO (FARBSKALA)'
            : routeColorMode === 'power'
              ? 'LEISTUNG / PULS'
              : 'KLASSISCH (HIGH-CONTRAST)';
      ctx.fillText(modeTitle, legX + (previewMode ? 10 : 16), legY + (previewMode ? 13 : 20));

      // Color scale bar inside Top-Right Pill
      const scaleColors = ['#38bdf8', '#10b981', '#eab308', '#f97316', '#ef4444'];
      const segW = (legW - (previewMode ? 20 : 32)) / scaleColors.length;
      scaleColors.forEach((c, idx) => {
        ctx.fillStyle = c;
        ctx.fillRect(
          legX + (previewMode ? 10 : 16) + idx * segW,
          legY + (previewMode ? 19 : 29),
          segW - 2,
          previewMode ? 5 : 7
        );
      });
      ctx.fillStyle = textSecondary;
      ctx.font = `700 ${previewMode ? 7 : 9.5}px monospace`;
      ctx.fillText(
        routeColorMode === 'gradient'
          ? '<0%   3%   6%   9%  >11%'
          : routeColorMode === 'speed'
            ? '<15   22   30   38  >45'
            : 'Z1    Z2   Z3   Z4   Z5',
        legX + (previewMode ? 10 : 16),
        legY + (previewMode ? 33 : 48)
      );
      ctx.restore();

      // Active Milestone Callout Toast Banner (when passing summit, climb, or max speed)
      if (activeMilestoneBanner) {
        const m = activeMilestoneBanner as MilestonePin;
        ctx.save();
        const bannerW = previewMode ? 210 : 340;
        const bannerH = previewMode ? 36 : 54;
        const bannerX = (width - bannerW) / 2;
        const bannerY = pad * 0.75;

        ctx.fillStyle = 'rgba(15, 23, 42, 0.92)';
        ctx.strokeStyle = m.color;
        ctx.lineWidth = 2;
        drawRoundedRect(ctx, bannerX, bannerY, bannerW, bannerH, 14);
        ctx.fill();
        ctx.stroke();

        ctx.fillStyle = '#ffffff';
        ctx.textAlign = 'center';
        ctx.font = `800 ${previewMode ? 10 : 15}px system-ui, sans-serif`;
        ctx.fillText(
          `${m.icon} ${m.title}`,
          width / 2,
          bannerY + (previewMode ? 15 : 23)
        );
        ctx.fillStyle = m.color;
        ctx.font = `700 ${previewMode ? 8.5 : 13}px monospace`;
        ctx.fillText(
          m.subtitle,
          width / 2,
          bannerY + (previewMode ? 28 : 42)
        );
        ctx.restore();
      }

      // 17. BOTTOM LEFT HUD: Pro-Broadcast Telemetry Cockpit (Speed Dial, W/kg, G-Force, 500m Radar)
      const hudW = previewMode ? 245 : 405;
      const hudH = previewMode ? (showProTelemetry ? 116 : 105) : (showProTelemetry ? 190 : 172);
      const hudX = pad;
      const hudY = height - hudH - (previewMode ? 12 : 24);

      ctx.save();
      ctx.fillStyle = hudBg;
      ctx.strokeStyle = hudBorder;
      ctx.lineWidth = 1.5;
      drawRoundedRect(ctx, hudX, hudY, hudW, hudH, 16);
      ctx.fill();
      ctx.stroke();

      // Speed Ring Dial Arc
      const ringCenterX = hudX + (previewMode ? 30 : 46);
      const ringCenterY = hudY + (previewMode ? 28 : 44);
      const ringRadius = previewMode ? 18 : 29;
      const ringStart = 0.75 * Math.PI;
      const ringEnd = 2.25 * Math.PI;
      const speedPct = clamp(currentSpeedKmh / 55, 0, 1);
      const ringCurrent = ringStart + speedPct * (ringEnd - ringStart);

      // Track ring background
      ctx.lineWidth = previewMode ? 3 : 5;
      ctx.strokeStyle = theme === 'sport-light' ? 'rgba(0,0,0,0.08)' : 'rgba(255,255,255,0.08)';
      ctx.beginPath();
      ctx.arc(ringCenterX, ringCenterY, ringRadius, ringStart, ringEnd);
      ctx.stroke();

      // Active speed arc
      ctx.strokeStyle = activePointColor;
      ctx.beginPath();
      ctx.arc(ringCenterX, ringCenterY, ringRadius, ringStart, ringCurrent);
      ctx.stroke();

      // Speed Value
      ctx.fillStyle = activePointColor;
      ctx.textAlign = 'left';
      ctx.font = `900 ${previewMode ? 24 : 42}px monospace`;
      ctx.fillText(
        currentSpeedKmh.toFixed(1),
        hudX + (previewMode ? 56 : 88),
        hudY + (previewMode ? 34 : 55)
      );

      ctx.fillStyle = textSecondary;
      ctx.font = `800 ${previewMode ? 8.5 : 13}px system-ui, sans-serif`;
      ctx.fillText(
        'km/h',
        hudX + (previewMode ? 116 : 190),
        hudY + (previewMode ? 33 : 53)
      );

      // Live Slope Gradient Pill
      const gradColor = getPointRouteColor('gradient', currentGradientPct, 0, 0, 0, theme);
      ctx.fillStyle = gradColor;
      ctx.font = `900 ${previewMode ? 14 : 23}px monospace`;
      ctx.textAlign = 'right';
      ctx.fillText(
        `${currentGradientPct >= 0 ? '+' : ''}${currentGradientPct.toFixed(1)}%`,
        hudX + hudW - (previewMode ? 14 : 22),
        hudY + (previewMode ? 34 : 55)
      );
      ctx.fillStyle = textSecondary;
      ctx.font = `800 ${previewMode ? 7 : 10}px sans-serif`;
      ctx.fillText(
        'STEIGUNG',
        hudX + hudW - (previewMode ? 14 : 22),
        hudY + (previewMode ? 17 : 27)
      );

      // Divider line
      ctx.strokeStyle = hudBorder;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(hudX + 14, hudY + (previewMode ? 48 : 76));
      ctx.lineTo(hudX + hudW - 14, hudY + (previewMode ? 48 : 76));
      ctx.stroke();

      // Compute Power, W/kg, Cadence, and Lateral G-Force
      const hasPower = currentPowerW > 0;
      const hasHr = currentHrBpm > 0;
      const estWatt = Math.round(
        clamp(
          userWeight * 2.1 + Math.max(0, currentGradientPct) * userWeight * 0.42 + (currentSpeedKmh * 3.8),
          90,
          520
        )
      );
      const effectiveWatts = hasPower ? currentPowerW : estWatt;
      const wattsPerKg = (effectiveWatts / Math.max(45, userWeight)).toFixed(1);
      const estCadence = Math.round(
        clamp(currentSpeedKmh > 2 ? 80 + (currentSpeedKmh - 22) * 0.8 - Math.max(0, currentGradientPct) * 2.2 : 0, 50, 110)
      );
      // Cornering G-Force calculation from speed and turn rate
      const speedMs = currentSpeedKmh / 3.6;
      const lateralG = clamp(1.0 + (speedMs * Math.abs(turnDelta) * 0.32) / 9.81, 1.0, 1.85);

      // Bottom Telemetry Row 1: HÖHE | ANSTIEG | LEISTUNG
      const colY = hudY + (previewMode ? 76 : 124);
      const lblFont = `800 ${previewMode ? 6.5 : 9.5}px sans-serif`;
      const valFont = `800 ${previewMode ? 10.5 : 17}px monospace`;

      ctx.textAlign = 'left';

      // Col 1: Altitude
      ctx.fillStyle = textSecondary;
      ctx.font = lblFont;
      ctx.fillText('HÖHE', hudX + (previewMode ? 14 : 22), colY - (previewMode ? 14 : 22));
      ctx.fillStyle = textPrimary;
      ctx.font = valFont;
      ctx.fillText(`${Math.round(currentAltitude)} m`, hudX + (previewMode ? 14 : 22), colY);

      // Col 2: Cumulative Ascent
      ctx.fillStyle = textSecondary;
      ctx.font = lblFont;
      ctx.fillText('ANSTIEG', hudX + (previewMode ? 74 : 124), colY - (previewMode ? 14 : 22));
      ctx.fillStyle = '#f59e0b';
      ctx.font = valFont;
      ctx.fillText(`+${Math.round(currentAscentM)} Hm`, hudX + (previewMode ? 74 : 124), colY);

      // Col 3: Power / HR
      ctx.fillStyle = textSecondary;
      ctx.font = lblFont;
      ctx.fillText(
        hasPower ? 'LEISTUNG' : hasHr ? 'HERZFREQUENZ' : 'WATT (EST.)',
        hudX + (previewMode ? 142 : 235),
        colY - (previewMode ? 14 : 22)
      );
      ctx.fillStyle = hasPower ? '#ec4899' : hasHr ? '#ef4444' : '#38bdf8';
      ctx.font = valFont;
      ctx.fillText(
        hasPower
          ? `${Math.round(currentPowerW)} W`
          : hasHr
            ? `♥ ${Math.round(currentHrBpm)}`
            : `${estWatt} W`,
        hudX + (previewMode ? 142 : 235),
        colY
      );

      // Cadence micro badge
      ctx.fillStyle = textSecondary;
      ctx.font = `700 ${previewMode ? 7.5 : 11}px monospace`;
      ctx.textAlign = 'right';
      ctx.fillText(`${estCadence} rpm`, hudX + hudW - (previewMode ? 14 : 20), colY);

      // Pro-Broadcast Telemetry Row 2: W/kg | G-Force | 500m Upcoming Slope Radar
      if (showProTelemetry) {
        const proY = hudY + (previewMode ? 103 : 168);

        // Subtle separator
        ctx.strokeStyle = hudBorder;
        ctx.lineWidth = 0.8;
        ctx.beginPath();
        ctx.moveTo(hudX + 14, hudY + (previewMode ? 84 : 138));
        ctx.lineTo(hudX + hudW - 14, hudY + (previewMode ? 84 : 138));
        ctx.stroke();

        // Compute average gradient of upcoming 500m
        const targetDistM = stats.cumulativeDistances[currentIdx] + 500;
        let lookIdx = currentIdx;
        while (lookIdx < n - 1 && stats.cumulativeDistances[lookIdx] < targetDistM) {
          lookIdx++;
        }
        const dDist = Math.max(10, stats.cumulativeDistances[lookIdx] - stats.cumulativeDistances[currentIdx]);
        const dEleNext = stats.smoothedElevations[lookIdx] - currentAltitude;
        const next500mGrad = clamp((dEleNext / dDist) * 100, -25, 25);
        const next500mColor = getPointRouteColor('gradient', next500mGrad, 0, 0, 0, theme);

        ctx.textAlign = 'left';
        ctx.font = `800 ${previewMode ? 7.5 : 11}px monospace`;

        // W/kg badge
        ctx.fillStyle = '#a855f7';
        ctx.fillText(`⚡ ${wattsPerKg} W/kg`, hudX + (previewMode ? 14 : 22), proY);

        // G-Force badge
        ctx.fillStyle = lateralG > 1.15 ? '#f97316' : textSecondary;
        ctx.fillText(`🎯 ${lateralG.toFixed(2)} G`, hudX + (previewMode ? 84 : 138), proY);

        // 500m Ahead Slope Radar
        ctx.textAlign = 'right';
        ctx.fillStyle = next500mColor;
        ctx.fillText(
          `500m VORSCHAU: ${next500mGrad >= 0 ? '+' : ''}${next500mGrad.toFixed(1)}%`,
          hudX + hudW - (previewMode ? 14 : 20),
          proY
        );
      }
      ctx.restore();

      // 18. BOTTOM RIGHT HUD: 2D Overview Minimap with Camera Heading Cone
      const miniW = previewMode ? 145 : 235;
      const miniH = previewMode ? 105 : 172;
      const miniX = width - miniW - pad;
      const miniY = height - miniH - (previewMode ? 12 : 24);

      ctx.save();
      ctx.fillStyle = hudBg;
      ctx.strokeStyle = hudBorder;
      ctx.lineWidth = 1.5;
      drawRoundedRect(ctx, miniX, miniY, miniW, miniH, 16);
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = textSecondary;
      ctx.font = `800 ${previewMode ? 7.5 : 10}px sans-serif`;
      ctx.fillText('STRECKEN-RADAR', miniX + 14, miniY + (previewMode ? 15 : 24));

      const mPad = previewMode ? 14 : 22;
      const mapW = miniW - mPad * 2;
      const mapH = miniH - mPad * 2 - (previewMode ? 8 : 14);
      const boxX = miniX + mPad;
      const boxY = miniY + mPad + (previewMode ? 8 : 14);

      const latSpan = stats.maxLat - stats.minLat;
      const lngSpan = stats.maxLng - stats.minLng;
      const maxSpan = Math.max(latSpan, lngSpan * Math.cos(latRad));

      const getMiniCoords = (lat: number, lng: number) => {
        const scale = Math.min(mapW, mapH) / (maxSpan || 0.0001);
        const mx =
          boxX +
          mapW / 2 +
          (lng - (stats.minLng + stats.maxLng) / 2) * scale * Math.cos(latRad);
        const my = boxY + mapH / 2 - (lat - (stats.minLat + stats.maxLat) / 2) * scale;
        return { x: mx, y: my };
      };

      // Full route outline in minimap
      ctx.strokeStyle =
        theme === 'sport-light' ? 'rgba(71, 85, 105, 0.22)' : 'rgba(255, 255, 255, 0.18)';
      ctx.lineWidth = previewMode ? 2 : 3;
      ctx.beginPath();
      for (let i = 0; i < n; i += routeDrawStep) {
        const p = getMiniCoords(points[i].lat, points[i].lng);
        if (i === 0) ctx.moveTo(p.x, p.y);
        else ctx.lineTo(p.x, p.y);
      }
      ctx.stroke();

      // Completed route in minimap
      ctx.strokeStyle = activePointColor;
      ctx.lineWidth = previewMode ? 2.8 : 4.5;
      ctx.beginPath();
      for (let i = 0; i <= currentIdx; i += routeDrawStep) {
        const p = getMiniCoords(points[i].lat, points[i].lng);
        if (i === 0) ctx.moveTo(p.x, p.y);
        else ctx.lineTo(p.x, p.y);
      }
      ctx.stroke();

      // Camera view frustum wedge on minimap
      const miniUserPos = getMiniCoords(currentPoint.lat, currentPoint.lng);
      ctx.fillStyle = activePointColor;
      ctx.globalAlpha = 0.25;
      ctx.beginPath();
      ctx.moveTo(miniUserPos.x, miniUserPos.y);
      const coneLen = previewMode ? 18 : 28;
      const angle1 = finalBearing - Math.PI / 2 - 0.45;
      const angle2 = finalBearing - Math.PI / 2 + 0.45;
      ctx.arc(miniUserPos.x, miniUserPos.y, coneLen, angle1, angle2);
      ctx.closePath();
      ctx.fill();
      ctx.globalAlpha = 1.0;

      // Active dot on minimap
      ctx.fillStyle = '#ffffff';
      ctx.strokeStyle = activePointColor;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(miniUserPos.x, miniUserPos.y, previewMode ? 4 : 6, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.restore();

      // 19. BOTTOM CENTER HUD: Elevation Profile with Gradient Coloring, Live Altitude Badge & Milestone Markers
      const centerW = width - hudW - miniW - pad * 2 - (previewMode ? 24 : 40);
      if (centerW > 110) {
        const centerH = previewMode ? 74 : 124;
        const centerX = hudX + hudW + (previewMode ? 12 : 20);
        const centerY = height - centerH - (previewMode ? 12 : 24);

        ctx.save();
        ctx.fillStyle = hudBg;
        ctx.strokeStyle = hudBorder;
        ctx.lineWidth = 1.5;
        drawRoundedRect(ctx, centerX, centerY, centerW, centerH, 16);
        ctx.fill();
        ctx.stroke();

        const gX = centerX + (previewMode ? 12 : 20);
        const gY = centerY + (previewMode ? 22 : 36);
        const gW = centerW - (previewMode ? 24 : 40);
        const gH = centerH - (previewMode ? 32 : 52);

        const eleDiff = Math.max(10, stats.maxEle - stats.minEle);
        const getProfileY = (eleVal: number) => {
          const ratio = (eleVal - stats.minEle) / eleDiff;
          return gY + gH - ratio * gH;
        };

        // Mid-altitude subtle guide line
        ctx.save();
        ctx.strokeStyle = theme === 'sport-light' ? 'rgba(0,0,0,0.06)' : 'rgba(255,255,255,0.06)';
        ctx.setLineDash([3, 4]);
        ctx.beginPath();
        const midY = gY + gH * 0.5;
        ctx.moveTo(gX, midY);
        ctx.lineTo(gX + gW, midY);
        ctx.stroke();
        ctx.restore();

        // Elevation area background fill (entire profile)
        ctx.fillStyle =
          theme === 'sport-light' ? 'rgba(37, 99, 235, 0.08)' : 'rgba(255, 255, 255, 0.05)';
        ctx.beginPath();
        ctx.moveTo(gX, gY + gH);
        for (let i = 0; i < n; i += routeDrawStep) {
          const px = gX + (i / Math.max(1, n - 1)) * gW;
          const py = getProfileY(stats.smoothedElevations[i]);
          ctx.lineTo(px, py);
        }
        ctx.lineTo(gX + gW, gY + gH);
        ctx.closePath();
        ctx.fill();

        // Active elevation area fill with gradient (completed section)
        if (currentIdx > 0) {
          const activeGrad = ctx.createLinearGradient(0, gY, 0, gY + gH);
          activeGrad.addColorStop(0, hexToRgba(activePointColor, 0.38));
          activeGrad.addColorStop(1, hexToRgba(activePointColor, 0.04));
          ctx.fillStyle = activeGrad;
          ctx.beginPath();
          ctx.moveTo(gX, gY + gH);
          for (let i = 0; i <= currentIdx; i += routeDrawStep) {
            const px = gX + (i / Math.max(1, n - 1)) * gW;
            const py = getProfileY(stats.smoothedElevations[i]);
            ctx.lineTo(px, py);
          }
          const curPx = gX + (currentIdx / Math.max(1, n - 1)) * gW;
          ctx.lineTo(curPx, gY + gH);
          ctx.closePath();
          ctx.fill();
        }

        // Full profile guide track line
        ctx.strokeStyle =
          theme === 'sport-light' ? 'rgba(71, 85, 105, 0.25)' : 'rgba(255, 255, 255, 0.20)';
        ctx.lineWidth = previewMode ? 1.5 : 2.0;
        ctx.beginPath();
        for (let i = 0; i < n; i += routeDrawStep) {
          const px = gX + (i / Math.max(1, n - 1)) * gW;
          const py = getProfileY(stats.smoothedElevations[i]);
          if (i === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        }
        ctx.stroke();

        // Colored active elevation line up to currentIdx
        ctx.lineWidth = previewMode ? 2.5 : 4.0;
        ctx.beginPath();
        for (let i = 0; i <= currentIdx; i += routeDrawStep) {
          const px = gX + (i / Math.max(1, n - 1)) * gW;
          const py = getProfileY(stats.smoothedElevations[i]);
          if (i === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        }
        ctx.strokeStyle = activePointColor;
        ctx.stroke();

        // Summit marker on elevation profile
        const sumX = gX + (stats.maxEleIdx / Math.max(1, n - 1)) * gW;
        const sumY = getProfileY(stats.maxEle);
        ctx.fillStyle = '#f59e0b';
        ctx.beginPath();
        ctx.arc(sumX, sumY, previewMode ? 3 : 5, 0, Math.PI * 2);
        ctx.fill();

        // Active tracker vertical needle & live badge
        const trackerX = gX + routeU * gW;
        const currentProfileY = getProfileY(currentAltitude);
        ctx.strokeStyle = activePointColor;
        ctx.lineWidth = 2.0;
        ctx.beginPath();
        ctx.moveTo(trackerX, gY - 2);
        ctx.lineTo(trackerX, gY + gH + 2);
        ctx.stroke();

        // Glowing circle at current spot on profile
        ctx.fillStyle = '#ffffff';
        ctx.strokeStyle = activePointColor;
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.arc(trackerX, currentProfileY, previewMode ? 3.5 : 5.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();

        // Header Title: Elevation Range
        ctx.fillStyle = textSecondary;
        ctx.font = `800 ${previewMode ? 7.5 : 10.5}px sans-serif`;
        ctx.fillText(
          `HÖHENPROFIL (${Math.round(stats.minEle)}m – ${Math.round(stats.maxEle)}m)`,
          gX,
          centerY + (previewMode ? 14 : 22)
        );

        // Header Right: Total Ascent & Remaining
        const remainingAscent = Math.max(0, Math.round(stats.totalAscent - currentAscentM));
        ctx.textAlign = 'right';
        ctx.fillStyle = activePointColor;
        ctx.font = `800 ${previewMode ? 7 : 10}px monospace`;
        ctx.fillText(
          `▲ +${Math.round(currentAscentM)} Hm / +${Math.round(stats.totalAscent)} Hm (Noch ${remainingAscent} Hm)`,
          gX + gW,
          centerY + (previewMode ? 14 : 22)
        );
        ctx.textAlign = 'left';

        // Floating live altitude badge on current position
        if (trackerX >= gX + 35 && trackerX <= gX + gW - 35) {
          const badgeText = `${Math.round(currentAltitude)}m (${currentGradientPct >= 0 ? '+' : ''}${currentGradientPct.toFixed(1)}%)`;
          ctx.font = `800 ${previewMode ? 7 : 9.5}px monospace`;
          const badgeW = ctx.measureText(badgeText).width + (previewMode ? 8 : 12);
          const badgeH = previewMode ? 13 : 18;
          const badgeY = Math.max(gY + 2, currentProfileY - badgeH - (previewMode ? 4 : 6));
          const badgeX = clamp(trackerX - badgeW / 2, gX, gX + gW - badgeW);

          ctx.fillStyle = theme === 'sport-light' ? '#0f172a' : '#020617';
          ctx.strokeStyle = activePointColor;
          ctx.lineWidth = 1.0;
          drawRoundedRect(ctx, badgeX, badgeY, badgeW, badgeH, 4);
          ctx.fill();
          ctx.stroke();

          ctx.fillStyle = '#ffffff';
          ctx.textAlign = 'center';
          ctx.fillText(badgeText, badgeX + badgeW / 2, badgeY + (previewMode ? 9.5 : 13));
          ctx.textAlign = 'left';
        }

        ctx.restore();
      }

      // 20. CINEMATIC INTRO & OUTRO STORYTELLING OVERLAY CARDS (Relive / Komoot Style)
      if (includeIntroOutro && (introFactor > 0.05 || outroFactor > 0.05)) {
        const cardAlpha = clamp(Math.max(introFactor, outroFactor) * 1.15, 0, 0.96);
        const isOutro = outroFactor > introFactor;
        ctx.save();
        ctx.globalAlpha = cardAlpha;

        const cardW = previewMode ? 320 : 560;
        const cardH = previewMode ? 128 : 215;
        const cardX = (width - cardW) / 2;
        const cardY = height * 0.16;

        ctx.fillStyle = 'rgba(9, 13, 24, 0.88)';
        ctx.strokeStyle = isOutro ? '#10b981' : '#f97316';
        ctx.lineWidth = 2;
        drawRoundedRect(ctx, cardX, cardY, cardW, cardH, 20);
        ctx.fill();
        ctx.stroke();

        ctx.textAlign = 'center';
        ctx.fillStyle = isOutro ? '#10b981' : '#f97316';
        ctx.font = `800 ${previewMode ? 8.5 : 13}px system-ui, sans-serif`;
        ctx.fillText(
          isOutro ? '🏁 TOUR ERFOLGREICH ABGESCHLOSSEN' : '🏔️ 3D KOMOOT / RELIVE TOUR-ÜBERFLUG',
          width / 2,
          cardY + (previewMode ? 24 : 40)
        );

        ctx.fillStyle = '#ffffff';
        ctx.font = `900 ${previewMode ? 16 : 28}px system-ui, sans-serif`;
        const cardTitle =
          (track.name || 'GPX Tour').length > 32
            ? (track.name || 'GPX Tour').slice(0, 30) + '…'
            : track.name || 'GPX Tour';
        ctx.fillText(cardTitle, width / 2, cardY + (previewMode ? 48 : 82));

        // 4 Summary Metrics Row inside Card
        const metrics = [
          { label: 'DISTANZ', value: `${(stats.totalDist / 1000).toFixed(1)} km` },
          { label: 'ANSTIEG', value: `+${Math.round(stats.totalAscent)} Hm` },
          { label: 'GIPFEL', value: `${Math.round(stats.maxEle)} m` },
          { label: 'MAX SPEED', value: `${stats.maxSpeedVal.toFixed(1)} km/h` }
        ];
        const mColW = (cardW - (previewMode ? 32 : 56)) / metrics.length;
        metrics.forEach((m, idx) => {
          const mx = cardX + (previewMode ? 16 : 28) + mColW * (idx + 0.5);
          ctx.fillStyle = '#94a3b8';
          ctx.font = `700 ${previewMode ? 7.5 : 11}px sans-serif`;
          ctx.fillText(m.label, mx, cardY + (previewMode ? 80 : 136));

          ctx.fillStyle = '#f8fafc';
          ctx.font = `800 ${previewMode ? 11.5 : 20}px monospace`;
          ctx.fillText(m.value, mx, cardY + (previewMode ? 100 : 168));
        });

        ctx.restore();
      }
    },
    [
      track,
      precomputedStats,
      cameraPathLUT,
      cameraPreset,
      cameraPitch,
      cameraAltitudeZoom,
      terrainExaggeration,
      orbitIntensity,
      includeIntroOutro,
      adaptivePacing,
      timeWarpLUT,
      theme,
      mapStyle,
      routeColorMode,
      showMilestones,
      showElevationCurtain,
      showContourLines,
      autoDirector,
      showRiderAvatar,
      showProTelemetry,
      userWeight,
      enableMotionBlur,
      enableSunGlow
    ]
  );



  // Recording & Export Engine
  const startRecordingAndExport = async () => {
    if (!track || !track.points || track.points.length === 0 || !precomputedStats) return;
    setExporting(true);
    isExportingRef.current = true;
    setExportProgress(0);
    setExportError(null);
    setDownloadUrl(null);
    recordedChunksRef.current = [];

    await new Promise((resolve) => setTimeout(resolve, 120));

    const exportCanvas = canvasRef.current;
    if (!exportCanvas) {
      setExportError('Canvas-Objekt konnte nicht geladen werden.');
      setExporting(false);
      isExportingRef.current = false;
      return;
    }

    const w = resolution === '4k' ? 3840 : resolution === '1080p' ? 1920 : 1280;
    const h = resolution === '4k' ? 2160 : resolution === '1080p' ? 1080 : 720;
    exportCanvas.width = w;
    exportCanvas.height = h;

    const ctx = exportCanvas.getContext('2d');
    if (!ctx) {
      setExportError('2D Canvas-System konnte nicht initialisiert werden.');
      setExporting(false);
      isExportingRef.current = false;
      return;
    }

    let stream: MediaStream;
    try {
      stream = exportCanvas.captureStream(fps);
    } catch {
      setExportError('Browser-Schnittstelle zur Aufnahme des Canvas-Streams wird nicht unterstützt.');
      setExporting(false);
      isExportingRef.current = false;
      return;
    }

    let chosenMime = '';
    let ext = 'webm';

    if (exportFormat === 'mp4') {
      const mp4Types = ['video/mp4;codecs=h264', 'video/mp4;codecs=avc1', 'video/mp4'];
      for (const t of mp4Types) {
        if (MediaRecorder.isTypeSupported(t)) {
          chosenMime = t;
          ext = 'mp4';
          break;
        }
      }
      if (!chosenMime) {
        const webmTypes = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'];
        for (const t of webmTypes) {
          if (MediaRecorder.isTypeSupported(t)) {
            chosenMime = t;
            ext = 'webm';
            break;
          }
        }
      }
    } else {
      const webmTypes = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'];
      for (const t of webmTypes) {
        if (MediaRecorder.isTypeSupported(t)) {
          chosenMime = t;
          ext = 'webm';
          break;
        }
      }
    }

    setActualExt(ext);
    const targetBitrate =
      resolution === '4k'
        ? fps === 60
          ? 36_000_000
          : 25_000_000
        : resolution === '1080p'
          ? fps === 60
            ? 18_000_000
            : 10_000_000
          : fps === 60
            ? 8_000_000
            : 5_000_000;
    const options = chosenMime ? { mimeType: chosenMime, videoBitsPerSecond: targetBitrate } : undefined;

    try {
      const recorder = new MediaRecorder(stream, options);
      mediaRecorderRef.current = recorder;

      recorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) {
          recordedChunksRef.current.push(event.data);
        }
      };

      recorder.onstop = () => {
        if (!isExportingRef.current) return;
        const mimeType = (options && options.mimeType) || 'video/webm';
        const blob = new Blob(recordedChunksRef.current, { type: mimeType });
        const url = URL.createObjectURL(blob);
        setDownloadUrl(url);
        setExportProgress(100);
        setExporting(false);
        isExportingRef.current = false;
      };

      recorder.start();

      const totalFrames = Math.max(60, Math.round(videoLength * fps));
      let currentFrame = 0;
      const frameIntervalMs = Math.max(2, Math.floor(1000 / fps));

      const nextFrame = () => {
        if (!isExportingRef.current) return;

        const progress = currentFrame / Math.max(1, totalFrames - 1);
        setExportProgress(Math.round(progress * 100));

        ctx.clearRect(0, 0, w, h);
        renderFrameToContext(ctx, progress, w, h, false);

        currentFrame++;
        if (currentFrame < totalFrames) {
          animationFrameRef.current = window.setTimeout(nextFrame, frameIntervalMs);
        } else {
          setTimeout(() => {
            if (recorder && recorder.state !== 'inactive') {
              recorder.stop();
            }
          }, 350);
        }
      };

      animationFrameRef.current = window.setTimeout(nextFrame, frameIntervalMs);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setExportError(`Fehler bei der Videofahr-Generierung: ${msg}`);
      setExporting(false);
      isExportingRef.current = false;
    }
  };

  // Interactive Live Preview Loop (supports Play, Pause, Scrubber, and real-time slider adjustments)
  useEffect(() => {
    if (!isOpen || exporting || !track || !precomputedStats) return;

    const canvas = livePreviewCanvasRef.current;
    if (!canvas) return;

    canvas.width = 800;
    canvas.height = 450;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let lastTimestamp: number | null = null;

    const tickPreview = (timestamp: number) => {
      if (lastTimestamp === null) lastTimestamp = timestamp;
      const dtSec = (timestamp - lastTimestamp) / 1000;
      lastTimestamp = timestamp;

      if (isPlayingPreview && !isScrubbingRef.current) {
        // Advance preview progress based on selected videoLength (capped to reasonable preview loop speed)
        const previewDurationSec = clamp(videoLength * 0.65, 16, 45) / previewSpeedMultiplier;
        const nextP = (previewProgressRef.current + dtSec / previewDurationSec) % 1.0;
        previewProgressRef.current = nextP;
        setPreviewProgress(nextP);
      }

      ctx.clearRect(0, 0, 800, 450);
      renderFrameToContext(ctx, previewProgressRef.current, 800, 450, true);

      animationFrameRef.current = requestAnimationFrame(tickPreview);
    };

    animationFrameRef.current = requestAnimationFrame(tickPreview);

    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, [
    isOpen,
    exporting,
    track,
    precomputedStats,
    isPlayingPreview,
    videoLength,
    previewSpeedMultiplier,
    renderFrameToContext
  ]);

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !exporting) {
        handleClose();
      } else if (e.key === ' ' && !exporting) {
        e.preventDefault();
        setIsPlayingPreview((p) => !p);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = originalOverflow;
    };
  }, [isOpen, exporting, handleClose]);

  const handleScrubChange = (val: number) => {
    const clamped = clamp(val, 0, 1);
    previewProgressRef.current = clamped;
    setPreviewProgress(clamped);
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-[500] flex items-center justify-center p-2 sm:p-4 pt-[max(0.5rem,env(safe-area-inset-top))] pb-[max(0.5rem,env(safe-area-inset-bottom))]">
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={exporting ? undefined : handleClose}
            className="absolute inset-0 bg-slate-950/75 backdrop-blur-md cursor-pointer"
          />

          {/* Studio Modal Container */}
          <motion.div
            initial={{ opacity: 0, scale: 0.96, y: 12 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 12 }}
            className="relative bg-white dark:bg-slate-900 rounded-3xl shadow-2xl border border-slate-200 dark:border-slate-800 w-full max-w-6xl max-h-[calc(100dvh-1rem)] sm:max-h-[92vh] overflow-y-auto flex flex-col p-4 sm:p-6 cursor-default"
          >
            {/* Header */}
            <div className="flex items-center justify-between pb-3.5 border-b border-slate-100 dark:border-slate-800 gap-3">
              <div className="min-w-0 flex-1 flex items-center gap-3">
                <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-orange-500 to-indigo-600 text-white flex items-center justify-center shadow-lg shadow-orange-500/20 shrink-0">
                  <Film size={20} />
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h3 className="text-base sm:text-lg font-extrabold text-slate-900 dark:text-white truncate">
                      3D-Überflug-Video-Studio
                    </h3>
                    <span className="text-[10px] font-black uppercase tracking-wider px-2 py-0.5 rounded-md bg-orange-500/10 text-orange-600 dark:text-orange-400 border border-orange-500/20">
                      Ridgereel 3D WebGL & AWS Terrarium DEM
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400 font-medium truncate hidden sm:block">
                    Echte 3D-Berge aus AWS-Terrarium-Höhenkacheln, plastische 3D-Tube-Streckenlinie, Follow/Drone/Overview-Regie & Maus-Orbit
                  </p>
                </div>
              </div>

              {!exporting && (
                <button
                  onClick={handleClose}
                  className="p-2 min-w-[40px] min-h-[40px] flex items-center justify-center text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer shrink-0"
                  title="Schließen"
                  aria-label="Schließen"
                >
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    width="20"
                    height="20"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.5"
                  >
                    <line x1="18" y1="6" x2="6" y2="18" />
                    <line x1="6" y1="6" x2="18" y2="18" />
                  </svg>
                </button>
              )}
            </div>

            {/* Studio Main Grid */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 py-4">
              {/* LEFT: Studio Control Rail (5 cols) */}
              <div className="lg:col-span-5 flex flex-col gap-4">
                {/* 3-Tab Studio Switcher */}
                <div className="grid grid-cols-3 gap-1.5 p-1 bg-slate-100 dark:bg-slate-800/80 rounded-2xl border border-slate-200/70 dark:border-slate-700/60">
                  <button
                    type="button"
                    disabled={exporting}
                    onClick={() => setActiveTab('camera')}
                    className={`py-2 px-2.5 rounded-xl text-xs font-extrabold flex items-center justify-center gap-1.5 transition-all cursor-pointer ${
                      activeTab === 'camera'
                        ? 'bg-white dark:bg-slate-900 text-indigo-600 dark:text-indigo-400 shadow-sm'
                        : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                    }`}
                  >
                    <Camera size={14} />
                    <span>Kamera</span>
                  </button>
                  <button
                    type="button"
                    disabled={exporting}
                    onClick={() => setActiveTab('pacing')}
                    className={`py-2 px-2.5 rounded-xl text-xs font-extrabold flex items-center justify-center gap-1.5 transition-all cursor-pointer ${
                      activeTab === 'pacing'
                        ? 'bg-white dark:bg-slate-900 text-indigo-600 dark:text-indigo-400 shadow-sm'
                        : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                    }`}
                  >
                    <Clock size={14} />
                    <span>Dauer & Tempo</span>
                  </button>
                  <button
                    type="button"
                    disabled={exporting}
                    onClick={() => setActiveTab('style')}
                    className={`py-2 px-2.5 rounded-xl text-xs font-extrabold flex items-center justify-center gap-1.5 transition-all cursor-pointer ${
                      activeTab === 'style'
                        ? 'bg-white dark:bg-slate-900 text-indigo-600 dark:text-indigo-400 shadow-sm'
                        : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                    }`}
                  >
                    <Palette size={14} />
                    <span>Stil & Pins</span>
                  </button>
                </div>

                {/* TAB 1: CAMERA & PERSPECTIVE */}
                {activeTab === 'camera' && (
                  <div className="space-y-4">
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <label className="text-[11px] font-black text-slate-500 dark:text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
                          <Compass size={13} className="text-indigo-500" />
                          Kamera-Perspektive (Presets)
                        </label>
                        <button
                          type="button"
                          disabled={exporting}
                          onClick={() => handleSelectCameraPreset('helicopter')}
                          className="text-[10px] font-bold text-indigo-600 dark:text-indigo-400 hover:underline flex items-center gap-1 cursor-pointer"
                        >
                          <RotateCcw size={11} />
                          55° Standard
                        </button>
                      </div>

                      <div className="grid grid-cols-2 gap-2">
                        {(
                          ['helicopter', 'chase', 'tactical', 'orbit'] as CameraPresetId[]
                        ).map((presetKey) => {
                          const p = CAMERA_PRESETS[presetKey];
                          const isSelected = cameraPreset === presetKey;
                          return (
                            <button
                              key={presetKey}
                              type="button"
                              disabled={exporting}
                              onClick={() => handleSelectCameraPreset(presetKey)}
                              className={`p-2.5 rounded-xl border text-left transition-all cursor-pointer flex flex-col justify-between ${
                                isSelected
                                  ? 'bg-indigo-600/10 dark:bg-indigo-500/15 border-indigo-600 dark:border-indigo-400 ring-1 ring-indigo-500/30'
                                  : 'bg-slate-50 dark:bg-slate-800/60 border-slate-200 dark:border-slate-700/70 hover:bg-slate-100 dark:hover:bg-slate-800'
                              }`}
                            >
                              <div className="flex items-center justify-between gap-1 w-full">
                                <span
                                  className={`text-xs font-extrabold truncate ${
                                    isSelected
                                      ? 'text-indigo-700 dark:text-indigo-300'
                                      : 'text-slate-800 dark:text-slate-200'
                                  }`}
                                >
                                  {p.label}
                                </span>
                                {p.badge && (
                                  <span
                                    className={`text-[9px] font-black px-1.5 py-0.5 rounded shrink-0 ${
                                      isSelected
                                        ? 'bg-indigo-600 text-white'
                                        : 'bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300'
                                    }`}
                                  >
                                    {p.badge}
                                  </span>
                                )}
                              </div>
                              <p className="text-[10px] text-slate-500 dark:text-slate-400 mt-1 line-clamp-2 leading-tight">
                                {p.description}
                              </p>
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    {/* Fine-Tuning Sliders */}
                    <div className="bg-slate-50 dark:bg-slate-800/50 p-3.5 rounded-2xl border border-slate-200/80 dark:border-slate-800 space-y-3.5">
                      <div className="flex items-center justify-between">
                        <span className="text-[11px] font-black text-slate-600 dark:text-slate-300 uppercase tracking-wider flex items-center gap-1.5">
                          <Sliders size={13} className="text-indigo-500" />
                          Feineinstellung (Live im Video)
                        </span>
                        <button
                          type="button"
                          disabled={exporting}
                          onClick={() =>
                            handleSelectCameraPreset(
                              cameraPreset === 'map2d' ? 'helicopter' : 'map2d'
                            )
                          }
                          className={`text-[10px] font-bold px-2 py-0.5 rounded-md border cursor-pointer ${
                            cameraPreset === 'map2d'
                              ? 'bg-indigo-600 text-white border-indigo-600'
                              : 'bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700'
                          }`}
                        >
                          {cameraPreset === 'map2d' ? 'Zurück zu 3D' : '2D Modus'}
                        </button>
                      </div>

                      {/* Slider 1: Pitch Angle */}
                      <div className="space-y-1">
                        <div className="flex justify-between text-xs">
                          <span className="font-bold text-slate-600 dark:text-slate-300">
                            Kameraneigung (Pitch-Winkel)
                          </span>
                          <span className="font-mono font-extrabold text-indigo-600 dark:text-indigo-400">
                            {cameraPitch}° {cameraPitch === 55 ? '(Optimal)' : ''}
                          </span>
                        </div>
                        <input
                          type="range"
                          min={25}
                          max={75}
                          step={1}
                          disabled={exporting || cameraPreset === 'map2d'}
                          value={cameraPitch}
                          onChange={(e) => {
                            setCameraPitch(Number(e.target.value));
                            setDownloadUrl(null);
                          }}
                          className="w-full accent-indigo-600 cursor-pointer h-1.5 bg-slate-200 dark:bg-slate-700 rounded-lg"
                        />
                        <div className="flex justify-between text-[9px] font-semibold text-slate-400">
                          <span>25° Steil (Vogelblick)</span>
                          <span>55° Helikopter-Panorama</span>
                          <span>75° Flach (Verfolger)</span>
                        </div>
                      </div>

                      {/* Slider 2: Altitude / Distance Zoom */}
                      <div className="space-y-1">
                        <div className="flex justify-between text-xs">
                          <span className="font-bold text-slate-600 dark:text-slate-300">
                            Flughöhe & Tal-Überblick
                          </span>
                          <span className="font-mono font-extrabold text-indigo-600 dark:text-indigo-400">
                            {cameraAltitudeZoom.toFixed(2)}x
                          </span>
                        </div>
                        <input
                          type="range"
                          min={0.5}
                          max={2.0}
                          step={0.05}
                          disabled={exporting}
                          value={cameraAltitudeZoom}
                          onChange={(e) => {
                            setCameraAltitudeZoom(Number(e.target.value));
                            setDownloadUrl(null);
                          }}
                          className="w-full accent-indigo-600 cursor-pointer h-1.5 bg-slate-200 dark:bg-slate-700 rounded-lg"
                        />
                        <div className="flex justify-between text-[9px] font-semibold text-slate-400">
                          <span>0.5x Nah am Fahrer</span>
                          <span>1.0x Standard</span>
                          <span>2.0x Weitwinkel-Panorama</span>
                        </div>
                      </div>

                      {/* Slider 3: Camera Damping / Smoothing */}
                      <div className="space-y-1">
                        <div className="flex justify-between text-xs">
                          <span className="font-bold text-slate-600 dark:text-slate-300">
                            Kameraträgheit (Kurven-Glättung)
                          </span>
                          <span className="font-mono font-extrabold text-indigo-600 dark:text-indigo-400">
                            {Math.round(cameraSmoothing * 100)}%
                          </span>
                        </div>
                        <input
                          type="range"
                          min={0.15}
                          max={0.95}
                          step={0.05}
                          disabled={exporting}
                          value={cameraSmoothing}
                          onChange={(e) => {
                            setCameraSmoothing(Number(e.target.value));
                            setDownloadUrl(null);
                          }}
                          className="w-full accent-indigo-600 cursor-pointer h-1.5 bg-slate-200 dark:bg-slate-700 rounded-lg"
                        />
                        <div className="flex justify-between text-[9px] font-semibold text-slate-400">
                          <span>Direkt (Serpentinen-nah)</span>
                          <span>Butterweicher Helikopter-Flug</span>
                        </div>
                      </div>

                      {/* Slider 4: 3D Terrain Exaggeration */}
                      <div className="space-y-1.5">
                        <div className="flex justify-between text-xs">
                          <span className="font-bold text-slate-600 dark:text-slate-300">
                            3D-Gelände-Überhöhung (Relief-Verstärkung)
                          </span>
                          <span className="font-mono font-extrabold text-indigo-600 dark:text-indigo-400">
                            {terrainExaggeration.toFixed(1)}x
                          </span>
                        </div>
                        {/* Quick preset buttons */}
                        <div className="grid grid-cols-4 gap-1">
                          {[
                            { val: 1.0, label: '1.0x Real' },
                            { val: 1.6, label: '1.6x Natürlich' },
                            { val: 2.2, label: '2.2x Ausgeprägt' },
                            { val: 3.2, label: '3.2x Dramatisch' }
                          ].map((pre) => (
                            <button
                              key={pre.val}
                              type="button"
                              disabled={exporting || cameraPreset === 'map2d'}
                              onClick={() => {
                                setTerrainExaggeration(pre.val);
                                setDownloadUrl(null);
                              }}
                              className={`py-1 px-1 rounded-lg border text-[9px] font-extrabold text-center transition-all cursor-pointer ${
                                Math.abs(terrainExaggeration - pre.val) < 0.15
                                  ? 'bg-indigo-600 border-indigo-600 text-white shadow-sm'
                                  : 'bg-slate-50 dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-750'
                              }`}
                            >
                              {pre.label}
                            </button>
                          ))}
                        </div>
                        <input
                          type="range"
                          min={1.0}
                          max={3.5}
                          step={0.1}
                          disabled={exporting || cameraPreset === 'map2d'}
                          value={terrainExaggeration}
                          onChange={(e) => {
                            setTerrainExaggeration(Number(e.target.value));
                            setDownloadUrl(null);
                          }}
                          className="w-full accent-indigo-600 cursor-pointer h-1.5 bg-slate-200 dark:bg-slate-700 rounded-lg"
                        />
                        <div className="flex justify-between text-[9px] font-semibold text-slate-400">
                          <span>1.0x Realistisch</span>
                          <span>2.0x Ausgeprägt</span>
                          <span>3.5x Dramatisch</span>
                        </div>
                      </div>

                      {/* Auto-Director Camera Choreography Toggle */}
                      <label className="flex items-center justify-between gap-3 p-2.5 rounded-xl bg-indigo-50/70 dark:bg-indigo-950/35 border border-indigo-200/80 dark:border-indigo-800/60 cursor-pointer">
                        <div>
                          <div className="text-xs font-extrabold text-slate-800 dark:text-slate-100 flex items-center gap-1.5">
                            <span>🎬</span> Automatische Kamera-Regie (Auto-Director)
                          </div>
                          <div className="text-[10px] text-slate-500 dark:text-slate-400">
                            Sanfte Kamerazooms & Winkelwechsel bei Gipfeln, Sprints und Steilanstiegen
                          </div>
                        </div>
                        <input
                          type="checkbox"
                          disabled={exporting || cameraPreset === 'map2d'}
                          checked={autoDirector}
                          onChange={(e) => {
                            setAutoDirector(e.target.checked);
                            setDownloadUrl(null);
                          }}
                          className="w-4 h-4 accent-indigo-600 rounded cursor-pointer shrink-0"
                        />
                      </label>
                    </div>
                  </div>
                )}

                {/* TAB 2: DURATION & PACING */}
                {activeTab === 'pacing' && (
                  <div className="space-y-4">
                    {/* Smart Auto-Duration Card */}
                    <div className="bg-indigo-50/70 dark:bg-indigo-950/30 p-3.5 rounded-2xl border border-indigo-200/70 dark:border-indigo-800/50 space-y-3">
                      <div className="flex items-center justify-between gap-2">
                        <div>
                          <span className="text-xs font-extrabold text-slate-900 dark:text-white flex items-center gap-1.5">
                            <Sparkles size={14} className="text-indigo-500" />
                            Smart Auto-Dauer & Videolänge
                          </span>
                          <p className="text-[10px] text-slate-500 dark:text-slate-400 mt-0.5">
                            Berechnet aus {precomputedStats ? (precomputedStats.totalDist / 1000).toFixed(1) : 0} km Distanz & +{precomputedStats ? Math.round(precomputedStats.totalAscent) : 0} Hm Anstieg
                          </p>
                        </div>
                        <button
                          type="button"
                          disabled={exporting}
                          onClick={() => {
                            setIsAutoDuration(true);
                            if (precomputedStats) setVideoLength(precomputedStats.autoDurationSec);
                            setDownloadUrl(null);
                          }}
                          className={`px-2.5 py-1.5 rounded-xl text-[11px] font-black transition-all cursor-pointer shrink-0 ${
                            isAutoDuration
                              ? 'bg-indigo-600 text-white shadow-sm'
                              : 'bg-white dark:bg-slate-800 text-indigo-600 dark:text-indigo-400 border border-indigo-300 dark:border-indigo-700'
                          }`}
                        >
                          ✨ Auto ({precomputedStats?.autoDurationSec || 45}s)
                        </button>
                      </div>

                      {/* Continuous 15s - 180s Slider */}
                      <div className="space-y-1">
                        <div className="flex justify-between text-xs">
                          <span className="font-bold text-slate-600 dark:text-slate-300">
                            Gewählte Videodauer:
                          </span>
                          <span className="font-mono font-black text-indigo-600 dark:text-indigo-400 text-sm">
                            {videoLength} Sekunden ({Math.floor(videoLength / 60)}:
                            {String(videoLength % 60).padStart(2, '0')} min)
                          </span>
                        </div>
                        <input
                          type="range"
                          min={15}
                          max={180}
                          step={1}
                          disabled={exporting}
                          value={videoLength}
                          onChange={(e) => {
                            setIsAutoDuration(false);
                            setVideoLength(Number(e.target.value));
                            setDownloadUrl(null);
                          }}
                          className="w-full accent-indigo-600 cursor-pointer h-1.5 bg-slate-200 dark:bg-slate-700 rounded-lg"
                        />
                      </div>

                      {/* Quick Duration Presets */}
                      <div className="grid grid-cols-5 gap-1.5">
                        {[25, 45, 60, 90, 120].map((sec) => (
                          <button
                            key={sec}
                            type="button"
                            disabled={exporting}
                            onClick={() => {
                              setIsAutoDuration(false);
                              setVideoLength(sec);
                              setDownloadUrl(null);
                            }}
                            className={`py-1.5 rounded-lg text-[11px] font-extrabold border transition-all cursor-pointer ${
                              videoLength === sec && !isAutoDuration
                                ? 'bg-indigo-600 border-indigo-600 text-white'
                                : 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-100'
                            }`}
                          >
                            {sec}s
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Storytelling & Pacing Toggles */}
                    <div className="space-y-2.5">
                      <label className="flex items-start justify-between gap-3 p-3 rounded-2xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-800 cursor-pointer">
                        <div className="space-y-0.5">
                          <span className="text-xs font-extrabold text-slate-800 dark:text-slate-100 flex items-center gap-1.5">
                            <Mountain size={14} className="text-orange-500" />
                            Adaptives Berg-Pacing & Gipfel-Orbit
                          </span>
                          <p className="text-[10px] text-slate-500 dark:text-slate-400 leading-relaxed">
                            Verlangsamt den Flug an steilen Anstiegen (&gt;4%) und vollführt am höchsten Punkt ({Math.round(precomputedStats?.maxEle || 0)}m) einen sanften 3D-Panorama-Schwenk.
                          </p>
                        </div>
                        <input
                          type="checkbox"
                          disabled={exporting}
                          checked={adaptivePacing}
                          onChange={(e) => {
                            setAdaptivePacing(e.target.checked);
                            setDownloadUrl(null);
                          }}
                          className="mt-1 w-4 h-4 accent-indigo-600 rounded cursor-pointer shrink-0"
                        />
                      </label>

                      <label className="flex items-start justify-between gap-3 p-3 rounded-2xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-800 cursor-pointer">
                        <div className="space-y-0.5">
                          <span className="text-xs font-extrabold text-slate-800 dark:text-slate-100 flex items-center gap-1.5">
                            <Film size={14} className="text-emerald-500" />
                            Relive Intro-Anflug & Finisher Summary Card
                          </span>
                          <p className="text-[10px] text-slate-500 dark:text-slate-400 leading-relaxed">
                            Startet mit einem 3D-Gesamtüberblick + Tour-Titelkarte und zoomt im Ziel auf die Finisher-Zusammenfassung heraus.
                          </p>
                        </div>
                        <input
                          type="checkbox"
                          disabled={exporting}
                          checked={includeIntroOutro}
                          onChange={(e) => {
                            setIncludeIntroOutro(e.target.checked);
                            setDownloadUrl(null);
                          }}
                          className="mt-1 w-4 h-4 accent-indigo-600 rounded cursor-pointer shrink-0"
                        />
                      </label>
                    </div>
                  </div>
                )}

                {/* TAB 3: STYLE, ROUTE COLORING & EXPORT QUALITY */}
                {activeTab === 'style' && (
                  <div className="space-y-4">
                    {/* Dynamic Route Coloring Mode */}
                    <div className="space-y-1.5">
                      <label className="text-[11px] font-black text-slate-500 dark:text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
                        <Zap size={13} className="text-orange-500" />
                        Dynamische Strecken-Farbcodierung
                      </label>
                      <div className="grid grid-cols-2 gap-2">
                        {(
                          [
                            { id: 'gradient', label: '📐 Nach Steigung (%)', desc: 'Blau → Grün → Gelb → Rot' },
                            { id: 'speed', label: '⚡ Nach Tempo (km/h)', desc: 'Kühl → Cyan → Grün → Flamme' },
                            { id: 'power', label: '🔥 Nach Watt / Puls', desc: 'Trainingszonen Z1 bis Z5' },
                            { id: 'classic', label: '🧡 Komoot / Relive', desc: 'Kontraststarkes Leuchtband' }
                          ] as { id: RouteColorMode; label: string; desc: string }[]
                        ).map((item) => (
                          <button
                            key={item.id}
                            type="button"
                            disabled={exporting}
                            onClick={() => {
                              setRouteColorMode(item.id);
                              setDownloadUrl(null);
                            }}
                            className={`p-2 rounded-xl border text-left transition-all cursor-pointer ${
                              routeColorMode === item.id
                                ? 'bg-indigo-600/10 dark:bg-indigo-500/15 border-indigo-600 dark:border-indigo-400'
                                : 'bg-slate-50 dark:bg-slate-800/60 border-slate-200 dark:border-slate-700/70'
                            }`}
                          >
                            <div className="text-xs font-extrabold text-slate-800 dark:text-slate-100">
                              {item.label}
                            </div>
                            <div className="text-[9px] text-slate-500 dark:text-slate-400 mt-0.5">
                              {item.desc}
                            </div>
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* 3D Milestone Pins Toggle */}
                    <label className="flex items-center justify-between gap-3 p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700/70 cursor-pointer">
                      <div className="flex items-center gap-2">
                        <Award size={15} className="text-amber-500 shrink-0" />
                        <div>
                          <div className="text-xs font-extrabold text-slate-800 dark:text-slate-100">
                            3D-Meilenstein-Pins (Gipfel, Anstiege, Top-Speed)
                          </div>
                          <div className="text-[10px] text-slate-500 dark:text-slate-400">
                            Zeigt schwebende 3D-Badges entlang der Strecke
                          </div>
                        </div>
                      </div>
                      <input
                        type="checkbox"
                        disabled={exporting}
                        checked={showMilestones}
                        onChange={(e) => {
                          setShowMilestones(e.target.checked);
                          setDownloadUrl(null);
                        }}
                        className="w-4 h-4 accent-indigo-600 rounded cursor-pointer shrink-0"
                      />
                    </label>

                    {/* Map Tile Design & HUD Theme */}
                    <div className="space-y-3">
                      <div className="space-y-1.5">
                        <label className="text-[10px] font-black text-slate-500 uppercase tracking-wider flex items-center gap-1">
                          <Layers size={11} /> Karten-Stil & Geländetextur (High-Res HD)
                        </label>
                        <div className="grid grid-cols-3 gap-1.5">
                          {(
                            [
                              { id: 'satellite', label: '🛰️ Satellit HD' },
                              { id: 'topo', label: '⛰️ Topo Outdoor' },
                              { id: 'relief', label: '🌄 Geländerelief' },
                              { id: 'outdoor', label: '🏕️ OSM Standard' },
                              { id: 'streets-dark', label: '🕶️ Dark Tactical' },
                              { id: 'streets-light', label: '🏙️ Voyager Clean' }
                            ] as { id: MapStyle; label: string }[]
                          ).map((st) => (
                            <button
                              key={st.id}
                              type="button"
                              disabled={exporting}
                              onClick={() => {
                                setMapStyle(st.id);
                                setDownloadUrl(null);
                              }}
                              className={`py-1.5 px-2 rounded-lg border text-[10px] font-extrabold transition-all cursor-pointer ${
                                mapStyle === st.id
                                  ? 'bg-indigo-600 border-indigo-600 text-white shadow-sm'
                                  : 'bg-slate-50 dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-750'
                              }`}
                            >
                              {st.label}
                            </button>
                          ))}
                        </div>
                      </div>

                      {/* HUD Theme */}
                      <div className="space-y-1.5 pt-1">
                        <label className="text-[10px] font-black text-slate-500 uppercase tracking-wider">
                          HUD-Design
                        </label>
                        <div className="grid grid-cols-3 gap-1">
                          {(
                            [
                              { id: 'tactical', label: '🕶️ Tactical Dark' },
                              { id: 'neon', label: '⚡ Cyber Neon' },
                              { id: 'sport-light', label: '☀️ Sport Light' }
                            ] as { id: ThemeMode; label: string }[]
                          ).map((t) => (
                            <button
                              key={t.id}
                              type="button"
                              disabled={exporting}
                              onClick={() => setTheme(t.id)}
                              className={`py-1.5 px-2 rounded-lg border text-[10px] font-extrabold transition-all cursor-pointer ${
                                theme === t.id
                                  ? 'bg-indigo-600 border-indigo-600 text-white shadow-sm'
                                  : 'bg-slate-50 dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300'
                              }`}
                            >
                              {t.label}
                            </button>
                          ))}
                        </div>
                      </div>

                      {/* Video Resolution & Framerate */}
                      <div className="space-y-2 pt-1 border-t border-slate-200/60 dark:border-slate-750">
                        <div className="flex items-center justify-between">
                          <label className="text-[10px] font-black text-slate-500 uppercase tracking-wider">
                            Export-Auflösung & Framerate
                          </label>
                          <span className="text-[9px] font-bold text-indigo-500 uppercase tracking-wider">
                            Ultra-HD Engine
                          </span>
                        </div>
                        <div className="grid grid-cols-3 gap-1.5">
                          {(
                            [
                              { id: '720p', label: '720p HD', sub: '1280×720' },
                              { id: '1080p', label: '1080p FHD', sub: '1920×1080' },
                              { id: '4k', label: '4K UHD ⭐', sub: '3840×2160' }
                            ] as { id: ResolutionOption; label: string; sub: string }[]
                          ).map((res) => (
                            <button
                              key={res.id}
                              type="button"
                              disabled={exporting}
                              onClick={() => {
                                setResolution(res.id);
                                setDownloadUrl(null);
                              }}
                              className={`py-1.5 px-2 rounded-lg border text-center transition-all cursor-pointer ${
                                resolution === res.id
                                  ? 'bg-indigo-600 border-indigo-600 text-white shadow-sm'
                                  : 'bg-slate-50 dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-750'
                              }`}
                            >
                              <div className="text-[10px] font-extrabold">{res.label}</div>
                              <div className="text-[8px] opacity-75 font-mono">{res.sub}</div>
                            </button>
                          ))}
                        </div>

                        {/* FPS Selector */}
                        <div className="grid grid-cols-2 gap-2 pt-1">
                          {(
                            [
                              { id: 60, label: '🚀 60 FPS (Ultra Smooth)', desc: 'Flüssigste Kameraführung' },
                              { id: 30, label: '🎞️ 30 FPS (Standard)', desc: 'Schnellere Rendierung' }
                            ] as { id: ExportFps; label: string; desc: string }[]
                          ).map((fpsOption) => (
                            <button
                              key={fpsOption.id}
                              type="button"
                              disabled={exporting}
                              onClick={() => {
                                setFps(fpsOption.id);
                                setDownloadUrl(null);
                              }}
                              className={`p-2 rounded-xl border text-left transition-all cursor-pointer ${
                                fps === fpsOption.id
                                  ? 'bg-indigo-600/10 dark:bg-indigo-500/15 border-indigo-600 dark:border-indigo-400'
                                  : 'bg-slate-50 dark:bg-slate-800/60 border-slate-200 dark:border-slate-700/70'
                              }`}
                            >
                              <div className="text-[10px] font-extrabold text-slate-800 dark:text-slate-100">
                                {fpsOption.label}
                              </div>
                              <div className="text-[8.5px] text-slate-500 dark:text-slate-400">
                                {fpsOption.desc}
                              </div>
                            </button>
                          ))}
                        </div>
                      </div>

                      {/* Visual & Atmosphere Effects */}
                      <div className="space-y-1.5 pt-1 border-t border-slate-200/60 dark:border-slate-750">
                        <label className="text-[10px] font-black text-slate-500 uppercase tracking-wider">
                          Cinematische Effekte & Pro-Broadcast HUD
                        </label>
                        <div className="grid grid-cols-1 gap-1.5">
                          <label className="flex items-center justify-between p-2 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700/70 cursor-pointer">
                            <div>
                              <div className="text-[11px] font-extrabold text-slate-800 dark:text-slate-100 flex items-center gap-1.5">
                                <span>🚴</span> 3D-Radfahrer-Avatar & Kometen-Lichtspur
                              </div>
                              <div className="text-[9px] text-slate-500 dark:text-slate-400">
                                Aero-Glider mit dynamischer Kurvenneigung, Scheinwerferkegel & Glow-Trail
                              </div>
                            </div>
                            <input
                              type="checkbox"
                              disabled={exporting}
                              checked={showRiderAvatar}
                              onChange={(e) => {
                                setShowRiderAvatar(e.target.checked);
                                setDownloadUrl(null);
                              }}
                              className="w-4 h-4 accent-indigo-600 rounded cursor-pointer shrink-0"
                            />
                          </label>

                          <label className="flex items-center justify-between p-2 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700/70 cursor-pointer">
                            <div>
                              <div className="text-[11px] font-extrabold text-slate-800 dark:text-slate-100 flex items-center gap-1.5">
                                <span>📊</span> Pro-Broadcast Telemetrie (W/kg, G-Force, 500m-Radar)
                              </div>
                              <div className="text-[9px] text-slate-500 dark:text-slate-400">
                                Spezifische Leistung, Kurven-Fliehkraft und 500m-Steigungs-Vorschau
                              </div>
                            </div>
                            <input
                              type="checkbox"
                              disabled={exporting}
                              checked={showProTelemetry}
                              onChange={(e) => {
                                setShowProTelemetry(e.target.checked);
                                setDownloadUrl(null);
                              }}
                              className="w-4 h-4 accent-indigo-600 rounded cursor-pointer shrink-0"
                            />
                          </label>

                          <label className="flex items-center justify-between p-2 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700/70 cursor-pointer">
                            <div>
                              <div className="text-[11px] font-extrabold text-slate-800 dark:text-slate-100 flex items-center gap-1.5">
                                <span>🏔️</span> 3D-Höhenvorhang unter der Strecke (Farbverlauf)
                              </div>
                              <div className="text-[9px] text-slate-500 dark:text-slate-400">
                                Projiziert vertikalen Vorhang von der Trasse zum Talboden mit Steigungsfarben
                              </div>
                            </div>
                            <input
                              type="checkbox"
                              disabled={exporting}
                              checked={showElevationCurtain}
                              onChange={(e) => {
                                setShowElevationCurtain(e.target.checked);
                                setDownloadUrl(null);
                              }}
                              className="w-4 h-4 accent-indigo-600 rounded cursor-pointer shrink-0"
                            />
                          </label>

                          <label className="flex items-center justify-between p-2 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700/70 cursor-pointer">
                            <div>
                              <div className="text-[11px] font-extrabold text-slate-800 dark:text-slate-100 flex items-center gap-1.5">
                                <span>🌐</span> Topografische Höhenlinien & Sonnen-Schummerung
                              </div>
                              <div className="text-[9px] text-slate-500 dark:text-slate-400">
                                Hebt Geländestufen, Bergschultern und Geländefalten plastisch hervor
                              </div>
                            </div>
                            <input
                              type="checkbox"
                              disabled={exporting}
                              checked={showContourLines}
                              onChange={(e) => {
                                setShowContourLines(e.target.checked);
                                setDownloadUrl(null);
                              }}
                              className="w-4 h-4 accent-indigo-600 rounded cursor-pointer shrink-0"
                            />
                          </label>

                          <label className="flex items-center justify-between p-2 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700/70 cursor-pointer">
                            <div>
                              <div className="text-[11px] font-extrabold text-slate-800 dark:text-slate-100 flex items-center gap-1.5">
                                <span>⚡</span> Kurven-Motion-Blur (Cinematic Flow)
                              </div>
                              <div className="text-[9px] text-slate-500 dark:text-slate-400">
                                Erzeugt dynamische Drehdynamik und Verwischung bei engen Kehren
                              </div>
                            </div>
                            <input
                              type="checkbox"
                              disabled={exporting}
                              checked={enableMotionBlur}
                              onChange={(e) => {
                                setEnableMotionBlur(e.target.checked);
                                setDownloadUrl(null);
                              }}
                              className="w-4 h-4 accent-indigo-600 rounded cursor-pointer shrink-0"
                            />
                          </label>

                          <label className="flex items-center justify-between p-2 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700/70 cursor-pointer">
                            <div>
                              <div className="text-[11px] font-extrabold text-slate-800 dark:text-slate-100 flex items-center gap-1.5">
                                <span>☀️</span> Atmosphärischer Sonnen-Glow & Horizontnebel
                              </div>
                              <div className="text-[9px] text-slate-500 dark:text-slate-400">
                                Sonnenschein-Korona, volumetrische Lichtreflexe und Bergdunst
                              </div>
                            </div>
                            <input
                              type="checkbox"
                              disabled={exporting}
                              checked={enableSunGlow}
                              onChange={(e) => {
                                setEnableSunGlow(e.target.checked);
                                setDownloadUrl(null);
                              }}
                              className="w-4 h-4 accent-indigo-600 rounded cursor-pointer shrink-0"
                            />
                          </label>
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {/* Tile Preloading Indicator */}
                {tilesLoading && (
                  <div className="bg-indigo-50 dark:bg-indigo-950/40 px-3 py-2 rounded-xl border border-indigo-100 dark:border-indigo-900/40 text-[11px] font-bold text-indigo-600 dark:text-indigo-400 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="w-2 h-2 bg-indigo-500 rounded-full animate-ping" />
                      <span>3D-Gelände (AWS Terrarium DEM) & Texturen werden geladen…</span>
                    </div>
                    <span className="font-mono">
                      {tilesLoaded} / {tilesTotal}
                    </span>
                  </div>
                )}
              </div>

              {/* RIGHT: Interactive 16:9 3D Viewport + Timeline Scrubber (7 cols) */}
              <div className="lg:col-span-7 flex flex-col justify-between space-y-3">
                <div className="space-y-2">
                  <div className="flex items-center justify-between flex-wrap gap-2">
                    <span className="text-xs font-black text-slate-500 dark:text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
                      <Eye size={14} className="text-indigo-500" />
                      Interaktive 3D-Echtzeit-Vorschau (Maus-Orbit & Zoom)
                    </span>
                    <div className="flex items-center gap-2">
                      {hasCustomOrbit && (
                        <button
                          type="button"
                          onClick={resetCustomOrbit}
                          className="text-[10px] font-extrabold px-2 py-0.5 rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 transition-colors cursor-pointer flex items-center gap-1"
                        >
                          <RotateCcw size={10} />
                          Kamera zentrieren
                        </button>
                      )}
                      <span className="text-[11px] font-mono font-bold text-slate-500 dark:text-slate-400">
                        {CAMERA_PRESETS[cameraPreset]?.label} • {cameraPitch}° Neigung • {videoLength}s
                      </span>
                    </div>
                  </div>

                  {/* 16:9 Viewport Container */}
                  <div className="relative aspect-[16/9] w-full rounded-2xl border border-slate-200 dark:border-slate-800 bg-slate-950 shadow-xl overflow-hidden flex items-center justify-center">
                    {/* Hidden High-Res Export Canvas */}
                    <canvas ref={canvasRef} className="hidden" />

                    {/* Interactive Live Preview Canvas with Ridgereel Mouse Orbit & Wheel Zoom */}
                    {!exporting && (
                      <canvas
                        ref={livePreviewCanvasRef}
                        onPointerDown={(e) => {
                          isDraggingOrbitRef.current = true;
                          dragLastPosRef.current = { x: e.clientX, y: e.clientY };
                          e.currentTarget.setPointerCapture(e.pointerId);
                        }}
                        onPointerMove={(e) => {
                          if (!isDraggingOrbitRef.current) return;
                          const dx = e.clientX - dragLastPosRef.current.x;
                          const dy = e.clientY - dragLastPosRef.current.y;
                          dragLastPosRef.current = { x: e.clientX, y: e.clientY };
                          userOrbitYawRef.current += dx * 0.0065;
                          userOrbitPitchRef.current = clamp(
                            userOrbitPitchRef.current - dy * 0.18,
                            -35,
                            25
                          );
                          if (!hasCustomOrbit) setHasCustomOrbit(true);
                        }}
                        onPointerUp={(e) => {
                          isDraggingOrbitRef.current = false;
                          try {
                            e.currentTarget.releasePointerCapture(e.pointerId);
                          } catch {
                            // ignore
                          }
                        }}
                        onWheel={(e) => {
                          e.preventDefault();
                          const zoomDelta = e.deltaY > 0 ? 1.08 : 0.92;
                          userOrbitZoomRef.current = clamp(
                            userOrbitZoomRef.current * zoomDelta,
                            0.35,
                            2.8
                          );
                          if (!hasCustomOrbit) setHasCustomOrbit(true);
                        }}
                        title="Ziehen zum Drehen der 3D-Kamera • Mausrad zum Zoomen"
                        className="w-full h-full object-cover cursor-grab active:cursor-grabbing touch-none"
                      />
                    )}

                    {/* Export Progress Overlay */}
                    {exporting && (
                      <div className="absolute inset-0 bg-slate-950/85 backdrop-blur-md flex flex-col items-center justify-center p-6 text-center text-white z-20">
                        <div className="w-14 h-14 rounded-full border-4 border-indigo-500 border-t-transparent animate-spin mb-4" />
                        <h4 className="text-base sm:text-lg font-black tracking-tight mb-1">
                          Rendere 3D-Überflug-Video ({resolution})…
                        </h4>
                        <p className="text-xs text-slate-400 font-semibold max-w-sm">
                          {videoLength} Sekunden mit {cameraPitch}° Panorama-Perspektive & adaptivem Berg-Pacing werden aufgezeichnet.
                        </p>

                        <div className="w-64 bg-slate-800 h-2.5 rounded-full overflow-hidden mt-5 border border-slate-700/50">
                          <motion.div
                            className="bg-gradient-to-r from-indigo-500 to-orange-500 h-full rounded-full"
                            style={{ width: `${exportProgress}%` }}
                          />
                        </div>
                        <span className="text-xs font-bold font-mono text-indigo-400 mt-2">
                          Fortschritt: {exportProgress}%
                        </span>
                      </div>
                    )}
                  </div>

                  {/* Interactive Timeline Scrubber & Transport Bar */}
                  {!exporting && (
                    <div className="bg-slate-50 dark:bg-slate-800/70 p-3 rounded-2xl border border-slate-200/80 dark:border-slate-800 space-y-2">
                      <div className="flex items-center gap-3">
                        <button
                          type="button"
                          onClick={() => setIsPlayingPreview((p) => !p)}
                          className="w-9 h-9 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white flex items-center justify-center shadow-sm transition-colors cursor-pointer shrink-0"
                          title={isPlayingPreview ? 'Vorschau pausieren (Leertaste)' : 'Vorschau abspielen (Leertaste)'}
                        >
                          {isPlayingPreview ? <Pause size={16} /> : <Play size={16} />}
                        </button>

                        <div className="flex-1 space-y-1">
                          <div className="flex items-center justify-between text-[10px] font-bold text-slate-500 dark:text-slate-400">
                            <span>
                              Timeline-Scrubber (Ziehen zum Prüfen der Perspektive am Gipfel)
                            </span>
                            <span className="font-mono text-indigo-600 dark:text-indigo-400">
                              {Math.round(previewProgress * 100)}% •{' '}
                              {Math.round(previewProgress * videoLength)}s / {videoLength}s
                            </span>
                          </div>
                          <input
                            type="range"
                            min={0}
                            max={1}
                            step={0.002}
                            value={previewProgress}
                            onMouseDown={() => {
                              isScrubbingRef.current = true;
                            }}
                            onMouseUp={() => {
                              isScrubbingRef.current = false;
                            }}
                            onTouchStart={() => {
                              isScrubbingRef.current = true;
                            }}
                            onTouchEnd={() => {
                              isScrubbingRef.current = false;
                            }}
                            onChange={(e) => handleScrubChange(Number(e.target.value))}
                            className="w-full accent-indigo-600 cursor-pointer h-1.5 bg-slate-200 dark:bg-slate-700 rounded-lg"
                          />
                        </div>

                        <button
                          type="button"
                          onClick={() =>
                            setPreviewSpeedMultiplier((s) => (s === 1 ? 2 : 1))
                          }
                          className="px-2.5 py-1.5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-[11px] font-mono font-extrabold text-slate-700 dark:text-slate-300 hover:bg-slate-100 cursor-pointer shrink-0"
                          title="Vorschau-Geschwindigkeit umschalten"
                        >
                          {previewSpeedMultiplier}x
                        </button>
                      </div>

                      {/* Quick Jump Milestone Buttons on Scrubber */}
                      {precomputedStats && precomputedStats.milestones.length > 0 && (
                        <div className="flex items-center gap-1.5 flex-wrap pt-0.5">
                          <span className="text-[10px] font-bold text-slate-400 mr-1">
                            Springe zu:
                          </span>
                          {precomputedStats.milestones.map((m) => {
                            // Map track progressU approximately to video progress
                            const targetProgress = includeIntroOutro
                              ? 0.07 + m.progressU * 0.85
                              : m.progressU;
                            return (
                              <button
                                key={m.id}
                                type="button"
                                onClick={() => {
                                  setIsPlayingPreview(false);
                                  handleScrubChange(targetProgress);
                                }}
                                className="px-2 py-0.5 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-[10px] font-bold text-slate-700 dark:text-slate-300 hover:border-indigo-500 transition-colors cursor-pointer flex items-center gap-1"
                              >
                                <span>{m.icon}</span>
                                <span>{m.title}</span>
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Error Alert */}
            {exportError && (
              <div className="p-3 bg-red-100 dark:bg-red-950/60 text-red-700 dark:text-red-300 border border-red-200 dark:border-red-800 rounded-xl text-xs font-bold my-1">
                ⚠️ {exportError}
              </div>
            )}

            {/* Footer Action Bar */}
            <div className="flex flex-col sm:flex-row items-center justify-between gap-3 mt-2 pt-3.5 border-t border-slate-100 dark:border-slate-800">
              <div className="flex items-center gap-3 flex-wrap">
                <div className="flex items-center gap-1.5 bg-slate-100 dark:bg-slate-800 p-1 rounded-xl">
                  {(['mp4', 'webm'] as ('mp4' | 'webm')[]).map((fmt) => (
                    <button
                      key={fmt}
                      type="button"
                      disabled={exporting}
                      onClick={() => {
                        setExportFormat(fmt);
                        setDownloadUrl(null);
                      }}
                      className={`py-1 px-2.5 rounded-lg text-[11px] font-extrabold transition-all cursor-pointer uppercase ${
                        exportFormat === fmt
                          ? 'bg-white dark:bg-slate-900 text-indigo-600 dark:text-indigo-400 shadow-sm'
                          : 'text-slate-500 dark:text-slate-400'
                      }`}
                    >
                      .{fmt}
                    </button>
                  ))}
                </div>
                <span className="text-[11px] text-slate-400 font-semibold">
                  {resolution === '4k'
                    ? '3840×2160 4K UHD'
                    : resolution === '1080p'
                    ? '1920×1080 Full HD'
                    : '1280×720 HD'}{' '}
                  • {fps} FPS • {videoLength} Sek.
                </span>
              </div>

              <div className="flex items-center gap-3 w-full sm:w-auto">
                {downloadUrl && !exporting && (
                  <a
                    href={downloadUrl}
                    download={`${(track?.name || 'tour').replace(/\s+/g, '_')}_3d_flyover_${videoLength}s.${actualExt}`}
                    className="flex-1 sm:flex-none py-2.5 px-5 bg-emerald-500 hover:bg-emerald-600 text-white rounded-2xl font-black text-center text-xs sm:text-sm transition-all shadow-lg shadow-emerald-500/20 flex items-center justify-center gap-2"
                  >
                    <Download size={16} />
                    Video herunterladen (.{actualExt})
                  </a>
                )}

                <button
                  type="button"
                  onClick={exporting ? cancelActiveRendering : startRecordingAndExport}
                  className={`flex-1 sm:flex-none py-2.5 px-6 text-xs sm:text-sm font-black rounded-2xl transition-all text-center flex items-center justify-center gap-2 cursor-pointer ${
                    exporting
                      ? 'bg-rose-600 hover:bg-rose-700 text-white shadow-lg shadow-rose-500/20'
                      : 'bg-indigo-600 hover:bg-indigo-700 text-white shadow-lg shadow-indigo-500/20'
                  }`}
                >
                  {exporting ? (
                    <>
                      <span className="w-2.5 h-2.5 bg-white rounded-full animate-ping" />
                      Export abbrechen
                    </>
                  ) : (
                    <>
                      <Film size={16} />
                      {downloadUrl
                        ? 'Neu rendern'
                        : `3D-Überflug generieren (${videoLength}s)`}
                    </>
                  )}
                </button>
              </div>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
};
