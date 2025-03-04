const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  selectVideo: () => ipcRenderer.invoke('select-video'),
  processVideo: (videoPath) => ipcRenderer.invoke('process-video', videoPath),
  play: () => ipcRenderer.send('play'),
  pause: () => ipcRenderer.send('pause'),
  stop: () => ipcRenderer.send('stop'),
  reset: () => ipcRenderer.send('reset'),
  setSpeed: (speed) => ipcRenderer.send('set-speed', speed),
  setAudioDelay: (delay) => ipcRenderer.send('set-audio-delay', delay),
  onPlaybackEnded: (callback) => ipcRenderer.on('playback-ended', callback),
  onResetCompleted: (callback) => ipcRenderer.on('reset-completed', callback),
  onProcessingProgress: (callback) => ipcRenderer.on('processing-progress', callback)
});
