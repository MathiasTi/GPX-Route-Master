
import React, { useState, useCallback, useEffect } from 'react';
import Sidebar from './components/Sidebar';
import Map from './components/Map';
import Map3D from './components/Map3D';
import ElevationProfile from './components/ElevationProfile';
import { Activity, BarChart2, Menu } from 'lucide-react';
import { GPXTrack, GPXPoint, MapLayer, TextMarker, Segment } from './types';
import { parseGPX, mergeTracks, validateGPX, calculatePowerStats, calculateDistance } from './utils/gpxUtils';
import { parseFIT } from './utils/fitUtils';
import { unzipSync } from 'fflate';
import { arrayMove } from '@dnd-kit/sortable';
import AdvancedAnalytics from './components/AdvancedAnalytics';
import { TrackComparison } from './components/TrackComparison';
import { AnimatePresence } from 'motion/react';
import { VideoExportModal } from './components/VideoExportModal';
import { WeatherOverlay } from './components/WeatherOverlay';
import { ClimbsAnalysis } from './components/ClimbsAnalysis';
import { SegmentsAnalysis } from './components/SegmentsAnalysis';
import { getFamousSegments, extractSegmentsFromTrack, generateProLeaderboard } from './utils/segmentUtils';
import { TrainingZonesAnalysis } from './components/TrainingZonesAnalysis';
import { getApiUrl } from './utils/api';

const App: React.FC = () => {
  const [tracks, setTracks] = useState<GPXTrack[]>([]);
  const [history, setHistory] = useState<GPXTrack[][]>([]);
  const [textMarkers, setTextMarkers] = useState<TextMarker[]>(() => {
    try {
      const saved = localStorage.getItem('velo_text_markers');
      return saved ? JSON.parse(saved) : [];
    } catch (e) {
      return [];
    }
  });

  // Sync with localStorage
  useEffect(() => {
    localStorage.setItem('velo_text_markers', JSON.stringify(textMarkers));
  }, [textMarkers]);

  const handleAddTextMarker = useCallback((newMarker: Omit<TextMarker, 'id'>) => {
    const marker: TextMarker = {
      ...newMarker,
      id: crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).substring(2, 11)
    };
    setTextMarkers(prev => [...prev, marker]);
  }, []);

  const handleDeleteTextMarker = useCallback((id: string) => {
    setTextMarkers(prev => prev.filter(m => m.id !== id));
  }, []);

  const handleUpdateTextMarker = useCallback((id: string, updates: Partial<TextMarker>) => {
    setTextMarkers(prev => prev.map(m => m.id === id ? { ...m, ...updates } : m));
  }, []);
  const [activeLayer, setActiveLayer] = useState<MapLayer>(MapLayer.OSM);
  const [selectionBounds, setSelectionBounds] = useState<{minLat: number, maxLat: number, minLng: number, maxLng: number} | null>(null);
  const [markedTrackId, setMarkedTrackId] = useState<string | null>(null);
  const [is3D, setIs3D] = useState(false);
  const [ftp, setFtp] = useState(250);
  const [analyticsOpen, setAnalyticsOpen] = useState(false);
  const [climbsOpen, setClimbsOpen] = useState(false);
  const [comparisonOpen, setComparisonOpen] = useState(false);
  const [trainingZonesOpen, setTrainingZonesOpen] = useState(false);
  const [weatherOpen, setWeatherOpen] = useState(false);
  const [isExportModalOpen, setIsExportModalOpen] = useState(false);
  const [mapView, setMapView] = useState({
    lat: 51.1657,
    lng: 10.4515,
    zoom: 6,
    pitch: 60,
    bearing: 0
  });
  const [hoveredPoint, setHoveredPoint] = useState<GPXPoint | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const [segmentsOpen, setSegmentsOpen] = useState(false);
  const [customSegments, setCustomSegments] = useState<Segment[]>(() => {
    try {
      const saved = localStorage.getItem('velo_custom_segments');
      if (saved) {
        return JSON.parse(saved);
      }
    } catch (e) {}
    return getFamousSegments();
  });

  const handleAddNewSegment = useCallback((name: string) => {
    const activeRoute = tracks.find(t => t.id === markedTrackId);
    if (!activeRoute || !selectionBounds) {
      setErrorMessage("Keine aktive Route oder kein Bereich auf der Karte ausgewählt, um ein Segment zu generieren!");
      return;
    }

    const { minLat, maxLat, minLng, maxLng } = selectionBounds;
    
    // Find points of the route inside bounds
    const insidePointsIndices: number[] = [];
    activeRoute.points.forEach((pt, idx) => {
      if (pt.lat >= minLat && pt.lat <= maxLat && pt.lng >= minLng && pt.lng <= maxLng) {
        insidePointsIndices.push(idx);
      }
    });

    if (insidePointsIndices.length < 2) {
      setErrorMessage("Bitte markiere einen größeren/genaueren Bereich auf der Route!");
      return;
    }

    const firstIdx = insidePointsIndices[0];
    const lastIdx = insidePointsIndices[insidePointsIndices.length - 1];

    if (firstIdx >= lastIdx) {
      setErrorMessage("Ungültige Bereichsauswahl.");
      return;
    }

    const selectedPoints = activeRoute.points.slice(firstIdx, lastIdx + 1);
    
    // Calculate segment stats
    let totalDistMeter = 0;
    let totalAscentMeter = 0;
    for (let i = 1; i < selectedPoints.length; i++) {
      const p1 = selectedPoints[i - 1];
      const p2 = selectedPoints[i];
      totalDistMeter += (p1 && p2) ? calculateDistance(p1, p2) * 1000 : 0;
      if (p2.ele !== undefined && p1.ele !== undefined) {
        const diff = p2.ele - p1.ele;
        if (diff > 0) totalAscentMeter += diff;
      }
    }

    if (totalDistMeter <= 10) {
      setErrorMessage("Das ausgewählte Segment ist zu kurz.");
      return;
    }

    const startPt = selectedPoints[0];
    const endPt = selectedPoints[selectedPoints.length - 1];
    const avgGradient = parseFloat(((totalAscentMeter / totalDistMeter) * 105).toFixed(1));

    const newSegment: Segment = {
      id: `custom-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
      name,
      startLat: startPt.lat,
      startLng: startPt.lng,
      endLat: endPt.lat,
      endLng: endPt.lng,
      distanceMeter: Math.round(totalDistMeter),
      ascentMeter: Math.round(totalAscentMeter),
      avgGradient,
      leaderboard: generateProLeaderboard(totalDistMeter, totalAscentMeter, totalAscentMeter < 15),
      isCustom: true
    };

    setCustomSegments(prev => {
      const updated = [...prev, newSegment];
      localStorage.setItem('velo_custom_segments', JSON.stringify(updated));
      return updated;
    });

    setSelectionBounds(null); // Clear selection
    setSegmentsOpen(true); // Auto-open dashboard!
  }, [tracks, markedTrackId, selectionBounds]);

  const handleDeleteSegment = useCallback((id: string) => {
    setCustomSegments(prev => {
      const updated = prev.filter(s => s.id !== id);
      localStorage.setItem('velo_custom_segments', JSON.stringify(updated));
      return updated;
    });
  }, []);

  // Auto-extract segments from newly added tracks to enrich local list
  useEffect(() => {
    if (tracks.length === 0) return;
    
    setCustomSegments(prev => {
      const existingIds = new Set(prev.map(s => s.id));
      let newlyAdded = false;
      const updated = [...prev];

      tracks.forEach(track => {
        const extracted = extractSegmentsFromTrack(track);
        extracted.forEach(seg => {
          // Prevent duplicates
          const isDup = prev.some(s => s.name === seg.name || (Math.abs(s.startLat - seg.startLat) < 0.001 && Math.abs(s.startLng - seg.startLng) < 0.001));
          if (!existingIds.has(seg.id) && !isDup) {
            updated.push(seg);
            existingIds.add(seg.id);
            newlyAdded = true;
          }
        });
      });

      if (newlyAdded) {
        localStorage.setItem('velo_custom_segments', JSON.stringify(updated));
        return updated;
      }
      return prev;
    });
  }, [tracks]);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(window.innerWidth < 768);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [isProfileCollapsed, setIsProfileCollapsed] = useState(false);
  const [userWeight, setUserWeight] = useState(75);
  const [userAge, setUserAge] = useState(35);
  const [estimatedSpeed, setEstimatedSpeed] = useState(15); // km/h
  const [selectedDate, setSelectedDate] = useState<string>(() => {
    const today = new Date();
    return today.toISOString().split('T')[0];
  });
  const [selectedTime, setSelectedTime] = useState<string>(() => {
    const today = new Date();
    const hours = String(today.getHours()).padStart(2, '0');
    const minutes = String(today.getMinutes()).padStart(2, '0');
    return `${hours}:${minutes}`;
  });
  const [isFlying, setIsFlying] = useState(false);
  const [flyProgress, setFlyProgress] = useState(0); // 0 to 1
  const [flySpeed, setFlySpeed] = useState(1); // multiplier
 
  // Recalculate power stats when FTP, weight, or estimated Speed changes
  useEffect(() => {
    setTracks(prev => prev.map(track => {
      const powerStats = calculatePowerStats(track.points, ftp, userWeight, estimatedSpeed);
      return { ...track, powerStats };
    }));
  }, [ftp, userWeight, estimatedSpeed]);

  const handleToggle3D = useCallback((mode: boolean) => {
    setIs3D(mode);
    if (mode) {
      setMapView(prev => ({ ...prev, pitch: 60 }));
    } else {
      setMapView(prev => ({ ...prev, pitch: 0, bearing: 0 }));
    }
  }, []);

  const [analyzingSurfaces, setAnalyzingSurfaces] = useState<Record<string, boolean>>({});

  const analyzeTrackSurface = useCallback(async (trackId: string) => {
    if (analyzingSurfaces[trackId]) return;

    let pointsToAnalyze: any[] = [];
    setTracks(currentTracks => {
      const track = currentTracks.find(t => t.id === trackId);
      if (track) {
        pointsToAnalyze = track.points.map(p => ({ lat: p.lat, lng: p.lng, ele: p.ele }));
      }
      return currentTracks;
    });

    if (pointsToAnalyze.length === 0) return;

    setAnalyzingSurfaces(prev => ({ ...prev, [trackId]: true }));
    try {
      const apiUrl = getApiUrl("/api/analyze-surface");

      const result = await fetch(apiUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          points: pointsToAnalyze
        })
      });

      if (!result.ok) throw new Error("Surface analyzer API error");
      const data = await result.json();

      if (data.surfaces && data.surfaceStats) {
        setTracks(prev => prev.map(t => {
          if (t.id === trackId) {
            const updatedPoints = t.points.map((p, idx) => ({
              ...p,
              surface: data.surfaces[idx] || "Asphalt"
            }));
            return {
              ...t,
              points: updatedPoints,
              surfaceStats: data.surfaceStats
            };
          }
          return t;
        }));
      }
    } catch (err) {
      console.error("[Surface Analyzer] Error for track", trackId, err);
    } finally {
      setAnalyzingSurfaces(prev => ({ ...prev, [trackId]: false }));
    }
  }, [analyzingSurfaces]);

  useEffect(() => {
    if (markedTrackId) {
      const track = tracks.find(t => t.id === markedTrackId);
      if (track && track.points.length > 0) {
        const hasSurfaces = track.points.some(p => p.surface && p.surface !== "Asphalt");
        if (!hasSurfaces && !analyzingSurfaces[markedTrackId]) {
          analyzeTrackSurface(markedTrackId);
        }
      }
    }
  }, [markedTrackId, tracks, analyzeTrackSurface, analyzingSurfaces]);
 
  // Auto-select first track if none is selected and tracks exist
  useEffect(() => {
    if (tracks.length > 0 && !markedTrackId) {
      setMarkedTrackId(tracks[0].id);
    } else if (tracks.length === 0) {
      setMarkedTrackId(null);
    }
  }, [tracks, markedTrackId]);
 
  const saveToHistory = useCallback(() => {
    setHistory(prev => [...prev, [...tracks]].slice(-10));
  }, [tracks]);
 
  const handleUndo = useCallback(() => {
    if (history.length === 0) return;
    const previousState = history[history.length - 1];
    setTracks(previousState);
    setHistory(prev => prev.slice(0, -1));
  }, [history]);
 
  const handleFileUpload = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;

    const processFitBuffer = async (buffer: ArrayBuffer, name: string) => {
      const parsed = await parseFIT(buffer, name);
      if (parsed) {
        parsed.powerStats = calculatePowerStats(parsed.points, ftp, userWeight, estimatedSpeed);
        newTracks.push(parsed);
        
        // Extract date of the FIT file
        const firstPtWithTime = parsed.points.find(p => p.time !== undefined);
        if (firstPtWithTime && firstPtWithTime.time) {
          const dt = new Date(firstPtWithTime.time);
          fitDate = dt.toISOString().split('T')[0];
          const hrs = String(dt.getHours()).padStart(2, '0');
          const mins = String(dt.getMinutes()).padStart(2, '0');
          fitTime = `${hrs}:${mins}`;
          hasAddedFit = true;
        }
      } else {
        errors.push(`${name}: Fehler beim Verarbeiten der FIT-Datei.`);
      }
    };

    const processGpxText = async (text: string, name: string) => {
      const validation = validateGPX(text);
      if (!validation.isValid) {
        errors.push(`${name}: ${validation.error}`);
        return;
      }

      const parsed = await parseGPX(text, name);
      if (parsed) {
        parsed.powerStats = calculatePowerStats(parsed.points, ftp, userWeight, estimatedSpeed);
        newTracks.push(parsed);
      } else {
        errors.push(`${name}: Fehler beim Verarbeiten der GPX-Datei.`);
      }
    };
 
    setErrorMessage(null);
    const newTracks: GPXTrack[] = [];
    const errors: string[] = [];
    
    let fitDate: string | null = null;
    let fitTime: string | null = null;
    let hasAddedFit = false;
 
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const lowerName = file.name.toLowerCase();
      const isFit = lowerName.endsWith('.fit');
      const isZip = lowerName.endsWith('.zip');

      try {
        if (isZip) {
          // Zip-Bomb Protection: limit zip file size to 30 MB
          if (file.size > 30 * 1024 * 1024) {
            errors.push(`${file.name}: ZIP-Datei ist zu groß (maximal 30 MB erlaubt).`);
            continue;
          }

          const arrayBuffer = await file.arrayBuffer();
          const zipUint8 = new Uint8Array(arrayBuffer);
          const unzipped = unzipSync(zipUint8);
          
          let totalUncompressedSize = 0;
          const MAX_UNCOMPRESSED_TOTAL = 100 * 1024 * 1024; // 100 MB max uncompressed

          for (const [filepath, fileData] of Object.entries(unzipped)) {
            // Zip-Slip (Directory Traversal) protection
            if (filepath.includes('..') || filepath.split('/').some(part => part === '..')) {
              console.warn(`Sicherheitswarnung: Pfad-Traversierung in ZIP ignoriert: ${filepath}`);
              continue;
            }

            // Decompression security: tracking total decompressed bytes to avoid exhausting memory
            totalUncompressedSize += fileData.length;
            if (totalUncompressedSize > MAX_UNCOMPRESSED_TOTAL) {
              throw new Error("Decompressions-Limit überschritten (Zip-Bomb-Schutz). Max. unkomprimierte Gesamtgröße ist 100 MB.");
            }

            const baseName = filepath.split('/').pop() || '';
            if (!baseName) continue; // skip directories

            const entryLowerName = baseName.toLowerCase();
            if (entryLowerName.endsWith('.fit')) {
              const buffer = fileData.buffer.slice(fileData.byteOffset, fileData.byteOffset + fileData.byteLength);
              await processFitBuffer(buffer, baseName);
            } else if (entryLowerName.endsWith('.gpx')) {
              const textDecoder = new TextDecoder('utf-8');
              const text = textDecoder.decode(fileData);
              await processGpxText(text, baseName);
            }
          }
        } else if (isFit) {
          const buffer = await file.arrayBuffer();
          await processFitBuffer(buffer, file.name);
        } else {
          const text = await file.text();
          await processGpxText(text, file.name);
        }
      } catch (err: any) {
        errors.push(`${file.name}: Unerwarteter Fehler (${err.message || err}).`);
        console.error(err);
      }
    }
 
    if (errors.length > 0) {
      setErrorMessage(errors.join("\n"));
      // Clear error after 5 seconds
      setTimeout(() => setErrorMessage(null), 5000);
    }
 
    if (newTracks.length > 0) {
      saveToHistory();
      setTracks(prev => [...prev, ...newTracks]);
      
      if (hasAddedFit && fitDate && fitTime) {
        setSelectedDate(fitDate);
        setSelectedTime(fitTime);
      } else {
        const today = new Date();
        const formattedDate = today.toISOString().split('T')[0];
        const hours = String(today.getHours()).padStart(2, '0');
        const minutes = String(today.getMinutes()).padStart(2, '0');
        setSelectedDate(formattedDate);
        setSelectedTime(`${hours}:${minutes}`);
      }
    }
    e.target.value = '';
  }, [saveToHistory, ftp, userWeight, estimatedSpeed, setSelectedDate, setSelectedTime]);
 
  const toggleVisibility = useCallback((id: string) => {
    setTracks(prev => prev.map(t => t.id === id ? { ...t, visible: !t.visible } : t));
  }, []);
 
  const removeTrack = useCallback((id: string) => {
    saveToHistory();
    setTracks(prev => prev.filter(t => t.id !== id));
    if (markedTrackId === id) setMarkedTrackId(null);
  }, [saveToHistory, markedTrackId]);
 
  const handleMerge = useCallback(() => {
    if (tracks.length < 2) return;
    saveToHistory();
    const merged = mergeTracks(tracks);
    merged.powerStats = calculatePowerStats(merged.points, ftp, userWeight, estimatedSpeed);
    setTracks([merged]);
    setMarkedTrackId(merged.id);
  }, [tracks, saveToHistory, ftp, userWeight, estimatedSpeed]);
 
  const handleReorder = useCallback((oldIndex: number, newIndex: number) => {
    setTracks(prev => arrayMove(prev, oldIndex, newIndex));
  }, []);
 
  const handleChangeActivityType = useCallback((id: string, type: 'cycling' | 'running') => {
    saveToHistory();
    setTracks(prev => prev.map(t => {
      if (t.id === id) {
        const powerStats = calculatePowerStats(t.points, ftp, userWeight, estimatedSpeed, type);
        return { ...t, activityType: type, powerStats };
      }
      return t;
    }));
  }, [saveToHistory, ftp, userWeight, estimatedSpeed]);

  const markedTrack = tracks.find(t => t.id === markedTrackId);
  const suggestedFtp = markedTrack?.powerStats?.best20m ? Math.round(markedTrack.powerStats.best20m * 0.95) : null;
 
  // Flyover Animation Logic
  useEffect(() => {
    let animationFrame: number;
    let lastTimestamp = 0;
    
    const animate = (timestamp: number) => {
      if (isFlying && markedTrack) {
        if (!lastTimestamp) lastTimestamp = timestamp;
        const delta = timestamp - lastTimestamp;
        lastTimestamp = timestamp;

        setFlyProgress(prev => {
          // Consistent speed: base speed increased for better scaling
          // 150km/h base provides better range up to 1500km/h at 10x
          const targetSpeedKmh = 150 * flySpeed;
          const targetSpeedKmMs = targetSpeedKmh / 3600000;
          const distanceStep = targetSpeedKmMs * delta;
          const progressStep = distanceStep / (markedTrack.distance || 1);
          
          const next = prev + progressStep;
          if (next >= 1) {
            setIsFlying(false);
            return 0;
          }
          return next;
        });
      }
      animationFrame = requestAnimationFrame(animate);
    };
    
    if (isFlying) {
      animationFrame = requestAnimationFrame(animate);
    }
    
    return () => {
      cancelAnimationFrame(animationFrame);
      lastTimestamp = 0;
    };
  }, [isFlying, markedTrack, flySpeed]);

  // Sync flyProgress to hoveredPoint
  useEffect(() => {
    if (isFlying && markedTrack && markedTrack.points.length > 0) {
      const index = Math.floor(flyProgress * (markedTrack.points.length - 1));
      const point = markedTrack.points[index];
      // Only update if the point actually changed to avoid redundant renders
      setHoveredPoint(prev => prev === point ? prev : point);
    }
  }, [flyProgress, isFlying, markedTrack]);

  const [showHint, setShowHint] = useState(false);

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-slate-100 font-sans text-slate-900">
      <Sidebar 
        tracks={tracks}
        markedTrackId={markedTrackId}
        onMarkTrack={(id) => {
          setMarkedTrackId(id);
          setIsMobileMenuOpen(false);
          setIsProfileCollapsed(false);
        }}
        onChangeActivityType={handleChangeActivityType}
        onUpload={handleFileUpload}
        onToggleVisibility={toggleVisibility}
        onRemoveTrack={removeTrack}
        onMergeSelected={handleMerge}
        onUndo={handleUndo}
        canUndo={history.length > 0}
        onReorder={handleReorder}
        activeLayer={activeLayer}
        setActiveLayer={setActiveLayer}
        is3D={is3D}
        setIs3D={handleToggle3D}
        isCollapsed={isSidebarCollapsed}
        onToggleCollapse={() => setIsSidebarCollapsed(!isSidebarCollapsed)}
        isMobileMenuOpen={isMobileMenuOpen}
        setIsMobileMenuOpen={setIsMobileMenuOpen}
        estimatedSpeed={estimatedSpeed}
        setEstimatedSpeed={setEstimatedSpeed}
        selectedDate={selectedDate}
        setSelectedDate={setSelectedDate}
        selectedTime={selectedTime}
        setSelectedTime={setSelectedTime}
        ftp={ftp}
        setFtp={setFtp}
        userWeight={userWeight}
        setUserWeight={setUserWeight}
        userAge={userAge}
        setUserAge={setUserAge}
        suggestedFtp={suggestedFtp}
        onOpenComparison={() => {
          setComparisonOpen(true);
          setIsMobileMenuOpen(false);
         }}
        onOpenTrainingZones={(id) => {
          if (id) {
            setMarkedTrackId(id);
          }
          setTrainingZonesOpen(true);
          setIsMobileMenuOpen(false);
        }}
        onOpenAnalytics={() => {
          setAnalyticsOpen(true);
          setIsMobileMenuOpen(false);
        }}
        onOpenClimbs={() => {
          setClimbsOpen(true);
          setIsMobileMenuOpen(false);
        }}
        onOpenSegments={(id) => {
          if (id) {
            setMarkedTrackId(id);
          }
          setSegmentsOpen(true);
          setIsMobileMenuOpen(false);
        }}
        selectionBounds={selectionBounds}
        onAddSegment={handleAddNewSegment}
        textMarkers={textMarkers}
        onAddTextMarker={handleAddTextMarker}
        onDeleteTextMarker={handleDeleteTextMarker}
        onUpdateTextMarker={handleUpdateTextMarker}
        hoveredPoint={hoveredPoint}
        onMapViewChange={(view) => {
          setMapView({
            lat: view.lat,
            lng: view.lng,
            zoom: view.zoom,
            pitch: view.pitch,
            bearing: view.bearing
          });
        }}
        onAnalyzeSurface={analyzeTrackSurface}
        analyzingSurfaces={analyzingSurfaces}
      />
      <main className="flex-1 flex flex-col relative overflow-hidden">
        {/* Mobile Header */}
        <div className="md:hidden flex items-center justify-between p-4 bg-white border-b border-slate-200 z-[60]">
          <div className="flex items-center gap-2">
            <Activity className="text-indigo-600" size={24} />
            <span className="font-black tracking-tight text-lg">VeloAnalytics</span>
          </div>
          <button 
            onClick={() => setIsMobileMenuOpen(true)}
            className="p-2.5 bg-slate-50 text-slate-600 rounded-xl border border-slate-200"
          >
            <BarChart2 size={24} />
          </button>
        </div>
        <div className="flex-1 relative">
          {is3D ? (
            <Map3D 
              tracks={tracks} 
              activeLayer={activeLayer}
              markedTrackId={markedTrackId}
              onMarkTrack={setMarkedTrackId}
              hoveredPoint={hoveredPoint}
              onHoverPoint={setHoveredPoint}
              selectionBounds={selectionBounds}
              onSelection={setSelectionBounds}
              mapView={mapView}
              onMapViewChange={setMapView}
              estimatedSpeed={estimatedSpeed}
              flySpeed={flySpeed}
              isFlying={isFlying}
            />
          ) : (
            <Map 
              tracks={tracks} 
              activeLayer={activeLayer}
              markedTrackId={markedTrackId}
              onMarkTrack={setMarkedTrackId}
              hoveredPoint={hoveredPoint}
              onHoverPoint={setHoveredPoint}
              selectionBounds={selectionBounds}
              onSelection={setSelectionBounds}
              mapView={mapView}
              onMapViewChange={setMapView}
              estimatedSpeed={estimatedSpeed}
              isFlying={isFlying}
              ftp={ftp}
              textMarkers={textMarkers}
              onAddTextMarker={handleAddTextMarker}
              onDeleteTextMarker={handleDeleteTextMarker}
              hideLegend={trainingZonesOpen || weatherOpen || analyticsOpen || climbsOpen || segmentsOpen || comparisonOpen}
            />
          )}

          <WeatherOverlay 
            track={markedTrack}
            selectedDate={selectedDate}
            setSelectedDate={setSelectedDate}
            selectedTime={selectedTime}
            setSelectedTime={setSelectedTime}
            isOpen={weatherOpen}
            onOpenChange={setWeatherOpen}
          />

          <AnimatePresence>
            {analyticsOpen && markedTrack && (
              <AdvancedAnalytics 
                track={markedTrack} 
                ftp={ftp} 
                userWeight={userWeight}
                userAge={userAge}
                selectionBounds={selectionBounds}
                onSelection={setSelectionBounds}
                onClose={() => setAnalyticsOpen(false)} 
              />
            )}
          </AnimatePresence>

          <AnimatePresence>
            {climbsOpen && markedTrack && (
              <ClimbsAnalysis 
                track={markedTrack} 
                activeLayer={activeLayer}
                onClose={() => setClimbsOpen(false)} 
              />
            )}
          </AnimatePresence>

          <AnimatePresence>
            {segmentsOpen && (
              <SegmentsAnalysis 
                tracks={tracks}
                activeTrack={markedTrack || undefined}
                segments={customSegments}
                onDeleteSegment={handleDeleteSegment}
                userWeight={userWeight}
                estimatedSpeed={estimatedSpeed}
                activeLayer={activeLayer}
                onClose={() => setSegmentsOpen(false)} 
              />
            )}
          </AnimatePresence>
          
          <AnimatePresence>
            {comparisonOpen && (
              <TrackComparison 
                tracks={tracks}
                onClose={() => setComparisonOpen(false)}
                ftp={ftp}
                userWeight={userWeight}
                userAge={userAge}
                estimatedSpeed={estimatedSpeed}
              />
            )}
          </AnimatePresence>
          
          <AnimatePresence>
            {trainingZonesOpen && (
              <TrainingZonesAnalysis 
                tracks={tracks}
                activeTrackId={markedTrackId}
                onClose={() => setTrainingZonesOpen(false)}
              />
            )}
          </AnimatePresence>
          
          {showHint && (
            <div 
              className="absolute top-4 left-1/2 -translate-x-1/2 z-[1000] bg-indigo-600/90 backdrop-blur-md text-white px-6 py-3 rounded-2xl shadow-2xl text-sm font-medium transition-all hover:bg-indigo-700 flex items-center gap-4 max-w-[90vw] md:max-w-none"
            >
              <div className="flex items-center gap-2">
                <span className="bg-white/20 p-1.5 rounded-lg">
                  <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="10" />
                    <line x1="12" y1="16" x2="12" y2="12" />
                    <line x1="12" y1="8" x2="12.01" y2="8" />
                  </svg>
                </span>
                <span className="leading-tight">Auswahl: Nutze den Auswahl-Button links auf der Karte, um einen Bereich zu markieren.</span>
              </div>
              <button 
                onClick={() => setShowHint(false)}
                className="bg-white/10 hover:bg-white/20 p-2 rounded-xl transition-colors group"
                title="Hinweis dauerhaft ausblenden"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className="group-hover:scale-110 transition-transform">
                  <path d="M18 6 6 18" />
                  <path d="m6 6 12 12" />
                </svg>
              </button>
            </div>
          )}

          {errorMessage && (
            <div className="absolute top-20 left-1/2 -translate-x-1/2 z-[1001] bg-red-500/90 backdrop-blur-sm text-white px-6 py-3 rounded-xl shadow-xl text-sm font-medium animate-bounce-in max-w-md whitespace-pre-line text-center">
              <div className="flex items-center gap-3">
                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="10" />
                  <line x1="12" y1="8" x2="12" y2="12" />
                  <line x1="12" y1="16" x2="12.01" y2="16" />
                </svg>
                <span>{errorMessage}</span>
                <button onClick={() => setErrorMessage(null)} className="ml-2 hover:opacity-70">
                  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M18 6 6 18" />
                    <path d="m6 6 12 12" />
                  </svg>
                </button>
              </div>
            </div>
          )}
        </div>

        {markedTrack && (
          <div className={`${isProfileCollapsed ? 'h-0 overflow-hidden py-0 border-t-0 shadow-none' : 'h-52 md:h-56'} bg-white border-t border-slate-200 px-3 md:px-6 py-2 md:py-3 shadow-[0_-4px_20px_-5px_rgba(0,0,0,0.1)] z-20 transition-all duration-300 relative`}>
            <ElevationProfile 
              track={markedTrack} 
              onHoverPoint={setHoveredPoint} 
              hoveredPoint={hoveredPoint}
              selectionBounds={selectionBounds}
              onSelection={setSelectionBounds}
              estimatedSpeed={estimatedSpeed}
              selectedDate={selectedDate}
              selectedTime={selectedTime}
              isFlying={isFlying}
              flySpeed={flySpeed}
              onFlySpeedChange={setFlySpeed}
              onOpenAnalytics={() => setAnalyticsOpen(true)}
              onOpenVideoExport={() => setIsExportModalOpen(true)}
              ftp={ftp}
              onToggleFlyover={() => {
                if (isFlying) {
                  setIsFlying(false);
                } else {
                  setFlyProgress(0);
                  setIsFlying(true);
                }
              }}
              onCollapse={() => setIsProfileCollapsed(true)}
            />
          </div>
        )}

        {markedTrack && isProfileCollapsed && (
          <button
            onClick={() => setIsProfileCollapsed(false)}
            className="fixed bottom-4 right-4 z-[99] bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2.5 rounded-full shadow-2xl flex items-center gap-1.5 font-bold text-xs transition-all cursor-pointer border border-indigo-500 hover:scale-105 active:scale-95 animate-fade-in"
            title="Höhenprofil anzeigen"
          >
            <BarChart2 size={14} />
            <span>Höhenprofil einblenden</span>
          </button>
        )}

        <VideoExportModal
          track={markedTrack}
          isOpen={isExportModalOpen}
          onClose={() => setIsExportModalOpen(false)}
          userWeight={userWeight}
          estimatedSpeed={estimatedSpeed}
        />
      </main>
    </div>
  );
};

export default App;
