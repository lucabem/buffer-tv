import { buildLiveView, channelsForRows, type ChannelRow, type LiveView, MAX_VISIBLE_ROWS, searchVod } from "../core/browse.js";
import { applyFilter, PRESETS } from "../core/filters.js";
import {
  bufferedDelaySeconds,
  formatDuration,
  formatRealQuality,
  MIN_PLAYBACK_MB,
  secondsUntilReady,
} from "../core/format.js";
import { parseServerUrl } from "../core/m3u.js";
import type { AppConfig, ChannelMap, ChannelVariant, PlayerStatus, ServerConfig } from "../core/types.js";
import type { IptvApi, PlayerEvent } from "../shared/api.js";
import { epgDialog, loadingDialog, promptDialog, qualityDialog, serverDialog } from "./dialogs.js";
import { dominantColor } from "./color.js";
import { h, hueFor, icon, ICONS, monogram } from "./dom.js";

declare global {
  interface Window {
    iptv: IptvApi;
  }
}

const api = window.iptv;

const FAVORITES_FILTER = "⭐ Favoritos";
const FILTERS = [...Object.keys(PRESETS), FAVORITES_FILTER];
const VOD_MIN_CHARS = 3;
const MAX_VOD_RESULTS = 100;
const DIRECT_NAME = "URL directa";

interface Selection {
  name: string;
  url: string;
  logo: string;
}

const state = {
  config: null as AppConfig | null,
  server: null as ServerConfig | null,
  direct: false,
  tab: "live" as "live" | "vod",
  channels: null as ChannelMap | null,
  channelsLoading: false,
  filter: "Todos",
  selected: null as Selection | null,
  vod: null as ChannelMap | null,
  vodLoading: false,
  vodSelected: null as Selection | null,
  playing: false,
  quality: null as string | null,
  stats: null as PlayerStatus | null,
};

// ---------------------------------------------------------------------------
// Utilidades de DOM y notificaciones
// ---------------------------------------------------------------------------

const $ = <T extends HTMLElement = HTMLElement>(id: string): T => document.getElementById(id) as T;

interface ToastOptions {
  error?: boolean;
  duration?: number;
  action?: { label: string; run: () => void };
}

const MAX_TOASTS = 4;

/** Notificación apilable; `options` puede ser `true` para marcarla como error. */
function toast(message: string, options: ToastOptions | boolean = {}): void {
  const opts: ToastOptions = typeof options === "boolean" ? { error: options } : options;
  const stack = $("toasts");
  const action = opts.action;

  const item: HTMLElement = h("div", { class: `toast-item${opts.error ? " is-error" : ""}`, role: "status" },
    h("span", { class: "toast-text", text: message }),
    action
      ? h("button", {
          class: "toast-action",
          onclick: () => {
            action.run();
            dismiss();
          },
          text: action.label,
        })
      : null,
  );

  const dismiss = (): void => {
    item.classList.remove("is-visible");
    setTimeout(() => item.remove(), 260);
  };

  stack.append(item);
  while (stack.children.length > MAX_TOASTS) stack.firstElementChild?.remove();
  requestAnimationFrame(() => item.classList.add("is-visible"));
  setTimeout(dismiss, opts.duration ?? 3200);
}

type LogLevel = "info" | "ok" | "error";
interface LogEntry {
  time: string;
  message: string;
  level: LogLevel;
}

const LOG_LIMIT = 300;
const logEntries: LogEntry[] = [];
let logOpen = false;
let unreadErrors = 0;

function classifyLog(message: string): LogLevel {
  if (/error|no se pudo|no se encontr|timeout|no respondió|no generó|inestable|muy pocos/i.test(message)) return "error";
  if (/cargad|estable|detectad|listo|reproduciendo|video cerrado|detenido/i.test(message)) return "ok";
  return "info";
}

function logLine(message: string): void {
  const level = classifyLog(message);
  logEntries.push({ time: new Date().toTimeString().slice(0, 8), message, level });
  if (logEntries.length > LOG_LIMIT) logEntries.splice(0, logEntries.length - LOG_LIMIT);
  if (level === "error" && !logOpen) unreadErrors += 1;
  renderLog();
}

function renderLog(): void {
  $("log-empty").hidden = logEntries.length > 0;
  $("log-list").replaceChildren(...logEntries
    .slice()
    .reverse()
    .map((entry) => h("li", { class: `log-item is-${entry.level}` },
      h("time", { text: entry.time }),
      h("span", { class: "log-msg", text: entry.message }),
    )));
  $("log-toggle").classList.toggle("has-unread", unreadErrors > 0);
}

function toggleLog(open: boolean): void {
  logOpen = open;
  $("log-panel").classList.toggle("is-open", open);
  if (open) unreadErrors = 0;
  $("log-toggle").classList.toggle("has-unread", unreadErrors > 0);
}

async function copyLog(): Promise<void> {
  const text = logEntries.map((entry) => `${entry.time}  ${entry.message}`).join("\n");
  try {
    await navigator.clipboard.writeText(text);
    toast("Registro copiado");
  } catch {
    toast("No se pudo copiar el registro", true);
  }
}

function errorText(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  return raw.replace(/^Error invoking remote method '[^']+': (Error: )?/, "");
}

async function persist(): Promise<void> {
  if (state.config) await api.saveConfig(state.config);
}

// Cacheo de logos: una sola petición por URL aunque el mismo logo aparezca varias veces.
const logoCache = new Map<string, Promise<string | null>>();
function loadLogo(url: string): Promise<string | null> {
  let pending = logoCache.get(url);
  if (!pending) {
    pending = api.logo(url).catch(() => null);
    logoCache.set(url, pending);
  }
  return pending;
}

function artFor(name: string, logoUrl: string): HTMLElement {
  const hue = hueFor(name);
  const art = h("div", { class: "tile-art" },
    h("span", { class: "tile-monogram", text: monogram(name), style: `color:hsl(${hue} 60% 78%)` }),
  );
  if (logoUrl) {
    const img = h("img", { alt: "", draggable: "false" });
    img.addEventListener("load", () => {
      img.classList.add("is-loaded");
      art.classList.add("has-logo");
    });
    art.append(img);
    void loadLogo(logoUrl).then((dataUrl) => {
      if (dataUrl) img.src = dataUrl;
    });
  }
  return art;
}

// ---------------------------------------------------------------------------
// Servidores y estado global
// ---------------------------------------------------------------------------

function lastPlayedFor(serverName: string | null): string | null {
  if (!serverName || !state.config) return null;
  return state.config.last_played[serverName] ?? null;
}

function favoritesFor(serverName: string | null): string[] {
  if (!serverName || !state.config) return [];
  return state.config.favorites[serverName] ?? [];
}

function selectServer(server: ServerConfig): void {
  state.server = server;
  rememberServer(server.name);
  state.direct = false;
  state.channels = null;
  state.selected = null;
  state.quality = null;
  state.vod = null;
  state.vodSelected = null;
  $<HTMLInputElement>("delay").value = String(server.delay_seconds ?? 300);
  $<HTMLInputElement>("buffer").value = String(server.buffer_mb ?? 500);
  $<HTMLInputElement>("vod-search").value = "";
  renderAll();
}

/** Guarda el servidor abierto para restaurarlo al arrancar la app. */
function rememberServer(name: string | null): void {
  if (!state.config || state.config.last_server === name) return;
  state.config.last_server = name;
  void persist().catch((error: unknown) => toast(`No se pudo guardar: ${errorText(error)}`, true));
}

function setDirectUrl(url: string): void {
  state.server = null;
  state.direct = true;
  state.channels = null;
  state.vod = null;
  state.vodSelected = null;
  state.quality = null;
  state.selected = { name: DIRECT_NAME, url, logo: "" };
  renderAll();
}

function renderServers(): void {
  const list = $("server-list");
  const servers = state.config?.servers ?? [];
  if (servers.length === 0) {
    list.replaceChildren(
      h("div", { class: "server-welcome" },
        h("span", { class: "brand-mark brand-mark-lg", "aria-hidden": "true" }),
        h("p", { class: "server-welcome-text", text: "Añade tu primer servidor IPTV para empezar." }),
        h("button", { class: "btn btn-primary", onclick: addServer, text: "Añadir servidor" }),
      ),
    );
    return;
  }
  list.replaceChildren(...servers.map((server) => {
    const active = state.server === server;
    return h("button", {
      class: `server-item${active ? " is-active" : ""}`,
      onclick: () => selectServer(server),
      title: server.name,
    },
      h("span", { class: "server-name", text: server.name }),
      h("span", { class: "server-host", text: parseServerUrl(server.url).host.replace(/^https?:\/\//, "") }),
    );
  }));
}

function renderHero(): void {
  const eyebrow = $("hero-eyebrow");
  const title = $("hero-title");
  const sub = $("hero-sub");
  const actions = $("server-actions");

  if (state.server) {
    eyebrow.textContent = "Servidor";
    title.textContent = state.server.name;
    const last = lastPlayedFor(state.server.name);
    const parts: string[] = [];
    if (state.channels) parts.push(`${Object.keys(state.channels).length} canales`);
    if (state.vod) parts.push(`${Object.keys(state.vod).length} títulos`);
    if (last) parts.push(`Último: ${last}`);
    sub.textContent = parts.join("  ·  ");
  } else if (state.direct) {
    eyebrow.textContent = "Reproducción directa";
    title.textContent = DIRECT_NAME;
    sub.textContent = "Sin servidor guardado";
  } else {
    eyebrow.textContent = "Sin servidor seleccionado";
    title.textContent = "Elige un servidor";
    sub.textContent = "Añade un servidor IPTV o usa una URL directa";
  }
  actions.classList.toggle("hidden", !state.server);
}

function renderTabs(): void {
  const live = state.tab === "live";
  $("tab-live").classList.toggle("is-active", live);
  $("tab-live").setAttribute("aria-selected", String(live));
  $("tab-vod").classList.toggle("is-active", !live);
  $("tab-vod").setAttribute("aria-selected", String(!live));
  $("panel-live").classList.toggle("hidden", !live);
  $("panel-vod").classList.toggle("hidden", live);
  moveSegmentThumb(live ? $("tab-live") : $("tab-vod"));
}

/** Desliza la pastilla del control segmentado hasta la pestaña activa. */
function moveSegmentThumb(active: HTMLElement): void {
  const thumb = $("seg-thumb");
  thumb.style.width = `${active.offsetWidth}px`;
  thumb.style.transform = `translateX(${active.offsetLeft}px)`;
}

function renderButtons(): void {
  const hasServer = state.server !== null;
  const loadLive = $<HTMLButtonElement>("load-live");
  loadLive.disabled = !hasServer || state.channelsLoading;
  loadLive.textContent = state.channelsLoading ? "Cargando…" : state.channels ? "Recargar" : "Cargar canales";

  const loadVod = $<HTMLButtonElement>("load-vod");
  loadVod.disabled = !hasServer || state.vodLoading;
  loadVod.textContent = state.vodLoading ? "Cargando…" : state.vod ? "Recargar" : "Cargar catálogo";

  $<HTMLButtonElement>("vod-play").disabled = state.vodSelected === null;
  $<HTMLButtonElement>("epg").disabled = state.selected === null;
}

function renderChips(): void {
  const chips = $("chips");
  chips.replaceChildren(...FILTERS.map((filter) =>
    h("button", {
      class: `chip${state.filter === filter ? " is-active" : ""}`,
      "aria-pressed": String(state.filter === filter),
      onclick: () => {
        state.filter = filter;
        renderChips();
        renderGrid();
      },
      text: filter,
    }),
  ));
}

// ---------------------------------------------------------------------------
// Canales en directo
// ---------------------------------------------------------------------------

function visibleChannels(): ChannelMap {
  const channels = state.channels ?? {};
  let filtered: ChannelMap;
  if (state.filter === FAVORITES_FILTER) {
    filtered = channelsForRows(channels, favoritesFor(state.server?.name ?? null));
  } else {
    filtered = applyFilter(channels, PRESETS[state.filter] ?? null);
  }

  const query = $<HTMLInputElement>("search").value.trim().toUpperCase();
  if (!query) return filtered;
  return Object.fromEntries(Object.entries(filtered).filter(([name]) => name.toUpperCase().includes(query)));
}

function renderGrid(): void {
  const grid = $("grid");

  if (!state.server && !state.direct) {
    grid.replaceChildren(emptyState("Sin servidor", "Selecciona un servidor en la barra lateral o añade uno nuevo."));
    return;
  }
  if (state.direct) {
    grid.replaceChildren(emptyState("Reproducción directa", "Esta URL no tiene lista de canales. Usa Reproducir."));
    return;
  }
  if (!state.channels) {
    if (state.channelsLoading) {
      grid.replaceChildren(...Array.from({ length: 12 }, skeletonTile));
      return;
    }
    grid.replaceChildren(emptyState("Sin canales cargados", "Lee la lista de canales del servidor para empezar.", {
      label: "Cargar canales",
      onClick: () => void loadLive(false),
    }));
    return;
  }

  const channels = state.channels;
  const filtered = visibleChannels();
  if (Object.keys(filtered).length === 0) {
    grid.replaceChildren(emptyState("Sin resultados", "Prueba otro filtro o una búsqueda distinta."));
    return;
  }

  const children: Node[] = [];
  const query = $<HTMLInputElement>("search").value.trim();
  const pinnedRows = buildLiveView(channelsForRows(channels, favoritesFor(state.server?.name ?? null)), false)
    .sections.flatMap((section) => section.rows);
  if (state.filter === "Todos" && !query && pinnedRows.length > 0) {
    children.push(sectionHead("Favoritos", pinnedRows.length));
    children.push(...pinnedRows.map(rowTile));
  }

  const view = buildLiveView(filtered, state.filter === "Todos");
  children.push(...tilesOf(view));

  if (view.shownRows < view.totalRows) {
    children.push(h("p", { class: "empty", style: "padding:16px 0 0" },
      h("span", { text: `Mostrando ${Math.min(view.shownRows, MAX_VISIBLE_ROWS)} de ${view.totalRows} resultados (${view.totalChannels} canales). Refina la búsqueda.` }),
    ));
  }
  grid.replaceChildren(...children);
}

function sectionHead(title: string, count: number): HTMLElement {
  return h("div", { class: "grid-section" }, h("h2", { text: title }), h("span", { text: String(count) }));
}

function tilesOf(view: LiveView): Node[] {
  const out: Node[] = [];
  for (const section of view.sections) {
    if (section.title) out.push(sectionHead(section.title, section.channelCount));
    out.push(...section.rows.map(rowTile));
  }
  return out;
}

function rowTile(row: ChannelRow): HTMLElement {
  return row.variants.length === 1 ? singleTile(row.variants[0]) : groupTile(row.displayName, row.variants);
}

function skeletonTile(): HTMLElement {
  return h("div", { class: "tile is-skeleton", "aria-hidden": "true" },
    h("div", { class: "skeleton-art" }),
    h("span", { class: "skeleton-line" }),
    h("span", { class: "skeleton-line short" }),
  );
}

function emptyState(title: string, message: string, action?: { label: string; onClick: () => void }): HTMLElement {
  return h("div", { class: "empty" },
    h("strong", { text: title }),
    h("span", { text: message }),
    action ? h("button", { class: "btn btn-primary empty-action", onclick: action.onClick, text: action.label }) : null,
  );
}

/** Estrella de favorito para una fila (canal suelto o grupo de calidades), o null sin servidor. */
function favoriteButton(name: string): HTMLElement | null {
  if (!state.server) return null;
  const fav = favoritesFor(state.server.name).includes(name);
  return h("button", {
    class: `tile-star${fav ? " is-fav" : ""}`,
    title: fav ? "Quitar de favoritos" : "Añadir a favoritos",
    "aria-label": fav ? "Quitar de favoritos" : "Añadir a favoritos",
    onclick: (event: Event) => {
      event.stopPropagation();
      void toggleFavorite(name);
    },
  }, icon(ICONS.star));
}

function singleTile(variant: ChannelVariant): HTMLElement {
  const name = variant.label;
  const selected = state.selected?.url === variant.url;
  const last = !selected && lastPlayedFor(state.server?.name ?? null) === name;
  const playNow = () => {
    selectChannel(name, variant.url, variant.logo);
    void startPlayback();
  };

  return h("div", { class: `tile${selected ? " is-selected" : ""}` },
    h("button", {
      class: "tile-main",
      title: name,
      onclick: () => selectChannel(name, variant.url, variant.logo),
      ondblclick: playNow,
    }, artFor(name, variant.logo), h("span", { class: "tile-name", text: name })),
    h("button", {
      class: "tile-play",
      title: "Reproducir",
      "aria-label": `Reproducir ${name}`,
      onclick: (event: Event) => {
        event.stopPropagation();
        playNow();
      },
    }, icon(ICONS.play)),
    favoriteButton(name),
    last ? h("span", { class: "tile-badge", text: "Último" }) : null,
  );
}

function groupTile(displayName: string, variants: ChannelVariant[]): HTMLElement {
  const selected = variants.some((variant) => variant.url === state.selected?.url);
  return h("div", { class: `tile${selected ? " is-selected" : ""}` },
    h("button", {
      class: "tile-main",
      title: displayName,
      onclick: () => openQualityPicker(displayName, variants),
    },
      artFor(displayName, variants[0].logo),
      h("span", { class: "tile-name", text: displayName }),
      h("span", { class: "tile-sub", text: `${variants.length} calidades` }),
    ),
    favoriteButton(displayName),
  );
}

function selectChannel(name: string, url: string, logo: string): void {
  if (state.selected?.url !== url) state.quality = null;
  state.selected = { name, url, logo };
  renderGrid();
  renderDock();
  renderButtons();
}

function openQualityPicker(baseName: string, variants: ChannelVariant[]): void {
  qualityDialog(baseName, variants, (url) => api.probeQuality(url), (variant) => {
    selectChannel(variant.label, variant.url, variant.logo);
    void startPlayback();
  });
}

async function toggleFavorite(name: string): Promise<void> {
  const serverName = state.server?.name;
  if (!serverName || !state.config) return;
  const favorites = (state.config.favorites[serverName] ??= []);
  const index = favorites.indexOf(name);
  if (index >= 0) favorites.splice(index, 1);
  else favorites.push(name);
  renderGrid();
  try {
    await persist();
  } catch (error) {
    toast(`No se pudo guardar: ${errorText(error)}`, true);
  }
}

async function loadLive(forceRefresh: boolean): Promise<void> {
  const server = state.server;
  if (!server || state.channelsLoading) return;

  state.channelsLoading = true;
  renderButtons();
  renderGrid();
  showLoadingBanner(true);
  logLine(`Cargando canales de ${server.name}…`);
  try {
    const channels = await api.loadLive(server.url, forceRefresh);
    if (state.server !== server) return;
    state.channels = channels;
    const count = Object.keys(channels).length;
    logLine(`${count} canales cargados`);
    toast(`${count} canales cargados`);
  } catch (error) {
    logLine(`Error cargando canales: ${errorText(error)}`);
    toast("No se pudieron cargar los canales", true);
  } finally {
    state.channelsLoading = false;
    showLoadingBanner(false);
    renderAll();
  }
}

function showLoadingBanner(visible: boolean): void {
  const banner = $("loading-banner");
  banner.replaceChildren(visible ? h("span", { class: "spinner" }) : "", visible ? h("span", { text: "Cargando canales…" }) : "");
  banner.classList.toggle("hidden", !visible);
}

// ---------------------------------------------------------------------------
// Películas y series (VOD): sin buffer, reproducción directa
// ---------------------------------------------------------------------------

async function loadVod(forceRefresh: boolean): Promise<void> {
  const server = state.server;
  if (!server || state.vodLoading) return;

  state.vodLoading = true;
  renderButtons();
  logLine("Obteniendo catálogo de películas y series…");
  try {
    const entries = await api.loadVod(server.url, forceRefresh);
    if (state.server !== server) return;
    state.vod = entries;
    logLine(`${Object.keys(entries).length} títulos de películas y series cargados`);
  } catch (error) {
    logLine(`Error cargando catálogo: ${errorText(error)}`);
    toast("No se pudo cargar el catálogo", true);
  } finally {
    state.vodLoading = false;
    renderAll();
  }
}

/** Número de columnas de la rejilla: tiles que comparten la fila superior. */
function columnCount(tiles: HTMLElement[]): number {
  const tops = tiles.map((tile) => tile.closest(".tile")?.getBoundingClientRect().top ?? 0);
  if (tops.length === 0) return 1;
  return Math.max(1, tops.filter((top) => Math.abs(top - tops[0]) < 2).length);
}

function renderVodBar(): void {
  $("vod-selected").textContent = state.vodSelected
    ? `Título: ${state.vodSelected.name}`
    : "Ningún título seleccionado";
}

function renderVod(): void {
  const list = $("vod-list");
  const query = $<HTMLInputElement>("vod-search").value.trim();

  if (!state.server) {
    list.replaceChildren(h("p", { class: "vod-note", text: "Selecciona un servidor para ver su catálogo." }));
    return;
  }
  if (!state.vod && state.vodLoading) {
    list.replaceChildren(...Array.from({ length: 6 }, () =>
      h("div", { class: "vod-row is-skeleton" }, h("span", { class: "skeleton-line" })),
    ));
    return;
  }
  if (!state.vod) {
    list.replaceChildren(h("p", { class: "vod-note", text: "Carga el catálogo del servidor para buscar películas y series." }));
    return;
  }
  if (query.length < VOD_MIN_CHARS) {
    list.replaceChildren(h("p", { class: "vod-note", text: `Escribe al menos ${VOD_MIN_CHARS} letras para buscar.` }));
    return;
  }

  const { shown, total } = searchVod(state.vod, query, MAX_VOD_RESULTS);
  if (total === 0) {
    list.replaceChildren(h("p", { class: "vod-note", text: "Sin resultados." }));
    return;
  }

  const rows: Node[] = shown.map((name) => {
    const entry = state.vod?.[name];
    const selected = state.vodSelected?.url === entry?.url;
    return h("button", {
      class: `vod-row${selected ? " is-selected" : ""}`,
      onclick: () => {
        state.vodSelected = { name, url: entry?.url ?? "", logo: "" };
        renderVod();
        renderVodBar();
        renderButtons();
      },
    },
      h("span", { text: name }),
      h("small", { class: "muted", style: "font-size:11px;flex:none", text: entry?.group ?? "" }),
    );
  });
  if (total > shown.length) {
    rows.push(h("p", { class: "vod-note", text: `Mostrando ${shown.length} de ${total} resultados. Refina la búsqueda.` }));
  }
  list.replaceChildren(...rows);
}

async function playVodSelected(): Promise<void> {
  const selected = state.vodSelected;
  if (!selected) return;
  logLine(`Reproduciendo sin buffer: ${selected.name}`);
  try {
    await api.playVod(selected.url, selected.name);
  } catch (error) {
    toast(`No se pudo lanzar ffplay: ${errorText(error)}`, true);
  }
}

// ---------------------------------------------------------------------------
// Reproducción
// ---------------------------------------------------------------------------

function renderDock(): void {
  const selected = state.selected;
  const playing = state.playing;

  updateGlow();
  $("now-title").textContent = selected?.name ?? "Ningún canal seleccionado";
  $("now-meta").textContent = playing
    ? state.quality ?? "Preparando reproducción…"
    : selected
      ? state.quality ?? "Listo para reproducir"
      : "Elige un canal para reproducirlo";

  const art = $("now-art");
  art.replaceChildren(selected ? artFor(selected.name, selected.logo) : h("span", { class: "tile-monogram", text: "·" }));

  $<HTMLButtonElement>("play").disabled = !selected || playing;
  $<HTMLButtonElement>("stop").disabled = !playing;
  $<HTMLButtonElement>("epg").disabled = !selected;

  const stats = state.stats;
  const track = $("dock-progress");
  const fill = $("dock-fill");
  const statsEl = $("dock-stats");
  if (stats && playing) {
    const ratio = stats.max_mb > 0 ? Math.min(stats.buffer_mb / stats.max_mb, 1) : 0;
    const minRatio = stats.max_mb > 0 ? Math.min(MIN_PLAYBACK_MB / stats.max_mb, 1) : 0;
    fill.style.width = `${(ratio * 100).toFixed(1)}%`;
    track.style.setProperty("--min-mark", `${(minRatio * 100).toFixed(1)}%`);

    const wait = secondsUntilReady(stats.buffer_mb, stats.rate_mb_s);
    const delay = bufferedDelaySeconds(stats.buffer_mb, stats.rate_mb_s);
    const timing = wait === null
      ? "Calculando…"
      : wait > 0
        ? `Abrirá el video en ~${formatDuration(wait)}`
        : `Retraso acumulado ${formatDuration(delay ?? 0)}`;

    statsEl.replaceChildren(
      h("span", { class: "stat-strong", text: timing }),
      h("span", { text: `Buffer ${stats.buffer_mb.toFixed(1)} / ${stats.max_mb} MB` }),
      h("span", { text: `${stats.rate_mb_s.toFixed(2)} MB/s` }),
      h("span", {}, h("i", { class: `dot${stats.healthy ? " is-healthy" : ""}` }), stats.healthy ? "Estable" : "Reconectando"),
      ...(stats.reconnects > 0 ? [h("span", { text: `Reconexiones ${stats.reconnects}` })] : []),
    );
  } else {
    fill.style.width = "0%";
    statsEl.replaceChildren();
  }
}

async function startPlayback(): Promise<void> {
  const selected = state.selected;
  if (!selected) return;
  if (state.playing) {
    toast("Ya hay una reproducción en curso. Deténla antes de cambiar de canal.", true);
    return;
  }

  const delaySeconds = Number.parseInt($<HTMLInputElement>("delay").value.trim(), 10);
  const bufferMb = Number.parseInt($<HTMLInputElement>("buffer").value.trim(), 10);
  if (Number.isNaN(delaySeconds) || Number.isNaN(bufferMb) || delaySeconds < 0 || bufferMb <= 0) {
    toast("Retraso y buffer deben ser números válidos", true);
    return;
  }

  state.playing = true;
  state.quality = null;
  state.stats = null;
  renderDock();
  renderButtons();
  logLine("Probando canal antes de iniciar el buffer…");

  try {
    await api.startPlayback({
      streamUrl: selected.url,
      channelName: selected.name,
      serverName: state.server?.name ?? null,
      delaySeconds,
      bufferMb,
    });
  } catch (error) {
    state.playing = false;
    renderDock();
    renderButtons();
    toast(`No se pudo iniciar: ${errorText(error)}`, true);
  }
}

async function stopPlayback(): Promise<void> {
  await api.stopPlayback();
}

async function markLastPlayed(serverName: string, channelName: string): Promise<void> {
  if (!state.config) return;
  state.config.last_played[serverName] = channelName;
  try {
    await persist();
  } catch (error) {
    toast(`No se pudo guardar el último canal: ${errorText(error)}`, true);
  }
  if (state.server?.name === serverName) {
    renderHero();
    renderGrid();
  }
}

function handlePlayerEvent(event: PlayerEvent): void {
  switch (event.type) {
    case "log":
      logLine(event.message);
      break;
    case "status":
      state.stats = event.status;
      renderDock();
      break;
    case "quality": {
      const label = formatRealQuality(event.quality, event.bitrateMbps);
      if (!label) break;
      if (state.selected?.name === event.channelName) {
        state.quality = label;
        renderDock();
      }
      logLine(`Calidad real detectada — ${event.channelName}: ${label}`);
      break;
    }
    case "capturing":
      if (event.serverName) void markLastPlayed(event.serverName, event.channelName);
      break;
    case "stopped":
      state.playing = false;
      state.stats = null;
      state.quality = null;
      renderDock();
      renderButtons();
      break;
  }
}

// ---------------------------------------------------------------------------
// Acciones de servidor
// ---------------------------------------------------------------------------

function addServer(): void {
  if (!state.config) return;
  const config = state.config;
  serverDialog(
    { title: "Añadir servidor", defaults: config.defaults, check: (url) => api.checkServer(url) },
    async (server) => {
      config.servers.push(server);
      selectServer(server);
      try {
        await persist();
      } catch (error) {
        toast(`No se pudo guardar: ${errorText(error)}`, true);
      }
    },
  );
}

function editServer(): void {
  const server = state.server;
  if (!server || !state.config) return;
  const config = state.config;
  serverDialog(
    { title: "Editar servidor", server, defaults: config.defaults, check: (url) => api.checkServer(url) },
    async (updated) => {
      const previousName = server.name;
      Object.assign(server, updated);
      // Favoritos y último canal se guardan por nombre: si se renombra, se migran.
      if (previousName !== server.name) {
        if (config.favorites[previousName]) {
          config.favorites[server.name] = config.favorites[previousName];
          delete config.favorites[previousName];
        }
        if (config.last_played[previousName]) {
          config.last_played[server.name] = config.last_played[previousName];
          delete config.last_played[previousName];
        }
      }
      renderAll();
      try {
        await persist();
      } catch (error) {
        toast(`No se pudo guardar: ${errorText(error)}`, true);
      }
    },
  );
}

/** Tiñe el dock con el color dominante del logo del canal seleccionado. */
let glowToken = 0;
function updateGlow(): void {
  const logo = state.selected?.logo;
  const token = ++glowToken;
  const root = document.documentElement;
  if (!logo) {
    root.style.removeProperty("--glow");
    return;
  }
  void loadLogo(logo)
    .then((dataUrl) => (dataUrl ? dominantColor(dataUrl) : null))
    .then((color) => {
      if (token !== glowToken) return;
      if (color) root.style.setProperty("--glow", color);
      else root.style.removeProperty("--glow");
    });
}

/** Borra el servidor al momento y ofrece "Deshacer" durante unos segundos. */
function deleteServer(): void {
  const server = state.server;
  const config = state.config;
  if (!server || !config) return;
  const index = config.servers.indexOf(server);

  config.servers.splice(index, 1);
  state.server = null;
  state.channels = null;
  state.vod = null;
  state.selected = null;
  state.vodSelected = null;
  renderAll();
  void persist().catch((error: unknown) => toast(`No se pudo guardar: ${errorText(error)}`, true));

  toast(`Servidor «${server.name}» eliminado`, {
    duration: 6000,
    action: {
      label: "Deshacer",
      run: () => {
        config.servers.splice(Math.min(index, config.servers.length), 0, server);
        selectServer(server);
        void persist().catch((error: unknown) => toast(`No se pudo guardar: ${errorText(error)}`, true));
      },
    },
  });
}

function openDirectUrl(): void {
  void promptDialog("URL directa", "URL IPTV completa", "http://…").then((url) => {
    if (url) setDirectUrl(url);
  });
}

async function openEpg(): Promise<void> {
  const selected = state.selected;
  if (!selected) return;
  const close = loadingDialog("Cargando guía de programación", "Puede tardar unos segundos la primera vez.");
  try {
    const result = await api.epgProgrammes(selected.name);
    close();
    epgDialog(selected.name, result.notFound, result.programmes);
  } catch (error) {
    close();
    toast(`No se pudo cargar la programación: ${errorText(error)}`, true);
  }
}

// ---------------------------------------------------------------------------
// Render general y arranque
// ---------------------------------------------------------------------------

function renderAll(): void {
  renderServers();
  renderHero();
  renderTabs();
  renderChips();
  renderGrid();
  renderVod();
  renderVodBar();
  renderButtons();
  renderDock();
}

function bindEvents(): void {
  $("add-server").addEventListener("click", addServer);
  $("edit-server").addEventListener("click", editServer);
  $("delete-server").addEventListener("click", deleteServer);
  $("log-toggle").addEventListener("click", () => toggleLog(!logOpen));
  $("log-close").addEventListener("click", () => toggleLog(false));
  $("log-copy").addEventListener("click", () => void copyLog());
  $("direct-url").addEventListener("click", openDirectUrl);

  $("tab-live").addEventListener("click", () => {
    state.tab = "live";
    renderTabs();
  });
  $("tab-vod").addEventListener("click", () => {
    state.tab = "vod";
    renderTabs();
  });

  $("load-live").addEventListener("click", () => void loadLive(state.channels !== null));
  $("load-vod").addEventListener("click", () => void loadVod(state.vod !== null));

  let searchTimer: ReturnType<typeof setTimeout> | undefined;
  $("search").addEventListener("input", () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(renderGrid, 60);
  });
  $("vod-search").addEventListener("input", renderVod);
  $("vod-play").addEventListener("click", () => void playVodSelected());

  $("play").addEventListener("click", () => void startPlayback());
  $("stop").addEventListener("click", () => void stopPlayback());
  $("epg").addEventListener("click", () => void openEpg());

  window.addEventListener("resize", () => moveSegmentThumb(state.tab === "live" ? $("tab-live") : $("tab-vod")));

  document.addEventListener("keydown", (event) => {
    const typing = event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement;
    if (event.key === "/" && !typing && state.tab === "live") {
      event.preventDefault();
      $<HTMLInputElement>("search").focus();
    }
    const focused = document.activeElement;
    if (!typing && state.tab === "live" && focused instanceof HTMLElement && focused.classList.contains("tile-main")) {
      const tiles = [...$("grid").querySelectorAll<HTMLElement>(".tile-main")];
      const index = tiles.indexOf(focused);
      const columns = columnCount(tiles);
      const steps: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -columns, ArrowDown: columns };
      if (index >= 0 && Object.hasOwn(steps, event.key)) {
        event.preventDefault();
        const target = tiles[Math.min(tiles.length - 1, Math.max(0, index + steps[event.key]))];
        target.focus();
        target.scrollIntoView({ block: "nearest" });
      } else if (index >= 0 && event.key === " ") {
        event.preventDefault();
        focused.closest(".tile")?.querySelector<HTMLButtonElement>(".tile-star")?.click();
      }
    }
    if (event.key === "Enter" && event.target instanceof HTMLInputElement && event.target.closest(".stepper")) {
      event.target.blur();
    }
    if (event.key === "Escape" && logOpen) {
      toggleLog(false);
    }
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "n") {
      event.preventDefault();
      addServer();
    }
  });
}

function appendServerActions(): void {
  // Acciones de servidor bajo el título: discretas, visibles solo con servidor seleccionado.
  const hero = document.querySelector(".hero-text");
  if (!hero) return;
  hero.append(h("div", { id: "server-actions", class: "server-actions hidden no-drag" },
    h("button", { id: "edit-server", class: "btn btn-quiet", text: "Editar" }),
    h("button", { id: "delete-server", class: "btn btn-quiet btn-danger", text: "Eliminar" }),
  ));
}

async function init(): Promise<void> {
  if (new URLSearchParams(location.search).get("vibrant") === "1") {
    document.documentElement.classList.add("vibrant");
  }

  appendServerActions();
  bindEvents();
  api.onPlayerEvent(handlePlayerEvent);

  state.config = await api.loadConfig();
  renderAll();

  // Restaura el último servidor y sus canales (la lista sale de caché si es reciente).
  const remembered = state.config.servers.find((server) => server.name === state.config?.last_server);
  if (remembered) {
    selectServer(remembered);
    void loadLive(false);
  }

  const missing = await api.dependencies();
  if (missing.length > 0) {
    const banner = $("banner");
    banner.textContent = `No se encontró ${missing.join(" ni ")}. Instálalo con: brew install ffmpeg`;
    banner.classList.remove("hidden");
  }
}

init().catch((error: unknown) => toast(`Error al iniciar: ${errorText(error)}`, true));
