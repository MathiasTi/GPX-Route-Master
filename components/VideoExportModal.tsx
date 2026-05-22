import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { GPXTrack, GPXPoint } from '../types';
import { calculateDistance } from '../utils/gpxUtils';

interface VideoExportModalProps {
  track: GPXTrack | undefined;
  isOpen: boolean;
  onClose: () => void;
  userWeight?: number;
  estimatedSpeed?: number;
}

type ThemeMode = 'tactical' | 'neon' | 'sport-light';
type VideoLength = 15 | 30 | 60;
type ResolutionOption = '720p' | '1080p';
type MapStyle = 'satellite' | 'streets-dark' | 'streets-light' | 'outdoor';

// Slippy Map Tile Coordinate calculation helpers
const lon2tile = (lon: number, zoom: number) => {
  return ((lon + 180) / 360) * Math.pow(2, zoom);
};

const lat2tile = (lat: number, zoom: number) => {
  return (
    ((1 - Math.log(Math.tan((lat * Math.PI) / 180) + 1 / Math.cos((lat * Math.PI) / 180)) / Math.PI) / 2) *
    Math.pow(2, zoom)
  );
};

const tile2lon = (x: number, z: number) => {
  return (x / Math.pow(2, z)) * 360 - 180;
};

const tile2lat = (y: number, z: number) => {
  const n = Math.PI - (2 * Math.PI * y) / Math.pow(2, z);
  return (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
};

// Global in-memory cache for map tile Images
const tileImageCache = new Map<string, HTMLImageElement>();

// Affine texture triangle mapper to draw high-performance pseudo-3D maps
const drawTriangleTextured = (
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  x0: number, y0: number,
  x1: number, y1: number,
  x2: number, y2: number,
  u0: number, v0: number,
  u1: number, v1: number,
  u2: number, v2: number
) => {
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.lineTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.closePath();
  ctx.clip();

  const du1 = u1 - u0;
  const dv1 = v1 - v0;
  const du2 = u2 - u0;
  const dv2 = v2 - v0;

  const dx1 = x1 - x0;
  const dy1 = y1 - y0;
  const dx2 = x2 - x0;
  const dy2 = y2 - y0;

  const denom = du1 * dv2 - dv1 * du2;
  if (Math.abs(denom) < 1e-5) {
    ctx.restore();
    return;
  }

  const a = (dx1 * dv2 - dv1 * dx2) / denom;
  const c = (du1 * dx2 - dx1 * du2) / denom;
  const b = (dy1 * dv2 - dv1 * dy2) / denom;
  const d = (du1 * dy2 - dy1 * du2) / denom;

  const e = x0 - a * u0 - c * v0;
  const f = y0 - b * u0 - d * v0;

  ctx.transform(a, b, c, d, e, f);
  ctx.drawImage(img, 0, 0);
  ctx.restore();
};

export const VideoExportModal: React.FC<VideoExportModalProps> = ({
  track,
  isOpen,
  onClose,
  userWeight = 75,
  estimatedSpeed = 15,
}) => {
  const [theme, setTheme] = useState<ThemeMode>('tactical');
  const [mapMode, setMapMode] = useState<'2d' | '3d'>('3d');
  const [mapStyle, setMapStyle] = useState<MapStyle>('satellite');
  const [videoLength, setVideoLength] = useState<VideoLength>(15);
  const [resolution, setResolution] = useState<ResolutionOption>('720p');
  
  const [exportFormat, setExportFormat] = useState<'webm' | 'mp4'>('mp4');
  const [actualExt, setActualExt] = useState<string>('mp4');
  
  const [tilesLoaded, setTilesLoaded] = useState(0);
  const [tilesTotal, setTilesTotal] = useState(0);
  const [tilesLoading, setTilesLoading] = useState(false);
  
  const [exporting, setExporting] = useState(false);
  const isExportingRef = useRef(false);
  const [exportProgress, setExportProgress] = useState(0); // 0 to 100
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const livePreviewCanvasRef = useRef<HTMLCanvasElement>(null);
  const animationFrameRef = useRef<number | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordedChunksRef = useRef<Blob[]>([]);

  // Bounding box of the full track for minimap projection
  const precomputedStats = React.useMemo(() => {
    if (!track || !track.points || track.points.length === 0) return null;
    const points = track.points;
    
    let minLat = Infinity, maxLat = -Infinity;
    let minLng = Infinity, maxLng = -Infinity;
    let minEle = Infinity, maxEle = -Infinity;

    const cumulativeDistances = new Float64Array(points.length);
    const cumulativeAscents = new Float64Array(points.length);
    const calculatedSpeeds = new Float32Array(points.length);

    let totalDist = 0;
    let totalAscent = 0;

    points.forEach((pt, i) => {
      if (pt.lat < minLat) minLat = pt.lat;
      if (pt.lat > maxLat) maxLat = pt.lat;
      if (pt.lng < minLng) minLng = pt.lng;
      if (pt.lng > maxLng) maxLng = pt.lng;
      
      const ele = pt.ele !== undefined ? pt.ele : 0;
      if (ele < minEle) minEle = ele;
      if (ele > maxEle) maxEle = ele;

      if (i > 0) {
        const prev = points[i - 1];
        const d = calculateDistance(prev, pt) * 1000; // in meters
        totalDist += d;
        
        const dEle = ele - (prev.ele !== undefined ? prev.ele : 0);
        if (dEle > 0) {
          totalAscent += dEle;
        }

        // Instant speed
        let speed = estimatedSpeed; // fallback
        if (pt.time && prev.time) {
          const dt = (pt.time.getTime() - prev.time.getTime()) / 1000;
          if (dt > 1 && dt < 120 && d > 0) {
            speed = (d / dt) * 3.6; // m/s to km/h
          }
        } else {
          // Dynamic pacing estimation on flats & slopes
          const slope = d > 0 ? dEle / d : 0;
          if (slope > 0) {
            speed = Math.max(6, estimatedSpeed / (1 + slope * 11)); // climb slower
          } else {
            speed = Math.min(65, estimatedSpeed * (1 - slope * 3)); // descend faster
          }
        }
        calculatedSpeeds[i] = speed;
      } else {
        calculatedSpeeds[0] = estimatedSpeed;
      }

      cumulativeDistances[i] = totalDist;
      cumulativeAscents[i] = totalAscent;
    });

    // Apply moving average to speeds to make needle/hud smooth
    const smoothedSpeeds = new Float32Array(points.length);
    const wSize = 10;
    for (let i = 0; i < points.length; i++) {
      let sum = 0, count = 0;
      for (let j = Math.max(0, i - wSize); j <= Math.min(points.length - 1, i + wSize); j++) {
        sum += calculatedSpeeds[j];
        count++;
      }
      smoothedSpeeds[i] = count > 0 ? sum / count : estimatedSpeed;
    }

    let maxEleIdx = 0;
    let minEleIdx = 0;
    points.forEach((pt, i) => {
      const ele = pt.ele !== undefined ? pt.ele : 0;
      if (ele === maxEle) maxEleIdx = i;
      if (ele === minEle) minEleIdx = i;
    });

    const latRad = ((minLat + maxLat) / 2) * Math.PI / 180;
    const latSpan = maxLat - minLat;
    const lngSpan = maxLng - minLng;
    const maxSpanDeg = Math.max(latSpan, lngSpan * Math.cos(latRad));
    const zoomLevel = Math.min(15, Math.max(12, Math.round(Math.log2(90 / (maxSpanDeg || 0.001)))));

    return {
      minLat, maxLat, minLng, maxLng, minEle, maxEle,
      maxEleIdx, minEleIdx, zoomLevel,
      cumulativeDistances,
      cumulativeAscents,
      smoothedSpeeds,
      totalDist,
      totalAscent
    };
  }, [track, estimatedSpeed]);

  // Pre-load map tiles for the track's path dynamically
  useEffect(() => {
    if (!isOpen || !track || !track.points || track.points.length === 0 || !precomputedStats) return;

    let active = true;
    const points = track.points;
    const stats = precomputedStats;

    // 1. Calculate zoom level based on density
    const z = stats.zoomLevel;

    // 2. Identify all tiles touched by the track points
    const tileKeys = new Set<string>();
    
    // Scan up to 120 points evenly spaced for path tile resolution
    const step = Math.max(1, Math.floor(points.length / 120));
    for (let i = 0; i < points.length; i += step) {
      const pt = points[i];
      const tx = Math.floor(lon2tile(pt.lng, z));
      const ty = Math.floor(lat2tile(pt.lat, z));
      
      // Cover camera panning and rotation sweeps with an expansion buffer
      for (let dy = -8; dy <= 8; dy++) {
        for (let dx = -8; dx <= 8; dx++) {
          tileKeys.add(`${z}/${tx + dx}/${ty + dy}`);
        }
      }
    }

    const uniqueKeys = Array.from(tileKeys);
    setTilesTotal(uniqueKeys.length);
    setTilesLoaded(0);
    setTilesLoading(true);

    let loadedCount = 0;
    if (uniqueKeys.length === 0) {
      setTilesLoading(false);
      return;
    }

    uniqueKeys.forEach((key) => {
      const [cz, cx, cy] = key.split('/').map(Number);
      
      let url = '';
      if (mapStyle === 'satellite') {
        url = `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${cz}/${cy}/${cx}`;
      } else if (mapStyle === 'streets-dark') {
        url = `https://basemaps.cartocdn.com/rastertiles/dark_all/${cz}/${cx}/${cy}.png`;
      } else if (mapStyle === 'streets-light') {
        url = `https://basemaps.cartocdn.com/rastertiles/light_all/${cz}/${cx}/${cy}.png`;
      } else {
        url = `https://tile.openstreetmap.org/${cz}/${cx}/${cy}.png`;
      }

      if (tileImageCache.has(url)) {
        const cachedImg = tileImageCache.get(url)!;
        if (cachedImg.complete) {
          loadedCount++;
          if (active) setTilesLoaded(loadedCount);
          if (loadedCount === uniqueKeys.length && active) {
            setTilesLoading(false);
          }
          return;
        }
      }

      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        loadedCount++;
        if (active) {
          setTilesLoaded(loadedCount);
          if (loadedCount === uniqueKeys.length) {
            setTilesLoading(false);
          }
        }
      };
      img.onerror = () => {
        loadedCount++;
        if (active) {
          setTilesLoaded(loadedCount);
          if (loadedCount === uniqueKeys.length) {
            setTilesLoading(false);
          }
        }
      };
      img.src = url;
      tileImageCache.set(url, img);
    });

    return () => {
      active = false;
    };
  }, [isOpen, track, mapStyle, precomputedStats]);

  // Handle Close / Cleanup
  const handleClose = () => {
    cancelActiveRendering();
    if (downloadUrl) {
      URL.revokeObjectURL(downloadUrl);
      setDownloadUrl(null);
    }
    onClose();
  };

  const cancelActiveRendering = () => {
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
  };

  // Helper: Draw rounded rectangles
  const drawRoundedRect = (ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) => {
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

  // Core Frame Rendering Engine
  const renderFrameToContext = (
    ctx: CanvasRenderingContext2D,
    progress: number, // 0 to 1
    width: number,
    height: number,
    previewMode: boolean = false
  ) => {
    if (!track || !track.points || track.points.length === 0 || !precomputedStats) return;

    const points = track.points;
    const stats = precomputedStats;
    const baseElevation = stats.minEle !== Infinity && stats.minEle !== -Infinity ? stats.minEle : 0;

    // Local Elevation Sampler to warp Slippy Map tiles organically into 3D topography
    const getElevationAt = (lat: number, lng: number) => {
      let closestDist = Infinity;
      let closestEle = baseElevation;
      
      const step = Math.max(1, Math.floor(points.length / 100));
      for (let i = 0; i < points.length; i += step) {
        const pt = points[i];
        const dLat = pt.lat - lat;
        const dLng = pt.lng - lng;
        const distSq = dLat * dLat + dLng * dLng;
        if (distSq < closestDist) {
          closestDist = distSq;
          closestEle = pt.ele !== undefined ? pt.ele : baseElevation;
        }
      }
      
      const startFadeDeg = 0.015; // ~1.5km
      const maxFadeDeg = 0.04;   // ~4km
      const distanceDeg = Math.sqrt(closestDist);
      if (distanceDeg > startFadeDeg) {
        const t = Math.min(1, (distanceDeg - startFadeDeg) / (maxFadeDeg - startFadeDeg));
        return closestEle * (1 - t) + baseElevation * t;
      }
      return closestEle;
    };

    // Current point index based on progress
    const currentIdx = Math.min(points.length - 1, Math.floor(progress * (points.length - 1)));
    const currentPoint = points[currentIdx];

    // Precomputed metrics for active frame
    const currentDistanceKm = (stats.cumulativeDistances[currentIdx] / 1000);
    const currentAscentM = stats.cumulativeAscents[currentIdx];
    const currentSpeedKmh = stats.smoothedSpeeds[currentIdx];
    const currentAltitude = currentPoint.ele !== undefined ? currentPoint.ele : 0;

    // Camera smoothing with a wider, highly-stable window to guarantee fluid flyover motion
    let camLat = 0, camLng = 0, count = 0;
    const windowRadius = Math.max(15, Math.floor(points.length * 0.04)); // smoother stabilization window (4% of all points)
    for (let i = Math.max(0, currentIdx - windowRadius); i <= Math.min(points.length - 1, currentIdx + windowRadius); i++) {
      camLat += points[i].lat;
      camLng += points[i].lng;
      count++;
    }
    camLat = count > 0 ? camLat / count : currentPoint.lat;
    camLng = count > 0 ? camLng / count : currentPoint.lng;

    // Projection calculation: Mercator in-scale based on local coordinate scale
    const latRad = camLat * Math.PI / 180;
    const metersPerDegreeLat = 111320;
    const metersPerDegreeLng = 40075000 * Math.cos(latRad) / 360;

    // Smoothed flight bearing to avoid any abrupt jitter or sudden spins
    let travelBearing = 0;
    if (points.length > 1) {
      // Look wider ahead (6% of track) and behind (4% of shadow) to smooth orientation shifts
      const lookAhead = Math.min(points.length - 1, currentIdx + Math.max(10, Math.floor(points.length * 0.06)));
      const lookBehind = Math.max(0, currentIdx - Math.max(10, Math.floor(points.length * 0.04)));
      const p1 = points[lookBehind];
      const p2 = points[lookAhead];
      if (p1 && p2) {
        const dLat = p2.lat - p1.lat;
        const dLng = (p2.lng - p1.lng) * Math.cos((p1.lat * Math.PI) / 180);
        if (Math.abs(dLat) > 1e-7 || Math.abs(dLng) > 1e-7) {
          travelBearing = Math.atan2(dLng, dLat);
        }
      }
    }

    // Cinematic high-end drone camera flight path (slow sweep/pan angle like Relive)
    // The camera orbits gently back & forth to reveal the landscape's depth
    const orbitSweep = Math.sin(progress * Math.PI * 3.0) * 0.22; // subtle ~12 degree rotation drift
    const finalBearing = travelBearing + orbitSweep;

    // Vertical elevation exaggeration factor (makes climbs/mountains look majestic and fully visible)
    const eleSpan = stats.maxEle - stats.minEle;
    const verticalExaggeration = eleSpan > 5 ? Math.min(15, Math.max(3.8, 320 / eleSpan)) : 5.0;

    // Dynamic Metric Zoom Scale (pixels per meter) based on the stable zoom Level
    const z = stats.zoomLevel;
    const metersPerPixel = (156543.03 * Math.cos(latRad)) / Math.pow(2, z);
    const zoomScale = (1 / (metersPerPixel || 1)) * (previewMode ? 0.65 : 1.0);

    const getCanvasCoords = (lat: number, lng: number, eleVal = 0) => {
      const dx = (lng - camLng) * metersPerDegreeLng;
      const dy = (lat - camLat) * metersPerDegreeLat;

      if (mapMode === '3d') {
        // Rotate offsets by finalBearing so the flyover adapts to camera's orbital sweeps
        const rx = dx * Math.cos(finalBearing) - dy * Math.sin(finalBearing);
        const ry = dx * Math.sin(finalBearing) + dy * Math.cos(finalBearing);

        // Position camera behind and above the dynamic traveler
        let camDistBehind = previewMode ? 80 : 160;   // base distance
        let camHeight = previewMode ? 60 : 120;       // base height

        // Relive intro camera descent (zoom-in) and outro space ascent (zoom-out)
        if (progress < 0.12) {
          const t = progress / 0.12;
          camHeight = camHeight * (2.8 - 1.8 * Math.sin(t * Math.PI / 2));
          camDistBehind = camDistBehind * (2.2 - 1.2 * Math.sin(t * Math.PI / 2));
        } else if (progress > 0.88) {
          const t = (progress - 0.88) / 0.12;
          camHeight = camHeight * (1.0 + 3.2 * Math.pow(t, 2));
          camDistBehind = camDistBehind * (1.0 + 2.8 * Math.pow(t, 2));
        }

        // Relative depth (py) and lateral offset (px) with respect to the camera
        const px = rx;
        const py = ry + camDistBehind; 

        // Altitude displacement: factor elevation of target point with vertical exaggeration
        const relativeAltitude = (eleVal - currentAltitude) * verticalExaggeration;
        const pz = relativeAltitude - camHeight;

        // Clip anything that is behind the camera plane to prevent math explosion
        if (py <= 5) {
          return { x: -9999, y: -9999, py };
        }

        // Perspective scaling factor
        const scale3d = (previewMode ? 180 : 340) * (zoomScale / (previewMode ? 0.055 : 0.085));
        const cx = width / 2 + (px * scale3d) / py;
        const cy = height * 0.48 - (pz * scale3d) / py; // screen depth placement

        return { x: cx, y: cy, py };
      } else {
        const cx = width / 2 + dx * zoomScale;
        const cy = height / 2 - dy * zoomScale;
        return { x: cx, y: cy, py: 0 };
      }
    };

    // 1. Dark/Light Atmospheric / Sky Base Gradient
    const bgGradient = ctx.createLinearGradient(0, 0, width, height);
    if (mapMode === '3d') {
      // In 3D flight, the upper part shows space/atmosphere
      if (theme === 'tactical') {
        bgGradient.addColorStop(0, '#020617'); // dark space
        bgGradient.addColorStop(0.45, '#0f172a'); // sky horizon
        bgGradient.addColorStop(0.55, '#1e293b'); // mist land
        bgGradient.addColorStop(1, '#0f172a');
      } else if (theme === 'neon') {
        bgGradient.addColorStop(0, '#020005');
        bgGradient.addColorStop(0.45, '#1e0034');
        bgGradient.addColorStop(0.55, '#05010a');
        bgGradient.addColorStop(1, '#110222');
      } else {
        bgGradient.addColorStop(0, '#bae6fd'); // blue sky
        bgGradient.addColorStop(0.45, '#f8fafc'); // misty horizon
        bgGradient.addColorStop(0.55, '#e2e8f0'); // earth base
        bgGradient.addColorStop(1, '#cbd5e1');
      }
    } else {
      // 2D flat background
      if (theme === 'tactical') {
        bgGradient.addColorStop(0, '#0b0f19');
        bgGradient.addColorStop(1, '#02040a');
      } else if (theme === 'neon') {
        bgGradient.addColorStop(0, '#05010a');
        bgGradient.addColorStop(1, '#0e0114');
      } else {
        bgGradient.addColorStop(0, '#f8fafc');
        bgGradient.addColorStop(1, '#e2e8f0');
      }
    }
    ctx.fillStyle = bgGradient;
    ctx.fillRect(0, 0, width, height);

    // 2. Draw MAP TILE background layer

    const centerTileX = lon2tile(camLng, z);
    const centerTileY = lat2tile(camLat, z);

    // Define tile boundaries to draw
    const dRadX = mapMode === '3d' ? 8 : 3;
    const dRadY = mapMode === '3d' ? 8 : 3;
    const minTileX = Math.floor(centerTileX) - dRadX;
    const maxTileX = Math.ceil(centerTileX) + dRadX;
    const minTileY = Math.floor(centerTileY) - dRadY;
    const maxTileY = Math.ceil(centerTileY) + dRadY;

    for (let ty = minTileY; ty <= maxTileY; ty++) {
      for (let tx = minTileX; tx <= maxTileX; tx++) {
        let tileUrl = '';
        if (mapStyle === 'satellite') {
          tileUrl = `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${z}/${ty}/${tx}`;
        } else if (mapStyle === 'streets-dark') {
          tileUrl = `https://basemaps.cartocdn.com/rastertiles/dark_all/${z}/${tx}/${ty}.png`;
        } else if (mapStyle === 'streets-light') {
          tileUrl = `https://basemaps.cartocdn.com/rastertiles/light_all/${z}/${tx}/${ty}.png`;
        } else {
          tileUrl = `https://tile.openstreetmap.org/${z}/${tx}/${ty}.png`;
        }

        let tileImg = tileImageCache.get(tileUrl);
        if (!tileImg) {
          tileImg = new Image();
          tileImg.crossOrigin = 'anonymous';
          tileImg.src = tileUrl;
          tileImageCache.set(tileUrl, tileImg);
        }

        if (tileImg.complete && tileImg.naturalWidth > 0) {
          const subdivisions = mapMode === '3d' ? 4 : 1; // 4x4 subdivided vertex grid for organic 3D topography curves
          for (let row = 0; row < subdivisions; row++) {
            for (let col = 0; col < subdivisions; col++) {
              const fX1 = col / subdivisions;
              const fX2 = (col + 1) / subdivisions;
              const fY1 = row / subdivisions;
              const fY2 = (row + 1) / subdivisions;

              const latA = tile2lat(ty + fY1, z);
              const lngA = tile2lon(tx + fX1, z);
              const latB = tile2lat(ty + fY1, z);
              const lngB = tile2lon(tx + fX2, z);
              const latC = tile2lat(ty + fY2, z);
              const lngC = tile2lon(tx + fX2, z);
              const latD = tile2lat(ty + fY2, z);
              const lngD = tile2lon(tx + fX1, z);

              const eleA = getElevationAt(latA, lngA);
              const eleB = getElevationAt(latB, lngB);
              const eleC = getElevationAt(latC, lngC);
              const eleD = getElevationAt(latD, lngD);

              const posA = getCanvasCoords(latA, lngA, eleA);
              const posB = getCanvasCoords(latB, lngB, eleB);
              const posC = getCanvasCoords(latC, lngC, eleC);
              const posD = getCanvasCoords(latD, lngD, eleD);

              // Prevent stretching from vertices behind or too close or too far from camera in 3D
              if (mapMode === '3d') {
                if (posA.py < 15 || posB.py < 15 || posC.py < 15 || posD.py < 15) {
                  continue;
                }
                if (posA.py > 25000 || posB.py > 25000 || posC.py > 25000 || posD.py > 25000) {
                  continue;
                }
              }

              // Horizon Clipping in 3D Mode
              if (mapMode === '3d') {
                const horizonLimit = height * 0.45;
                if (posA.y < horizonLimit && posB.y < horizonLimit && posC.y < horizonLimit && posD.y < horizonLimit) {
                  continue; // completely above horizon, skip!
                }
              }

              // Texture coordinates mapping to source image (256x256)
              const sx1 = fX1 * 256;
              const sx2 = fX2 * 256;
              const sy1 = fY1 * 256;
              const sy2 = fY2 * 256;

              drawTriangleTextured(ctx, tileImg, posA.x, posA.y, posB.x, posB.y, posC.x, posC.y, sx1, sy1, sx2, sy1, sx2, sy2);
              drawTriangleTextured(ctx, tileImg, posA.x, posA.y, posC.x, posC.y, posD.x, posD.y, sx1, sy1, sx2, sy2, sx1, sy2);
            }
          }
        }
      }
    }

    // Modern high-tech geodesic HUD Grid
    ctx.strokeStyle = theme === 'sport-light' ? 'rgba(71,85,105,0.08)' : 'rgba(255,255,255,0.05)';
    ctx.lineWidth = 1;
    if (mapMode === '3d') {
      // Draw scenic multi-layered distant mountain skyline at the horizon
      ctx.save();
      const horizonY = height * 0.48;
      
      // Layer 1: Distant majestic mountain peak profile
      ctx.fillStyle = theme === 'sport-light' 
        ? '#94a3b8' 
        : theme === 'neon' 
          ? '#1e113a' 
          : '#1e293b';
      ctx.beginPath();
      ctx.moveTo(0, horizonY + 20);
      for (let x = 0; x <= width; x += 20) {
        // Organic pseudo-random mountains using nested wave functions
        const wave = Math.sin(x * 0.003) * 35 + Math.sin(x * 0.01) * 12 + Math.cos(x * 0.03) * 4;
        ctx.lineTo(x, horizonY - 15 + wave);
      }
      ctx.lineTo(width, horizonY + 25);
      ctx.lineTo(width, height);
      ctx.lineTo(0, height);
      ctx.closePath();
      ctx.fill();

      // Layer 2: Near/midground ridge structures
      ctx.fillStyle = theme === 'sport-light' 
        ? '#64748b' 
        : theme === 'neon' 
          ? '#0d041e' 
          : '#0f172a';
      ctx.beginPath();
      ctx.moveTo(0, horizonY + 30);
      for (let x = 0; x <= width; x += 15) {
        const wave = Math.sin(x * 0.007 + 45) * 20 + Math.cos(x * 0.02 - 10) * 6;
        ctx.lineTo(x, horizonY + 5 + wave);
      }
      ctx.lineTo(width, horizonY + 35);
      ctx.lineTo(width, height);
      ctx.lineTo(0, height);
      ctx.closePath();
      ctx.fill();

      ctx.restore();
    } else {
      const gridSize = previewMode ? 60 : 100;
      for (let x = 0; x < width; x += gridSize) {
        ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, height); ctx.stroke();
      }
      for (let y = 0; y < height; y += gridSize) {
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(width, y); ctx.stroke();
      }
    }

    // Grid Coordinates Text labels on borders
    ctx.fillStyle = theme === 'sport-light' ? 'rgba(15,23,42,0.6)' : 'rgba(255,255,255,0.7)';
    ctx.font = 'bold 9px monospace';
    ctx.shadowColor = 'rgba(0,0,0,0.5)';
    ctx.shadowBlur = 4;
    ctx.fillText(`${currentPoint.lat.toFixed(5)}° N`, 15, 20);
    ctx.fillText(`${currentPoint.lng.toFixed(5)}° E`, 15, 32);
    ctx.shadowBlur = 0; // reset shadow

    // 2.5 Draw 3D Translucent Elevation fence (Vertical Terrain curtain) to show elevation structures visually on the map
    if (mapMode === '3d') {
      ctx.save();
      // Translucent gradient/color representing vertical structures below the GPX track
      ctx.fillStyle = theme === 'sport-light' 
        ? 'rgba(37, 99, 235, 0.16)' 
        : theme === 'neon' 
          ? 'rgba(163, 230, 53, 0.22)' 
          : 'rgba(249, 115, 22, 0.22)';
      
      const step = Math.max(1, Math.floor(points.length / 300));
      for (let i = step; i < points.length; i += step) {
        const prevPt = points[i - step];
        const currPt = points[i];
        
        const posPrevTop = getCanvasCoords(prevPt.lat, prevPt.lng, prevPt.ele !== undefined ? prevPt.ele : baseElevation);
        const posPrevBot = getCanvasCoords(prevPt.lat, prevPt.lng, baseElevation);
        const posCurrTop = getCanvasCoords(currPt.lat, currPt.lng, currPt.ele !== undefined ? currPt.ele : baseElevation);
        const posCurrBot = getCanvasCoords(currPt.lat, currPt.lng, baseElevation);
        
        if (posPrevTop.x !== -9999 && posCurrTop.x !== -9999) {
          ctx.beginPath();
          ctx.moveTo(posPrevTop.x, posPrevTop.y);
          ctx.lineTo(posCurrTop.x, posCurrTop.y);
          ctx.lineTo(posCurrBot.x, posCurrBot.y);
          ctx.lineTo(posPrevBot.x, posPrevBot.y);
          ctx.closePath();
          ctx.fill();
          
          // Fine white vertical indicator grids
          ctx.strokeStyle = theme === 'sport-light' ? 'rgba(37, 99, 235, 0.08)' : 'rgba(255, 255, 255, 0.04)';
          ctx.lineWidth = 0.5;
          ctx.beginPath();
          ctx.moveTo(posCurrTop.x, posCurrTop.y);
          ctx.lineTo(posCurrBot.x, posCurrBot.y);
          ctx.stroke();
        }
      }
      ctx.restore();
    }

    // 3. Draw COMPLETE static guide line of the activity
    ctx.strokeStyle = theme === 'sport-light' 
      ? 'rgba(79, 70, 229, 0.12)' 
      : theme === 'neon' 
        ? 'rgba(163, 230, 53, 0.08)' 
        : 'rgba(255, 255, 255, 0.07)';
    ctx.lineWidth = previewMode ? 4 : 7;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    let firstInViewport = true;
    for (let i = 0; i < points.length; i++) {
      const pt = points[i];
      const { x, y } = getCanvasCoords(pt.lat, pt.lng, pt.ele !== undefined ? pt.ele : baseElevation);
      // Fast clipping check
      if (x >= -200 && x <= width + 200 && y >= -200 && y <= height + 200) {
        if (firstInViewport) {
          ctx.moveTo(x, y);
          firstInViewport = false;
        } else {
          ctx.lineTo(x, y);
        }
      }
    }
    ctx.stroke();

    // 4. Draw ACTIVE completed track line (glow effects)
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    const activeColor = theme === 'sport-light' 
      ? '#2563eb' // bright royal blue
      : theme === 'neon'
        ? '#a3e635' // neon lime
        : '#f97316'; // tactical rescue orange

    // Thick neon halo background
    ctx.strokeStyle = activeColor;
    ctx.lineWidth = previewMode ? 6 : 10;
    ctx.globalAlpha = 0.3;
    ctx.beginPath();
    let activeFirst = true;
    for (let i = 0; i <= currentIdx; i++) {
      const pt = points[i];
      const { x, y } = getCanvasCoords(pt.lat, pt.lng, pt.ele !== undefined ? pt.ele : baseElevation);
      if (x >= -200 && x <= width + 200 && y >= -200 && y <= height + 200) {
        if (activeFirst) {
          ctx.moveTo(x, y);
          activeFirst = false;
        } else {
          ctx.lineTo(x, y);
        }
      }
    }
    ctx.stroke();
    ctx.globalAlpha = 1.0;

    // Crisp inner core line
    ctx.strokeStyle = theme === 'sport-light' ? '#1d4ed8' : '#ffffff';
    ctx.lineWidth = previewMode ? 2 : 4;
    ctx.stroke();

    // 4.5 Floating 3D Telemetry Landmarks (Peak mountain & Low valley pin poles)
    if (mapMode === '3d') {
      const draw3DLandmark = (ptIdx: number, label: string, color: string, icon: string) => {
        if (ptIdx < 0 || ptIdx >= points.length) return;
        const pt = points[ptIdx];
        const posTop = getCanvasCoords(pt.lat, pt.lng, pt.ele !== undefined ? pt.ele : baseElevation);
        const posBot = getCanvasCoords(pt.lat, pt.lng, baseElevation);
        
        if (posTop.x >= -100 && posTop.x <= width + 100 && posTop.y >= -100 && posTop.y <= height + 100) {
          ctx.save();
          // Dotted shaft to ground
          ctx.strokeStyle = color;
          ctx.lineWidth = 1.5;
          ctx.setLineDash([3, 3]);
          ctx.beginPath();
          ctx.moveTo(posTop.x, posTop.y);
          ctx.lineTo(posBot.x, posBot.y);
          ctx.stroke();
          ctx.setLineDash([]);
          
          // Tiny anchor ring on map
          ctx.fillStyle = color;
          ctx.beginPath(); ctx.arc(posBot.x, posBot.y, 3.5, 0, Math.PI * 2); ctx.fill();
          
          // Pin dot at top
          ctx.beginPath(); ctx.arc(posTop.x, posTop.y, 4.5, 0, Math.PI * 2); ctx.fill();
          
          // Floating title card
          const cardW = previewMode ? 85 : 120;
          const cardH = previewMode ? 14 : 18;
          ctx.fillStyle = theme === 'sport-light' ? 'rgba(255, 255, 255, 0.94)' : 'rgba(15, 23, 42, 0.94)';
          ctx.strokeStyle = color;
          ctx.lineWidth = 1;
          drawRoundedRect(ctx, posTop.x - cardW / 2, posTop.y - cardH - 6, cardW, cardH, 5);
          ctx.fill(); ctx.stroke();
          
          ctx.fillStyle = theme === 'sport-light' ? '#0f172a' : '#ffffff';
          ctx.font = `bold ${previewMode ? '7px' : '9px'} sans-serif`;
          ctx.textAlign = 'center';
          ctx.fillText(`${icon} ${label}`, posTop.x, posTop.y - 11);
          ctx.restore();
        }
      };
      
      // Highest point landmark
      draw3DLandmark(stats.maxEleIdx, `GIPFEL: ${Math.round(stats.maxEle)}m`, '#f59e0b', '⛰️');
      // Lowest point landmark
      if (stats.minEle > 0) {
        draw3DLandmark(stats.minEleIdx, `TIEFST: ${Math.round(stats.minEle)}m`, '#3b82f6', '⛳');
      }
    }

    // 5. Drawing current active user marker (Compass / Radar blinking ring)
    const userPos = getCanvasCoords(currentPoint.lat, currentPoint.lng, currentPoint.ele !== undefined ? currentPoint.ele : baseElevation);
    
    // Wave pulsing ring
    const radarRadius = 15 + Math.sin(Date.now() / 150) * 8;
    ctx.strokeStyle = activeColor;
    ctx.fillStyle = activeColor;
    ctx.lineWidth = 1.5;
    ctx.globalAlpha = 0.2;
    ctx.beginPath(); ctx.arc(userPos.x, userPos.y, radarRadius, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.globalAlpha = 1.0;

    // Solid core dot
    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = activeColor;
    ctx.lineWidth = previewMode ? 3 : 5;
    ctx.beginPath(); ctx.arc(userPos.x, userPos.y, previewMode ? 6 : 9, 0, Math.PI * 2); ctx.fill(); ctx.stroke();

    // 6. TOP HEADER BAR: Activity Info
    const textPrimary = theme === 'sport-light' ? '#0f172a' : '#ffffff';
    const textSecondary = theme === 'sport-light' ? '#475569' : '#94a3b8';
    const cellBg = theme === 'sport-light' ? 'rgba(255,255,255,0.92)' : 'rgba(15,22,42,0.82)';
    const cellBorder = theme === 'sport-light' ? 'rgba(226,232,240,0.9)' : 'rgba(255,255,255,0.08)';

    ctx.save();
    // Glass panel for activity banner
    ctx.fillStyle = cellBg;
    ctx.strokeStyle = cellBorder;
    ctx.lineWidth = 1.5;
    drawRoundedRect(ctx, 40, 20, width - 80, previewMode ? 45 : 60, 14);
    ctx.fill(); ctx.stroke();

    // Title text
    ctx.fillStyle = textPrimary;
    ctx.font = `bold ${previewMode ? '13px' : '18px'} system-ui, sans-serif`;
    ctx.fillText((track.name || 'Aktivität').toUpperCase(), 60, previewMode ? 48 : 56);

    // Dynamic REC tag right-aligned
    const recColor = theme === 'neon' ? '#a3e635' : '#ef4444';
    ctx.fillStyle = recColor;
    ctx.beginPath();
    ctx.arc(width - (previewMode ? 120 : 160), previewMode ? 42 : 50, previewMode ? 4 : 6, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = textSecondary;
    ctx.font = `bold ${previewMode ? '9px' : '11px'} monospace`;
    ctx.fillText('SPORTS TELEMETRIE REC', width - (previewMode ? 108 : 145), previewMode ? 45 : 54);
    ctx.restore();

    // 7. BOTTOM LEFT HUD: Telemetry Gauges (Speedometer, Ascent, Elevation)
    const hudW = previewMode ? 220 : 340;
    const hudH = previewMode ? 120 : 190;
    const hudX = 40;
    const hudY = height - hudH - (previewMode ? 15 : 25);

    ctx.save();
    ctx.fillStyle = cellBg;
    ctx.strokeStyle = cellBorder;
    ctx.lineWidth = 1.5;
    drawRoundedRect(ctx, hudX, hudY, hudW, hudH, 16);
    ctx.fill(); ctx.stroke();

    // SPEED BIG NUMBER
    ctx.fillStyle = activeColor;
    ctx.font = `black ${previewMode ? '34px' : '56px'} monospace`;
    ctx.textAlign = 'left';
    ctx.fillText(currentSpeedKmh.toFixed(1), hudX + 20, hudY + (previewMode ? 48 : 78));

    ctx.fillStyle = textSecondary;
    ctx.font = `bold ${previewMode ? '10px' : '14px'} system-ui, sans-serif`;
    ctx.fillText('km/h', hudX + (previewMode ? 115 : 185), hudY + (previewMode ? 46 : 74));

    ctx.font = `bold ${previewMode ? '8px' : '10px'} sans-serif`;
    ctx.fillText('GESCHWINDIGKEIT', hudX + (previewMode ? 115 : 185), hudY + (previewMode ? 32 : 54));

    // Divider
    ctx.strokeStyle = cellBorder;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(hudX + 15, hudY + (previewMode ? 65 : 105));
    ctx.lineTo(hudX + hudW - 15, hudY + (previewMode ? 65 : 105));
    ctx.stroke();

    // Columns inside telemetry: Höhendaten
    const colY = hudY + (previewMode ? 88 : 140);
    const labelSize = previewMode ? '8px' : '10px';
    const valSize = previewMode ? '12px' : '18px';

    // Height Column
    ctx.fillStyle = textSecondary;
    ctx.font = `bold ${labelSize} sans-serif`;
    ctx.fillText('AKTUELLE HÖHE', hudX + 20, colY - (previewMode ? 10 : 18));
    ctx.fillStyle = textPrimary;
    ctx.font = `bold ${valSize} monospace`;
    ctx.fillText(`${Math.round(currentAltitude)} m`, hudX + 20, colY + (previewMode ? 4 : 8));

    // Ascent Column
    ctx.fillStyle = textSecondary;
    ctx.font = `bold ${labelSize} sans-serif`;
    ctx.fillText('GESAMTANSTIEG', hudX + (previewMode ? 115 : 180), colY - (previewMode ? 10 : 18));
    ctx.fillStyle = theme === 'sport-light' ? '#b45309' : '#f59e0b'; // Amber
    ctx.font = `bold ${valSize} monospace`;
    ctx.fillText(`+${Math.round(currentAscentM)} Hm`, hudX + (previewMode ? 115 : 180), colY + (previewMode ? 4 : 8));

    ctx.restore();

    // 8. BOTTOM RIGHT HUD: Routen-Minimap (Complete overview map with location dot)
    const miniW = previewMode ? 180 : 260;
    const miniH = previewMode ? 120 : 190;
    const miniX = width - miniW - 40;
    const miniY = height - miniH - (previewMode ? 15 : 25);

    ctx.save();
    ctx.fillStyle = cellBg;
    ctx.strokeStyle = cellBorder;
    ctx.lineWidth = 1.5;
    drawRoundedRect(ctx, miniX, miniY, miniW, miniH, 16);
    ctx.fill(); ctx.stroke();

    // Header label
    ctx.fillStyle = textSecondary;
    ctx.font = `bold ${previewMode ? '8px' : '10px'} sans-serif`;
    ctx.fillText('AKTIVITÄT ÜBERSICHT', miniX + 15, miniY + (previewMode ? 18 : 28));

    // Math calculation to project whole track into the minimap boundaries with pad margins
    const mPad = previewMode ? 15 : 25;
    const mapW = miniW - mPad * 2;
    const mapH = miniH - mPad * 2 - (previewMode ? 10 : 15);
    const boxX = miniX + mPad;
    const boxY = miniY + mPad + (previewMode ? 12 : 20);

    const latSpan = stats.maxLat - stats.minLat;
    const lngSpan = stats.maxLng - stats.minLng;
    const maxSpan = Math.max(latSpan, lngSpan * Math.cos(latRad));

    const getMiniCoords = (lat: number, lng: number) => {
      // Invariant bounding aspect scaler inside mini plate
      const scale = Math.min(mapW, mapH) / (maxSpan || 0.0001);
      const mx = boxX + mapW / 2 + (lng - (stats.minLng + stats.maxLng) / 2) * scale * Math.cos(latRad);
      const my = boxY + mapH / 2 - (lat - (stats.minLat + stats.maxLat) / 2) * scale;
      return { x: mx, y: my };
    };

    // Draw full track outline inside minimap
    ctx.strokeStyle = theme === 'sport-light' ? 'rgba(74,85,104,0.18)' : 'rgba(255,255,255,0.14)';
    ctx.lineWidth = previewMode ? 2 : 3.5;
    ctx.beginPath();
    points.forEach((pt, idx) => {
      const p = getMiniCoords(pt.lat, pt.lng);
      if (idx === 0) ctx.moveTo(p.x, p.y);
      else ctx.lineTo(p.x, p.y);
    });
    ctx.stroke();

    // Draw completed active track inside minimap
    ctx.strokeStyle = activeColor;
    ctx.lineWidth = previewMode ? 3 : 5.5;
    ctx.beginPath();
    for (let i = 0; i <= currentIdx; i++) {
      const p = getMiniCoords(points[i].lat, points[i].lng);
      if (i === 0) ctx.moveTo(p.x, p.y);
      else ctx.lineTo(p.x, p.y);
    }
    ctx.stroke();

    // Blink marker inside minimap
    const miniUserPos = getMiniCoords(currentPoint.lat, currentPoint.lng);
    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = activeColor;
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.arc(miniUserPos.x, miniUserPos.y, previewMode ? 4.5 : 7, 0, Math.PI * 2);
    ctx.fill(); ctx.stroke();

    ctx.restore();

    // 9. BOTTOM CENTER HUD: Elevation Profile Sweeper
    // Sitting neatly in the center space
    const centerW = width - hudW - miniW - 120;
    if (centerW > 120) { // check if we have enough breathing space
      const centerH = previewMode ? 55 : 85;
      const centerX = hudX + hudW + 20;
      const centerY = height - centerH - (previewMode ? 15 : 25);

      ctx.save();
      ctx.fillStyle = cellBg;
      ctx.strokeStyle = cellBorder;
      ctx.lineWidth = 1.5;
      drawRoundedRect(ctx, centerX, centerY, centerW, centerH, 16);
      ctx.fill(); ctx.stroke();

      // Mini profile graph
      const gX = centerX + 15;
      const gY = centerY + (previewMode ? 15 : 25);
      const gW = centerW - 30;
      const gH = centerH - (previewMode ? 20 : 35);

      // Generate elevation profile path
      const eleDiff = stats.maxEle - stats.minEle;
      const getProfileY = (eleVal: number) => {
        const ratio = eleDiff > 0 ? (eleVal - stats.minEle) / eleDiff : 0.5;
        return gY + gH - ratio * gH;
      };

      // Vector fill area of elevation cross section
      ctx.fillStyle = theme === 'sport-light' ? 'rgba(37,99,235,0.08)' : 'rgba(255,255,255,0.05)';
      ctx.beginPath();
      ctx.moveTo(gX, gY + gH);
      points.forEach((pt, idx) => {
        const px = gX + (idx / (points.length - 1)) * gW;
        const py = getProfileY(pt.ele !== undefined ? pt.ele : 0);
        ctx.lineTo(px, py);
      });
      ctx.lineTo(gX + gW, gY + gH);
      ctx.closePath();
      ctx.fill();

      // Top profile line
      ctx.strokeStyle = theme === 'sport-light' ? 'rgba(37,99,235,0.3)' : 'rgba(255,255,255,0.2)';
      ctx.lineWidth = previewMode ? 1.5 : 2.5;
      ctx.beginPath();
      points.forEach((pt, idx) => {
        const px = gX + (idx / (points.length - 1)) * gW;
        const py = getProfileY(pt.ele !== undefined ? pt.ele : 0);
        if (idx === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      });
      ctx.stroke();

      // Highlight active up to current
      ctx.strokeStyle = activeColor;
      ctx.lineWidth = previewMode ? 1.8 : 3.0;
      ctx.beginPath();
      for (let i = 0; i <= currentIdx; i++) {
        const px = gX + (i / (points.length - 1)) * gW;
        const py = getProfileY(points[i].ele !== undefined ? points[i].ele : 0);
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.stroke();

      // Swiping tracker line
      const trackerX = gX + progress * gW;
      ctx.strokeStyle = theme === 'sport-light' ? '#dc2626' : '#ef4444'; // Red pointer
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(trackerX, gY - 4);
      ctx.lineTo(trackerX, gY + gH + 4);
      ctx.stroke();

      // Label
      ctx.fillStyle = textSecondary;
      ctx.font = `bold ${previewMode ? '7px' : '9px'} sans-serif`;
      ctx.fillText('HÖHENPROFIL SWEEP', centerX + 15, centerY + (previewMode ? 11 : 18));

      ctx.restore();
    }

    // 10. METED LABELS: Distance indicators
    ctx.fillStyle = textSecondary;
    ctx.font = `bold ${previewMode ? '10px' : '14px'} monospace`;
    ctx.fillText(`${currentDistanceKm.toFixed(1)} / ${(stats.totalDist / 1000).toFixed(1)} km`, width - (previewMode ? 150 : 210), previewMode ? 47 : 56);
  };

  // Recording Engine
  const startRecordingAndExport = async () => {
    if (!track || !track.points || track.points.length === 0 || !precomputedStats) return;
    setExporting(true);
    isExportingRef.current = true;
    setExportProgress(0);
    setExportError(null);
    setDownloadUrl(null);
    recordedChunksRef.current = [];

    // Trigger local timeout to let components lay out
    await new Promise((resolve) => setTimeout(resolve, 150));

    const exportCanvas = canvasRef.current;
    if (!exportCanvas) {
      setExportError('Canvas-Objekt konnte nicht geladen werden.');
      setExporting(false);
      isExportingRef.current = false;
      return;
    }

    // Set dimensions based on resolution
    const w = resolution === '1080p' ? 1920 : 1280;
    const h = resolution === '1080p' ? 1080 : 720;
    exportCanvas.width = w;
    exportCanvas.height = h;

    const ctx = exportCanvas.getContext('2d');
    if (!ctx) {
      setExportError('2D Canvas-System konnte nicht initialisiert werden.');
      setExporting(false);
      isExportingRef.current = false;
      return;
    }

    // Set up standard MediaRecorder stream capture
    let stream: MediaStream;
    try {
      stream = exportCanvas.captureStream(30); // 30 FPS
    } catch (e) {
      setExportError('Browser-Schnittstelle zur Aufnahme des Canvas-Streams wird nicht unterstützt.');
      setExporting(false);
      isExportingRef.current = false;
      return;
    }

    // Decide the mimeType and options depending on chosen exportFormat
    let chosenMime = '';
    let ext = 'webm';

    if (exportFormat === 'mp4') {
      const mp4Types = [
        'video/mp4;codecs=h264',
        'video/mp4;codecs=avc1',
        'video/mp4'
      ];
      for (const t of mp4Types) {
        if (MediaRecorder.isTypeSupported(t)) {
          chosenMime = t;
          ext = 'mp4';
          break;
        }
      }
      
      // If MP4 is not supported, fall back to WebM
      if (!chosenMime) {
        const webmTypes = [
          'video/webm;codecs=vp9',
          'video/webm;codecs=vp8',
          'video/webm'
        ];
        for (const t of webmTypes) {
          if (MediaRecorder.isTypeSupported(t)) {
            chosenMime = t;
            ext = 'webm';
            break;
          }
        }
      }
    } else {
      const webmTypes = [
        'video/webm;codecs=vp9',
        'video/webm;codecs=vp8',
        'video/webm'
      ];
      for (const t of webmTypes) {
        if (MediaRecorder.isTypeSupported(t)) {
          chosenMime = t;
          ext = 'webm';
          break;
        }
      }
    }

    setActualExt(ext);
    const options = chosenMime ? { mimeType: chosenMime } : undefined;

    try {
      const recorder = new MediaRecorder(stream, options);
      mediaRecorderRef.current = recorder;

      recorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) {
          recordedChunksRef.current.push(event.data);
        }
      };

      recorder.onstop = () => {
        if (!isExportingRef.current) {
          // Cancelled flow, do not save incomplete chunk URL
          return;
        }
        const mimeType = (options && options.mimeType) || 'video/webm';
        const blob = new Blob(recordedChunksRef.current, { type: mimeType });
        const url = URL.createObjectURL(blob);
        setDownloadUrl(url);
        setExportProgress(100);
        setExporting(false);
        isExportingRef.current = false;
      };

      // Start recording media loop
      recorder.start();

      const totalFrames = videoLength * 30; // 30 FPS * length (seconds)
      let currentFrame = 0;

      // Realtime frame generation rendering loop
      const nextFrame = () => {
        if (!isExportingRef.current) return; // cancelled

        const progress = currentFrame / (totalFrames - 1);
        setExportProgress(Math.round(progress * 100));

        // Draw perfect frame frame-by-frame
        ctx.clearRect(0, 0, w, h);
        renderFrameToContext(ctx, progress, w, h, false);

        currentFrame++;
        if (currentFrame < totalFrames) {
          // Usability: Use setTimeout instead of requestAnimationFrame so export runs at lightning speed
          // and doesn't get suspended when the browser tab is minimized or out of focus.
          animationFrameRef.current = window.setTimeout(nextFrame, 4);
        } else {
          // Finish recording
          setTimeout(() => {
            if (recorder && recorder.state !== 'inactive') {
              recorder.stop();
            }
          }, 400);
        }
      };

      // Launch loops
      animationFrameRef.current = window.setTimeout(nextFrame, 4);

    } catch (e: any) {
      setExportError(`Fehler bei der Videofahr-Generierung: ${e.message}`);
      setExporting(false);
      isExportingRef.current = false;
    }
  };

  // Live Idle-Preview Loop when modal is open and not active exporting
  useEffect(() => {
    if (!isOpen || exporting || !track || !precomputedStats) return;

    const canvas = livePreviewCanvasRef.current;
    if (!canvas) return;

    // Fixed size for modal inline layout
    canvas.width = 680;
    canvas.height = 380;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let start: number | null = null;
    const durationMs = 15000; // Loop preview over standard 15s

    const showLiveOverview = (timestamp: number) => {
      if (!start) start = timestamp;
      const elapsed = timestamp - start;
      const progress = (elapsed % durationMs) / durationMs;

      ctx.clearRect(0, 0, 680, 380);
      renderFrameToContext(ctx, progress, 680, 380, true);

      animationFrameRef.current = requestAnimationFrame(showLiveOverview);
    };

    animationFrameRef.current = requestAnimationFrame(showLiveOverview);

    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, [isOpen, exporting, track, theme, mapMode, mapStyle, precomputedStats]);

  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-[500] flex items-center justify-center p-4">
          {/* Backdrop screen */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={exporting ? undefined : handleClose}
            className="absolute inset-0 bg-slate-900/60 backdrop-blur-md"
          />

          {/* Modal Container */}
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 15 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 15 }}
            className="relative bg-white dark:bg-slate-900 rounded-3xl shadow-2xl border border-slate-200 dark:border-slate-800 w-full max-w-4xl max-h-[90vh] overflow-y-auto flex flex-col p-6 sm:p-8"
          >
            {/* Header */}
            <div className="flex items-center justify-between pb-4 border-b border-slate-100 dark:border-slate-800">
              <div>
                <h3 className="text-xl font-extrabold text-slate-900 dark:text-white flex items-center gap-2">
                  <span className="bg-emerald-500 text-white p-1.5 rounded-xl text-sm antialiased">
                    📹
                  </span>
                  Überflug-Video exportieren (Flyover)
                </h3>
                <p className="text-xs text-slate-400 font-bold mt-0.5">
                  Generiere ein Video mit Live-Tachometer, Höhenmetern, Anstiegen und einer GPS-Minimap.
                </p>
              </div>
              {!exporting && (
                <button
                  onClick={handleClose}
                  className="p-2 text-slate-400 hover:text-slate-500 rounded-full hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors cursor-pointer"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                </button>
              )}
            </div>

            {/* Inner Content Grid */}
            <div className="grid grid-cols-1 lg:grid-cols-20 gap-8 py-5">
              
              {/* Left Column Settings */}
              <div className="lg:col-span-8 space-y-5">
                <div className="space-y-4">
                  
                  {/* Theme Mode Selector */}
                  <div className="space-y-1.5">
                    <label className="text-xs font-black text-slate-500 uppercase tracking-widest">Video-Theme & Design</label>
                    <div className="grid grid-cols-3 gap-2">
                      {(['tactical', 'neon', 'sport-light'] as ThemeMode[]).map((t) => (
                        <button
                          key={t}
                          disabled={exporting}
                          onClick={() => setTheme(t)}
                          className={`py-1.5 px-3 rounded-xl border text-xs font-black transition-all capitalize cursor-pointer ${
                            theme === t
                              ? 'bg-indigo-600 border-indigo-600 text-white shadow-md'
                              : 'bg-slate-50 dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-100'
                          }`}
                        >
                          {t === 'tactical' ? 'Tactical' : t === 'neon' ? 'Neon Glow' : 'Sport Light'}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Kartenstil / Map Design Selector */}
                  <div className="space-y-1.5">
                    <label className="text-xs font-black text-slate-500 uppercase tracking-widest">Karten-Design</label>
                    <div className="grid grid-cols-2 gap-2">
                      {(['satellite', 'streets-dark', 'streets-light', 'outdoor'] as MapStyle[]).map((style) => (
                        <button
                          key={style}
                          disabled={exporting}
                          onClick={() => {
                            setMapStyle(style);
                            setDownloadUrl(null);
                          }}
                          className={`py-1.5 px-3 rounded-xl border text-[10px] font-black transition-all cursor-pointer flex items-center justify-center gap-1 ${
                            mapStyle === style
                              ? 'bg-indigo-600 border-indigo-600 text-white shadow-md'
                              : 'bg-slate-50 dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-100'
                          }`}
                        >
                          {style === 'satellite' ? '🛰️ Satellit' : style === 'streets-dark' ? '🕶️ Dark Streets' : style === 'streets-light' ? '🏙️ Light Streets' : '🏕️ Natur/OSM'}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Tile Preloading Status */}
                  {tilesLoading && (
                    <div className="bg-indigo-50 dark:bg-indigo-950/40 p-2.5 rounded-2xl border border-indigo-100 dark:border-indigo-900/40 text-[10px] font-bold text-indigo-600 dark:text-indigo-400 flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="w-2 h-2 bg-indigo-500 rounded-full animate-ping" />
                        <span>Karten werden vorgeladen...</span>
                      </div>
                      <span className="font-mono">{tilesLoaded} / {tilesTotal}</span>
                    </div>
                  )}

                  {/* Karten-Perspektive Selector */}
                  <div className="space-y-1.5">
                    <label className="text-xs font-black text-slate-500 uppercase tracking-widest">Karten-Perspektive</label>
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        disabled={exporting}
                        onClick={() => {
                          setMapMode('2d');
                          setDownloadUrl(null);
                        }}
                        className={`py-2 px-3 rounded-xl border text-xs font-black transition-all cursor-pointer flex items-center justify-center gap-1.5 ${
                          mapMode === '2d'
                            ? 'bg-indigo-600 border-indigo-600 text-white shadow-md'
                            : 'bg-slate-50 dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-100'
                        }`}
                      >
                        🗺️ 2D Draufsicht
                      </button>
                      <button
                        disabled={exporting}
                        onClick={() => {
                          setMapMode('3d');
                          setDownloadUrl(null);
                        }}
                        className={`py-2 px-3 rounded-xl border text-xs font-black transition-all cursor-pointer flex items-center justify-center gap-1.5 ${
                          mapMode === '3d'
                            ? 'bg-indigo-600 border-indigo-600 text-white shadow-md'
                            : 'bg-slate-50 dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-100'
                        }`}
                      >
                        🏔️ 3D Überflug
                      </button>
                    </div>
                  </div>

                  {/* Length Selector */}
                  <div className="space-y-1.5">
                    <label className="text-xs font-black text-slate-500 uppercase tracking-widest font-mono">Dauer des Videos</label>
                    <div className="grid grid-cols-3 gap-2">
                      {([15, 30, 60] as VideoLength[]).map((len) => (
                        <button
                          key={len}
                          disabled={exporting}
                          onClick={() => {
                            setVideoLength(len);
                            setDownloadUrl(null); // clean old download
                          }}
                          className={`py-2 px-3 rounded-xl border text-xs font-black transition-all cursor-pointer ${
                            videoLength === len
                              ? 'bg-indigo-600 border-indigo-600 text-white shadow-md'
                              : 'bg-slate-50 dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-100'
                          }`}
                        >
                          {len} Sekunden
                        </button>
                      ))}
                    </div>
                    <p className="text-[10px] text-slate-400 font-semibold italic">
                      Eine kürzere Dauer beschleunigt den Überflug-Zeitraffer im Video.
                    </p>
                  </div>

                  {/* Resolution Selector */}
                  <div className="space-y-1.5">
                    <label className="text-xs font-black text-slate-500 uppercase tracking-widest">Video-Auflösung (Qualität)</label>
                    <div className="grid grid-cols-2 gap-2">
                      {(['720p', '1080p'] as ResolutionOption[]).map((res) => (
                        <button
                          key={res}
                          disabled={exporting}
                          onClick={() => {
                            setResolution(res);
                            setDownloadUrl(null); // clean old download
                          }}
                          className={`py-2 px-3 rounded-xl border text-xs font-black transition-all cursor-pointer ${
                            resolution === res
                              ? 'bg-indigo-600 border-indigo-600 text-white shadow-md'
                              : 'bg-slate-50 dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-100'
                          }`}
                        >
                          {res === '720p' ? 'HD (1280x720)' : 'Full HD (1920x1080)'}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Format Selector */}
                  <div className="space-y-1.5">
                    <label className="text-xs font-black text-slate-500 uppercase tracking-widest">Video-Format</label>
                    <div className="grid grid-cols-2 gap-2">
                      {(['mp4', 'webm'] as ('mp4' | 'webm')[]).map((fmt) => (
                        <button
                          key={fmt}
                          disabled={exporting}
                          onClick={() => {
                            setExportFormat(fmt);
                            setDownloadUrl(null); // clean old download
                          }}
                          className={`py-2 px-3 rounded-xl border text-xs font-black transition-all cursor-pointer ${
                            exportFormat === fmt
                              ? 'bg-indigo-600 border-indigo-600 text-white shadow-md'
                              : 'bg-slate-50 dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-100'
                          }`}
                        >
                          {fmt === 'mp4' ? 'MP4-Video (.mp4) 🌟' : 'WebM-Video (.webm)'}
                        </button>
                      ))}
                    </div>
                  </div>

                </div>

                {/* Tracking stats preview list block */}
                <div className="bg-slate-50 dark:bg-slate-800/50 p-4 rounded-2xl border border-slate-100 dark:border-slate-850 text-xs space-y-3 font-semibold text-slate-600 dark:text-slate-300">
                  <div className="flex justify-between">
                    <span className="text-slate-400 font-bold uppercase tracking-wider">Distanz gesamt:</span>
                    <span className="font-extrabold text-slate-900 dark:text-white font-mono">
                      {precomputedStats ? (precomputedStats.totalDist / 1000).toFixed(2) : '--'} km
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400 font-bold uppercase tracking-wider">Anstieg gesamt:</span>
                    <span className="font-extrabold text-slate-900 dark:text-white font-mono">
                      +{precomputedStats ? Math.round(precomputedStats.totalAscent) : '--'} Hm
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400 font-bold uppercase tracking-wider">Erwartete Framerate:</span>
                    <span className="font-extrabold text-slate-900 dark:text-white font-mono">30 FPS (Frames/sec)</span>
                  </div>
                </div>
              </div>

              {/* Right Column Canvas Preview */}
              <div className="lg:col-span-12 flex flex-col justify-center space-y-4">
                <div className="space-y-1.5">
                  <span className="text-xs font-black text-slate-500 uppercase tracking-widest block">Live-Vorschau</span>
                  
                  {/* Dynamic Video Viewport Area */}
                  <div className="relative aspect-[16/9] w-full rounded-2xl border border-slate-200 dark:border-slate-800 bg-slate-950 shadow-inner overflow-hidden flex items-center justify-center">
                    
                    {/* Main export hidden generator canvas */}
                    <canvas ref={canvasRef} className="hidden" />

                    {/* Active dynamic animation preview */}
                    {!exporting && (
                      <canvas ref={livePreviewCanvasRef} className="w-full h-full object-cover" />
                    )}

                    {/* Loader Cover Screen during Export */}
                    {exporting && (
                      <div className="absolute inset-0 bg-slate-950/70 backdrop-blur-sm flex flex-col items-center justify-center p-6 text-center text-white z-20">
                        <div className="w-16 h-16 rounded-full border-4 border-indigo-500 border-t-transparent animate-spin mb-4" />
                        <h4 className="text-lg font-black tracking-tight mb-1">Rendere Video-Frames...</h4>
                        <p className="text-sm text-slate-400 font-semibold max-w-sm">
                          Das Video wird gerendert. Bitte schließen Sie diese Modalbox nicht.
                        </p>
                        
                        {/* Status bar */}
                        <div className="w-64 bg-slate-800 h-2.5 rounded-full overflow-hidden mt-5 border border-slate-700/50">
                          <motion.div 
                            className="bg-indigo-500 h-full rounded-full"
                            style={{ width: `${exportProgress}%` }}
                          />
                        </div>
                        <span className="text-xs font-bold font-mono text-indigo-400 mt-2">
                          Rendern: {exportProgress}%
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              </div>

            </div>

            {/* Error notifications */}
            {exportError && (
              <div className="p-3 bg-red-100 text-red-700 border border-red-200 rounded-xl text-xs font-bold my-2">
                ⚠️ {exportError}
              </div>
            )}

            {/* Bottom Actions Footer */}
            <div className="flex flex-col sm:flex-row items-center justify-between gap-4 mt-4 pt-4 border-t border-slate-100 dark:border-slate-800">
              <span className="text-[11px] text-slate-400 font-bold">
                * Die Video-Datei (.{actualExt}) ist mit allen modernen Playern, Social-Media-Seiten und Messenger-Diensten kompatibel.
              </span>
              
              <div className="flex items-center gap-3 w-full sm:w-auto">
                {downloadUrl && !exporting && (
                  <a
                    href={downloadUrl}
                    download={`${(track.name || 'aktivitaet').replace(/\s+/g, '_')}_ueberflug_${videoLength}s.${actualExt}`}
                    className="flex-1 sm:flex-none py-3 px-6 bg-emerald-500 hover:bg-emerald-600 text-white rounded-2xl font-black text-center text-sm transition-all shadow-lg shadow-emerald-200 flex items-center justify-center gap-2"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                    Video herunterladen
                  </a>
                )}

                <button
                  onClick={exporting ? cancelActiveRendering : startRecordingAndExport}
                  className={`flex-1 sm:flex-none py-3 px-6 text-sm font-black rounded-2xl transition-all text-center flex items-center justify-center gap-2 cursor-pointer ${
                    exporting
                      ? 'bg-rose-600 hover:bg-rose-700 text-white shadow-lg shadow-rose-200'
                      : 'bg-indigo-600 hover:bg-indigo-700 text-white shadow-lg shadow-indigo-200'
                  }`}
                >
                  {exporting ? (
                    <>
                      <span className="w-2.5 h-2.5 bg-white rounded-full animate-ping" />
                      Abbrechen
                    </>
                  ) : (
                    <>
                      📹
                      {downloadUrl ? 'Video erneut rendern' : 'Überflug-Video generieren'}
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
