import { contextBridge, ipcRenderer } from "electron";

// Pont réservé à l'écran de connexion local (fichier de l'application). Les pages du serveur n'y
// ont pas accès ; le processus principal vérifie aussi l'origine de chaque appel.
if (location.protocol === "file:") {
  contextBridge.exposeInMainWorld("desktop", {
    info: () => ipcRenderer.invoke("desktop:info"),
    connect: (address: string) => ipcRenderer.invoke("desktop:connect", address),
    scan: () => ipcRenderer.invoke("desktop:scan"),
    retry: () => ipcRenderer.invoke("desktop:retry"),
  });
}
