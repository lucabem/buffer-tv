/**
 * Contrato entre el proceso principal (Node) y el renderer. Solo tipos y
 * nombres de canal: nada de Node aquí, para que lo pueda importar el renderer.
 */
import type { AppConfig, ChannelMap, ProgrammeEntry, ServerConfig, StreamQuality } from "../core/types.js";

export const CHANNELS = {
  configLoad: "config:load",
  configSave: "config:save",
  serverCheck: "server:check",
  playlistLive: "playlist:live",
  playlistVod: "playlist:vod",
  qualityProbe: "quality:probe",
  logoGet: "logo:get",
  epgProgrammes: "epg:programmes",
  playbackStart: "playback:start",
  playbackStop: "playback:stop",
  vodPlay: "vod:play",
  dependencies: "system:dependencies",
  playerEvent: "player:event",
} as const;

export interface PlaybackRequest {
  streamUrl: string;
  channelName: string;
  serverName: string | null;
  delaySeconds: number;
  bufferMb: number;
}

/** Eventos que el proceso principal empuja al renderer durante una reproducción. */
export type PlayerEvent =
  | { type: "log"; message: string }
  | { type: "status"; status: import("../core/types.js").PlayerStatus }
  | { type: "quality"; channelName: string; quality: StreamQuality; bitrateMbps: number | null }
  | { type: "capturing"; serverName: string | null; channelName: string }
  | { type: "stopped" };

export interface EpgResult {
  notFound: boolean;
  programmes: ProgrammeEntry[];
}

export type ServerCheckResult = { ok: true } | { ok: false; error: string };

/** API expuesta a la UI en `window.iptv` por el preload. */
export interface IptvApi {
  loadConfig(): Promise<AppConfig>;
  saveConfig(config: AppConfig): Promise<void>;
  checkServer(url: string): Promise<ServerCheckResult>;
  loadLive(url: string, forceRefresh?: boolean): Promise<ChannelMap>;
  loadVod(url: string, forceRefresh?: boolean): Promise<ChannelMap>;
  probeQuality(url: string): Promise<StreamQuality>;
  logo(url: string): Promise<string | null>;
  epgProgrammes(channelName: string): Promise<EpgResult>;
  startPlayback(request: PlaybackRequest): Promise<void>;
  stopPlayback(): Promise<void>;
  playVod(url: string, title: string): Promise<void>;
  dependencies(): Promise<string[]>;
  onPlayerEvent(listener: (event: PlayerEvent) => void): () => void;
}

export type { ServerConfig };
