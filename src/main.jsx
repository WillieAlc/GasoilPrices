import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";

const selectionStorageKey = "fuel-app-selection";
const favoritesStorageKey = "fuel-app-favorites";
const scrollStorageKey = "fuel-app-home-scroll";
const fallbackProvinceId = "28";
const ranges = [
  { value: 7, label: "Semana" },
  { value: 15, label: "15 días" },
  { value: 30, label: "Mes" },
  { value: 90, label: "3 meses" },
  { value: 180, label: "6 meses" },
  { value: 365, label: "1 año" }
];

function readStoredSelection() {
  try {
    const raw = window.localStorage.getItem(selectionStorageKey);
    if (!raw) {
      return null;
    }

    const parsed = JSON.parse(raw);
    if (!parsed?.provinceId) {
      return null;
    }

    return {
      provinceId: parsed.provinceId,
      municipalityId: parsed.municipalityId || ""
    };
  } catch {
    return null;
  }
}

function writeStoredSelection(provinceId, municipalityId) {
  try {
    window.localStorage.setItem(
      selectionStorageKey,
      JSON.stringify({ provinceId, municipalityId })
    );
  } catch {
    // ignore storage failures
  }
}

function readStoredFavorites() {
  try {
    const raw = window.localStorage.getItem(favoritesStorageKey);
    if (!raw) {
      return [];
    }

    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeStoredFavorites(favorites) {
  try {
    window.localStorage.setItem(favoritesStorageKey, JSON.stringify(favorites));
  } catch {
    // ignore storage failures
  }
}

function saveHomeScroll() {
  try {
    window.sessionStorage.setItem(scrollStorageKey, String(window.scrollY || 0));
  } catch {
    // ignore storage failures
  }
}

function restoreHomeScroll() {
  try {
    const raw = window.sessionStorage.getItem(scrollStorageKey);
    if (!raw) {
      return;
    }

    const target = Number(raw) || 0;
    window.sessionStorage.removeItem(scrollStorageKey);

    window.requestAnimationFrame(() => {
      window.scrollTo({ top: target, behavior: "auto" });
      window.setTimeout(() => {
        window.scrollTo({ top: target, behavior: "auto" });
      }, 250);
    });
  } catch {
    // ignore storage failures
  }
}

function setupAnalytics(config) {
  if (!config?.enabled || config.provider !== "ga4" || !config.measurementId) {
    return;
  }

  if (document.querySelector(`script[data-ga4-id="${config.measurementId}"]`)) {
    return;
  }

  const script = document.createElement("script");
  script.async = true;
  script.src = `https://www.googletagmanager.com/gtag/js?id=${config.measurementId}`;
  script.dataset.ga4Id = config.measurementId;
  document.head.appendChild(script);

  window.dataLayer = window.dataLayer || [];
  window.gtag = window.gtag || function gtag() {
    window.dataLayer.push(arguments);
  };
  window.gtag("js", new Date());
  window.gtag("config", config.measurementId);
}

function formatPrice(price) {
  if (price === null || price === undefined) {
    return "Sin dato";
  }

  return `${price.toFixed(3).replace(".", ",")} €/L`;
}

function formatPriceChange(change) {
  if (change === null || change === undefined) {
    return "Sin referencia";
  }

  if (change === 0) {
    return "Igual que ayer";
  }

  const prefix = change > 0 ? "+" : "-";
  return `${prefix}${Math.abs(change).toFixed(3).replace(".", ",")} €/L vs ayer`;
}

function getPriceChangeClass(change) {
  if (change === null || change === undefined) {
    return "neutral";
  }

  if (change < 0) {
    return "down";
  }

  if (change > 0) {
    return "up";
  }

  return "flat";
}

function getPriceTone(index, total) {
  if (total <= 1) {
    return "hsl(120 45% 78%)";
  }

  const ratio = index / (total - 1);
  const hue = 120 - ratio * 120;
  return `hsl(${hue} 65% 79%)`;
}

function navigateTo(url) {
  window.location.href = url;
}

function updateHomeUrl(provinceId, municipalityId) {
  const url = new URL(window.location.href);

  if (provinceId) {
    url.searchParams.set("provinceId", provinceId);
  } else {
    url.searchParams.delete("provinceId");
  }

  if (municipalityId) {
    url.searchParams.set("municipalityId", municipalityId);
  } else {
    url.searchParams.delete("municipalityId");
  }

  window.history.replaceState({}, "", `${url.pathname}${url.search}`);
}

async function copyCurrentUrl() {
  try {
    await navigator.clipboard.writeText(window.location.href);
    return true;
  } catch {
    return false;
  }
}

function SummaryCard({ item }) {
  return (
    <section className="summary-card">
      <p className="summary-label">Media de hoy</p>
      <p className="summary-value">{formatPrice(item.averagePrice)}</p>
      <p className="summary-meta">{item.name}</p>
    </section>
  );
}

function Footer({ version }) {
  return <footer className="app-footer">Versión {version} · beta pública</footer>;
}

function StationRow({
  station,
  index,
  total,
  productId,
  fuelName,
  isFavorite,
  onToggleFavorite
}) {
  const tone = getPriceTone(index, total);
  const params = new URLSearchParams({
    stationId: station.id,
    municipalityId: station.municipalityId,
    productId,
    stationName: station.name,
    address: station.address,
    fuelName
  });

  return (
    <li className="station-item" style={{ backgroundColor: tone }}>
      <p className="station-rank">#{index + 1}</p>
      <div className="station-main">
        <div className="station-title-row">
          <p className="station-name">{station.name}</p>
          <button
            className={`favorite-button${isFavorite ? " active" : ""}`}
            type="button"
            aria-label={isFavorite ? "Quitar de favoritos" : "Añadir a favoritos"}
            onClick={() => onToggleFavorite(station.id)}
          >
            {"\u2605"}
          </button>
        </div>
        <p className="station-meta">{station.address}</p>
      </div>
      <div className="station-price-block">
        <p className="station-price">{formatPrice(station.price)}</p>
        <p className={`station-change ${getPriceChangeClass(station.priceChange)}`}>
          {formatPriceChange(station.priceChange)}
        </p>
      </div>
      <button
        className="chart-button"
        type="button"
        onClick={() => {
          saveHomeScroll();
          navigateTo(`/historial?${params.toString()}`);
        }}
      >
        Mostrar gráfica
      </button>
    </li>
  );
}

function FuelCard({ result, favorites, onToggleFavorite }) {
  return (
    <article className="fuel-card">
      <div className="card-header">
        <div>
          <p className="card-label">Carburante</p>
          <h2 className="card-title">{result.name}</h2>
        </div>
        <div className="card-stats">
          <span className="badge">{result.stations.length} estaciones</span>
          <span className="soft-badge">Media {formatPrice(result.averagePrice)}</span>
        </div>
      </div>

      <div className="legend">
        <span>Más barata</span>
        <div className="legend-bar" />
        <span>Más cara</span>
      </div>

      {result.stations.length === 0 ? (
        <p className="empty-state">No hay precios disponibles para este carburante.</p>
      ) : (
        <ol className="station-list">
          {result.stations.map((station, index) => (
            <StationRow
              key={`${result.id}-${station.id}`}
              station={station}
              index={index}
              total={result.stations.length}
              productId={result.productId}
              fuelName={result.name}
              isFavorite={favorites.includes(station.id)}
              onToggleFavorite={onToggleFavorite}
            />
          ))}
        </ol>
      )}
    </article>
  );
}

function FilterPanel({
  provinces,
  municipalities,
  selectedProvinceId,
  selectedMunicipalityId,
  onProvinceChange,
  onMunicipalityChange,
  onShare,
  shareStatus
}) {
  return (
    <aside className="hero-card">
      <div className="filter-header">
        <p className="hero-card-label">Filtros</p>
        <button className="share-button" type="button" onClick={onShare}>
          Copiar enlace
        </button>
      </div>
      <div className="filter-grid">
        <label className="filter-field">
          <span>Provincia</span>
          <select value={selectedProvinceId} onChange={(event) => onProvinceChange(event.target.value)}>
            {provinces.map((province) => (
              <option key={province.id} value={province.id}>
                {province.name}
              </option>
            ))}
          </select>
        </label>

        <label className="filter-field">
          <span>Municipio</span>
          <select
            value={selectedMunicipalityId}
            onChange={(event) => onMunicipalityChange(event.target.value)}
          >
            <option value="">Selecciona un municipio</option>
            {municipalities.map((municipality) => (
              <option key={municipality.id} value={municipality.id}>
                {municipality.name}
              </option>
            ))}
          </select>
        </label>
      </div>

      <p className="share-status">{shareStatus}</p>

      <ul className="filter-list compact">
        <li>Tipo de búsqueda: estaciones de servicio</li>
        <li>Venta: venta al público</li>
      </ul>
    </aside>
  );
}

function HomePage({ appConfig }) {
  const urlParams = new URLSearchParams(window.location.search);
  const storedSelection = readStoredSelection();
  const initialProvinceId =
    urlParams.get("provinceId") ||
    storedSelection?.provinceId ||
    appConfig.defaultProvinceId ||
    fallbackProvinceId;
  const initialMunicipalityId =
    urlParams.get("municipalityId") || storedSelection?.municipalityId || "";

  const [provinces, setProvinces] = useState([]);
  const [municipalities, setMunicipalities] = useState([]);
  const [selectedProvinceId, setSelectedProvinceId] = useState(initialProvinceId);
  const [selectedMunicipalityId, setSelectedMunicipalityId] = useState(initialMunicipalityId);
  const [favorites, setFavorites] = useState(readStoredFavorites());
  const [shareStatus, setShareStatus] = useState("");
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [filtersLoading, setFiltersLoading] = useState(true);
  const [reloadTick, setReloadTick] = useState(0);

  useEffect(() => {
    restoreHomeScroll();
  }, []);

  useEffect(() => {
    async function loadProvinces() {
      try {
        const response = await fetch("/api/filters", { cache: "no-store" });
        const payload = await response.json();
        if (!response.ok) {
          throw new Error(payload.error || "No se pudieron cargar las provincias.");
        }
        setProvinces(payload);
      } catch (loadError) {
        setError(loadError.message);
      }
    }

    loadProvinces();
  }, []);

  useEffect(() => {
    async function loadMunicipalities() {
      setFiltersLoading(true);
      try {
        const response = await fetch(`/api/filters/municipalities?provinceId=${selectedProvinceId}`, {
          cache: "no-store"
        });
        const payload = await response.json();
        if (!response.ok) {
          throw new Error(payload.error || "No se pudieron cargar los municipios.");
        }
        setMunicipalities(payload);
        if (selectedMunicipalityId && !payload.some((item) => item.id === selectedMunicipalityId)) {
          setSelectedMunicipalityId("");
        }
      } catch (loadError) {
        setError(loadError.message);
      } finally {
        setFiltersLoading(false);
      }
    }

    loadMunicipalities();
  }, [selectedProvinceId]);

  useEffect(() => {
    if (selectedProvinceId) {
      writeStoredSelection(selectedProvinceId, selectedMunicipalityId);
      updateHomeUrl(selectedProvinceId, selectedMunicipalityId);
    }
  }, [selectedProvinceId, selectedMunicipalityId]);

  useEffect(() => {
    writeStoredFavorites(favorites);
  }, [favorites]);

  useEffect(() => {
    if (!selectedProvinceId || !selectedMunicipalityId) {
      setData(null);
      setLoading(false);
      return;
    }

    async function loadPrices() {
      setLoading(true);
      setError("");

      try {
        const query = new URLSearchParams({
          provinceId: selectedProvinceId,
          municipalityId: selectedMunicipalityId
        });
        const response = await fetch(`/api/prices?${query.toString()}`, { cache: "no-store" });
        const payload = await response.json();
        if (!response.ok) {
          throw new Error(payload.error || "No se pudo cargar la información.");
        }
        setData(payload);
      } catch (loadError) {
        setError(loadError.message);
      } finally {
        setLoading(false);
      }
    }

    loadPrices();
  }, [selectedProvinceId, selectedMunicipalityId, reloadTick]);

  const results = data?.results ?? [];
  const summary = data?.summary ?? [];
  const selectedProvince = provinces.find((item) => item.id === selectedProvinceId);
  const selectedMunicipality = municipalities.find((item) => item.id === selectedMunicipalityId);

  async function handleShare() {
    const ok = await copyCurrentUrl();
    setShareStatus(ok ? "Enlace copiado al portapapeles." : "No se pudo copiar el enlace.");
    window.setTimeout(() => setShareStatus(""), 2500);
  }

  function handleToggleFavorite(stationId) {
    setFavorites((current) =>
      current.includes(stationId)
        ? current.filter((item) => item !== stationId)
        : [...current, stationId]
    );
  }

  return (
    <div className="app-shell">
      <div className="page-shell">
        <header className="hero">
          <div className="hero-copy compact-hero">
            <h1>Precios diarios combustible</h1>
            <p className="hero-subtext">
              {selectedMunicipality?.name || "Selecciona un municipio"}
              {selectedProvince ? `, ${selectedProvince.name}` : ""}
            </p>
          </div>

          <FilterPanel
            provinces={provinces}
            municipalities={municipalities}
            selectedProvinceId={selectedProvinceId}
            selectedMunicipalityId={selectedMunicipalityId}
            onProvinceChange={(provinceId) => {
              setSelectedProvinceId(provinceId);
              setSelectedMunicipalityId("");
            }}
            onMunicipalityChange={setSelectedMunicipalityId}
            onShare={handleShare}
            shareStatus={shareStatus}
          />
        </header>

        <section className="top-grid">
          <section className="status-panel">
            <div>
              <p className="status-label">Actualización</p>
              <p className="status-value">
                {selectedMunicipalityId
                  ? data?.sourceTimestampFormatted ?? (loading ? "Cargando datos..." : "Sin datos")
                  : "Selecciona un municipio"}
              </p>
            </div>
            <button
              className="refresh-button"
              onClick={() => setReloadTick((value) => value + 1)}
              disabled={loading || filtersLoading || !selectedMunicipalityId}
              type="button"
            >
              {loading ? "Actualizando..." : "Actualizar"}
            </button>
          </section>

          <div className="summary-stack">
            {selectedMunicipalityId && summary.length > 0 ? (
              summary.map((item) => <SummaryCard key={item.productId} item={item} />)
            ) : (
              <section className="summary-card summary-card-wide">
                <p className="summary-label">Media de hoy</p>
                <p className="summary-value">
                  {selectedMunicipalityId ? "Sin datos" : "Esperando selección"}
                </p>
                <p className="summary-meta">Elige un municipio para ver precios y medias.</p>
              </section>
            )}
          </div>
        </section>

        {error ? (
          <article className="error-panel">{error}</article>
        ) : !selectedMunicipalityId ? (
          <article className="fuel-card">Selecciona un municipio para cargar el listado de gasolineras.</article>
        ) : loading || filtersLoading ? (
          <article className="fuel-card">Cargando datos del municipio seleccionado...</article>
        ) : (
          <main className="cards-grid">
            {results.map((result) => (
              <FuelCard
                key={result.id}
                result={result}
                favorites={favorites}
                onToggleFavorite={handleToggleFavorite}
              />
            ))}
          </main>
        )}

        <Footer version={appConfig.version} />
      </div>
    </div>
  );
}

function buildCoordinates(points, width, height, padding) {
  const prices = points.map((point) => point.price);
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const spread = max - min || 0.001;
  const stepX = points.length === 1 ? 0 : (width - padding * 2) / (points.length - 1);

  return points.map((point, index) => ({
    x: padding + stepX * index,
    y: height - padding - ((point.price - min) / spread) * (height - padding * 2),
    label: point.label
  }));
}

function buildSmoothLine(points) {
  if (points.length === 0) {
    return "";
  }

  if (points.length === 1) {
    return `M ${points[0].x} ${points[0].y}`;
  }

  let path = `M ${points[0].x} ${points[0].y}`;

  for (let index = 0; index < points.length - 1; index += 1) {
    const current = points[index];
    const next = points[index + 1];
    const midpointX = (current.x + next.x) / 2;
    path += ` C ${midpointX} ${current.y}, ${midpointX} ${next.y}, ${next.x} ${next.y}`;
  }

  return path;
}

function Chart({ points }) {
  const width = 920;
  const height = 360;
  const padding = 38;

  if (points.length === 0) {
    return <div className="chart-empty">No hay suficientes datos históricos para esta estación.</div>;
  }

  const coordinates = buildCoordinates(points, width, height, padding);
  const prices = points.map((point) => point.price);
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const spread = max - min || 0.001;
  const linePath = buildSmoothLine(coordinates);
  const areaPath = `${linePath} L ${coordinates[coordinates.length - 1].x} ${height - padding} L ${coordinates[0].x} ${height - padding} Z`;
  const ticks = [0, 1, 2, 3].map((step) => {
    const ratio = step / 3;
    const value = max - spread * ratio;
    const y = padding + (height - padding * 2) * ratio;
    return { value, y };
  });
  const xMarks = [0, Math.floor((coordinates.length - 1) / 2), coordinates.length - 1]
    .filter((value, index, array) => array.indexOf(value) === index)
    .map((index) => ({ x: coordinates[index].x, label: coordinates[index].label }));

  return (
    <div className="chart-shell">
      <svg viewBox={`0 0 ${width} ${height}`} className="chart-svg" role="img" aria-label="Evolución histórica del precio">
        <defs>
          <linearGradient id="lineGradient" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#5b9b6b" />
            <stop offset="55%" stopColor="#d0b861" />
            <stop offset="100%" stopColor="#c36f61" />
          </linearGradient>
          <linearGradient id="areaGradient" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor="rgba(91, 155, 107, 0.24)" />
            <stop offset="100%" stopColor="rgba(91, 155, 107, 0)" />
          </linearGradient>
        </defs>

        {ticks.map((tick) => (
          <g key={tick.y}>
            <line x1={padding} x2={width - padding} y1={tick.y} y2={tick.y} className="grid-line" />
            <text x="8" y={tick.y + 4} className="axis-label">
              {tick.value.toFixed(3).replace(".", ",")}
            </text>
          </g>
        ))}

        <path d={areaPath} fill="url(#areaGradient)" />
        <path d={linePath} fill="none" stroke="url(#lineGradient)" strokeWidth="4" strokeLinejoin="round" strokeLinecap="round" />

        {xMarks.map((mark) => (
          <text key={mark.x} x={mark.x} y={height - 8} textAnchor="middle" className="axis-label">
            {mark.label}
          </text>
        ))}
      </svg>
    </div>
  );
}

function HistoryPage({ appConfig }) {
  const params = new URLSearchParams(window.location.search);
  const stationId = params.get("stationId") || "";
  const municipalityId = params.get("municipalityId") || appConfig.defaultMunicipalityId || "";
  const productId = params.get("productId") || "";
  const initialFuelName = params.get("fuelName") || "Carburante";
  const initialStationName = params.get("stationName") || "Estación";
  const initialAddress = params.get("address") || "";
  const backUrl = `/?provinceId=${appConfig.defaultProvinceId || fallbackProvinceId}&municipalityId=${municipalityId}`;

  const [days, setDays] = useState(30);
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadHistory() {
      setLoading(true);
      setError("");

      try {
        const query = new URLSearchParams({
          stationId,
          municipalityId,
          productId,
          days: String(days)
        });
        const response = await fetch(`/api/history?${query.toString()}`, { cache: "no-store" });
        const payload = await response.json();

        if (!response.ok) {
          throw new Error(payload.error || "No se pudo cargar el histórico.");
        }

        setData(payload);
      } catch (loadError) {
        setError(loadError.message);
      } finally {
        setLoading(false);
      }
    }

    loadHistory();
  }, [days, municipalityId, productId, stationId]);

  return (
    <div className="app-shell history-shell">
      <div className="page-shell">
        <section className="history-header">
          <div>
            <button className="back-button" type="button" onClick={() => navigateTo(backUrl)}>
              Volver al listado
            </button>
            <p className="eyebrow">Histórico de precios</p>
            <h1 className="history-title">{data?.station?.name || initialStationName}</h1>
            <p className="hero-text">{data?.station?.address || initialAddress}</p>
            <p className="history-subtitle">{data?.fuel?.name || initialFuelName}</p>
          </div>

          <div className="history-stats">
            <div className="summary-card">
              <p className="summary-label">Último precio</p>
              <p className="summary-value">{formatPrice(data?.stats?.latestPrice)}</p>
            </div>
            <div className="summary-card">
              <p className="summary-label">Mínimo del tramo</p>
              <p className="summary-value">{formatPrice(data?.stats?.minPrice)}</p>
            </div>
          </div>
        </section>

        <section className="range-panel">
          {ranges.map((range) => (
            <button
              key={range.value}
              className={`range-chip${days === range.value ? " active" : ""}`}
              type="button"
              onClick={() => setDays(range.value)}
            >
              {range.label}
            </button>
          ))}
        </section>

        {error ? (
          <article className="error-panel">{error}</article>
        ) : loading ? (
          <article className="fuel-card">Cargando histórico...</article>
        ) : (
          <section className="history-card">
            <Chart points={data?.points ?? []} />
          </section>
        )}

        <Footer version={appConfig.version} />
      </div>
    </div>
  );
}

function App() {
  const [appConfig, setAppConfig] = useState({
    version: "1.0.0-beta-publica",
    defaultProvinceId: fallbackProvinceId,
    defaultMunicipalityId: "",
    analytics: { provider: "ga4", enabled: false, measurementId: "" }
  });

  useEffect(() => {
    async function loadAppConfig() {
      try {
        const response = await fetch("/api/app-config", { cache: "no-store" });
        const payload = await response.json();
        if (!response.ok) {
          return;
        }
        setAppConfig(payload);
        setupAnalytics(payload.analytics);
      } catch {
        // ignore config errors and keep fallback config
      }
    }

    loadAppConfig();
  }, []);

  const isHistory = window.location.pathname === "/historial";
  return isHistory ? <HistoryPage appConfig={appConfig} /> : <HomePage appConfig={appConfig} />;
}

createRoot(document.getElementById("root")).render(<App />);
