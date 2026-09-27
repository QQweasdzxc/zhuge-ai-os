import * as Cesium from 'cesium';

// Attribution and service rights are documented in DATA_SOURCES.md.
export const ESRI_ATTRIBUTION_HTML =
  '<a href="https://www.esri.com" target="_blank" rel="noopener">Powered by Esri</a>';
export const NLSC_ATTRIBUTION_HTML =
  '<a href="https://www.nlsc.gov.tw/" target="_blank" rel="noopener">© Taiwan National Land Surveying and Mapping Center</a>';

export function createOsmImagery() {
  return new Cesium.OpenStreetMapImageryProvider({
    url: 'https://tile.openstreetmap.org/',
    credit: '© OpenStreetMap contributors',
  });
}

export function createEsriImagery() {
  return Cesium.ArcGisMapServerImageryProvider.fromUrl(
    'https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer',
    {
      credit:
        'Powered by Esri — Source: Esri, Maxar, Earthstar Geographics, and the GIS User Community',
      enablePickFeatures: false,
    },
  );
}

export function createNlscImagery(layer = 'EMAP') {
  const safeLayer =
    String(layer).toUpperCase() === 'PHOTO2' ? 'PHOTO2' : 'EMAP';
  return new Cesium.UrlTemplateImageryProvider({
    url: `https://wmts.nlsc.gov.tw/wmts/${safeLayer}/default/GoogleMapsCompatible/{z}/{x}/{y}`,
    maximumLevel: 18,
    credit: NLSC_ATTRIBUTION_HTML,
    enablePickFeatures: false,
  });
}

export function createIonImagery(style, accessToken) {
  accessToken = String(accessToken || '').trim();
  if (!accessToken) throw new Error('Ion imagery requires an explicit token');
  return Cesium.IonImageryProvider.fromAssetId(style, { accessToken });
}
