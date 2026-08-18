
import React, { useMemo, useState, useRef, useCallback } from 'react';
import { GPXTrack, GPXPoint, TextMarker } from '../types';
import { 
  calculateDistance, 
  getPaceString, 
  downloadTrackAsGPX, 
  detectImpossibleGradientAnomalies, 
  GradientAnomaly,
  filterElevationProfile,
  ElevationFilterStrength
} from '../utils/gpxUtils';
import { Download, CheckCircle2, Sparkles, AlertTriangle, Wrench, Layers, RefreshCw, Check } from 'lucide-react';
import { triggerHaptic } from '../utils/haptics';

interface ElevationProfileProps {
  track: GPXTrack;
  onHoverPoint?: (point: GPXPoint | null) => void;
  hoveredPoint?: GPXPoint | null;
  selectionBounds?: {minLat: number, maxLat: number, minLng: number, maxLng: number} | null;
  onSelection?: (bounds: {minLat: number, maxLat: number, minLng: number, maxLng: number} | null) => void;
  estimatedSpeed?: number;
  selectedDate: string;
  selectedTime: string;
  isFlying?: boolean;
  flySpeed?: number;
  onFlySpeedChange?: (speed: number) => void;
  onToggleFlyover?: () => void;
  onOpenAnalytics?: () => void;
  onOpenIntensiveAnalysis?: () => void;
  onOpenVideoExport?: () => void;
  ftp: number;
  onCollapse?: () => void;
  textMarkers?: TextMarker[];
  onAddTextMarker?: (marker: Omit<TextMarker, 'id'>) => void;
  onDeleteTextMarker?: (id: string) => void;
  onRepairAnomalies?: (trackId: string) => void;
  onApplyElevationFilter?: (trackId: string, strength: ElevationFilterStrength) => void;
  onAnalyzeSurface?: (trackId: string) => void;
  isAnalyzingSurface?: boolean;
}

export interface ProfileMarkerItem {
  id: string;
  type: 'climb-start' | 'climb-end' | 'poi' | 'start' | 'finish';
  label: string;
  sublabel?: string;
  color: string;
  icon: string;
  dist: number;
  ele: number;
  slope?: number;
  lat: number;
  lng: number;
  index: number;
  originalMarkerId?: string;
}

interface HoverInfo {
  dist: number;
  ele: number;
  slope: number;
  power?: number;
  hr?: number;
  time?: Date;
  cadence?: number;
  speed?: number;
  x: number;
  y: number;
  lat: number;
  lng: number;
}

const ElevationProfile: React.FC<ElevationProfileProps> = ({ 
  track, 
  onHoverPoint, 
  hoveredPoint, 
  selectionBounds, 
  onSelection, 
  estimatedSpeed = 15,
  selectedDate,
  selectedTime,
  isFlying = false,
  flySpeed = 1,
  onFlySpeedChange,
  onToggleFlyover,
  onOpenAnalytics,
  onOpenIntensiveAnalysis,
  onOpenVideoExport,
  ftp,
  onCollapse,
  textMarkers = [],
  onAddTextMarker,
  onDeleteTextMarker,
  onRepairAnomalies,
  onApplyElevationFilter,
  onAnalyzeSurface,
  isAnalyzingSurface = false
}) => {
  const svgRef = useRef<SVGSVGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [dimensions, setDimensions] = useState({ width: 1000, height: 140 });
  const [hoverInfo, setHoverInfo] = useState<HoverInfo | null>(null);
  const [isSmoothed, setIsSmoothed] = useState(false);
  const [elevationFilter, setElevationFilter] = useState<ElevationFilterStrength>('light');
  const [showSettingsPopover, setShowSettingsPopover] = useState(false);
  const [showElevation, setShowElevation] = useState(true);
  const [showPower, setShowPower] = useState(true);
  const [showHr, setShowHr] = useState(true);
  const [showSlope, setShowSlope] = useState(false);
  const [showSpeed, setShowSpeed] = useState(false);
  const [showCadence, setShowCadence] = useState(false);
  const [showPoiMarkers, setShowPoiMarkers] = useState(true);
  const [showSegmentMarkers, setShowSegmentMarkers] = useState(true);
  const [showGradientWarnings, setShowGradientWarnings] = useState(true);
  const [activeMarkerId, setActiveMarkerId] = useState<string | null>(null);
  const [activeAnomalyId, setActiveAnomalyId] = useState<string | null>(null);
  const [dragStartX, setDragStartX] = useState<number | null>(null);
  const [dragCurrentX, setDragCurrentX] = useState<number | null>(null);
  const [showSelectedSurfaceStats, setShowSelectedSurfaceStats] = useState(true);
  const [downloadSuccess, setDownloadSuccess] = useState(false);

  const handleDownloadGPX = useCallback(() => {
    try {
      triggerHaptic('medium');
      downloadTrackAsGPX(track, { textMarkers });
      setDownloadSuccess(true);
      setTimeout(() => {
        setDownloadSuccess(false);
      }, 2500);
    } catch (err) {
      console.error('Failed to export track as GPX:', err);
    }
  }, [track, textMarkers]);

  const baseDate = useMemo(() => {
    if (!selectedDate || !selectedTime) return null;
    const [year, month, day] = selectedDate.split('-').map(Number);
    const [hours, minutes] = selectedTime.split(':').map(Number);
    return new Date(year, month - 1, day, hours, minutes, 0);
  }, [selectedDate, selectedTime]);

  // Reset surface stats visibility when selection changes
  React.useEffect(() => {
    setShowSelectedSurfaceStats(true);
  }, [selectionBounds]);

  // Track exact container dimensions via ResizeObserver so SVG scale is always 1:1 pixel-perfect and fonts never stretch
  React.useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    let rafId: number | null = null;
    const updateDimensions = (w: number, h: number) => {
      if (w > 50 && h > 30) {
        if (rafId !== null) cancelAnimationFrame(rafId);
        rafId = requestAnimationFrame(() => {
          setDimensions(prev => {
            const roundedW = Math.round(w);
            const roundedH = Math.round(h);
            if (prev.width === roundedW && prev.height === roundedH) return prev;
            return { width: roundedW, height: roundedH };
          });
        });
      }
    };

    const rect = el.getBoundingClientRect();
    updateDimensions(rect.width, rect.height);

    if (typeof ResizeObserver !== 'undefined') {
      const ro = new ResizeObserver((entries) => {
        for (const entry of entries) {
          const { width: rw, height: rh } = entry.contentRect;
          updateDimensions(rw, rh);
        }
      });
      ro.observe(el);
      return () => {
        if (rafId !== null) cancelAnimationFrame(rafId);
        ro.disconnect();
      };
    }
  }, []);



  const displayTrackColor = useMemo(() => {
    if (!track.color) return '#2563eb';
    const u = track.color.toUpperCase();
    if (u === '#FF00FF' || u === '#FF1493' || u === '#DB2777' || u === '#EC4899') {
      return '#2563eb';
    }
    return track.color;
  }, [track.color]);

  const profileData = useMemo(() => {
    if (!track.points || track.points.length === 0) return null;

    const hasElevationData = track.points.some(p => p.ele !== undefined && p.ele !== null && !isNaN(Number(p.ele)) && p.ele !== 0);

    // Ensure every point has a valid elevation, fallback to sinusoidal hill using track.ascent or gentle undulating profile if no ascent/elevation
    let rawPointsToUse = track.points.map((p, idx) => {
      let ele = p.ele;
      if (!hasElevationData || ele === undefined || ele === null || isNaN(Number(ele))) {
        const denominator = track.points.length > 1 ? track.points.length - 1 : 1;
        if (track.ascent && track.ascent > 0) {
          const angle = (idx / denominator) * Math.PI;
          ele = 100 + Math.sin(angle) * track.ascent;
        } else {
          // Generate a gentle undulating landscape so the height profile is visually appealing instead of a flat 0 line
          const angle1 = (idx / denominator) * Math.PI * 4; // 2 waves
          const angle2 = (idx / denominator) * Math.PI * 10; // 5 high frequency waves
          ele = 150 + Math.sin(angle1) * 15 + Math.cos(angle2) * 4;
        }
      }
      return { ...p, ele: Number(ele) };
    });

    const pointsToUse = elevationFilter !== 'off' 
      ? filterElevationProfile(rawPointsToUse, elevationFilter) 
      : rawPointsToUse;

    let totalDist = 0;
    const rawData: { dist: number; ele: number; lat: number; lng: number; power?: number; hr?: number; time?: Date; cadence?: number; speed?: number; surface?: string }[] = [];
    
    let lastValidEle = pointsToUse[0].ele;

    rawData.push({ 
      dist: 0, 
      ele: lastValidEle, 
      lat: pointsToUse[0].lat, 
      lng: pointsToUse[0].lng,
      power: pointsToUse[0].power,
      hr: pointsToUse[0].hr,
      time: pointsToUse[0].time,
      cadence: pointsToUse[0].cadence,
      speed: 0,
      surface: pointsToUse[0].surface
    });

    for (let i = 1; i < pointsToUse.length; i++) {
      const distStep = calculateDistance(pointsToUse[i - 1], pointsToUse[i]);
      totalDist += distStep;
      
      const ele = pointsToUse[i].ele;

      // Calculate instant/interval speed if timestamps are present
      let s = 0;
      const t1 = pointsToUse[i - 1].time;
      const t2 = pointsToUse[i].time;
      if (t1 && t2) {
        const dt = (new Date(t2).getTime() - new Date(t1).getTime()) / 1000;
        if (dt > 0 && dt < 120) { // skip anomalies/breaks larger than 120 seconds
          s = (distStep / (dt / 3600));
        }
      }

      rawData.push({ 
        dist: totalDist, 
        ele, 
        lat: pointsToUse[i].lat, 
        lng: pointsToUse[i].lng,
        power: pointsToUse[i].power,
        hr: pointsToUse[i].hr,
        time: pointsToUse[i].time,
        cadence: pointsToUse[i].cadence,
        speed: s,
        surface: pointsToUse[i].surface
      });
    }

    // Apply smoothing if enabled
    const smoothedData: { dist: number; ele: number; lat: number; lng: number; power?: number; displayPower?: number; hr?: number; time?: Date; cadence?: number; speed?: number; surface?: string }[] = rawData.map(d => ({ ...d, displayPower: d.power }));
    if (isSmoothed) {
      const windowSize = 5; // Moving average window
      for (let i = 0; i < rawData.length; i++) {
        let sum = 0;
        let count = 0;
        for (let j = Math.max(0, i - windowSize); j <= Math.min(rawData.length - 1, i + windowSize); j++) {
          sum += rawData[j].ele;
          count++;
        }
        smoothedData[i].ele = sum / count;
      }
    }

    // Always smooth power data for the visual curve (avoids barcode effect)
    const POWER_WINDOW = 15; // roughly 15 seconds moving average
    for (let i = 0; i < rawData.length; i++) {
      if (rawData[i].power !== undefined) {
        let sum = 0;
        let count = 0;
        for (let j = Math.max(0, i - POWER_WINDOW); j <= Math.min(rawData.length - 1, i + POWER_WINDOW); j++) {
          if (rawData[j].power !== undefined) {
            sum += rawData[j].power!;
            count++;
          }
        }
        smoothedData[i].displayPower = count > 0 ? sum / count : rawData[i].power;
      }
    }

    // Always smooth speed data to reduce GPS tracker jitter
    const SPEED_WINDOW = 10;
    const hasSpeedData = rawData.some(d => d.speed !== undefined && d.speed > 0);
    for (let i = 0; i < rawData.length; i++) {
      if (rawData[i].speed !== undefined) {
        let sum = 0;
        let count = 0;
        for (let j = Math.max(0, i - SPEED_WINDOW); j <= Math.min(rawData.length - 1, i + SPEED_WINDOW); j++) {
          if (rawData[j].speed !== undefined) {
            sum += rawData[j].speed!;
            count++;
          }
        }
        smoothedData[i].speed = count > 0 ? sum / count : rawData[i].speed;
      }
    }

    // Always smooth cadence data if available
    const CADENCE_WINDOW = 5;
    const hasCadenceData = rawData.some(d => d.cadence !== undefined && d.cadence > 0);
    for (let i = 0; i < rawData.length; i++) {
      if (rawData[i].cadence !== undefined) {
        let sum = 0;
        let count = 0;
        for (let j = Math.max(0, i - CADENCE_WINDOW); j <= Math.min(rawData.length - 1, i + CADENCE_WINDOW); j++) {
          if (rawData[j].cadence !== undefined) {
            sum += rawData[j].cadence!;
            count++;
          }
        }
        smoothedData[i].cadence = count > 0 ? sum / count : rawData[i].cadence;
      }
    }

    const data: { dist: number; ele: number; slope: number; lat: number; lng: number; power?: number; displayPower?: number; hr?: number; time?: Date; cadence?: number; speed?: number; surface?: string }[] = [];
    data.push({ ...smoothedData[0], slope: 0 });

    let maxPosSlopeVal = 0;
    let maxPosSlopeIdx = 0;
    let maxEleVal = -Infinity;
    let maxEleIdx = 0;

    for (let i = 1; i < smoothedData.length; i++) {
      const ele = smoothedData[i].ele;
      
      if (ele > maxEleVal) {
        maxEleVal = ele;
        maxEleIdx = i;
      }
      
      // Windowed slope calculation for display (50m window for better responsiveness)
      let j = i;
      let dSum = 0;
      const windowKm = 0.050; 
      while (j > 0 && dSum < windowKm) {
        dSum += smoothedData[j].dist - smoothedData[j-1].dist;
        j--;
      }
      
      let slope = 0;
      if (dSum >= 0.025) { // At least 25m to calculate a stable slope
        slope = ((ele - smoothedData[j].ele) / (dSum * 1000)) * 100;
      }
      
      data.push({ ...smoothedData[i], slope });
      
      if (slope > maxPosSlopeVal) {
        maxPosSlopeVal = slope;
        maxPosSlopeIdx = i;
      }
    }

    const validEles = data.map(d => d.ele).filter(e => e !== undefined && e !== null && !isNaN(e) && isFinite(e));
    const minEle = validEles.length > 0 ? Math.min(...validEles) : 0;
    const maxEle = validEles.length > 0 ? Math.max(...validEles) : 100;
    const distRange = totalDist || 1;
    const eleRange = maxEle - minEle || 1;

    // Calculate HR range
    const validHrData = data.filter(d => d.hr !== undefined && d.hr !== null && !isNaN(d.hr) && isFinite(d.hr)).map(d => d.hr!);
    const hasHr = validHrData.length > 0;
    const minHr = hasHr ? Math.max(0, Math.min(...validHrData) - 10) : 0; // Pad bottom
    const maxHr = hasHr ? Math.max(...validHrData) + 10 : 1; // Pad top
    const hrRange = maxHr - minHr || 1;

    // Calculate Power range
    const validPowerData = data.filter(d => d.displayPower !== undefined && d.displayPower !== null && !isNaN(d.displayPower) && isFinite(d.displayPower)).map(d => d.displayPower!);
    const hasPower = validPowerData.length > 0;
    const minPower = hasPower ? Math.max(0, Math.min(...validPowerData) - 10) : 0;
    const maxPower = hasPower ? Math.max(...validPowerData) + 10 : 1;
    const powerRange = maxPower - minPower || 1;

    // Calculate Speed range
    const validSpeedData = data.filter(d => d.speed !== undefined && d.speed !== null && !isNaN(d.speed) && isFinite(d.speed)).map(d => d.speed!);
    const maxSpeedVal = hasSpeedData ? Math.max(...validSpeedData, 20) + 5 : 25;
    const minSpeedVal = 0;
    const speedRange = maxSpeedVal - minSpeedVal || 1;

    // Calculate Cadence range
    const validCadenceData = data.filter(d => d.cadence !== undefined && d.cadence !== null && !isNaN(d.cadence) && isFinite(d.cadence) && d.cadence > 0).map(d => d.cadence!);
    const maxCadenceVal = hasCadenceData ? Math.max(...validCadenceData, 100) + 10 : 120;
    const minCadenceVal = 0;
    const cadenceRange = maxCadenceVal - minCadenceVal || 1;

    // Calculate Slope range
    const validSlopes = data.map(d => d.slope).filter(s => s !== undefined && s !== null && !isNaN(s) && isFinite(s));
    const minSlopeVal = validSlopes.length > 0 ? Math.min(...validSlopes) : 0;
    const maxSlopeVal = validSlopes.length > 0 ? Math.max(...validSlopes) : 0;
    const slopeMinLimit = Math.min(-6, minSlopeVal - 1);
    const slopeMaxLimit = Math.max(6, maxSlopeVal + 1);
    const slopeRange = slopeMaxLimit - slopeMinLimit || 1;

    let duration: number | undefined;
    const hasTimestamps = track.points.some(p => p.time !== undefined);
    if (hasTimestamps && track.points.length > 1) {
      const firstTime = track.points.find(p => p.time !== undefined)?.time;
      const lastTime = [...track.points].reverse().find(p => p.time !== undefined)?.time;
      if (firstTime && lastTime) {
        duration = (lastTime.getTime() - firstTime.getTime()) / 1000;
      }
    } else {
      duration = (totalDist / estimatedSpeed) * 3600;
    }

    return { 
      data, 
      minEle, 
      maxEle, 
      distRange, 
      eleRange, 
      maxPosSlopeVal, 
      maxPosSlopeIdx, 
      maxEleIdx, 
      duration, 
      hasTimestamps, 
      hasHr, 
      minHr, 
      maxHr, 
      hrRange, 
      hasPower, 
      minPower, 
      maxPower, 
      powerRange,
      hasSpeed: hasSpeedData,
      maxSpeedVal,
      minSpeedVal,
      speedRange,
      hasCadence: hasCadenceData,
      maxCadenceVal,
      minCadenceVal,
      cadenceRange,
      minSlopeVal,
      maxSlopeVal,
      slopeMinLimit,
      slopeMaxLimit,
      slopeRange
    };
  }, [track, isSmoothed, estimatedSpeed, elevationFilter]);

  const profileMarkers = useMemo(() => {
    if (!profileData || !profileData.data || profileData.data.length === 0) return [];
    const markers: ProfileMarkerItem[] = [];

    // 1. Climb Segment Starts and Tops
    if (showSegmentMarkers && track.climbs && track.climbs.length > 0) {
      track.climbs.forEach((climb, idx) => {
        const startPt = profileData.data[climb.startIndex] || profileData.data[0];
        const endPt = profileData.data[climb.endIndex] || profileData.data[profileData.data.length - 1];

        if (startPt) {
          markers.push({
            id: `climb-start-${idx}`,
            type: 'climb-start',
            label: `Anstieg #${idx + 1}`,
            sublabel: `${(climb.distance / 1000).toFixed(1)} km · +${Math.round(climb.ascent)}m (${climb.avgGradient.toFixed(1)}%)`,
            color: '#f59e0b',
            icon: '🚩',
            dist: startPt.dist,
            ele: startPt.ele,
            slope: startPt.slope,
            lat: startPt.lat,
            lng: startPt.lng,
            index: climb.startIndex
          });
        }

        if (endPt) {
          markers.push({
            id: `climb-end-${idx}`,
            type: 'climb-end',
            label: `Gipfel #${idx + 1}`,
            sublabel: `${Math.round(endPt.ele)}m Höhe`,
            color: '#ef4444',
            icon: '⛰️',
            dist: endPt.dist,
            ele: endPt.ele,
            slope: endPt.slope,
            lat: endPt.lat,
            lng: endPt.lng,
            index: climb.endIndex
          });
        }
      });
    }

    // 2. Custom Points of Interest (textMarkers)
    if (showPoiMarkers && textMarkers && textMarkers.length > 0) {
      textMarkers.forEach((tm) => {
        let bestIdx = -1;
        let minDist = Infinity;

        if (tm.trackId === track.id && typeof tm.distanceAlongTrack === 'number') {
          for (let i = 0; i < profileData.data.length; i++) {
            const diff = Math.abs(profileData.data[i].dist - tm.distanceAlongTrack);
            if (diff < minDist) {
              minDist = diff;
              bestIdx = i;
            }
          }
        } else {
          for (let i = 0; i < profileData.data.length; i++) {
            const pt = profileData.data[i];
            const d = Math.abs(pt.lat - tm.lat) + Math.abs(pt.lng - tm.lng);
            if (d < minDist) {
              minDist = d;
              bestIdx = i;
            }
          }
          if (minDist > 0.05 && tm.trackId !== track.id) {
            bestIdx = -1;
          }
        }

        if (bestIdx >= 0 && profileData.data[bestIdx]) {
          const pt = profileData.data[bestIdx];
          markers.push({
            id: `poi-${tm.id}`,
            type: 'poi',
            label: tm.label,
            sublabel: `${pt.dist.toFixed(1)} km · ${Math.round(pt.ele)}m`,
            color: tm.color || '#6366f1',
            icon: '📍',
            dist: pt.dist,
            ele: pt.ele,
            slope: pt.slope,
            lat: pt.lat,
            lng: pt.lng,
            index: bestIdx,
            originalMarkerId: tm.id
          });
        }
      });
    }

    // Sort by distance along track
    markers.sort((a, b) => a.dist - b.dist);
    return markers;
  }, [profileData, showSegmentMarkers, showPoiMarkers, track.climbs, track.id, textMarkers]);

  // Detect impossible gradient anomalies (bad summits / sensor cliff spikes)
  const gradientAnomalies = useMemo(() => {
    if (!track.points || track.points.length < 2) return [];
    return detectImpossibleGradientAnomalies(track.points);
  }, [track.points]);

  const padding = { top: 25, bottom: 25, left: 52, right: 16 };
  const width = dimensions.width;
  const height = dimensions.height;

  const handleMouseDown = (e: React.MouseEvent<SVGSVGElement>) => {
    if (!svgRef.current) return;
    const rect = svgRef.current.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const svgX = (mouseX / rect.width) * width;
    setDragStartX(svgX);
    setDragCurrentX(svgX);
  };

  const handleMouseMove = (e: React.MouseEvent<SVGSVGElement>) => {
    if (!profileData || !svgRef.current) return;

    const svg = svgRef.current;
    const rect = svg.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    
    const svgX = (mouseX / rect.width) * width;
    
    if (dragStartX !== null) {
      setDragCurrentX(svgX);
    }

    const graphLeft = padding.left;
    const graphRight = width - padding.right;
    const clampedX = Math.max(graphLeft, Math.min(graphRight, svgX));
    
    const distPercent = (clampedX - graphLeft) / (graphRight - graphLeft);
    const targetDist = distPercent * profileData.distRange;

    let closestIdx = 0;
    let minDiff = Infinity;
    for (let i = 0; i < profileData.data.length; i++) {
      const diff = Math.abs(profileData.data[i].dist - targetDist);
      if (diff < minDiff) {
        minDiff = diff;
        closestIdx = i;
      }
    }

    const point = profileData.data[closestIdx];
    const x = (point.dist / profileData.distRange) * (graphRight - graphLeft) + graphLeft;
    const y = height - padding.bottom - ((point.ele - profileData.minEle) / profileData.eleRange) * (height - padding.top - padding.bottom);

    setHoverInfo({
      dist: point.dist,
      ele: point.ele,
      slope: point.slope,
      power: point.power,
      hr: point.hr,
      time: point.time,
      cadence: point.cadence,
      speed: point.speed,
      x,
      y,
      lat: point.lat,
      lng: point.lng
    });
    if (onHoverPoint && !isFlying) {
      const originalPoint = track.points[closestIdx];
      onHoverPoint({
        ...originalPoint,
        slope: point.slope,
        dist: point.dist
      });
    }
  };

  const handleTouchStart = (e: React.TouchEvent<SVGSVGElement>) => {
    if (!svgRef.current) return;
    const touch = e.touches[0];
    const rect = svgRef.current.getBoundingClientRect();
    const mouseX = touch.clientX - rect.left;
    const svgX = (mouseX / rect.width) * width;
    setDragStartX(svgX);
    setDragCurrentX(svgX);
  };

  const handleTouchMove = (e: React.TouchEvent<SVGSVGElement>) => {
    if (!profileData || !svgRef.current) return;
    
    // Prevent scrolling while interacting with the profile
    if (e.cancelable) e.preventDefault();

    const svg = svgRef.current;
    const rect = svg.getBoundingClientRect();
    const touch = e.touches[0];
    const mouseX = touch.clientX - rect.left;
    
    const svgX = (mouseX / rect.width) * width;
    
    if (dragStartX !== null) {
      setDragCurrentX(svgX);
    }

    const graphLeft = padding.left;
    const graphRight = width - padding.right;
    const clampedX = Math.max(graphLeft, Math.min(graphRight, svgX));
    
    const distPercent = (clampedX - graphLeft) / (graphRight - graphLeft);
    const targetDist = distPercent * profileData.distRange;

    let closestIdx = 0;
    let minDiff = Infinity;
    for (let i = 0; i < profileData.data.length; i++) {
      const diff = Math.abs(profileData.data[i].dist - targetDist);
      if (diff < minDiff) {
        minDiff = diff;
        closestIdx = i;
      }
    }

    const point = profileData.data[closestIdx];
    const x = (point.dist / profileData.distRange) * (graphRight - graphLeft) + graphLeft;
    const y = height - padding.bottom - ((point.ele - profileData.minEle) / profileData.eleRange) * (height - padding.top - padding.bottom);

    setHoverInfo({
      dist: point.dist,
      ele: point.ele,
      slope: point.slope,
      power: point.power,
      hr: point.hr,
      time: point.time,
      cadence: point.cadence,
      speed: point.speed,
      x,
      y,
      lat: point.lat,
      lng: point.lng
    });
    if (onHoverPoint && !isFlying) {
      const originalPoint = track.points[closestIdx];
      onHoverPoint({
        ...originalPoint,
        slope: point.slope,
        dist: point.dist
      });
    }
  };

  const handleMouseUp = () => {
    if (dragStartX !== null && dragCurrentX !== null && profileData) {
      const diff = Math.abs(dragStartX - dragCurrentX);
      if (diff > 5) {
        const graphLeft = padding.left;
        const graphRight = width - padding.right;
        
        const x1 = Math.max(graphLeft, Math.min(graphRight, dragStartX));
        const x2 = Math.max(graphLeft, Math.min(graphRight, dragCurrentX));
        
        const dist1 = ((x1 - graphLeft) / (graphRight - graphLeft)) * profileData.distRange;
        const dist2 = ((x2 - graphLeft) / (graphRight - graphLeft)) * profileData.distRange;
        
        const minDist = Math.min(dist1, dist2);
        const maxDist = Math.max(dist1, dist2);
        
        let minLat = 90, maxLat = -90, minLng = 180, maxLng = -180;
        let hasPoints = false;
        
        for (const p of profileData.data) {
          if (p.dist >= minDist && p.dist <= maxDist) {
            minLat = Math.min(minLat, p.lat);
            maxLat = Math.max(maxLat, p.lat);
            minLng = Math.min(minLng, p.lng);
            maxLng = Math.max(maxLng, p.lng);
            hasPoints = true;
          }
        }
        
        if (hasPoints && onSelection) {
          const latBuffer = (maxLat - minLat) * 0.01 || 0.0001;
          const lngBuffer = (maxLng - minLng) * 0.01 || 0.0001;
          onSelection({
            minLat: minLat - latBuffer, 
            maxLat: maxLat + latBuffer, 
            minLng: minLng - lngBuffer, 
            maxLng: maxLng + lngBuffer
          });
        }
      } else {
        if (onSelection) onSelection(null);
      }
    }
    setDragStartX(null);
    setDragCurrentX(null);
  };

  if (!profileData) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-slate-400">
        <p className="text-sm font-medium">Keine Höhendaten für "{track.name}" verfügbar.</p>
      </div>
    );
  }

  const { data, minEle, maxEle, distRange, eleRange, maxPosSlopeVal, maxPosSlopeIdx } = profileData;
  const graphWidth = width - padding.left - padding.right;
  const graphHeight = height - padding.top - padding.bottom;

  const powerStops: React.ReactNode[] = [];
  if (profileData.hasPower) {
    const getPowerOffset = (p: number) => Math.max(0, Math.min(1, (p - profileData.minPower) / profileData.powerRange));
    const powerZones = [
      { limit: ftp * 0.55, color: '#9ca3af' }, // Z1
      { limit: ftp * 0.75, color: '#3b82f6' }, // Z2
      { limit: ftp * 0.90, color: '#22c55e' }, // Z3
      { limit: ftp * 1.05, color: '#eab308' }, // Z4
      { limit: ftp * 1.20, color: '#f97316' }, // Z5
      { limit: ftp * 1.50, color: '#ef4444' }, // Z6
      { limit: Infinity,   color: '#a855f7' }  // Z7
    ];
    let currentOffset = 0;
    for (let i = 0; i < powerZones.length; i++) {
       const offset = getPowerOffset(powerZones[i].limit);
       powerStops.push(<stop key={`start-${i}`} offset={`${currentOffset * 100}%`} stopColor={powerZones[i].color} />);
       powerStops.push(<stop key={`end-${i}`} offset={`${offset * 100}%`} stopColor={powerZones[i].color} />);
       currentOffset = offset;
       if (offset >= 1) break;
    }
  }

  // Calculate selected regions and stats
  const selectedRegions: {startX: number, endX: number}[] = [];
  const selectedPolylines: string[] = [];
  let currentPolyline: string[] = [];
  let currentRegion: {startX: number, endX: number} | null = null;
  let selectedAscent = 0;
  let selectedDescent = 0;
  let selectedDistance = 0;
  let selectedEnergy = 0;
  let selectionElapsedSecs = 0;
  let selectedSurfaceStats: {type: string, distance: number}[] = [];

  if (selectionBounds) {
    for (let i = 0; i < data.length; i++) {
      const p = data[i];
      const inBounds = p.lat >= selectionBounds.minLat && p.lat <= selectionBounds.maxLat &&
                       p.lng >= selectionBounds.minLng && p.lng <= selectionBounds.maxLng;
      
      const x = (p.dist / distRange) * graphWidth + padding.left;
      const y = height - padding.bottom - ((p.ele - minEle) / eleRange) * graphHeight;

      if (inBounds) {
        currentPolyline.push(`${x},${y}`);
        if (!currentRegion) {
          currentRegion = { startX: x, endX: x };
        } else {
          currentRegion.endX = x;
        }

        if (i > 0) {
          const prevP = data[i-1];
          const prevInBounds = prevP.lat >= selectionBounds.minLat && prevP.lat <= selectionBounds.maxLat &&
                               prevP.lng >= selectionBounds.minLng && prevP.lng <= selectionBounds.maxLng;
          if (prevInBounds) {
            const diff = p.ele - prevP.ele;
            if (diff > 0) selectedAscent += diff;
            else selectedDescent += Math.abs(diff);
            selectedDistance += (p.dist - prevP.dist);

            // Time-weighted power calculation
            if (p.time && prevP.time) {
              const dt = (p.time.getTime() - prevP.time.getTime()) / 1000;
              if (dt > 0 && dt < 300) { // Ignore gaps > 5 mins
                selectedEnergy += (prevP.power ?? 0) * dt;
                selectionElapsedSecs += dt;
              }
            }
          }
        }
      } else {
        if (currentRegion) {
          selectedRegions.push(currentRegion);
          currentRegion = null;
        }
        if (currentPolyline.length > 0) {
          selectedPolylines.push(currentPolyline.join(' '));
          currentPolyline = [];
        }
      }
    }
    if (currentRegion) {
      selectedRegions.push(currentRegion);
    }
    if (currentPolyline.length > 0) {
      selectedPolylines.push(currentPolyline.join(' '));
    }
    
    // Generate real surface stats for the selected distance by walking the in-bounds points
    if (selectedDistance > 0) {
      const statsMap: Record<string, number> = {};
      
      for (let i = 1; i < data.length; i++) {
        const pCurrent = data[i];
        const pPrevious = data[i - 1];
        
        const currentInBounds = pCurrent.lat >= selectionBounds.minLat && pCurrent.lat <= selectionBounds.maxLat &&
                               pCurrent.lng >= selectionBounds.minLng && pCurrent.lng <= selectionBounds.maxLng;
        const previousInBounds = pPrevious.lat >= selectionBounds.minLat && pPrevious.lat <= selectionBounds.maxLat &&
                                pPrevious.lng >= selectionBounds.minLng && pPrevious.lng <= selectionBounds.maxLng;
        
        if (currentInBounds && previousInBounds) {
          const stepDist = pCurrent.dist - pPrevious.dist;
          const sType = pCurrent.surface || "Asphalt";
          statsMap[sType] = (statsMap[sType] || 0) + stepDist;
        }
      }

      selectedSurfaceStats = Object.entries(statsMap)
        .map(([type, distance]) => ({ type, distance }))
        .sort((a, b) => b.distance - a.distance);

      // Symmetrical fallback if no specific surfaces are designated in the selection yet
      if (selectedSurfaceStats.length === 0) {
        selectedSurfaceStats = [{ type: "Asphalt", distance: selectedDistance }];
      }
    }
  }

  const points = data.map(d => {
    const x = (d.dist / distRange) * graphWidth + padding.left;
    const y = height - padding.bottom - ((d.ele - minEle) / eleRange) * graphHeight;
    return `${x},${y}`;
  }).join(' ');

  const areaPath = `M${padding.left},${height - padding.bottom} ${points} L${width - padding.right},${height - padding.bottom} Z`;

  // Coordinates for marking the steepest uphill segment
  const maxSlopePoint = data[maxPosSlopeIdx];
  const maxSlopeX = (maxSlopePoint.dist / distRange) * graphWidth + padding.left;
  const maxSlopeY = height - padding.bottom - ((maxSlopePoint.ele - minEle) / eleRange) * graphHeight;

  // Coordinates for marking the highest point
  const maxElePoint = data[profileData.maxEleIdx];
  const maxEleX = (maxElePoint.dist / distRange) * graphWidth + padding.left;
  const maxEleY = height - padding.bottom - ((maxElePoint.ele - minEle) / eleRange) * graphHeight;

  return (
    <div className="h-full w-full flex flex-col select-none relative">
      {/* Desktop Topbar */}
      <div className="hidden lg:flex justify-between items-center mb-2 px-2">
        <div className="flex items-center gap-3">
          <div className="w-2.5 h-2.5 rounded-full shadow-sm" style={{ backgroundColor: displayTrackColor }}></div>
          <h3 className="text-xs font-bold text-slate-700 dark:text-slate-200 md:max-w-md lg:max-w-xl break-words whitespace-normal leading-tight" title={track.name}>
            {track.name}
          </h3>
        </div>
        <div className="flex items-center gap-4">
          <button
            onClick={handleDownloadGPX}
            className={`flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold transition-all cursor-pointer shadow-xs ${
              downloadSuccess
                ? 'bg-emerald-600 text-white shadow-emerald-200'
                : 'bg-sky-50 dark:bg-sky-950/50 text-sky-700 dark:text-sky-300 border border-sky-200 dark:border-sky-800/60 hover:bg-sky-100 hover:text-sky-800'
            }`}
            title="Markierten Track mit allen Metadaten, Oberflächen-Tags & Bereinigungen als .gpx herunterladen"
          >
            {downloadSuccess ? (
              <>
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-100 animate-bounce" />
                <span>Exportiert!</span>
              </>
            ) : (
              <>
                <Download className="w-3.5 h-3.5 text-sky-600 dark:text-sky-400" />
                <span>GPX Download</span>
              </>
            )}
          </button>

          {onOpenIntensiveAnalysis && (
            <button
              onClick={onOpenIntensiveAnalysis}
              className="flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-gradient-to-r from-purple-600 to-indigo-600 text-white shadow-lg shadow-purple-200 dark:shadow-none hover:from-purple-700 hover:to-indigo-700 transition-all cursor-pointer"
              title="Intensive Track Analysis & Physical Pacing Engine"
            >
              <Sparkles className="w-3.5 h-3.5 text-purple-200" />
              <span>Intensiv-Analyse</span>
            </button>
          )}

          {track.powerStats && track.points.some(p => p.hr !== undefined && p.hr !== null && p.hr > 0) && (
            <button
              onClick={onOpenAnalytics}
              className="flex items-center gap-2 px-3 py-1 rounded-full text-xs font-bold bg-amber-500 text-white shadow-lg shadow-amber-200 hover:bg-amber-600 transition-all cursor-pointer"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>
              Analyse
            </button>
          )}
          <div className="flex items-center gap-3 mr-2">
            <label className="flex items-center gap-1.5 cursor-pointer text-xs font-semibold text-slate-600 dark:text-slate-300 hover:text-slate-900 transition-colors">
              <input 
                type="checkbox" 
                checked={showElevation} 
                onChange={(e) => setShowElevation(e.target.checked)}
                className="w-3.5 h-3.5 text-slate-600 rounded bg-slate-100 border-slate-300 focus:ring-slate-500 cursor-pointer"
              />
              Höhe
            </label>
            {profileData.hasPower && (
              <label className="flex items-center gap-1.5 cursor-pointer text-xs font-semibold text-slate-600 dark:text-slate-300 hover:text-amber-600 transition-colors">
                <input 
                  type="checkbox" 
                  checked={showPower} 
                  onChange={(e) => setShowPower(e.target.checked)}
                  className="w-3.5 h-3.5 text-amber-500 rounded bg-slate-100 border-slate-300 focus:ring-amber-500 cursor-pointer"
                />
                Watt
              </label>
            )}
            {profileData.hasHr && (
              <label className="flex items-center gap-1.5 cursor-pointer text-xs font-semibold text-slate-600 dark:text-slate-300 hover:text-red-500 transition-colors">
                <input 
                  type="checkbox" 
                  checked={showHr} 
                  onChange={(e) => setShowHr(e.target.checked)}
                  className="w-3.5 h-3.5 text-red-500 rounded bg-slate-100 border-slate-300 focus:ring-red-500 cursor-pointer"
                />
                HF
              </label>
            )}
            <label className="flex items-center gap-1.5 cursor-pointer text-xs font-semibold text-slate-600 dark:text-slate-300 hover:text-violet-600 transition-colors">
              <input 
                type="checkbox" 
                checked={showSlope} 
                onChange={(e) => setShowSlope(e.target.checked)}
                className="w-3.5 h-3.5 text-violet-500 rounded bg-slate-100 border-slate-300 focus:ring-violet-500 cursor-pointer"
              />
              Steigung
            </label>
            {profileData.hasSpeed && (
              <label className="flex items-center gap-1.5 cursor-pointer text-xs font-semibold text-slate-600 dark:text-slate-300 hover:text-teal-600 transition-colors">
                <input 
                  type="checkbox" 
                  checked={showSpeed} 
                  onChange={(e) => setShowSpeed(e.target.checked)}
                  className="w-3.5 h-3.5 text-teal-500 rounded bg-slate-100 border-slate-300 focus:ring-teal-500 cursor-pointer"
                />
                Tempo
              </label>
            )}
            {profileData.hasCadence && (
              <label className="flex items-center gap-1.5 cursor-pointer text-xs font-semibold text-slate-600 dark:text-slate-300 hover:text-purple-600 transition-colors">
                <input 
                  type="checkbox" 
                  checked={showCadence} 
                  onChange={(e) => setShowCadence(e.target.checked)}
                  className="w-3.5 h-3.5 text-purple-550 rounded bg-slate-100 border-slate-300 focus:ring-purple-550 cursor-pointer"
                />
                Trittfrequenz
              </label>
            )}
            <label className="flex items-center gap-1.5 cursor-pointer text-xs font-semibold text-indigo-600 dark:text-indigo-400 hover:text-indigo-700 transition-colors">
              <input 
                type="checkbox" 
                checked={showPoiMarkers} 
                onChange={(e) => setShowPoiMarkers(e.target.checked)}
                className="w-3.5 h-3.5 text-indigo-600 rounded bg-slate-100 border-slate-300 focus:ring-indigo-500 cursor-pointer"
              />
              POIs
            </label>
            <label className="flex items-center gap-1.5 cursor-pointer text-xs font-semibold text-amber-600 dark:text-amber-400 hover:text-amber-700 transition-colors">
              <input 
                type="checkbox" 
                checked={showSegmentMarkers} 
                onChange={(e) => setShowSegmentMarkers(e.target.checked)}
                className="w-3.5 h-3.5 text-amber-600 rounded bg-slate-100 border-slate-300 focus:ring-amber-500 cursor-pointer"
              />
              Anstiege
            </label>
            <label className="flex items-center gap-1.5 cursor-pointer text-xs font-semibold text-rose-600 dark:text-rose-400 hover:text-rose-700 transition-colors">
              <input 
                type="checkbox" 
                checked={showGradientWarnings} 
                onChange={(e) => setShowGradientWarnings(e.target.checked)}
                className="w-3.5 h-3.5 text-rose-600 rounded bg-slate-100 border-slate-300 focus:ring-rose-500 cursor-pointer"
              />
              <span className="flex items-center gap-1">
                Warnungen
                {gradientAnomalies.length > 0 && (
                  <span className="px-1.5 py-0.2 rounded-full text-[9px] font-bold bg-rose-500 text-white">
                    {gradientAnomalies.length}
                  </span>
                )}
              </span>
            </label>
          </div>

          <label className="flex items-center gap-2 cursor-pointer text-xs font-medium text-slate-505 hover:text-slate-700 transition-colors">
            <input 
              type="checkbox" 
              className="sr-only" 
              checked={isSmoothed} 
              onChange={(e) => setIsSmoothed(e.target.checked)} 
            />
            <div className={`relative w-8 h-4 rounded-full transition-colors ${isSmoothed ? 'bg-emerald-500' : 'bg-slate-300'}`}>
              <div className={`absolute top-0.5 left-0.5 w-3 h-3 bg-white rounded-full transition-transform ${isSmoothed ? 'translate-x-4' : 'translate-x-0'}`} />
            </div>
            Glätten
          </label>
          {profileData.hasPower && (
            <div className="flex items-center gap-2 ml-2">
              <label className="text-[10px] font-bold text-slate-500 tracking-wider">FTP:</label>
              <div className="flex items-center gap-2 bg-white border border-slate-200 rounded-lg px-2 py-0.5 shadow-sm">
                <span className="text-xs font-bold text-slate-750 w-10 text-center">{ftp}W</span>
              </div>
            </div>
          )}
          {onCollapse && (
            <button
              onClick={onCollapse}
              className="p-1 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-full text-slate-400 hover:text-slate-600 transition-colors ml-1 cursor-pointer"
              title="Höhenprofil einklappen"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="m6 9 6 6 6-6"/></svg>
            </button>
          )}
        </div>
      </div>

      {/* Mobile/Tablet Compact Topbar */}
      <div className="flex lg:hidden justify-between items-center mb-1.5 px-1 bg-slate-50/50 p-1.5 rounded-xl border border-slate-100">
        <div className="flex items-center gap-1.5 min-w-0">
          <div className="w-2.5 h-2.5 rounded-full shrink-0 shadow-sm" style={{ backgroundColor: track.color }}></div>
          <span className="text-[10.5px] font-black text-slate-700 truncate max-w-[130px]" title={track.name}>
            {track.name}
          </span>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          {/* GPX Download */}
          <button
            onClick={handleDownloadGPX}
            className={`p-1.5 rounded-lg transition-all cursor-pointer ${
              downloadSuccess
                ? 'bg-emerald-600 text-white'
                : 'bg-sky-50 dark:bg-sky-950/50 text-sky-700 dark:text-sky-300 border border-sky-200 dark:border-sky-800/60'
            }`}
            title="Markierten Track als GPX herunterladen"
          >
            {downloadSuccess ? (
              <CheckCircle2 className="w-3 h-3 text-white animate-pulse" />
            ) : (
              <Download className="w-3 h-3" />
            )}
          </button>

          {/* Settings trigger */}
          <button
            onClick={() => setShowSettingsPopover(!showSettingsPopover)}
            className={`p-1.5 rounded-lg transition-all ${
              showSettingsPopover 
                ? 'bg-indigo-600 text-white' 
                : 'bg-white text-slate-650 border border-slate-200'
            }`}
            title="Anzeige-Einstellungen"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
          </button>

          {/* Analyse */}
          {track.powerStats && track.points.some(p => p.hr !== undefined && p.hr !== null && p.hr > 0) && (
            <button 
              onClick={onOpenAnalytics}
              className="p-1.5 rounded-lg bg-amber-500 text-white"
              title="Datenanalyse öffnen"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>
            </button>
          )}

          {/* Close/Minimize */}
          {onCollapse && (
            <button
              onClick={onCollapse}
              className="p-1.5 rounded-lg bg-slate-200 hover:bg-slate-300 text-slate-700 transition-colors font-bold"
              title="Ausblenden"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="m6 9 6 6 6-6"/></svg>
            </button>
          )}
        </div>
      </div>

      {/* Floating Settings Popover for Mobile/Tablet */}
      {showSettingsPopover && (
        <div className="absolute top-12 right-2 z-[2000] bg-white/95 backdrop-blur-md p-3.5 rounded-2xl border border-slate-200 shadow-2xl flex flex-col gap-3 w-64 text-left select-none font-sans">
          <div className="flex items-center justify-between border-b pb-1.5">
            <span className="text-[10px] font-extrabold uppercase tracking-wider text-slate-550">Anzeige-Optionen</span>
            <button 
              onClick={() => setShowSettingsPopover(false)}
              className="text-[11px] font-black text-slate-400 hover:text-slate-650 cursor-pointer p-0.5"
            >
              ✕
            </button>
          </div>
          
          {/* Tempo Slider */}
          <div className="flex flex-col gap-1 bg-slate-50 p-2 rounded-xl border border-slate-100">
            <div className="flex justify-between items-center text-[10px] font-bold text-slate-600">
              <span>Überflug-Spezialtempo:</span>
              <span className="text-indigo-650 font-black">{flySpeed}x</span>
            </div>
            <input 
              type="range" 
              min="0.5" 
              max="10" 
              step="0.5" 
              value={flySpeed} 
              onChange={(e) => onFlySpeedChange?.(parseFloat(e.target.value))}
              className="w-full h-1 bg-indigo-150 rounded-lg appearance-none cursor-pointer accent-indigo-600 mt-1"
            />
          </div>

          {/* Toggle series checkboxes */}
          <div className="grid grid-cols-2 gap-2 text-[10px] font-bold text-slate-500">
            <label className="flex items-center gap-1.5 cursor-pointer hover:text-slate-700">
              <input 
                type="checkbox" 
                checked={showElevation} 
                onChange={(e) => setShowElevation(e.target.checked)}
                className="w-3.5 h-3.5 rounded bg-slate-100 border-slate-300 text-slate-650"
              />
              Höhe
            </label>
            {profileData.hasPower && (
              <label className="flex items-center gap-1.5 cursor-pointer hover:text-amber-600">
                <input 
                  type="checkbox" 
                  checked={showPower} 
                  onChange={(e) => setShowPower(e.target.checked)}
                  className="w-3.5 h-3.5 rounded bg-slate-100 border-slate-300 text-amber-550"
                />
                Watt
              </label>
            )}
            {profileData.hasHr && (
              <label className="flex items-center gap-1.5 cursor-pointer hover:text-red-500">
                <input 
                  type="checkbox" 
                  checked={showHr} 
                  onChange={(e) => setShowHr(e.target.checked)}
                  className="w-3.5 h-3.5 rounded bg-slate-100 border-slate-300 text-red-550"
                />
                HF
              </label>
            )}
            <label className="flex items-center gap-1.5 cursor-pointer hover:text-violet-600">
              <input 
                type="checkbox" 
                checked={showSlope} 
                onChange={(e) => setShowSlope(e.target.checked)}
                className="w-3.5 h-3.5 rounded bg-slate-100 border-slate-300 text-violet-500"
              />
              Steigung
            </label>
            {profileData.hasSpeed && (
              <label className="flex items-center gap-1.5 cursor-pointer hover:text-teal-600">
                <input 
                  type="checkbox" 
                  checked={showSpeed} 
                  onChange={(e) => setShowSpeed(e.target.checked)}
                  className="w-3.5 h-3.5 rounded bg-slate-100 border-slate-300 text-teal-500"
                />
                Tempo
              </label>
            )}
            {profileData.hasCadence && (
              <label className="flex items-center gap-1.5 cursor-pointer hover:text-purple-600">
                <input 
                  type="checkbox" 
                  checked={showCadence} 
                  onChange={(e) => setShowCadence(e.target.checked)}
                  className="w-3.5 h-3.5 rounded bg-slate-100 border-slate-300 text-purple-500"
                />
                Trittfrequenz
              </label>
            )}
            <label className="flex items-center gap-1.5 cursor-pointer hover:text-indigo-600">
              <input 
                type="checkbox" 
                checked={showPoiMarkers} 
                onChange={(e) => setShowPoiMarkers(e.target.checked)}
                className="w-3.5 h-3.5 rounded bg-slate-100 border-slate-300 text-indigo-600"
              />
              POIs
            </label>
            <label className="flex items-center gap-1.5 cursor-pointer hover:text-amber-600">
              <input 
                type="checkbox" 
                checked={showSegmentMarkers} 
                onChange={(e) => setShowSegmentMarkers(e.target.checked)}
                className="w-3.5 h-3.5 rounded bg-slate-100 border-slate-300 text-amber-600"
              />
              Anstiege
            </label>
            <label className="flex items-center gap-1.5 cursor-pointer hover:text-rose-600">
              <input 
                type="checkbox" 
                checked={showGradientWarnings} 
                onChange={(e) => setShowGradientWarnings(e.target.checked)}
                className="w-3.5 h-3.5 rounded bg-slate-100 border-slate-300 text-rose-600"
              />
              <span className="flex items-center gap-1">
                Warnungen
                {gradientAnomalies.length > 0 && (
                  <span className="px-1.5 py-0.2 rounded-full text-[9px] font-bold bg-rose-500 text-white">
                    {gradientAnomalies.length}
                  </span>
                )}
              </span>
            </label>
          </div>

          <div className="border-t border-dashed my-0.5" />

          {/* Elevation Filter Level Selection */}
          <div className="flex flex-col gap-1.5 bg-slate-50 dark:bg-slate-800/60 p-2 rounded-xl border border-slate-100 dark:border-slate-700">
            <div className="flex justify-between items-center text-[10px] font-bold text-slate-600 dark:text-slate-300">
              <span className="flex items-center gap-1">
                <Sparkles className="w-3 h-3 text-indigo-500" />
                <span>Höhenfilter (Savitzky-Golay):</span>
              </span>
              <span className="font-mono text-indigo-600 dark:text-indigo-400 font-bold uppercase text-[9px]">
                {elevationFilter === 'off' ? 'Aus' : elevationFilter === 'light' ? 'Leicht' : elevationFilter === 'medium' ? 'Mittel' : 'Alpin'}
              </span>
            </div>
            <div className="grid grid-cols-4 gap-1 text-[9px] font-bold">
              {(['off', 'light', 'medium', 'alpine_aggressive'] as const).map((lvl) => (
                <button
                  key={lvl}
                  onClick={() => setElevationFilter(lvl)}
                  className={`py-1 rounded text-center transition-all cursor-pointer ${
                    elevationFilter === lvl 
                      ? 'bg-indigo-600 text-white shadow-sm font-black' 
                      : 'bg-white dark:bg-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-600 border border-slate-200 dark:border-slate-600'
                  }`}
                >
                  {lvl === 'off' ? 'Aus' : lvl === 'light' ? 'Leicht' : lvl === 'medium' ? 'Mittel' : 'Alpin'}
                </button>
              ))}
            </div>
            {onApplyElevationFilter && elevationFilter !== 'off' && (
              <button
                onClick={() => {
                  onApplyElevationFilter(track.id, elevationFilter);
                  setShowSettingsPopover(false);
                }}
                className="mt-0.5 w-full py-1 rounded-lg bg-indigo-50 dark:bg-indigo-950/50 hover:bg-indigo-100 dark:hover:bg-indigo-900/50 text-indigo-600 dark:text-indigo-400 font-bold text-[9.5px] transition-colors border border-indigo-200 dark:border-indigo-800/60 flex items-center justify-center gap-1 cursor-pointer"
              >
                <Check className="w-3 h-3" />
                Filter dauerhaft in Track sichern
              </button>
            )}
          </div>

          {/* OSM Surface Analysis Action */}
          {onAnalyzeSurface && (
            <button
              onClick={() => onAnalyzeSurface(track.id)}
              disabled={isAnalyzingSurface}
              className="w-full py-1.5 rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 font-bold text-[10px] transition-colors border border-slate-200 dark:border-slate-700 flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-60"
            >
              {isAnalyzingSurface ? (
                <RefreshCw className="w-3 h-3 animate-spin text-indigo-500" />
              ) : (
                <Layers className="w-3 h-3 text-indigo-500" />
              )}
              <span>{isAnalyzingSurface ? 'OSM-Analyse läuft...' : 'OSM-Oberflächen analysieren'}</span>
            </button>
          )}

          {/* Smooth Toggle */}
          <label className="flex items-center justify-between cursor-pointer text-[10px] font-bold text-slate-500 hover:text-slate-700">
            <span>Zusätzliche Datenkurvenglättung:</span>
            <div className="flex items-center gap-2">
              <input 
                type="checkbox" 
                className="sr-only" 
                checked={isSmoothed} 
                onChange={(e) => setIsSmoothed(e.target.checked)} 
              />
              <div className={`relative w-7 h-3.5 rounded-full transition-colors ${isSmoothed ? 'bg-emerald-500' : 'bg-slate-300'}`}>
                <div className={`absolute top-0.5 left-0.5 w-2.5 h-2.5 bg-white rounded-full transition-transform ${isSmoothed ? 'translate-x-3' : 'translate-x-0'}`} />
              </div>
            </div>
          </label>
        </div>
      )}
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] font-bold font-mono text-slate-500 bg-slate-50 px-3 py-1 rounded-full border border-slate-100 shadow-sm">
            {selectionBounds && selectedRegions.length > 0 ? (
              <>
                <button 
                  onClick={(e) => { e.stopPropagation(); if (onSelection) onSelection(null); }}
                  className="flex gap-1 items-center text-indigo-600 hover:bg-indigo-100 px-2 py-0.5 rounded transition-colors"
                  title="Auswahl aufheben"
                >
                  <span className="text-[16px]">✕</span> <span className="text-sm">AUSWAHL:</span>
                </button>
                <span className="flex gap-1 items-center"><span className="text-blue-600 text-[16px]">↔</span> <span className="text-sm text-slate-700">{selectedDistance.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}km</span></span>
                <span className="flex gap-1 items-center"><span className="text-emerald-600 text-[16px]">▲</span> <span className="text-sm text-slate-700">{selectedAscent.toLocaleString('de-DE', { maximumFractionDigits: 0 })}m</span></span>
                <span className="flex gap-1 items-center"><span className="text-rose-600 text-[16px]">▼</span> <span className="text-sm text-slate-700">{selectedDescent.toLocaleString('de-DE', { maximumFractionDigits: 0 })}m</span></span>
                {selectionElapsedSecs > 0 && (
                  <span className="flex gap-1 items-center"><span className="text-amber-600 text-[16px]">⚡</span> <span className="text-sm text-slate-700">{(selectedEnergy / selectionElapsedSecs).toLocaleString('de-DE', { maximumFractionDigits: 0 })}W</span></span>
                )}
                {showSelectedSurfaceStats && selectedSurfaceStats.length > 0 && (
                  <div className="flex items-center gap-2 ml-2 pl-2 border-l border-slate-200">
                    <span className="text-slate-400">UNTERGRUND:</span>
                    <div className="flex flex-col gap-1 w-48">
                      <div className="flex h-1.5 w-full rounded-full overflow-hidden bg-slate-200 dark:bg-slate-800">
                        {selectedSurfaceStats.map((surface, idx) => {
                          const totalDist = selectedSurfaceStats.reduce((sum, s) => sum + s.distance, 0) || 1;
                          const pct = (surface.distance / totalDist) * 100;
                          const getSurfColor = (s: string) => {
                            switch (s) {
                              case "Asphalt": return "#2563eb"; // Royal Blue
                              case "Schotter": return "#d97706"; // Amber
                              case "Waldweg": return "#16a34a"; // Forest Green
                              case "Fahrradweg": return "#0284c7"; // Sky Blue
                              case "Kopfsteinpflaster": return "#78350f"; // Brown
                              case "Straße": return "#4f46e5"; // Indigo
                              default: return "#64748b"; // Slate
                            }
                          };
                          return (
                            <div 
                              key={idx} 
                              style={{ width: `${pct}%`, backgroundColor: getSurfColor(surface.type) }} 
                              title={`${surface.type} (${pct.toFixed(1)}%)`} 
                            />
                          );
                        })}
                      </div>
                      <div className="flex flex-wrap gap-x-2 gap-y-0.5">
                        {selectedSurfaceStats.map((surface, idx) => {
                          const getSurfColor = (s: string) => {
                            switch (s) {
                              case "Asphalt": return "#2563eb";
                              case "Schotter": return "#d97706";
                              case "Waldweg": return "#16a34a";
                              case "Fahrradweg": return "#0284c7";
                              case "Kopfsteinpflaster": return "#78350f";
                              case "Straße": return "#4f46e5";
                              default: return "#64748b";
                            }
                          };
                          return (
                            <span key={idx} className="text-[10px] text-slate-700 font-mono flex items-center gap-1">
                              <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: getSurfColor(surface.type) }}></span>
                              {surface.type}: {surface.distance.toLocaleString('de-DE', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}km
                            </span>
                          );
                        })}
                      </div>
                    </div>
                    <button 
                      onClick={(e) => { e.stopPropagation(); setShowSelectedSurfaceStats(false); }}
                      className="ml-1 text-slate-400 hover:text-slate-600 transition-colors"
                      title="Ausblenden"
                    >
                      ✕
                    </button>
                  </div>
                )}
              </>
            ) : (
              <div className="flex flex-wrap items-center gap-1.5 text-xs font-bold font-mono">
                <span className="flex items-center gap-1 bg-emerald-50 dark:bg-emerald-950/50 text-emerald-800 dark:text-emerald-200 px-2 py-0.5 rounded-lg border border-emerald-200/80 dark:border-emerald-800/60 font-medium">
                  <span className="text-[10px] text-emerald-600 font-bold">▲</span>
                  <span>{track.ascent.toFixed(0)}m</span>
                  <span className="text-[10px] text-emerald-600 dark:text-emerald-400 font-bold font-sans ml-0.5">Anstieg</span>
                </span>
                <span className="flex items-center gap-1 bg-rose-50 dark:bg-rose-950/50 text-rose-800 dark:text-rose-200 px-2 py-0.5 rounded-lg border border-rose-200/80 dark:border-rose-800/60 font-medium">
                  <span className="text-[10px] text-rose-600 font-bold">▼</span>
                  <span>{track.descent.toFixed(0)}m</span>
                  <span className="text-[10px] text-rose-600 dark:text-rose-400 font-bold font-sans ml-0.5">Abstieg</span>
                </span>
                <span className="flex items-center gap-1 bg-indigo-50 dark:bg-indigo-950/50 text-indigo-800 dark:text-indigo-200 px-2 py-0.5 rounded-lg border border-indigo-200/80 dark:border-indigo-800/60 font-medium">
                  <span className="text-[10px] text-indigo-600 dark:text-indigo-400 font-bold font-sans">Höhe:</span>
                  <span>{minEle.toFixed(0)}m – {maxEle.toFixed(0)}m</span>
                </span>
                <span className="flex items-center gap-1 bg-amber-50 dark:bg-amber-950/50 text-amber-800 dark:text-amber-200 px-2 py-0.5 rounded-lg border border-amber-200/80 dark:border-amber-800/60 font-medium">
                  <span className="text-[10px] text-amber-600 dark:text-amber-400 font-bold font-sans">Max. Steigung:</span>
                  <span>{(track.maxSlope ?? 0).toFixed(1)}%</span>
                </span>
                {gradientAnomalies.length > 0 && (
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => {
                        setShowGradientWarnings(true);
                        setActiveAnomalyId(gradientAnomalies[0].id);
                      }}
                      className="flex items-center gap-1 bg-rose-50 dark:bg-rose-950/50 text-rose-700 dark:text-rose-300 px-2 py-0.5 rounded-lg border border-rose-300/80 dark:border-rose-800/60 font-medium hover:bg-rose-100 transition-colors cursor-pointer"
                      title="Klicken, um die erste Steigungsanomalie hervorzuheben"
                    >
                      <AlertTriangle className="w-3 h-3 text-rose-500 shrink-0" />
                      <span>{gradientAnomalies.length} Daten-Anomalie{gradientAnomalies.length > 1 ? 'n' : ''}</span>
                    </button>
                    {onRepairAnomalies && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          onRepairAnomalies(track.id);
                        }}
                        className="flex items-center gap-1 bg-rose-600 hover:bg-rose-700 text-white px-2 py-0.5 rounded-lg font-bold text-[10px] shadow-sm transition-colors cursor-pointer"
                        title="Alle Steigungsanomalien und GPS-Höhensprünge automatisch korrigieren"
                      >
                        <Wrench className="w-2.5 h-2.5" />
                        <span>Auto-Reparieren</span>
                      </button>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
      
      <div ref={containerRef} className="flex-1 min-h-0 relative">
        <svg 
          ref={svgRef}
          viewBox={`0 0 ${width} ${height}`} 
          className={`w-full h-full overflow-visible ${dragStartX !== null ? 'cursor-ew-resize' : 'cursor-crosshair'}`}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleMouseUp}
          onMouseLeave={() => {
            setHoverInfo(null);
            if (onHoverPoint) onHoverPoint(null);
            handleMouseUp();
          }}
        >
          <defs>
            <linearGradient id={`grad-${track.id}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={displayTrackColor} stopOpacity="0.4" />
              <stop offset="100%" stopColor={displayTrackColor} stopOpacity="0.05" />
            </linearGradient>
            {profileData.hasPower && (
              <linearGradient id={`power-gradient-${track.id}`} gradientUnits="userSpaceOnUse" x1="0" y1={height - padding.bottom} x2="0" y2={padding.top}>
                {powerStops}
              </linearGradient>
            )}
            <filter id="shadow">
              <feDropShadow dx="0" dy="1" stdDeviation="1" floodOpacity="0.2"/>
            </filter>
            {/* Warning stripe pattern for impossible gradients / bad elevation anomalies */}
            <pattern id="warning-stripe" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
              <rect width="4" height="8" fill="#f43f5e" opacity="0.35" />
              <rect x="4" width="4" height="8" fill="#fda4af" opacity="0.1" />
            </pattern>
          </defs>
          
          {/* Horizontal Grid & Y-Axis Elevation Labels */}
          {(() => {
            const count = 4;
            const step = eleRange / (count - 1);
            const ticks = [];
            for (let i = 0; i < count; i++) {
              const val = minEle + i * step;
              const y = height - padding.bottom - ((val - minEle) / eleRange) * graphHeight;
              ticks.push({ val, y });
            }
            return ticks.map((tick, i) => (
              <g key={`y-grid-${i}`}>
                <line 
                  x1={padding.left} 
                  y1={tick.y} 
                  x2={width - padding.right} 
                  y2={tick.y} 
                  stroke="rgba(203, 213, 225, 0.5)" 
                  strokeWidth="1" 
                  strokeDasharray={i === 0 ? undefined : "3 3"} 
                />
                <rect 
                  x={2} 
                  y={tick.y - 7} 
                  width={padding.left - 6} 
                  height={14} 
                  rx="4" 
                  fill="rgba(248, 250, 252, 0.95)" 
                  className="dark:fill-slate-900/95" 
                />
                <text 
                  x={padding.left - 6} 
                  y={tick.y + 3.5} 
                  textAnchor="end" 
                  className="text-[10px] font-black font-mono fill-slate-800 dark:fill-slate-100"
                >
                  {Math.round(tick.val)}m
                </text>
              </g>
            ));
          })()}
          
          {/* Selection Highlights */}
          {selectedRegions.map((region, i) => (
            <rect 
              key={i}
              x={region.startX}
              y={padding.top}
              width={Math.max(2, region.endX - region.startX)}
              height={graphHeight}
              fill="#4f46e5"
              opacity="0.15"
            />
          ))}

          {/* Visual Warning Overlay for Impossible Gradient / Bad Summit Segments */}
          {showGradientWarnings && gradientAnomalies.map((anomaly) => {
            const startX = padding.left + (anomaly.startDistKm / profileData.distRange) * graphWidth;
            const endX = padding.left + (anomaly.endDistKm / profileData.distRange) * graphWidth;
            const segWidth = Math.max(8, endX - startX);
            const isSelected = activeAnomalyId === anomaly.id;

            return (
              <g key={`overlay-${anomaly.id}`} className="transition-opacity">
                {/* Background warning shaded zone */}
                <rect 
                  x={startX}
                  y={padding.top}
                  width={segWidth}
                  height={graphHeight}
                  fill="url(#warning-stripe)"
                  className="cursor-pointer"
                  onClick={(e) => {
                    e.stopPropagation();
                    setActiveAnomalyId(isSelected ? null : anomaly.id);
                    if (onHoverPoint && track.points[anomaly.peakIndex]) {
                      onHoverPoint(track.points[anomaly.peakIndex]);
                    }
                  }}
                />
                {/* Border highlight around anomalous column */}
                <rect 
                  x={startX}
                  y={padding.top}
                  width={segWidth}
                  height={graphHeight}
                  fill="none"
                  stroke={isSelected ? "#e11d48" : "#f43f5e"}
                  strokeWidth={isSelected ? "2" : "1"}
                  strokeDasharray="4 2"
                  opacity={isSelected ? "1" : "0.75"}
                  className="pointer-events-none"
                />
              </g>
            );
          })}

          {/* Filled Path */}
          {showElevation && <path d={areaPath} fill={`url(#grad-${track.id})`} />}
          
          {/* Elevation Line */}
          {showElevation && (
            <polyline
              fill="none"
              stroke={displayTrackColor}
              strokeWidth="2.5"
              strokeLinejoin="round"
              strokeLinecap="round"
              points={points}
            />
          )}

          {/* Power Line */}
          {showPower && profileData.hasPower && (() => {
            const powerPoints = profileData.data
              .filter(d => d.displayPower !== undefined)
              .map(d => {
                const px = padding.left + (d.dist / profileData.distRange) * graphWidth;
                const py = height - padding.bottom - ((d.displayPower! - profileData.minPower) / profileData.powerRange) * graphHeight;
                return `${px},${py}`;
              })
              .join(' ');

            return (
              <polyline
                fill="none"
                stroke={`url(#power-gradient-${track.id})`}
                strokeWidth="2.5"
                strokeLinejoin="round"
                strokeLinecap="round"
                points={powerPoints}
                opacity="1"
              />
            );
          })()}

          {/* Heart Rate Line */}
          {showHr && profileData.hasHr && (() => {
            const hrPoints = profileData.data
              .filter(d => d.hr !== undefined)
              .map(d => {
                const px = padding.left + (d.dist / profileData.distRange) * graphWidth;
                const py = height - padding.bottom - ((d.hr! - profileData.minHr) / profileData.hrRange) * graphHeight;
                return `${px},${py}`;
              })
              .join(' ');

            return (
              <polyline
                fill="none"
                stroke="rgba(239, 68, 68, 0.5)" // Red with opacity
                strokeWidth="1.5"
                strokeLinejoin="round"
                strokeLinecap="round"
                points={hrPoints}
              />
            );
          })()}

          {/* Slope Line & 0% Baseline */}
          {showSlope && (() => {
            const yZero = height - padding.bottom - ((0 - profileData.slopeMinLimit) / profileData.slopeRange) * graphHeight;
            const slopePoints = profileData.data
              .map(d => {
                const px = padding.left + (d.dist / profileData.distRange) * graphWidth;
                const py = height - padding.bottom - ((d.slope - profileData.slopeMinLimit) / profileData.slopeRange) * graphHeight;
                return `${px},${py}`;
              })
              .join(' ');

            return (
              <g>
                <line 
                  x1={padding.left} 
                  y1={yZero} 
                  x2={width - padding.right} 
                  y2={yZero} 
                  stroke="rgba(139, 92, 246, 0.3)" 
                  strokeWidth="1" 
                  strokeDasharray="3 3" 
                />
                <polyline
                  fill="none"
                  stroke="rgba(139, 92, 246, 0.8)" 
                  strokeWidth="1.5"
                  strokeLinejoin="round"
                  strokeLinecap="round"
                  points={slopePoints}
                />
              </g>
            );
          })()}

          {/* Speed Line */}
          {showSpeed && profileData.hasSpeed && (() => {
            const speedPoints = profileData.data
              .filter(d => d.speed !== undefined)
              .map(d => {
                const px = padding.left + (d.dist / profileData.distRange) * graphWidth;
                const py = height - padding.bottom - ((d.speed! - profileData.minSpeedVal) / profileData.speedRange) * graphHeight;
                return `${px},${py}`;
              })
              .join(' ');

            return (
              <polyline
                fill="none"
                stroke="rgba(20, 184, 166, 0.75)" // Teal
                strokeWidth="1.5"
                strokeLinejoin="round"
                strokeLinecap="round"
                points={speedPoints}
              />
            );
          })()}

          {/* Cadence Line */}
          {showCadence && profileData.hasCadence && (() => {
            const cadencePoints = profileData.data
              .filter(d => d.cadence !== undefined)
              .map(d => {
                const px = padding.left + (d.dist / profileData.distRange) * graphWidth;
                const py = height - padding.bottom - ((d.cadence! - profileData.minCadenceVal) / profileData.cadenceRange) * graphHeight;
                return `${px},${py}`;
              })
              .join(' ');

            return (
              <polyline
                fill="none"
                stroke="rgba(168, 85, 247, 0.75)" // Purple
                strokeWidth="1.5"
                strokeLinejoin="round"
                strokeLinecap="round"
                points={cadencePoints}
              />
            );
          })()}

          {/* Selected Polylines */}
          {selectedPolylines.map((pts, i) => (
            <polyline
              key={`sel-${i}`}
              fill="none"
              stroke="#4f46e5"
              strokeWidth="4"
              strokeLinejoin="round"
              strokeLinecap="round"
              points={pts}
            />
          ))}

          {/* Active Drag Rectangle */}
          {dragStartX !== null && dragCurrentX !== null && (
            <rect
              x={Math.min(dragStartX, dragCurrentX)}
              y={padding.top}
              width={Math.abs(dragStartX - dragCurrentX)}
              height={graphHeight}
              fill="#4f46e5"
              opacity="0.3"
            />
          )}

          {/* Special Marker for Max POSITIVE Slope */}
          {showElevation && maxPosSlopeVal > 0 && (
            <g>
              <circle 
                cx={maxSlopeX} 
                cy={maxSlopeY} 
                r="5" 
                fill="#10b981" 
                stroke="white" 
                strokeWidth="2"
                className="animate-pulse"
                style={{ filter: 'drop-shadow(0px 0px 3px rgba(16,185,129,0.6))' }}
              />
            </g>
          )}

          {/* Special Marker for Max Elevation */}
          {showElevation && (
            <g>
              <circle 
                cx={maxEleX} 
                cy={maxEleY} 
                r="5" 
                fill="#ef4444" 
                stroke="white" 
                strokeWidth="2"
                className="animate-pulse"
                style={{ filter: 'drop-shadow(0px 0px 3px rgba(239,68,68,0.6))' }}
              />
            </g>
          )}

          {/* Anomaly Indicator Markers on the Elevation Profile */}
          {showGradientWarnings && gradientAnomalies.map((anomaly) => {
            const peakPoint = profileData.data[anomaly.peakIndex] || profileData.data[anomaly.startIndex];
            const peakDist = peakPoint ? peakPoint.dist : anomaly.startDistKm;
            const x = padding.left + (peakDist / profileData.distRange) * graphWidth;
            const y = height - padding.bottom - ((anomaly.peakEle - minEle) / eleRange) * graphHeight;
            const isSelected = activeAnomalyId === anomaly.id;

            return (
              <g 
                key={`anomaly-marker-${anomaly.id}`}
                className="cursor-pointer group select-none"
                onClick={(e) => {
                  e.stopPropagation();
                  setActiveAnomalyId(isSelected ? null : anomaly.id);
                  if (onHoverPoint && track.points[anomaly.peakIndex]) {
                    onHoverPoint(track.points[anomaly.peakIndex]);
                  }
                }}
              >
                {/* Vertical dash line pointing to the anomaly */}
                <line 
                  x1={x} 
                  y1={padding.top + 2} 
                  x2={x} 
                  y2={y} 
                  stroke="#e11d48" 
                  strokeWidth={isSelected ? "2" : "1.2"} 
                  strokeDasharray="2 2"
                  opacity={isSelected ? "1" : "0.7"}
                />

                {/* Glowing warning circle on the peak anomaly point */}
                <circle 
                  cx={x} 
                  cy={y} 
                  r={isSelected ? "6.5" : "5"} 
                  fill="#f43f5e" 
                  stroke="#ffffff" 
                  strokeWidth="2"
                  className="animate-pulse"
                  style={{ filter: 'drop-shadow(0px 0px 4px rgba(244,63,94,0.8))' }}
                />
              </g>
            );
          })}

          {/* Segment Starts & POI Markers on SVG Profile (Guidelines & Dots) */}
          {profileMarkers.map((m, idx) => {
            const x = padding.left + (m.dist / profileData.distRange) * graphWidth;
            const y = height - padding.bottom - ((m.ele - minEle) / eleRange) * graphHeight;
            const isSelected = activeMarkerId === m.id;

            return (
              <g 
                key={m.id} 
                className="cursor-pointer group select-none"
                onClick={(e) => {
                  e.stopPropagation();
                  setActiveMarkerId(isSelected ? null : m.id);
                  if (onHoverPoint && track.points[m.index]) {
                    onHoverPoint(track.points[m.index]);
                  }
                }}
                onMouseEnter={() => {
                  if (onHoverPoint && track.points[m.index]) {
                    onHoverPoint(track.points[m.index]);
                  }
                }}
              >
                {/* Vertical guide line */}
                <line 
                  x1={x} 
                  y1={padding.top + 8} 
                  x2={x} 
                  y2={y} 
                  stroke={m.color} 
                  strokeWidth={isSelected ? "2" : "1.2"} 
                  strokeDasharray="3 2" 
                  opacity={isSelected ? "1" : "0.75"} 
                />

                {/* Dot at elevation curve */}
                <circle 
                  cx={x} 
                  cy={y} 
                  r={isSelected ? "6" : "4"} 
                  fill={m.color} 
                  stroke="white" 
                  strokeWidth="2" 
                  className={isSelected ? "animate-ping opacity-75" : "group-hover:scale-125 transition-transform"}
                />
                <circle 
                  cx={x} 
                  cy={y} 
                  r={isSelected ? "5" : "3.5"} 
                  fill={m.color} 
                  stroke="white" 
                  strokeWidth="1.5" 
                />
              </g>
            );
          })}

          {/* Distance Ticks */}
          {(() => {
            const getTickInterval = (range: number) => {
              const roughStep = range / 8;
              const magnitude = Math.pow(10, Math.floor(Math.log10(roughStep || 1)));
              const normalizedStep = roughStep / magnitude;
              
              let step;
              if (normalizedStep < 1.5) step = 1;
              else if (normalizedStep < 3) step = 2;
              else if (normalizedStep < 7) step = 5;
              else step = 10;
              
              return step * magnitude;
            };
            
            const tickInterval = getTickInterval(distRange);
            const ticks = [];
            for (let d = 0; d <= distRange; d += tickInterval) {
              ticks.push(d);
            }
            if (distRange - ticks[ticks.length - 1] > tickInterval * 0.2) {
              ticks.push(distRange);
            }

            return ticks.map((d, i) => {
              const x = padding.left + (d / distRange) * graphWidth;
              
              let timeStr = "";
              if (profileData.duration) {
                const timeAtDist = (d / distRange) * profileData.duration;
                if (baseDate) {
                  const t = new Date(baseDate.getTime() + timeAtDist * 1000);
                  timeStr = t.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
                } else if (profileData.hasTimestamps && track.points[0].time) {
                  const t = new Date(track.points[0].time.getTime() + timeAtDist * 1000);
                  timeStr = t.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
                } else {
                  const h = Math.floor(timeAtDist / 3600);
                  const m = Math.floor((timeAtDist % 3600) / 60);
                  timeStr = `+${h}h ${m}m`;
                }
              }

              return (
                <g key={i}>
                  <line x1={x} y1={height - padding.bottom} x2={x} y2={height - padding.bottom + 4} stroke="currentColor" className="text-slate-300 dark:text-slate-700" strokeWidth="1" />
                  <text x={x} y={height - 14} textAnchor="middle" className="text-[10px] fill-slate-600 dark:fill-slate-300 font-mono font-bold select-none">
                    {d.toFixed(d % 1 === 0 ? 0 : 1)}
                  </text>
                  {timeStr && (
                    <text x={x} y={height - 4} textAnchor="middle" className="text-[8.5px] fill-blue-600 dark:fill-blue-400 font-mono font-semibold select-none">
                      {timeStr}
                    </text>
                  )}
                </g>
              );
            });
          })()}
          {/* Distance Axis Label */}
          <text x={width / 2} y={height - 2} textAnchor="middle" className="text-[9px] fill-slate-400 dark:fill-slate-500 font-semibold select-none">Entfernung (km) / Zeit</text>

          {/* Interaction Tooltip (Mouse Hover) */}
          {hoverInfo && (
            <g>
              <line 
                x1={hoverInfo.x} 
                y1={padding.top} 
                x2={hoverInfo.x} 
                y2={height - padding.bottom} 
                stroke="#64748b" 
                strokeWidth="1" 
                strokeDasharray="4 2" 
              />
              <circle 
                cx={hoverInfo.x} 
                cy={hoverInfo.y} 
                r="5" 
                fill="white" 
                stroke={track.color} 
                strokeWidth="2" 
                filter="url(#shadow)"
              />
              
              {(() => {
                const hasPower = hoverInfo.power !== undefined && showPower;
                const hasHr = hoverInfo.hr !== undefined && showHr;
                const hasTime = hoverInfo.time !== undefined;
                const hasSpeed = hoverInfo.speed !== undefined && showSpeed;
                const hasCadence = hoverInfo.cadence !== undefined && showCadence;
                
                // Let's compute custom layout rows dynamically
                const rows: { label: string; val: string; color: string }[] = [];
                
                // height is always shown
                rows.push({
                  label: "Höhe:",
                  val: `${hoverInfo.ele.toLocaleString('de-DE', { maximumFractionDigits: 0 })} m`,
                  color: "fill-slate-400"
                });
                
                if (hasPower) {
                  rows.push({
                    label: "Leistung:",
                    val: `${hoverInfo.power!.toLocaleString('de-DE', { maximumFractionDigits: 0 })} W`,
                    color: "fill-amber-400"
                  });
                }
                
                if (hasHr) {
                  rows.push({
                    label: "HF (Herzfrequenz):",
                    val: `${hoverInfo.hr!.toLocaleString('de-DE', { maximumFractionDigits: 0 })} bpm`,
                    color: "fill-rose-500"
                  });
                }
                
                if (hasSpeed) {
                  rows.push({
                    label: track.activityType === 'running' ? "Pace:" : "Tempo:",
                    val: track.activityType === 'running'
                      ? getPaceString(hoverInfo.speed!)
                      : `${hoverInfo.speed!.toLocaleString('de-DE', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} km/h`,
                    color: "fill-teal-400"
                  });
                }
                
                if (hasCadence) {
                  rows.push({
                    label: "Trittfrequenz:",
                    val: `${hoverInfo.cadence!.toLocaleString('de-DE', { maximumFractionDigits: 0 })} rpm`,
                    color: "fill-purple-400"
                  });
                }
                
                // compute base clock / time row
                let timeVal = "";
                if (baseDate) {
                  const startGPXTime = track.points.find(p => p.time !== undefined)?.time;
                  const elapsedSecs = (hasTime && startGPXTime)
                    ? (new Date(hoverInfo.time!).getTime() - new Date(startGPXTime).getTime()) / 1000
                    : (hoverInfo.dist / estimatedSpeed) * 3600;
                  const finalTime = new Date(baseDate.getTime() + elapsedSecs * 1000);
                  timeVal = finalTime.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
                } else if (hasTime) {
                  timeVal = new Date(hoverInfo.time!).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
                } else {
                  timeVal = `+${Math.floor((hoverInfo.dist / estimatedSpeed))}h ${Math.floor(((hoverInfo.dist / estimatedSpeed) * 60) % 60)}m`;
                }
                
                rows.push({
                  label: "Zeit:",
                  val: timeVal,
                  color: "fill-blue-400"
                });

                // Calculate dynamic box dimensions
                const rowHeight = 16;
                let boxHeight = 44 + rows.length * rowHeight; // Padding header (44px) + rows height
                
                const boxWidth = 145;
                const isLeftEdge = hoverInfo.x < boxWidth + 20;
                const tooltipX = isLeftEdge ? hoverInfo.x + 15 : hoverInfo.x - boxWidth - 15;
                const tooltipY = Math.max(padding.top, Math.min(height - padding.bottom - boxHeight, hoverInfo.y - boxHeight / 2));
                
                return (
                  <g className="transition-all duration-75">
                    {/* Tooltip Background */}
                    <rect 
                      x={tooltipX} 
                      y={tooltipY} 
                      width={boxWidth} 
                      height={boxHeight} 
                      rx="8" 
                      fill="rgba(15, 23, 42, 0.95)" 
                      stroke="rgba(255, 255, 255, 0.1)"
                      filter="url(#shadow)"
                    />
                    
                    {/* Tooltip Header: Distance */}
                    <text 
                      x={tooltipX + 10} 
                      y={tooltipY + 18} 
                      className="text-[11px] font-bold fill-white font-mono"
                    >
                      {hoverInfo.dist.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} km
                    </text>
                    <text 
                      x={tooltipX + boxWidth - 10} 
                      y={tooltipY + 18} 
                      textAnchor="end"
                      className={`text-[10px] font-bold font-mono ${hoverInfo.slope > 0 ? 'fill-emerald-400' : hoverInfo.slope < 0 ? 'fill-rose-400' : 'fill-slate-400'}`}
                    >
                      {hoverInfo.slope.toLocaleString('de-DE', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%
                    </text>

                    {/* Divider */}
                    <line 
                      x1={tooltipX + 8} 
                      y1={tooltipY + 24} 
                      x2={tooltipX + boxWidth - 8} 
                      y2={tooltipY + 24} 
                      stroke="rgba(255, 255, 255, 0.1)" 
                      strokeWidth="1" 
                    />

                    {/* Data Rows */}
                    <g transform={`translate(${tooltipX + 10}, ${tooltipY + 38})`}>
                      {rows.map((row, idx) => (
                        <g key={idx} transform={`translate(0, ${idx * rowHeight})`}>
                          <text className={`text-[10px] ${row.color}`}>{row.label}</text>
                          <text x={boxWidth - 20} textAnchor="end" className="text-[10px] font-bold fill-white">
                            {row.val}
                          </text>
                        </g>
                      ))}
                    </g>

                    {/* Tooltip Arrow */}
                    <path 
                      d={isLeftEdge ? `M${tooltipX},${hoverInfo.y} L${tooltipX + 6},${hoverInfo.y - 4} L${tooltipX + 6},${hoverInfo.y + 4} Z` : `M${tooltipX + boxWidth},${hoverInfo.y} L${tooltipX + boxWidth - 6},${hoverInfo.y - 4} L${tooltipX + boxWidth - 6},${hoverInfo.y + 4} Z`}
                      fill="rgba(15, 23, 42, 0.95)"
                    />
                  </g>
                );
              })()}
            </g>
          )}

          {/* External Hover Point (From Map) */}
          {!hoverInfo && hoveredPoint && (
            (() => {
              let closestIdx = 0;
              let minDiff = Infinity;
              for (let i = 0; i < data.length; i++) {
                const diff = Math.abs(data[i].lat - hoveredPoint.lat) + Math.abs(data[i].lng - hoveredPoint.lng);
                if (diff < minDiff) {
                  minDiff = diff;
                  closestIdx = i;
                }
              }
              const point = data[closestIdx];
              const x = (point.dist / distRange) * graphWidth + padding.left;
              const y = height - padding.bottom - ((point.ele - minEle) / eleRange) * graphHeight;

              return (
                <g>
                  <line 
                    x1={x} 
                    y1={padding.top} 
                    x2={x} 
                    y2={height - padding.bottom} 
                    stroke="#10b981" 
                    strokeWidth="1" 
                    strokeDasharray="4 2" 
                  />
                  <circle 
                    cx={x} 
                    cy={y} 
                    r="5" 
                    fill="#10b981" 
                    stroke="white" 
                    strokeWidth="2" 
                    filter="url(#shadow)"
                  />
                </g>
              );
            })()
          )}
        </svg>

        {/* HTML Badges & Interactive Tag Overlay for 100% Unstretched, Crisp Typography */}
        <div className="absolute inset-0 pointer-events-none overflow-hidden z-10 select-none">
          {/* Special Marker Tag: Max Positive Slope */}
          {showElevation && maxPosSlopeVal > 0 && (
            <div 
              className="absolute pointer-events-auto -translate-x-1/2 -translate-y-full flex items-center px-2 py-0.5 rounded-full text-[9px] font-mono font-bold text-white bg-emerald-600 border border-white shadow-sm whitespace-nowrap"
              style={{
                left: `${maxSlopeX}px`,
                top: `${maxSlopeY - 6}px`
              }}
            >
              Steigung: {maxPosSlopeVal.toFixed(1)}%
            </div>
          )}

          {/* Special Marker Tag: Max Elevation */}
          {showElevation && (
            <div 
              className="absolute pointer-events-auto -translate-x-1/2 -translate-y-full flex items-center px-2 py-0.5 rounded-full text-[9px] font-mono font-bold text-white bg-red-600 border border-white shadow-sm whitespace-nowrap"
              style={{
                left: `${maxEleX}px`,
                top: `${maxEleY - 6}px`
              }}
            >
              Höchster Ort: {Math.round(maxEle)}m
            </div>
          )}

          {/* Climb Starts (Anstieg) & Summits (Gipfel) & POI Badges */}
          {profileMarkers.map((m, idx) => {
            const x = padding.left + (m.dist / profileData.distRange) * graphWidth;
            const prevM = idx > 0 ? profileMarkers[idx - 1] : null;
            const prevX = prevM ? padding.left + (prevM.dist / profileData.distRange) * graphWidth : -999;
            const isClose = Math.abs(x - prevX) < 70;
            const yOffset = isClose ? (idx % 2 === 1 ? -16 : 0) : 0;
            const isSelected = activeMarkerId === m.id;

            return (
              <button
                key={m.id}
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setActiveMarkerId(isSelected ? null : m.id);
                  if (onHoverPoint && track.points[m.index]) {
                    onHoverPoint(track.points[m.index]);
                  }
                  if (m.type === 'climb-start' || m.type === 'climb-end') {
                    const match = m.id.match(/climb-(?:start|end)-(\d+)/);
                    if (match && track.climbs) {
                      const cIdx = parseInt(match[1], 10);
                      const climb = track.climbs[cIdx];
                      if (climb && onSelection) {
                        const climbPts = track.points.slice(climb.startIndex, climb.endIndex + 1);
                        if (climbPts.length > 0) {
                          const lats = climbPts.map(p => p.lat);
                          const lngs = climbPts.map(p => p.lng);
                          const minLat = Math.min(...lats);
                          const maxLat = Math.max(...lats);
                          const minLng = Math.min(...lngs);
                          const maxLng = Math.max(...lngs);
                          const latBuf = Math.max((maxLat - minLat) * 0.1, 0.002);
                          const lngBuf = Math.max((maxLng - minLng) * 0.1, 0.002);
                          onSelection({
                            minLat: minLat - latBuf,
                            maxLat: maxLat + latBuf,
                            minLng: minLng - lngBuf,
                            maxLng: maxLng + lngBuf
                          });
                        }
                      }
                    }
                  }
                }}
                onMouseEnter={() => {
                  if (onHoverPoint && track.points[m.index]) {
                    onHoverPoint(track.points[m.index]);
                  }
                }}
                className={`absolute pointer-events-auto -translate-x-1/2 flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-sans font-bold text-white shadow-md border border-white/90 cursor-pointer transition-all ${
                  isSelected ? 'scale-110 ring-2 ring-indigo-400 z-20' : 'hover:scale-105 active:scale-95'
                }`}
                style={{
                  left: `${x}px`,
                  top: `${padding.top + yOffset}px`,
                  backgroundColor: m.color,
                  maxWidth: '130px'
                }}
                title={`${m.label}: ${m.sublabel || ''}`}
              >
                <span className="shrink-0">{m.icon}</span>
                <span className="truncate tracking-normal">{m.label}</span>
              </button>
            );
          })}

          {/* Anomaly Badges/Pills along top margin */}
          {showGradientWarnings && gradientAnomalies.map((anomaly, idx) => {
            const peakPoint = profileData.data[anomaly.peakIndex] || profileData.data[anomaly.startIndex];
            const peakDist = peakPoint ? peakPoint.dist : anomaly.startDistKm;
            const x = padding.left + (peakDist / profileData.distRange) * graphWidth;
            const isSelected = activeAnomalyId === anomaly.id;

            return (
              <button
                key={`pill-${anomaly.id}`}
                onClick={(e) => {
                  e.stopPropagation();
                  setActiveAnomalyId(isSelected ? null : anomaly.id);
                  if (onHoverPoint && track.points[anomaly.peakIndex]) {
                    onHoverPoint(track.points[anomaly.peakIndex]);
                  }
                }}
                onMouseEnter={() => {
                  if (onHoverPoint && track.points[anomaly.peakIndex]) {
                    onHoverPoint(track.points[anomaly.peakIndex]);
                  }
                }}
                className={`absolute pointer-events-auto -translate-x-1/2 flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[9px] font-sans font-black text-white shadow-md border border-white cursor-pointer transition-all ${
                  isSelected ? 'scale-110 ring-2 ring-rose-400 z-30 bg-rose-700' : 'bg-rose-500 hover:scale-105 active:scale-95'
                }`}
                style={{
                  left: `${x}px`,
                  top: `${padding.top - 20}px`
                }}
                title={anomaly.description}
              >
                <AlertTriangle className="w-2.5 h-2.5 shrink-0" />
                <span>Δ {anomaly.gradient > 0 ? '+' : ''}{Math.round(anomaly.gradient)}%</span>
              </button>
            );
          })}

          {/* Active Marker Popover Card */}
          {activeMarkerId && (() => {
            const m = profileMarkers.find(item => item.id === activeMarkerId);
            if (!m) return null;

            const x = padding.left + (m.dist / profileData.distRange) * graphWidth;
            const y = height - padding.bottom - ((m.ele - minEle) / eleRange) * graphHeight;
            const boxWidth = 200;
            const tooltipX = Math.max(8, Math.min(width - boxWidth - 8, x - boxWidth / 2));
            const tooltipY = Math.max(8, Math.min(height - 90, y - 95));
            const hasDelete = Boolean(m.originalMarkerId && onDeleteTextMarker);

            return (
              <div 
                className="absolute pointer-events-auto bg-slate-900/95 text-white p-2.5 rounded-xl border shadow-xl z-30 animate-in fade-in zoom-in-95 duration-100 flex flex-col gap-1 text-left font-sans"
                style={{
                  left: `${tooltipX}px`,
                  top: `${tooltipY}px`,
                  width: `${boxWidth}px`,
                  borderColor: m.color
                }}
                onClick={(e) => e.stopPropagation()}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5 font-extrabold text-xs">
                    <span>{m.icon}</span>
                    <span>{m.label}</span>
                  </div>
                  <button 
                    onClick={() => setActiveMarkerId(null)}
                    className="text-slate-400 hover:text-white text-xs font-bold p-0.5 cursor-pointer"
                  >
                    ✕
                  </button>
                </div>
                {m.sublabel && (
                  <p className="text-[10px] text-slate-300 font-medium leading-tight">
                    {m.sublabel}
                  </p>
                )}
                <div className="text-[10px] font-mono font-bold text-emerald-400 mt-0.5">
                  {m.dist.toFixed(2)} km · {Math.round(m.ele)}m Höhe {m.slope ? `· ${m.slope.toFixed(1)}%` : ''}
                </div>
                {hasDelete && (
                  <button
                    onClick={() => {
                      if (m.originalMarkerId && onDeleteTextMarker) {
                        onDeleteTextMarker(m.originalMarkerId);
                      }
                      setActiveMarkerId(null);
                    }}
                    className="mt-1 w-full py-1 rounded-lg bg-red-500 hover:bg-red-600 text-white font-bold text-[9.5px] transition-colors flex items-center justify-center gap-1 cursor-pointer"
                  >
                    Marker löschen 🗑️
                  </button>
                )}
              </div>
            );
          })()}

          {/* Active Anomaly Popover Card */}
          {activeAnomalyId && (() => {
            const anomaly = gradientAnomalies.find(a => a.id === activeAnomalyId);
            if (!anomaly) return null;

            const peakPoint = profileData.data[anomaly.peakIndex] || profileData.data[anomaly.startIndex];
            const peakDist = peakPoint ? peakPoint.dist : anomaly.startDistKm;
            const x = padding.left + (peakDist / profileData.distRange) * graphWidth;
            const y = height - padding.bottom - ((anomaly.peakEle - minEle) / eleRange) * graphHeight;
            const boxWidth = 230;
            const tooltipX = Math.max(8, Math.min(width - boxWidth - 8, x - boxWidth / 2));
            const tooltipY = Math.max(8, Math.min(height - 110, y - 105));

            return (
              <div 
                className="absolute pointer-events-auto bg-slate-900/95 text-white p-2.5 rounded-xl border border-rose-500 shadow-2xl z-40 animate-in fade-in zoom-in-95 duration-100 flex flex-col gap-1.5 text-left font-sans"
                style={{
                  left: `${tooltipX}px`,
                  top: `${tooltipY}px`,
                  width: `${boxWidth}px`
                }}
                onClick={(e) => e.stopPropagation()}
              >
                <div className="flex items-center justify-between border-b border-slate-700 pb-1">
                  <div className="flex items-center gap-1.5 font-black text-xs text-rose-400">
                    <AlertTriangle className="w-3.5 h-3.5 text-rose-500 shrink-0" />
                    <span>Steigungs-Anomalie</span>
                  </div>
                  <button 
                    onClick={() => setActiveAnomalyId(null)}
                    className="text-slate-400 hover:text-white text-xs font-bold p-0.5 cursor-pointer"
                  >
                    ✕
                  </button>
                </div>
                <p className="text-[10.5px] text-rose-200 font-medium leading-tight">
                  {anomaly.description}
                </p>
                <div className="bg-slate-800/80 rounded-lg p-1.5 text-[9.5px] font-mono flex flex-col gap-0.5 text-slate-300">
                  <div className="flex justify-between">
                    <span>Position:</span>
                    <span className="font-bold text-white">{anomaly.startDistKm.toFixed(2)} – {anomaly.endDistKm.toFixed(2)} km</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Höhensprung:</span>
                    <span className="font-bold text-rose-300">{anomaly.eleChangeMeters > 0 ? '+' : ''}{anomaly.eleChangeMeters}m / {anomaly.distanceMeters}m</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Berechnete Steigung:</span>
                    <span className="font-bold text-rose-400">{anomaly.gradient > 0 ? '+' : ''}{anomaly.gradient}%</span>
                  </div>
                </div>
                {onRepairAnomalies && (
                  <button
                    onClick={() => {
                      onRepairAnomalies(track.id);
                      setActiveAnomalyId(null);
                    }}
                    className="mt-1 w-full py-1.5 rounded-lg bg-rose-600 hover:bg-rose-700 text-white font-bold text-[10px] shadow-md transition-colors flex items-center justify-center gap-1.5 cursor-pointer"
                  >
                    <Wrench className="w-3 h-3" />
                    <span>Anomalie-Spitzen reparieren</span>
                  </button>
                )}
              </div>
            );
          })()}
        </div>
      </div>
    </div>
  );
};

export default ElevationProfile;
