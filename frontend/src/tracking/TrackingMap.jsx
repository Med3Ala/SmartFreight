import { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { feature } from "topojson-client";
import land from "world-atlas/land-110m.json";
import { carrierColor, fmtDate, port } from "./model";

const LAND = feature(land, land.objects.land);
// The single-file preview runs where map tiles can't load; it uses the bundled coastline only.
const USE_TILES = import.meta.env.MODE !== "preview";

function css(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

const isDark = () => css("color-scheme") === "dark";

function resolve(color) {
  const m = /^var\((--[\w-]+)\)$/.exec(color);
  return m ? css(m[1]) : color;
}

function tooltip(s) {
  const when = s.phase === "arrived" ? `Arrived ${fmtDate(s.ata)}` : `ETA ${fmtDate(s.eta)}${s.is_delayed ? " · late" : ""}`;
  const div = document.createElement("div");
  div.innerHTML = "<strong></strong><br><span></span><br><span></span>";
  div.children[0].textContent = `${s.carrier} · ${s.vessel?.name ?? s.container_number}`;
  div.children[2].textContent = `${port(s.origin)} → ${port(s.destination)}`;
  div.children[4].textContent = `${s.containers.length} box${s.containers.length === 1 ? "" : "es"} · ${when}`;
  return div;
}

export default function TrackingMap({ shipments, selected, onSelect, theme }) {
  const el = useRef(null);
  const map = useRef(null);
  const layers = useRef(null);

  useEffect(() => {
    const m = L.map(el.current, { worldCopyJump: true, zoomSnap: 0.5, attributionControl: true }).setView([38, 15], 3);
    m.createPane("land").style.zIndex = 150;
    map.current = m;
    layers.current = { base: L.layerGroup().addTo(m), data: L.layerGroup().addTo(m) };
    return () => m.remove();
  }, []);

  // Base map follows the page theme.
  useEffect(() => {
    const { base } = layers.current;
    base.clearLayers();
    L.geoJSON(LAND, {
      pane: "land",
      interactive: false,
      style: { color: resolve("var(--line)"), weight: 1, fillColor: resolve("var(--map-land)"), fillOpacity: 1 },
    }).addTo(base);
    if (USE_TILES) {
      const style = isDark() ? "dark_all" : "light_all";
      L.tileLayer(`https://{s}.basemaps.cartocdn.com/${style}/{z}/{x}/{y}{r}.png`, {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/">CARTO</a>',
        subdomains: "abcd",
        maxZoom: 12,
      }).addTo(base);
    }
  }, [theme]);

  useEffect(() => {
    const { data } = layers.current;
    data.clearLayers();
    const surface = resolve("var(--surface)");
    const late = resolve("var(--bad)");
    const points = [];
    for (const s of shipments) {
      const color = resolve(carrierColor(s.carrier));
      const isSel = s.container_number === selected;
      if (s.route.length > 1 && (isSel || !selected)) {
        L.polyline(s.route, {
          color,
          weight: isSel ? 3 : 1.5,
          opacity: isSel ? 0.95 : 0.35,
          dashArray: s.phase === "arrived" ? "4 4" : null,
          interactive: false,
        }).addTo(data);
      }
      if (!s.position) continue;
      points.push(s.position);
      L.circleMarker(s.position, {
        radius: isSel ? 9 : s.phase === "arrived" ? 5 : 7,
        color: s.is_delayed && s.phase !== "arrived" ? late : surface,
        weight: s.is_delayed && s.phase !== "arrived" ? 3 : 2,
        fillColor: color,
        fillOpacity: s.phase === "arrived" ? 0.55 : 1,
      })
        .bindTooltip(tooltip(s), { direction: "top", offset: [0, -6] })
        .on("click", () => onSelect(isSel ? null : s.container_number))
        .addTo(data);
    }
    if (selected) {
      const s = shipments.find((x) => x.container_number === selected);
      if (s?.route.length > 1) map.current.fitBounds(s.route, { padding: [30, 30], maxZoom: 6 });
    } else if (points.length) {
      map.current.fitBounds(points, { padding: [40, 40], maxZoom: 5 });
    }
  }, [shipments, selected, onSelect, theme]);

  return <div ref={el} className="h-[420px] w-full rounded-md border border-line" role="region" aria-label="Map of tracked vessels and containers" />;
}
