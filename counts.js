/* Pedestrian counting (Space Syntax window) — numbers over the gates + heat along the network + gate card.
 *
 * Loaded before app.js; createPedestrianCounts() is called from createMapLibreBlock() for a layer of
 * type "counts" and uses app.js globals (h, resolveUrl) at call time.
 *
 * Data (tools/build_pedestrian_counts.py):
 *   config.url      one Point per gate (all years, common names), keys c16_<day>_<time>_<measure> (2016, per 15 min),
 *                   c25_all / c25_veh (2025 peak hour, PER HOUR), c26_<measure> (2026, working day 16–18), years "2016, 2025"
 *   config.heatUrl  short network pieces, `g` = "gateIndex:metres,…" within the FC's heatRadius
 *
 * The heat geometry is loaded once; each piece keeps its HEAT_K nearest gates (g0..g2 / d0..d2) and a switch only
 * swaps the 120 gate values inside the paint expressions — no setData / feature-state per piece.
 */
"use strict";

const COUNT_DAYS = [["WE", "Weekend"], ["WD1", "Workday 1"], ["WD2", "Workday 2"], ["WDA", "Ø Workdays"]];
const COUNT_TIMES = [["AM", "8–10"], ["MD", "12–14"], ["PM", "16–18"]];
const COUNT_MEASURES = [["all", "Pedestrians"], ["ind", "Ped. w/o groups"], ["cyc", "Cyclists"]];   // 2016 / 2026
const COUNT_MEASURES_25 = ["all", "veh"];                                   // 2025: pedestrians + vehicles only
const ALL_MEASURES = [...COUNT_MEASURES, ["veh", "Vehicles"]];
const COUNT_RAMP = ["#FFF1A8", "#FFD500", "#F7A21B", "#EE5A14", "#E3262A", "#8C1018"];
const COUNT_BREAKS = { all: [0, 10, 25, 60, 150, 350], ind: [0, 10, 25, 60, 150, 350], cyc: [0, 2, 5, 10, 20, 40] };
const HOUR_BREAKS = { all: [0, 50, 100, 200, 400, 800], veh: [0, 50, 150, 300, 600, 1200] };   // 2025, per hour
const DELTA_RAMP = ["#0F3E7A", "#0F5FB5", "#9CC3EE", "#F2F2F2", "#F7A21B", "#E3262A", "#8C1018"];
const DELTA_BREAKS = { all: [-150, -50, -10, 0, 10, 50, 150], ind: [-150, -50, -10, 0, 10, 50, 150], cyc: [-20, -8, -2, 0, 2, 8, 20] };
const COUNT_NO_DATA = "#FFFFFF";
const HEAT_K = 3;   // gates mixed per heat piece (nearest first)

function createPedestrianCounts(map, config, { visible, toolsBody }) {
  const P = `${config.id}__`;
  const ids = { heat: P + "heat", pts: P + "pts", lbl: P + "lbl" };
  const layerIds = [ids.heat, ids.pts, ids.lbl];
  const st = { year: "2016", day: "WDA", time: "PM", measure: "all", numbers: true, heat: true, on: !!visible, sel: null };
  let gates = null, R = 150, has26 = false;
  const yearsOf = (p) => String(p.years || "2016");
  // gates shown for the selected year (2026 is counted at the 2016 gates)
  const inYear = (p) => st.year === "2025" ? yearsOf(p).includes("2025") : yearsOf(p).includes("2016");

  // ---------------------------------------------------------------- value of a gate for the current selection
  const lookup = (p, s = st) => {
    const v16 = p[`c16_${s.day}_${s.year === "2016" ? s.time : "PM"}_${s.measure}`];
    const v26 = p[`c26_${s.measure}`];
    if (s.year === "2025") return p[`c25_${s.measure}`] ?? null;
    if (s.year === "2016") return v16 ?? null;
    if (s.year === "2026") return v26 ?? null;
    return v16 == null || v26 == null ? null : v26 - v16;
  };
  const isDelta = () => st.year === "delta";
  const breaks = () => (isDelta() ? DELTA_BREAKS : st.year === "2025" ? HOUR_BREAKS : COUNT_BREAKS)[st.measure];
  const colorExpr = (get) => {
    const br = breaks(), ramp = isDelta() ? DELTA_RAMP : COUNT_RAMP;
    return ["case", ["==", ["typeof", get], "number"],
      ["interpolate", ["linear"], get, ...br.flatMap((b, i) => [b, ramp[i]])], COUNT_NO_DATA];
  };
  const V_PT = ["get", "v"];
  // heat piece: colour = distance-weighted mix of its gates, fade = distance to the nearest gate that has a value.
  // vals / has = literal arrays indexed by gate (+1 dummy slot for pieces with fewer than HEAT_K gates).
  const heatExprs = (vals) => {
    const has = vals.map((v) => (v == null ? 0 : 1)).concat(0), val = vals.map((v) => v ?? 0).concat(0);
    const at = (arr, i) => ["at", ["get", "g" + i], ["literal", arr]];
    const near = (i, p) => ["^", ["-", 1, ["/", ["get", "d" + i], R]], p];
    const ks = [...Array(HEAT_K).keys()];
    const w = ks.map((i) => ["*", at(has, i), near(i, 2)]);
    const v = ["/", ["+", ...ks.map((i) => ["*", w[i], at(val, i)])], ["max", ["+", ...w], 1e-9]];
    return { color: colorExpr(v), opacity: ["*", 0.9, ["max", ...ks.map((i) => ["*", at(has, i), near(i, 0.8)])]] };
  };
  const fmt = (v) => (v == null ? "–" : (isDelta() && v > 0 ? "+" : "") + (Math.round(v * 10) / 10));

  // ---------------------------------------------------------------- map layers
  const vis = (on) => (on ? "visible" : "none");
  function addLayers() {
    map.addSource(ids.heat, { type: "geojson", data: { type: "FeatureCollection", features: [] } });
    map.addSource(ids.pts, { type: "geojson", data: { type: "FeatureCollection", features: [] } });
    map.addLayer({
      id: ids.heat, type: "line", source: ids.heat,
      layout: { visibility: vis(st.on && st.heat), "line-cap": "butt" },   // round caps bead up where pieces overlap
      paint: {
        "line-color": COUNT_NO_DATA,
        "line-opacity": 0,
        "line-width": ["interpolate", ["exponential", 1.6], ["zoom"], 13, 2.5, 16, 7, 18.5, 18],
      },
    });
    map.addLayer({
      id: ids.pts, type: "circle", source: ids.pts, layout: { visibility: vis(st.on) },
      paint: {
        "circle-radius": ["interpolate", ["linear"], ["zoom"], 13, 3.5, 17, 7],
        "circle-color": colorExpr(V_PT),
        "circle-stroke-color": ["case", ["==", ["typeof", ["get", "v"]], "number"], "#0D0D0D", "#8A8A8A"],
        "circle-stroke-width": ["case", ["get", "sel"], 3, 1],
      },
    });
    map.addLayer({
      id: ids.lbl, type: "symbol", source: ids.pts, layout: {
        visibility: vis(st.on && st.numbers),
        "text-field": ["get", "label"], "text-font": ["Montserrat SemiBold", "Open Sans Bold", "Noto Sans Regular"],
        "text-size": ["interpolate", ["linear"], ["zoom"], 13, 10, 17, 14],
        "text-offset": [0.7, 0], "text-anchor": "left",   // right of the point: the gate name (own layer) sits above it
        "text-allow-overlap": false,
        "symbol-sort-key": ["-", 0, ["coalesce", ["get", "v"], -1e6]],   // big numbers win when labels collide
      },
      paint: { "text-color": "#0D0D0D", "text-halo-color": "#FFFFFF", "text-halo-width": 1.8 },
    });
    map.on("click", ids.pts, (e) => { if (!map.__drawing && e.features && e.features[0]) showCard(e.features[0].properties.gate); });
    map.on("mouseenter", ids.pts, () => { map.getCanvas().style.cursor = "pointer"; });
    map.on("mouseleave", ids.pts, () => { map.getCanvas().style.cursor = ""; });
  }

  function repaint() {
    if (!gates || !map.getLayer(ids.pts)) return;
    // 2025 has pedestrians + vehicles only; vehicles exist only in 2025
    if (st.year === "2025" ? !COUNT_MEASURES_25.includes(st.measure) : st.measure === "veh") st.measure = "all";
    const vals = gates.features.map((f) => lookup(f.properties));
    map.getSource(ids.pts).setData({ type: "FeatureCollection", features: gates.features.flatMap((f, i) => inYear(f.properties) ? [{
      type: "Feature", id: i, geometry: f.geometry,
      properties: { gate: f.properties.gate, v: vals[i], label: fmt(vals[i]), sel: f.properties.gate === st.sel },
    }] : []) });
    // heat: colour = distance-weighted mix of the gates within R, fade = distance to the nearest one
    const he = heatExprs(vals);
    map.setPaintProperty(ids.heat, "line-color", he.color);
    map.setPaintProperty(ids.heat, "line-opacity", he.opacity);
    map.setPaintProperty(ids.pts, "circle-color", colorExpr(V_PT));
    syncVisibility();
    renderControls();
    if (st.sel) showCard(st.sel, false);
  }

  function syncVisibility() {
    if (!map.getLayer(ids.pts)) return;
    map.setLayoutProperty(ids.heat, "visibility", vis(st.on && st.heat));
    map.setLayoutProperty(ids.pts, "visibility", vis(st.on));
    map.setLayoutProperty(ids.lbl, "visibility", vis(st.on && st.numbers));
  }

  // ---------------------------------------------------------------- left sidebar: switches under the layer row
  const controls = h("div", "cnt-panel", { hidden: !st.on });
  function seg(label, options, key, disabled = () => false) {
    const row = h("div", "cnt-row");
    const l = h("div", "cnt-label"); l.textContent = label;
    const box = h("div", "cnt-seg");
    for (const [v, t, title] of options) {
      const b = h("button", st[key] === v ? "active" : null, { type: "button", title: title || "" });
      b.textContent = t;
      b.disabled = disabled(v);
      b.addEventListener("click", () => { st[key] = v; repaint(); });
      box.append(b);
    }
    row.append(l, box);
    return row;
  }
  function renderControls() {
    controls.innerHTML = "";
    const no26 = "No 2026 counts yet (data/raw/teacher_ss_model/Calculations/Pedestrian counting 2026.csv)";
    controls.append(
      seg("Year", [["2016", "2016"], ["2025", "2025", "Winter semester 2025: peak hour on a working day, per hour"],
        ["2026", "2026", has26 ? "" : no26], ["delta", "Δ 26–16", has26 ? "2026 minus 2016, 16–18" : no26]], "year",
        (v) => (v === "2026" || v === "delta") && !has26),
      seg("Day", COUNT_DAYS, "day", (v) => st.year === "2026" || st.year === "2025" || (st.year === "delta" && v === "WE")),
      seg("Time", COUNT_TIMES, "time", (v) => st.year !== "2016" && v !== "PM"),
      seg("Count", ALL_MEASURES, "measure", (v) => st.year === "2025" ? !COUNT_MEASURES_25.includes(v) : v === "veh"),
    );
    const show = h("div", "cnt-row cnt-checks");
    for (const [key, t] of [["numbers", "Numbers"], ["heat", "Heat on streets"]]) {
      const lab = h("label", "cnt-check");
      const cb = h("input", null, { type: "checkbox" }); cb.checked = st[key];
      cb.addEventListener("change", () => { st[key] = cb.checked; syncVisibility(); });
      const s = h("span"); s.textContent = t;
      lab.append(cb, s); show.append(lab);
    }
    const peak = h("button", "cnt-peak", { type: "button", title: "Working days, 16–18, all pedestrians — the 2016 slot comparable with the 2026 count at 17:00" });
    peak.textContent = "★ Peak hour (Ø Workdays · 16–18 · Pedestrians)";
    peak.addEventListener("click", () => { Object.assign(st, { day: "WDA", time: "PM", measure: "all" }); repaint(); });
    controls.append(show, peak, legendBar());
    if (st.year !== "2016") {
      const n = h("div", "cnt-note");
      n.textContent = st.year === "2025" ? "2025: one peak-hour count on a working day, per hour (2016: per 15 min). Gates V1–Z1 are new in 2025."
        : st.year === "2026" ? "2026: one count on a working day at 17:00." : `Δ = 2026 minus 2016 (${COUNT_DAYS.find((d) => d[0] === st.day)[1]}, 16–18).`;
      controls.append(n);
    }
  }
  function legendBar() {
    const wrap = h("div", "cnt-legend");
    const br = breaks(), ramp = isDelta() ? DELTA_RAMP : COUNT_RAMP;
    const bar = h("div", "cnt-legend-bar");
    bar.style.background = `linear-gradient(to right, ${ramp.join(", ")})`;
    const ticks = h("div", "cnt-legend-ticks");
    for (const b of br) { const t = h("span"); t.textContent = (isDelta() && b > 0 ? "+" : "") + b + (b === br[br.length - 1] && !isDelta() ? "+" : ""); ticks.append(t); }
    const cap = h("div", "cnt-note");
    cap.textContent = isDelta() ? "Change, people / 15 min"
      : st.year === "2025" ? `${st.measure === "veh" ? "Vehicles" : "People"} per hour (peak hour) · white = not counted`
      : "People crossing the gate in 15 min · white = no count";
    wrap.append(bar, ticks, cap);
    return wrap;
  }

  // ---------------------------------------------------------------- right toolbar: card of one gate
  const card = h("div", "tools-section cnt-card", { hidden: true });
  toolsBody.prepend(card);
  function showCard(name, scroll = true) {
    const f = gates && gates.features.find((x) => x.properties.gate === name);
    if (!f) return;
    const p = f.properties;
    const prev = st.sel; st.sel = name;
    const filled = new Map((p.filled || "").split(",").filter(Boolean).map((s) => { const [k, src] = s.split(":"); return [k, src]; }));
    card.innerHTML = "";
    const head = h("div", "cnt-card-head");
    const title = h("div", "tools-label"); title.textContent = `Counting gate ${name}`;
    const close = h("button", "cnt-close", { type: "button", title: "Close" }); close.textContent = "×";
    close.addEventListener("click", () => { card.hidden = true; st.sel = null; repaint(); });
    head.append(title, close);
    card.append(head);

    const cur = lookup(p);
    const vals = gates.features.filter((x) => inYear(x.properties)).map((x) => lookup(x.properties)).filter((v) => v != null).sort((a, b) => b - a);
    const big = h("div", "cnt-big");
    const bigV = h("span", "cnt-big-v"); bigV.textContent = fmt(cur);
    const bigT = h("span", "cnt-big-t");
    const dayName = st.year === "2026" ? "Working day 2026" : COUNT_DAYS.find((d) => d[0] === st.day)[1];
    const mName = ALL_MEASURES.find((m) => m[0] === st.measure)[1];
    bigT.textContent = (st.year === "2025" ? `Peak hour 2025 · ${mName} / h`
      : `${st.year === "delta" ? "Δ 2026–2016 · " : ""}${dayName} · ${st.year === "2016" ? COUNT_TIMES.find((t) => t[0] === st.time)[1] : "16–18"} · ${mName}`)
      + (cur != null ? ` · rank ${vals.indexOf(cur) + 1} of ${vals.length}` : "");
    big.append(bigV, bigT);
    card.append(big);

    const in16 = yearsOf(p).includes("2016");
    for (const [m, mName] of in16 ? COUNT_MEASURES : []) {
      const t = h("table", "cnt-table");
      const hr = h("tr"); const c0 = h("th"); c0.textContent = mName; hr.append(c0);
      for (const [, tName] of COUNT_TIMES) { const th = h("th"); th.textContent = tName; hr.append(th); }
      t.append(hr);
      for (const [d, dName] of COUNT_DAYS) {
        const tr = h("tr"); const th = h("th"); th.textContent = dName; tr.append(th);
        for (const [tm] of COUNT_TIMES) {
          const k = `${d}_${tm}_${m}`, v = p[`c16_${k}`];
          const td = h("td");
          td.textContent = v == null ? "–" : String(Math.round(v * 10) / 10);
          const src = filled.get(k);
          if (src) { td.classList.add("filled"); td.textContent += "*"; td.title = src === "all" ? "Filled: = all pedestrians of this slot" : `Filled from ${src === "WD1" ? "Workday 1" : "Workday 2"}`; }
          if (d === "WDA") td.classList.add("avg");
          if (st.year === "2016" && d === st.day && tm === st.time && m === st.measure) td.classList.add("cur");
          tr.append(td);
        }
        t.append(tr);
      }
      card.append(t);
    }
    const raw = COUNT_DAYS.slice(0, 3).flatMap(([d]) => COUNT_TIMES.map(([tm]) => p[`c16_${d}_${tm}_all`])).filter((v) => v != null);
    const stats = h("div", "cnt-stats");
    stats.textContent = raw.length
      ? `Pedestrians 2016, all ${raw.length} counts: min ${Math.min(...raw)} · max ${Math.max(...raw)} · mean ${Math.round(raw.reduce((a, b) => a + b, 0) / raw.length * 10) / 10}`
      : "";
    if (!in16) stats.textContent = "2016: no gate here (first counted in 2025).";
    const y25 = h("div", "cnt-stats");
    y25.textContent = !yearsOf(p).includes("2025") ? "2025: not a count point."
      : p.c25_all != null || p.c25_veh != null ? `2025 (peak hour, per hour): pedestrians ${p.c25_all ?? "–"} · vehicles ${p.c25_veh ?? "–"}`
      : "2025: count point, but not counted.";
    const y26 = h("div", "cnt-stats");
    y26.textContent = p.c26_all != null || p.c26_cyc != null
      ? `2026 (working day, 17:00): pedestrians ${p.c26_all ?? "–"} · w/o groups ${p.c26_ind ?? "–"} · cyclists ${p.c26_cyc ?? "–"} · Δ to Ø workdays 16–18: ${p.c26_all != null && p.c16_WDA_PM_all != null ? fmtSigned(p.c26_all - p.c16_WDA_PM_all) : "–"}`
      : "2026: not counted yet.";
    const note = h("div", "tools-note");
    note.textContent = "2016: people crossing the gate line in 15 min, both directions, older than 10. * = gap filled from the other working day (hover for the source). Ø Workdays = mean of Workday 1 and 2. 2025: per hour.";
    card.append(stats, y25, y26, note);
    card.hidden = false;
    if (prev !== name) repaint();
    if (scroll) card.scrollIntoView({ block: "nearest" });
  }
  const fmtSigned = (v) => (v > 0 ? "+" : "") + Math.round(v * 10) / 10;

  function setVisible(v) {
    st.on = v;
    controls.hidden = !v;
    if (!v) { card.hidden = true; st.sel = null; }
    if (gates) repaint(); else syncVisibility();
  }

  // ---------------------------------------------------------------- load
  addLayers();
  renderControls();
  Promise.all([fetch(resolveUrl(config.url)).then((r) => r.json()), fetch(resolveUrl(config.heatUrl)).then((r) => r.json())])
    .then(([g, hfc]) => {
      gates = g; R = hfc.heatRadius || R;
      const dummy = g.features.length;
      map.getSource(ids.heat).setData({ type: "FeatureCollection", features: hfc.features.map((f) => {
        const near = f.properties.g.split(",").map((s) => s.split(":").map(Number)).sort((a, b) => a[1] - b[1]);
        const props = {};
        for (let i = 0; i < HEAT_K; i++) { const [gi, d] = near[i] || [dummy, R]; props["g" + i] = gi; props["d" + i] = d; }
        return { type: "Feature", geometry: f.geometry, properties: props };
      }) });
      has26 = g.features.some((f) => f.properties.c26_all != null);
      repaint();
    })
    .catch((err) => console.error("[counts] failed to load:", err));

  return { layerIds, setVisible, controls, showCard };
}
