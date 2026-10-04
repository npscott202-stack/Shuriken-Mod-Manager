// Exposes a narrow, promise-based API to the renderer.
const { contextBridge, ipcRenderer, webUtils } = require('electron');

async function call(channel, ...args) {
  const res = await ipcRenderer.invoke(channel, ...args);
  if (!res.ok) throw new Error(res.error);
  return res.value;
}

const on = (channel) => (fn) => {
  const listener = (_e, payload) => fn(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
};

contextBridge.exposeInMainWorld('shuriken', {
  call,
  pathForFile: (file) => webUtils.getPathForFile(file),
  onAiEvent: on('ai:event'),
  onDownload: on('download:progress'),
  onDeployProgress: on('deploy:progress'),
  onToast: on('toast'),
  onNxmInstalled: on('nxm:installed'),
  onScreenshot: on('screenshot:captured'),
  onEngineProgress: on('engine:progress'),
});
