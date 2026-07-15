#!/usr/bin/env python3
import sys
import os
import sqlite3
import json
import re
import math
from datetime import datetime

def format_to_local_date_string(val):
    if val is None:
        return None
    val_str = str(val).strip()
    if not val_str:
        return None
        
    # YYYY-MM-DD
    if re.match(r'^\d{4}-\d{2}-\d{2}$', val_str):
        return val_str
    # starts with YYYY-MM-DD (e.g. YYYY-MM-DD HH:MM:SS)
    if re.match(r'^\d{4}-\d{2}-\d{2}', val_str):
        return val_str.split(' ')[0]
        
    try:
        num = float(val_str)
        if num > 100000000000:
            # unix ms
            dt = datetime.fromtimestamp(num / 1000.0)
        elif 631065600 < num < 2000000000:
            # unix seconds
            dt = datetime.fromtimestamp(num)
        elif 0 < num < 1000000000:
            # Garmin seconds (offset 631065600)
            dt = datetime.fromtimestamp(num + 631065600)
        else:
            dt = datetime.fromtimestamp(num)
        return dt.strftime('%Y-%m-%d')
    except Exception:
        pass
        
    for fmt in ('%Y-%m-%dT%H:%M:%S', '%Y-%m-%dT%H:%M:%S.%fZ', '%Y-%m-%d %H:%M:%S', '%Y/%m/%d %H:%M:%S', '%d.%m.%Y', '%Y-%m-%d'):
        try:
            return datetime.strptime(val_str, fmt).strftime('%Y-%m-%d')
        except Exception:
            pass
    return None

def format_point_time(val):
    if not val:
        return None
    try:
        num = float(val)
        if num > 100000000000:
            dt = datetime.utcfromtimestamp(num / 1000.0)
        elif 631065600 < num < 2000000000:
            dt = datetime.utcfromtimestamp(num)
        elif 0 < num < 1000000000:
            dt = datetime.utcfromtimestamp(num + 631065600)
        else:
            dt = datetime.utcfromtimestamp(num)
        return dt.strftime('%Y-%m-%dT%H:%M:%SZ')
    except Exception:
        pass
    return str(val)

def normalize_coordinate(val, is_lng=False, force_semicircle=False):
    if val is None:
        return None
    try:
        val = float(val)
    except (ValueError, TypeError):
        return None
        
    abs_val = abs(val)
    if abs_val <= 180:
        return val
        
    max_limit = 180 if is_lng else 90
    
    semi = val * 180.0 / 2147483648.0
    e7 = val / 10000000.0
    e6 = val / 1000000.0
    e5 = val / 100000.0
    
    candidates = [
        {'name': 'semicircles', 'val': semi},
        {'name': 'e7', 'val': e7},
        {'name': 'e6', 'val': e6},
        {'name': 'e5', 'val': e5}
    ]
    
    # Calculate divisibility bonuses for this single value
    val_int = int(round(val))
    is_int = abs(val - val_int) < 1e-4
    
    e7_bonus = 0.0
    semi_bonus = 0.0
    
    if is_int:
        if val_int % 1000 == 0:
            e7_bonus += 2.0
        elif val_int % 100 == 0:
            e7_bonus += 1.2
        elif val_int % 10 == 0:
            e7_bonus += 0.5
        else:
            semi_bonus += 0.5
            
    best_cand = candidates[0]
    best_score = -1
    
    for cand in candidates:
        abs_c = abs(cand['val'])
        if abs_c > max_limit:
            continue
            
        score = 0
        if abs_c >= 15 and abs_c <= 80:
            score += 10
        elif abs_c >= 2 and abs_c <= 85:
            score += 5
        else:
            score += 1
            
        if cand['name'] == 'semicircles':
            score += (0.1 + semi_bonus)
        elif cand['name'] == 'e7':
            score += (0.05 + e7_bonus)
        elif cand['name'] == 'e6':
            score += 0.02
        elif cand['name'] == 'e5':
            score += 0.01
            
        if force_semicircle and cand['name'] == 'semicircles':
            score += 100
            
        if score > best_score:
            best_score = score
            best_cand = cand
            
    return best_cand['val']

def calculate_haversine(lat1, lng1, lat2, lng2):
    R = 6371.0  # Earth's radius in km
    d_lat = math.radians(lat2 - lat1)
    d_lng = math.radians(lng2 - lng1)
    a = (math.sin(d_lat / 2) ** 2 +
         math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) * math.sin(d_lng / 2) ** 2)
    c = 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))
    return R * c

def calculate_total_track_distance(pts):
    d = 0.0
    for i in range(len(pts) - 1):
        p1 = pts[i]
        p2 = pts[i+1]
        if p1.get('lat') is not None and p1.get('lng') is not None and p2.get('lat') is not None and p2.get('lng') is not None:
            d += calculate_haversine(p1['lat'], p1['lng'], p2['lat'], p2['lng'])
    return d

def normalize_track_points_with_scale_detection(raw_points, target_distance_km=0.0):
    if not raw_points:
        return []
        
    sample = None
    for p in raw_points:
        if p.get('lat') is None or p.get('lng') is None:
            continue
        try:
            lat_val = abs(float(p['lat']))
            lng_val = abs(float(p['lng']))
        except (ValueError, TypeError):
            continue
        if lat_val > 1000000 or lng_val > 1000000 or (1 < lat_val <= 90) or (1 < lng_val <= 180):
            sample = p
            break
            
    if not sample:
        for p in raw_points:
            if p.get('lat') is not None and p.get('lng') is not None and p['lat'] != 0 and p['lng'] != 0:
                sample = p
                break
        if not sample:
            sample = raw_points[0]
            
    try:
        raw_lat = abs(float(sample.get('lat', 0)))
        raw_lng = abs(float(sample.get('lng', 0)))
    except (ValueError, TypeError):
        return raw_points
        
    candidates = [
        {'name': 'semicircles', 'scale': 180.0 / 2147483648.0},
        {'name': 'e7', 'scale': 1.0 / 10000000.0},
        {'name': 'e6', 'scale': 1.0 / 1000000.0},
        {'name': 'e5', 'scale': 1.0 / 100000.0}
    ]
    
    if raw_lat <= 180 and raw_lng <= 180 and raw_lat > 0.01 and raw_lng > 0.01:
        # Already in degrees
        normalized = []
        for p in raw_points:
            np = dict(p)
            try:
                np['lat'] = float(p['lat'])
                np['lng'] = float(p['lng'])
            except:
                pass
            normalized.append(np)
        return normalized
        
    best_candidate = candidates[0]
    
    if target_distance_km > 0.1:
        min_diff = float('inf')
        for cand in candidates:
            subset_pts = []
            for p in raw_points[:200]:
                try:
                    subset_pts.append({
                        'lat': float(p['lat']) * cand['scale'],
                        'lng': float(p['lng']) * cand['scale']
                    })
                except:
                    pass
            subset_dist = calculate_total_track_distance(subset_pts)
            est_full_dist = subset_dist * (len(raw_points) / max(1, len(raw_points[:200])))
            diff = abs(est_full_dist - target_distance_km)
            
            test_lat = raw_lat * cand['scale']
            test_lng = raw_lng * cand['scale']
            is_valid = abs(test_lat) <= 90 and abs(test_lng) <= 180
            
            if is_valid and diff < min_diff:
                min_diff = diff
                best_candidate = cand
        sys.stderr.write(f"[Scale-Detection] Detected scale '{best_candidate['name']}' using distance matching (Target: {target_distance_km} km)\n")
    else:
        # Detect if we should favor e7 or semicircles for the entire track
        e7_votes = 0
        semi_votes = 0
        for p in raw_points[:100]:
            try:
                lat_v = float(p['lat'])
                lat_int = int(round(lat_v))
                if abs(lat_v - lat_int) < 1e-4:
                    if lat_int % 10 == 0:
                        e7_votes += 1
                    else:
                        semi_votes += 1
            except:
                pass
                
        favor_e7 = False
        if e7_votes + semi_votes > 0:
            pct_div_10 = e7_votes / (e7_votes + semi_votes)
            if pct_div_10 > 0.3:
                favor_e7 = True
                
        best_score = -1
        for cand in candidates:
            test_lat = raw_lat * cand['scale']
            test_lng = raw_lng * cand['scale']
            is_valid = abs(test_lat) <= 90 and abs(test_lng) <= 180
            if not is_valid:
                continue
            score = 0
            if 15 <= abs(test_lat) <= 80:
                score += 10
            elif 2 <= abs(test_lat) <= 85:
                score += 5
            else:
                score += 1
                
            # Dynamic bias based on track points divisibility
            if cand['name'] == 'semicircles':
                score += (0.01 if favor_e7 else 0.5)
            elif cand['name'] == 'e7':
                score += (0.5 if favor_e7 else 0.01)
            elif cand['name'] == 'e6':
                score += 0.002
            elif cand['name'] == 'e5':
                score += 0.001
                
            if score > best_score:
                best_score = score
                best_candidate = cand
        sys.stderr.write(f"[Scale-Detection] Detected scale '{best_candidate['name']}' using range heuristics (Lat: {(raw_lat * best_candidate['scale']):.4f}, favor_e7: {favor_e7})\n")
        
    normalized = []
    for p in raw_points:
        np = dict(p)
        try:
            np['lat'] = float(p['lat']) * best_candidate['scale']
            np['lng'] = float(p['lng']) * best_candidate['scale']
        except:
            pass
        normalized.append(np)
        
    # GPS Gulf of Guinea noise filter
    has_on_land_point = False
    for p in normalized:
        if p.get('lat') is not None and p.get('lng') is not None:
            if abs(p['lat']) > 1 and abs(p['lng']) > 1 and abs(p['lat']) <= 90 and abs(p['lng']) <= 180:
                has_on_land_point = True
                break
                
    if has_on_land_point:
        original_count = len(normalized)
        filtered_normalized = []
        for p in normalized:
            if p.get('lat') is not None and p.get('lng') is not None:
                is_near_zero = abs(p['lat']) < 1 and abs(p['lng']) < 1
                if is_near_zero:
                    continue
            filtered_normalized.append(p)
        filtered_count = original_count - len(filtered_normalized)
        if filtered_count > 0:
            sys.stderr.write(f"[GPS-Filter] {filtered_count} ungültige GPS-Punkte nahe (0,0) (Gulf of Guinea) wurden als Sensorrauschen gefiltert.\n")
        normalized = filtered_normalized
        
    return normalized

def auto_normalize_elevations(points):
    if not points:
        return points
        
    valid_eles = []
    for p in points:
        if p.get('ele') is not None:
            try:
                valid_eles.append(float(p['ele']))
            except (ValueError, TypeError):
                pass
                
    if not valid_eles:
        return points
        
    min_raw = min(valid_eles)
    max_raw = max(valid_eles)
    avg_raw = sum(valid_eles) / len(valid_eles)
    
    candidates = [
        {'name': 'none', 'transform': lambda v: v},
        {'name': 'fit_raw', 'transform': lambda v: v / 5.0 - 500.0},
        {'name': 'centimeters', 'transform': lambda v: v / 100.0},
        {'name': 'decimeters', 'transform': lambda v: v / 10.0},
        {'name': 'millimeters', 'transform': lambda v: v / 1000.0}
    ]
    
    best_candidate = candidates[0]
    best_score = -float('inf')
    
    for cand in candidates:
        score = 0
        t_min = cand['transform'](min_raw)
        t_max = cand['transform'](max_raw)
        t_avg = cand['transform'](avg_raw)
        
        if t_min >= -100 and t_max <= 6000:
            score += 1000
        if t_min >= 0 and t_max <= 2500:
            score += 500
        if t_avg >= -50 and t_avg <= 3000:
            score += 300
        if 0 <= t_avg <= 1000:
            score += 150
        if t_max > 15000 or t_min < -500:
            score -= 5000
            
        if score > best_score:
            best_score = score
            best_candidate = cand
            
    if best_candidate['name'] != 'none':
        sys.stderr.write(f"[Elevation-Normalization] Automatische Skalierung gewählt: {best_candidate['name']} (MinRaw={min_raw:.1f}, MaxRaw={max_raw:.1f} -> MinNeu={best_candidate['transform'](min_raw):.1f}, MaxNeu={best_candidate['transform'](max_raw):.1f})\n")
        for p in points:
            if p.get('ele') is not None:
                try:
                    p['ele'] = round(best_candidate['transform'](float(p['ele'])), 1)
                except:
                    pass
    return points

def parse_path_json(json_str, target_distance_km=0.0):
    try:
        parsed = json_str
        if isinstance(json_str, str):
            parsed = json.loads(json_str)
        if not parsed:
            return None
            
        if isinstance(parsed, dict):
            for k, v in parsed.items():
                if isinstance(v, list):
                    parsed = v
                    break
                    
        if not isinstance(parsed, list):
            return None
            
        lat_index = 1
        lng_index = 0
        
        array_items = [item for item in parsed if isinstance(item, list)]
        if array_items:
            has_0_outside_lat = False
            has_1_outside_lat = False
            
            for pt in array_items:
                if len(pt) >= 2:
                    try:
                        val0 = float(pt[0])
                        val1 = float(pt[1])
                        d0 = normalize_coordinate(val0, False)
                        d1 = normalize_coordinate(val1, False)
                        if abs(d0) > 90:
                            has_0_outside_lat = True
                        if abs(d1) > 90:
                            has_1_outside_lat = True
                    except:
                        pass
                        
            if has_0_outside_lat and not has_1_outside_lat:
                lat_index = 1
                lng_index = 0
            elif has_1_outside_lat and not has_0_outside_lat:
                lat_index = 0
                lng_index = 1
            else:
                sum0 = 0
                sum1 = 0
                count = 0
                for pt in array_items[:50]:
                    if len(pt) >= 2:
                        try:
                            val0 = float(pt[0])
                            val1 = float(pt[1])
                            sum0 += normalize_coordinate(val0, False)
                            sum1 += normalize_coordinate(val1, False)
                            count += 1
                        except:
                            pass
                if count > 0:
                    avg0 = sum0 / count
                    avg1 = sum1 / count
                    optionA_in_ocean = (-15 <= avg0 <= 15) and (35 <= avg1 <= 65)
                    optionB_in_ocean = (-15 <= avg1 <= 15) and (35 <= avg0 <= 65)
                    if optionA_in_ocean and not optionB_in_ocean:
                        lat_index = 1
                        lng_index = 0
                    elif optionB_in_ocean and not optionA_in_ocean:
                        lat_index = 0
                        lng_index = 1
                    else:
                        is1Lat0Lng = (35 <= avg1 <= 65) and (-15 <= avg0 <= 30)
                        is0Lat1Lng = (35 <= avg0 <= 65) and (-15 <= avg1 <= 30)
                        if is1Lat0Lng and not is0Lat1Lng:
                            lat_index = 1
                            lng_index = 0
                            
        mapped_points = []
        for item in parsed:
            if not item:
                continue
            if isinstance(item, list):
                if len(item) >= 2:
                    try:
                        lat = float(item[lat_index])
                        lng = float(item[lng_index])
                        pt = {'lat': lat, 'lng': lng}
                        if len(item) >= 3 and item[2] is not None:
                            pt['ele'] = float(item[2])
                        if len(item) >= 4 and item[3]:
                            pt['time'] = format_point_time(item[3])
                        if len(item) >= 5 and item[4] is not None:
                            pt['hr'] = float(item[4])
                        if len(item) >= 6 and item[5] is not None:
                            pt['cadence'] = float(item[5])
                        if len(item) >= 7 and item[6] is not None:
                            pt['power'] = float(item[6])
                        if len(item) >= 8 and item[7] is not None:
                            pt['speed'] = float(item[7])
                        mapped_points.append(pt)
                    except:
                        pass
            elif isinstance(item, dict):
                lat_key = next((k for k in item if k.lower() in ["lat", "latitude", "lat_deg", "position_lat", "position_latitude", "y"]), None)
                lng_key = next((k for k in item if k.lower() in ["lng", "longitude", "lon", "lon_deg", "lng_deg", "position_lon", "position_longitude", "x"]), None)
                if lat_key and lng_key:
                    try:
                        lat = float(item[lat_key])
                        lng = float(item[lng_key])
                        pt = {'lat': lat, 'lng': lng}
                        
                        ele_key = next((k for k in item if k.lower() in ["ele", "elevation", "alt", "altitude", "altitude_m", "height", "enhanced_altitude", "enhanced_altitude_m"]), None)
                        time_key = next((k for k in item if k.lower() in ["time", "timestamp", "date", "ts", "time_val"]), None)
                        hr_key = next((k for k in item if k.lower() in ["hr", "heartrate", "heart_rate", "average_hr", "avg_hr", "hf", "herzfrequenz", "puls", "heartrate_bpm", "heart_rate_bpm"]), None)
                        cad_key = next((k for k in item if k.lower() in ["cadence", "cad", "average_cadence", "avg_cadence"]), None)
                        pow_key = next((k for k in item if k.lower() in ["power", "watts", "average_power", "avg_power"]), None)
                        spd_key = next((k for k in item if k.lower() in ["speed", "velocity", "enhanced_speed", "speed_m_s", "geschwindigkeit"]), None)
                        
                        if ele_key and item[ele_key] is not None:
                            pt['ele'] = float(item[ele_key])
                        if time_key and item[time_key]:
                            pt['time'] = format_point_time(item[time_key])
                        if hr_key and item[hr_key] is not None:
                            pt['hr'] = float(item[hr_key])
                        if cad_key and item[cad_key] is not None:
                            pt['cadence'] = float(item[cad_key])
                        if pow_key and item[pow_key] is not None:
                            pt['power'] = float(item[pow_key])
                        if spd_key and item[spd_key] is not None:
                            pt['speed'] = float(item[spd_key])
                        mapped_points.append(pt)
                    except:
                        pass
        normalized_points = normalize_track_points_with_scale_detection(mapped_points, target_distance_km)
        return auto_normalize_elevations(normalized_points)
    except Exception as e:
        sys.stderr.write(f"Failed to parse path_json: {e}\n")
        return None

def main():
    if len(sys.argv) < 3:
        sys.stderr.write("Usage: parse_garmin.py <source_db> <dest_db>\n")
        sys.exit(1)
        
    source_path = sys.argv[1]
    dest_path = sys.argv[2]
    
    if not os.path.exists(source_path):
        sys.stderr.write(f"Source database not found at {source_path}\n")
        sys.exit(1)
        
    sys.stderr.write(f"Opening source DB: {source_path}\n")
    src_conn = sqlite3.connect(source_path)
    src_conn.row_factory = sqlite3.Row
    src_cursor = src_conn.cursor()
    
    sys.stderr.write(f"Opening/creating destination DB: {dest_path}\n")
    dest_conn = sqlite3.connect(dest_path)
    dest_cursor = dest_conn.cursor()
    
    # 1. Inspect table names in source DB
    src_cursor.execute("SELECT name FROM sqlite_master WHERE type='table'")
    tables = [row['name'] for row in src_cursor.fetchall()]
    t_names = [t.lower() for t in tables]
    
    sys.stderr.write(f"Tables in source: {', '.join(tables)}\n")
    
    sleep_imported = 0
    weight_imported = 0
    stress_imported = 0
    rhr_imported = 0
    steps_imported = 0
    activities_imported = 0
    
    is_garmin_health_data = "sleep" in t_names and "body_composition" in t_names and "activity" in t_names
    
    if is_garmin_health_data:
        sys.stderr.write("Spezialisiertes Garmin-Health-Data-Schema erkannt (diegoscarabelli/garmin-health-data)\n")
        
        # 1. SLEEP
        if "sleep" in t_names:
            try:
                sys.stderr.write("[Sleep-Import] Analysiere Tabelle 'sleep'...\n")
                src_cursor.execute("PRAGMA table_info(sleep)")
                cols = [dict(r) for r in src_cursor.fetchall()]
                col_names_lower = [c['name'].lower() for c in cols]
                has_resting_hr = "resting_heart_rate" in col_names_lower
                has_sleep_time_sec = "sleep_time_seconds" in col_names_lower
                
                if has_sleep_time_sec:
                    resting_hr_sql = ", resting_heart_rate" if has_resting_hr else ""
                    query = f"""
                        SELECT 
                            calendar_date, 
                            sleep_time_seconds, 
                            deep_sleep_seconds, 
                            light_sleep_seconds, 
                            rem_sleep_seconds, 
                            awake_sleep_seconds
                            {resting_hr_sql}
                        FROM sleep 
                        WHERE calendar_date IS NOT NULL
                    """
                    src_cursor.execute(query)
                    rows = src_cursor.fetchall()
                    
                    for row in rows:
                        date_val = format_to_local_date_string(row['calendar_date'])
                        if not date_val:
                            continue
                            
                        try:
                            duration_sec = float(row['sleep_time_seconds'])
                            if math.isnan(duration_sec):
                                continue
                            duration_min = duration_sec / 60.0
                            
                            deep_min = float(row['deep_sleep_seconds']) / 60.0 if row['deep_sleep_seconds'] is not None else 0.0
                            light_min = float(row['light_sleep_seconds']) / 60.0 if row['light_sleep_seconds'] is not None else 0.0
                            rem_min = float(row['rem_sleep_seconds']) / 60.0 if row['rem_sleep_seconds'] is not None else 0.0
                            awake_min = float(row['awake_sleep_seconds']) / 60.0 if row['awake_sleep_seconds'] is not None else 0.0
                            
                            dest_cursor.execute("""
                                INSERT OR REPLACE INTO garmin_sleep (date, duration, deep, light, rem, awake)
                                VALUES (?, ?, ?, ?, ?, ?)
                            """, (date_val, duration_min, deep_min, light_min, rem_min, awake_min))
                            sleep_imported += 1
                            
                            if has_resting_hr and row['resting_heart_rate'] is not None:
                                rhr_val = float(row['resting_heart_rate'])
                                if not math.isnan(rhr_val) and rhr_val > 0:
                                    dest_cursor.execute("""
                                        INSERT OR REPLACE INTO garmin_rhr (date, rhr)
                                        VALUES (?, ?)
                                    """, (date_val, rhr_val))
                                    rhr_imported += 1
                        except Exception as row_err:
                            sys.stderr.write(f"Err sleep row: {row_err}\n")
                    sys.stderr.write(f"[Sleep-Import] Schlafdaten erfolgreich importiert. Schlaf-Einträge: {sleep_imported}, Ruhepuls: {rhr_imported}\n")
            except Exception as e:
                sys.stderr.write(f"[Sleep-Import-Fehler] Fehler: {e}\n")
                
        # 2. WEIGHT (body_composition)
        if "body_composition" in t_names:
            try:
                sys.stderr.write("[Weight-Import] Analysiere Tabelle 'body_composition'...\n")
                src_cursor.execute("SELECT timestamp, weight, bmi, body_fat FROM body_composition")
                rows = src_cursor.fetchall()
                for row in rows:
                    date_val = format_to_local_date_string(row['timestamp'])
                    if not date_val:
                        continue
                    try:
                        w_val = float(row['weight'])
                        if math.isnan(w_val):
                            continue
                        w_val = w_val / 1000.0  # grams to kg
                        
                        bmi_val = float(row['bmi']) if row['bmi'] is not None else None
                        fat_val = float(row['body_fat']) if row['body_fat'] is not None else None
                        
                        dest_cursor.execute("""
                            INSERT OR REPLACE INTO garmin_weight (date, weight, bmi, body_fat)
                            VALUES (?, ?, ?, ?)
                        """, (date_val, w_val, bmi_val, fat_val))
                        weight_imported += 1
                    except Exception as row_err:
                        pass
                sys.stderr.write(f"[Weight-Import] Gewichtsdaten erfolgreich importiert. Einträge: {weight_imported}\n")
            except Exception as e:
                sys.stderr.write(f"[Weight-Import-Fehler] Fehler: {e}\n")
                
        # 3. STRESS
        if "stress" in t_names:
            try:
                sys.stderr.write("[Stress-Import] Analysiere Tabelle 'stress' und aggregiere...\n")
                src_cursor.execute("SELECT timestamp, value FROM stress WHERE value >= 0")
                rows = src_cursor.fetchall()
                stress_by_date = {}
                for row in rows:
                    date_val = format_to_local_date_string(row['timestamp'])
                    if not date_val:
                        continue
                    try:
                        val = float(row['value'])
                        if math.isnan(val):
                            continue
                        if date_val not in stress_by_date:
                            stress_by_date[date_val] = {'sum': 0.0, 'count': 0}
                        stress_by_date[date_val]['sum'] += val
                        stress_by_date[date_val]['count'] += 1
                    except Exception:
                        pass
                for date_val, d in stress_by_date.items():
                    avg_stress = d['sum'] / d['count']
                    dest_cursor.execute("""
                        INSERT OR REPLACE INTO garmin_stress (date, avg_stress)
                        VALUES (?, ?)
                    """, (date_val, avg_stress))
                    stress_imported += 1
                sys.stderr.write(f"[Stress-Import] Stressdaten erfolgreich aggregiert. Tage: {stress_imported}\n")
            except Exception as e:
                sys.stderr.write(f"[Stress-Import-Fehler] Fehler: {e}\n")
                
        # 4. STEPS
        if "steps" in t_names:
            try:
                sys.stderr.write("[Steps-Import] Analysiere Tabelle 'steps'...\n")
                src_cursor.execute("SELECT timestamp, value FROM steps")
                rows = src_cursor.fetchall()
                steps_by_date = {}
                for row in rows:
                    date_val = format_to_local_date_string(row['timestamp'])
                    if not date_val:
                        continue
                    try:
                        val = int(row['value'])
                        steps_by_date[date_val] = steps_by_date.get(date_val, 0) + val
                    except Exception:
                        pass
                for date_val, steps_val in steps_by_date.items():
                    dest_cursor.execute("""
                        INSERT OR REPLACE INTO garmin_steps (date, steps, calories, distance)
                        VALUES (?, ?, ?, ?)
                    """, (date_val, steps_val, None, None))
                    steps_imported += 1
                sys.stderr.write(f"[Steps-Import] Schrittdaten erfolgreich aggregiert. Tage: {steps_imported}\n")
            except Exception as e:
                sys.stderr.write(f"[Steps-Import-Fehler] Fehler: {e}\n")
                
        # 5. ACTIVITIES (activity)
        if "activity" in t_names:
            try:
                sys.stderr.write("[Activity-Import] Analysiere Tabelle 'activity'...\n")
                src_cursor.execute("PRAGMA table_info(activity)")
                cols = [dict(r) for r in src_cursor.fetchall()]
                col_names_lower = [c['name'].lower() for c in cols]
                
                has_average_hr = "average_hr" in col_names_lower
                has_calories = "calories" in col_names_lower
                has_user_id = "user_id" in col_names_lower
                
                desc_col = next((c['name'] for c in cols if c['name'].lower() in ["description", "notes", "comment", "activity_description", "activity_description_key"] or "description" in c['name'].lower() or "comment" in c['name'].lower()), None)
                loc_col = next((c['name'] for c in cols if c['name'].lower() in ["location", "place", "city", "town", "start_location", "location_name", "start_location_name"] or "location_name" in c['name'].lower() or "start_location" in c['name'].lower()), None)
                ascent_col = next((c['name'] for c in cols if c['name'].lower() in ["ascent", "total_ascent", "elevation_gain", "gain", "ascent_m", "total_elevation_gain", "elevationgain", "totalascent", "totalascentm", "total_ascent_m", "totalelevationgain", "elevation_gain_m", "elevationgainm", "elevation_gain_meters", "elevationgainmeters", "climb", "total_climb"] or "ascent" in c['name'].lower() or "elevation_gain" in c['name'].lower() or "elevationgain" in c['name'].lower() or "gain" in c['name'].lower() or "climb" in c['name'].lower() or c['name'].lower() == "total_climb"), None)
                descent_col = next((c['name'] for c in cols if c['name'].lower() in ["descent", "total_descent", "elevation_loss", "loss", "descent_m", "total_elevation_loss", "elevationloss", "totaldescent", "totaldescentm", "total_descent_m", "totalelevationloss", "elevation_loss_m", "elevationlossm", "elevation_loss_meters", "elevationlossmeters", "drop", "total_drop"] or "descent" in c['name'].lower() or "elevation_loss" in c['name'].lower() or "elevationloss" in c['name'].lower() or "loss" in c['name'].lower() or "drop" in c['name'].lower() or c['name'].lower() == "total_drop"), None)
                
                polyline_col = next((c['name'] for c in cols if c['name'].lower() in ["polyline", "map_polyline", "summary_polyline", "encoded_polyline"] or "polyline" in c['name'].lower()), None)
                points_json_col = next((c['name'] for c in cols if c['name'].lower() in ["points_json", "points", "track_json", "pointsjson", "activity_path", "activitypath", "activity_path_json", "path_json", "coordinates_json"] or "points_json" in c['name'].lower() or "path_json" in c['name'].lower() or "coordinates_json" in c['name'].lower()), None)
                
                start_lat_col = next((c['name'] for c in cols if c['name'].lower() in ["start_latitude", "start_lat", "latitude", "startlat"]), None)
                start_lng_col = next((c['name'] for c in cols if c['name'].lower() in ["start_longitude", "start_lon", "longitude", "startlng", "startlong"]), None)
                
                # Scan for points table (activity_ts_metric, activity_path, etc.)
                points_table = None
                pt_lat_col = None
                pt_lng_col = None
                pt_act_id_col = None
                pt_json_col = None
                pt_ele_col = None
                pt_time_col = None
                
                for table in tables:
                    if table.lower() in ["activity", "sleep", "body_composition", "stress", "steps", "rhr"]:
                        continue
                    src_cursor.execute(f"PRAGMA table_info({table})")
                    t_cols = [dict(r) for r in src_cursor.fetchall()]
                    t_col_names = [tc['name'].lower() for tc in t_cols]
                    
                    lat_c = next((tc['name'] for tc in t_cols if tc['name'].lower() in ["latitude", "lat", "lat_deg", "position_lat", "position_latitude"] or tc['name'].lower() == "lat" or tc['name'].lower() == "latitude" or "position_lat" in tc['name'].lower() or "position_latitude" in tc['name'].lower() or "lat_deg" in tc['name'].lower() or tc['name'].lower() == "y"), None)
                    lng_c = next((tc['name'] for tc in t_cols if tc['name'].lower() in ["longitude", "lng", "lon", "lon_deg", "position_lon", "position_longitude"] or tc['name'].lower() in ["lng", "longitude", "lon"] or "position_lon" in tc['name'].lower() or "position_longitude" in tc['name'].lower() or "lon_deg" in tc['name'].lower() or "lng_deg" in tc['name'].lower() or tc['name'].lower() == "x"), None)
                    act_id_c = next((tc['name'] for tc in t_cols if tc['name'].lower() in ["activity_id", "activityid", "track_id", "trackid", "parent_id", "id"] or "activity_id" in tc['name'].lower() or "activityid" in tc['name'].lower() or "track_id" in tc['name'].lower() or "trackid" in tc['name'].lower()), None)
                    json_c = next((tc['name'] for tc in t_cols if tc['name'].lower() in ["path_json", "points_json", "points", "track_json", "coordinates_json", "pathjson", "path", "track", "route", "coordinates", "activity_path", "activitypath", "activity_path_json"] or "path_json" in tc['name'].lower() or "points_json" in tc['name'].lower() or "track_json" in tc['name'].lower() or "coordinates_json" in tc['name'].lower()), None)
                    
                    if json_c and act_id_c:
                        points_table = table
                        pt_act_id_col = act_id_c
                        pt_json_col = json_c
                        break
                    elif lat_c and lng_c and act_id_c:
                        points_table = table
                        pt_lat_col = lat_c
                        pt_lng_col = lng_c
                        pt_act_id_col = act_id_c
                        pt_ele_col = next((tc['name'] for tc in t_cols if tc['name'].lower() in ["elevation", "ele", "alt", "altitude", "altitude_m", "enhanced_altitude", "enhanced_altitude_m", "height", "ele_m", "avg_altitude", "max_altitude"] or "elevation" in tc['name'].lower() or "altitude" in tc['name'].lower() or "alt" in tc['name'].lower() or "height" in tc['name'].lower() or tc['name'].lower() == "ele" or tc['name'].lower().startswith("ele_")), None)
                        pt_time_col = next((tc['name'] for tc in t_cols if tc['name'].lower() in ["time", "timestamp", "date", "ts", "time_val"] or "time" in tc['name'].lower() or "timestamp" in tc['name'].lower() or tc['name'].lower() == "ts"), None)
                        break
                        
                sys.stderr.write(f"[Activity-Import] Spaltendetektion: points_table={points_table}, pt_act_id_col={pt_act_id_col}\n")
                
                # Fetch activities
                extra_cols = []
                if has_user_id: extra_cols.append("user_id")
                if has_calories: extra_cols.append("calories")
                if has_average_hr: extra_cols.append("average_hr")
                if desc_col: extra_cols.append(desc_col)
                if loc_col: extra_cols.append(loc_col)
                if polyline_col: extra_cols.append(polyline_col)
                if points_json_col: extra_cols.append(points_json_col)
                if ascent_col: extra_cols.append(ascent_col)
                if descent_col: extra_cols.append(descent_col)
                if start_lat_col: extra_cols.append(start_lat_col)
                if start_lng_col: extra_cols.append(start_lng_col)
                
                extra_sql = ", " + ", ".join(extra_cols) if extra_cols else ""
                query = f"""
                    SELECT 
                        activity_id, 
                        activity_name, 
                        activity_type_key, 
                        start_ts, 
                        distance, 
                        duration
                        {extra_sql}
                    FROM activity
                """
                src_cursor.execute(query)
                rows = src_cursor.fetchall()
                
                sys.stderr.write(f"[Activity-Import] {len(rows)} Aktivitäten geladen, verarbeite...\n")
                
                for row in rows:
                    date_val = format_to_local_date_string(row['start_ts'])
                    if not date_val:
                        continue
                        
                    id_val = str(row['activity_id'])
                    name_val = str(row['activity_name']) if row['activity_name'] else "Activity"
                    type_val = str(row['activity_type_key']) if row['activity_type_key'] else "cycling"
                    
                    try:
                        dist_val = float(row['distance']) if row['distance'] is not None else 0.0
                        dist_val = dist_val / 1000.0  # meters to km
                    except:
                        dist_val = 0.0
                        
                    try:
                        dur_val = float(row['duration']) if row['duration'] is not None else 0.0
                    except:
                        dur_val = 0.0
                        
                    cal_val = float(row['calories']) if has_calories and row['calories'] is not None else None
                    hr_val = float(row['average_hr']) if has_average_hr and row['average_hr'] is not None else None
                    desc_val = str(row[desc_col]) if desc_col and row[desc_col] else None
                    loc_val = str(row[loc_col]) if loc_col and row[loc_col] else None
                    user_id_val = str(row['user_id']) if has_user_id and row['user_id'] else None
                    
                    raw_start_lat = float(row[start_lat_col]) if start_lat_col and row[start_lat_col] is not None else None
                    raw_start_lng = float(row[start_lng_col]) if start_lng_col and row[start_lng_col] is not None else None
                    start_lat = None
                    start_lng = None
                    if raw_start_lat is not None and raw_start_lng is not None:
                        start_lat = normalize_coordinate(raw_start_lat, False)
                        start_lng = normalize_coordinate(raw_start_lng, True)
                        
                    final_ascent = float(row[ascent_col]) if ascent_col and row[ascent_col] is not None else None
                    final_descent = float(row[descent_col]) if descent_col and row[descent_col] is not None else None
                    
                    # Fetch extra metrics if elevation gain is 0/None
                    if final_ascent is None or final_descent is None or final_ascent == 0 or final_descent == 0:
                        try:
                            if "cycling_agg_metrics" in t_names:
                                src_cursor.execute("SELECT elevation_gain, elevation_loss FROM cycling_agg_metrics WHERE activity_id = ? LIMIT 1", (row['activity_id'],))
                                agg = src_cursor.fetchone()
                                if agg:
                                    if (final_ascent is None or final_ascent == 0) and agg['elevation_gain'] is not None:
                                        final_ascent = float(agg['elevation_gain'])
                                    if (final_descent is None or final_descent == 0) and agg['elevation_loss'] is not None:
                                        final_descent = float(agg['elevation_loss'])
                            if (final_ascent is None or final_descent is None or final_ascent == 0 or final_descent == 0) and "running_agg_metrics" in t_names:
                                src_cursor.execute("SELECT elevation_gain, elevation_loss FROM running_agg_metrics WHERE activity_id = ? LIMIT 1", (row['activity_id'],))
                                agg = src_cursor.fetchone()
                                if agg:
                                    if (final_ascent is None or final_ascent == 0) and agg['elevation_gain'] is not None:
                                        final_ascent = float(agg['elevation_gain'])
                                    if (final_descent is None or final_descent == 0) and agg['elevation_loss'] is not None:
                                        final_descent = float(agg['elevation_loss'])
                        except Exception as e:
                            pass
                            
                    points_json_val = None
                    
                    # Try activity_ts_metric pivot query FIRST
                    if "activity_ts_metric" in t_names:
                        try:
                            src_cursor.execute("PRAGMA table_info(activity_ts_metric)")
                            m_cols = [dict(r) for r in src_cursor.fetchall()]
                            m_col_names = [mc['name'].lower() for mc in m_cols]
                            
                            has_act_id = any(n in ["activity_id", "activityid"] for n in m_col_names)
                            has_name = "name" in m_col_names
                            has_timestamp = any(n in ["timestamp", "time", "ts"] for n in m_col_names)
                            has_value = any(n in ["value", "val"] for n in m_col_names)
                            
                            if has_act_id and has_name and has_timestamp and has_value:
                                act_id_col_ts = next(mc['name'] for mc in m_cols if mc['name'].lower() in ["activity_id", "activityid"])
                                ts_col_ts = next(mc['name'] for mc in m_cols if mc['name'].lower() in ["timestamp", "time", "ts"])
                                val_col_ts = next(mc['name'] for mc in m_cols if mc['name'].lower() in ["value", "val"])
                                name_col_ts = "name"
                                
                                pts_query = f"""
                                    SELECT 
                                        {ts_col_ts} AS timestamp,
                                        MAX(CASE WHEN LOWER({name_col_ts}) LIKE '%position_lat%' 
                                                   OR LOWER({name_col_ts}) LIKE '%positionlat%' 
                                                   OR LOWER({name_col_ts}) LIKE '%pos_lat%' 
                                                   OR LOWER({name_col_ts}) LIKE '%poslat%' 
                                                   OR LOWER({name_col_ts}) LIKE '%lat_deg%' 
                                                   OR LOWER({name_col_ts}) LIKE '%latitude%' 
                                                   OR LOWER({name_col_ts}) = 'lat' 
                                                 THEN {val_col_ts} END) AS lat,
                                        MAX(CASE WHEN LOWER({name_col_ts}) LIKE '%position_long%' 
                                                   OR LOWER({name_col_ts}) LIKE '%position_lng%' 
                                                   OR LOWER({name_col_ts}) LIKE '%positionlong%' 
                                                   OR LOWER({name_col_ts}) LIKE '%positionlng%' 
                                                   OR LOWER({name_col_ts}) LIKE '%pos_long%' 
                                                   OR LOWER({name_col_ts}) LIKE '%pos_lng%' 
                                                   OR LOWER({name_col_ts}) LIKE '%poslong%' 
                                                   OR LOWER({name_col_ts}) LIKE '%poslng%' 
                                                   OR LOWER({name_col_ts}) LIKE '%lon_deg%' 
                                                   OR LOWER({name_col_ts}) LIKE '%lng_deg%' 
                                                   OR LOWER({name_col_ts}) LIKE '%longitude%' 
                                                   OR LOWER({name_col_ts}) = 'lon' 
                                                   OR LOWER({name_col_ts}) = 'lng' 
                                                 THEN {val_col_ts} END) AS lng,
                                        MAX(CASE WHEN LOWER({name_col_ts}) LIKE '%enhanced_altitude%' OR LOWER({name_col_ts}) LIKE '%altitude%' OR LOWER({name_col_ts}) LIKE '%elevation%' OR LOWER({name_col_ts}) = 'ele' OR LOWER({name_col_ts}) = 'alt' OR LOWER({name_col_ts}) LIKE '%height%' THEN {val_col_ts} END) AS ele,
                                        MAX(CASE WHEN LOWER({name_col_ts}) LIKE '%heart%' OR LOWER({name_col_ts}) LIKE '%heart_rate%' OR LOWER({name_col_ts}) LIKE '%heartrate%' OR LOWER({name_col_ts}) = 'hr' OR LOWER({name_col_ts}) = 'hf' OR LOWER({name_col_ts}) LIKE '%herz%' OR LOWER({name_col_ts}) LIKE '%puls%' THEN {val_col_ts} END) AS hr,
                                        MAX(CASE WHEN LOWER({name_col_ts}) LIKE '%cadence%' OR LOWER({name_col_ts}) LIKE '%cad%' OR LOWER({name_col_ts}) LIKE '%tritt%' THEN {val_col_ts} END) AS cadence,
                                        MAX(CASE WHEN (LOWER({name_col_ts}) LIKE '%power%' OR LOWER({name_col_ts}) LIKE '%watt%' OR LOWER({name_col_ts}) LIKE '%leist%') AND LOWER({name_col_ts}) NOT LIKE '%accumulated%' AND LOWER({name_col_ts}) NOT LIKE '%zone%' AND LOWER({name_col_ts}) NOT LIKE '%avg%' AND LOWER({name_col_ts}) NOT LIKE '%max%' AND LOWER({name_col_ts}) NOT LIKE '%normalized%' AND LOWER({name_col_ts}) NOT LIKE '%threshold%' AND LOWER({name_col_ts}) NOT LIKE '%ftp%' AND LOWER({name_col_ts}) NOT LIKE '%battery%' THEN {val_col_ts} END) AS power,
                                        MAX(CASE WHEN LOWER({name_col_ts}) LIKE '%speed%' OR LOWER({name_col_ts}) LIKE '%velocity%' OR LOWER({name_col_ts}) LIKE '%geschw%' THEN {val_col_ts} END) AS speed
                                    FROM activity_ts_metric
                                    WHERE {act_id_col_ts} = ?
                                    GROUP BY {ts_col_ts}
                                    ORDER BY {ts_col_ts} ASC
                                """
                                src_cursor.execute(pts_query, (row['activity_id'],))
                                db_points = [dict(r) for r in src_cursor.fetchall()]
                                if not db_points:
                                    try:
                                        # try casting to int/float if string didn't match exactly
                                        src_cursor.execute(pts_query, (int(row['activity_id']),))
                                        db_points = [dict(r) for r in src_cursor.fetchall()]
                                    except:
                                        pass
                                        
                                if db_points:
                                    points_array = []
                                    for p in db_points:
                                        if p['lat'] is None or p['lng'] is None:
                                            # check if we have any sensor values to be flexible
                                            if p['ele'] is None and p['hr'] is None and p['cadence'] is None and p['power'] is None and p['speed'] is None:
                                                continue
                                        try:
                                            lat_v = float(p['lat']) if p['lat'] is not None else None
                                            lng_v = float(p['lng']) if p['lng'] is not None else None
                                            ele_v = float(p['ele']) if p['ele'] is not None else None
                                            hr_v = float(p['hr']) if p['hr'] is not None else None
                                            cad_v = float(p['cadence']) if p['cadence'] is not None else None
                                            pwr_v = float(p['power']) if p['power'] is not None else None
                                            spd_v = float(p['speed']) if p['speed'] is not None else None
                                        except:
                                            continue
                                            
                                        pt = {}
                                        if p['timestamp']:
                                            pt['time'] = format_point_time(p['timestamp'])
                                        if lat_v is not None and lng_v is not None and not math.isnan(lat_v) and not math.isnan(lng_v):
                                            pt['lat'] = lat_v
                                            pt['lng'] = lng_v
                                        if ele_v is not None and not math.isnan(ele_v): pt['ele'] = ele_v
                                        if hr_v is not None and not math.isnan(hr_v): pt['hr'] = hr_v
                                        if cad_v is not None and not math.isnan(cad_v): pt['cadence'] = cad_v
                                        if pwr_v is not None and not math.isnan(pwr_v): pt['power'] = pwr_v
                                        if spd_v is not None and not math.isnan(spd_v):
                                            pt['speed'] = spd_v / 1000.0 if spd_v > 100 else spd_v
                                        points_array.append(pt)
                                        
                                    if points_array:
                                        has_any_coords = any(p.get('lat') is not None and p.get('lng') is not None for p in points_array)
                                        if has_any_coords:
                                            normalized_pts = normalize_track_points_with_scale_detection(points_array, dist_val)
                                            auto_normalize_elevations(normalized_pts)
                                            points_json_val = json.dumps(normalized_pts)
                        except Exception as e:
                            sys.stderr.write(f"Err reading activity_ts_metric pivot for id {id_val}: {e}\n")
                            
                    # Fallback 2: parse encoded polyline / points_json / separate table
                    if not points_json_val:
                        if points_json_col and row[points_json_col]:
                            parsed_pts = parse_path_json(row[points_json_col], dist_val)
                            if parsed_pts:
                                points_json_val = json.dumps(parsed_pts)
                                
                    if not points_json_val and points_table:
                        try:
                            if pt_json_col:
                                # json column query
                                src_cursor.execute(f"SELECT {pt_json_col} FROM {points_table} WHERE {pt_act_id_col} = ?", (row['activity_id'],))
                                r_pt = src_cursor.fetchone()
                                if r_pt and r_pt[0]:
                                    parsed_pts = parse_path_json(r_pt[0], dist_val)
                                    if parsed_pts:
                                        points_json_val = json.dumps(parsed_pts)
                            elif pt_lat_col and pt_lng_col:
                                ele_sql = f", {pt_ele_col}" if pt_ele_col else ""
                                time_sql = f", {pt_time_col}" if pt_time_col else ""
                                pt_query = f"SELECT {pt_lat_col}, {pt_lng_col} {ele_sql} {time_sql} FROM {points_table} WHERE {pt_act_id_col} = ? ORDER BY {pt_time_col or '1'} ASC"
                                src_cursor.execute(pt_query, (row['activity_id'],))
                                pt_rows = src_cursor.fetchall()
                                
                                points_array = []
                                for pr in pt_rows:
                                    try:
                                        p_lat = float(pr[0])
                                        p_lng = float(pr[1])
                                        if math.isnan(p_lat) or math.isnan(p_lng):
                                            continue
                                        pt = {
                                            'lat': p_lat,
                                            'lng': p_lng
                                        }
                                        if pt_ele_col and pr[pt_ele_col] is not None:
                                            pt['ele'] = float(pr[pt_ele_col])
                                        if pt_time_col and pr[pt_time_col]:
                                            pt['time'] = format_point_time(pr[pt_time_col])
                                        points_array.append(pt)
                                    except:
                                        pass
                                if points_array:
                                    normalized_pts = normalize_track_points_with_scale_detection(points_array, dist_val)
                                    auto_normalize_elevations(normalized_pts)
                                    points_json_val = json.dumps(normalized_pts)
                        except Exception as e:
                            sys.stderr.write(f"Err reading points from separate table {points_table}: {e}\n")
                            
                    # Write activity
                    dest_cursor.execute("""
                        INSERT OR REPLACE INTO garmin_activities (
                            id, name, type, date, distance, duration, ascent, descent, calories, avg_hr, description, location, points_json, user_id
                        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """, (id_val, name_val, type_val, date_val, dist_val, dur_val, final_ascent, final_descent, cal_val, hr_val, desc_val, loc_val, points_json_val, user_id_val))
                    activities_imported += 1
                    
                sys.stderr.write(f"[Activity-Import] {activities_imported} Garmin-Aktivitäten erfolgreich importiert.\n")
            except Exception as e:
                sys.stderr.write(f"[Activity-Import-Fehler] Fehler: {e}\n")
                
    else:
        sys.stderr.write("Erkanntes Schema: Fallback (Generische Spalten- und Tabellensuche)\n")
        
        def find_column(columns, options):
            for opt in options:
                for c in columns:
                    if c['name'].lower() == opt.lower():
                        return c['name']
            return None
            
        for table in tables:
            t_name = table.lower()
            src_cursor.execute(f"PRAGMA table_info({table})")
            columns = [dict(r) for r in src_cursor.fetchall()]
            
            # 1. SLEEP
            if "sleep" in t_name:
                sys.stderr.write(f"[Generic-Sleep] Tabelle '{table}' als Schlafdaten-Kandidat erkannt.\n")
                date_col = find_column(columns, ["date", "day", "calendar_date", "timestamp", "start_time", "calendarDate", "start_ts", "end_ts"])
                dur_col = find_column(columns, ["duration", "duration_ms", "total_sleep", "sleep_duration", "seconds", "total_sleep_time", "sleep_time_seconds"])
                deep_col = find_column(columns, ["deep", "deep_sleep", "deep_duration", "deep_sleep_duration", "deep_sleep_seconds"])
                light_col = find_column(columns, ["light", "light_sleep", "light_duration", "light_sleep_duration", "light_sleep_seconds"])
                rem_col = find_column(columns, ["rem", "rem_sleep", "rem_duration", "rem_sleep_duration", "rem_sleep_seconds"])
                awake_col = find_column(columns, ["awake", "awake_time", "awake_duration", "awake_sleep_seconds"])
                
                if date_col and dur_col:
                    src_cursor.execute(f"SELECT * FROM {table}")
                    rows = src_cursor.fetchall()
                    for row in rows:
                        date_val = format_to_local_date_string(row[date_col])
                        if not date_val:
                            continue
                        try:
                            dur_val = float(row[dur_col])
                            if dur_val > 100000:
                                dur_val = dur_val / 60000.0  # ms to min
                            elif dur_val > 1440:
                                dur_val = dur_val / 60.0  # seconds to min
                                
                            dp_val = float(row[deep_col]) / 60.0 if deep_col and row[deep_col] is not None else 0.0
                            lt_val = float(row[light_col]) / 60.0 if light_col and row[light_col] is not None else 0.0
                            rm_val = float(row[rem_col]) / 60.0 if rem_col and row[rem_col] is not None else 0.0
                            aw_val = float(row[awake_col]) / 60.0 if awake_col and row[awake_col] is not None else 0.0
                            
                            dest_cursor.execute("""
                                INSERT OR REPLACE INTO garmin_sleep (date, duration, deep, light, rem, awake)
                                VALUES (?, ?, ?, ?, ?, ?)
                            """, (date_val, dur_val, dp_val, lt_val, rm_val, aw_val))
                            sleep_imported += 1
                        except:
                            pass
                            
            # 2. WEIGHT
            elif "weight" in t_name or "body" in t_name or "physique" in t_name:
                sys.stderr.write(f"[Generic-Weight] Tabelle '{table}' als Gewichtsdaten-Kandidat erkannt.\n")
                date_col = find_column(columns, ["date", "timestamp", "day", "time"])
                w_col = find_column(columns, ["weight", "weight_kg", "kg", "value", "body_weight"])
                bmi_col = find_column(columns, ["bmi", "body_mass_index"])
                fat_col = find_column(columns, ["body_fat", "fat", "fat_percentage", "fat_percent"])
                
                if date_col and w_col:
                    src_cursor.execute(f"SELECT * FROM {table}")
                    rows = src_cursor.fetchall()
                    for row in rows:
                        date_val = format_to_local_date_string(row[date_col])
                        if not date_val:
                            continue
                        try:
                            w_val = float(row[w_col])
                            if w_val > 1000:
                                w_val = w_val / 1000.0  # grams to kg
                            bmi_val = float(row[bmi_col]) if bmi_col and row[bmi_col] is not None else None
                            fat_val = float(row[fat_col]) if fat_col and row[fat_col] is not None else None
                            
                            dest_cursor.execute("""
                                INSERT OR REPLACE INTO garmin_weight (date, weight, bmi, body_fat)
                                VALUES (?, ?, ?, ?)
                            """, (date_val, w_val, bmi_val, fat_val))
                            weight_imported += 1
                        except:
                            pass
                            
            # 3. STRESS
            elif "stress" in t_name:
                sys.stderr.write(f"[Generic-Stress] Tabelle '{table}' als Stressdaten-Kandidat erkannt.\n")
                date_col = find_column(columns, ["date", "timestamp", "day", "time"])
                stress_col = find_column(columns, ["value", "stress_score", "avg_stress", "stress", "level"])
                
                if date_col and stress_col:
                    src_cursor.execute(f"SELECT * FROM {table}")
                    rows = src_cursor.fetchall()
                    stress_by_date = {}
                    for row in rows:
                        date_val = format_to_local_date_string(row[date_col])
                        if not date_val:
                            continue
                        try:
                            val = float(row[stress_col])
                            if val >= 0:
                                if date_val not in stress_by_date:
                                    stress_by_date[date_val] = {'sum': 0.0, 'count': 0}
                                stress_by_date[date_val]['sum'] += val
                                stress_by_date[date_val]['count'] += 1
                        except:
                            pass
                    for date_val, d in stress_by_date.items():
                        dest_cursor.execute("""
                            INSERT OR REPLACE INTO garmin_stress (date, avg_stress)
                            VALUES (?, ?)
                        """, (date_val, d['sum'] / d['count']))
                        stress_imported += 1
                        
            # 4. RHR
            elif "rhr" in t_name or "resting" in t_name:
                sys.stderr.write(f"[Generic-RHR] Tabelle '{table}' als RHR-Daten-Kandidat erkannt.\n")
                date_col = find_column(columns, ["date", "timestamp", "day", "time"])
                rhr_col = find_column(columns, ["value", "resting_heart_rate", "rhr", "resting_hr"])
                
                if date_col and rhr_col:
                    src_cursor.execute(f"SELECT * FROM {table}")
                    rows = src_cursor.fetchall()
                    for row in rows:
                        date_val = format_to_local_date_string(row[date_col])
                        if not date_val:
                            continue
                        try:
                            val = float(row[rhr_col])
                            if val > 0:
                                dest_cursor.execute("""
                                    INSERT OR REPLACE INTO garmin_rhr (date, rhr)
                                    VALUES (?, ?)
                                        """, (date_val, val))
                                rhr_imported += 1
                        except:
                            pass
                            
            # 5. STEPS
            elif "step" in t_name:
                sys.stderr.write(f"[Generic-Steps] Tabelle '{table}' als Schrittdaten-Kandidat erkannt.\n")
                date_col = find_column(columns, ["date", "timestamp", "day", "time"])
                step_col = find_column(columns, ["steps", "step_count", "value", "count"])
                
                if date_col and step_col:
                    src_cursor.execute(f"SELECT * FROM {table}")
                    rows = src_cursor.fetchall()
                    steps_by_date = {}
                    for row in rows:
                        date_val = format_to_local_date_string(row[date_col])
                        if not date_val:
                            continue
                        try:
                            val = int(row[step_col])
                            steps_by_date[date_val] = steps_by_date.get(date_val, 0) + val
                        except:
                            pass
                    for date_val, steps_val in steps_by_date.items():
                        dest_cursor.execute("""
                            INSERT OR REPLACE INTO garmin_steps (date, steps, calories, distance)
                            VALUES (?, ?, ?, ?)
                        """, (date_val, steps_val, None, None))
                        steps_imported += 1
                        
            # 6. ACTIVITIES
            elif "act" in t_name or "sport" in t_name or "run" in t_name or "ride" in t_name or "workout" in t_name:
                sys.stderr.write(f"[Generic-Activities] Tabelle '{table}' als Aktivitäten-Kandidat erkannt.\n")
                id_col = find_column(columns, ["id", "activity_id", "activityid", "rowid", "pk"])
                name_col = find_column(columns, ["name", "title", "activity_name", "activityname"])
                type_col = find_column(columns, ["type", "activity_type", "activitytype", "sport", "activity_type_key"])
                date_col = find_column(columns, ["date", "start_time", "start_ts", "timestamp", "time"])
                dist_col = find_column(columns, ["distance", "dist", "length"])
                dur_col = find_column(columns, ["duration", "time_sec", "elapsed_time", "total_timer_time"])
                
                if date_col:
                    src_cursor.execute(f"SELECT * FROM {table}")
                    rows = src_cursor.fetchall()
                    for row in rows:
                        date_val = format_to_local_date_string(row[date_col])
                        if not date_val:
                            continue
                            
                        id_val = str(row[id_col]) if id_col else f"gen_{activities_imported}_{date_val}"
                        name_val = str(row[name_col]) if name_col and row[name_col] else "Activity"
                        type_val = str(row[type_col]) if type_col and row[type_col] else "cycling"
                        
                        try:
                            dist_val = float(row[dist_col]) if dist_col and row[dist_col] is not None else 0.0
                            if dist_val > 1000:
                                dist_val = dist_val / 1000.0  # meters to km
                        except:
                            dist_val = 0.0
                            
                        try:
                            dur_val = float(row[dur_col]) if dur_col and row[dur_col] is not None else 0.0
                            if dur_val > 86400:
                                dur_val = dur_val / 1000.0  # ms to sec
                        except:
                            dur_val = 0.0
                            
                        dest_cursor.execute("""
                            INSERT OR REPLACE INTO garmin_activities (
                                id, name, type, date, distance, duration, ascent, descent, calories, avg_hr, description, location, points_json, user_id
                            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                        """, (id_val, name_val, type_val, date_val, dist_val, dur_val, None, None, None, None, None, None, None, None))
                        activities_imported += 1
                        
    # Commit changes and close
    dest_conn.commit()
    dest_conn.close()
    src_conn.close()
    
    # Return count statistics to Node via JSON on stdout
    result = {
        "success": True,
        "sleep": sleep_imported,
        "weight": weight_imported,
        "stress": stress_imported,
        "rhr": rhr_imported,
        "steps": steps_imported,
        "activities": activities_imported,
        "tables": tables
    }
    print(json.dumps(result))

if __name__ == "__main__":
    main()
