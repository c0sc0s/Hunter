import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";

import type { ApiReadyPayload, HunterDesktopBridge } from "../../shared/desktopBridge";

const desktopBridge: HunterDesktopBridge = {
  getApiBase: async () => {
    const base = await ipcRenderer.invoke("hunter:get-api-base");
    return typeof base === "string" ? base : null;
  },
  onApiReady: (listener) => {
    const handler = (_event: IpcRendererEvent, payload: unknown) => {
      if (isApiReadyPayload(payload)) {
        listener(payload);
      }
    };
    ipcRenderer.on("hunter:api-ready", handler);
    return () => {
      ipcRenderer.removeListener("hunter:api-ready", handler);
    };
  },
  isAutostartAvailable: async () => Boolean(await ipcRenderer.invoke("hunter:is-autostart-available")),
  getAutostart: async () => Boolean(await ipcRenderer.invoke("hunter:get-autostart")),
  setAutostart: async (enabled) => Boolean(await ipcRenderer.invoke("hunter:set-autostart", Boolean(enabled)))
};

contextBridge.exposeInMainWorld("hunterDesktop", desktopBridge);

function isApiReadyPayload(payload: unknown): payload is ApiReadyPayload {
  return typeof payload === "object" && payload !== null && typeof (payload as ApiReadyPayload).base === "string";
}
