const { app, BrowserWindow, ipcMain, dialog, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegPath = require('ffmpeg-static');
const { exec, spawn } = require('child_process');

// 设置 ffmpeg 路径
ffmpeg.setFfmpegPath(ffmpegPath);

let mainWindow;
let frameImages = []; // 存储已加载的帧图像
let audioPath = '';
let isPlaying = false;
let currentFrameIndex = 0;
let animationTimerId; // 改为 timerId
let audioProcess;
let fps = 24; // 默认帧率
let videoDuration = 0; // 视频总时长（毫秒）
let playbackStartTime = 0; // 播放开始时间
let speedFactor = 1.0; // 播放速度因子，默认为1.0（正常速度）
let syncInterval; // 同步检查定时器
let audioDelay = 0.3; // 音频延迟补偿（秒）

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 800,
    height: 600,
    title: 'Dock Video Player',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  mainWindow.loadFile('index.html');
}

app.name = 'Dock Video Player';

app.whenReady().then(() => {
  createWindow();

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', function () {
  if (process.platform !== 'darwin') app.quit();
});

// 清理临时文件夹
function clearTempFolder() {
  const tempDir = path.join(__dirname, 'assets', 'temp');
  if (fs.existsSync(tempDir)) {
    fs.readdirSync(tempDir).forEach(file => {
      fs.unlinkSync(path.join(tempDir, file));
    });
  } else {
    fs.mkdirSync(tempDir, { recursive: true });
  }
}

// 选择视频文件
ipcMain.handle('select-video', async () => {
  const result = await dialog.showOpenDialog({
    properties: ['openFile'],
    filters: [
      { name: 'Videos', extensions: ['mp4', 'mov', 'avi', 'mkv'] }
    ]
  });
  
  if (result.canceled) return { success: false };
  
  const videoPath = result.filePaths[0];
  return { success: true, path: videoPath };
});

// 设置音频延迟
ipcMain.on('set-audio-delay', (event, delay) => {
  audioDelay = parseFloat(delay);
  
  // 如果正在播放，需要重新调整播放
  if (isPlaying) {
    // 记录当前进度
    const currentProgress = (Date.now() - playbackStartTime) / 1000;
    
    // 停止当前播放
    stopPlayback();
    
    // 从当前位置重新开始播放
    startPlayback(currentProgress);
  }
});

// 处理视频
ipcMain.handle('process-video', async (event, videoPath) => {
  clearTempFolder();
  frameImages = [];
  
  const tempDir = path.join(__dirname, 'assets', 'temp');
  
  try {
    // 通知进度开始
    mainWindow.webContents.send('processing-progress', { stage: 'start', progress: 0 });
    
    // 获取视频信息
    const videoInfo = await new Promise((resolve, reject) => {
      ffmpeg.ffprobe(videoPath, (err, metadata) => {
        if (err) reject(err);
        else resolve(metadata);
      });
    });
    
    // 获取视频帧率和时长
    const videoStream = videoInfo.streams.find(stream => stream.codec_type === 'video');
    if (videoStream) {
      if (videoStream.r_frame_rate) {
        const [num, den] = videoStream.r_frame_rate.split('/');
        fps = Math.round(num / den);
      }
      
      if (videoStream.duration) {
        videoDuration = parseFloat(videoStream.duration) * 1000; // 转换为毫秒
      } else if (videoInfo.format && videoInfo.format.duration) {
        videoDuration = parseFloat(videoInfo.format.duration) * 1000; // 转换为毫秒
      }
    }
    
    // 通知进度更新
    mainWindow.webContents.send('processing-progress', { stage: 'audio', progress: 20 });
    
    // 提取音频
    audioPath = path.join(tempDir, 'audio.mp3');
    await new Promise((resolve, reject) => {
      ffmpeg(videoPath)
        .output(audioPath)
        .noVideo()
        .audioCodec('libmp3lame')
        .on('end', resolve)
        .on('error', reject)
        .run();
    });
    
    // 通知进度更新
    mainWindow.webContents.send('processing-progress', { stage: 'frames', progress: 40 });
    
    // 提取帧 - 使用时间戳提取以确保准确性
    await new Promise((resolve, reject) => {
      ffmpeg(videoPath)
        .output(path.join(tempDir, 'frame-%04d.png'))
        .outputOptions([
          '-vf', 'scale=128:128', // 调整为合适的 Dock 图标大小
          '-vsync', '1' // 使用时间戳同步
        ])
        .on('progress', (progress) => {
          if (progress.percent) {
            const totalProgress = 40 + (progress.percent * 0.4);
            mainWindow.webContents.send('processing-progress', { 
              stage: 'frames', 
              progress: Math.min(80, totalProgress) 
            });
          }
        })
        .on('end', resolve)
        .on('error', reject)
        .run();
    });
    
    // 通知进度更新
    mainWindow.webContents.send('processing-progress', { stage: 'loading', progress: 80 });
    
    // 读取所有帧
    const files = fs.readdirSync(tempDir)
      .filter(file => file.startsWith('frame-'))
      .sort((a, b) => {
        const numA = parseInt(a.match(/frame-(\d+)/)[1]);
        const numB = parseInt(b.match(/frame-(\d+)/)[1]);
        return numA - numB;
      });
    
    // 预加载所有帧到内存
    for (let i = 0; i < files.length; i++) {
      const framePath = path.join(tempDir, files[i]);
      const image = nativeImage.createFromPath(framePath);
      frameImages.push(image);
      
      // 每加载10%的帧更新一次进度
      if (i % Math.max(1, Math.floor(files.length / 10)) === 0) {
        const loadProgress = 80 + ((i / files.length) * 20);
        mainWindow.webContents.send('processing-progress', { 
          stage: 'loading', 
          progress: Math.min(100, loadProgress) 
        });
      }
    }
    
    // 通知进度完成
    mainWindow.webContents.send('processing-progress', { stage: 'complete', progress: 100 });
    
    return { 
      success: true, 
      frameCount: frameImages.length,
      fps: fps,
      duration: videoDuration / 1000, // 返回秒数
      hasAudio: fs.existsSync(audioPath)
    };
  } catch (error) {
    console.error('Error processing video:', error);
    mainWindow.webContents.send('processing-progress', { stage: 'error', progress: 0 });
    return { success: false, error: error.message };
  }
});

// 设置播放速度
ipcMain.on('set-speed', (event, speed) => {
  speedFactor = parseFloat(speed);
  
  // 如果正在播放，需要重新调整播放
  if (isPlaying) {
    // 记录当前进度
    const currentProgress = (Date.now() - playbackStartTime) / 1000;
    
    // 停止当前播放
    stopPlayback();
    
    // 从当前位置重新开始播放
    startPlayback(currentProgress);
  }
});

// 停止播放
function stopPlayback() {
  if (animationTimerId) {
    clearTimeout(animationTimerId); // 使用 clearTimeout 替代 cancelAnimationFrame
    animationTimerId = null;
  }
  
  clearInterval(syncInterval);
  
  // 停止音频
  if (audioProcess) {
    exec('killall afplay');
    audioProcess = null;
  }
  
  isPlaying = false;
}

// 开始播放（支持从指定位置开始）
function startPlayback(startTimeSeconds = 0) {
  if (frameImages.length === 0) return;
  
  isPlaying = true;
  
  // 计算开始帧
  const startFrame = Math.floor(startTimeSeconds * fps);
  currentFrameIndex = Math.min(Math.max(0, startFrame), frameImages.length - 1);
  
  // 记录播放开始时间，考虑起始位置
  playbackStartTime = Date.now() - (startTimeSeconds * 1000);
  
  // 设置初始帧
  if (app.dock && frameImages[currentFrameIndex]) {
    app.dock.setIcon(frameImages[currentFrameIndex]);
  }
  
  // 处理音频播放
  if (fs.existsSync(audioPath)) {
    if (audioDelay >= 0) {
      // 正延迟：延迟播放音频
      setTimeout(() => {
        startAudioPlayback(startTimeSeconds);
      }, audioDelay * 1000);
    } else {
      // 负延迟：提前播放音频，调整视频起始时间
      const adjustedStartTime = Math.max(0, startTimeSeconds - Math.abs(audioDelay));
      startAudioPlayback(adjustedStartTime);
      
      // 调整播放开始时间，使视频看起来是延迟播放的
      playbackStartTime = Date.now() - (startTimeSeconds * 1000) + (Math.abs(audioDelay) * 1000);
    }
  }
  
  // 辅助函数：开始音频播放
  function startAudioPlayback(startPos) {
    audioProcess = spawn('afplay', [
      audioPath,
      '-r', speedFactor.toString(), // 播放速度
      '-t', startPos.toString() // 开始位置（秒）
    ]);
    
    // 监听音频播放结束
    audioProcess.on('close', (code) => {
      if (code === 0 && isPlaying) {
        // 正常结束，通知播放完成
        stopPlayback();
        mainWindow.webContents.send('playback-ended');
      }
    });
  }
  
  // 使用 setTimeout 替代 requestAnimationFrame
  function updateFrame() {
    if (!isPlaying) return;
    
    // 计算当前应该显示的帧
    const elapsedTime = (Date.now() - playbackStartTime) / 1000 * speedFactor;
    const targetFrame = Math.floor(elapsedTime * fps);
    
    // 确保目标帧在有效范围内
    const validTargetFrame = Math.min(Math.max(0, targetFrame), frameImages.length - 1);
    
    // 只有当目标帧变化时才更新
    if (validTargetFrame !== currentFrameIndex && validTargetFrame < frameImages.length) {
      currentFrameIndex = validTargetFrame;
      
      // 添加额外的安全检查
      if (currentFrameIndex >= 0 && currentFrameIndex < frameImages.length && frameImages[currentFrameIndex]) {
        // 更新 Dock 图标
        if (app.dock) {
          app.dock.setIcon(frameImages[currentFrameIndex]);
        }
      } else {
        console.error(`无效的帧索引: ${currentFrameIndex}, 总帧数: ${frameImages.length}`);
      }
    }
    
    // 检查是否播放结束
    if (currentFrameIndex >= frameImages.length - 1) {
      stopPlayback();
      mainWindow.webContents.send('playback-ended');
      return;
    }
    
    // 继续下一帧更新
    animationTimerId = setTimeout(() => {
      updateFrame();
    }, 1000 / 60); // 约60fps的更新率
  }
  
  // 开始帧更新循环
  updateFrame();
  
  // 添加定期同步检查
  syncInterval = setInterval(() => {
    if (!isPlaying) return;
    
    const elapsedTime = (Date.now() - playbackStartTime) / 1000 * speedFactor;
    const targetFrame = Math.floor(elapsedTime * fps);
    
    // 确保目标帧在有效范围内
    const validTargetFrame = Math.min(Math.max(0, targetFrame), frameImages.length - 1);
    
    // 如果当前帧与目标帧相差超过5帧，进行同步调整
    if (Math.abs(currentFrameIndex - validTargetFrame) > 5) {
      console.log(`同步调整: 当前=${currentFrameIndex}, 目标=${validTargetFrame}`);
      currentFrameIndex = validTargetFrame;
      
      // 添加额外的安全检查
      if (currentFrameIndex >= 0 && currentFrameIndex < frameImages.length && frameImages[currentFrameIndex]) {
        // 更新图标
        if (app.dock) {
          app.dock.setIcon(frameImages[currentFrameIndex]);
        }
      } else {
        console.error(`同步时无效的帧索引: ${currentFrameIndex}, 总帧数: ${frameImages.length}`);
      }
    }
  }, 500); // 每0.5秒同步一次
}



// 播放
ipcMain.on('play', () => {
  if (frameImages.length === 0) return;
  if (isPlaying) return;
  
  startPlayback();
});

// 暂停
ipcMain.on('pause', () => {
  if (!isPlaying) return;
  
  stopPlayback();
});

// 停止并重置
ipcMain.on('stop', () => {
  stopPlayback();
  
  currentFrameIndex = 0;
  
  // 重置 Dock 图标
  if (app.dock && frameImages.length > 0) {
    app.dock.setIcon(frameImages[0]);
  }
});

// 添加重置功能
ipcMain.on('reset', () => {
  // 停止当前播放
  stopPlayback();
  
  // 重置状态
  currentFrameIndex = 0;
  frameImages = [];
  audioPath = '';
  
  // 重置 Dock 图标为默认图标
  if (app.dock) {
    app.dock.setIcon(null); // 使用 null 恢复默认图标
  }
  
  // 通知渲染进程重置完成
  mainWindow.webContents.send('reset-completed');
});

// 应用退出时清理
app.on('will-quit', () => {
  stopPlayback();
});
