import { contextBridge, ipcRenderer } from "electron";

import { IPC_CHANNELS } from "../shared/desktop-api.ts";
import type { DesktopApi } from "../shared/desktop-api.ts";

const desktopApi: DesktopApi = {
  connection: {
    load: () =>
      ipcRenderer.invoke(IPC_CHANNELS.connectionLoad) as Promise<
        Awaited<ReturnType<DesktopApi["connection"]["load"]>>
      >,
    save: (input) =>
      ipcRenderer.invoke(IPC_CHANNELS.connectionSave, input) as Promise<
        Awaited<ReturnType<DesktopApi["connection"]["save"]>>
      >,
    clear: () => ipcRenderer.invoke(IPC_CHANNELS.connectionClear) as Promise<void>,
  },
};

contextBridge.exposeInMainWorld("desktop", desktopApi);
