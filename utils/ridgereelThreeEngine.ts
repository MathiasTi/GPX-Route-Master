import * as THREE from 'three';
import { GPXPoint } from '../types';

export type RidgereelMapStyle =
  | 'satellite'
  | 'topo'
  | 'relief'
  | 'outdoor'
  | 'streets-dark'
  | 'streets-light';

export type RidgereelRouteColorMode = 'gradient' | 'speed' | 'power' | 'classic';
export type RidgereelThemeMode = 'tactical' | 'neon' | 'sport-light';

export interface RidgereelEngineConfig {
  points: GPXPoint[];
  smoothedElevations: Float32Array;
  smoothedGradients: Float32Array;
  smoothedSpeeds: Float32Array;
  rawPowers: Float32Array;
  rawHrs: Float32Array;
  minLat: number;
  maxLat: number;
  minLng: number;
  maxLng: number;
  minEle: number;
  maxEle: number;
  mapStyle: RidgereelMapStyle;
  routeColorMode: RidgereelRouteColorMode;
  theme: RidgereelThemeMode;
}

export interface RidgereelRenderParams {
  routeU: number; // 0..1 active rider progress
  currentIdx: number;
  cameraPosition: THREE.Vector3;
  cameraTarget: THREE.Vector3;
  cameraRollRad: number;
  terrainExaggeration: number; // 1.0 .. 3.5
  showElevationCurtain: boolean;
  showContourLines: boolean;
  showRiderAvatar: boolean;
  enableSunGlow: boolean;
  theme: RidgereelThemeMode;
  routeColorMode: RidgereelRouteColorMode;
  activeColorHex: string;
}

const lon2tile = (lon: number, zoom: number) => ((lon + 180) / 360) * Math.pow(2, zoom);
const lat2tile = (lat: number, zoom: number) =>
  ((1 -
    Math.log(Math.tan((lat * Math.PI) / 180) + 1 / Math.cos((lat * Math.PI) / 180)) / Math.PI) /
    2) *
  Math.pow(2, zoom);

const tile2lon = (x: number, z: number) => (x / Math.pow(2, z)) * 360 - 180;
const tile2lat = (y: number, z: number) => {
  const n = Math.PI - (2 * Math.PI * y) / Math.pow(2, z);
  return (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
};

const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));

const getTileUrl = (mapStyle: RidgereelMapStyle, z: number, tx: number, ty: number): string => {
  const maxTile = 1 << z;
  const normTx = ((tx % maxTile) + maxTile) % maxTile;
  const clampedTy = Math.max(0, Math.min(maxTile - 1, ty));
  if (mapStyle === 'satellite') {
    return `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${z}/${clampedTy}/${normTx}`;
  }
  if (mapStyle === 'topo') {
    return `https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/${z}/${clampedTy}/${normTx}`;
  }
  if (mapStyle === 'relief') {
    return `https://server.arcgisonline.com/ArcGIS/rest/services/World_Shaded_Relief/MapServer/tile/${z}/${clampedTy}/${normTx}`;
  }
  if (mapStyle === 'streets-dark') {
    return `https://basemaps.cartocdn.com/rastertiles/dark_all/${z}/${normTx}/${clampedTy}.png`;
  }
  if (mapStyle === 'streets-light') {
    return `https://basemaps.cartocdn.com/rastertiles/voyager/${z}/${normTx}/${clampedTy}.png`;
  }
  return `https://tile.openstreetmap.org/${z}/${normTx}/${clampedTy}.png`;
};

const getTerrariumTileUrl = (z: number, tx: number, ty: number): string => {
  const maxTile = 1 << z;
  const normTx = ((tx % maxTile) + maxTile) % maxTile;
  const clampedTy = Math.max(0, Math.min(maxTile - 1, ty));
  return `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${z}/${normTx}/${clampedTy}.png`;
};

// In-memory image cache for fast switching
const imgCache = new Map<string, HTMLImageElement>();

const loadImage = (url: string): Promise<HTMLImageElement | null> => {
  if (imgCache.has(url)) {
    const cached = imgCache.get(url)!;
    if (cached.complete && cached.naturalWidth > 0) return Promise.resolve(cached);
  }
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      imgCache.set(url, img);
      resolve(img);
    };
    img.onerror = () => {
      resolve(null);
    };
    img.src = url;
  });
};

const getPointRouteColorHex = (
  mode: RidgereelRouteColorMode,
  gradientPct: number,
  speedKmh: number,
  powerW: number,
  hrBpm: number,
  theme: RidgereelThemeMode
): string => {
  if (mode === 'classic') {
    if (theme === 'sport-light') return '#2563eb';
    if (theme === 'neon') return '#a3e635';
    return '#f97316';
  }
  if (mode === 'gradient') {
    if (gradientPct < -2) return '#38bdf8';
    if (gradientPct < 2.5) return '#10b981';
    if (gradientPct < 6.0) return '#eab308';
    if (gradientPct < 9.5) return '#f97316';
    return '#ef4444';
  }
  if (mode === 'speed') {
    if (speedKmh < 14) return '#3b82f6';
    if (speedKmh < 24) return '#06b6d4';
    if (speedKmh < 34) return '#10b981';
    if (speedKmh < 45) return '#f59e0b';
    return '#ef4444';
  }
  const val = powerW > 0 ? powerW : hrBpm > 0 ? (hrBpm - 90) * 3.2 : speedKmh * 7.5;
  if (val < 130) return '#38bdf8';
  if (val < 190) return '#10b981';
  if (val < 250) return '#eab308';
  if (val < 320) return '#f97316';
  return '#ec4899';
};

/**
 * Ridgereel-style Three.js WebGL 3D Terrain & Route Engine
 * - Decodes real AWS Terrarium DEM elevation tiles (height = R*256 + G + B/256 - 32768)
 * - Drapes high-resolution satellite/topo texture atlas with anisotropic filtering
 * - Builds 3D Terrain Block with side skirts (diorama slab)
 * - Builds 3D TubeGeometry route + vertical elevation curtain + glowing 3D rider comet
 */
export class RidgereelThreeEngine {
  public renderer: THREE.WebGLRenderer;
  public scene: THREE.Scene;
  public camera: THREE.PerspectiveCamera;

  private terrainGroup: THREE.Group;
  private terrainMesh: THREE.Mesh | null = null;
  private skirtMesh: THREE.Mesh | null = null;
  private basePlateMesh: THREE.Mesh | null = null;
  private contourMesh: THREE.LineSegments | null = null;

  private routeGroup: THREE.Group;
  private activeRouteMesh: THREE.Mesh | null = null;
  private upcomingRouteMesh: THREE.Mesh | null = null;
  private curtainMesh: THREE.Mesh | null = null;

  private riderGroup: THREE.Group;
  private riderOrb: THREE.Mesh | null = null;
  private riderHalo: THREE.Mesh | null = null;
  private riderCone: THREE.Mesh | null = null;
  private riderLight: THREE.PointLight | null = null;
  private cometTrailMesh: THREE.Mesh | null = null;

  private sunLight: THREE.DirectionalLight;
  private hemiLight: THREE.HemisphereLight;
  private sunSpriteGroup: THREE.Group;

  // World coordinate conversion
  public centerLat = 0;
  public centerLng = 0;
  public baseEle = 0;
  public metersPerDegLat = 111320;
  public metersPerDegLng = 70000;
  public worldWidthM = 10000;
  public worldDepthM = 10000;
  public baseAutoExag = 1.5;

  // Elevation grid (gridSize x gridSize)
  private gridSize = 192;
  private rawDemGrid: Float32Array;
  private routeLocalPoints: THREE.Vector3[] = [];
  private routeColors: THREE.Color[] = [];
  private totalTubeIndices = 0;

  constructor() {
    // Software WebGL detection per Three.js skill guidelines
    const isSoftwareGl = (() => {
      try {
        const probe = document.createElement('canvas').getContext('webgl2');
        if (!probe) return true;
        const ext = probe.getExtension('WEBGL_debug_renderer_info');
        const param = ext ? ext.UNMASKED_RENDERER_WEBGL : probe.RENDERER;
        const gpu = String(probe.getParameter(param));
        probe.getExtension('WEBGL_lose_context')?.loseContext();
        return /SwiftShader|llvmpipe|softpipe|Software|Basic Render/i.test(gpu);
      } catch {
        return false;
      }
    })();

    this.renderer = new THREE.WebGLRenderer({
      antialias: !isSoftwareGl,
      preserveDrawingBuffer: true,
      powerPreference: 'high-performance',
      alpha: false
    });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.12;
    this.renderer.setSize(1280, 720, false);

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x090d18);
    this.scene.fog = new THREE.FogExp2(0x0f172a, 0.000045);

    this.camera = new THREE.PerspectiveCamera(48, 16 / 9, 5, 120000);

    // Studio & Sunlight rig
    this.hemiLight = new THREE.HemisphereLight(0xe0f2fe, 0x1e293b, 0.85);
    this.scene.add(this.hemiLight);

    this.sunLight = new THREE.DirectionalLight(0xfffbeb, 1.55);
    this.sunLight.position.set(6000, 9500, -5000);
    this.scene.add(this.sunLight);

    this.terrainGroup = new THREE.Group();
    this.routeGroup = new THREE.Group();
    this.riderGroup = new THREE.Group();
    this.sunSpriteGroup = new THREE.Group();

    this.scene.add(this.terrainGroup);
    this.scene.add(this.routeGroup);
    this.scene.add(this.riderGroup);
    this.scene.add(this.sunSpriteGroup);

    this.rawDemGrid = new Float32Array((this.gridSize + 1) * (this.gridSize + 1));
    this.initRiderAvatar();
  }

  private initRiderAvatar() {
    // 1. Glowing core sphere
    const orbGeo = new THREE.SphereGeometry(14, 24, 24);
    const orbMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    this.riderOrb = new THREE.Mesh(orbGeo, orbMat);
    this.riderGroup.add(this.riderOrb);

    // 2. Colored outer energy halo
    const haloGeo = new THREE.SphereGeometry(28, 24, 24);
    const haloMat = new THREE.MeshBasicMaterial({
      color: 0xf97316,
      transparent: true,
      opacity: 0.42,
      depthWrite: false
    });
    this.riderHalo = new THREE.Mesh(haloGeo, haloMat);
    this.riderGroup.add(this.riderHalo);

    // 3. Directional Aero-Chevron Cone pointing ahead
    const coneGeo = new THREE.ConeGeometry(18, 48, 16);
    coneGeo.rotateX(Math.PI / 2);
    const coneMat = new THREE.MeshStandardMaterial({
      color: 0xf97316,
      emissive: 0xf97316,
      emissiveIntensity: 0.6,
      roughness: 0.2,
      metalness: 0.3
    });
    this.riderCone = new THREE.Mesh(coneGeo, coneMat);
    this.riderCone.position.set(0, 4, 18);
    this.riderGroup.add(this.riderCone);

    // 4. Dynamic PointLight illuminating the 3D terrain under the rider
    this.riderLight = new THREE.PointLight(0xf97316, 2.5, 650, 1.5);
    this.riderLight.position.set(0, 35, 0);
    this.riderGroup.add(this.riderLight);
  }

  public latLngToWorld(lat: number, lng: number, ele: number, exag: number): THREE.Vector3 {
    const x = (lng - this.centerLng) * this.metersPerDegLng;
    const z = -(lat - this.centerLat) * this.metersPerDegLat; // North is -Z
    const y = (ele - this.baseEle) * exag;
    return new THREE.Vector3(x, y, z);
  }

  public getTerrainHeightAtWorld(x: number, z: number): number {
    const u = clamp(x / this.worldWidthM + 0.5, 0, 1);
    const v = clamp(z / this.worldDepthM + 0.5, 0, 1);
    const gx = u * this.gridSize;
    const gz = v * this.gridSize;
    const ix = Math.min(this.gridSize - 1, Math.floor(gx));
    const iz = Math.min(this.gridSize - 1, Math.floor(gz));
    const fx = gx - ix;
    const fz = gz - iz;

    const stride = this.gridSize + 1;
    const h00 = this.rawDemGrid[iz * stride + ix];
    const h10 = this.rawDemGrid[iz * stride + (ix + 1)];
    const h01 = this.rawDemGrid[(iz + 1) * stride + ix];
    const h11 = this.rawDemGrid[(iz + 1) * stride + (ix + 1)];

    const h0 = h00 + (h10 - h00) * fx;
    const h1 = h01 + (h11 - h01) * fx;
    return h0 + (h1 - h0) * fz;
  }

  /**
   * Builds the Ridgereel 3D terrain mesh from real AWS Terrarium DEM tiles + High-Res Map Texture Atlas
   */
  public async buildTerrainAndRoute(
    config: RidgereelEngineConfig,
    onProgress?: (loaded: number, total: number) => void
  ): Promise<void> {
    this.centerLat = (config.minLat + config.maxLat) / 2;
    this.centerLng = (config.minLng + config.maxLng) / 2;
    this.baseEle = config.minEle;

    const latRad = (this.centerLat * Math.PI) / 180;
    this.metersPerDegLat = 111320;
    this.metersPerDegLng = (40075000 * Math.cos(latRad)) / 360;

    // Expand bounding box by 35% margin so surrounding mountains and valleys frame the route
    const latSpan = Math.max(0.015, config.maxLat - config.minLat);
    const lngSpan = Math.max(0.015, config.maxLng - config.minLng);
    const padLat = latSpan * 0.42;
    const padLng = lngSpan * 0.42;

    const northLat = config.maxLat + padLat;
    const southLat = config.minLat - padLat;
    const westLng = config.minLng - padLng;
    const eastLng = config.maxLng + padLng;

    this.worldWidthM = (eastLng - westLng) * this.metersPerDegLng;
    this.worldDepthM = (northLat - southLat) * this.metersPerDegLat;

    const eleSpan = Math.max(35, config.maxEle - config.minEle);
    this.baseAutoExag = clamp(240 / eleSpan, 1.15, 2.8);

    // Choose optimal tile zoom for the texture atlas (aim for ~4x4 to 6x6 tiles = 1024..1536px)
    const maxSpanDeg = Math.max(northLat - southLat, (eastLng - westLng) * Math.cos(latRad));
    const texZoom = clamp(Math.round(Math.log2(160 / (maxSpanDeg || 0.01))), 11, 15);
    const demZoom = clamp(texZoom - 1, 10, 14);

    // 1. Load AWS Terrarium DEM Tiles & Decode Elevation Grid
    const demMinTx = Math.floor(lon2tile(westLng, demZoom));
    const demMaxTx = Math.floor(lon2tile(eastLng, demZoom));
    const demMinTy = Math.floor(lat2tile(northLat, demZoom));
    const demMaxTy = Math.floor(lat2tile(southLat, demZoom));

    const texMinTx = Math.floor(lon2tile(westLng, texZoom));
    const texMaxTx = Math.floor(lon2tile(eastLng, texZoom));
    const texMinTy = Math.floor(lat2tile(northLat, texZoom));
    const texMaxTy = Math.floor(lat2tile(southLat, texZoom));

    const demTileCoords: { tx: number; ty: number }[] = [];
    for (let ty = demMinTy; ty <= demMaxTy; ty++) {
      for (let tx = demMinTx; tx <= demMaxTx; tx++) {
        demTileCoords.push({ tx, ty });
      }
    }

    const texTileCoords: { tx: number; ty: number }[] = [];
    for (let ty = texMinTy; ty <= texMaxTy; ty++) {
      for (let tx = texMinTx; tx <= texMaxTx; tx++) {
        texTileCoords.push({ tx, ty });
      }
    }

    const totalTiles = demTileCoords.length + texTileCoords.length;
    let loadedTiles = 0;
    onProgress?.(0, totalTiles);

    // Stitch DEM Canvas
    const demCols = demMaxTx - demMinTx + 1;
    const demRows = demMaxTy - demMinTy + 1;
    const demCanvas = document.createElement('canvas');
    demCanvas.width = demCols * 256;
    demCanvas.height = demRows * 256;
    const demCtx = demCanvas.getContext('2d', { willReadFrequently: true });

    let validDemTiles = 0;
    await Promise.all(
      demTileCoords.map(async ({ tx, ty }) => {
        const url = getTerrariumTileUrl(demZoom, tx, ty);
        const img = await loadImage(url);
        loadedTiles++;
        onProgress?.(loadedTiles, totalTiles);
        if (img && demCtx) {
          demCtx.drawImage(img, (tx - demMinTx) * 256, (ty - demMinTy) * 256, 256, 256);
          validDemTiles++;
        }
      })
    );

    // Sample DEM elevations across the (gridSize + 1) x (gridSize + 1) mesh vertices
    const stride = this.gridSize + 1;
    let demPixels: Uint8ClampedArray | null = null;
    if (validDemTiles > 0 && demCtx) {
      try {
        demPixels = demCtx.getImageData(0, 0, demCanvas.width, demCanvas.height).data;
      } catch {
        demPixels = null;
      }
    }

    // Prepare fallback spatial samples from GPX track in case any DEM pixel is missing
    const sampleStep = Math.max(1, Math.floor(config.points.length / 150));
    const trackSamples: { lat: number; lng: number; ele: number }[] = [];
    for (let i = 0; i < config.points.length; i += sampleStep) {
      trackSamples.push({
        lat: config.points[i].lat,
        lng: config.points[i].lng,
        ele: config.smoothedElevations[i]
      });
    }

    for (let rz = 0; rz <= this.gridSize; rz++) {
      const vFrac = rz / this.gridSize; // 0 = North, 1 = South
      const lat = northLat - vFrac * (northLat - southLat);

      for (let cx = 0; cx <= this.gridSize; cx++) {
        const uFrac = cx / this.gridSize; // 0 = West, 1 = East
        const lng = westLng + uFrac * (eastLng - westLng);

        let ele = this.baseEle;
        let gotDem = false;

        if (demPixels) {
          const tileX = lon2tile(lng, demZoom) - demMinTx;
          const tileY = lat2tile(lat, demZoom) - demMinTy;
          const px = clamp(Math.floor(tileX * 256), 0, demCanvas.width - 1);
          const py = clamp(Math.floor(tileY * 256), 0, demCanvas.height - 1);
          const idx = (py * demCanvas.width + px) * 4;
          const r = demPixels[idx];
          const g = demPixels[idx + 1];
          const b = demPixels[idx + 2];
          const a = demPixels[idx + 3];
          if (a > 128) {
            // Official AWS Terrarium formula: (R * 256 + G + B / 256) - 32768
            const decoded = r * 256 + g + b / 256 - 32768;
            if (decoded > -500 && decoded < 9000) {
              ele = decoded;
              gotDem = true;
            }
          }
        }

        if (!gotDem && trackSamples.length > 0) {
          // Smooth IDW fallback
          let sumW = 0;
          let sumE = 0;
          for (let i = 0; i < trackSamples.length; i++) {
            const s = trackSamples[i];
            const dLat = s.lat - lat;
            const dLng = (s.lng - lng) * Math.cos(latRad);
            const dSq = dLat * dLat + dLng * dLng + 0.00002;
            const w = 1 / dSq;
            sumW += w;
            sumE += w * s.ele;
          }
          ele = sumW > 0 ? sumE / sumW : this.baseEle;
        }

        this.rawDemGrid[rz * stride + cx] = ele;
      }
    }

    // Apply 2 passes of 3x3 Gaussian smoothing to DEM grid so terrain is silky-smooth & natural
    const tempGrid = new Float32Array(this.rawDemGrid.length);
    for (let pass = 0; pass < 2; pass++) {
      tempGrid.set(this.rawDemGrid);
      for (let rz = 1; rz < this.gridSize; rz++) {
        for (let cx = 1; cx < this.gridSize; cx++) {
          const idx = rz * stride + cx;
          this.rawDemGrid[idx] =
            tempGrid[idx] * 0.25 +
            (tempGrid[idx - 1] +
              tempGrid[idx + 1] +
              tempGrid[idx - stride] +
              tempGrid[idx + stride]) *
              0.125 +
            (tempGrid[idx - stride - 1] +
              tempGrid[idx - stride + 1] +
              tempGrid[idx + stride - 1] +
              tempGrid[idx + stride + 1]) *
              0.0625;
        }
      }
    }

    // Find true minimum DEM height so the base slab sits below the deepest valley
    let minDemEle = this.baseEle;
    for (let i = 0; i < this.rawDemGrid.length; i++) {
      if (this.rawDemGrid[i] < minDemEle) minDemEle = this.rawDemGrid[i];
    }
    this.baseEle = Math.min(config.minEle, minDemEle);

    // 2. Stitch High-Res Map Texture Atlas
    const texCols = texMaxTx - texMinTx + 1;
    const texRows = texMaxTy - texMinTy + 1;
    const atlasCanvas = document.createElement('canvas');
    atlasCanvas.width = Math.min(2048, texCols * 256);
    atlasCanvas.height = Math.min(2048, texRows * 256);
    const atlasCtx = atlasCanvas.getContext('2d');

    if (atlasCtx) {
      atlasCtx.fillStyle = config.theme === 'sport-light' ? '#cbd5e1' : '#1e293b';
      atlasCtx.fillRect(0, 0, atlasCanvas.width, atlasCanvas.height);

      const scaleX = atlasCanvas.width / (texCols * 256);
      const scaleY = atlasCanvas.height / (texRows * 256);

      await Promise.all(
        texTileCoords.map(async ({ tx, ty }) => {
          const url = getTileUrl(config.mapStyle, texZoom, tx, ty);
          const img = await loadImage(url);
          loadedTiles++;
          onProgress?.(loadedTiles, totalTiles);
          if (img) {
            const dx = (tx - texMinTx) * 256 * scaleX;
            const dy = (ty - texMinTy) * 256 * scaleY;
            atlasCtx.drawImage(img, dx, dy, 256 * scaleX + 0.8, 256 * scaleY + 0.8);
          }
        })
      );
    }

    // Compute exact UV bounds of our [westLng..eastLng, northLat..southLat] box inside the stitched tile grid
    const uMin = (lon2tile(westLng, texZoom) - texMinTx) / texCols;
    const uMax = (lon2tile(eastLng, texZoom) - texMinTx) / texCols;
    const vMin = (lat2tile(northLat, texZoom) - texMinTy) / texRows; // Top of image (North)
    const vMax = (lat2tile(southLat, texZoom) - texMinTy) / texRows; // Bottom of image (South)

    const terrainTexture = new THREE.CanvasTexture(atlasCanvas);
    terrainTexture.colorSpace = THREE.SRGBColorSpace;
    terrainTexture.anisotropy = Math.min(8, this.renderer.capabilities.getMaxAnisotropy());
    terrainTexture.minFilter = THREE.LinearMipmapLinearFilter;
    terrainTexture.magFilter = THREE.LinearFilter;
    terrainTexture.needsUpdate = true;

    // 3. Build 3D Terrain Geometry & Side Skirt Block (Ridgereel Diorama Style)
    this.clearGroup(this.terrainGroup);

    const planeGeo = new THREE.PlaneGeometry(
      this.worldWidthM,
      this.worldDepthM,
      this.gridSize,
      this.gridSize
    );
    planeGeo.rotateX(-Math.PI / 2);

    // Remap UVs so the exact geographic bounding box aligns to the stitched tile canvas
    const uvAttr = planeGeo.attributes.uv as THREE.BufferAttribute;
    const posAttr = planeGeo.attributes.position as THREE.BufferAttribute;

    for (let rz = 0; rz <= this.gridSize; rz++) {
      const vFrac = rz / this.gridSize; // 0 = North (-Z), 1 = South (+Z)
      const texV = 1.0 - (vMin + vFrac * (vMax - vMin));
      for (let cx = 0; cx <= this.gridSize; cx++) {
        const uFrac = cx / this.gridSize;
        const texU = uMin + uFrac * (uMax - uMin);
        const idx = rz * stride + cx;
        uvAttr.setXY(idx, texU, texV);

        const rawH = this.rawDemGrid[idx] - this.baseEle;
        posAttr.setY(idx, Math.max(0, rawH));
      }
    }
    uvAttr.needsUpdate = true;
    posAttr.needsUpdate = true;
    planeGeo.computeVertexNormals();

    const terrainMat = new THREE.MeshStandardMaterial({
      map: terrainTexture,
      roughness: 0.86,
      metalness: 0.04
    });

    this.terrainMesh = new THREE.Mesh(planeGeo, terrainMat);
    this.terrainGroup.add(this.terrainMesh);

    // Optional subtle 3D topographic contour / grid overlay mesh
    const wireGeo = new THREE.WireframeGeometry(planeGeo);
    const wireMat = new THREE.LineBasicMaterial({
      color: config.theme === 'sport-light' ? 0x0f172a : 0x38bdf8,
      transparent: true,
      opacity: 0.09,
      depthWrite: false
    });
    this.contourMesh = new THREE.LineSegments(wireGeo, wireMat);
    this.contourMesh.position.y = 0.6;
    this.terrainGroup.add(this.contourMesh);

    // Build Ridgereel 3D Diorama Side Skirt around the 4 outer edges of the terrain slab
    this.buildTerrainSkirt(posAttr);

    // Build 3D Route Tube & Elevation Curtain
    this.buildRouteMeshes(config);
  }

  public getPointWorldPosition(
    lat: number,
    lng: number,
    ele: number,
    terrainExaggeration: number
  ): THREE.Vector3 {
    const totalExag = this.baseAutoExag * terrainExaggeration;
    const x = (lng - this.centerLng) * this.metersPerDegLng;
    const z = -(lat - this.centerLat) * this.metersPerDegLat;
    const demEle = this.getTerrainHeightAtWorld(x, z);
    const trackEle = Math.max(demEle, ele);
    const y = (Math.max(0, trackEle - this.baseEle) + 6.5) * totalExag;
    return new THREE.Vector3(x, y, z);
  }

  private buildTerrainSkirt(posAttr: THREE.BufferAttribute) {
    const stride = this.gridSize + 1;
    const slabThickness = -Math.max(120, this.worldWidthM * 0.028);
    const positions: number[] = [];

    const addQuad = (
      x1: number,
      y1: number,
      z1: number,
      x2: number,
      y2: number,
      z2: number
    ) => {
      positions.push(x1, y1, z1, x2, y2, z2, x2, slabThickness, z2);
      positions.push(x1, y1, z1, x2, slabThickness, z2, x1, slabThickness, z1);
    };

    // North edge (rz = 0)
    for (let c = 0; c < this.gridSize; c++) {
      const i1 = c;
      const i2 = c + 1;
      addQuad(
        posAttr.getX(i2),
        posAttr.getY(i2),
        posAttr.getZ(i2),
        posAttr.getX(i1),
        posAttr.getY(i1),
        posAttr.getZ(i1)
      );
    }
    // South edge (rz = gridSize)
    for (let c = 0; c < this.gridSize; c++) {
      const i1 = this.gridSize * stride + c;
      const i2 = this.gridSize * stride + c + 1;
      addQuad(
        posAttr.getX(i1),
        posAttr.getY(i1),
        posAttr.getZ(i1),
        posAttr.getX(i2),
        posAttr.getY(i2),
        posAttr.getZ(i2)
      );
    }
    // West edge (cx = 0)
    for (let r = 0; r < this.gridSize; r++) {
      const i1 = r * stride;
      const i2 = (r + 1) * stride;
      addQuad(
        posAttr.getX(i1),
        posAttr.getY(i1),
        posAttr.getZ(i1),
        posAttr.getX(i2),
        posAttr.getY(i2),
        posAttr.getZ(i2)
      );
    }
    // East edge (cx = gridSize)
    for (let r = 0; r < this.gridSize; r++) {
      const i1 = r * stride + this.gridSize;
      const i2 = (r + 1) * stride + this.gridSize;
      addQuad(
        posAttr.getX(i2),
        posAttr.getY(i2),
        posAttr.getZ(i2),
        posAttr.getX(i1),
        posAttr.getY(i1),
        posAttr.getZ(i1)
      );
    }

    const skirtGeo = new THREE.BufferGeometry();
    skirtGeo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    skirtGeo.computeVertexNormals();

    const skirtMat = new THREE.MeshStandardMaterial({
      color: 0x1e293b,
      roughness: 0.9,
      metalness: 0.1,
      side: THREE.DoubleSide
    });
    this.skirtMesh = new THREE.Mesh(skirtGeo, skirtMat);
    this.terrainGroup.add(this.skirtMesh);
  }

  private buildRouteMeshes(config: RidgereelEngineConfig) {
    this.clearGroup(this.routeGroup);
    const n = config.points.length;
    if (n < 2) return;

    // Sample up to 600 smooth spline control points along the route
    const numSamples = Math.min(n, 600);
    this.routeLocalPoints = [];
    this.routeColors = [];

    for (let s = 0; s < numSamples; s++) {
      const u = s / (numSamples - 1);
      const idx = Math.min(n - 1, Math.floor(u * (n - 1)));
      const pt = config.points[idx];

      const x = (pt.lng - this.centerLng) * this.metersPerDegLng;
      const z = -(pt.lat - this.centerLat) * this.metersPerDegLat;
      const demEle = this.getTerrainHeightAtWorld(x, z);
      const trackEle = Math.max(demEle, config.smoothedElevations[idx]);
      // Store un-exaggerated height above baseEle; terrainGroup & routeGroup scale Y together!
      const y = Math.max(0, trackEle - this.baseEle) + 6.5;

      this.routeLocalPoints.push(new THREE.Vector3(x, y, z));

      const hex = getPointRouteColorHex(
        config.routeColorMode,
        config.smoothedGradients[idx],
        config.smoothedSpeeds[idx],
        config.rawPowers[idx],
        config.rawHrs[idx],
        config.theme
      );
      this.routeColors.push(new THREE.Color(hex));
    }

    const curve = new THREE.CatmullRomCurve3(this.routeLocalPoints);
    const tubularSegments = numSamples * 2;
    const radialSegments = 8;
    const tubeRadius = clamp(this.worldWidthM * 0.0022, 4.5, 22);

    // 1. Upcoming Route Guide Tube (subtle translucent)
    const upcomingGeo = new THREE.TubeGeometry(
      curve,
      Math.floor(tubularSegments * 0.6),
      tubeRadius * 0.65,
      6,
      false
    );
    const upcomingMat = new THREE.MeshBasicMaterial({
      color: config.theme === 'sport-light' ? 0x334155 : 0xffffff,
      transparent: true,
      opacity: 0.25
    });
    this.upcomingRouteMesh = new THREE.Mesh(upcomingGeo, upcomingMat);
    this.routeGroup.add(this.upcomingRouteMesh);

    // 2. Active Colored Route Tube with per-vertex slope/speed colors
    const activeGeo = new THREE.TubeGeometry(
      curve,
      tubularSegments,
      tubeRadius,
      radialSegments,
      false
    );
    const posCount = activeGeo.attributes.position.count;
    const colorArray = new Float32Array(posCount * 3);

    const ringVerts = radialSegments + 1;
    for (let seg = 0; seg <= tubularSegments; seg++) {
      const u = seg / tubularSegments;
      const cIdx = Math.min(
        this.routeColors.length - 1,
        Math.floor(u * (this.routeColors.length - 1))
      );
      const col = this.routeColors[cIdx];
      for (let r = 0; r < ringVerts; r++) {
        const vIdx = (seg * ringVerts + r) * 3;
        if (vIdx + 2 < colorArray.length) {
          colorArray[vIdx] = col.r;
          colorArray[vIdx + 1] = col.g;
          colorArray[vIdx + 2] = col.b;
        }
      }
    }
    activeGeo.setAttribute('color', new THREE.BufferAttribute(colorArray, 3));
    this.totalTubeIndices = activeGeo.index ? activeGeo.index.count : 0;

    const activeMat = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.25,
      metalness: 0.15,
      emissive: new THREE.Color(0xffffff),
      emissiveIntensity: 0.18
    });
    this.activeRouteMesh = new THREE.Mesh(activeGeo, activeMat);
    this.routeGroup.add(this.activeRouteMesh);

    // 3. 3D Vertical Elevation Curtain dropping from route down to baseEle (y = 0)
    const curtainPositions: number[] = [];
    const curtainColors: number[] = [];
    for (let i = 0; i < this.routeLocalPoints.length - 1; i++) {
      const p1 = this.routeLocalPoints[i];
      const p2 = this.routeLocalPoints[i + 1];
      const c1 = this.routeColors[i];
      const c2 = this.routeColors[i + 1];

      curtainPositions.push(p1.x, p1.y, p1.z, p2.x, p2.y, p2.z, p2.x, 0, p2.z);
      curtainPositions.push(p1.x, p1.y, p1.z, p2.x, 0, p2.z, p1.x, 0, p1.z);

      curtainColors.push(c1.r, c1.g, c1.b, c2.r, c2.g, c2.b, c2.r * 0.4, c2.g * 0.4, c2.b * 0.4);
      curtainColors.push(c1.r, c1.g, c1.b, c2.r * 0.4, c2.g * 0.4, c2.b * 0.4, c1.r * 0.4, c1.g * 0.4, c1.b * 0.4);
    }

    const curtainGeo = new THREE.BufferGeometry();
    curtainGeo.setAttribute('position', new THREE.Float32BufferAttribute(curtainPositions, 3));
    curtainGeo.setAttribute('color', new THREE.Float32BufferAttribute(curtainColors, 3));

    const curtainMat = new THREE.MeshBasicMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 0.36,
      side: THREE.DoubleSide,
      depthWrite: false
    });
    this.curtainMesh = new THREE.Mesh(curtainGeo, curtainMat);
    this.routeGroup.add(this.curtainMesh);
  }

  public renderFrame(
    width: number,
    height: number,
    params: RidgereelRenderParams
  ): HTMLCanvasElement {
    if (this.renderer.domElement.width !== width || this.renderer.domElement.height !== height) {
      this.renderer.setSize(width, height, false);
    }
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();

    // Update sky and fog theme
    if (params.theme === 'sport-light') {
      this.scene.background = new THREE.Color(0xdbeafe);
      this.scene.fog = new THREE.FogExp2(0xe2e8f0, 0.000032);
    } else if (params.theme === 'neon') {
      this.scene.background = new THREE.Color(0x050510);
      this.scene.fog = new THREE.FogExp2(0x09061c, 0.000038);
    } else {
      this.scene.background = new THREE.Color(0x090f1d);
      this.scene.fog = new THREE.FogExp2(0x0f172a, 0.000036);
    }

    // Apply vertical exaggeration smoothly via Y scale on terrain and route groups
    const totalExag = this.baseAutoExag * params.terrainExaggeration;
    this.terrainGroup.scale.set(1, totalExag, 1);
    this.routeGroup.scale.set(1, totalExag, 1);

    // Progressive draw range for the active 3D route tube
    if (this.activeRouteMesh && this.totalTubeIndices > 0) {
      const activeCount = Math.floor(clamp(params.routeU, 0, 1) * (this.totalTubeIndices / 3)) * 3;
      this.activeRouteMesh.geometry.setDrawRange(0, Math.max(3, activeCount));
    }

    if (this.contourMesh) {
      this.contourMesh.visible = params.showContourLines;
    }

    if (this.curtainMesh) {
      this.curtainMesh.visible = params.showElevationCurtain;
      const totalCurtainVerts = (this.routeLocalPoints.length - 1) * 6;
      const activeCurtainVerts = Math.floor(clamp(params.routeU, 0, 1) * (this.routeLocalPoints.length - 1)) * 6;
      this.curtainMesh.geometry.setDrawRange(0, Math.max(6, Math.min(totalCurtainVerts, activeCurtainVerts)));
    }

    // Position 3D Rider Avatar at current point on route
    if (this.routeLocalPoints.length > 1) {
      const fIdx = clamp(params.routeU, 0, 1) * (this.routeLocalPoints.length - 1);
      const i0 = Math.floor(fIdx);
      const i1 = Math.min(this.routeLocalPoints.length - 1, i0 + 1);
      const frac = fIdx - i0;

      const p0 = this.routeLocalPoints[i0];
      const p1 = this.routeLocalPoints[i1];
      const curPos = new THREE.Vector3().lerpVectors(p0, p1, frac);
      curPos.y *= totalExag;

      this.riderGroup.position.copy(curPos);
      this.riderGroup.visible = params.showRiderAvatar;

      // Orient rider cone along direction of travel
      const lookIdx = Math.min(this.routeLocalPoints.length - 1, i0 + 3);
      const targetPt = this.routeLocalPoints[lookIdx].clone();
      targetPt.y *= totalExag;
      if (targetPt.distanceToSquared(curPos) > 0.1) {
        this.riderGroup.lookAt(targetPt);
      }

      // Dynamic scale based on camera distance so rider beacon is always crisp and visible
      const camDist = params.cameraPosition.distanceTo(curPos);
      const dynScale = clamp(camDist / 950, 0.35, 3.2);
      this.riderGroup.scale.setScalar(dynScale);

      const activeCol = new THREE.Color(params.activeColorHex);
      if (this.riderHalo) {
        (this.riderHalo.material as THREE.MeshBasicMaterial).color.copy(activeCol);
      }
      if (this.riderCone) {
        const mat = this.riderCone.material as THREE.MeshStandardMaterial;
        mat.color.copy(activeCol);
        mat.emissive.copy(activeCol);
      }
      if (this.riderLight) {
        this.riderLight.color.copy(activeCol);
      }
    }

    // Position Camera & Target
    this.camera.position.copy(params.cameraPosition);
    this.camera.up.set(0, 1, 0);
    this.camera.lookAt(params.cameraTarget);
    if (Math.abs(params.cameraRollRad) > 0.0005) {
      this.camera.rotateZ(params.cameraRollRad);
    }
    this.camera.updateMatrixWorld();

    this.renderer.render(this.scene, this.camera);
    return this.renderer.domElement;
  }

  public projectWorldToScreen(
    worldPos: THREE.Vector3,
    width: number,
    height: number
  ): { x: number; y: number; visible: boolean } {
    const v = worldPos.clone().project(this.camera);
    if (v.z < -1 || v.z > 1) {
      return { x: -9999, y: -9999, visible: false };
    }
    const x = (v.x * 0.5 + 0.5) * width;
    const y = (-(v.y * 0.5) + 0.5) * height;
    return { x, y, visible: true };
  }

  private clearGroup(group: THREE.Group) {
    while (group.children.length > 0) {
      const child = group.children[0] as THREE.Mesh;
      if (child.geometry) child.geometry.dispose();
      if (child.material) {
        if (Array.isArray(child.material)) {
          child.material.forEach((m) => m.dispose());
        } else {
          child.material.dispose();
        }
      }
      group.remove(child);
    }
  }

  public dispose() {
    this.clearGroup(this.terrainGroup);
    this.clearGroup(this.routeGroup);
    this.clearGroup(this.riderGroup);
    this.renderer.dispose();
  }
}
