let selectedVideoPath = null;
let videoProcessed = false;

const selectVideoBtn = document.getElementById('selectVideoBtn');
const playBtn = document.getElementById('playBtn');
const pauseBtn = document.getElementById('pauseBtn');
const stopBtn = document.getElementById('stopBtn');
const resetBtn = document.getElementById('resetBtn');
const speedSlider = document.getElementById('speedSlider');
const speedValue = document.getElementById('speedValue');
const audioDelaySlider = document.getElementById('audioDelaySlider');
const audioDelayValue = document.getElementById('audioDelayValue');
const status = document.getElementById('status');
const videoInfo = document.getElementById('videoInfo');
const progressContainer = document.getElementById('progressContainer');
const progressBar = document.getElementById('progressBar');

// 选择视频
selectVideoBtn.addEventListener('click', async () => {
  const result = await window.electronAPI.selectVideo();
  
  if (result.success) {
    selectedVideoPath = result.path;
    status.textContent = '正在处理视频，请稍候...';
    selectVideoBtn.disabled = true;
    
    // 显示进度条
    progressContainer.style.display = 'block';
    progressBar.style.width = '0%';
    
    // 处理视频
    const processResult = await window.electronAPI.processVideo(selectedVideoPath);
    
    // 隐藏进度条
    progressContainer.style.display = 'none';
    
    if (processResult.success) {
      videoProcessed = true;
      status.textContent = '视频处理完成，可以开始播放。';
      
      // 显示视频信息
      const filename = selectedVideoPath.split('/').pop();
      videoInfo.innerHTML = `
        <p><strong>文件名:</strong> ${filename}</p>
        <p><strong>帧数:</strong> ${processResult.frameCount}</p>
        <p><strong>帧率:</strong> ${processResult.fps} fps</p>
        <p><strong>时长:</strong> ${formatTime(processResult.duration)}</p>
        <p><strong>音频:</strong> ${processResult.hasAudio ? '有' : '无'}</p>
      `;
      
      // 启用控制按钮
      playBtn.disabled = false;
      pauseBtn.disabled = true;
      stopBtn.disabled = true;
      resetBtn.disabled = false;
      speedSlider.disabled = false;
      audioDelaySlider.disabled = false;
    } else {
      status.textContent = `处理视频失败: ${processResult.error || '未知错误'}`;
      selectVideoBtn.disabled = false;
    }
  }
});

// 监听处理进度
window.electronAPI.onProcessingProgress((event, data) => {
  progressBar.style.width = `${data.progress}%`;
  
  switch (data.stage) {
    case 'start':
      status.textContent = '开始处理视频...';
      break;
    case 'audio':
      status.textContent = '正在提取音频...';
      break;
    case 'frames':
      status.textContent = '正在提取视频帧...';
      break;
    case 'loading':
      status.textContent = '正在加载帧到内存...';
      break;
    case 'complete':
      status.textContent = '处理完成！';
      break;
    case 'error':
      status.textContent = '处理出错！';
      break;
  }
});

// 格式化时间（秒转为 mm:ss 格式）
function formatTime(seconds) {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

// 播放
playBtn.addEventListener('click', () => {
  if (!videoProcessed) return;
  
  window.electronAPI.play();
  status.textContent = '正在播放...';
  
  playBtn.disabled = true;
  pauseBtn.disabled = false;
  stopBtn.disabled = false;
  resetBtn.disabled = false;
});

// 暂停
pauseBtn.addEventListener('click', () => {
  window.electronAPI.pause();
  status.textContent = '已暂停';
  
  playBtn.disabled = false;
  pauseBtn.disabled = true;
  stopBtn.disabled = false;
  resetBtn.disabled = false;
});

// 停止
stopBtn.addEventListener('click', () => {
  window.electronAPI.stop();
  status.textContent = '已停止';
  
  playBtn.disabled = false;
  pauseBtn.disabled = true;
  stopBtn.disabled = true;
  resetBtn.disabled = false;
});

// 添加重置按钮事件处理
resetBtn.addEventListener('click', () => {
  window.electronAPI.reset();
  status.textContent = '正在重置...';
  
  // 禁用所有按钮，直到重置完成
  playBtn.disabled = true;
  pauseBtn.disabled = true;
  stopBtn.disabled = true;
  resetBtn.disabled = true;
  selectVideoBtn.disabled = true;
  speedSlider.disabled = true;
  audioDelaySlider.disabled = true;
  
  // 重置滑块
  speedSlider.value = 1.0;
  speedValue.textContent = '1.0x';
  audioDelaySlider.value = 0.3;
  updateAudioDelayDisplay(0.3);
});

// 更新音频延迟显示
function updateAudioDelayDisplay(delay) {
  if (delay >= 0) {
    audioDelayValue.textContent = `延迟 ${delay.toFixed(1)}s`;
  } else {
    audioDelayValue.textContent = `提前 ${Math.abs(delay).toFixed(1)}s`;
  }
}

// 监听重置完成事件
window.electronAPI.onResetCompleted(() => {
  // 重置完成后，恢复初始状态
  videoProcessed = false;
  selectedVideoPath = null;
  
  status.textContent = '已重置。请选择一个新的视频文件。';
  videoInfo.innerHTML = '';
  
  // 只启用选择视频按钮
  selectVideoBtn.disabled = false;
  playBtn.disabled = true;
  pauseBtn.disabled = true;
  stopBtn.disabled = true;
  resetBtn.disabled = true;
  speedSlider.disabled = true;
  audioDelaySlider.disabled = true;
});

// 监听播放结束事件
window.electronAPI.onPlaybackEnded(() => {
  status.textContent = '播放结束';
  
  playBtn.disabled = false;
  pauseBtn.disabled = true;
  stopBtn.disabled = true;
  resetBtn.disabled = false;
});

// 播放速度控制
speedSlider.addEventListener('input', () => {
  const speed = parseFloat(speedSlider.value);
  speedValue.textContent = `${speed.toFixed(1)}x`;
  window.electronAPI.setSpeed(speed);
});

// 音频延迟控制
audioDelaySlider.addEventListener('input', () => {
  const delay = parseFloat(audioDelaySlider.value);
  updateAudioDelayDisplay(delay);
  window.electronAPI.setAudioDelay(delay);
});

// 初始化延迟显示
updateAudioDelayDisplay(parseFloat(audioDelaySlider.value));
