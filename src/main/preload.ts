import { contextBridge, ipcRenderer } from "electron";
import { CHANNELS, type IptvApi, type PlayerEvent, type PlaybackRequest } from "../shared/api.js";
import type { AppConfig, ChannelMap, StreamQuality } from "../core/types.js";

/** Único puente entre la UI y el proceso principal. Sin acceso directo a Node. */
const api: IptvApi = {
  loadConfig: () => ipcRenderer.invoke(CHANNELS.configLoad),
  saveConfig: (config: AppConfig) => ipcRenderer.invoke(CHANNELS.configSave, config),
  checkServer: (url: string) => ipcRenderer.invoke(CHANNELS.serverCheck, url),
  loadLive: (url: string, forceRefresh = false): Promise<ChannelMap> =>
    ipcRenderer.invoke(CHANNELS.playlistLive, url, forceRefresh),
  loadVod: (url: string, forceRefresh = false): Promise<ChannelMap> =>
    ipcRenderer.invoke(CHANNELS.playlistVod, url, forceRefresh),
  probeQuality: (url: string): Promise<StreamQuality> => ipcRenderer.invoke(CHANNELS.qualityProbe, url),
  logo: (url: string): Promise<string | null> => ipcRenderer.invoke(CHANNELS.logoGet, url),
  epgProgrammes: (channelName: string) => ipcRenderer.invoke(CHANNELS.epgProgrammes, channelName),
  startPlayback: (request: PlaybackRequest) => ipcRenderer.invoke(CHANNELS.playbackStart, request),
  stopPlayback: () => ipcRenderer.invoke(CHANNELS.playbackStop),
  playVod: (url: string, title: string) => ipcRenderer.invoke(CHANNELS.vodPlay, url, title),
  dependencies: () => ipcRenderer.invoke(CHANNELS.dependencies),
  onPlayerEvent: (listener: (event: PlayerEvent) => void) => {
    const handler = (_event: unknown, payload: PlayerEvent) => listener(payload);
    ipcRenderer.on(CHANNELS.playerEvent, handler);
    return () => ipcRenderer.removeListener(CHANNELS.playerEvent, handler);
  },
};

contextBridge.exposeInMainWorld("iptv", api);
