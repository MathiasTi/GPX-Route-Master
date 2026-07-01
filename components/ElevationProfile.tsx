
import React, { useMemo, useState, useRef } from 'react';
import { GPXTrack, GPXPoint } from '../types';
import { calculateDistance, getPaceString } from '../utils/gpxUtils';

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
  onOpenVideoExport?: () => void;
  ftp: number;
  onCollapse?: () => void;
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
  onOpenVideoExport,
  ftp,
  onCollapse
}) => {
  const svgRef = useRef<SVGSVGElement>(null);
  const [hoverInfo, setHoverInfo] = useState<HoverInfo | null>(null);
  const [isSmoothed, setIsSmoothed] = useState(false);
  const [showSettingsPopover, setShowSettingsPopover] = useState(false);
  const [showElevation, setShowElevation] = useState(true);
  const [showPower, setShowPower] = useState(true);
  const [showHr, setShowHr] = useState(true);
  const [showSlope, setShowSlope] = useState(false);
  const [showSpeed, setShowSpeed] = useState(false);
  const [showCadence, setShowCadence] = useState(false);
  const [dragStartX, setDragStartX] = useState<number | null>(null);
  const [dragCurrentX, setDragCurrentX] = useState<number | null>(null);
  const [showSelectedSurfaceStats, setShowSelectedSurfaceStats] = useState(true);

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



  const profileData = useMemo(() => {
    if (!track.points || track.points.length === 0) return null;

    let totalDist = 0;
    const rawData: { dist: number; ele: number; lat: number; lng: number; power?: number; hr?: number; time?: Date; cadence?: number; speed?: number; surface?: string }[] = [];
    
    const hasElevation = track.points.some(p => p.ele !== undefined && p.ele !== null && !isNaN(Number(p.ele)));
    if (!hasElevation) return null;

    let lastValidEle = Number(track.points.find(p => p.ele !== undefined && p.ele !== null && !isNaN(Number(p.ele)))?.ele || 0);

    const firstEle = track.points[0].ele;
    rawData.push({ 
      dist: 0, 
      ele: (firstEle !== undefined && firstEle !== null && !isNaN(Number(firstEle))) ? Number(firstEle) : lastValidEle, 
      lat: track.points[0].lat, 
      lng: track.points[0].lng,
      power: track.points[0].power,
      hr: track.points[0].hr,
      time: track.points[0].time,
      cadence: track.points[0].cadence,
      speed: 0,
      surface: track.points[0].surface
    });

    for (let i = 1; i < track.points.length; i++) {
      const distStep = calculateDistance(track.points[i - 1], track.points[i]);
      totalDist += distStep;
      
      const currentEle = track.points[i].ele;
      const ele = (currentEle !== undefined && currentEle !== null && !isNaN(Number(currentEle))) ? Number(currentEle) : lastValidEle;
      if (currentEle !== undefined && currentEle !== null && !isNaN(Number(currentEle))) lastValidEle = Number(currentEle);

      // Calculate instant/interval speed if timestamps are present
      let s = 0;
      const t1 = track.points[i - 1].time;
      const t2 = track.points[i].time;
      if (t1 && t2) {
        const dt = (new Date(t2).getTime() - new Date(t1).getTime()) / 1000;
        if (dt > 0 && dt < 120) { // skip anomalies/breaks larger than 120 seconds
          s = (distStep / (dt / 3600));
        }
      }

      rawData.push({ 
        dist: totalDist, 
        ele, 
        lat: track.points[i].lat, 
        lng: track.points[i].lng,
        power: track.points[i].power,
        hr: track.points[i].hr,
        time: track.points[i].time,
        cadence: track.points[i].cadence,
        speed: s,
        surface: track.points[i].surface
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

    const minEle = Math.min(...data.map(d => d.ele));
    const maxEle = Math.max(...data.map(d => d.ele));
    const distRange = totalDist;
    const eleRange = maxEle - minEle || 1;

    // Calculate HR range
    const validHrData = data.filter(d => d.hr !== undefined).map(d => d.hr!);
    const hasHr = validHrData.length > 0;
    const minHr = hasHr ? Math.max(0, Math.min(...validHrData) - 10) : 0; // Pad bottom
    const maxHr = hasHr ? Math.max(...validHrData) + 10 : 1; // Pad top
    const hrRange = maxHr - minHr || 1;

    // Calculate Power range
    const validPowerData = data.filter(d => d.displayPower !== undefined).map(d => d.displayPower!);
    const hasPower = validPowerData.length > 0;
    const minPower = hasPower ? Math.max(0, Math.min(...validPowerData) - 10) : 0;
    const maxPower = hasPower ? Math.max(...validPowerData) + 10 : 1;
    const powerRange = maxPower - minPower || 1;

    // Calculate Speed range
    const validSpeedData = data.filter(d => d.speed !== undefined).map(d => d.speed!);
    const maxSpeedVal = hasSpeedData ? Math.max(...validSpeedData, 20) + 5 : 25;
    const minSpeedVal = 0;
    const speedRange = maxSpeedVal - minSpeedVal || 1;

    // Calculate Cadence range
    const validCadenceData = data.filter(d => d.cadence !== undefined && d.cadence > 0).map(d => d.cadence!);
    const maxCadenceVal = hasCadenceData ? Math.max(...validCadenceData, 100) + 10 : 120;
    const minCadenceVal = 0;
    const cadenceRange = maxCadenceVal - minCadenceVal || 1;

    // Calculate Slope range
    const validSlopes = data.map(d => d.slope);
    const minSlopeVal = Math.min(...validSlopes);
    const maxSlopeVal = Math.max(...validSlopes);
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
  }, [track, isSmoothed, estimatedSpeed]);

  const padding = { top: 25, bottom: 25, left: 10, right: 10 };
  const width = 1000;
  const height = 150;

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
      y
    });
    if (onHoverPoint && !isFlying) {
      const originalPoint = track.points[closestIdx];
      onHoverPoint(originalPoint);
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
      y
    });
    if (onHoverPoint && !isFlying) {
      const originalPoint = track.points[closestIdx];
      onHoverPoint(originalPoint);
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
          <div className="w-2 h-2 rounded-full shadow-sm" style={{ backgroundColor: track.color }}></div>
          <h3 className="text-xs font-bold text-slate-600 uppercase tracking-wider md:max-w-md lg:max-w-xl break-words whitespace-normal leading-tight" title={track.name}>
            {track.name}
          </h3>
        </div>
        <div className="flex items-center gap-4">
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
            <label className="flex items-center gap-1.5 cursor-pointer text-[11px] font-bold text-slate-500 hover:text-slate-700 transition-colors uppercase tracking-wider">
              <input 
                type="checkbox" 
                checked={showElevation} 
                onChange={(e) => setShowElevation(e.target.checked)}
                className="w-3.5 h-3.5 text-slate-600 rounded bg-slate-100 border-slate-300 focus:ring-slate-500 cursor-pointer"
              />
              Höhe
            </label>
            {profileData.hasPower && (
              <label className="flex items-center gap-1.5 cursor-pointer text-[11px] font-bold text-slate-500 hover:text-amber-600 transition-colors uppercase tracking-wider">
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
              <label className="flex items-center gap-1.5 cursor-pointer text-[11px] font-bold text-slate-550 hover:text-red-500 transition-colors uppercase tracking-wider">
                <input 
                  type="checkbox" 
                  checked={showHr} 
                  onChange={(e) => setShowHr(e.target.checked)}
                  className="w-3.5 h-3.5 text-red-500 rounded bg-slate-100 border-slate-300 focus:ring-red-500 cursor-pointer"
                />
                HF
              </label>
            )}
            <label className="flex items-center gap-1.5 cursor-pointer text-[11px] font-bold text-slate-500 hover:text-pink-600 transition-colors uppercase tracking-wider">
              <input 
                type="checkbox" 
                checked={showSlope} 
                onChange={(e) => setShowSlope(e.target.checked)}
                className="w-3.5 h-3.5 text-pink-500 rounded bg-slate-100 border-slate-300 focus:ring-pink-500 cursor-pointer"
              />
              Steigung
            </label>
            {profileData.hasSpeed && (
              <label className="flex items-center gap-1.5 cursor-pointer text-[11px] font-bold text-slate-500 hover:text-teal-600 transition-colors uppercase tracking-wider">
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
              <label className="flex items-center gap-1.5 cursor-pointer text-[11px] font-bold text-slate-550 hover:text-purple-600 transition-colors uppercase tracking-wider">
                <input 
                  type="checkbox" 
                  checked={showCadence} 
                  onChange={(e) => setShowCadence(e.target.checked)}
                  className="w-3.5 h-3.5 text-purple-550 rounded bg-slate-100 border-slate-300 focus:ring-purple-550 cursor-pointer"
                />
                Trittfrequenz
              </label>
            )}
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
            <label className="flex items-center gap-1.5 cursor-pointer hover:text-pink-600">
              <input 
                type="checkbox" 
                checked={showSlope} 
                onChange={(e) => setShowSlope(e.target.checked)}
                className="w-3.5 h-3.5 rounded bg-slate-100 border-slate-300 text-pink-500"
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
          </div>

          <div className="border-t border-dashed my-0.5" />

          {/* Smooth Toggle */}
          <label className="flex items-center justify-between cursor-pointer text-[10px] font-bold text-slate-500 hover:text-slate-700">
            <span>Datenwerte glätten:</span>
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
                    {selectedSurfaceStats.map((surface, idx) => (
                      <span key={idx} className="text-sm text-slate-700">
                        {surface.type} ({surface.distance.toLocaleString('de-DE', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}km)
                      </span>
                    ))}
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
              <>
                <span className="flex gap-1 items-center"><span className="text-emerald-600 text-[14px]">▲</span> <span className="text-sm text-slate-700">{track.ascent.toFixed(0)}m</span></span>
                <span className="flex gap-1 items-center"><span className="text-rose-600 text-[14px]">▼</span> <span className="text-sm text-slate-700">{track.descent.toFixed(0)}m</span></span>
                <span className="flex gap-1 items-center"><span className="text-slate-400">MAX STEIGUNG:</span> <span className="text-emerald-700 text-sm">{(track.maxSlope ?? 0).toFixed(1)}%</span></span>
                <span className="flex gap-1 items-center"><span className="text-slate-400">MIN/MAX:</span> <span className="text-slate-700 text-sm">{`${minEle.toFixed(0)}/${maxEle.toFixed(0)}`}m</span></span>
              </>
            )}
          </div>
      
      <div className="flex-1 min-h-0 relative">
        <svg 
          ref={svgRef}
          viewBox={`0 0 ${width} ${height}`} 
          className={`w-full h-full overflow-visible ${dragStartX !== null ? 'cursor-ew-resize' : 'cursor-crosshair'}`}
          preserveAspectRatio="none"
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
              <stop offset="0%" stopColor={track.color} stopOpacity="0.4" />
              <stop offset="100%" stopColor={track.color} stopOpacity="0.05" />
            </linearGradient>
            {profileData.hasPower && (
              <linearGradient id={`power-gradient-${track.id}`} gradientUnits="userSpaceOnUse" x1="0" y1={height - padding.bottom} x2="0" y2={padding.top}>
                {powerStops}
              </linearGradient>
            )}
            <filter id="shadow">
              <feDropShadow dx="0" dy="1" stdDeviation="1" floodOpacity="0.2"/>
            </filter>
          </defs>
          
          {/* Horizontal Grid */}
          <line x1={padding.left} y1={padding.top} x2={width - padding.right} y2={padding.top} stroke="#f1f5f9" strokeWidth="1" />
          <line x1={padding.left} y1={padding.top + graphHeight / 2} x2={width - padding.right} y2={padding.top + graphHeight / 2} stroke="#f8fafc" strokeWidth="1" />
          
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

          {/* Filled Path */}
          {showElevation && <path d={areaPath} fill={`url(#grad-${track.id})`} />}
          
          {/* Elevation Line */}
          {showElevation && (
            <polyline
              fill="none"
              stroke={track.color}
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
                  stroke="rgba(236, 72, 153, 0.3)" // Light pink indicator
                  strokeWidth="1" 
                  strokeDasharray="3 3" 
                />
                <polyline
                  fill="none"
                  stroke="rgba(236, 72, 153, 0.75)" // Pink
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
                r="4.5" 
                fill="#10b981" 
                stroke="white" 
                strokeWidth="1.5"
                className="animate-pulse"
                style={{ filter: 'drop-shadow(0px 0px 2px rgba(16,185,129,0.5))' }}
              />
              <text 
                x={maxSlopeX} 
                y={maxSlopeY - 10} 
                textAnchor="middle" 
                className="text-[9px] fill-emerald-700 font-bold font-mono"
              >
                Max Steigung: {maxPosSlopeVal.toFixed(1)}%
              </text>
            </g>
          )}

          {/* Special Marker for Max Elevation */}
          {showElevation && (
            <g>
              <circle 
                cx={maxEleX} 
                cy={maxEleY} 
                r="4.5" 
                fill="#ef4444" 
                stroke="white" 
                strokeWidth="1.5"
                className="animate-pulse"
                style={{ filter: 'drop-shadow(0px 0px 2px rgba(239,68,68,0.5))' }}
              />
              <text 
                x={maxEleX} 
                y={maxEleY - 10} 
                textAnchor="middle" 
                className="text-[9px] fill-red-700 font-bold font-mono"
              >
                Höchster Punkt: {maxEle.toFixed(0)}m
              </text>
            </g>
          )}

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
                  <line x1={x} y1={height - padding.bottom} x2={x} y2={height - padding.bottom + 4} stroke="#cbd5e1" strokeWidth="1" />
                  <text x={x} y={height - 14} textAnchor="middle" className="text-[9px] fill-slate-400 font-mono font-medium">
                    {d.toFixed(d % 1 === 0 ? 0 : 1)}
                  </text>
                  {timeStr && (
                    <text x={x} y={height - 4} textAnchor="middle" className="text-[8px] fill-blue-400 font-mono font-medium">
                      {timeStr}
                    </text>
                  )}
                </g>
              );
            });
          })()}
          <text x={width / 2} y={height - 2} textAnchor="middle" className="text-[8px] fill-slate-300 font-bold uppercase tracking-widest">Entfernung (km) / Zeit</text>

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
      </div>
    </div>
  );
};

export default ElevationProfile;
