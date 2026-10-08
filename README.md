# Data Twin City Weimar — web platform (Stage 1 shell)

Static HTML/CSS/JS application. The page stacks **three independent map blocks**,
each its own `Cesium.Viewer` with its own sidebar (layers grouped by source
resource, eye toggles), 2D/3D switch and terrain toggle:

1. **All layers (QA)** — every layer in `layers/layers.json`.
2. **Model 1 — Computational Design** — only layers tagged `"models": ["model1"]`.
3. **Model 2 — Visual model** — only layers tagged `"models": ["model2"]`.

All three are built by one reusable function (`createMapBlock` in `app.js`); the
manifest is loaded once and filtered per block by the `models` field. Layers with
no `models` field appear only in block 1.

Layers and resources are data-driven from `layers/layers.json` — add a layer
there and it shows up, no UI code changes.

## Run locally

CesiumJS must be served over HTTP (not opened as `file://`) or asset/CORS
requests fail. From the repository root:

```sh
npx serve web
# or
cd web && python3 -m http.server 8080
```

Then open the printed URL (e.g. `http://localhost:8080`).

### CORS proxy for 3D buildings + terrain

The WEGA 3D layers (`3D Buildings LoD2`, `3D Structures`) and the **Terrain**
toggle load Cesium 3D Tiles / quantized-mesh from
`geoportal5.geoportal-th.de`, which sends no CORS headers. Run the bundled proxy
alongside the web server:

```sh
python tools/proxy.py          # serves http://localhost:8788
```

`app.js` rewrites any `{proxy}` in `layers/layers.json` to `http://localhost:8788`
(constant `PROXY_BASE`). Without the proxy running, those layers simply fail to
load (console warning) — the WMS layers are unaffected. For a deployed site,
host an equivalent (e.g. a Cloudflare Worker) and change `PROXY_BASE`.

## Browser requirements

A modern browser with **WebGL** enabled (Chrome, Firefox, Edge, Safari). Cesium
falls back gracefully but 3D mode needs WebGL.

## Files

| File | Purpose |
|------|---------|
| `index.html` | Layout: map container, sidebar, 2D/3D switch, attribution strip |
| `style.css` | Light, minimal analysis-tool UI |
| `app.js` | Viewer boot, layer manager (`wms` / `geojson` / `3dtiles` dispatch), terrain toggle, sidebar rendering, per-block metadata panel, view switch |
| `layers/layers.json` | Manifest — `resources` (source portals) + `layers` (each references a `resourceId`) + optional `terrain` + optional `sidebar` (per-viewport semantic grouping; falls back to grouping by resource). Source of truth for the left panel and the under-map metadata block. |
| `../tools/proxy.py` | Dev CORS proxy for the WEGA 3D host (3D Tiles + terrain) |
| `../tools/download_dgm.py` | Download Thuringia DGM (elevation) tiles for the Weimar AOI |
| `../tools/download_citygml.py` | Download Thuringia CityGML LoD1/LoD2 building tiles for the Weimar AOI |
| `../tools/fetch_weimar_boundary.py` | Rebuild `layers/data/weimar_boundary.geojson` from the admin-boundary WFS |
| `../tools/fetch_weimar_bplan.py` | Rebuild `layers/data/weimar_bplan.geojson` from the city B-Plan Shapefile (needs `pip install pyshp`) |
| `../tools/fetch_weimar_shp.py` | Generic: download any `ko_we_*` city Shapefile → GeoJSON (schools, kitas, …) |
| `../tools/fetch_gtfs_stops.py` | Rebuild `layers/data/weimar_transit_stops.geojson` from the VMT GTFS feed |
| `layers/data/` | Static derived datasets (Weimar boundary, B-plans, …) |

## Later: real terrain and satellite imagery

The shell uses OpenStreetMap raster tiles and a plain ellipsoid (no elevation
geometry), which needs no account. For real terrain and Bing/satellite imagery,
create a free [Cesium ion](https://cesium.com/ion/) account and set its token via
`Cesium.Ion.defaultAccessToken` near the top of `app.js` (then switch the base
layer / terrain provider to the ion-backed ones).

## 3DM export (TASK 28)

Export toolbar -> format "3DM (Rhino, zip)". Built in the browser with **rhino3dm.js 8.4.0** (WASM, imported lazily from `https://unpkg.com/rhino3dm@8.4.0/rhino3dm.module.min.js`), proj4js 2.9.2 (CDN). Needs internet on first use. Geometry is native Rhino (Extrusion / planar Brep / curves / points, double precision, no meshes). Default = absolute EPSG:25832 (same as the terrain/OBJ files); "local origin" shifts to the area centre and writes the offset to manifest.json and the document User Text. Details: `output/DATA_LOG.md`, section TASK 28.
