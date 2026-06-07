
import React, { useState, useCallback, useEffect } from 'react';
import Sidebar from './components/Sidebar';
import Map from './components/Map';
import Map3D from './components/Map3D';
import ElevationProfile from './components/ElevationProfile';
import { Activity, BarChart2 } from 'lucide-react';
import { GPXTrack, GPXPoint, MapLayer, TextMarker, Segment } from './types';
import { parseGPX, mergeTracks, validateGPX, calculatePowerStats, calculateDistance } from './utils/gpxUtils';
import { parseFIT } from './utils/fitUtils';
import { arrayMove } from '@dnd-kit/sortable';
import AdvancedAnalytics from './components/AdvancedAnalytics';
import { TrackComparison } from './components/TrackComparison';
import { AnimatePresence } from 'motion/react';
import { VideoExportModal } from './components/VideoExportModal';
import { WeatherOverlay } from './components/WeatherOverlay';
import { ClimbsAnalysis } from './components/ClimbsAnalysis';
import { SegmentsAnalysis } from './components/SegmentsAnalysis';
import { getFamousSegments, extractSegmentsFromTrack, generateProLeaderboard } from './utils/segmentUtils';

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
 
    setErrorMessage(null);
    const newTracks: GPXTrack[] = [];
    const errors: string[] = [];
    
    let fitDate: string | null = null;
    let fitTime: string | null = null;
    let hasAddedFit = false;
 
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const isFit = file.name.toLowerCase().endsWith('.fit');
 
      try {
        if (isFit) {
          const buffer = await file.arrayBuffer();
          const parsed = await parseFIT(buffer, file.name);
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
            errors.push(`${file.name}: Fehler beim Verarbeiten der FIT-Datei.`);
          }
        } else {
          const text = await file.text();
          const validation = validateGPX(text);
          if (!validation.isValid) {
            errors.push(`${file.name}: ${validation.error}`);
            continue;
          }
 
          const parsed = await parseGPX(text, file.name);
          if (parsed) {
            parsed.powerStats = calculatePowerStats(parsed.points, ftp, userWeight, estimatedSpeed);
            newTracks.push(parsed);
          } else {
            errors.push(`${file.name}: Fehler beim Verarbeiten der GPX-Datei.`);
          }
        }
      } catch (err) {
        errors.push(`${file.name}: Unerwarteter Fehler.`);
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

  const [showHint, setShowHint] = useState(true);

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-slate-100 font-sans text-slate-900">
      <Sidebar 
        tracks={tracks}
        markedTrackId={markedTrackId}
        onMarkTrack={setMarkedTrackId}
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
              textMarkers={textMarkers}
              onAddTextMarker={handleAddTextMarker}
              onDeleteTextMarker={handleDeleteTextMarker}
            />
          )}

          <WeatherOverlay 
            track={markedTrack}
            selectedDate={selectedDate}
            setSelectedDate={setSelectedDate}
            selectedTime={selectedTime}
            setSelectedTime={setSelectedTime}
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
          <div className="h-56 bg-white border-t border-slate-200 px-6 py-3 shadow-[0_-4px_20px_-5px_rgba(0,0,0,0.1)] z-20 transition-all">
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
            />
          </div>
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
