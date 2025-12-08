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
    DOM.timelinePanel.style.display = 'none';
    DOM.resultPanel.style.display = 'none';
    
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
    
    // 时间轴
    timelinePanel: document.getElementById('timelinePanel'),
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
    btnCloseVideo: document.getElementById('btnCloseVideo')
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
    DOM.timelinePanel.style.display = 'none';
    DOM.resultPanel.style.display = 'none';
    
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
        DOM.timelinePanel.style.display = 'block';
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
        DOM.timelinePanel.style.display = 'block';
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
    
    // 更新选区
    DOM.timelineSelection.style.left = `${startPercent}%`;
    DOM.timelineSelection.style.right = `${100 - endPercent}%`;
    
    // 更新标签
    DOM.labelStart.textContent = formatTime(state.startTime);
    DOM.labelEnd.textContent = formatTime(state.endTime);
    
    // 更新输入框
    DOM.inputStartTime.value = formatTime(state.startTime);
    DOM.inputEndTime.value = formatTime(state.endTime);
    
    // 更新片段时长
    DOM.clipDuration.textContent = formatTime(state.endTime - state.startTime);
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
}

/**
 * 保存设置
 */
async function saveSettings() {
    const result = await api('/api/config', {
        method: 'POST',
        body: {
            ffmpegPath: DOM.settingFfmpegPath.value,
            outputDir: DOM.settingOutputDir.value
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
    
    // 空格键控制播放/暂停
    document.addEventListener('keydown', (e) => {
        // 如果焦点在输入框中，不响应空格
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') {
            return;
        }
        
        if (e.code === 'Space' && state.videoSupported) {
            e.preventDefault();
            if (DOM.videoPlayer.paused) {
                DOM.videoPlayer.play();
            } else {
                DOM.videoPlayer.pause();
            }
        }
    });
    
    // 时间输入 - 直接响应回车和失焦
    DOM.inputStartTime.addEventListener('change', () => {
        const time = parseTime(DOM.inputStartTime.value);
        if (time !== null && time >= 0 && time < state.endTime) {
            state.startTime = time;
            updateTimeline();
        } else {
            DOM.inputStartTime.value = formatTime(state.startTime);
        }
    });
    
    DOM.inputEndTime.addEventListener('change', () => {
        const time = parseTime(DOM.inputEndTime.value);
        if (time !== null && time > state.startTime && time <= state.duration) {
            state.endTime = time;
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
}

// ==================== 初始化 ====================

async function init() {
    // 绑定事件
    bindEvents();
    
    // 初始化时间轴拖拽
    initTimelineDrag();
    
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
    
    // 页面关闭/刷新时停止转码进程
    window.addEventListener('beforeunload', () => {
        if (state.videoSessionId) {
            // 使用 sendBeacon 确保请求能发出
            const data = new Blob([JSON.stringify({ sessionId: state.videoSessionId })], { type: 'application/json' });
            navigator.sendBeacon('/api/stop-transcode', data);
        }
    });
}

// 启动
init();
