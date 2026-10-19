const FRESH_MS = 30 * 60 * 1000;

export function text(value, max = 240) {
  return String(value ?? "").trim().slice(0, max);
}

export function number(value) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = typeof value === "number" ? value : Number(String(value).replace(/,/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
}

export function firstNumber(value, keys) {
  if (!value || typeof value !== "object") return null;
  for (const key of keys) {
    const result = number(value[key]);
    if (result !== null) return result;
  }
  return null;
}

function nestedValues(value) {
  if (!value || typeof value !== "object") return [];
  if (Array.isArray(value)) return value;
  return Object.values(value);
}

function timestamp(value) {
  if (value === null || value === undefined) return "";
  if (typeof value === "string" || typeof value === "number") return text(value, 80);
  if (!value || typeof value !== "object") return "";
  for (const key of ["DateTime", "dateTime", "datetime", "Timestamp", "timestamp", "Time", "time", "value", "Value"]) {
    const result = timestamp(value[key]);
    if (result) return result;
  }
  return "";
}

function safeHttpUrl(value) {
  const candidate = text(value, 800);
  try {
    const url = new URL(candidate);
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : "";
  } catch {
    return "";
  }
}

function rowTimestamp(row, keys) {
  if (!row || typeof row !== "object") return "";
  for (const key of keys) {
    const result = timestamp(row[key]);
    if (result) return result;
  }
  return "";
}

export function firstNumberDeep(value, keys, depth = 3) {
  if (depth < 0 || value === null || value === undefined) return null;
  const direct = firstNumber(value, keys);
  if (direct !== null) return direct;
  for (const child of nestedValues(value)) {
    const result = firstNumberDeep(child, keys, depth - 1);
    if (result !== null) return result;
  }
  return null;
}

function weatherElementValue(value, names) {
  for (const item of nestedValues(value)) {
    if (!item || typeof item !== "object") continue;
    const elementName = text(item.ElementName || item.elementName || item.Name || item.name, 80).toLowerCase();
    if (elementName && names.some(name => elementName.includes(name.toLowerCase()))) {
      const result = firstNumberDeep(item.ElementValue || item.elementValue || item.Value || item.value, ["value", "Value", "AirTemperature", "Temperature"]);
      if (result !== null) return result;
    }
  }
  return null;
}

function firstText(value, keys) {
  if (!value || typeof value !== "object") return "";
  const wanted = new Set(keys.map(key => key.toLowerCase()));
  for (const [key, item] of Object.entries(value)) {
    if (wanted.has(key.toLowerCase())) {
      if (typeof item === "string" || typeof item === "number") return text(item, 120);
      if (item && typeof item === "object") {
        const nested = firstText(item, ["value", "Value", "Weather", "Text"]);
        if (nested) return nested;
      }
    }
  }
  return "";
}

function weatherElementText(value, names) {
  for (const item of nestedValues(value)) {
    if (!item || typeof item !== "object") continue;
    const elementName = text(item.ElementName || item.elementName || item.Name || item.name, 80).toLowerCase();
    if (elementName && names.some(name => elementName.includes(name.toLowerCase()))) {
      const result = firstText(item.ElementValue || item.elementValue || item.Value || item.value, ["value", "Value", "Weather", "Text"]);
      if (result) return result;
    }
  }
  return "";
}

export function weatherCondition(value, precipitationMm = null) {
  const normalized = text(value, 120).toLowerCase();
  if (/(雷|雨|陣雨|毛毛雨|霰|snow|rain|shower|drizzle|thunder)/i.test(normalized)) return "rainy";
  if (/(多雲|陰|雲|cloud|overcast)/i.test(normalized)) return "cloudy";
  if (/(晴|sunny|clear)/i.test(normalized)) return "sunny";
  if (number(precipitationMm) !== null && number(precipitationMm) > 0) return "rainy";
  return "unknown";
}

export function weatherTemperature(row) {
  return firstNumber(row, ["Temperature", "temperature", "AirTemperature"])
    ?? firstNumberDeep(row?.WeatherElement || row?.weatherElement || row?.Observation, ["Temperature", "temperature", "AirTemperature"])
    ?? weatherElementValue(row?.WeatherElement || row?.weatherElement || row?.Observation, ["airtemperature", "temperature"]);
}

export function coordinate(row) {
  const value = row && typeof row === "object" ? row : {};
  const geo = (value.GeoInfo || value.Position || value.position || value.geometry || {}) || {};
  const candidates = [value, geo];
  const coordinates = geo.Coordinates || geo.coordinates || value.Coordinates || value.coordinates;
  if (Array.isArray(coordinates)) {
    const first = number(coordinates[0]);
    const second = number(coordinates[1]);
    if (first !== null && second !== null) {
      candidates.push({ lng: first, lat: second });
    } else {
      candidates.push(...coordinates);
    }
  } else if (coordinates && typeof coordinates === "object") {
    candidates.push(coordinates);
  }
  const latKeys = ["lat", "latitude", "StationLatitude", "Latitude", "PositionLat", "EpicenterLatitude"];
  const lngKeys = ["lng", "lon", "longitude", "StationLongitude", "Longitude", "PositionLon", "EpicenterLongitude"];
  return {
    lat: candidates.map(item => firstNumber(item, latKeys)).find(result => result !== null) ?? null,
    lng: candidates.map(item => firstNumber(item, lngKeys)).find(result => result !== null) ?? null
  };
}

function isObject(value) {
  return value !== null && typeof value === "object";
}

export function rowsFrom(payload, keys = []) {
  if (Array.isArray(payload)) return { rows: payload.filter(isObject), malformed: false };
  if (!isObject(payload)) return { rows: [], malformed: true };

  const candidates = [payload];
  for (const key of ["records", "Records", "data", "Data", "result", "Result"]) {
    if (isObject(payload[key])) candidates.push(payload[key]);
  }
  for (const candidate of candidates) {
    if (Array.isArray(candidate)) return { rows: candidate.filter(isObject), malformed: false };
    for (const key of keys) {
      if (Array.isArray(candidate[key])) return { rows: candidate[key].filter(isObject), malformed: false };
    }
  }
  return { rows: [], malformed: true };
}

export function freshnessFor(asOf, now, freshMs = FRESH_MS) {
  const timestamp = Date.parse(asOf || "");
  if (!Number.isFinite(timestamp)) return { freshness: "unknown", stale: false };
  const age = now - timestamp;
  if (age < -5 * 60 * 1000) return { freshness: "unknown", stale: false };
  const stale = age > freshMs;
  return { freshness: stale ? "stale" : "fresh", stale };
}

export function latestObservedAt(markers, fallback) {
  const timestamps = (Array.isArray(markers) ? markers : [])
    .map(marker => text(marker?.observed_at, 80))
    .filter(value => Number.isFinite(Date.parse(value)))
    .sort((a, b) => Date.parse(b) - Date.parse(a));
  return timestamps[0] || fallback;
}

export function normalizeWeatherRows(payload, retrievedAt) {
  const result = rowsFrom(payload, ["Station", "station", "location", "Location"]);
  const markers = result.rows.map((row, index) => {
    const point = coordinate(row);
    if (point.lat === null || point.lng === null) return null;
    const station = text(row.StationName || row.LocationName || row.name || `weather-${index + 1}`, 120);
    const temperature = weatherTemperature(row);
    const elements = row.WeatherElement || row.weatherElement || row.Observation || row.observation || {};
    const conditionText = firstText(row, ["Weather", "weather", "Condition", "condition"])
      || firstText(elements, ["Weather", "weather", "Condition", "condition"])
      || weatherElementText(elements, ["weather", "condition"]);
    const precipitation = firstNumber(row, ["Precipitation", "precipitation", "Rainfall", "rainfall"])
      ?? firstNumberDeep(elements, ["Precipitation", "precipitation", "Rainfall", "rainfall"])
      ?? weatherElementValue(elements, ["precipitation", "rainfall"]);
    const windSpeed = firstNumber(row, ["WindSpeed", "windSpeed", "wind_speed"])
      ?? firstNumberDeep(elements, ["WindSpeed", "windSpeed", "wind_speed"])
      ?? weatherElementValue(elements, ["windspeed"]);
    return {
      id: `cwa-weather-${text(row.StationId || row.stationId || row.StationID || index, 60)}`,
      kind: "weather",
      label: station,
      detail: temperature === null ? "CWA 氣象站資料" : `氣溫 ${temperature}°C`,
      lat: point.lat,
      lng: point.lng,
      observed_at: rowTimestamp(row, ["ObsTime", "observedAt", "ObservationTime", "observationTime"]),
      value: temperature,
      unit: temperature === null ? "" : "°C",
      condition_text: conditionText,
      condition: weatherCondition(conditionText, precipitation),
      precipitation_mm: precipitation,
      wind_speed_mps: windSpeed,
      source: "CWA"
    };
  }).filter(Boolean);
  return { ...result, markers };
}

export function normalizeRainfallRows(payload) {
  const result = rowsFrom(payload, ["Station", "station", "location", "Location"]);
  const markers = result.rows.map((row, index) => {
    const point = coordinate(row);
    if (point.lat === null || point.lng === null) return null;
    const elements = row.RainfallElement || row.rainfallElement || row.Rainfall || row.rainfall || {};
    const tenMinute = elements.Past10Min || elements.past10Min || elements.Now || elements.now || {};
    const precipitation = firstNumber(row, ["Precipitation", "precipitation", "Rainfall", "rainfall"])
      ?? firstNumber(tenMinute, ["Precipitation", "precipitation", "Rainfall", "rainfall", "value", "Value"]);
    return {
      id: `cwa-rainfall-${text(row.StationId || row.stationId || row.StationID || index, 60)}`,
      kind: "rainfall",
      label: text(row.StationName || row.LocationName || row.name || `rainfall-${index + 1}`, 120),
      lat: point.lat,
      lng: point.lng,
      observed_at: rowTimestamp(row, ["ObsTime", "obsTime", "observedAt", "ObservationTime", "observationTime"])
        || rowTimestamp(tenMinute, ["DateTime", "dateTime", "DataTime", "dataTime", "Time", "time"]),
      precipitation_mm: precipitation,
      source: "CWA"
    };
  }).filter(Boolean);
  return { ...result, markers };
}

export function normalizeEarthquakeRows(payload, retrievedAt) {
  const result = rowsFrom(payload, ["Earthquake", "earthquake", "Earthquakes"]);
  const markers = result.rows.map((row, index) => {
    const info = (row.EarthquakeInfo || row.earthquakeInfo || row) || {};
    const epicenter = (info.Epicenter || info.epicenter || {}) || {};
    const point = coordinate(epicenter);
    if (point.lat === null || point.lng === null) return null;
    const magnitudeInfo = (info.EarthquakeMagnitude || info.magnitude || {}) || {};
    const magnitude = firstNumberDeep(magnitudeInfo, ["MagnitudeValue", "value", "magnitude"]);
    const eventAt = rowTimestamp(info, ["OriginTime", "originTime", "OriginDateTime", "originDateTime"])
      || rowTimestamp(row, ["OriginTime", "originTime", "OriginDateTime", "originDateTime"]);
    const title = text(epicenter.Location || epicenter.location || row.ReportContent || `地震 ${index + 1}`, 160);
    return {
      id: `cwa-quake-${text(row.EarthquakeNo || row.id || index, 60)}`,
      kind: "earthquake",
      label: title,
      detail: magnitude === null ? "CWA 地震資料" : `規模 M${magnitude}`,
      lat: point.lat,
      lng: point.lng,
      observed_at: eventAt,
      magnitude,
      depth_km: firstNumberDeep(info, ["FocalDepth", "depth", "Depth"]),
      source: "CWA"
    };
  }).filter(Boolean);
  return { ...result, markers };
}

export function normalizeAqiRows(payload, retrievedAt) {
  const result = rowsFrom(payload, ["records", "Records"]);
  const markers = result.rows.map((row, index) => {
    const point = coordinate(row);
    if (point.lat === null || point.lng === null) return null;
    const station = text(row.sitename || row.SiteName || row.site_name || `AQI-${index + 1}`, 120);
    const aqi = firstNumber(row, ["aqi", "AQI"]);
    return {
      id: `moenv-aqi-${text(row.siteid || row.SiteId || row.site_id || index, 60)}`,
      kind: "aqi",
      label: station,
      detail: aqi === null ? "MOENV 空氣品質資料" : `AQI ${aqi}`,
      lat: point.lat,
      lng: point.lng,
      observed_at: rowTimestamp(row, ["publishtime", "PublishTime", "publish_time", "publishTime", "DataTime", "dataTime"]),
      value: aqi,
      unit: aqi === null ? "" : "AQI",
      status: text(row.status || row.Status, 60),
      source: "MOENV"
    };
  }).filter(Boolean);
  return { ...result, markers };
}

export function normalizeCctvRows(payload, retrievedAt) {
  const result = rowsFrom(payload, ["CCTV", "Cctv", "cctv", "CCTVs", "cctvs"]);
  const markers = result.rows.map((row, index) => {
    const point = coordinate(row);
    if (point.lat === null || point.lng === null) return null;
    const id = text(row.CCTVID || row.CctvId || row.CCTVId || row.id || index, 100);
    const roadLabel = text(row.RoadName || row.RoadNameZh || row.roadName || row.road_name, 160);
    const intersectionLabel = text(
      row.IntersectionName || row.Intersection || row.intersection || row.intersectionName,
      180
    );
    const direction = text(row.Direction || row.direction || row.Heading || row.heading, 40);
    const imageUrl = safeHttpUrl(row.VideoImageUrl || row.VideoImageURL || row.videoImageUrl || row.video_image_url);
    const streamUrl = safeHttpUrl(row.VideoStreamUrl || row.VideoStreamURL || row.videoStreamUrl || row.video_stream_url);
    return {
      id: `tdx-cctv-${id}`,
      kind: "cctv",
      label: roadLabel || `CCTV ${index + 1}`,
      detail: intersectionLabel || roadLabel || "TDX CCTV 公開點位 metadata",
      lat: point.lat,
      lng: point.lng,
      observed_at: rowTimestamp(row, ["UpdateTime", "updateTime", "LastUpdateTime", "lastUpdateTime"]),
      road_label: roadLabel,
      intersection_label: intersectionLabel,
      direction,
      media_available: Boolean(imageUrl || streamUrl),
      image_url: imageUrl,
      stream_url: streamUrl,
      source: "TDX"
    };
  }).filter(Boolean);
  return { ...result, markers };
}
