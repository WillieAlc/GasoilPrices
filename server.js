const http = require("node:http");
const fs = require("node:fs/promises");
const path = require("node:path");

//const HOST = "127.0.0.1";
const HOST = "0.0.0.0";
const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, "public");
const API_BASE =
  "https://sedeaplicaciones.minetur.gob.es/ServiciosRESTCarburantes/PreciosCarburantes";
const CACHE_TTL_MS = 30 * 60 * 1000;
const HISTORY_CACHE_TTL_MS = 12 * 60 * 60 * 1000;
const DEFAULT_PROVINCE_ID = "28";
const DEFAULT_MUNICIPALITY_ID = "4282";
const APP_VERSION = "1.0.0-beta-publica";
const ANALYTICS_CONFIG = {
  provider: "ga4",
  enabled: Boolean(process.env.GA_MEASUREMENT_ID),
  measurementId: process.env.GA_MEASUREMENT_ID || ""
};

const FILTERS = {
  saleType: "P",
  fuels: [
    {
      key: "Precio Gasolina 95 E5",
      label: "Gasolina 95 E5",
      productId: "1"
    },
    {
      key: "Precio Gasoleo A",
      label: "Gasóleo A Habitual",
      productId: "4"
    }
  ]
};

const fuelByProductId = new Map(FILTERS.fuels.map((fuel) => [fuel.productId, fuel]));

let currentStationsCache = {
  timestamp: 0,
  payload: null
};

let provincesCache = {
  timestamp: 0,
  payload: null
};

const municipalitiesCache = new Map();
const historyCache = new Map();

const CONTENT_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".svg": "image/svg+xml"
};

function parseEuroPrice(rawPrice) {
  if (!rawPrice) {
    return null;
  }

  const normalized = String(rawPrice).replace(",", ".").trim();
  const price = Number.parseFloat(normalized);
  return Number.isFinite(price) ? price : null;
}

function formatTimestamp(fecha) {
  if (!fecha) {
    return null;
  }

  const match = fecha.match(
    /^(\d{2})\/(\d{2})\/(\d{4})\s+(\d{1,2}):(\d{2}):(\d{2})$/
  );

  if (!match) {
    return fecha;
  }

  const [, day, month, year, hour, minute] = match;
  return `${day}/${month}/${year} ${hour.padStart(2, "0")}:${minute}`;
}

function toApiDate(date) {
  const day = String(date.getDate()).padStart(2, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const year = date.getFullYear();
  return `${day}-${month}-${year}`;
}

function toIsoDate(date) {
  const day = String(date.getDate()).padStart(2, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const year = date.getFullYear();
  return `${year}-${month}-${day}`;
}

function toDisplayDate(date) {
  const day = String(date.getDate()).padStart(2, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  return `${day}/${month}`;
}

function averagePrice(stations) {
  if (stations.length === 0) {
    return null;
  }

  const total = stations.reduce((sum, station) => sum + station.price, 0);
  return Number((total / stations.length).toFixed(3));
}

function buildFuelList(stations, fuel) {
  const items = stations
    .map((station) => {
      const price = parseEuroPrice(station[fuel.key]);

      if (price === null) {
        return null;
      }

      return {
        id: station.IDEESS,
        name: station["Rótulo"] || station["Dirección"],
        address: station["Dirección"],
        locality: station.Localidad,
        municipalityId: station.IDMunicipio,
        provinceId: station.IDProvincia,
        price,
        productId: fuel.productId,
        fuelName: fuel.label
      };
    })
    .filter(Boolean)
    .sort((left, right) => left.price - right.price || left.name.localeCompare(right.name));

  return {
    id: fuel.key,
    name: fuel.label,
    productId: fuel.productId,
    averagePrice: averagePrice(items),
    stations: items
  };
}

async function fetchJson(url) {
  const response = await fetch(url, {
    headers: {
      Accept: "application/json"
    }
  });

  if (!response.ok) {
    throw new Error(`Servicio remoto no disponible (${response.status})`);
  }

  return response.json();
}

async function getCurrentRawData() {
  const now = Date.now();

  if (currentStationsCache.payload && now - currentStationsCache.timestamp < CACHE_TTL_MS) {
    return currentStationsCache.payload;
  }

  const payload = await fetchJson(`${API_BASE}/EstacionesTerrestres/`);
  currentStationsCache = {
    timestamp: now,
    payload
  };
  return payload;
}

async function getProvinces() {
  const now = Date.now();

  if (provincesCache.payload && now - provincesCache.timestamp < CACHE_TTL_MS) {
    return provincesCache.payload;
  }

  const payload = await fetchJson(`${API_BASE}/Listados/Provincias/`);
  const provinces = payload
    .map((item) => ({
      id: item.IDPovincia,
      name: item.Provincia,
      region: item.CCAA
    }))
    .sort((left, right) => left.name.localeCompare(right.name, "es"));

  provincesCache = {
    timestamp: now,
    payload: provinces
  };

  return provinces;
}

async function getMunicipalities(provinceId) {
  const safeProvinceId = provinceId || DEFAULT_PROVINCE_ID;
  const cached = municipalitiesCache.get(safeProvinceId);
  const now = Date.now();

  if (cached && now - cached.timestamp < CACHE_TTL_MS) {
    return cached.payload;
  }

  const payload = await fetchJson(`${API_BASE}/Listados/MunicipiosPorProvincia/${safeProvinceId}`);
  const municipalities = payload
    .map((item) => ({
      id: item.IDMunicipio,
      name: item.Municipio,
      provinceId: item.IDProvincia
    }))
    .sort((left, right) => left.name.localeCompare(right.name, "es"));

  municipalitiesCache.set(safeProvinceId, {
    timestamp: now,
    payload: municipalities
  });

  return municipalities;
}

async function getFilteredPrices(provinceId, municipalityId) {
  const safeProvinceId = provinceId || DEFAULT_PROVINCE_ID;
  const rawData = await getCurrentRawData();
  const stations = Array.isArray(rawData.ListaEESSPrecio)
    ? rawData.ListaEESSPrecio.filter((station) => {
        return (
          String(station.IDProvincia) === String(safeProvinceId) &&
          (!municipalityId || String(station.IDMunicipio) === String(municipalityId)) &&
          (station["Tipo Venta"] || "").trim().toUpperCase() === FILTERS.saleType
        );
      })
    : [];

  const provinceName = stations[0]?.Provincia || null;
  const municipalityName = municipalityId ? stations[0]?.Municipio || null : null;
  const results = municipalityId ? FILTERS.fuels.map((fuel) => buildFuelList(stations, fuel)) : [];

  return {
    sourceTimestamp: rawData.Fecha || null,
    sourceTimestampFormatted: formatTimestamp(rawData.Fecha),
    notes: rawData.Nota || "",
    filters: {
      provinceId: safeProvinceId,
      municipalityId: municipalityId || "",
      provinceName,
      municipalityName
    },
    summary: results.map((result) => ({
      id: result.id,
      name: result.name,
      productId: result.productId,
      averagePrice: result.averagePrice
    })),
    results
  };
}

async function fetchHistoryDay(apiDate, municipalityId, productId) {
  const cacheKey = `${apiDate}:${municipalityId}:${productId}`;
  const now = Date.now();
  const cached = historyCache.get(cacheKey);

  if (cached && now - cached.timestamp < HISTORY_CACHE_TTL_MS) {
    return cached.payload;
  }

  const response = await fetch(
    `${API_BASE}/EstacionesTerrestresHist/FiltroMunicipioProducto/${apiDate}/${municipalityId}/${productId}`,
    {
      headers: {
        Accept: "application/json"
      }
    }
  );

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Histórico no disponible (${response.status}): ${detail}`);
  }

  const payload = await response.json();
  historyCache.set(cacheKey, {
    timestamp: now,
    payload
  });
  return payload;
}

async function mapWithConcurrency(items, limit, worker) {
  const results = new Array(items.length);
  let cursor = 0;

  async function run() {
    while (cursor < items.length) {
      const currentIndex = cursor;
      cursor += 1;
      results[currentIndex] = await worker(items[currentIndex], currentIndex);
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, run));
  return results;
}

function buildPointFromCurrent(station, date) {
  return {
    date: toIsoDate(date),
    label: toDisplayDate(date),
    price: station.price,
    station: {
      id: station.id,
      name: station.name,
      address: station.address,
      locality: station.locality
    }
  };
}

async function getStationHistory(stationId, municipalityId, productId, days) {
  const safeMunicipalityId = municipalityId || DEFAULT_MUNICIPALITY_ID;
  const safeDays = Math.max(7, Math.min(Number(days) || 7, 365));
  const fuel = fuelByProductId.get(String(productId));

  if (!fuel) {
    throw new Error("Carburante no soportado para el histórico.");
  }

  const currentData = await getFilteredPrices(null, safeMunicipalityId);
  const currentFuel = currentData.results.find((item) => item.productId === fuel.productId);
  const currentStation = currentFuel?.stations.find((item) => String(item.id) === String(stationId));

  const today = new Date();
  today.setHours(12, 0, 0, 0);

  const dates = [];
  for (let offset = safeDays - 2; offset >= 0; offset -= 1) {
    const date = new Date(today);
    date.setDate(today.getDate() - (offset + 1));
    dates.push(date);
  }

  const rawResults = await mapWithConcurrency(dates, 8, async (date) => {
    const payload = await fetchHistoryDay(toApiDate(date), safeMunicipalityId, fuel.productId);
    const station = Array.isArray(payload.ListaEESSPrecio)
      ? payload.ListaEESSPrecio.find((item) => String(item.IDEESS) === String(stationId))
      : null;

    if (!station) {
      return null;
    }

    const price = parseEuroPrice(station.PrecioProducto);
    if (price === null) {
      return null;
    }

    return {
      date: toIsoDate(date),
      label: toDisplayDate(date),
      price,
      station: {
        id: station.IDEESS,
        name: station["Rótulo"] || station["Dirección"],
        address: station["Dirección"],
        locality: (station.Localidad || "").trim()
      }
    };
  });

  const points = rawResults.filter(Boolean);
  if (currentStation) {
    points.push(buildPointFromCurrent(currentStation, today));
  }

  const station = currentStation
    ? {
        id: currentStation.id,
        name: currentStation.name,
        address: currentStation.address,
        locality: currentStation.locality
      }
    : points[0]?.station || null;
  const prices = points.map((point) => point.price);

  return {
    fuel: {
      productId: fuel.productId,
      name: fuel.label
    },
    station,
    rangeDays: safeDays,
    points: points.map((point) => ({
      date: point.date,
      label: point.label,
      price: point.price
    })),
    stats: {
      minPrice: prices.length ? Math.min(...prices) : null,
      maxPrice: prices.length ? Math.max(...prices) : null,
      latestPrice: prices.length ? prices[prices.length - 1] : null
    }
  };
}

async function serveStaticFile(filePath, response) {
  const relativePath =
    filePath === "/"
      ? "index.html"
      : filePath.replace(/^\/+/, "").replace(/^(\.\.[/\\])+/, "");
  const safePath = path.normalize(relativePath);
  const fullPath = path.join(PUBLIC_DIR, safePath);
  const extension = path.extname(fullPath);

  try {
    const file = await fs.readFile(fullPath);
    response.writeHead(200, {
      "Content-Type": CONTENT_TYPES[extension] || "application/octet-stream"
    });
    response.end(file);
  } catch {
    response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("No encontrado");
  }
}

function sendJson(response, status, payload) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  });
  response.end(JSON.stringify(payload));
}

const server = http.createServer(async (request, response) => {
  const requestUrl = new URL(request.url, `http://${request.headers.host}`);

  if (requestUrl.pathname === "/api/app-config") {
    sendJson(response, 200, {
      version: APP_VERSION,
      defaultProvinceId: DEFAULT_PROVINCE_ID,
      defaultMunicipalityId: DEFAULT_MUNICIPALITY_ID,
      analytics: ANALYTICS_CONFIG
    });
    return;
  }

  if (requestUrl.pathname === "/api/prices") {
    try {
      const payload = await getFilteredPrices(
        requestUrl.searchParams.get("provinceId"),
        requestUrl.searchParams.get("municipalityId")
      );
      sendJson(response, 200, payload);
    } catch (error) {
      sendJson(response, 502, {
        error: "No se han podido cargar los precios en este momento.",
        detail: error.message
      });
    }
    return;
  }

  if (requestUrl.pathname === "/api/filters") {
    try {
      const payload = await getProvinces();
      sendJson(response, 200, payload);
    } catch (error) {
      sendJson(response, 502, {
        error: "No se han podido cargar las provincias.",
        detail: error.message
      });
    }
    return;
  }

  if (requestUrl.pathname === "/api/filters/municipalities") {
    try {
      const provinceId = requestUrl.searchParams.get("provinceId") || DEFAULT_PROVINCE_ID;
      const payload = await getMunicipalities(provinceId);
      sendJson(response, 200, payload);
    } catch (error) {
      sendJson(response, 502, {
        error: "No se han podido cargar los municipios.",
        detail: error.message
      });
    }
    return;
  }

  if (requestUrl.pathname === "/api/history") {
    try {
      const stationId = requestUrl.searchParams.get("stationId");
      const municipalityId = requestUrl.searchParams.get("municipalityId");
      const productId = requestUrl.searchParams.get("productId");
      const days = requestUrl.searchParams.get("days");

      if (!stationId || !productId || !municipalityId) {
        sendJson(response, 400, {
          error: "Faltan stationId, municipalityId o productId para consultar el histórico."
        });
        return;
      }

      const payload = await getStationHistory(stationId, municipalityId, productId, days);
      sendJson(response, 200, payload);
    } catch (error) {
      sendJson(response, 502, {
        error: "No se ha podido cargar el histórico en este momento.",
        detail: error.message
      });
    }
    return;
  }

  if (requestUrl.pathname === "/" || requestUrl.pathname === "/historial") {
    await serveStaticFile("index.html", response);
    return;
  }

  await serveStaticFile(requestUrl.pathname, response);
});

server.listen(PORT, HOST, () => {
  console.log(`Servidor disponible en http://${HOST}:${PORT}`);
});


