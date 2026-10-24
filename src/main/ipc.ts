import { type BrowserWindow, ipcMain } from "electron";
import { spawn } from "node:child_process";
import { loadConfig, saveConfig } from "../core/config.js";
import { loadEpgIndex, type EpgIndex, findChannelId, getTodayProgrammes } from "../core/epg.js";
import { getLogoDataUrl } from "../core/logos.js";
import { IPTVPlayer } from "../core/player.js";
import { fetchLivePlaylist, fetchVodEntries, checkServer } from "../core/playlist.js";
import { probeChannelQuality, testChannel } from "../core/probe.js";
import { childEnv, runCommand } from "../core/process.js";
import type { AppConfig } from "../core/types.js";
import { CHANNELS, type EpgResult, type PlaybackRequest, type PlayerEvent } from "../shared/api.js";

/** Máximo de descargas de logo simultáneas (la lista puede tener cientos de tiles). */
const LOGO_CONCURRENCY = 6;

function limiter(max: number) {
  let active = 0;
  const waiting: Array<() => void> = [];
  return async <T>(task: () => Promise<T>): Promise<T> => {
    if (active >= max) await new Promise<void>((resolve) => waiting.push(resolve));
    active += 1;
    try {
      return await task();
    } finally {
      active -= 1;
      waiting.shift()?.();
    }
  };
}

/** Sustituye los `stop` de la versión Python: un único reproductor activo a la vez. */
export interface PlaybackHandle {
  /** Para la reproducción en curso (si la hay) y espera a que termine. */
  shutdown(): Promise<void>;
  isActive(): boolean;
}

export function registerIpc(getWindow: () => BrowserWindow | null): PlaybackHandle {
  const emit = (event: PlayerEvent) => {
    getWindow()?.webContents.send("player:event", event);
  };
  const log = (message: string) => emit({ type: "log", message });

  let current: IPTVPlayer | null = null;
  let epgPromise: Promise<EpgIndex> | null = null;
  const withLogoLimit = limiter(LOGO_CONCURRENCY);

  const getEpg = (): Promise<EpgIndex> => {
    epgPromise ??= loadEpgIndex();
    return epgPromise;
  };

  const runPlayback = async (request: PlaybackRequest, player: IPTVPlayer) => {
    try {
      const test = await testChannel(request.streamUrl, { tempDir: player.bufferDir, log });
      if (player.isStopped) return;
      if (!test.ok) log("El canal parece inestable, reproduciendo igualmente...");

      const quality = await probeChannelQuality(request.streamUrl, { log });
      if (player.isStopped) return;
      emit({
        type: "quality",
        channelName: request.channelName,
        quality,
        bitrateMbps: test.ok ? test.bitrateMbps : null,
      });

      player.startCapture(request.streamUrl);
      if (request.serverName && request.channelName) {
        emit({ type: "capturing", serverName: request.serverName, channelName: request.channelName });
      }
      player.startPlayback();
    } catch (error) {
      log(`Error iniciando la reproducción: ${String(error)}`);
      await player.stop();
    }
  };

  ipcMain.handle(CHANNELS.configLoad, (): AppConfig => loadConfig());
  ipcMain.handle(CHANNELS.configSave, (_event, config: AppConfig) => saveConfig(config));
  ipcMain.handle(CHANNELS.serverCheck, (_event, url: string) => checkServer(url));
  ipcMain.handle(CHANNELS.playlistLive, (_event, url: string, forceRefresh = false) =>
    fetchLivePlaylist(url, { forceRefresh, log }),
  );
  ipcMain.handle(CHANNELS.playlistVod, (_event, url: string, forceRefresh = false) =>
    fetchVodEntries(url, { forceRefresh, log }),
  );
  ipcMain.handle(CHANNELS.qualityProbe, (_event, url: string) => probeChannelQuality(url));

  ipcMain.handle(CHANNELS.logoGet, (_event, url: string) =>
    withLogoLimit(() => getLogoDataUrl(url)),
  );

  ipcMain.handle(CHANNELS.epgProgrammes, async (_event, channelName: string): Promise<EpgResult> => {
    const index = await getEpg();
    const channelId = findChannelId(index, channelName);
    return {
      notFound: channelId === null,
      programmes: getTodayProgrammes(index, channelId),
    };
  });

  ipcMain.handle(CHANNELS.playbackStart, async (_event, request: PlaybackRequest) => {
    if (current) await current.stop();

    const player = new IPTVPlayer({
      delaySeconds: request.delaySeconds,
      bufferSizeMb: request.bufferMb,
      onLog: log,
      onStatus: (status) => emit({ type: "status", status }),
      onStopped: () => {
        if (current === player) current = null;
        emit({ type: "stopped" });
      },
    });
    current = player;
    void runPlayback(request, player);
  });

  ipcMain.handle(CHANNELS.playbackStop, async () => {
    await current?.stop();
  });

  ipcMain.handle(CHANNELS.vodPlay, (_event, url: string, title: string) =>
    new Promise<void>((resolve, reject) => {
      const child = spawn("ffplay", ["-window_title", title || "VOD", url], {
        env: childEnv(),
        stdio: "ignore",
      });
      child.once("spawn", () => resolve());
      child.once("error", reject);
    }),
  );

  ipcMain.handle(CHANNELS.dependencies, async () => {
    const missing: string[] = [];
    for (const tool of ["ffmpeg", "ffplay"]) {
      const result = await runCommand("which", [tool], { timeoutMs: 3000 });
      if (result.code !== 0) missing.push(tool);
    }
    return missing;
  });

  return {
    isActive: () => current !== null,
    shutdown: async () => {
      await current?.stop();
    },
  };
}
