/**
 * 视频剪辑工具 - 前端逻辑
 * 功能：视频预览、时间轴拖拽、文件选择、剪辑控制
 */

// ==================== 状态管理 ====================
const state = {
    currentPath: '',           // 当前浏览路径
    activeVideo: null,         // 当前激活的视频（用于剪辑）
    videoInfo: null,           // 当前视频信息
    startTime: 0,              // 剪辑开始时间（秒）
    endTime: 0,                // 剪辑结束时间（秒）
    duration: 0,               // 视频总时长（秒）
    currentTime: 0,            // 当前播放时间
    isDragging: null,          // 正在拖拽的手柄 ('start' | 'end' | null)
    videoSupported: false,     // 视频是否支持浏览器播放
    videoSessionId: null,      // 当前视频转码会话ID
    
    // 文件选择弹窗状态
    fileBrowser: {
        isOpen: false,
        mode: 'file',          // 'file' | 'directory'
        currentPath: '',
        selectedPath: '',
        callback: null,        // 选择完成的回调
        filter: null           // 文件过滤器
    },
    
    // 文件存在确认状态
    fileExistsConfirm: {
        pendingClip: null,     // 待执行的剪辑参数
        existingPath: ''       // 已存在的文件路径
    },
    
    // RTSP 推流状态
    rtsp: {
        serverRunning: false,  // 服务器是否运行
        isStreaming: false,    // 是否正在推流
        currentTime: 0,        // 当前推流时间
        rtspUrl: '',           // RTSP 地址
        statusPollInterval: null // 状态轮询定时器
    },
    
    // 视频合并状态
    merge: {
        videos: []             // 待合并的视频列表 [{path, name, duration}]
    }
};

/**
 * 生成唯一会话ID
 */
function generateSessionId() {
    return `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * 停止当前转码进程
 */
async function stopCurrentTranscode() {
    if (state.videoSessionId) {
        await api('/api/stop-transcode', {
            method: 'POST',
            body: { sessionId: state.videoSessionId }
        });
        state.videoSessionId = null;
    }
}

/**
 * 关闭当前视频
 */
async function closeVideo() {
    await stopCurrentTranscode();
    
    // 停止 RTSP 推流
    if (state.rtsp.isStreaming) {
        await stopRtspStream();
    }
    
    // 重置状态
    state.activeVideo = null;
    state.videoSupported = false;
    state.duration = 0;
    state.startTime = 0;
    state.endTime = 0;
    state.currentTime = 0;
    
    // 停止视频播放
    DOM.videoPlayer.pause();
    DOM.videoPlayer.src = '';
    
    // 隐藏视频相关UI
    DOM.videoHeader.style.display = 'none';
    DOM.videoContainer.style.display = 'none';
    DOM.clipPanel.style.display = 'none';
    DOM.mergePanel.style.display = 'none';
    DOM.resultPanel.style.display = 'none';
    DOM.rtspPanel.style.display = 'none';
    
    // 显示初始提示
    DOM.noVideoHint.style.display = 'flex';
    
    // 刷新文件列表以移除active状态
    loadDirectory(state.currentPath);
}

// ==================== DOM 元素 ====================
const DOM = {
    // 文件浏览器
    fileList: document.getElementById('fileList'),
    currentPath: document.getElementById('currentPath'),
    btnBack: document.getElementById('btnBack'),
    btnGo: document.getElementById('btnGo'),
    btnRefresh: document.getElementById('btnRefresh'),
    
    // 视频预览
    videoPreviewPanel: document.getElementById('videoPreviewPanel'),
    noVideoHint: document.getElementById('noVideoHint'),
    videoContainer: document.getElementById('videoContainer'),
    videoPlayer: document.getElementById('videoPlayer'),
    videoError: document.getElementById('videoError'),
    
    // 剪辑面板（可折叠）
    clipPanel: document.getElementById('clipPanel'),
    clipPanelHeader: document.getElementById('clipPanelHeader'),
    clipPanelContent: document.getElementById('clipPanelContent'),
    btnCollapseClip: document.getElementById('btnCollapseClip'),
    
    // 时间轴
    timeline: document.getElementById('timeline'),
    timelineProgress: document.getElementById('timelineProgress'),
    timelineSelection: document.getElementById('timelineSelection'),
    handleStart: document.getElementById('handleStart'),
    handleEnd: document.getElementById('handleEnd'),
    playhead: document.getElementById('playhead'),
    labelStart: document.getElementById('labelStart'),
    labelCurrent: document.getElementById('labelCurrent'),
    labelEnd: document.getElementById('labelEnd'),
    
    // 时间输入
    inputStartTime: document.getElementById('inputStartTime'),
    inputEndTime: document.getElementById('inputEndTime'),
    btnUseCurrentStart: document.getElementById('btnUseCurrentStart'),
    btnUseCurrentEnd: document.getElementById('btnUseCurrentEnd'),
    clipDuration: document.getElementById('clipDuration'),
    
    // 快捷操作
    btnPreviewStart: document.getElementById('btnPreviewStart'),
    btnPreviewEnd: document.getElementById('btnPreviewEnd'),
    btnPreviewClip: document.getElementById('btnPreviewClip'),
    
    // 输出设置
    outputName: document.getElementById('outputName'),
    reEncode: document.getElementById('reEncode'),
    
    // 操作按钮
    btnClip: document.getElementById('btnClip'),
    
    // 结果面板
    resultPanel: document.getElementById('resultPanel'),
    
    // 设置弹窗
    settingsModal: document.getElementById('settingsModal'),
    btnSettings: document.getElementById('btnSettings'),
    btnCloseSettings: document.getElementById('btnCloseSettings'),
    btnSaveSettings: document.getElementById('btnSaveSettings'),
    settingFfmpegPath: document.getElementById('settingFfmpegPath'),
    settingOutputDir: document.getElementById('settingOutputDir'),
    btnBrowseFfmpeg: document.getElementById('btnBrowseFfmpeg'),
    btnBrowseOutput: document.getElementById('btnBrowseOutput'),
    btnTestFfmpeg: document.getElementById('btnTestFfmpeg'),
    ffmpegTestResult: document.getElementById('ffmpegTestResult'),
    
    // 文件选择弹窗
    fileBrowserModal: document.getElementById('fileBrowserModal'),
    fileBrowserTitle: document.getElementById('fileBrowserTitle'),
    btnCloseFileBrowser: document.getElementById('btnCloseFileBrowser'),
    modalCurrentPath: document.getElementById('modalCurrentPath'),
    btnModalBack: document.getElementById('btnModalBack'),
    modalFileList: document.getElementById('modalFileList'),
    modalSelectedPath: document.getElementById('modalSelectedPath'),
    btnCancelFileBrowser: document.getElementById('btnCancelFileBrowser'),
    btnConfirmFileBrowser: document.getElementById('btnConfirmFileBrowser'),
    
    // 文件存在确认弹窗
    fileExistsModal: document.getElementById('fileExistsModal'),
    btnCloseFileExists: document.getElementById('btnCloseFileExists'),
    existingFilePath: document.getElementById('existingFilePath'),
    btnFileExistsCancel: document.getElementById('btnFileExistsCancel'),
    btnFileExistsRename: document.getElementById('btnFileExistsRename'),
    btnFileExistsOverwrite: document.getElementById('btnFileExistsOverwrite'),
    
    // 其他
    btnOpenOutput: document.getElementById('btnOpenOutput'),
    btnBatchConvert: document.getElementById('btnBatchConvert'),
    
    // 视频信息栏
    videoHeader: document.getElementById('videoHeader'),
    videoName: document.getElementById('videoName'),
    btnCloseVideo: document.getElementById('btnCloseVideo'),
    
    // 视频合并面板
    mergePanel: document.getElementById('mergePanel'),
    mergePanelHeader: document.getElementById('mergePanelHeader'),
    mergePanelContent: document.getElementById('mergePanelContent'),
    btnCollapseMerge: document.getElementById('btnCollapseMerge'),
    mergeList: document.getElementById('mergeList'),
    btnAddToMerge: document.getElementById('btnAddToMerge'),
    btnClearMerge: document.getElementById('btnClearMerge'),
    mergeOutputName: document.getElementById('mergeOutputName'),
    btnMerge: document.getElementById('btnMerge'),
    mergeCount: document.getElementById('mergeCount'),
    
    // RTSP 推流
    rtspPanel: document.getElementById('rtspPanel'),
    rtspPanelHeader: document.getElementById('rtspPanelHeader'),
    rtspPanelContent: document.getElementById('rtspPanelContent'),
    btnCollapseRtsp: document.getElementById('btnCollapseRtsp'),
    rtspStatusDot: document.getElementById('rtspStatusDot'),
    rtspStatusText: document.getElementById('rtspStatusText'),
    rtspUrl: document.getElementById('rtspUrl'),
    btnCopyRtspUrl: document.getElementById('btnCopyRtspUrl'),
    rtspCurrentTime: document.getElementById('rtspCurrentTime'),
    rtspTotalTime: document.getElementById('rtspTotalTime'),
    syncStatus: document.getElementById('syncStatus'),
    btnStartStream: document.getElementById('btnStartStream'),
    btnSyncStream: document.getElementById('btnSyncStream'),
    btnStopStream: document.getElementById('btnStopStream'),
    
    // RTSP 推流选项
    rtspSpeed: document.getElementById('rtspSpeed'),
    rtspUseRange: document.getElementById('rtspUseRange'),
    rtspRangeDisplay: document.getElementById('rtspRangeDisplay'),
    rtspLoop: document.getElementById('rtspLoop'),
    rtspLoopCount: document.getElementById('rtspLoopCount'),
    speedHint: document.getElementById('speedHint'),
    
    // RTSP 状态监控
    rtspStats: document.getElementById('rtspStats'),
    statFps: document.getElementById('statFps'),
    statBitrate: document.getElementById('statBitrate'),
    statFrames: document.getElementById('statFrames'),
    statDropped: document.getElementById('statDropped'),
    statSpeed: document.getElementById('statSpeed'),
    statSize: document.getElementById('statSize'),
    
    // RTSP 设置
    settingMediamtxPath: document.getElementById('settingMediamtxPath'),
    btnBrowseMediamtx: document.getElementById('btnBrowseMediamtx'),
    settingRtspPort: document.getElementById('settingRtspPort'),
    settingStreamName: document.getElementById('settingStreamName'),
    rtspUrlPreview: document.getElementById('rtspUrlPreview')
};

// ==================== 工具函数 ====================

/**
 * 格式化时长 (秒 -> HH:MM:SS)
 */
function formatTime(seconds) {
    if (!isFinite(seconds) || seconds < 0) seconds = 0;
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

/**
 * 解析时间字符串 (HH:MM:SS -> 秒)
 */
function parseTime(timeStr) {
    const parts = timeStr.split(':').map(Number);
    if (parts.length !== 3 || parts.some(isNaN)) return null;
    return parts[0] * 3600 + parts[1] * 60 + parts[2];
}

/**
 * 格式化文件大小
 */
function formatSize(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
    return (bytes / (1024 * 1024 * 1024)).toFixed(2) + ' GB';
}

/**
 * API 请求封装
 */
async function api(endpoint, options = {}) {
    try {
        const response = await fetch(endpoint, {
            headers: { 'Content-Type': 'application/json' },
            ...options,
            body: options.body ? JSON.stringify(options.body) : undefined
        });
        return await response.json();
    } catch (e) {
        console.error('API请求失败:', e);
        return { success: false, error: e.message };
    }
}

// ==================== 文件浏览器 ====================

/**
 * 加载目录内容
 */
async function loadDirectory(dirPath = '', targetElement = DOM.fileList, isModal = false) {
    targetElement.innerHTML = '<div class="loading">加载中...</div>';
    
    const result = await api(`/api/browse?path=${encodeURIComponent(dirPath)}`);
    
    if (!result.success) {
        targetElement.innerHTML = `<div class="loading" style="color: var(--error)">加载失败: ${result.error}</div>`;
        return;
    }
    
    const currentPath = result.path || '';
    
    if (!isModal) {
        state.currentPath = currentPath;
        DOM.currentPath.value = state.currentPath;
        
        // 保存浏览路径到配置（异步，不阻塞）
        if (currentPath) {
            api('/api/save-browse-path', {
                method: 'POST',
                body: { path: currentPath }
            });
        }
    } else {
        state.fileBrowser.currentPath = currentPath;
        DOM.modalCurrentPath.value = currentPath;
    }
    
    // 渲染文件列表
    if (result.items.length === 0) {
        targetElement.innerHTML = '<div class="loading">空文件夹</div>';
        return;
    }
    
    // 过滤文件（如果在弹窗模式）
    let items = result.items;
    if (isModal && state.fileBrowser.filter) {
        items = items.filter(item => {
            if (item.isDirectory || item.isDrive) return true;
            return state.fileBrowser.filter(item);
        });
    }
    
    targetElement.innerHTML = items.map(item => {
        const isActive = !isModal && state.activeVideo?.path === item.path;
        const isSelected = isModal && state.fileBrowser.selectedPath === item.path;
        
        let icon = '📄';
        let className = 'file-item';
        
        if (item.isDrive) {
            icon = '💾';
            className += ' drive';
        } else if (item.isDirectory) {
            icon = '📁';
            className += ' directory';
        } else if (item.isVideo) {
            icon = '🎬';
            className += ' video';
        } else if (item.name.match(/\.exe$/i)) {
            icon = '⚙️';
            className += ' executable';
        }
        
        if (isActive) className += ' active';
        if (isModal) {
            className += ' selectable';
            if (isSelected) className += ' selected';
        }
        
        return `
            <div class="${className}" data-path="${item.path}" data-is-dir="${item.isDirectory || item.isDrive}" data-is-video="${item.isVideo || false}">
                <span class="icon">${icon}</span>
                <span class="name" title="${item.name}">${item.name}</span>
                ${!item.isDirectory && !item.isDrive && item.size ? `<span class="size">${formatSize(item.size)}</span>` : ''}
            </div>
        `;
    }).join('');
    
    // 绑定点击事件
    bindFileListEvents(targetElement, isModal);
}

/**
 * 绑定文件列表事件
 */
function bindFileListEvents(targetElement, isModal = false) {
    targetElement.querySelectorAll('.file-item').forEach(item => {
        const isDir = item.dataset.isDir === 'true';
        const isVideo = item.dataset.isVideo === 'true';
        const path = item.dataset.path;
        
        if (isModal) {
            // 弹窗模式
            item.addEventListener('click', () => {
                if (isDir) {
                    // 进入文件夹
                    loadDirectory(path, DOM.modalFileList, true);
                } else {
                    // 选择文件
                    if (state.fileBrowser.mode === 'file') {
                        state.fileBrowser.selectedPath = path;
                        DOM.modalSelectedPath.textContent = path;
                        // 更新选中状态
                        targetElement.querySelectorAll('.file-item').forEach(el => el.classList.remove('selected'));
                        item.classList.add('selected');
                    }
                }
            });
            
            item.addEventListener('dblclick', () => {
                if (isDir) {
                    loadDirectory(path, DOM.modalFileList, true);
                } else if (state.fileBrowser.mode === 'file') {
                    // 双击确认选择
                    state.fileBrowser.selectedPath = path;
                    confirmFileBrowserSelection();
                }
            });
        } else {
            // 主文件浏览器
            if (isDir) {
                item.addEventListener('click', () => loadDirectory(path));
            }
            
            if (isVideo) {
                item.addEventListener('click', () => setActiveVideo(path, item.querySelector('.name').textContent));
            }
        }
    });
}

// ==================== 视频预览 ====================

/**
 * 设置激活的视频
 */
async function setActiveVideo(path, name) {
    // 停止之前的转码进程并清理
    await stopCurrentTranscode();
    
    state.activeVideo = { path, name };
    state.videoSupported = false;
    
    // 生成新的会话ID
    state.videoSessionId = generateSessionId();
    
    // 显示视频信息栏
    DOM.videoHeader.style.display = 'flex';
    DOM.videoName.textContent = name;
    DOM.videoName.title = path;  // 鼠标悬停显示完整路径
    
    // 显示加载状态
    DOM.noVideoHint.style.display = 'none';
    DOM.videoContainer.style.display = 'flex';
    DOM.videoError.style.display = 'none';
    DOM.videoPlayer.style.display = 'none';
    DOM.clipPanel.style.display = 'none';
    DOM.mergePanel.style.display = 'none';
    DOM.resultPanel.style.display = 'none';
    
    // 显示 RTSP 面板（如果已配置 MediaMTX）
    const rtspConfig = await api('/api/rtsp/config');
    if (rtspConfig.success && rtspConfig.mediamtxPath) {
        DOM.rtspPanel.style.display = 'block';
        // 更新 RTSP UI 状态（确保按钮正确启用）
        updateRtspUI();
    }
    
    // 显示合并面板
    DOM.mergePanel.style.display = 'block';
    
    // 显示加载提示
    showResult('🔄 正在检测视频格式...', 'info');
    
    // 先尝试启动转码（如果需要）
    const transcodeResult = await api('/api/start-transcode', {
        method: 'POST',
        body: {
            videoPath: path,
            sessionId: state.videoSessionId
        }
    });
    
    if (transcodeResult.success) {
        if (transcodeResult.status === 'not_needed' || transcodeResult.status === 'ready') {
            // 无需转码或已有转码文件，直接加载
            loadVideoPlayer(path);
        } else if (transcodeResult.status === 'started' || transcodeResult.status === 'transcoding') {
            // 正在转码，等待完成
            showResult('🔄 正在转码视频以供预览，请稍候...<br><small>首次加载需要转码，之后会更快</small>', 'info');
            waitForTranscode(path);
        }
    } else {
        // 转码启动失败，尝试直接加载
        loadVideoPlayer(path);
    }
}

/**
 * 等待转码完成
 */
async function waitForTranscode(videoPath) {
    const sessionId = state.videoSessionId;
    let checkCount = 0;
    const maxChecks = 300; // 最多等待5分钟（每秒检查一次）
    
    const checkStatus = async () => {
        // 如果会话ID已变（用户切换了视频），停止检查
        if (state.videoSessionId !== sessionId) {
            return;
        }
        
        checkCount++;
        
        const result = await api(`/api/transcode-status?session=${sessionId}`);
        
        if (result.success) {
            if (result.status === 'ready') {
                // 转码完成，加载视频
                showResult('✅ 转码完成，正在加载...', 'success');
                setTimeout(() => loadVideoPlayer(videoPath), 500);
                return;
            } else if (result.status === 'transcoding') {
                // 还在转码，继续等待
                const dots = '.'.repeat((checkCount % 3) + 1);
                showResult(`🔄 正在转码${dots}<br><small>已等待 ${checkCount} 秒</small>`, 'info');
                
                if (checkCount < maxChecks) {
                    setTimeout(checkStatus, 1000);
                } else {
                    // 超时
                    showResult('⚠️ 转码超时，请尝试刷新或直接剪辑', 'error');
                    loadVideoInfoOnly(videoPath);
                }
                return;
            }
        }
        
        // 状态异常，尝试直接加载
        loadVideoPlayer(videoPath);
    };
    
    setTimeout(checkStatus, 1000);
}

/**
 * 加载视频播放器
 */
function loadVideoPlayer(videoPath) {
    const videoUrl = `/api/video-stream?path=${encodeURIComponent(videoPath)}&session=${state.videoSessionId}`;
    DOM.videoPlayer.src = videoUrl;
    
    // 等待视频加载
    DOM.videoPlayer.onloadedmetadata = () => {
        state.videoSupported = true;
        state.duration = DOM.videoPlayer.duration;
        state.startTime = 0;
        state.endTime = state.duration;
        state.currentTime = 0;
        
        DOM.videoPlayer.style.display = 'block';
        DOM.videoError.style.display = 'none';
        DOM.clipPanel.style.display = 'block';
        DOM.resultPanel.style.display = 'none';
        
        updateTimeline();
        loadDirectory(state.currentPath);
    };
    
    DOM.videoPlayer.onerror = async () => {
        // 视频加载失败
        DOM.videoPlayer.style.display = 'none';
        DOM.videoError.style.display = 'block';
        DOM.resultPanel.style.display = 'none';
        
        // 尝试只获取视频信息
        loadVideoInfoOnly(videoPath);
    };
}

/**
 * 只加载视频信息（不预览）
 */
async function loadVideoInfoOnly(videoPath) {
    const result = await api(`/api/video-info?path=${encodeURIComponent(videoPath)}`);
    
    if (result.success && result.duration) {
        state.duration = result.duration;
        state.startTime = 0;
        state.endTime = state.duration;
        DOM.clipPanel.style.display = 'block';
        updateTimeline();
        
        DOM.videoError.querySelector('p').textContent = '视频格式不支持预览';
        DOM.videoError.querySelector('.hint').textContent = '但不影响剪辑功能，您可以手动输入时间';
    } else {
        DOM.videoError.querySelector('p').textContent = '无法读取视频信息';
        DOM.videoError.querySelector('.hint').textContent = result.error || '请检查文件是否损坏';
    }
    
    loadDirectory(state.currentPath);
}

/**
 * 视频播放时间更新
 */
function onVideoTimeUpdate() {
    if (!state.videoSupported) return;
    
    state.currentTime = DOM.videoPlayer.currentTime;
    
    // 更新播放头位置
    const percent = (state.currentTime / state.duration) * 100;
    DOM.playhead.style.left = `${percent}%`;
    DOM.timelineProgress.style.width = `${percent}%`;
    
    // 更新当前时间标签
    DOM.labelCurrent.textContent = `当前: ${formatTime(state.currentTime)}`;
}

// ==================== 时间轴 ====================

/**
 * 更新时间轴显示
 */
function updateTimeline() {
    if (state.duration <= 0) return;
    
    const startPercent = (state.startTime / state.duration) * 100;
    const endPercent = (state.endTime / state.duration) * 100;
    
    // 更新手柄位置
    DOM.handleStart.style.left = `${startPercent}%`;
    DOM.handleEnd.style.left = `${endPercent}%`;
    
    // 更新选区（即使开始时间大于结束时间也显示）
    const leftPercent = Math.min(startPercent, endPercent);
    const rightPercent = Math.max(startPercent, endPercent);
    DOM.timelineSelection.style.left = `${leftPercent}%`;
    DOM.timelineSelection.style.right = `${100 - rightPercent}%`;
    
    // 更新标签
    DOM.labelStart.textContent = formatTime(state.startTime);
    DOM.labelEnd.textContent = formatTime(state.endTime);
    
    // 更新输入框
    DOM.inputStartTime.value = formatTime(state.startTime);
    DOM.inputEndTime.value = formatTime(state.endTime);
    
    // 更新片段时长（如果开始时间大于结束时间，显示警告样式）
    const duration = state.endTime - state.startTime;
    if (duration < 0) {
        DOM.clipDuration.textContent = `${formatTime(Math.abs(duration))} ⚠️`;
        DOM.clipDuration.style.color = 'var(--error)';
    } else {
        DOM.clipDuration.textContent = formatTime(duration);
        DOM.clipDuration.style.color = 'var(--primary)';
    }
    
    // 同步更新 RTSP 推流区间显示
    updateRtspRangeDisplay();
}

/**
 * 初始化时间轴拖拽
 */
function initTimelineDrag() {
    const timeline = DOM.timeline;
    
    function getTimeFromX(clientX) {
        const rect = timeline.getBoundingClientRect();
        const percent = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
        return percent * state.duration;
    }
    
    // 开始手柄拖拽
    DOM.handleStart.addEventListener('mousedown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        state.isDragging = 'start';
    });
    
    // 结束手柄拖拽
    DOM.handleEnd.addEventListener('mousedown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        state.isDragging = 'end';
    });
    
    // 点击时间轴跳转/设置位置
    timeline.addEventListener('click', (e) => {
        if (state.isDragging) return;
        if (e.target === DOM.handleStart || e.target === DOM.handleEnd) return;
        
        const time = getTimeFromX(e.clientX);
        
        // 如果视频支持播放，跳转到该位置
        if (state.videoSupported) {
            DOM.videoPlayer.currentTime = time;
        }
    });
    
    // 鼠标移动
    document.addEventListener('mousemove', (e) => {
        if (!state.isDragging) return;
        
        const time = getTimeFromX(e.clientX);
        
        if (state.isDragging === 'start') {
            state.startTime = Math.max(0, Math.min(time, state.endTime - 1));
        } else if (state.isDragging === 'end') {
            state.endTime = Math.min(state.duration, Math.max(time, state.startTime + 1));
        }
        
        updateTimeline();
    });
    
    // 鼠标释放
    document.addEventListener('mouseup', () => {
        state.isDragging = null;
    });
}

// ==================== 剪辑操作 ====================

/**
 * 执行剪辑
 * @param {boolean} overwrite - 是否覆盖已存在的文件
 * @param {string} customOutputName - 自定义输出文件名（用于重命名）
 */
async function doClip(overwrite = false, customOutputName = null) {
    if (!state.activeVideo) {
        showResult('请先选择视频', 'error');
        return;
    }
    
    // 校验时间范围
    if (state.startTime >= state.endTime) {
        showResult('❌ 开始时间必须小于结束时间', 'error');
        return;
    }
    
    if (state.startTime < 0) {
        showResult('❌ 开始时间不能为负数', 'error');
        return;
    }
    
    if (state.endTime > state.duration) {
        showResult('❌ 结束时间不能超过视频总时长', 'error');
        return;
    }
    
    const outputName = customOutputName || DOM.outputName.value || null;
    
    DOM.btnClip.disabled = true;
    DOM.btnClip.textContent = '⏳ 剪辑中...';
    showResult('正在剪辑，请稍候...', 'info');
    
    // 记录开始时间
    const startTimestamp = Date.now();
    
    const result = await api('/api/clip', {
        method: 'POST',
        body: {
            inputPath: state.activeVideo.path,
            startTime: state.startTime,
            endTime: state.endTime,
            outputName: outputName,
            reEncode: DOM.reEncode.checked,
            overwrite: overwrite
        }
    });
    
    // 计算耗时
    const elapsedTime = ((Date.now() - startTimestamp) / 1000).toFixed(1);
    
    DOM.btnClip.disabled = false;
    DOM.btnClip.textContent = '✂️ 开始剪辑';
    
    if (result.success) {
        showResult(`✅ 剪辑完成！<br>输出文件: ${result.outputPath}<br><span class="elapsed-time">⏱️ 耗时: ${elapsedTime} 秒</span>`, 'success');
    } else if (result.error === 'FILE_EXISTS') {
        // 文件已存在，显示确认弹窗
        showFileExistsModal(result.outputPath, result.fileName);
    } else {
        showResult(`❌ 剪辑失败: ${result.error}<br><small>${result.details || ''}</small>`, 'error');
    }
}

/**
 * 显示文件存在确认弹窗
 */
function showFileExistsModal(filePath, fileName) {
    state.fileExistsConfirm.existingPath = filePath;
    state.fileExistsConfirm.pendingClip = {
        inputPath: state.activeVideo.path,
        startTime: state.startTime,
        endTime: state.endTime,
        outputName: DOM.outputName.value || null,
        reEncode: DOM.reEncode.checked
    };
    
    DOM.existingFilePath.textContent = filePath;
    DOM.fileExistsModal.style.display = 'flex';
    DOM.resultPanel.style.display = 'none';
}

/**
 * 关闭文件存在确认弹窗
 */
function closeFileExistsModal() {
    DOM.fileExistsModal.style.display = 'none';
    state.fileExistsConfirm.pendingClip = null;
    state.fileExistsConfirm.existingPath = '';
}

/**
 * 处理文件存在 - 覆盖
 */
async function handleFileExistsOverwrite() {
    closeFileExistsModal();
    await doClip(true);  // 覆盖模式
}

/**
 * 处理文件存在 - 自动重命名
 */
async function handleFileExistsRename() {
    closeFileExistsModal();
    
    // 获取可用的文件名
    const result = await api('/api/get-available-name', {
        method: 'POST',
        body: {
            inputPath: state.activeVideo.path,
            outputName: DOM.outputName.value || `clip_${Date.now()}`
        }
    });
    
    if (result.success) {
        // 使用新文件名进行剪辑
        await doClip(false, result.baseName);
    } else {
        showResult(`❌ 获取可用文件名失败: ${result.error}`, 'error');
    }
}

/**
 * 处理文件存在 - 取消
 */
function handleFileExistsCancel() {
    closeFileExistsModal();
    showResult('已取消剪辑', 'info');
}

/**
 * 显示结果
 */
function showResult(message, type = 'info') {
    DOM.resultPanel.style.display = 'block';
    DOM.resultPanel.querySelector('.result-content')?.remove();
    
    const content = document.createElement('div');
    content.className = `result-content ${type}`;
    content.innerHTML = message;
    DOM.resultPanel.appendChild(content);
}

// ==================== 可折叠面板 ====================

/**
 * 切换面板折叠状态
 */
function toggleCollapse(panel) {
    if (!panel) return;
    panel.classList.toggle('collapsed');
}

// ==================== 视频合并 ====================

/**
 * 添加当前视频到合并列表
 */
async function addCurrentVideoToMerge() {
    if (!state.activeVideo) {
        showResult('⚠️ 请先选择一个视频', 'error');
        return;
    }
    
    // 检查是否已添加
    const exists = state.merge.videos.some(v => v.path === state.activeVideo.path);
    if (exists) {
        showResult('⚠️ 该视频已在合并列表中', 'error');
        return;
    }
    
    // 获取视频时长
    let duration = state.duration;
    if (!duration) {
        const result = await api(`/api/video-info?path=${encodeURIComponent(state.activeVideo.path)}`);
        if (result.success) {
            duration = result.duration || 0;
        }
    }
    
    state.merge.videos.push({
        path: state.activeVideo.path,
        name: state.activeVideo.name,
        duration: duration
    });
    
    updateMergeList();
    showResult(`✅ 已添加到合并列表 (${state.merge.videos.length} 个视频)`, 'success');
}

/**
 * 从合并列表移除视频
 */
function removeFromMerge(index) {
    state.merge.videos.splice(index, 1);
    updateMergeList();
}

/**
 * 清空合并列表
 */
function clearMergeList() {
    state.merge.videos = [];
    updateMergeList();
}

/**
 * 更新合并列表显示
 */
function updateMergeList() {
    if (!DOM.mergeList) return;
    
    if (state.merge.videos.length === 0) {
        DOM.mergeList.innerHTML = '<div class="merge-empty">尚未添加视频，请从左侧选择</div>';
    } else {
        DOM.mergeList.innerHTML = state.merge.videos.map((video, index) => `
            <div class="merge-item" draggable="true" data-index="${index}">
                <span class="merge-item-order">${index + 1}</span>
                <span class="merge-item-name" title="${video.path}">${video.name}</span>
                <span class="merge-item-duration">${formatTime(video.duration)}</span>
                <button class="merge-item-remove" data-index="${index}" title="移除">✕</button>
            </div>
        `).join('');
        
        // 绑定移除按钮事件
        DOM.mergeList.querySelectorAll('.merge-item-remove').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const index = parseInt(e.target.dataset.index);
                removeFromMerge(index);
            });
        });
        
        // 初始化拖拽排序
        initMergeDragSort();
    }
    
    // 更新合并按钮状态
    updateMergeButton();
}

/**
 * 初始化合并列表拖拽排序
 */
function initMergeDragSort() {
    const items = DOM.mergeList.querySelectorAll('.merge-item');
    let draggedItem = null;
    
    items.forEach(item => {
        item.addEventListener('dragstart', (e) => {
            draggedItem = item;
            item.classList.add('dragging');
            e.dataTransfer.effectAllowed = 'move';
        });
        
        item.addEventListener('dragend', () => {
            item.classList.remove('dragging');
            draggedItem = null;
        });
        
        item.addEventListener('dragover', (e) => {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
        });
        
        item.addEventListener('drop', (e) => {
            e.preventDefault();
            if (!draggedItem || draggedItem === item) return;
            
            const fromIndex = parseInt(draggedItem.dataset.index);
            const toIndex = parseInt(item.dataset.index);
            
            // 交换位置
            const temp = state.merge.videos[fromIndex];
            state.merge.videos.splice(fromIndex, 1);
            state.merge.videos.splice(toIndex, 0, temp);
            
            updateMergeList();
        });
    });
}

/**
 * 更新合并按钮状态
 */
function updateMergeButton() {
    if (!DOM.btnMerge || !DOM.mergeCount) return;
    
    const count = state.merge.videos.length;
    DOM.mergeCount.textContent = `(${count}/2)`;
    DOM.btnMerge.disabled = count < 2;
    
    if (count >= 2) {
        DOM.mergeCount.textContent = `(${count}个视频)`;
    }
}

/**
 * 执行视频合并
 */
async function doMerge() {
    if (state.merge.videos.length < 2) {
        showResult('⚠️ 至少需要选择2个视频进行合并', 'error');
        return;
    }
    
    // 禁用按钮
    DOM.btnMerge.disabled = true;
    DOM.btnMerge.innerHTML = '🔄 合并中...';
    
    showResult('🔄 正在合并视频...', 'info');
    
    try {
        const result = await api('/api/merge', {
            method: 'POST',
            body: {
                videos: state.merge.videos.map(v => v.path),
                outputName: DOM.mergeOutputName?.value || ''
            }
        });
        
        if (result.success) {
            showResult(`✅ 合并完成！输出文件：${result.outputPath}`, 'success');
            clearMergeList();
            if (DOM.mergeOutputName) {
                DOM.mergeOutputName.value = '';
            }
        } else {
            showResult(`❌ 合并失败：${result.error}`, 'error');
        }
    } catch (error) {
        showResult(`❌ 合并失败：${error.message}`, 'error');
    }
    
    // 恢复按钮
    DOM.btnMerge.innerHTML = '🔗 开始合并 <span id="mergeCount">(0/2)</span>';
    updateMergeButton();
}

// ==================== RTSP 推流 ====================

/**
 * 初始化 RTSP 功能
 */
async function initRtsp() {
    // 加载 RTSP 配置
    const config = await api('/api/rtsp/config');
    if (config.success) {
        if (DOM.settingMediamtxPath) DOM.settingMediamtxPath.value = config.mediamtxPath || '';
        if (DOM.settingRtspPort) DOM.settingRtspPort.value = config.rtspPort || 8554;
        if (DOM.settingStreamName) DOM.settingStreamName.value = config.streamName || 'live';
        updateRtspUrlPreview();
    }
    
    // 检查服务器和推流状态（处理页面刷新后的状态恢复）
    await checkRtspStreamStatus();
}

/**
 * 更新 RTSP 地址预览
 */
async function updateRtspUrlPreview() {
    const result = await api('/api/rtsp/local-ip');
    const ip = result.success ? result.ip : '127.0.0.1';
    const port = DOM.settingRtspPort?.value || 8554;
    const streamName = DOM.settingStreamName?.value || 'live';
    
    if (DOM.rtspUrlPreview) {
        DOM.rtspUrlPreview.textContent = `rtsp://${ip}:${port}/${streamName}`;
    }
}

/**
 * 检查 RTSP 服务器状态
 */
async function checkRtspServerStatus() {
    const result = await api('/api/rtsp/server/status');
    if (result.success) {
        state.rtsp.serverRunning = result.running;
        updateRtspUI();
    }
}

/**
 * 检查 RTSP 推流状态（用于页面刷新后恢复）
 */
async function checkRtspStreamStatus() {
    const result = await api('/api/rtsp/stream/status');
    if (result.success) {
        state.rtsp.serverRunning = result.serverRunning;
        state.rtsp.isStreaming = result.isStreaming;
        state.rtsp.currentTime = result.currentTime || 0;
        state.rtsp.rtspUrl = result.rtspUrl || '';
        
        // 如果有正在进行的推流，更新UI
        if (result.isStreaming) {
            // 显示 RTSP 面板
            if (DOM.rtspPanel) {
                DOM.rtspPanel.style.display = 'block';
            }
            if (DOM.rtspUrl && result.rtspUrl) {
                DOM.rtspUrl.value = result.rtspUrl;
            }
            // 开始轮询状态
            startRtspStatusPolling();
        }
        
        updateRtspUI();
    }
}

/**
 * 启动 RTSP 服务器
 */
async function startRtspServer() {
    const result = await api('/api/rtsp/server/start', { method: 'POST' });
    if (result.success) {
        state.rtsp.serverRunning = true;
        updateRtspUI();
        // 开始轮询状态
        startRtspStatusPolling();
    } else {
        showResult(`❌ RTSP 服务器启动失败: ${result.error}`, 'error');
    }
    return result.success;
}

/**
 * 停止 RTSP 服务器
 */
async function stopRtspServer() {
    await api('/api/rtsp/server/stop', { method: 'POST' });
    state.rtsp.serverRunning = false;
    state.rtsp.isStreaming = false;
    stopRtspStatusPolling();
    updateRtspUI();
}

/**
 * 开始推流
 */
async function startRtspStream() {
    if (!state.activeVideo) {
        showResult('⚠️ 请先选择视频', 'error');
        return;
    }
    
    // 检查是否配置了 MediaMTX
    const rtspConfig = await api('/api/rtsp/config');
    if (!rtspConfig.success || !rtspConfig.mediamtxPath) {
        showResult('⚠️ 请先在设置中配置 MediaMTX 路径', 'error');
        return;
    }
    
    // 如果服务器未启动，先启动
    if (!state.rtsp.serverRunning) {
        showResult('🔄 正在启动 RTSP 服务器...', 'info');
        const started = await startRtspServer();
        if (!started) return;
        // 等待服务器完全启动
        await new Promise(resolve => setTimeout(resolve, 2000));
    }
    
    // 获取推流选项
    const speed = DOM.rtspSpeed ? parseFloat(DOM.rtspSpeed.value) : 1;
    const useRange = DOM.rtspUseRange ? DOM.rtspUseRange.checked : false;
    const loop = DOM.rtspLoop ? DOM.rtspLoop.checked : false;
    
    // 确定开始时间和结束时间
    let startTime, endTime = 0;
    if (useRange) {
        // 使用剪辑范围
        startTime = state.startTime || 0;
        endTime = state.endTime || 0;
    } else {
        // 从当前播放位置开始
        startTime = state.videoSupported ? DOM.videoPlayer.currentTime : 0;
    }
    
    // 显示推流信息
    const speedStr = speed !== 1 ? ` (${speed}x)` : '';
    const loopStr = loop ? ' [循环]' : '';
    showResult(`🔄 正在启动推流...${speedStr}${loopStr}`, 'info');
    
    const result = await api('/api/rtsp/stream/start', {
        method: 'POST',
        body: {
            videoPath: state.activeVideo.path,
            startTime: startTime,
            endTime: endTime,
            speed: speed,
            loop: loop
        }
    });
    
    if (result.success) {
        state.rtsp.isStreaming = true;
        state.rtsp.rtspUrl = result.rtspUrl;
        state.rtsp.currentTime = startTime;
        state.rtsp.speed = speed;
        state.rtsp.loop = loop;
        
        if (DOM.rtspUrl) DOM.rtspUrl.value = result.rtspUrl;
        
        // 开始推流时自动播放视频预览
        if (state.videoSupported && DOM.videoPlayer.paused) {
            DOM.videoPlayer.play();
        }
        
        // 显示状态监控面板
        if (DOM.rtspStats) DOM.rtspStats.style.display = 'grid';
        
        // 开始轮询状态
        startRtspStatusPolling();
        updateRtspUI();
        
        const rangeInfo = useRange ? `<br>区间: ${formatTime(startTime)} -> ${formatTime(endTime)}` : '';
        showResult(`✅ 推流已开始${speedStr}${loopStr}<br>地址: <code>${result.rtspUrl}</code>${rangeInfo}<br><small>可用 VLC 或 PotPlayer 打开</small>`, 'success');
    } else {
        state.rtsp.isStreaming = false;
        updateRtspUI();
        showResult(`❌ 推流失败: ${result.error}<br><small>请检查日志获取详细信息</small>`, 'error');
    }
}

/**
 * 同步推流到当前预览时间（会重启FFmpeg，但保留速度、循环等选项）
 */
async function syncRtspToCurrentTime() {
    if (!state.rtsp.isStreaming || !state.activeVideo) {
        showResult('⚠️ 当前没有正在进行的推流', 'error');
        return;
    }
    
    const currentTime = state.videoSupported ? DOM.videoPlayer.currentTime : 0;
    
    // 获取当前的推流选项（保留之前的设置）
    const speed = DOM.rtspSpeed ? parseFloat(DOM.rtspSpeed.value) : (state.rtsp.speed || 1);
    const loop = DOM.rtspLoop ? DOM.rtspLoop.checked : (state.rtsp.loop || false);
    
    showResult('🔄 正在同步推流时间...', 'info');
    
    // 重新开始推流到当前时间点，保留速度和循环设置
    const result = await api('/api/rtsp/stream/start', {
        method: 'POST',
        body: {
            videoPath: state.activeVideo.path,
            startTime: currentTime,
            speed: speed,
            loop: loop
        }
    });
    
    if (result.success) {
        state.rtsp.currentTime = currentTime;
        updateRtspUI();
        showResult(`✅ 已同步到 ${formatTime(currentTime)}<br><small>播放器可能需要几秒钟重新连接</small>`, 'success');
    } else {
        showResult(`❌ 同步失败: ${result.error}`, 'error');
    }
}

/**
 * 停止推流
 */
async function stopRtspStream() {
    await api('/api/rtsp/stream/stop', { method: 'POST' });
    state.rtsp.isStreaming = false;
    state.rtsp.isPaused = false;
    state.rtsp.loopCount = 0;
    
    // 隐藏统计面板
    if (DOM.rtspStats) DOM.rtspStats.style.display = 'none';
    // 清空循环计数
    if (DOM.rtspLoopCount) DOM.rtspLoopCount.textContent = '';
    
    updateRtspUI();
}

/**
 * 更新推流区间显示
 */
function updateRtspRangeDisplay() {
    if (!DOM.rtspRangeDisplay) return;
    
    if (DOM.rtspUseRange && DOM.rtspUseRange.checked) {
        const start = formatTime(state.startTime || 0);
        const end = formatTime(state.endTime || state.duration || 0);
        DOM.rtspRangeDisplay.textContent = `${start} → ${end}`;
    } else {
        DOM.rtspRangeDisplay.textContent = '';
    }
}

/**
 * 开始轮询 RTSP 状态
 */
function startRtspStatusPolling() {
    if (state.rtsp.statusPollInterval) return;
    
    state.rtsp.statusPollInterval = setInterval(async () => {
        const result = await api('/api/rtsp/stream/status');
        if (result.success) {
            state.rtsp.serverRunning = result.serverRunning;
            state.rtsp.isStreaming = result.isStreaming;
            state.rtsp.isPaused = result.isPaused;
            state.rtsp.currentTime = result.currentTime;
            
            // 更新推流选项状态
            if (result.options) {
                state.rtsp.speed = result.options.speed;
                state.rtsp.loop = result.options.loop;
                state.rtsp.loopCount = result.options.loopCount;
            }
            
            if (result.rtspUrl && DOM.rtspUrl) {
                DOM.rtspUrl.value = result.rtspUrl;
            }
            
            // 更新统计信息
            if (result.stats && result.isStreaming) {
                updateRtspStats(result.stats);
            }
            
            // 更新循环计数
            if (DOM.rtspLoopCount && result.options && result.options.loop) {
                DOM.rtspLoopCount.textContent = result.options.loopCount > 0 
                    ? `已循环 ${result.options.loopCount} 次` 
                    : '';
            }
            
            updateRtspUI();
            
            // 如果推流已结束，停止轮询
            if (!result.isStreaming && !result.serverRunning) {
                stopRtspStatusPolling();
                // 隐藏统计面板
                if (DOM.rtspStats) DOM.rtspStats.style.display = 'none';
            }
        }
    }, 1000);
}

/**
 * 更新推流统计信息显示
 */
function updateRtspStats(stats) {
    if (DOM.statFps) {
        DOM.statFps.textContent = `${stats.fps.toFixed(1)} fps`;
    }
    if (DOM.statBitrate) {
        DOM.statBitrate.textContent = stats.bitrate > 1000 
            ? `${(stats.bitrate / 1000).toFixed(1)} Mbps`
            : `${stats.bitrate.toFixed(0)} kbps`;
    }
    if (DOM.statFrames) {
        DOM.statFrames.textContent = stats.frames > 1000 
            ? `${(stats.frames / 1000).toFixed(1)}k 帧`
            : `${stats.frames} 帧`;
    }
    if (DOM.statDropped) {
        DOM.statDropped.textContent = stats.droppedFrames.toString();
        // 丢帧超过10帧显示警告颜色
        DOM.statDropped.classList.toggle('warning', stats.droppedFrames > 10);
    }
    if (DOM.statSpeed) {
        // 显示用户设定的倍速，而不是FFmpeg报告的实际处理速度
        // 因为使用 realtime 滤镜后，FFmpeg报告的速度总是约1x
        DOM.statSpeed.textContent = `${state.rtsp.speed || 1}x`;
    }
    if (DOM.statSize) {
        const sizeMB = stats.size / (1024 * 1024);
        DOM.statSize.textContent = sizeMB > 1000 
            ? `${(sizeMB / 1024).toFixed(2)} GB`
            : `${sizeMB.toFixed(1)} MB`;
    }
}

/**
 * 停止轮询 RTSP 状态
 */
function stopRtspStatusPolling() {
    if (state.rtsp.statusPollInterval) {
        clearInterval(state.rtsp.statusPollInterval);
        state.rtsp.statusPollInterval = null;
    }
}

/**
 * 更新 RTSP UI
 */
function updateRtspUI() {
    // 更新状态指示器
    if (DOM.rtspStatusDot) {
        DOM.rtspStatusDot.className = 'status-dot';
        if (state.rtsp.isStreaming) {
            DOM.rtspStatusDot.classList.add('streaming');
            if (DOM.rtspStatusText) DOM.rtspStatusText.textContent = '推流中';
        } else if (state.rtsp.serverRunning) {
            if (DOM.rtspStatusText) DOM.rtspStatusText.textContent = '服务就绪';
        } else {
            if (DOM.rtspStatusText) DOM.rtspStatusText.textContent = '未连接';
        }
    }
    
    // 更新时间显示
    if (DOM.rtspCurrentTime) {
        DOM.rtspCurrentTime.textContent = formatTime(state.rtsp.currentTime);
    }
    if (DOM.rtspTotalTime) {
        DOM.rtspTotalTime.textContent = formatTime(state.duration || 0);
    }
    
    // 更新按钮状态
    if (DOM.btnStartStream) {
        const btnText = DOM.btnStartStream.querySelector('.btn-text');
        const btnIcon = DOM.btnStartStream.querySelector('.btn-icon');
        
        if (state.rtsp.isStreaming) {
            DOM.btnStartStream.classList.add('active');
            if (btnText) btnText.textContent = '推流中';
            if (btnIcon) btnIcon.textContent = '📡';
            // 推流中时仍然允许点击（用于重新开始）
            DOM.btnStartStream.disabled = false;
        } else {
            DOM.btnStartStream.classList.remove('active');
            if (btnText) btnText.textContent = '开始推流';
            if (btnIcon) btnIcon.textContent = '▶';
            // 未选择视频时禁用
            DOM.btnStartStream.disabled = !state.activeVideo;
        }
    }
    
    if (DOM.btnSyncStream) {
        DOM.btnSyncStream.disabled = !state.rtsp.isStreaming;
    }
    
    if (DOM.btnStopStream) {
        DOM.btnStopStream.disabled = !state.rtsp.isStreaming;
    }
    
    // 更新同步状态
    updateSyncStatus();
}

/**
 * 更新同步状态显示
 */
function updateSyncStatus() {
    if (!DOM.syncStatus) return;
    
    const syncIcon = DOM.syncStatus.querySelector('.sync-icon');
    const syncText = DOM.syncStatus.querySelector('.sync-text');
    
    if (!syncIcon || !syncText) return;
    
    if (!state.rtsp.isStreaming) {
        DOM.syncStatus.className = 'sync-status';
        syncIcon.textContent = '📡';
        syncText.textContent = '未推流';
        return;
    }
    
    // 计算与视频预览的时间差
    const previewTime = state.videoSupported ? state.currentTime : 0;
    const timeDiff = Math.abs(previewTime - state.rtsp.currentTime);
    
    if (timeDiff < 3) {
        DOM.syncStatus.className = 'sync-status synced';
        syncIcon.textContent = '✓';
        syncText.textContent = '时间一致';
    } else {
        DOM.syncStatus.className = 'sync-status';
        syncIcon.textContent = '📍';
        syncText.textContent = `差异 ${timeDiff.toFixed(0)}s`;
    }
}

/**
 * 复制 RTSP 地址
 */
async function copyRtspUrl() {
    const url = DOM.rtspUrl?.value;
    if (!url) return;
    
    try {
        await navigator.clipboard.writeText(url);
        DOM.btnCopyRtspUrl.classList.add('copied');
        DOM.btnCopyRtspUrl.textContent = '✓';
        
        setTimeout(() => {
            DOM.btnCopyRtspUrl.classList.remove('copied');
            DOM.btnCopyRtspUrl.textContent = '📋';
        }, 2000);
    } catch (e) {
        // 回退方案
        DOM.rtspUrl.select();
        document.execCommand('copy');
    }
}

// ==================== 批量转封装 ====================

/**
 * 开始批量转封装
 */
async function startBatchConvert() {
    if (!state.currentPath) {
        showResult('⚠️ 请先进入一个文件夹', 'error');
        return;
    }
    
    // 确认对话框
    const confirmed = confirm(`确定要转封装文件夹中的视频吗？\n\n路径: ${state.currentPath}\n\n这将会：\n1. 扫描文件夹中需要转换的视频\n2. 转封装并替换原文件\n3. 转换后的视频可直接在浏览器中播放`);
    
    if (!confirmed) return;
    
    showResult('🔄 正在扫描文件夹...', 'info');
    DOM.btnBatchConvert.disabled = true;
    DOM.btnBatchConvert.textContent = '⏳ 处理中';
    
    const result = await api('/api/batch-convert', {
        method: 'POST',
        body: { folderPath: state.currentPath }
    });
    
    if (result.success) {
        if (result.count === 0) {
            showResult('✅ 没有需要转换的视频文件', 'success');
            DOM.btnBatchConvert.disabled = false;
            DOM.btnBatchConvert.textContent = '⚡ 转封装';
        } else {
            showResult(`🔄 开始转换 ${result.count} 个视频...`, 'info');
            // 开始轮询状态
            pollBatchConvertStatus();
        }
    } else {
        showResult(`❌ ${result.error}`, 'error');
        DOM.btnBatchConvert.disabled = false;
        DOM.btnBatchConvert.textContent = '⚡ 转封装';
    }
}

/**
 * 轮询批量转换状态
 */
async function pollBatchConvertStatus() {
    const result = await api('/api/batch-convert-status');
    
    if (result.success) {
        if (result.isRunning) {
            const progress = result.completed + result.failed;
            showResult(
                `🔄 正在转换: ${result.current}<br>` +
                `进度: ${progress}/${result.total} (成功: ${result.completed}, 跳过: ${result.failed})`,
                'info'
            );
            setTimeout(pollBatchConvertStatus, 1000);
        } else {
            // 完成
            showResult(
                `✅ 批量转换完成！<br>` +
                `成功: ${result.completed}, 跳过: ${result.failed}`,
                'success'
            );
            DOM.btnBatchConvert.disabled = false;
            DOM.btnBatchConvert.textContent = '⚡ 转封装';
            // 刷新文件列表
            loadDirectory(state.currentPath);
        }
    } else {
        DOM.btnBatchConvert.disabled = false;
        DOM.btnBatchConvert.textContent = '⚡ 转封装';
    }
}

// ==================== 文件选择弹窗 ====================

/**
 * 打开文件选择弹窗
 */
function openFileBrowser(options) {
    const { mode = 'file', title = '选择文件', filter = null, callback } = options;
    
    state.fileBrowser = {
        isOpen: true,
        mode,
        currentPath: '',
        selectedPath: '',
        callback,
        filter
    };
    
    DOM.fileBrowserTitle.textContent = title;
    DOM.modalSelectedPath.textContent = '';
    DOM.fileBrowserModal.style.display = 'flex';
    
    // 加载根目录
    loadDirectory('', DOM.modalFileList, true);
}

/**
 * 关闭文件选择弹窗
 */
function closeFileBrowser() {
    state.fileBrowser.isOpen = false;
    DOM.fileBrowserModal.style.display = 'none';
}

/**
 * 确认文件选择
 */
function confirmFileBrowserSelection() {
    const { selectedPath, mode, callback } = state.fileBrowser;
    
    // 如果是目录模式，使用当前路径
    const finalPath = mode === 'directory' ? state.fileBrowser.currentPath : selectedPath;
    
    if (finalPath && callback) {
        callback(finalPath);
    }
    
    closeFileBrowser();
}

// ==================== 设置 ====================

/**
 * 加载设置
 */
async function loadSettings() {
    const result = await api('/api/config');
    if (result.ffmpegPath) DOM.settingFfmpegPath.value = result.ffmpegPath;
    if (result.outputDir) DOM.settingOutputDir.value = result.outputDir;
    
    // 加载 RTSP 设置
    const rtspConfig = await api('/api/rtsp/config');
    if (rtspConfig.success) {
        if (DOM.settingMediamtxPath) DOM.settingMediamtxPath.value = rtspConfig.mediamtxPath || '';
        if (DOM.settingRtspPort) DOM.settingRtspPort.value = rtspConfig.rtspPort || 8554;
        if (DOM.settingStreamName) DOM.settingStreamName.value = rtspConfig.streamName || 'live';
        updateRtspUrlPreview();
    }
}

/**
 * 保存设置
 */
async function saveSettings() {
    // 保存基本设置
    const result = await api('/api/config', {
        method: 'POST',
        body: {
            ffmpegPath: DOM.settingFfmpegPath.value,
            outputDir: DOM.settingOutputDir.value
        }
    });
    
    // 保存 RTSP 设置
    await api('/api/rtsp/config', {
        method: 'POST',
        body: {
            mediamtxPath: DOM.settingMediamtxPath?.value || '',
            rtspPort: parseInt(DOM.settingRtspPort?.value) || 8554,
            streamName: DOM.settingStreamName?.value || 'live'
        }
    });
    
    if (result.success) {
        DOM.settingsModal.style.display = 'none';
    }
}

/**
 * 测试FFmpeg
 */
async function testFfmpeg() {
    DOM.ffmpegTestResult.textContent = '测试中...';
    DOM.ffmpegTestResult.className = '';
    
    // 临时保存当前路径进行测试
    await api('/api/config', {
        method: 'POST',
        body: { ffmpegPath: DOM.settingFfmpegPath.value }
    });
    
    const result = await api('/api/test-ffmpeg');
    
    if (result.success) {
        DOM.ffmpegTestResult.textContent = `✓ 版本: ${result.version}`;
        DOM.ffmpegTestResult.className = 'success';
    } else {
        DOM.ffmpegTestResult.textContent = `✗ ${result.error}`;
        DOM.ffmpegTestResult.className = 'error';
    }
}

// ==================== 事件绑定 ====================

function bindEvents() {
    // 路径导航
    DOM.btnBack.addEventListener('click', () => {
        const parent = state.currentPath.split(/[/\\]/).slice(0, -1).join('\\');
        loadDirectory(parent || '');
    });
    
    DOM.btnGo.addEventListener('click', () => {
        loadDirectory(DOM.currentPath.value);
    });
    
    // 批量转封装
    DOM.btnBatchConvert.addEventListener('click', startBatchConvert);
    
    // 关闭视频
    DOM.btnCloseVideo.addEventListener('click', closeVideo);
    
    DOM.currentPath.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') loadDirectory(DOM.currentPath.value);
    });
    
    DOM.btnRefresh.addEventListener('click', () => {
        loadDirectory(state.currentPath);
    });
    
    // 视频播放事件
    DOM.videoPlayer.addEventListener('timeupdate', onVideoTimeUpdate);
    
    // 全局键盘控制：空格播放/暂停，左右键快进/后退
    document.addEventListener('keydown', (e) => {
        // 如果焦点在输入框中，不响应这些快捷键
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') {
            return;
        }
        
        // 空格键：播放/暂停
        if (e.code === 'Space' && state.videoSupported) {
            e.preventDefault();
            if (DOM.videoPlayer.paused) {
                DOM.videoPlayer.play();
            } else {
                DOM.videoPlayer.pause();
            }
        }
        
        // 左箭头：后退10秒
        if (e.code === 'ArrowLeft' && state.videoSupported) {
            e.preventDefault();
            DOM.videoPlayer.currentTime = Math.max(0, DOM.videoPlayer.currentTime - 10);
        }
        
        // 右箭头：前进10秒
        if (e.code === 'ArrowRight' && state.videoSupported) {
            e.preventDefault();
            DOM.videoPlayer.currentTime = Math.min(state.duration, DOM.videoPlayer.currentTime + 10);
        }
    });
    
    // 时间输入 - 允许自由输入，不做实时校验（只在剪辑时校验）
    DOM.inputStartTime.addEventListener('change', () => {
        const time = parseTime(DOM.inputStartTime.value);
        if (time !== null && time >= 0) {
            state.startTime = Math.min(time, state.duration);
            updateTimeline();
        } else {
            DOM.inputStartTime.value = formatTime(state.startTime);
        }
    });
    
    DOM.inputEndTime.addEventListener('change', () => {
        const time = parseTime(DOM.inputEndTime.value);
        if (time !== null && time >= 0) {
            state.endTime = Math.min(time, state.duration);
            updateTimeline();
        } else {
            DOM.inputEndTime.value = formatTime(state.endTime);
        }
    });
    
    // 使用当前播放位置
    DOM.btnUseCurrentStart.addEventListener('click', () => {
        if (state.videoSupported && state.currentTime < state.endTime) {
            state.startTime = state.currentTime;
            updateTimeline();
        }
    });
    
    DOM.btnUseCurrentEnd.addEventListener('click', () => {
        if (state.videoSupported && state.currentTime > state.startTime) {
            state.endTime = state.currentTime;
            updateTimeline();
        }
    });
    
    // 快捷预览按钮
    DOM.btnPreviewStart.addEventListener('click', () => {
        if (state.videoSupported) {
            DOM.videoPlayer.currentTime = state.startTime;
            DOM.videoPlayer.play();
        }
    });
    
    DOM.btnPreviewEnd.addEventListener('click', () => {
        if (state.videoSupported) {
            DOM.videoPlayer.currentTime = Math.max(0, state.endTime - 3);
            DOM.videoPlayer.play();
        }
    });
    
    DOM.btnPreviewClip.addEventListener('click', () => {
        if (state.videoSupported) {
            DOM.videoPlayer.currentTime = state.startTime;
            DOM.videoPlayer.play();
            
            // 播放到结束点时暂停
            const checkEnd = () => {
                if (DOM.videoPlayer.currentTime >= state.endTime) {
                    DOM.videoPlayer.pause();
                    DOM.videoPlayer.removeEventListener('timeupdate', checkEnd);
                }
            };
            DOM.videoPlayer.addEventListener('timeupdate', checkEnd);
        }
    });
    
    // 剪辑按钮
    DOM.btnClip.addEventListener('click', () => doClip());
    
    // 设置
    DOM.btnSettings.addEventListener('click', () => {
        loadSettings();
        DOM.settingsModal.style.display = 'flex';
    });
    
    DOM.btnCloseSettings.addEventListener('click', () => {
        DOM.settingsModal.style.display = 'none';
    });
    
    DOM.btnSaveSettings.addEventListener('click', saveSettings);
    DOM.btnTestFfmpeg.addEventListener('click', testFfmpeg);
    
    // 浏览FFmpeg路径
    DOM.btnBrowseFfmpeg.addEventListener('click', () => {
        openFileBrowser({
            mode: 'file',
            title: '📂 选择 ffmpeg.exe',
            filter: (item) => item.name.match(/ffmpeg\.exe$/i),
            callback: (path) => {
                DOM.settingFfmpegPath.value = path;
            }
        });
    });
    
    // 浏览输出目录
    DOM.btnBrowseOutput.addEventListener('click', () => {
        openFileBrowser({
            mode: 'directory',
            title: '📂 选择输出目录',
            callback: (path) => {
                DOM.settingOutputDir.value = path;
            }
        });
    });
    
    // 文件选择弹窗
    DOM.btnCloseFileBrowser.addEventListener('click', closeFileBrowser);
    DOM.btnCancelFileBrowser.addEventListener('click', closeFileBrowser);
    DOM.btnConfirmFileBrowser.addEventListener('click', confirmFileBrowserSelection);
    
    DOM.btnModalBack.addEventListener('click', () => {
        const parent = state.fileBrowser.currentPath.split(/[/\\]/).slice(0, -1).join('\\');
        loadDirectory(parent || '', DOM.modalFileList, true);
    });
    
    // 点击遮罩关闭弹窗
    DOM.settingsModal.addEventListener('click', (e) => {
        if (e.target === DOM.settingsModal) {
            DOM.settingsModal.style.display = 'none';
        }
    });
    
    DOM.fileBrowserModal.addEventListener('click', (e) => {
        if (e.target === DOM.fileBrowserModal) {
            closeFileBrowser();
        }
    });
    
    // 打开输出目录
    DOM.btnOpenOutput.addEventListener('click', async () => {
        await api('/api/open-output');
    });
    
    // 文件存在确认弹窗
    DOM.btnCloseFileExists.addEventListener('click', handleFileExistsCancel);
    DOM.btnFileExistsCancel.addEventListener('click', handleFileExistsCancel);
    DOM.btnFileExistsOverwrite.addEventListener('click', handleFileExistsOverwrite);
    DOM.btnFileExistsRename.addEventListener('click', handleFileExistsRename);
    
    DOM.fileExistsModal.addEventListener('click', (e) => {
        if (e.target === DOM.fileExistsModal) {
            handleFileExistsCancel();
        }
    });
    
    // RTSP 推流控制
    if (DOM.btnStartStream) {
        DOM.btnStartStream.addEventListener('click', async () => {
            // 如果已经在推流，先停止再开始（重新开始）
            if (state.rtsp.isStreaming) {
                await stopRtspStream();
                await new Promise(resolve => setTimeout(resolve, 500));
            }
            await startRtspStream();
        });
    }
    
    if (DOM.btnSyncStream) {
        DOM.btnSyncStream.addEventListener('click', syncRtspToCurrentTime);
    }
    
    if (DOM.btnStopStream) {
        DOM.btnStopStream.addEventListener('click', stopRtspStream);
    }
    
    if (DOM.btnCopyRtspUrl) {
        DOM.btnCopyRtspUrl.addEventListener('click', copyRtspUrl);
    }
    
    // RTSP 推流选项
    if (DOM.rtspSpeed) {
        DOM.rtspSpeed.addEventListener('change', () => {
            const speed = parseFloat(DOM.rtspSpeed.value);
            if (DOM.speedHint) {
                if (speed !== 1) {
                    DOM.speedHint.textContent = '需重新编码';
                    DOM.speedHint.classList.add('warning');
                } else {
                    DOM.speedHint.textContent = '';
                    DOM.speedHint.classList.remove('warning');
                }
            }
        });
    }
    
    if (DOM.rtspUseRange) {
        DOM.rtspUseRange.addEventListener('change', () => {
            updateRtspRangeDisplay();
        });
    }
    
    // RTSP 设置 - MediaMTX 路径选择
    if (DOM.btnBrowseMediamtx) {
        DOM.btnBrowseMediamtx.addEventListener('click', () => {
            openFileBrowser({
                mode: 'file',
                title: '📂 选择 mediamtx.exe',
                filter: (item) => item.name.match(/mediamtx(\.exe)?$/i),
                callback: (path) => {
                    DOM.settingMediamtxPath.value = path;
                }
            });
        });
    }
    
    // RTSP 端口和路径名变化时更新预览
    if (DOM.settingRtspPort) {
        DOM.settingRtspPort.addEventListener('input', updateRtspUrlPreview);
    }
    if (DOM.settingStreamName) {
        DOM.settingStreamName.addEventListener('input', updateRtspUrlPreview);
    }
    
    // 可折叠面板
    if (DOM.clipPanelHeader) {
        DOM.clipPanelHeader.addEventListener('click', (e) => {
            if (e.target.closest('.btn-collapse') || e.target === DOM.clipPanelHeader || e.target.tagName === 'H3') {
                toggleCollapse(DOM.clipPanel);
            }
        });
    }
    
    if (DOM.mergePanelHeader) {
        DOM.mergePanelHeader.addEventListener('click', (e) => {
            if (e.target.closest('.btn-collapse') || e.target === DOM.mergePanelHeader || e.target.tagName === 'H3') {
                toggleCollapse(DOM.mergePanel);
            }
        });
    }
    
    if (DOM.rtspPanelHeader) {
        DOM.rtspPanelHeader.addEventListener('click', (e) => {
            // 不在状态指示器和按钮上点击时才折叠
            if (e.target.closest('.btn-collapse') || e.target === DOM.rtspPanelHeader || e.target.tagName === 'H3') {
                toggleCollapse(DOM.rtspPanel);
            }
        });
    }
    
    // 视频合并功能
    if (DOM.btnAddToMerge) {
        DOM.btnAddToMerge.addEventListener('click', addCurrentVideoToMerge);
    }
    
    if (DOM.btnClearMerge) {
        DOM.btnClearMerge.addEventListener('click', clearMergeList);
    }
    
    if (DOM.btnMerge) {
        DOM.btnMerge.addEventListener('click', doMerge);
    }
}

// ==================== 初始化 ====================

async function init() {
    // 绑定事件
    bindEvents();
    
    // 初始化时间轴拖拽
    initTimelineDrag();
    
    // 初始化 RTSP 功能
    await initRtsp();
    
    // 读取配置，获取上次浏览的路径
    const config = await api('/api/config');
    const lastBrowsePath = config.lastBrowsePath || '';
    
    // 加载上次浏览的目录（如果存在），否则加载根目录
    loadDirectory(lastBrowsePath);
    
    // 测试ffmpeg可用性
    const testResult = await api('/api/test-ffmpeg');
    if (!testResult.success) {
        showResult('⚠️ FFmpeg 未配置或不可用，请点击右上角设置按钮配置 FFmpeg 路径', 'error');
    }
    
    // 页面关闭/刷新时停止转码进程和推流
    window.addEventListener('beforeunload', () => {
        if (state.videoSessionId) {
            // 使用 sendBeacon 确保请求能发出
            const data = new Blob([JSON.stringify({ sessionId: state.videoSessionId })], { type: 'application/json' });
            navigator.sendBeacon('/api/stop-transcode', data);
        }
        
        // 停止 RTSP 推流
        if (state.rtsp.isStreaming) {
            navigator.sendBeacon('/api/rtsp/stream/stop', new Blob(['{}'], { type: 'application/json' }));
        }
    });
}

// 启动
init();
