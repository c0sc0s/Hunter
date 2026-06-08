const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("hunterDesktop", {
  getApiBase: () => ipcRenderer.invoke("hunter:get-api-base"),
  onApiReady: (listener) => {
    const handler = (_event, payload) => {
      listener(payload);
    };
    ipcRenderer.on("hunter:api-ready", handler);
    return () => {
      ipcRenderer.removeListener("hunter:api-ready", handler);
    };
  },
  isAutostartAvailable: () => ipcRenderer.invoke("hunter:is-autostart-available"),
  getAutostart: () => ipcRenderer.invoke("hunter:get-autostart"),
  setAutostart: (enabled) => ipcRenderer.invoke("hunter:set-autostart", Boolean(enabled))
});
