/**
 * 视频剪辑工具 - 后端服务
 * 功能：提供文件浏览、视频流、视频信息获取、视频剪辑等API
 */

const express = require('express');
const path = require('path');
const fs = require('fs');
const { exec, spawn } = require('child_process');
const os = require('os');

const app = express();
const PORT = 3000;

// 中间件配置
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// 配置文件路径
const CONFIG_FILE = path.join(__dirname, 'config.json');

/**
 * 获取配置（ffmpeg路径等）
 */
function getConfig() {
    try {
        if (fs.existsSync(CONFIG_FILE)) {
            return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf-8'));
        }
    } catch (e) {
        console.error('读取配置失败:', e.message);
    }
    // 默认配置
    return {
        ffmpegPath: 'ffmpeg',  // 默认使用系统PATH中的ffmpeg
        outputDir: path.join(__dirname, 'output')
    };
}

/**
 * 保存配置
 */
function saveConfig(config) {
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
}

/**
 * 确保输出目录存在
 */
function ensureOutputDir() {
    const config = getConfig();
    if (!fs.existsSync(config.outputDir)) {
        fs.mkdirSync(config.outputDir, { recursive: true });
    }
    return config.outputDir;
}

// ==================== API 路由 ====================

/**
 * 获取当前配置
 */
app.get('/api/config', (req, res) => {
    res.json(getConfig());
});

/**
 * 更新配置
 */
app.post('/api/config', (req, res) => {
    const { ffmpegPath, outputDir, lastBrowsePath } = req.body;
    const config = getConfig();
    
    if (ffmpegPath) config.ffmpegPath = ffmpegPath;
    if (outputDir) config.outputDir = outputDir;
    if (lastBrowsePath !== undefined) config.lastBrowsePath = lastBrowsePath;
    
    saveConfig(config);
    res.json({ success: true, config });
});

/**
 * 保存上次浏览路径（轻量级接口）
 */
app.post('/api/save-browse-path', (req, res) => {
    const { path: browsePath } = req.body;
    const config = getConfig();
    
    config.lastBrowsePath = browsePath || '';
    saveConfig(config);
    
    res.json({ success: true });
});

/**
 * 测试ffmpeg是否可用
 */
app.get('/api/test-ffmpeg', (req, res) => {
    const config = getConfig();
    const ffmpegPath = config.ffmpegPath || 'ffmpeg';
    
    exec(`"${ffmpegPath}" -version`, (error, stdout, stderr) => {
        if (error) {
            res.json({ 
                success: false, 
                error: `无法运行ffmpeg: ${error.message}`,
                suggestion: '请检查ffmpeg路径是否正确'
            });
            return;
        }
        
        // 解析版本信息
        const versionMatch = stdout.match(/ffmpeg version ([^\s]+)/);
        const version = versionMatch ? versionMatch[1] : 'unknown';
        
        res.json({ 
            success: true, 
            version,
            path: ffmpegPath,
            output: stdout.split('\n').slice(0, 3).join('\n')
        });
    });
});

/**
 * 浏览文件夹
 */
app.get('/api/browse', (req, res) => {
    let dirPath = req.query.path || '';
    
    // 如果没有提供路径，返回驱动器列表（Windows）或根目录（Linux/Mac）
    if (!dirPath) {
        if (os.platform() === 'win32') {
            // Windows: 获取驱动器列表
            exec('wmic logicaldisk get name', (error, stdout) => {
                if (error) {
                    res.json({ success: false, error: error.message });
                    return;
                }
                const drives = stdout.split('\n')
                    .map(line => line.trim())
                    .filter(line => /^[A-Z]:$/.test(line))
                    .map(drive => ({
                        name: drive,
                        path: drive + '\\',
                        isDirectory: true,
                        isDrive: true
                    }));
                res.json({ success: true, path: '', items: drives, isRoot: true });
            });
            return;
        } else {
            dirPath = '/';
        }
    }
    
    // 规范化路径
    dirPath = path.normalize(dirPath);
    
    try {
        if (!fs.existsSync(dirPath)) {
            res.json({ success: false, error: '路径不存在' });
            return;
        }
        
        const stats = fs.statSync(dirPath);
        if (!stats.isDirectory()) {
            res.json({ success: false, error: '不是文件夹' });
            return;
        }
        
        const items = fs.readdirSync(dirPath).map(name => {
            const fullPath = path.join(dirPath, name);
            try {
                const itemStats = fs.statSync(fullPath);
                const isVideo = /\.(mp4|avi|mkv|mov|wmv|flv|webm|mpeg|mpg|m4v|ts)$/i.test(name);
                return {
                    name,
                    path: fullPath,
                    isDirectory: itemStats.isDirectory(),
                    isVideo,
                    size: itemStats.size,
                    mtime: itemStats.mtime
                };
            } catch (e) {
                return null; // 无法访问的文件
            }
        }).filter(item => item !== null);
        
        // 排序：文件夹在前，然后按名称排序
        items.sort((a, b) => {
            if (a.isDirectory && !b.isDirectory) return -1;
            if (!a.isDirectory && b.isDirectory) return 1;
            return a.name.localeCompare(b.name);
        });
        
        res.json({ 
            success: true, 
            path: dirPath,
            parent: path.dirname(dirPath),
            items 
        });
    } catch (e) {
        res.json({ success: false, error: e.message });
    }
});

// ==================== 视频转码管理 ====================

// 临时文件目录
const TEMP_DIR = path.join(__dirname, 'temp');

// 确保临时目录存在
if (!fs.existsSync(TEMP_DIR)) {
    fs.mkdirSync(TEMP_DIR, { recursive: true });
}

// 已转码的临时文件 { sessionId: { tempPath, originalPath, createTime } }
const transcodedFiles = new Map();

// 正在转码的进程 { sessionId: { process, tempPath } }
const activeTranscodes = new Map();

// 清理超时的临时文件（5分钟未使用）
const TEMP_FILE_TIMEOUT = 5 * 60 * 1000;

setInterval(() => {
    const now = Date.now();
    for (const [sessionId, info] of transcodedFiles) {
        if (now - info.createTime > TEMP_FILE_TIMEOUT) {
            console.log(`[转码] 清理超时临时文件: ${sessionId}`);
            cleanupTempFile(sessionId);
        }
    }
}, 60 * 1000); // 每分钟检查一次

/**
 * 清理临时文件
 */
function cleanupTempFile(sessionId) {
    const info = transcodedFiles.get(sessionId);
    if (info && info.tempPath) {
        try {
            if (fs.existsSync(info.tempPath)) {
                fs.unlinkSync(info.tempPath);
                console.log(`[转码] 已删除临时文件: ${info.tempPath}`);
            }
        } catch (e) {
            console.error(`[转码] 删除临时文件失败: ${e.message}`);
        }
        transcodedFiles.delete(sessionId);
    }
}

/**
 * 停止转码进程
 */
function stopTranscodeProcess(sessionId) {
    const info = activeTranscodes.get(sessionId);
    if (info && info.process) {
        try {
            info.process.kill('SIGKILL');
        } catch (e) {
            // 进程可能已经结束
        }
        // 删除未完成的临时文件
        if (info.tempPath && fs.existsSync(info.tempPath)) {
            try {
                fs.unlinkSync(info.tempPath);
            } catch (e) {}
        }
        activeTranscodes.delete(sessionId);
        console.log(`[转码] 进程已停止: ${sessionId}`);
    }
}

/**
 * 检测视频格式
 */
function detectVideoFormat(videoPath) {
    return new Promise((resolve) => {
        const config = getConfig();
        const ffprobePath = config.ffmpegPath.replace(/ffmpeg(\.exe)?$/i, 'ffprobe$1');
        
        const cmd = `"${ffprobePath}" -v quiet -print_format json -show_format "${videoPath}"`;
        
        exec(cmd, { maxBuffer: 10 * 1024 * 1024 }, (error, stdout) => {
            if (error) {
                resolve(null);
                return;
            }
            
            try {
                const info = JSON.parse(stdout);
                const formatName = info.format?.format_name || '';
                resolve({
                    formatName,
                    isMpegPS: formatName.includes('mpeg'),
                    isStandardMP4: formatName === 'mov,mp4,m4a,3gp,3g2,mj2'
                });
            } catch (e) {
                resolve(null);
            }
        });
    });
}

/**
 * 转封装视频到临时文件（快速，不重新编码）
 */
function remuxToFile(videoPath, sessionId) {
    return new Promise((resolve, reject) => {
        const config = getConfig();
        const tempFileName = `transcode_${sessionId}.mp4`;
        const tempPath = path.join(TEMP_DIR, tempFileName);
        
        console.log(`[转封装] 开始: ${videoPath}`);
        console.log(`[转封装] 临时文件: ${tempPath}`);
        
        const startTime = Date.now();
        
        // 转封装：只改变容器格式，不重新编码（速度极快）
        const ffmpegArgs = [
            '-i', videoPath,
            '-c', 'copy',              // 直接复制，不重新编码
            '-f', 'mp4',
            '-movflags', '+faststart', // 优化网络播放
            '-y',
            tempPath
        ];
        
        const ffmpeg = spawn(config.ffmpegPath, ffmpegArgs);
        
        activeTranscodes.set(sessionId, {
            process: ffmpeg,
            tempPath,
            mode: 'remux'
        });
        
        let stderr = '';
        
        ffmpeg.stderr.on('data', (data) => {
            stderr += data.toString();
        });
        
        ffmpeg.on('close', (code) => {
            activeTranscodes.delete(sessionId);
            const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
            
            if (code === 0 && fs.existsSync(tempPath)) {
                const fileSize = fs.statSync(tempPath).size;
                if (fileSize > 1000) {  // 文件大于1KB才算成功
                    console.log(`[转封装] 完成: ${tempPath} (耗时 ${elapsed}秒)`);
                    transcodedFiles.set(sessionId, {
                        tempPath,
                        originalPath: videoPath,
                        createTime: Date.now()
                    });
                    resolve({ success: true, tempPath, mode: 'remux' });
                    return;
                }
            }
            
            // 转封装失败，尝试转码
            console.log(`[转封装] 失败，尝试转码...`);
            if (fs.existsSync(tempPath)) {
                try { fs.unlinkSync(tempPath); } catch (e) {}
            }
            
            // 回退到转码
            transcodeToFile(videoPath, sessionId)
                .then(resolve)
                .catch(reject);
        });
        
        ffmpeg.on('error', (err) => {
            activeTranscodes.delete(sessionId);
            console.error(`[转封装] 进程错误: ${err.message}`);
            // 尝试转码
            transcodeToFile(videoPath, sessionId)
                .then(resolve)
                .catch(reject);
        });
    });
}

/**
 * 转码视频到临时文件（较慢，但更兼容）
 */
function transcodeToFile(videoPath, sessionId) {
    return new Promise((resolve, reject) => {
        const config = getConfig();
        const tempFileName = `transcode_${sessionId}.mp4`;
        const tempPath = path.join(TEMP_DIR, tempFileName);
        
        console.log(`[转码] 开始: ${videoPath}`);
        console.log(`[转码] 临时文件: ${tempPath}`);
        
        const startTime = Date.now();
        
        // 使用ultrafast preset加快速度
        const ffmpegArgs = [
            '-i', videoPath,
            '-c:v', 'libx264',
            '-preset', 'ultrafast',    // 最快速度
            '-crf', '23',
            '-c:a', 'aac',
            '-ac', '2',
            '-ar', '44100',
            '-movflags', '+faststart',
            '-y',
            tempPath
        ];
        
        const ffmpeg = spawn(config.ffmpegPath, ffmpegArgs);
        
        activeTranscodes.set(sessionId, {
            process: ffmpeg,
            tempPath,
            mode: 'transcode'
        });
        
        let stderr = '';
        
        ffmpeg.stderr.on('data', (data) => {
            stderr += data.toString();
        });
        
        ffmpeg.on('close', (code) => {
            activeTranscodes.delete(sessionId);
            const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
            
            if (code === 0 && fs.existsSync(tempPath)) {
                console.log(`[转码] 完成: ${tempPath} (耗时 ${elapsed}秒)`);
                transcodedFiles.set(sessionId, {
                    tempPath,
                    originalPath: videoPath,
                    createTime: Date.now()
                });
                resolve({ success: true, tempPath, mode: 'transcode' });
            } else {
                console.error(`[转码] 失败: code=${code}`);
                if (fs.existsSync(tempPath)) {
                    try { fs.unlinkSync(tempPath); } catch (e) {}
                }
                reject(new Error('转码失败'));
            }
        });
        
        ffmpeg.on('error', (err) => {
            activeTranscodes.delete(sessionId);
            console.error(`[转码] 进程错误: ${err.message}`);
            reject(err);
        });
    });
}

/**
 * 检查转码状态
 */
app.get('/api/transcode-status', (req, res) => {
    const sessionId = req.query.session;
    
    if (!sessionId) {
        res.json({ success: false, error: '缺少session参数' });
        return;
    }
    
    // 检查是否已有转码完成的文件
    if (transcodedFiles.has(sessionId)) {
        res.json({ success: true, status: 'ready' });
        return;
    }
    
    // 检查是否正在转码
    if (activeTranscodes.has(sessionId)) {
        res.json({ success: true, status: 'transcoding' });
        return;
    }
    
    res.json({ success: true, status: 'none' });
});

/**
 * 开始转码
 */
app.post('/api/start-transcode', async (req, res) => {
    const { videoPath, sessionId } = req.body;
    
    if (!videoPath || !sessionId) {
        res.json({ success: false, error: '参数不完整' });
        return;
    }
    
    // 检查是否已有转码完成的文件（同一视频）
    const existing = transcodedFiles.get(sessionId);
    if (existing && existing.originalPath === videoPath && fs.existsSync(existing.tempPath)) {
        res.json({ success: true, status: 'ready', message: '已有转码文件' });
        return;
    }
    
    // 检查是否正在转码
    if (activeTranscodes.has(sessionId)) {
        res.json({ success: true, status: 'transcoding', message: '正在转码中' });
        return;
    }
    
    // 检测格式
    const formatInfo = await detectVideoFormat(videoPath);
    const needsTranscode = !formatInfo || formatInfo.isMpegPS || !formatInfo.isStandardMP4;
    
    if (!needsTranscode) {
        res.json({ success: true, status: 'not_needed', message: '无需转码' });
        return;
    }
    
    // 开始转封装/转码（先尝试快速转封装）
    try {
        // 异步开始，立即返回
        remuxToFile(videoPath, sessionId).catch(err => {
            console.error(`[转换] 失败: ${err.message}`);
        });
        
        res.json({ success: true, status: 'started', message: '开始处理' });
    } catch (err) {
        res.json({ success: false, error: err.message });
    }
});

// ==================== 批量转封装 ====================

// 批量转封装状态
let batchConvertStatus = {
    isRunning: false,
    total: 0,
    completed: 0,
    failed: 0,
    current: '',
    results: []
};

/**
 * 转封装单个文件（替换原文件）
 */
function remuxAndReplace(videoPath) {
    return new Promise((resolve) => {
        const config = getConfig();
        const dir = path.dirname(videoPath);
        const ext = path.extname(videoPath);
        const baseName = path.basename(videoPath, ext);
        const tempPath = path.join(dir, `${baseName}_converting${ext}`);
        const backupPath = path.join(dir, `${baseName}_backup${ext}`);
        
        console.log(`[批量转封装] 处理: ${videoPath}`);
        
        const startTime = Date.now();
        
        const ffmpegArgs = [
            '-i', videoPath,
            '-c', 'copy',
            '-f', 'mp4',
            '-movflags', '+faststart',
            '-y',
            tempPath
        ];
        
        const ffmpeg = spawn(config.ffmpegPath, ffmpegArgs);
        
        let stderr = '';
        
        ffmpeg.stderr.on('data', (data) => {
            stderr += data.toString();
        });
        
        ffmpeg.on('close', (code) => {
            const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
            
            if (code === 0 && fs.existsSync(tempPath)) {
                const tempSize = fs.statSync(tempPath).size;
                const origSize = fs.statSync(videoPath).size;
                
                // 检查转换后的文件是否合理（至少原大小的50%）
                if (tempSize > origSize * 0.5) {
                    try {
                        // 备份原文件
                        fs.renameSync(videoPath, backupPath);
                        // 将转换后的文件改为原文件名
                        fs.renameSync(tempPath, videoPath);
                        // 删除备份
                        fs.unlinkSync(backupPath);
                        
                        console.log(`[批量转封装] 成功: ${videoPath} (${elapsed}秒)`);
                        resolve({ success: true, path: videoPath, elapsed });
                        return;
                    } catch (e) {
                        console.error(`[批量转封装] 替换失败: ${e.message}`);
                        // 恢复备份
                        if (fs.existsSync(backupPath) && !fs.existsSync(videoPath)) {
                            fs.renameSync(backupPath, videoPath);
                        }
                    }
                }
            }
            
            // 清理临时文件
            if (fs.existsSync(tempPath)) {
                try { fs.unlinkSync(tempPath); } catch (e) {}
            }
            if (fs.existsSync(backupPath)) {
                try { fs.renameSync(backupPath, videoPath); } catch (e) {}
            }
            
            console.log(`[批量转封装] 跳过: ${videoPath} (无需转换或转换失败)`);
            resolve({ success: false, path: videoPath, reason: '无需转换或转换失败' });
        });
        
        ffmpeg.on('error', (err) => {
            console.error(`[批量转封装] 错误: ${err.message}`);
            resolve({ success: false, path: videoPath, reason: err.message });
        });
    });
}

/**
 * 开始批量转封装
 */
app.post('/api/batch-convert', async (req, res) => {
    const { folderPath } = req.body;
    
    if (!folderPath) {
        res.json({ success: false, error: '请提供文件夹路径' });
        return;
    }
    
    if (batchConvertStatus.isRunning) {
        res.json({ success: false, error: '已有批量转换任务在进行中' });
        return;
    }
    
    // 扫描文件夹中的视频文件
    let videoFiles = [];
    try {
        const files = fs.readdirSync(folderPath);
        for (const file of files) {
            if (/\.(mp4|avi|mkv|mov|wmv|flv|mpeg|mpg|m4v|ts)$/i.test(file)) {
                const fullPath = path.join(folderPath, file);
                const stat = fs.statSync(fullPath);
                if (stat.isFile()) {
                    // 检测是否需要转换
                    const formatInfo = await detectVideoFormat(fullPath);
                    if (!formatInfo || formatInfo.isMpegPS || !formatInfo.isStandardMP4) {
                        videoFiles.push(fullPath);
                    }
                }
            }
        }
    } catch (e) {
        res.json({ success: false, error: `扫描文件夹失败: ${e.message}` });
        return;
    }
    
    if (videoFiles.length === 0) {
        res.json({ success: true, message: '没有需要转换的视频文件', count: 0 });
        return;
    }
    
    // 初始化状态
    batchConvertStatus = {
        isRunning: true,
        total: videoFiles.length,
        completed: 0,
        failed: 0,
        current: '',
        results: []
    };
    
    res.json({ 
        success: true, 
        message: `开始转换 ${videoFiles.length} 个视频`,
        count: videoFiles.length 
    });
    
    // 异步执行批量转换
    (async () => {
        for (const videoPath of videoFiles) {
            if (!batchConvertStatus.isRunning) break;
            
            batchConvertStatus.current = path.basename(videoPath);
            
            const result = await remuxAndReplace(videoPath);
            batchConvertStatus.results.push(result);
            
            if (result.success) {
                batchConvertStatus.completed++;
            } else {
                batchConvertStatus.failed++;
            }
        }
        
        batchConvertStatus.isRunning = false;
        batchConvertStatus.current = '';
        console.log(`[批量转封装] 完成: 成功 ${batchConvertStatus.completed}, 跳过 ${batchConvertStatus.failed}`);
    })();
});

/**
 * 获取批量转换状态
 */
app.get('/api/batch-convert-status', (req, res) => {
    res.json({
        success: true,
        ...batchConvertStatus
    });
});

/**
 * 停止批量转换
 */
app.post('/api/batch-convert-stop', (req, res) => {
    batchConvertStatus.isRunning = false;
    res.json({ success: true, message: '已停止' });
});

/**
 * 视频流 - 用于浏览器预览
 */
app.get('/api/video-stream', async (req, res) => {
    const videoPath = req.query.path;
    const sessionId = req.query.session;
    
    if (!videoPath) {
        res.status(400).send('请提供视频路径');
        return;
    }
    
    try {
        if (!fs.existsSync(videoPath)) {
            res.status(404).send('文件不存在');
            return;
        }
        
        // 检查是否有转码完成的临时文件
        let streamPath = videoPath;
        if (sessionId && transcodedFiles.has(sessionId)) {
            const info = transcodedFiles.get(sessionId);
            if (fs.existsSync(info.tempPath)) {
                streamPath = info.tempPath;
                // 更新访问时间，延长保留
                info.createTime = Date.now();
                console.log(`[视频流] 使用转码文件: ${streamPath}`);
            }
        }
        
        // 流式输出
        streamVideoFile(streamPath, req, res);
        
    } catch (e) {
        console.error('视频流错误:', e);
        res.status(500).send('视频读取失败');
    }
});

/**
 * 流式输出视频文件
 */
function streamVideoFile(videoPath, req, res) {
    const stat = fs.statSync(videoPath);
    const fileSize = stat.size;
    const range = req.headers.range;
    
    if (range) {
        const parts = range.replace(/bytes=/, '').split('-');
        const start = parseInt(parts[0], 10);
        const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
        const chunkSize = (end - start) + 1;
        
        const file = fs.createReadStream(videoPath, { start, end });
        
        res.writeHead(206, {
            'Content-Range': `bytes ${start}-${end}/${fileSize}`,
            'Accept-Ranges': 'bytes',
            'Content-Length': chunkSize,
            'Content-Type': 'video/mp4'
        });
        
        file.pipe(res);
    } else {
        res.writeHead(200, {
            'Content-Length': fileSize,
            'Content-Type': 'video/mp4'
        });
        
        fs.createReadStream(videoPath).pipe(res);
    }
}

/**
 * 停止转码并清理
 */
app.post('/api/stop-transcode', (req, res) => {
    const { sessionId } = req.body;
    if (sessionId) {
        stopTranscodeProcess(sessionId);
        cleanupTempFile(sessionId);
        res.json({ success: true });
    } else {
        res.json({ success: false, error: '缺少sessionId' });
    }
});

/**
 * 清理所有临时文件（服务器启动时调用）
 */
function cleanupAllTempFiles() {
    try {
        const files = fs.readdirSync(TEMP_DIR);
        for (const file of files) {
            if (file.startsWith('transcode_')) {
                const filePath = path.join(TEMP_DIR, file);
                fs.unlinkSync(filePath);
                console.log(`[启动清理] 删除: ${filePath}`);
            }
        }
    } catch (e) {
        // 目录可能不存在
    }
}

// 服务器启动时清理旧的临时文件
cleanupAllTempFiles();

/**
 * 获取视频信息
 */
app.get('/api/video-info', (req, res) => {
    const videoPath = req.query.path;
    if (!videoPath) {
        res.json({ success: false, error: '请提供视频路径' });
        return;
    }
    
    const config = getConfig();
    const ffprobePath = config.ffmpegPath.replace(/ffmpeg(\.exe)?$/i, 'ffprobe$1');
    
    // 使用ffprobe获取视频信息
    const cmd = `"${ffprobePath}" -v quiet -print_format json -show_format -show_streams "${videoPath}"`;
    
    exec(cmd, { maxBuffer: 10 * 1024 * 1024 }, (error, stdout, stderr) => {
        if (error) {
            // 尝试使用ffmpeg获取基本信息
            const ffmpegCmd = `"${config.ffmpegPath}" -i "${videoPath}" 2>&1`;
            exec(ffmpegCmd, { maxBuffer: 10 * 1024 * 1024 }, (err2, stdout2, stderr2) => {
                const output = stdout2 || stderr2 || '';
                const durationMatch = output.match(/Duration: (\d{2}):(\d{2}):(\d{2})\.(\d{2})/);
                const resolutionMatch = output.match(/(\d{3,4})x(\d{3,4})/);
                
                if (durationMatch) {
                    const hours = parseInt(durationMatch[1]);
                    const minutes = parseInt(durationMatch[2]);
                    const seconds = parseInt(durationMatch[3]);
                    const duration = hours * 3600 + minutes * 60 + seconds;
                    
                    res.json({
                        success: true,
                        duration,
                        durationStr: `${durationMatch[1]}:${durationMatch[2]}:${durationMatch[3]}`,
                        width: resolutionMatch ? parseInt(resolutionMatch[1]) : null,
                        height: resolutionMatch ? parseInt(resolutionMatch[2]) : null,
                        path: videoPath
                    });
                } else {
                    res.json({ 
                        success: false, 
                        error: '无法获取视频信息，可能是非标准格式',
                        raw: output.substring(0, 500)
                    });
                }
            });
            return;
        }
        
        try {
            const info = JSON.parse(stdout);
            const videoStream = info.streams?.find(s => s.codec_type === 'video');
            const duration = parseFloat(info.format?.duration || 0);
            
            res.json({
                success: true,
                duration,
                durationStr: formatDuration(duration),
                width: videoStream?.width,
                height: videoStream?.height,
                codec: videoStream?.codec_name,
                bitrate: info.format?.bit_rate,
                path: videoPath
            });
        } catch (e) {
            res.json({ success: false, error: '解析视频信息失败' });
        }
    });
});

/**
 * 检查输出文件是否存在
 */
app.post('/api/check-output', (req, res) => {
    const { inputPath, outputName } = req.body;
    
    if (!inputPath) {
        res.json({ success: false, error: '参数不完整' });
        return;
    }
    
    const outputDir = ensureOutputDir();
    const ext = path.extname(inputPath);
    const baseName = outputName || `clip_${Date.now()}`;
    const outputPath = path.join(outputDir, `${baseName}${ext}`);
    
    const exists = fs.existsSync(outputPath);
    
    res.json({
        success: true,
        exists,
        outputPath,
        outputDir,
        fileName: `${baseName}${ext}`
    });
});

/**
 * 获取可用的文件名（自动添加序号）
 */
app.post('/api/get-available-name', (req, res) => {
    const { inputPath, outputName } = req.body;
    
    if (!inputPath) {
        res.json({ success: false, error: '参数不完整' });
        return;
    }
    
    const outputDir = ensureOutputDir();
    const ext = path.extname(inputPath);
    const baseName = outputName || `clip_${Date.now()}`;
    
    let finalName = baseName;
    let counter = 1;
    let outputPath = path.join(outputDir, `${finalName}${ext}`);
    
    // 如果文件存在，添加序号直到找到可用的文件名
    while (fs.existsSync(outputPath)) {
        finalName = `${baseName}_${counter}`;
        outputPath = path.join(outputDir, `${finalName}${ext}`);
        counter++;
        
        // 防止无限循环
        if (counter > 1000) {
            finalName = `${baseName}_${Date.now()}`;
            outputPath = path.join(outputDir, `${finalName}${ext}`);
            break;
        }
    }
    
    res.json({
        success: true,
        outputPath,
        fileName: `${finalName}${ext}`,
        baseName: finalName
    });
});

/**
 * 剪辑视频
 */
app.post('/api/clip', (req, res) => {
    const { inputPath, startTime, endTime, outputName, reEncode, overwrite } = req.body;
    
    if (!inputPath || startTime === undefined || endTime === undefined) {
        res.json({ success: false, error: '参数不完整' });
        return;
    }
    
    const config = getConfig();
    const outputDir = ensureOutputDir();
    
    // 生成输出文件名
    const ext = path.extname(inputPath);
    const baseName = outputName || `clip_${Date.now()}`;
    const outputPath = path.join(outputDir, `${baseName}${ext}`);
    
    // 检查文件是否存在（如果没有明确要覆盖）
    if (!overwrite && fs.existsSync(outputPath)) {
        res.json({
            success: false,
            error: 'FILE_EXISTS',
            message: '输出文件已存在',
            outputPath,
            fileName: `${baseName}${ext}`
        });
        return;
    }
    
    // 构建ffmpeg命令
    // 使用 -ss 在 -i 之前可以更快seek，但可能不够精确
    // 对于海康CVR视频，放在 -i 之后更安全
    let ffmpegArgs = [
        '-i', inputPath,
        '-ss', formatDuration(startTime),
        '-to', formatDuration(endTime)
    ];
    
    if (reEncode) {
        // 重新编码（更慢但更兼容）
        ffmpegArgs.push('-c:v', 'libx264', '-c:a', 'aac');
    } else {
        // 流复制（快速）
        ffmpegArgs.push('-c', 'copy');
    }
    
    ffmpegArgs.push('-y', outputPath);  // -y 覆盖已存在的文件
    
    console.log(`[剪辑] 开始: ${inputPath}`);
    console.log(`[剪辑] 时间: ${formatDuration(startTime)} -> ${formatDuration(endTime)}`);
    console.log(`[剪辑] 输出: ${outputPath}`);
    
    const ffmpeg = spawn(config.ffmpegPath, ffmpegArgs);
    
    let stderr = '';
    
    ffmpeg.stderr.on('data', (data) => {
        stderr += data.toString();
    });
    
    ffmpeg.on('close', (code) => {
        if (code === 0) {
            console.log(`[剪辑] 完成: ${outputPath}`);
            res.json({ 
                success: true, 
                outputPath,
                message: '剪辑完成！'
            });
        } else {
            console.error(`[剪辑] 失败: ${stderr}`);
            res.json({ 
                success: false, 
                error: '剪辑失败',
                details: stderr.substring(stderr.length - 500)
            });
        }
    });
    
    ffmpeg.on('error', (err) => {
        console.error(`[剪辑] 错误: ${err.message}`);
        res.json({ 
            success: false, 
            error: `执行ffmpeg失败: ${err.message}`
        });
    });
});

/**
 * 打开输出文件夹
 */
app.get('/api/open-output', (req, res) => {
    const outputDir = ensureOutputDir();
    
    let cmd;
    switch (os.platform()) {
        case 'win32':
            cmd = `explorer "${outputDir}"`;
            break;
        case 'darwin':
            cmd = `open "${outputDir}"`;
            break;
        default:
            cmd = `xdg-open "${outputDir}"`;
    }
    
    exec(cmd, (error) => {
        if (error) {
            res.json({ success: false, error: error.message });
        } else {
            res.json({ success: true, path: outputDir });
        }
    });
});

// ==================== 工具函数 ====================

/**
 * 格式化时长为 HH:MM:SS 格式
 */
function formatDuration(seconds) {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

// ==================== 启动服务 ====================

app.listen(PORT, () => {
    console.log('');
    console.log('╔══════════════════════════════════════════════════════════╗');
    console.log('║           🎬 视频剪辑工具 已启动                          ║');
    console.log('╠══════════════════════════════════════════════════════════╣');
    console.log(`║  访问地址: http://localhost:${PORT}                          ║`);
    console.log('║  按 Ctrl+C 停止服务                                       ║');
    console.log('╚══════════════════════════════════════════════════════════╝');
    console.log('');
    
    // 确保输出目录存在
    ensureOutputDir();
});
