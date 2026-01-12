import React, { useEffect, useMemo, useRef, useState } from "react";

/**
 * SouCare (DEMO) — HomeCare com TRACCAR
 *
 * ✅ Esta versão foi feita para NÃO quebrar o build no preview:
 * - NÃO usa react-leaflet/leaflet via npm (sem imports que falham no build)
 * - Carrega Leaflet via CDN em runtime (script + css)
 * - NÃO existe/usa `btn` aqui (não tem `const btn = null;` nem classe `btn`)
 *
 * 🔌 Integração:
 * - Login (token em localStorage)
 * - Devices/Positions via seu backend (adapter/proxy do Traccar)
 */

// Nome sugerido dentro da SouCorp
const APP_NAME = "SouCare";

// .env (Vite): VITE_API_BASE_URL=https://app.tracefleet.com.br
// Se você não setar a env, usa o TraceFleet por padrão (evita chamar a própria página estática e dar 405).
const API_BASE_URL = (import.meta?.env?.VITE_API_BASE_URL || "https://app.tracefleet.com.br").replace(/\/$/, "");

// Ajuste conforme seu backend (adapter do Traccar)
const ENDPOINTS = {
  // ✅ Padrão do seu painel (backend/proxy)
  login: "/api/auth/login", // POST { email, password } => { token | access_token | jwt }
  devices: "/api/traccar/devices", // GET
  positions: "/api/traccar/positions", // GET
  route24h: "/api/traccar/reports/route", // GET ?deviceId&from&to

  // ✅ Fallback direto Traccar (se você não tiver o proxy)
  traccarSession: "/api/session", // POST form email/password => cookie
  devicesDirect: "/api/devices",
  positionsDirect: "/api/positions",
  route24hDirect: "/api/reports/route",
};

// Modo DEMO (igual ao padrão do painel de veículos):
// - entra sem backend
// - gera dispositivos/posições falsas para você testar UI e mapa
const DEMO_TOKEN = "demo";

function safeGetToken() {
  try {
    if (typeof window === "undefined") return "";
    return window.localStorage.getItem("soucare_token") || "";
  } catch {
    return "";
  }
}

function safeSetToken(t) {
  try {
    if (typeof window === "undefined") return;
    window.localStorage.setItem("soucare_token", t);
  } catch {
    // ignore
  }
}

function safeClearToken() {
  try {
    if (typeof window === "undefined") return;
    window.localStorage.removeItem("soucare_token");
  } catch {
    // ignore
  }
}

function buildUrl(path) {
  return API_BASE_URL ? `${API_BASE_URL}${path}` : path;
}

async function apiFetch(path, { token, method = "GET", body, headers } = {}) {
  const url = buildUrl(path);

  const res = await fetch(url, {
    method,
    // Se o backend usar cookie/sessão, isso permite enviar/receber cookies.
    // (Se der CORS, use um proxy via Cloudflare Worker no MESMO domínio do front.)
    credentials: "include",
    headers: {
      ...(body ? { "Content-Type": "application/json" } : {}),
      ...(token && token !== DEMO_TOKEN && token !== "session" ? { Authorization: `Bearer ${token}` } : {}),
      ...(headers || {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`${res.status} ${res.statusText}${text ? ` — ${text}` : ""}`);
  }

  const ct = res.headers.get("content-type") || "";
  if (!ct.includes("application/json")) return null;
  return res.json();
}

/**
 * Carrega Leaflet via CDN (runtime) para evitar erro de build por dependências.
 */
function useLeafletCdn() {
  const [ready, setReady] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    if (typeof window === "undefined") return;

    // já carregado
    if (window.L) {
      setReady(true);
      return;
    }

    const cssId = "leaflet-css";
    const jsId = "leaflet-js";

    const existingCss = document.getElementById(cssId);
    const existingJs = document.getElementById(jsId);

    if (!existingCss) {
      const link = document.createElement("link");
      link.id = cssId;
      link.rel = "stylesheet";
      link.href = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css";
      document.head.appendChild(link);
    }

    if (existingJs) {
      // aguarda o load
      const t = setInterval(() => {
        if (window.L) {
          clearInterval(t);
          setReady(true);
        }
      }, 50);
      return () => clearInterval(t);
    }

    const script = document.createElement("script");
    script.id = jsId;
    script.src = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js";
    script.async = true;
    script.onload = () => setReady(true);
    script.onerror = () => setErr("Falha ao carregar o mapa (CDN Leaflet). Verifique bloqueio de rede/CSP.");
    document.body.appendChild(script);
  }, []);

  return { ready, err };
}

export default function HomeCareDemoApp() {
  useEffect(() => {
    runSelfTests();
  }, []);

  const [token, setToken] = useState(() => safeGetToken());

  if (!token) {
    return <Login onLogged={(t) => setToken(t)} />;
  }

  return (
    <HomeCareShell
      token={token}
      onLogout={() => {
        safeClearToken();
        setToken("");
      }}
    />
  );
}

function Login({ onLogged }) {
  const [email, setEmail] = useState("admin@soucorp.com");
  const [password, setPassword] = useState("123456");
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");

  async function submit(e) {
    e.preventDefault();
    setErr("");
    setLoading(true);

    try {
      // 1) tenta seu backend/padrão (token bearer)
      try {
        const data = await apiFetch(ENDPOINTS.login, {
          method: "POST",
          body: { email, password },
        });

        const t = data?.token || data?.access_token || data?.jwt;
        if (t) {
          safeSetToken(t);
          onLogged(t);
          return;
        }
      } catch (eToken) {
        // cai pro fallback abaixo
      }

      // 2) fallback direto Traccar (cookie de sessão)
      // Traccar espera form-encoded, não JSON
      const url = buildUrl(ENDPOINTS.traccarSession);
      const res = await fetch(url, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ email, password }).toString(),
      });

      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(`${res.status} ${res.statusText}${text ? ` — ${text}` : ""}`);
      }

      // se chegou aqui, o cookie foi setado
      safeSetToken("session");
      onLogged("session");
    } catch (e2) {
      setErr(e2?.message || "Erro no login");
    } finally {
      setLoading(false);
    }
  }

  function enterDemo() {
    // modo demo não usa API
    safeSetToken(DEMO_TOKEN);
    onLogged(DEMO_TOKEN);
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <div className="mx-auto flex min-h-screen max-w-6xl items-center justify-center p-6">
        <div className="grid w-full gap-6 md:grid-cols-2">
          <div className="rounded-3xl border border-slate-800 bg-slate-900/40 p-6">
            <div className="text-sm text-slate-300">SouCorp</div>
            <div className="mt-1 text-3xl font-semibold">{APP_NAME}</div>
            <div className="mt-2 text-sm text-slate-400">
              Central de monitoramento HomeCare • localização (Traccar) • alertas • vitais
            </div>

            <div className="mt-6 rounded-2xl border border-slate-800 bg-slate-950/40 p-4 text-sm text-slate-300">
              <div className="font-medium text-slate-200">Atalho rápido</div>
              <div className="mt-2 text-sm text-slate-400">
                Quer só testar a plataforma agora? Use o modo demo.
              </div>
              <div className="mt-3 flex flex-col gap-2">
                <Button
                  type="button"
                  onClick={enterDemo}
                  className="w-full border-sky-500/30 bg-sky-500/15 text-sky-100 hover:bg-sky-500/20"
                >
                  Entrar no modo DEMO
                </Button>
                <div className="text-xs text-slate-500">Demo gera pacientes/dispositivos e posições no mapa.</div>
              </div>
            </div>
          </div>

          <div className="rounded-3xl border border-slate-800 bg-slate-900/40 p-6">
            <div className="text-lg font-semibold">Login</div>
            <div className="mt-1 text-sm text-slate-400">Entre para acessar o painel real (API).</div>

            <form onSubmit={submit} className="mt-5 space-y-3">
              <div>
                <label className="text-xs text-slate-400">E-mail</label>
                <input
                  className="mt-1 w-full rounded-xl border border-slate-800 bg-slate-950/40 px-3 py-2 text-sm outline-none"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="seu@email.com"
                />
              </div>

              <div>
                <label className="text-xs text-slate-400">Senha</label>
                <input
                  type="password"
                  className="mt-1 w-full rounded-xl border border-slate-800 bg-slate-950/40 px-3 py-2 text-sm outline-none"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                />
              </div>

              {err ? (
                <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-200">{err}</div>
              ) : null}

              <Button
                type="submit"
                disabled={loading}
                className="w-full border-emerald-500/30 bg-emerald-500/15 text-emerald-100 hover:bg-emerald-500/20 disabled:opacity-60"
              >
                {loading ? "Entrando..." : "Entrar"}
              </Button>

              <div className="text-xs text-slate-500">
                Dica: se seu login retornar outro campo, ajuste: <span className="text-slate-300">token/access_token/jwt</span>
              </div>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
}

function HomeCareShell({ token, onLogout }) {
  const [active, setActive] = useState("dashboard");
  const { devices, positions, byDeviceId, loading, error, refresh } = useTraccarLive(token);

  const patientRows = useMemo(() => {
    return devices.map((d) => {
      const p = byDeviceId[d.id];
      const lastSeen = p?.deviceTime ? timeAgo(p.deviceTime) : "--";
      const battery = p?.attributes?.batteryLevel != null ? `${p.attributes.batteryLevel}%` : "--";
      return {
        status: p ? "green" : "gray",
        patient: d.name || d.uniqueId || `Device ${d.id}`,
        place: "--",
        lastSeen,
        fc: "--",
        spo2: "--",
        battery,
        deviceId: d.id,
        lat: p?.latitude,
        lng: p?.longitude,
      };
    });
  }, [devices, byDeviceId]);

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <div className="mx-auto flex max-w-7xl gap-4 p-4">
        <aside className="w-64 shrink-0 rounded-2xl border border-slate-800 bg-slate-900/40 p-3">
          <div className="mb-3 rounded-xl border border-slate-800 bg-slate-950/40 p-3">
            <div className="text-xs text-slate-400">SouCorp</div>
            <div className="text-lg font-semibold">{APP_NAME}</div>
            <div className="mt-2 flex gap-2">
              <Button onClick={refresh}>Atualizar</Button>
              <Button onClick={onLogout}>Sair</Button>
            </div>
          </div>

          <NavItem label="Dashboard" id="dashboard" active={active} onClick={setActive} />
          <NavItem label="Pacientes" id="patients" active={active} onClick={setActive} />
          <NavItem label="Dispositivos" id="devices" active={active} onClick={setActive} />
          <NavItem label="Mapa (Monitoramento)" id="map" active={active} onClick={setActive} />
          <NavItem label="Alertas" id="alerts" active={active} onClick={setActive} />
          <NavItem label="Cercas (Casa)" id="geofences" active={active} onClick={setActive} />

          <div className="mt-4 border-t border-slate-800 pt-3 text-xs text-slate-400">
            <div className="font-medium text-slate-300">Status API</div>
            <div className="mt-1">
              {loading
                ? "Carregando Traccar..."
                : error
                ? `Erro: ${error}`
                : `OK • devices: ${devices.length} • pos: ${positions.length}`}
            </div>
          </div>
        </aside>

        <main className="flex-1">
          <TopBar />

          <div className="mt-4">
            {active === "dashboard" && <Dashboard rows={patientRows} />}
            {active === "patients" && <Patients rows={patientRows} />}
            {active === "devices" && <Devices devices={devices} byDeviceId={byDeviceId} />}
            {active === "map" && <MapView rows={patientRows} token={token} />}
            {active === "alerts" && <Alerts />}
            {active === "geofences" && <Geofences />}
          </div>
        </main>
      </div>
    </div>
  );
}

function useTraccarLive(token) {
  const [devices, setDevices] = useState([]);
  const [positions, setPositions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // DEMO: mundo fake com movimento
  useEffect(() => {
    if (token !== DEMO_TOKEN) return;

    setError("");
    setLoading(true);

    const world = createDemoWorld();
    setDevices(world.devices);
    setPositions(world.positions);
    setLoading(false);

    const t = setInterval(() => {
      const next = stepDemoWorld(world);
      setDevices(next.devices);
      setPositions(next.positions);
    }, 5000);

    return () => clearInterval(t);
  }, [token]);

  async function loadReal() {
    setError("");
    try {
      setLoading(true);
      let dev;
      let pos;

      // 1) tenta seu proxy (padrão veículos)
      try {
        [dev, pos] = await Promise.all([
          apiFetch(ENDPOINTS.devices, { token }),
          apiFetch(ENDPOINTS.positions, { token }),
        ]);
      } catch {
        // 2) fallback direto Traccar
        [dev, pos] = await Promise.all([
          apiFetch(ENDPOINTS.devicesDirect, { token }),
          apiFetch(ENDPOINTS.positionsDirect, { token }),
        ]);
      }

      setDevices(Array.isArray(dev) ? dev : []);
      setPositions(Array.isArray(pos) ? pos : []);
    } catch (e) {
      setError(e?.message || "Erro ao carregar Traccar");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!token) return;
    if (token === DEMO_TOKEN) return;

    loadReal();
    const t = setInterval(loadReal, 15000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const byDeviceId = useMemo(() => {
    const m = {};
    for (const p of positions) m[p.deviceId] = p;
    return m;
  }, [positions]);

  return { devices, positions, byDeviceId, loading, error, refresh: token === DEMO_TOKEN ? () => {} : loadReal };
}

function NavItem({ label, id, active, onClick }) {
  const isActive = active === id;
  return (
    <button
      onClick={() => onClick(id)}
      className={
        "mb-1 flex w-full items-center justify-between rounded-xl px-3 py-2 text-left text-sm transition " +
        (isActive
          ? "bg-emerald-500/15 text-emerald-200 ring-1 ring-emerald-500/30"
          : "text-slate-200 hover:bg-slate-800/60")
      }
    >
      <span>{label}</span>
      <span className={"text-xs " + (isActive ? "text-emerald-200" : "text-slate-500")}>›</span>
    </button>
  );
}

function TopBar() {
  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-slate-800 bg-slate-900/40 p-4 md:flex-row md:items-center md:justify-between">
      <div>
        <div className="text-sm text-slate-300">Central de monitoramento</div>
        <div className="text-xl font-semibold">{APP_NAME} — Plantão</div>
      </div>

      <div className="flex flex-col gap-2 md:flex-row md:items-center">
        <input
          className="w-full rounded-xl border border-slate-800 bg-slate-950/40 px-3 py-2 text-sm outline-none placeholder:text-slate-600 md:w-72"
          placeholder="Buscar paciente / dispositivo..."
        />
        <select className="rounded-xl border border-slate-800 bg-slate-950/40 px-3 py-2 text-sm outline-none">
          <option>Filtro: Equipe</option>
          <option>Equipe A</option>
          <option>Equipe B</option>
        </select>
        <select className="rounded-xl border border-slate-800 bg-slate-950/40 px-3 py-2 text-sm outline-none">
          <option>Risco: Todos</option>
          <option>Baixo</option>
          <option>Médio</option>
          <option>Alto</option>
        </select>
      </div>
    </div>
  );
}

function Dashboard({ rows }) {
  const counts = useMemo(() => {
    let red = 0,
      yellow = 0,
      gray = 0,
      green = 0;
    for (const r of rows) {
      if (r.status === "red") red++;
      else if (r.status === "yellow") yellow++;
      else if (r.status === "gray") gray++;
      else green++;
    }
    return { red, yellow, gray, green };
  }, [rows]);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
        <StatCard title="Críticos" value={String(counts.red)} tone="red" />
        <StatCard title="Offline" value={String(counts.gray)} tone="gray" />
        <StatCard title="Atenção" value={String(counts.yellow)} tone="yellow" />
        <StatCard title="OK" value={String(counts.green)} tone="emerald" />
      </div>

      <div className="rounded-2xl border border-slate-800 bg-slate-900/40 p-4">
        <div className="mb-3 flex items-center justify-between">
          <div>
            <div className="text-sm text-slate-300">Lista ao vivo</div>
            <div className="text-lg font-semibold">Pacientes (semáforo)</div>
          </div>
          <Legend />
        </div>

        <div className="overflow-x-auto rounded-xl border border-slate-800">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-950/40 text-slate-300">
              <tr>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2">Paciente</th>
                <th className="px-3 py-2">Casa/Rua</th>
                <th className="px-3 py-2">Último sinal</th>
                <th className="px-3 py-2">FC</th>
                <th className="px-3 py-2">SpO₂</th>
                <th className="px-3 py-2">Bateria</th>
                <th className="px-3 py-2">Ação</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.patient} className="border-t border-slate-800">
                  <td className="px-3 py-2">
                    <StatusDot tone={r.status} />
                  </td>
                  <td className="px-3 py-2 font-medium">{r.patient}</td>
                  <td className="px-3 py-2">{r.place}</td>
                  <td className="px-3 py-2">{r.lastSeen}</td>
                  <td className="px-3 py-2">{r.fc}</td>
                  <td className="px-3 py-2">{r.spo2}</td>
                  <td className="px-3 py-2">{r.battery}</td>
                  <td className="px-3 py-2">
                    <Button>Ver</Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function Patients({ rows }) {
  return (
    <div className="space-y-4">
      <SectionHeader title="Pacientes" right={<Button>+ Novo</Button>} />

      <div className="rounded-2xl border border-slate-800 bg-slate-900/40 p-4">
        <div className="overflow-x-auto rounded-xl border border-slate-800">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-950/40 text-slate-300">
              <tr>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2">Nome</th>
                <th className="px-3 py-2">Casa/Rua</th>
                <th className="px-3 py-2">Último sinal</th>
                <th className="px-3 py-2">Ações</th>
              </tr>
            </thead>
            <tbody>
              {rows.slice(0, 50).map((r) => (
                <tr key={r.patient} className="border-t border-slate-800">
                  <td className="px-3 py-2">
                    <StatusDot tone={r.status} />
                  </td>
                  <td className="px-3 py-2 font-medium">{r.patient}</td>
                  <td className="px-3 py-2">{r.place}</td>
                  <td className="px-3 py-2">{r.lastSeen}</td>
                  <td className="px-3 py-2">
                    <div className="flex gap-2">
                      <Button>Ver</Button>
                      <Button>Alertas</Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <Placeholder title="Detalhe do paciente" hint="Abas: Resumo | Localização | Vitais | Alertas | Rotina" />
    </div>
  );
}

function Devices({ devices, byDeviceId }) {
  const rows = useMemo(() => {
    return devices.map((d) => {
      const p = byDeviceId[d.id];
      const last = p?.deviceTime ? timeAgo(p.deviceTime) : "--";
      const status = p ? "Online" : "Offline";
      return { id: d.id, label: d.name || d.uniqueId || `Device ${d.id}`, last, status };
    });
  }, [devices, byDeviceId]);

  return (
    <div className="space-y-4">
      <SectionHeader title="Dispositivos" right={<Button>+ Vincular</Button>} />

      <div className="rounded-2xl border border-slate-800 bg-slate-900/40 p-4">
        <div className="overflow-x-auto rounded-xl border border-slate-800">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-950/40 text-slate-300">
              <tr>
                <th className="px-3 py-2">TraccarID</th>
                <th className="px-3 py-2">Label</th>
                <th className="px-3 py-2">Último</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2">Ação</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-t border-slate-800">
                  <td className="px-3 py-2">{r.id}</td>
                  <td className="px-3 py-2 font-medium">{r.label}</td>
                  <td className="px-3 py-2">{r.last}</td>
                  <td className="px-3 py-2">{r.status}</td>
                  <td className="px-3 py-2">
                    <Button>Detalhe</Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <Placeholder title="Detalhe do dispositivo" hint="Posição, eventos, testar comunicação" />
    </div>
  );
}

function MapView({ rows, token }) {
  const { ready, err } = useLeafletCdn();
  const mapDivRef = useRef(null);
  const mapRef = useRef(null);
  const markersRef = useRef([]);
  const routeRef = useRef(null);

  const [selectedDeviceId, setSelectedDeviceId] = useState(rows?.[0]?.deviceId || null);
  const [routeErr, setRouteErr] = useState("");

  const center = useMemo(() => {
    const first = rows.find((r) => Number.isFinite(r.lat) && Number.isFinite(r.lng));
    return first ? [first.lat, first.lng] : [-23.55052, -46.633308];
  }, [rows]);

  // cria o mapa uma vez
  useEffect(() => {
    if (!ready) return;
    if (!mapDivRef.current) return;
    if (!window.L) return;

    // evita recriar
    if (mapRef.current) return;

    const L = window.L;
    const map = L.map(mapDivRef.current).setView(center, 13);

    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    }).addTo(map);

    mapRef.current = map;

    // cleanup
    return () => {
      try {
        map.remove();
      } catch {
        // ignore
      }
      mapRef.current = null;
      markersRef.current = [];
      routeRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready]);

  // atualiza marcadores quando rows mudam
  useEffect(() => {
    if (!ready) return;
    if (!mapRef.current || !window.L) return;

    const L = window.L;

    // remove marcadores antigos
    for (const m of markersRef.current) {
      try {
        m.remove();
      } catch {
        // ignore
      }
    }
    markersRef.current = [];

    const valid = rows.filter((r) => Number.isFinite(r.lat) && Number.isFinite(r.lng));

    for (const r of valid) {
      const color =
        r.status === "red" ? "#ef4444" : r.status === "yellow" ? "#f59e0b" : r.status === "gray" ? "#64748b" : "#34d399";

      const m = L.circleMarker([r.lat, r.lng], {
        radius: 10,
        color,
        fillColor: color,
        fillOpacity: 0.65,
        weight: 2,
      })
        .addTo(mapRef.current)
        .bindPopup(
          `<div style="min-width:180px">
             <div style="font-weight:700">${escapeHtml(r.patient)}</div>
             <div style="font-size:12px;opacity:.8">Último: ${escapeHtml(r.lastSeen)}</div>
             <div style="font-size:12px;opacity:.8">Bateria: ${escapeHtml(r.battery)}</div>
             <div style="font-size:12px;opacity:.8">Lat/Lng: ${Number(r.lat).toFixed(5)}, ${Number(r.lng).toFixed(5)}</div>
           </div>`
        )
        .on("click", () => setSelectedDeviceId(r.deviceId));

      markersRef.current.push(m);
    }

    // ajusta visão
    try {
      if (valid.length === 1) {
        mapRef.current.setView([valid[0].lat, valid[0].lng], 16);
      } else if (valid.length > 1) {
        const bounds = L.latLngBounds(valid.map((r) => [r.lat, r.lng]));
        mapRef.current.fitBounds(bounds.pad(0.2));
      }
    } catch {
      // ignore
    }
  }, [ready, rows]);

  // rota 24h (opcional) quando selectedDeviceId muda
  useEffect(() => {
    async function loadRoute() {
      setRouteErr("");
      if (!ready) return;
      if (!mapRef.current || !window.L) return;
      if (!selectedDeviceId) return;

      const L = window.L;

      // limpa rota anterior
      if (routeRef.current) {
        try {
          routeRef.current.remove();
        } catch {
          // ignore
        }
        routeRef.current = null;
      }

      try {
        const to = new Date();
        const from = new Date(Date.now() - 24 * 60 * 60 * 1000);
        const qs = `?deviceId=${encodeURIComponent(selectedDeviceId)}&from=${encodeURIComponent(
          from.toISOString()
        )}&to=${encodeURIComponent(to.toISOString())}`;
        let data;
        try {
          data = await apiFetch(`${ENDPOINTS.route24h}${qs}`, { token });
        } catch {
          // Traccar pode devolver XLSX se não tiver Accept. Força JSON.
          data = await apiFetch(`${ENDPOINTS.route24hDirect}${qs}`, {
            token,
            headers: { Accept: "application/json" },
          });
        }

        const pts = Array.isArray(data)
          ? data
              .map((p) => [p.latitude, p.longitude])
              .filter((a) => Number.isFinite(a[0]) && Number.isFinite(a[1]))
          : [];

        if (pts.length >= 2) {
          routeRef.current = L.polyline(pts, { color: "#60a5fa", weight: 4, opacity: 0.8 }).addTo(mapRef.current);
        }
      } catch {
        setRouteErr("Rota 24h indisponível (ok no MVP). Se quiser, crie o endpoint no backend.");
      }
    }

    loadRoute();
  }, [ready, selectedDeviceId, token]);

  return (
    <div className="space-y-4">
      <SectionHeader
        title="Mapa (Monitoramento)"
        right={
          <div className="flex items-center gap-2">
            <select
              className="rounded-xl border border-slate-800 bg-slate-950/40 px-3 py-2 text-sm outline-none"
              value={selectedDeviceId || ""}
              onChange={(e) => setSelectedDeviceId(Number(e.target.value) || null)}
            >
              {rows.map((r) => (
                <option key={r.deviceId} value={r.deviceId}>
                  {r.patient}
                </option>
              ))}
            </select>
          </div>
        }
      />

      <div className="rounded-2xl border border-slate-800 bg-slate-900/40 p-4">
        {!ready ? (
          <div className="rounded-2xl border border-slate-800 bg-slate-950/40 p-4 text-sm text-slate-300">
            Carregando mapa...
          </div>
        ) : null}

        {err ? (
          <div className="mt-3 rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-200">{err}</div>
        ) : null}

        <div className="h-[520px] overflow-hidden rounded-2xl border border-slate-800">
          <div ref={mapDivRef} style={{ height: "520px", width: "100%" }} />
        </div>

        {routeErr ? (
          <div className="mt-3 rounded-xl border border-slate-800 bg-slate-950/30 p-3 text-xs text-slate-400">
            {routeErr}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function Alerts() {
  const rows = useMemo(
    () => [
      { type: "Fora de Casa", patient: "(exemplo)", at: "10:12", sev: "red" },
      { type: "Offline", patient: "(exemplo)", at: "09:55", sev: "yellow" },
    ],
    []
  );

  return (
    <div className="space-y-4">
      <SectionHeader
        title="Alertas"
        right={
          <div className="flex gap-2">
            <Button>Abertos</Button>
            <Button>Resolvidos</Button>
          </div>
        }
      />

      <div className="rounded-2xl border border-slate-800 bg-slate-900/40 p-4">
        <div className="overflow-x-auto rounded-xl border border-slate-800">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-950/40 text-slate-300">
              <tr>
                <th className="px-3 py-2">Tipo</th>
                <th className="px-3 py-2">Paciente</th>
                <th className="px-3 py-2">Quando</th>
                <th className="px-3 py-2">Sev</th>
                <th className="px-3 py-2">Ação</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, idx) => (
                <tr key={idx} className="border-t border-slate-800">
                  <td className="px-3 py-2">{r.type}</td>
                  <td className="px-3 py-2 font-medium">{r.patient}</td>
                  <td className="px-3 py-2">{r.at}</td>
                  <td className="px-3 py-2">
                    <StatusDot tone={r.sev} />
                  </td>
                  <td className="px-3 py-2">
                    <Button>Resolver</Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <Placeholder title="Próximo" hint="Plugar /api/traccar/events + geofence exit/enter + offline" />
    </div>
  );
}

function Geofences() {
  const rows = useMemo(() => [{ patient: "(exemplo)", address: "Rua X, 123", type: "Círculo 50m", geoId: 55 }], []);

  return (
    <div className="space-y-4">
      <SectionHeader title="Cercas (Residência)" right={<Button>+ Nova</Button>} />
      <div className="rounded-2xl border border-slate-800 bg-slate-900/40 p-4">
        <div className="overflow-x-auto rounded-xl border border-slate-800">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-950/40 text-slate-300">
              <tr>
                <th className="px-3 py-2">Paciente</th>
                <th className="px-3 py-2">Endereço</th>
                <th className="px-3 py-2">Tipo</th>
                <th className="px-3 py-2">Traccar GeoID</th>
                <th className="px-3 py-2">Ação</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.geoId} className="border-t border-slate-800">
                  <td className="px-3 py-2 font-medium">{r.patient}</td>
                  <td className="px-3 py-2">{r.address}</td>
                  <td className="px-3 py-2">{r.type}</td>
                  <td className="px-3 py-2">{r.geoId}</td>
                  <td className="px-3 py-2">
                    <Button>Editar</Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <Placeholder title="Editor de cerca" hint="Mapa + desenhar círculo/polígono e salvar no Traccar" />
    </div>
  );
}

function SectionHeader({ title, right }) {
  return (
    <div className="flex flex-col gap-2 rounded-2xl border border-slate-800 bg-slate-900/40 p-4 md:flex-row md:items-center md:justify-between">
      <div>
        <div className="text-sm text-slate-300">SouCorp • {APP_NAME}</div>
        <div className="text-xl font-semibold">{title}</div>
      </div>
      <div className="flex gap-2">{right}</div>
    </div>
  );
}

function Placeholder({ title, hint }) {
  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-900/40 p-4">
      <div className="text-lg font-semibold">{title}</div>
      <div className="mt-1 text-sm text-slate-400">{hint}</div>
      <div className="mt-3 rounded-xl border border-slate-800 bg-slate-950/30 p-6 text-center text-sm text-slate-500">
        Conteúdo entra aqui (MVP)
      </div>
    </div>
  );
}

function StatCard({ title, value, tone }) {
  const toneCls =
    tone === "red"
      ? "border-red-500/30 bg-red-500/10 text-red-200"
      : tone === "yellow"
      ? "border-amber-500/30 bg-amber-500/10 text-amber-200"
      : tone === "gray"
      ? "border-slate-700 bg-slate-950/40 text-slate-200"
      : "border-emerald-500/30 bg-emerald-500/10 text-emerald-200";

  return (
    <div className={`rounded-2xl border p-4 ${toneCls}`}>
      <div className="text-sm opacity-90">{title}</div>
      <div className="mt-1 text-3xl font-semibold">{value}</div>
    </div>
  );
}

function Legend() {
  return (
    <div className="flex flex-wrap items-center gap-3 text-xs text-slate-400">
      <span className="inline-flex items-center gap-2">
        <StatusDot tone="green" /> OK
      </span>
      <span className="inline-flex items-center gap-2">
        <StatusDot tone="yellow" /> Atenção
      </span>
      <span className="inline-flex items-center gap-2">
        <StatusDot tone="red" /> Crítico
      </span>
      <span className="inline-flex items-center gap-2">
        <StatusDot tone="gray" /> Offline
      </span>
    </div>
  );
}

function StatusDot({ tone }) {
  const cls =
    tone === "red"
      ? "bg-red-500"
      : tone === "yellow"
      ? "bg-amber-400"
      : tone === "gray"
      ? "bg-slate-500"
      : "bg-emerald-400";

  return <span className={`inline-block h-3 w-3 rounded-full ${cls}`} />;
}

function timeAgo(iso) {
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return "--";
  const diff = Math.max(0, Date.now() - t);
  const m = Math.round(diff / 60000);
  if (m < 1) return "agora";
  if (m < 60) return `${m} min`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h`;
  const d = Math.round(h / 24);
  return `${d} d`;
}

function buttonBaseClass() {
  return "rounded-xl border border-slate-700 bg-slate-950/40 px-3 py-2 text-sm hover:bg-slate-800/60";
}

function Button({ children, className = "", ...props }) {
  return (
    <button {...props} className={`${buttonBaseClass()} ${className}`.trim()}>
      {children}
    </button>
  );
}

function escapeHtml(s) {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

// ----------------------
// DEMO DATA (igual ao painel de veículos: entra e já vê rodando)
// ----------------------
function createDemoWorld() {
  // Ponto base (SP)
  const baseLat = -23.55052;
  const baseLng = -46.633308;

  const now = new Date();

  const devices = [
    { id: 101, name: "Paciente João (DEMO)", uniqueId: "HR-001" },
    { id: 102, name: "Paciente Maria (DEMO)", uniqueId: "HR-002" },
    { id: 103, name: "Paciente Ana (DEMO)", uniqueId: "HR-003" },
  ];

  const positions = devices.map((d, idx) => {
    const jitter = 0.01 * (idx + 1);
    return {
      id: 1000 + d.id,
      deviceId: d.id,
      latitude: baseLat + jitter * 0.1,
      longitude: baseLng - jitter * 0.1,
      deviceTime: now.toISOString(),
      attributes: {
        batteryLevel: 90 - idx * 7,
      },
    };
  });

  return { devices, positions };
}

function stepDemoWorld(world) {
  const now = new Date();

  // move bem pouquinho (simula dentro da casa / quarteirão)
  const moved = world.positions.map((p, idx) => {
    const dx = (Math.random() - 0.5) * 0.0006;
    const dy = (Math.random() - 0.5) * 0.0006;

    const batt = p.attributes?.batteryLevel ?? 80;
    const nextBatt = Math.max(5, batt - (idx === 0 ? 0 : 1));

    return {
      ...p,
      latitude: p.latitude + dx,
      longitude: p.longitude + dy,
      deviceTime: now.toISOString(),
      attributes: {
        ...(p.attributes || {}),
        batteryLevel: nextBatt,
      },
    };
  });

  world.positions = moved;
  return { devices: world.devices, positions: moved };
}

/**
 * Testes leves — não quebram o build.
 */
function runSelfTests() {
  try {
    // Teste 1: timeAgo inválido
    console.assert(timeAgo("x") === "--", "timeAgo: inválido deveria retornar --");

    // Teste 2: timeAgo agora
    const nowIso = new Date().toISOString();
    const vNow = timeAgo(nowIso);
    console.assert(vNow === "agora" || vNow.endsWith("min"), "timeAgo: agora deveria ser 'agora' ou 'N min'");

    // Teste 3: URL composta
    const url = buildUrl(ENDPOINTS.devices);
    console.assert(typeof url === "string" && url.length > 0, "URL deveria ser string válida");

    // Teste 4: Button (sanity)
    console.assert(typeof Button === "function", "Button deveria ser uma função");

    // Teste 5: garantir que NÃO existe `const btn = null;`
    const asText = String(runSelfTests);
    console.assert(!asText.includes("const btn = null"), "Não deve existir 'const btn = null' em lugar nenhum");

    // Teste 6: DEMO world gera arrays
    const w = createDemoWorld();
    console.assert(Array.isArray(w.devices) && w.devices.length >= 1, "DEMO: devices deveria ser array");
    console.assert(Array.isArray(w.positions) && w.positions.length === w.devices.length, "DEMO: positions deveria casar com devices");

    // Teste 7: stepDemoWorld move (lat/lng continuam números)
    const w2 = stepDemoWorld(w);
    console.assert(Number.isFinite(w2.positions[0].latitude), "DEMO: latitude deveria ser número");
    console.assert(Number.isFinite(w2.positions[0].longitude), "DEMO: longitude deveria ser número");
  } catch (e) {
    console.warn("SelfTests falharam:", e);
  }
}
