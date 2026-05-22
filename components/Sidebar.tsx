
import React from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { GPXTrack, MapLayer } from '../types';
import { Upload, Trash2, Combine, Eye, EyeOff, Ruler, Layers, GripVertical, Undo2, TrendingUp, TrendingDown, Box, ChevronLeft, ChevronRight, Menu, Zap, Clock, BarChart2, X } from 'lucide-react';
import { 
  DndContext, 
  closestCenter, 
  KeyboardSensor, 
  PointerSensor, 
  useSensor, 
  useSensors,
  DragEndEvent 
} from '@dnd-kit/core';
import { 
  SortableContext, 
  sortableKeyboardCoordinates, 
  verticalListSortingStrategy,
  useSortable 
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

interface TrackItemProps {
  track: GPXTrack;
  isMarked: boolean;
  onMark: (id: string) => void;
  onToggleVisibility: (id: string) => void;
  onRemoveTrack: (id: string) => void;
  estimatedSpeed: number;
  onOpenAnalytics?: (id: string) => void;
}

const SortableTrackItem: React.FC<TrackItemProps> = ({ track, isMarked, onMark, onToggleVisibility, onRemoveTrack, estimatedSpeed, onOpenAnalytics }) => {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging
  } = useSortable({ id: track.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 50 : 'auto',
  };

  return (
    <div 
      ref={setNodeRef} 
      style={style}
      onClick={() => onMark(track.id)}
      className={`group cursor-pointer bg-white border rounded-lg p-3 hover:shadow-md transition-all ${isDragging ? 'shadow-xl opacity-50 bg-slate-50' : ''} ${isMarked ? 'border-blue-500 ring-1 ring-blue-500 bg-blue-50/30' : 'border-slate-200'}`}
    >
      <div className="flex items-start gap-2">
        <div {...attributes} {...listeners} onClick={(e) => e.stopPropagation()} className="drag-handle p-1 mt-0.5 hover:bg-slate-100 rounded text-slate-400 shrink-0">
          <GripVertical className="w-4 h-4" />
        </div>
        
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-0.5">
            <div className="w-3 h-3 rounded-full shrink-0 shadow-sm border border-black/10" style={{ backgroundColor: track.color }}></div>
            <span className={`text-sm truncate ${isMarked ? 'font-bold text-blue-900' : 'font-semibold text-slate-800'}`}>{track.name}</span>
          </div>
          
          <div className="flex flex-col gap-1 ml-5">
            <div className="text-[11px] text-slate-500 flex items-center gap-2">
              <span className={`${isMarked ? 'bg-blue-100 text-blue-700' : 'bg-slate-100 text-slate-600'} px-1.5 py-0.5 rounded font-mono`}>{track.distance.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} km</span>
              {track.duration ? (
                <>
                  <span className="text-slate-300">•</span>
                  <span className="flex items-center gap-0.5"><Clock className="w-3 h-3" /> {Math.floor(track.duration / 3600)}h {Math.floor((track.duration % 3600) / 60)}m</span>
                </>
              ) : (
                <>
                  <span className="text-slate-300">•</span>
                  <span className="flex items-center gap-0.5"><Clock className="w-3 h-3" /> {Math.floor((track.distance / estimatedSpeed))}h {Math.floor(((track.distance / estimatedSpeed) * 60) % 60)}m</span>
                </>
              )}
            </div>
            <div className={`text-[11px] font-bold py-1 px-2 rounded-lg flex items-center justify-between font-mono ${isMarked ? 'bg-indigo-100/60 text-indigo-950 border border-indigo-200/40' : 'bg-slate-50/75 text-slate-700 border border-slate-100'}`}>
              <span className="flex items-center gap-1 text-emerald-700">
                <TrendingUp className="w-3.5 h-3.5" />
                Anstieg: +{Math.round(track.ascent).toLocaleString('de-DE')}m
              </span>
              <span className="text-slate-300">|</span>
              <span className="flex items-center gap-1 text-rose-700">
                <TrendingDown className="w-3.5 h-3.5" />
                Abstieg: -{Math.round(track.descent).toLocaleString('de-DE')}m
              </span>
            </div>
            <div className="text-[10px] text-slate-400 flex items-center gap-3 font-mono">
              <span className="text-slate-500">Max Steigung: {track.maxSlope.toLocaleString('de-DE', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%</span>
              <span className="text-slate-300">•</span>
              <span>{track.points.length.toLocaleString('de-DE')} Pkt</span>
            </div>
            {track.powerStats && (
              <div className="text-[10px] text-amber-600 flex flex-wrap items-center gap-x-2 gap-y-0.5 font-mono mt-1 pt-1 border-t border-slate-100">
                <Zap className="w-3 h-3 shrink-0" />
                <span title="Normalized Power" className="font-bold">NP {Math.round(track.powerStats.normalizedPower || 0)}W</span>
                <span title="Intensity Factor">IF {(track.powerStats.intensityFactor || 0).toFixed(2)}</span>
                <span title="Training Stress Score">TSS {Math.round(track.powerStats.tss || 0)}</span>
                <span title="Arbeit">Work {Math.round(track.powerStats.work || 0)}kJ</span>
              </div>
            )}
            {track.climbs && track.climbs.length > 0 && (
              <div className="text-[10px] text-indigo-600 flex flex-wrap items-center gap-x-1.5 gap-y-1 font-mono mt-1 pt-1 border-t border-slate-100">
                <TrendingUp className="w-3 h-3 shrink-0" />
                <span className="font-bold">Anstiege:</span>
                {track.climbs.map((climb, idx) => (
                  <span key={idx} className="bg-indigo-50 px-1.5 py-0.5 rounded border border-indigo-100" title={`Max Steigung: ${climb.maxGradient.toFixed(1)}%`}>
                    {climb.avgGradient.toFixed(1)}% / {(climb.distance / 1000).toFixed(1)}km
                  </span>
                ))}
              </div>
            )}
            {track.surfaceStats && track.surfaceStats.length > 0 && (
              <div className="text-[10px] text-slate-500 flex flex-wrap items-center gap-x-1.5 gap-y-1 font-mono mt-1 pt-1 border-t border-slate-100">
                {track.surfaceStats.map((surface, idx) => (
                  <span key={idx} className="bg-slate-100/80 px-1.5 py-0.5 rounded border border-slate-200/50">
                    {surface.type}: {surface.distance.toLocaleString('de-DE', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} km
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="flex flex-col gap-1 items-center bg-slate-50 rounded p-0.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
          <button 
            onClick={(e) => { e.stopPropagation(); onToggleVisibility(track.id); }} 
            className="p-1 hover:bg-slate-200 rounded text-slate-500 transition-colors" 
            title="Sichtbarkeit umschalten"
          >
            {track.visible ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
          </button>
          
          {track.powerStats && (
            <button 
              onClick={(e) => { e.stopPropagation(); onOpenAnalytics?.(track.id); }} 
              className="p-1 hover:bg-indigo-100 rounded text-indigo-600 transition-colors" 
              title="Erweiterte Analyse"
            >
              <BarChart2 className="w-3.5 h-3.5" />
            </button>
          )}

          <button 
            onClick={(e) => { e.stopPropagation(); onRemoveTrack(track.id); }} 
            className="p-1 hover:bg-red-100 rounded text-red-500 transition-colors" 
            title="Track entfernen"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
};

interface SidebarProps {
  tracks: GPXTrack[];
  markedTrackId: string | null;
  onMarkTrack: (id: string) => void;
  onUpload: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onToggleVisibility: (id: string) => void;
  onRemoveTrack: (id: string) => void;
  onMergeSelected: () => void;
  onUndo: () => void;
  canUndo: boolean;
  onReorder: (oldIndex: number, newIndex: number) => void;
  activeLayer: MapLayer;
  setActiveLayer: (layer: MapLayer) => void;
  is3D: boolean;
  setIs3D: (mode: boolean) => void;
  isCollapsed: boolean;
  onToggleCollapse: () => void;
  isMobileMenuOpen: boolean;
  setIsMobileMenuOpen: (open: boolean) => void;
  estimatedSpeed: number;
  setEstimatedSpeed: (speed: number) => void;
  ftp: number;
  setFtp: (ftp: number) => void;
  userWeight: number;
  setUserWeight: (weight: number) => void;
  userAge: number;
  setUserAge: (age: number) => void;
  suggestedFtp: number | null;
  onOpenAnalytics: (id: string) => void;
}

const Sidebar: React.FC<SidebarProps> = ({ 
  tracks, 
  markedTrackId,
  onMarkTrack,
  onUpload, 
  onToggleVisibility, 
  onRemoveTrack, 
  onMergeSelected,
  onUndo,
  canUndo,
  onReorder,
  activeLayer,
  setActiveLayer,
  is3D,
  setIs3D,
  isCollapsed,
  onToggleCollapse,
  isMobileMenuOpen,
  setIsMobileMenuOpen,
  estimatedSpeed,
  setEstimatedSpeed,
  ftp,
  setFtp,
  userWeight,
  setUserWeight,
  userAge,
  setUserAge,
  suggestedFtp,
  onOpenAnalytics
}) => {
  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (over && active.id !== over.id) {
      const oldIndex = tracks.findIndex(t => t.id === active.id);
      const newIndex = tracks.findIndex(t => t.id === over.id);
      onReorder(oldIndex, newIndex);
    }
  };

  return (
    <>
      {/* Mobile Overlay */}
      <AnimatePresence>
        {isMobileMenuOpen && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setIsMobileMenuOpen(false)}
            className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-[70] md:hidden"
          />
        )}
      </AnimatePresence>

      <div className={`
        fixed inset-y-0 left-0 z-[80] transition-all duration-300 transform
        ${isMobileMenuOpen ? 'translate-x-0' : '-translate-x-full'}
        md:relative md:translate-x-0
        ${isCollapsed ? 'md:w-16' : 'md:w-80'} 
        h-full shadow-2xl flex flex-col border-r border-slate-200 overflow-hidden bg-white
      `}>
        {/* Mobile Close Button */}
        <button 
          onClick={() => setIsMobileMenuOpen(false)}
          className="md:hidden absolute right-4 top-4 p-2 bg-slate-100 rounded-xl text-slate-600 z-50"
        >
          <X size={20} />
        </button>

        {/* AI Generated Background Image */}
      <div 
        className="absolute inset-0 z-0 opacity-60 pointer-events-none"
        style={{
          backgroundImage: 'url("https://images.unsplash.com/photo-1524661135-423995f22d0b?q=80&w=800&auto=format&fit=crop")',
          backgroundSize: 'cover',
          backgroundPosition: 'center'
        }}
      />
      <div className="absolute inset-0 z-0 bg-white/60 backdrop-blur-md pointer-events-none" />

      <button 
        onClick={onToggleCollapse}
        className="absolute top-1/2 -right-3 -translate-y-1/2 w-6 h-12 bg-white border border-slate-200 rounded-full flex items-center justify-center shadow-md hover:bg-slate-50 transition-colors z-40 group"
        title={isCollapsed ? "Menü ausklappen" : "Menü einklappen"}
      >
        {isCollapsed ? <ChevronRight className="w-4 h-4 text-slate-600 group-hover:scale-110 transition-transform" /> : <ChevronLeft className="w-4 h-4 text-slate-600 group-hover:scale-110 transition-transform" />}
      </button>

      <div className={`relative z-10 p-6 bg-slate-900/95 text-white flex items-center ${isCollapsed ? 'justify-center' : 'gap-2'}`}>
        <Layers className={`w-6 h-6 text-blue-400 shrink-0 ${isCollapsed ? '' : ''}`} />
        {!isCollapsed && (
          <div>
            <h1 className="text-xl font-bold whitespace-nowrap">GPX Master</h1>
            <p className="text-[10px] text-slate-400 uppercase tracking-widest">OSM Pro Tools</p>
          </div>
        )}
      </div>

      <div className={`relative z-10 flex-1 overflow-y-auto p-4 space-y-6 ${isCollapsed ? 'items-center flex flex-col' : ''}`}>
        {isCollapsed ? (
          <div className="flex flex-col gap-6 items-center pt-4">
            <label className="p-3 bg-slate-100 rounded-xl cursor-pointer hover:bg-slate-200 transition-colors text-slate-600" title="GPX/FIT hochladen">
              <Upload className="w-6 h-6" />
              <input type="file" className="hidden" accept=".gpx, .fit, .FIT, application/gpx+xml, application/octet-stream, application/x-garmin-fit" multiple onChange={onUpload} />
            </label>
            
            <button 
              onClick={() => setIs3D(!is3D)}
              className={`p-3 rounded-xl transition-all ${is3D ? 'bg-purple-600 text-white shadow-lg shadow-purple-200' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}
              title="3D Ansicht umschalten"
            >
              <Box className="w-6 h-6" />
            </button>

            <div className="w-8 h-px bg-slate-200" />

            <div className="flex flex-col gap-2">
              {Object.values(MapLayer).map((layer) => (
                <button
                  key={layer}
                  onClick={() => setActiveLayer(layer)}
                  className={`w-10 h-10 flex items-center justify-center rounded-lg text-[10px] font-bold transition-colors border ${activeLayer === layer ? 'bg-blue-100 text-blue-700 border-blue-200' : 'bg-white text-slate-400 border-transparent hover:bg-slate-50'}`}
                  title={layer}
                >
                  {layer.substring(0, 2).toUpperCase()}
                </button>
              ))}
            </div>

            <div className="w-8 h-px bg-slate-200" />
            
            <div className="relative">
              <div className="bg-blue-600 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full absolute -top-2 -right-2 z-10">
                {tracks.length}
              </div>
              <Menu className="w-6 h-6 text-slate-400" />
            </div>
          </div>
        ) : (
          <>
            <section>
              <label className="flex flex-col items-center justify-center w-full h-24 border-2 border-dashed border-slate-300 rounded-xl cursor-pointer hover:bg-slate-50 transition-colors">
                <div className="flex flex-col items-center justify-center pt-5 pb-6">
                  <Upload className="w-8 h-8 text-slate-400 mb-2" />
                  <p className="text-sm text-slate-500 font-medium">GPX oder FIT Datei hochladen</p>
                </div>
                <input type="file" className="hidden" accept=".gpx, .fit, .FIT, application/gpx+xml, application/octet-stream, application/x-garmin-fit" multiple onChange={onUpload} />
              </label>
            </section>

            <section className="space-y-3">
              <div className="flex justify-between items-center">
                <h2 className="text-xs font-bold text-slate-400 uppercase tracking-wider">Werkzeuge</h2>
                {canUndo && (
                  <button 
                    onClick={onUndo}
                    className="flex items-center gap-1 text-[10px] text-blue-600 font-bold hover:bg-blue-100 bg-blue-50 px-2 py-1 rounded transition-colors"
                  >
                    <Undo2 className="w-3 h-3" /> RÜCKGÄNGIG
                  </button>
                )}
              </div>
              <div className="grid grid-cols-2 gap-2">
                <button 
                  onClick={onMergeSelected}
                  disabled={tracks.length < 2}
                  className="flex items-center justify-center gap-2 p-3 rounded-lg text-sm font-semibold bg-slate-100 text-slate-700 hover:bg-slate-200 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
                >
                  <Combine className="w-4 h-4" />
                  Verbinden
                </button>
                <button 
                  onClick={() => setIs3D(!is3D)}
                  className={`flex items-center justify-center gap-2 p-3 rounded-lg text-sm font-semibold transition-all ${is3D ? 'bg-purple-600 text-white shadow-lg shadow-purple-200' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'}`}
                >
                  <Box className="w-4 h-4" />
                  3D Ansicht {is3D ? 'aktiv' : ''}
                </button>
              </div>
            </section>

            <section className="space-y-3">
              <h2 className="text-xs font-bold text-slate-400 uppercase tracking-wider">Kartentyp</h2>
              <div className="grid grid-cols-2 gap-1.5">
                {Object.values(MapLayer).map((layer) => (
                  <button
                    key={layer}
                    onClick={() => setActiveLayer(layer)}
                    className={`text-left px-2.5 py-1.5 rounded-md text-[11px] font-semibold transition-colors ${activeLayer === layer ? 'bg-blue-100 text-blue-700 border border-blue-200' : 'text-slate-600 hover:bg-slate-50 border border-transparent'}`}
                  >
                    {layer}
                  </button>
                ))}
              </div>
            </section>

            {tracks.some(t => !t.hasTimestamps) && (
              <section className="space-y-3">
                <div className="flex justify-between items-center">
                  <h2 className="text-xs font-bold text-slate-400 uppercase tracking-wider">Geschwindigkeit</h2>
                  <span className="text-xs font-bold text-blue-600">{estimatedSpeed} km/h</span>
                </div>
                <input 
                  type="range" 
                  min="5" 
                  max="50" 
                  step="1" 
                  value={estimatedSpeed} 
                  onChange={(e) => setEstimatedSpeed(Number(e.target.value))}
                  className="w-full accent-blue-600"
                />
                <p className="text-[10px] text-slate-500">Für die Schätzung der Dauer bei GPX-Dateien ohne Zeitstempel.</p>
              </section>
            )}

            <section className="space-y-4">
              <div className="flex justify-between items-center">
                <h2 className="text-xs font-bold text-slate-400 uppercase tracking-wider">Erweiterte Nutzerdaten</h2>
              </div>
              
              <div className="space-y-3 p-3 bg-slate-50/50 rounded-xl border border-slate-200/50">
                <div className="space-y-1.5 focus-within:ring-2 focus-within:ring-blue-500/20 rounded transition-all">
                  <div className="flex justify-between items-center">
                    <label className="text-[10px] font-bold text-slate-500 uppercase">FTP (Watt)</label>
                    <span className="text-[11px] font-black text-amber-600">{ftp} W</span>
                  </div>
                  <input 
                    type="range" 
                    min="100" 
                    max="500" 
                    step="5" 
                    value={ftp} 
                    onChange={(e) => setFtp(Number(e.target.value))}
                    className="w-full h-1.5 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-amber-500"
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-bold text-slate-500 uppercase">Gewicht (kg)</label>
                    <input 
                      type="number"
                      value={userWeight}
                      onChange={(e) => setUserWeight(Number(e.target.value))}
                      className="w-full bg-white border border-slate-200 rounded-lg px-2 py-1.5 text-xs font-bold text-slate-700 focus:ring-2 focus:ring-blue-500/20 outline-none"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-bold text-slate-500 uppercase">Alter</label>
                    <input 
                      type="number"
                      value={userAge}
                      onChange={(e) => setUserAge(Number(e.target.value))}
                      className="w-full bg-white border border-slate-200 rounded-lg px-2 py-1.5 text-xs font-bold text-slate-700 focus:ring-2 focus:ring-blue-500/20 outline-none"
                    />
                  </div>
                </div>

                {suggestedFtp && Math.abs(suggestedFtp - ftp) > 2 && (
                  <button 
                    onClick={() => setFtp(suggestedFtp)}
                    className="w-full text-[9px] bg-amber-100 text-amber-700 px-1.5 py-1 rounded font-black hover:bg-amber-200 transition-colors animate-pulse"
                  >
                    FTP-Vorschlag basierend auf Bestleistung: {suggestedFtp}W
                  </button>
                )}
              </div>
              <p className="text-[10px] text-slate-400 italic">Diese Daten ermöglichen eine genauere Schätzung von VO2max und Kalorienverbrauch.</p>
            </section>

            <section className="space-y-3">
              <h2 className="text-xs font-bold text-slate-400 uppercase tracking-wider">Routen ({tracks.length})</h2>
              <div className="space-y-2 pb-6">
                {tracks.length === 0 && (
                  <p className="text-xs text-slate-400 italic text-center py-8 bg-slate-50/50 rounded-xl border border-dashed border-slate-200">Noch keine Routen geladen.</p>
                )}
                <DndContext 
                  sensors={sensors}
                  collisionDetection={closestCenter}
                  onDragEnd={handleDragEnd}
                >
                  <SortableContext 
                    items={tracks.map(t => t.id)}
                    strategy={verticalListSortingStrategy}
                  >
                    <div className="space-y-2">
                      {tracks.map((track) => (
                        <SortableTrackItem 
                          key={track.id} 
                          track={track} 
                          isMarked={markedTrackId === track.id}
                          onMark={onMarkTrack}
                          onToggleVisibility={onToggleVisibility} 
                          onRemoveTrack={onRemoveTrack} 
                          estimatedSpeed={estimatedSpeed}
                          onOpenAnalytics={onOpenAnalytics}
                        />
                      ))}
                    </div>
                  </SortableContext>
                </DndContext>
              </div>
            </section>
          </>
        )}
      </div>

      {!isCollapsed && (
        <div className="relative z-10 p-4 border-t border-slate-200/50 bg-slate-50/80 backdrop-blur-sm text-[10px] text-slate-500 text-center font-medium">
          Reihenfolge bestimmt Verbindungssequenz
        </div>
      )}
    </div>
    </>
  );
};

export default Sidebar;