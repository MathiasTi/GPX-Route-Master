import { HoverPointTelemetry } from '../../domain/telemetry/pointMetricsEngine';

/**
 * Generates an SVG heart icon string for zero-overhead HTML injection into Leaflet divIcon.
 */
function renderHeartSvg(color: string = '#ef4444'): string {
  return `<svg width="11" height="11" viewBox="0 0 24 24" fill="${color}" stroke="${color}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block; vertical-align:middle;">
    <path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"/>
  </svg>`;
}

/**
 * Generates an SVG gauge/mountain icon for slope.
 */
function renderSlopeSvg(color: string = '#10b981'): string {
  return `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block; vertical-align:middle;">
    <polyline points="22 7 13.5 15.5 8.5 10.5 2 17"/>
    <polyline points="16 7 22 7 22 13"/>
  </svg>`;
}

/**
 * Generates an SVG lightning bolt for wattage.
 */
function renderBoltSvg(color: string = '#f59e0b'): string {
  return `<svg width="10" height="10" viewBox="0 0 24 24" fill="${color}" stroke="${color}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block; vertical-align:middle;">
    <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>
  </svg>`;
}

/**
 * Generates a 5-segment mini visualizer bar for the 5 heart rate zones.
 */
function renderHeartRateZoneSegments(activeZone: number, activeColor: string): string {
  const zoneColors = ['#3b82f6', '#10b981', '#f59e0b', '#f97316', '#ef4444'];
  
  const bars = [1, 2, 3, 4, 5].map(z => {
    const isCurrent = z === activeZone;
    const bg = isCurrent ? activeColor : 'rgba(255, 255, 255, 0.2)';
    const height = isCurrent ? '7px' : '4px';
    const opacity = isCurrent ? '1' : '0.4';
    const shadow = isCurrent ? `box-shadow: 0 0 6px ${activeColor};` : '';
    
    return `<div style="flex: 1; height: ${height}; background: ${bg}; border-radius: 2px; opacity: ${opacity}; ${shadow} transition: all 0.2s;"></div>`;
  }).join('');

  return `<div style="display: flex; gap: 2.5px; align-items: flex-end; width: 100%; height: 8px; margin-top: 3px;">${bars}</div>`;
}

/**
 * Builds the modern, compact card HTML representation for a hovered track coordinate on the Leaflet map.
 */
export function buildMapHoverCardHtml(telemetry: HoverPointTelemetry): string {
  const { elevationM, slope, heartRate, powerWatts, speedKmh, timeFormatted, durationEstimate } = telemetry;

  // Header subtitle: prefer absolute timestamp or elapsed duration
  const timeDisplay = timeFormatted ?? durationEstimate ?? '';

  // Heart rate section
  let hrContentHtml = '';
  if (heartRate) {
    const hrColor = heartRate.colorHex;
    const miniZoneBar = renderHeartRateZoneSegments(heartRate.zoneNumber, hrColor);

    hrContentHtml = `
      <div style="background: rgba(255, 255, 255, 0.05); border: 1px solid rgba(255, 255, 255, 0.08); border-radius: 8px; padding: 5px 7px; min-width: 90px; flex: 1;">
        <div style="display: flex; align-items: center; justify-content: space-between; gap: 4px;">
          <div style="display: flex; align-items: center; gap: 3px;">
            ${renderHeartSvg(hrColor)}
            <span style="font-family: ui-monospace, monospace; font-size: 11px; font-weight: 800; color: #ffffff; letter-spacing: -0.02em;">
              ${heartRate.bpm} <span style="font-size: 8px; font-weight: 500; color: #94a3b8;">bpm</span>
            </span>
          </div>
          <span style="font-size: 8.5px; font-weight: 700; color: ${hrColor}; background: ${hrColor}20; border: 1px solid ${hrColor}40; border-radius: 4px; padding: 1px 4px; text-transform: uppercase;">
            ${heartRate.label}
          </span>
        </div>
        ${miniZoneBar}
        <div style="display: flex; justify-content: space-between; margin-top: 2px; font-size: 7.5px; color: #94a3b8; font-weight: 600;">
          <span style="color: ${hrColor};">${heartRate.name}</span>
          <span>${heartRate.percentOfMax}%</span>
        </div>
      </div>
    `;
  }

  // Slope section
  const slopeColor = slope.colorHex;
  const slopeContentHtml = `
    <div style="background: rgba(255, 255, 255, 0.05); border: 1px solid rgba(255, 255, 255, 0.08); border-radius: 8px; padding: 5px 7px; min-width: 90px; flex: 1;">
      <div style="display: flex; align-items: center; justify-content: space-between; gap: 4px;">
        <div style="display: flex; align-items: center; gap: 3px;">
          ${renderSlopeSvg(slopeColor)}
          <span style="font-family: ui-monospace, monospace; font-size: 11px; font-weight: 800; color: #ffffff; letter-spacing: -0.02em;">
            ${slope.formatted}
          </span>
        </div>
        <span style="font-size: 8.5px; font-weight: 700; color: ${slopeColor}; background: ${slopeColor}20; border: 1px solid ${slopeColor}40; border-radius: 4px; padding: 1px 4px; text-transform: uppercase;">
          ${slope.arrow} ${slope.label}
        </span>
      </div>
      <div style="margin-top: 4px; font-size: 8px; color: #94a3b8; display: flex; justify-content: space-between; font-weight: 600;">
        <span>Aktuelle Steigung</span>
        <span style="color: ${slopeColor}; font-weight: 700;">${Math.abs(slope.slopePercent) >= 8 ? 'Steil' : 'Normal'}</span>
      </div>
    </div>
  `;

  // Complementary chips (Power, Speed)
  const chips: string[] = [];
  if (powerWatts !== null && powerWatts > 0) {
    chips.push(`
      <span style="display: inline-flex; align-items: center; gap: 2px; font-size: 8.5px; font-weight: 700; color: #f59e0b; background: rgba(245, 158, 11, 0.12); border: 1px solid rgba(245, 158, 11, 0.25); border-radius: 4px; padding: 1px 5px;">
        ${renderBoltSvg('#f59e0b')} ${powerWatts}W
      </span>
    `);
  }
  if (speedKmh !== null && speedKmh > 0) {
    chips.push(`
      <span style="display: inline-flex; align-items: center; gap: 2px; font-size: 8.5px; font-weight: 700; color: #38bdf8; background: rgba(56, 189, 248, 0.12); border: 1px solid rgba(56, 189, 248, 0.25); border-radius: 4px; padding: 1px 5px;">
        ${speedKmh} km/h
      </span>
    `);
  }

  const chipsRowHtml = chips.length > 0 
    ? `<div style="display: flex; gap: 4px; margin-top: 5px;">${chips.join('')}</div>`
    : '';

  // Main Card Assembly
  return `
    <div style="position: relative; pointer-events: none;">
      <!-- Floating Modern Card -->
      <div style="
        position: absolute; 
        bottom: 14px; 
        left: 50%; 
        transform: translateX(-50%); 
        width: max-content; 
        max-width: 250px; 
        background: rgba(15, 23, 42, 0.94); 
        backdrop-filter: blur(12px); 
        -webkit-backdrop-filter: blur(12px); 
        border: 1px solid rgba(255, 255, 255, 0.15); 
        border-radius: 12px; 
        box-shadow: 0 12px 30px -4px rgba(0, 0, 0, 0.45), 0 4px 10px rgba(0, 0, 0, 0.3); 
        padding: 7px 9px; 
        color: #f8fafc; 
        z-index: 9999;
      ">
        <!-- Top bar: Time & Elevation -->
        <div style="display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 5px; border-bottom: 1px solid rgba(255, 255, 255, 0.08); padding-bottom: 4px;">
          <div style="display: flex; align-items: center; gap: 4px; font-size: 9px; font-weight: 600; color: #cbd5e1; font-family: ui-monospace, monospace;">
            <span style="display: inline-block; width: 5px; height: 5px; border-radius: 50%; background: #10b981; box-shadow: 0 0 5px #10b981;"></span>
            <span>${timeDisplay || 'Streckenpunkt'}</span>
          </div>
          ${elevationM !== null ? `
            <div style="font-family: ui-monospace, monospace; font-size: 9px; font-weight: 800; color: #38bdf8; background: rgba(56, 189, 248, 0.12); border: 1px solid rgba(56, 189, 248, 0.25); border-radius: 4px; padding: 1px 5px;">
              ${elevationM} m
            </div>
          ` : ''}
        </div>

        <!-- Telemetry Data Columns: Slope & HR Zone -->
        <div style="display: flex; gap: 5px; align-items: stretch;">
          ${slopeContentHtml}
          ${hrContentHtml}
        </div>

        ${chipsRowHtml}

        <!-- Bottom Caret Stem -->
        <div style="
          position: absolute; 
          bottom: -5px; 
          left: 50%; 
          transform: translateX(-50%) rotate(45deg); 
          width: 10px; 
          height: 10px; 
          background: rgba(15, 23, 42, 0.94); 
          border-right: 1px solid rgba(255, 255, 255, 0.15); 
          border-bottom: 1px solid rgba(255, 255, 255, 0.15);
        "></div>
      </div>

      <!-- Center Anchor Dot -->
      <div style="
        position: absolute; 
        top: -6px; 
        left: -6px; 
        width: 12px; 
        height: 12px; 
        border-radius: 50%; 
        background: #10b981; 
        border: 2px solid #ffffff; 
        box-shadow: 0 0 8px rgba(16, 185, 129, 0.9), 0 2px 4px rgba(0, 0, 0, 0.3);
      "></div>
    </div>
  `;
}
