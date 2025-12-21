/**
 * 视频剪辑工具 - 后端服务
 * 功能：提供文件浏览、视频流、视频信息获取、视频剪辑等API
 */

const express = require('express');
const path = require('path');
const fs = require('fs');
const { exec, spawn } = require('child_process');
const os = require('os');
const logger = require('./logger');

const app = express();
const PORT = 3000;

// 中间件配置
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// 配置文件路径
const CONFIG_FILE = path.join(__dirname, 'config.json');

/**
 * 获取默认输出目录
 */
function getDefaultOutputDir() {
    return path.join(__dirname, 'output');
}

/**
 * 检查路径的父目录是否存在（用于判断路径是否可创建）
 */
function isPathCreatable(targetPath) {
    try {
        // 获取父目录
        const parentDir = path.dirname(targetPath);
        // 检查父目录是否存在
        return fs.existsSync(parentDir);
    } catch (e) {
        return false;
    }
}

/**
 * 获取配置（ffmpeg路径等）
 */
function getConfig() {
    let configChanged = false;
    
    try {
        if (fs.existsSync(CONFIG_FILE)) {
            const config = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf-8'));
            
            // 检查 lastBrowsePath 是否存在，不存在则清除
            if (config.lastBrowsePath) {
                try {
                    if (!fs.existsSync(config.lastBrowsePath)) {
                        logger.warn('[配置]', `上次浏览路径不存在，已清除: ${config.lastBrowsePath}`);
                        config.lastBrowsePath = '';
                        configChanged = true;
                    }
                } catch (e) {
                    // 路径无法访问，清除
                    config.lastBrowsePath = '';
                    configChanged = true;
                }
            }
            
            // 检查 outputDir 是否可用（存在或可创建）
            if (config.outputDir) {
                const outputExists = fs.existsSync(config.outputDir);
                const canCreate = !outputExists && isPathCreatable(config.outputDir);
                
                if (!outputExists && !canCreate) {
                    logger.warn('[配置]', `输出目录不可用，已重置为默认: ${config.outputDir}`);
                    config.outputDir = getDefaultOutputDir();
                    configChanged = true;
                }
            }
            
            // 保存更新后的配置
            if (configChanged) {
                fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
            }
            
            return config;
        }
    } catch (e) {
        logger.error('[配置]', `读取配置失败: ${e.message}`);
    }
    // 默认配置
    return {
        ffmpegPath: 'ffmpeg',  // 默认使用系统PATH中的ffmpeg
        outputDir: getDefaultOutputDir()
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
    let outputDir = config.outputDir || getDefaultOutputDir();
    
    try {
        if (!fs.existsSync(outputDir)) {
            fs.mkdirSync(outputDir, { recursive: true });
        }
    } catch (e) {
        // 创建失败，使用默认目录
        logger.warn('[配置]', `无法创建输出目录 ${outputDir}，使用默认目录`);
        outputDir = getDefaultOutputDir();
        
        if (!fs.existsSync(outputDir)) {
            fs.mkdirSync(outputDir, { recursive: true });
        }
        
        // 更新配置
        config.outputDir = outputDir;
        saveConfig(config);
    }
    
    return outputDir;
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
 * 获取Windows驱动器列表（使用Node.js方式，兼容所有Windows版本）
 */
function getWindowsDrives() {
    const drives = [];
    // 检查 A-Z 盘符
    for (let i = 65; i <= 90; i++) {
        const driveLetter = String.fromCharCode(i);
        const drivePath = `${driveLetter}:\\`;
        try {
            // 尝试访问该盘符，如果存在则添加到列表
            fs.accessSync(drivePath, fs.constants.R_OK);
            drives.push({
                name: `${driveLetter}:`,
                path: drivePath,
                isDirectory: true,
                isDrive: true
            });
        } catch (e) {
            // 盘符不存在或无法访问，跳过
        }
    }
    return drives;
}

/**
 * 浏览文件夹
 */
app.get('/api/browse', (req, res) => {
    let dirPath = req.query.path || '';
    
    // 如果没有提供路径，返回驱动器列表（Windows）或根目录（Linux/Mac）
    if (!dirPath) {
        if (os.platform() === 'win32') {
            // Windows: 使用Node.js方式获取驱动器列表（兼容所有Windows版本）
            const drives = getWindowsDrives();
            res.json({ success: true, path: '', items: drives, isRoot: true });
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
            logger.info('[转码]', `清理超时临时文件: ${sessionId}`);
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
                logger.info('[转码]', `已删除临时文件: ${info.tempPath}`);
            }
        } catch (e) {
            logger.error('[转码]', `删除临时文件失败: ${e.message}`);
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
        logger.info('[转码]', `进程已停止: ${sessionId}`);
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
        const inputFileName = path.basename(videoPath);
        
        logger.info('[转封装]', `开始 | ${inputFileName}`);
        
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
                    logger.info('[转封装]', `完成 | ${inputFileName} | 耗时 ${elapsed}秒`);
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
            logger.warn('[转封装]', `失败 | ${inputFileName} | 尝试转码...`);
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
            logger.error('[转封装]', `错误 | ${inputFileName} | ${err.message}`);
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
        const inputFileName = path.basename(videoPath);
        
        logger.info('[转码]', `开始 | ${inputFileName}`);
        
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
                logger.info('[转码]', `完成 | ${inputFileName} | 耗时 ${elapsed}秒`);
                transcodedFiles.set(sessionId, {
                    tempPath,
                    originalPath: videoPath,
                    createTime: Date.now()
                });
                resolve({ success: true, tempPath, mode: 'transcode' });
            } else {
                logger.error('[转码]', `失败 | ${inputFileName} | code=${code}`);
                if (fs.existsSync(tempPath)) {
                    try { fs.unlinkSync(tempPath); } catch (e) {}
                }
                reject(new Error('转码失败'));
            }
        });
        
        ffmpeg.on('error', (err) => {
            activeTranscodes.delete(sessionId);
            logger.error('[转码]', `错误 | ${inputFileName} | ${err.message}`);
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
            logger.error('[转换]', `失败: ${err.message}`);
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
 * 格式化文件大小
 */
function formatFileSize(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
    return (bytes / (1024 * 1024 * 1024)).toFixed(2) + ' GB';
}

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
        const fileName = path.basename(videoPath);
        
        // 获取文件大小
        let fileSize = 0;
        try {
            fileSize = fs.statSync(videoPath).size;
        } catch (e) {}
        
        logger.info('[批量转封装]', `处理 | ${fileName} | ${formatFileSize(fileSize)}`);
        
        const startTime = Date.now();
        
        // 移除 -movflags +faststart 以提高批量转换速度
        // faststart 会在转换后重新排列文件结构，对批量处理造成额外开销
        const ffmpegArgs = [
            '-i', videoPath,
            '-c', 'copy',
            '-f', 'mp4',
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
                        
                        logger.info('[批量转封装]', `成功 | ${fileName} | ${formatFileSize(fileSize)} | 耗时 ${elapsed}秒`);
                        resolve({ success: true, path: videoPath, elapsed, fileSize });
                        return;
                    } catch (e) {
                        logger.error('[批量转封装]', `替换失败 | ${fileName} | ${e.message}`);
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
            
            logger.info('[批量转封装]', `跳过 | ${fileName} | 无需转换或转换失败`);
            resolve({ success: false, path: videoPath, reason: '无需转换或转换失败' });
        });
        
        ffmpeg.on('error', (err) => {
            logger.error('[批量转封装]', `错误 | ${fileName} | ${err.message}`);
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
        logger.info('[批量转封装]', `完成: 成功 ${batchConvertStatus.completed}, 跳过 ${batchConvertStatus.failed}`);
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
                logger.info('[视频流]', `使用转码文件 | ${path.basename(videoPath)}`);
            }
        }
        
        // 流式输出
        streamVideoFile(streamPath, req, res);
        
    } catch (e) {
        logger.error('[视频流]', `错误: ${e.message}`);
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
                logger.info('[启动清理]', `删除: ${filePath}`);
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
    
    // 获取文件名用于日志显示
    const inputFileName = path.basename(inputPath);
    const outputFileName = path.basename(outputPath);
    const clipStartTime = Date.now();
    
    // 合并日志：一行显示所有开始信息
    logger.info('[剪辑]', `开始 | ${inputFileName} | ${formatDuration(startTime)} -> ${formatDuration(endTime)} | 输出: ${outputFileName}`);
    
    const ffmpeg = spawn(config.ffmpegPath, ffmpegArgs);
    
    let stderr = '';
    
    ffmpeg.stderr.on('data', (data) => {
        stderr += data.toString();
    });
    
    ffmpeg.on('close', (code) => {
        const elapsed = ((Date.now() - clipStartTime) / 1000).toFixed(2);
        if (code === 0) {
            // 合并日志：一行显示完成信息和耗时
            logger.info('[剪辑]', `完成 | ${inputFileName} -> ${outputFileName} | 耗时 ${elapsed}秒`);
            res.json({ 
                success: true, 
                outputPath,
                message: '剪辑完成！'
            });
        } else {
            logger.error('[剪辑]', `失败 | ${inputFileName} | 耗时 ${elapsed}秒 | ${stderr.substring(0, 200)}`);
            res.json({ 
                success: false, 
                error: '剪辑失败',
                details: stderr.substring(stderr.length - 500)
            });
        }
    });
    
    ffmpeg.on('error', (err) => {
        logger.error('[剪辑]', `错误 | ${inputFileName} | ${err.message}`);
        res.json({ 
            success: false, 
            error: `执行ffmpeg失败: ${err.message}`
        });
    });
});

/**
 * 合并视频
 */
app.post('/api/merge', async (req, res) => {
    const { videos, outputName } = req.body;
    
    if (!videos || !Array.isArray(videos) || videos.length < 2) {
        res.json({ success: false, error: '至少需要2个视频进行合并' });
        return;
    }
    
    // 检查所有视频文件是否存在
    for (const videoPath of videos) {
        if (!fs.existsSync(videoPath)) {
            res.json({ success: false, error: `文件不存在: ${videoPath}` });
            return;
        }
    }
    
    const config = getConfig();
    const outputDir = ensureOutputDir();
    
    // 生成输出文件名
    const ext = path.extname(videos[0]);
    const baseName = outputName || `merged_${Date.now()}`;
    const outputPath = path.join(outputDir, `${baseName}${ext}`);
    
    // 创建临时的文件列表
    const tempListPath = path.join(__dirname, 'temp', `merge_list_${Date.now()}.txt`);
    
    // 确保 temp 目录存在
    const tempDir = path.join(__dirname, 'temp');
    if (!fs.existsSync(tempDir)) {
        fs.mkdirSync(tempDir, { recursive: true });
    }
    
    // 写入文件列表（FFmpeg concat demuxer 格式）
    const fileListContent = videos.map(v => `file '${v.replace(/\\/g, '/')}'`).join('\n');
    fs.writeFileSync(tempListPath, fileListContent, 'utf8');
    
    logger.info('[合并]', `开始 | ${videos.length}个视频 | 输出: ${path.basename(outputPath)}`);
    videos.forEach((v, i) => {
        logger.info('[合并]', `  ${i + 1}. ${path.basename(v)}`);
    });
    
    const mergeStartTime = Date.now();
    
    // 使用 concat demuxer 合并视频
    const ffmpegArgs = [
        '-f', 'concat',
        '-safe', '0',
        '-i', tempListPath,
        '-c', 'copy',
        '-y', outputPath
    ];
    
    const ffmpeg = spawn(config.ffmpegPath, ffmpegArgs);
    
    let stderr = '';
    
    ffmpeg.stderr.on('data', (data) => {
        stderr += data.toString();
    });
    
    ffmpeg.on('close', (code) => {
        // 删除临时文件
        try {
            fs.unlinkSync(tempListPath);
        } catch (e) {
            // 忽略删除失败
        }
        
        const elapsed = ((Date.now() - mergeStartTime) / 1000).toFixed(2);
        
        if (code === 0) {
            // 获取输出文件大小
            let fileSizeStr = '';
            try {
                const stats = fs.statSync(outputPath);
                const fileSizeGB = (stats.size / (1024 * 1024 * 1024)).toFixed(2);
                fileSizeStr = ` | ${fileSizeGB} GB`;
            } catch (e) {}
            
            logger.info('[合并]', `完成 | ${videos.length}个视频 -> ${path.basename(outputPath)} | 耗时 ${elapsed}秒${fileSizeStr}`);
            res.json({ 
                success: true, 
                outputPath,
                message: '合并完成！'
            });
        } else {
            logger.error('[合并]', `失败 | 耗时 ${elapsed}秒 | ${stderr.substring(0, 300)}`);
            res.json({ 
                success: false, 
                error: '合并失败',
                details: stderr.substring(stderr.length - 500)
            });
        }
    });
    
    ffmpeg.on('error', (err) => {
        // 删除临时文件
        try {
            fs.unlinkSync(tempListPath);
        } catch (e) {}
        
        logger.error('[合并]', `错误 | ${err.message}`);
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

// ==================== RTSP 推流功能 ====================

// RTSP 推流状态
const rtspState = {
    serverProcess: null,      // MediaMTX 进程
    serverRunning: false,     // 服务器是否运行中
    streamProcess: null,      // FFmpeg 推流进程
    isStreaming: false,       // 是否正在推流
    isPaused: false,          // 是否暂停（推送静帧中）
    currentVideoPath: null,   // 当前推流的视频路径
    currentTime: 0,           // 当前推流时间（秒）
    startTime: 0,             // 推流开始时间点
    endTime: 0,               // 推流结束时间点（0表示到视频结尾）
    duration: 0,              // 视频总时长
    speed: 1,                 // 推流速度
    loop: false,              // 是否循环推流
    loopCount: 0,             // 已循环次数
    streamStartTimestamp: 0,  // 推流开始的时间戳（用于计算当前时间）
    pauseFramePath: null,     // 暂停时的静帧图片路径
    // 推流状态监控
    stats: {
        fps: 0,               // 当前帧率
        bitrate: 0,           // 当前码率 (kbps)
        frames: 0,            // 已推送帧数
        droppedFrames: 0,     // 丢帧数
        speed: '1x',          // 实际推流速度
        size: 0               // 已推送数据量 (bytes)
    }
};

/**
 * 获取本机IP地址
 */
function getLocalIP() {
    const interfaces = os.networkInterfaces();
    for (const name of Object.keys(interfaces)) {
        for (const iface of interfaces[name]) {
            // 跳过内部地址和非IPv4地址
            if (iface.family === 'IPv4' && !iface.internal) {
                return iface.address;
            }
        }
    }
    return '127.0.0.1';
}

/**
 * 获取RTSP配置
 */
function getRtspConfig() {
    const config = getConfig();
    return {
        mediamtxPath: config.mediamtxPath || '',
        rtspPort: config.rtspPort || 8554,
        streamName: config.streamName || 'live'
    };
}

/**
 * 保存RTSP配置
 */
function saveRtspConfig(rtspConfig) {
    const config = getConfig();
    if (rtspConfig.mediamtxPath !== undefined) config.mediamtxPath = rtspConfig.mediamtxPath;
    if (rtspConfig.rtspPort !== undefined) config.rtspPort = rtspConfig.rtspPort;
    if (rtspConfig.streamName !== undefined) config.streamName = rtspConfig.streamName;
    saveConfig(config);
}

/**
 * 获取RTSP配置API
 */
app.get('/api/rtsp/config', (req, res) => {
    const rtspConfig = getRtspConfig();
    res.json({
        success: true,
        ...rtspConfig,
        localIP: getLocalIP()
    });
});

/**
 * 保存RTSP配置API
 */
app.post('/api/rtsp/config', (req, res) => {
    const { mediamtxPath, rtspPort, streamName } = req.body;
    saveRtspConfig({ mediamtxPath, rtspPort, streamName });
    res.json({ success: true });
});

/**
 * 启动MediaMTX服务器
 */
app.post('/api/rtsp/server/start', (req, res) => {
    const rtspConfig = getRtspConfig();
    
    if (!rtspConfig.mediamtxPath) {
        res.json({ success: false, error: '请先配置 MediaMTX 路径' });
        return;
    }
    
    if (!fs.existsSync(rtspConfig.mediamtxPath)) {
        res.json({ success: false, error: 'MediaMTX 文件不存在' });
        return;
    }
    
    if (rtspState.serverRunning) {
        res.json({ success: true, message: '服务器已在运行' });
        return;
    }
    
    try {
        // 启动 MediaMTX，设置端口
        const mediamtxDir = path.dirname(rtspConfig.mediamtxPath);
        
        // 创建临时配置文件以设置端口（禁用所有认证）
        const configContent = `
# 日志级别
logLevel: info
logDestinations: [stdout]

# RTSP 服务
rtspAddress: :${rtspConfig.rtspPort}

# 禁用其他协议（减少端口占用）
rtmpDisable: yes
hlsDisable: yes
webrtcDisable: yes

# API（可选，用于调试）
apiAddress: ""

# 路径配置 - 允许任何人推流和观看
paths:
  all:
    source: publisher
    # 禁用推流认证
    publishUser:
    publishPass:
    # 禁用观看认证  
    readUser:
    readPass:
`;
        const tempConfigPath = path.join(mediamtxDir, 'mediamtx_temp.yml');
        fs.writeFileSync(tempConfigPath, configContent, 'utf-8');
        
        rtspState.serverProcess = spawn(rtspConfig.mediamtxPath, [tempConfigPath], {
            cwd: mediamtxDir,
            stdio: ['ignore', 'pipe', 'pipe']
        });
        
        rtspState.serverProcess.stdout.on('data', (data) => {
            const msg = data.toString();
            if (msg.includes('listener opened')) {
                rtspState.serverRunning = true;
            }
        });
        
        rtspState.serverProcess.stderr.on('data', (data) => {
            logger.error('[RTSP服务]', data.toString().trim());
        });
        
        rtspState.serverProcess.on('close', (code) => {
            rtspState.serverRunning = false;
            rtspState.serverProcess = null;
            logger.info('[RTSP服务]', `MediaMTX 已停止，退出码: ${code}`);
        });
        
        rtspState.serverProcess.on('error', (err) => {
            rtspState.serverRunning = false;
            logger.error('[RTSP服务]', `启动失败: ${err.message}`);
        });
        
        // 等待服务器启动
        setTimeout(() => {
            if (rtspState.serverProcess && !rtspState.serverProcess.killed) {
                rtspState.serverRunning = true;
                logger.info('[RTSP服务]', `MediaMTX 已启动，端口: ${rtspConfig.rtspPort}`);
            }
        }, 1000);
        
        res.json({ success: true, message: '服务器启动中...' });
        
    } catch (e) {
        res.json({ success: false, error: e.message });
    }
});

/**
 * 停止MediaMTX服务器
 */
app.post('/api/rtsp/server/stop', (req, res) => {
    if (rtspState.serverProcess) {
        // 先停止推流
        stopRtspStream();
        
        rtspState.serverProcess.kill('SIGTERM');
        rtspState.serverProcess = null;
        rtspState.serverRunning = false;
        logger.info('[RTSP服务]', 'MediaMTX 已停止');
    }
    res.json({ success: true });
});

/**
 * 获取服务器状态
 */
app.get('/api/rtsp/server/status', (req, res) => {
    res.json({
        success: true,
        running: rtspState.serverRunning
    });
});

/**
 * 停止RTSP推流
 */
function stopRtspStream() {
    if (rtspState.streamProcess) {
        try {
            rtspState.streamProcess.kill('SIGKILL');
        } catch (e) {}
        rtspState.streamProcess = null;
    }
    
    // 清理暂停时的静帧图片
    if (rtspState.pauseFramePath && fs.existsSync(rtspState.pauseFramePath)) {
        try {
            fs.unlinkSync(rtspState.pauseFramePath);
        } catch (e) {}
        rtspState.pauseFramePath = null;
    }
    
    rtspState.isStreaming = false;
    rtspState.isPaused = false;
}

/**
 * 开始推流（内部函数）
 * @param {string} videoPath - 视频文件路径
 * @param {number} startTime - 开始时间（秒）
 * @param {object} options - 选项 { speed, endTime, loop }
 */
function startRtspStreamInternal(videoPath, startTime, options = {}) {
    const { speed = 1, endTime = 0, loop = false } = options;
    
    return new Promise((resolve, reject) => {
        const config = getConfig();
        const rtspConfig = getRtspConfig();
        const rtspUrl = `rtsp://localhost:${rtspConfig.rtspPort}/${rtspConfig.streamName}`;
        
        // 构建 FFmpeg 参数
        const ffmpegArgs = [];
        
        // 如果有起始时间，放在 -i 前面（快速seek）
        if (startTime > 0) {
            ffmpegArgs.push('-ss', formatDuration(startTime));
        }
        
        // 循环推流：使用 -stream_loop
        if (loop) {
            ffmpegArgs.push('-stream_loop', '-1'); // -1 表示无限循环
        }
        
        // 1x 速度使用 -re 实时推流
        // 非1x 速度不使用 -re，而是通过 realtime 滤镜控制输出速度
        if (speed === 1) {
            ffmpegArgs.push('-re');
        }
        
        ffmpegArgs.push('-i', videoPath);
        
        // 如果有结束时间，计算持续时长
        if (endTime > 0 && endTime > startTime) {
            const duration = endTime - startTime;
            ffmpegArgs.push('-t', formatDuration(duration));
        }
        
        // 根据速度选择编码方式
        if (speed === 1) {
            // 1x 速度：直接复制（快速，低CPU）
            ffmpegArgs.push('-c:v', 'copy');
            ffmpegArgs.push('-c:a', 'copy');
        } else {
            // 非1x速度：需要使用滤镜重新编码
            // 视频滤镜链：
            // 1. setpts=PTS/speed - 改变时间戳实现变速
            // 2. fps=24 - 限制输出帧率为24fps（避免帧率过高）
            // 3. realtime - 限制输出速度为实时（关键：防止推流过快导致丢帧）
            const targetFps = 24;
            const videoFilter = `setpts=PTS/${speed},fps=${targetFps},realtime`;
            ffmpegArgs.push('-filter:v', videoFilter);
            
            // 编码设置：平衡画质和性能
            ffmpegArgs.push('-c:v', 'libx264');
            ffmpegArgs.push('-preset', 'veryfast');  // 改用 veryfast，画质更好
            ffmpegArgs.push('-tune', 'zerolatency');
            ffmpegArgs.push('-g', '48');             // GOP大小（2秒@24fps）
            ffmpegArgs.push('-crf', '23');           // 使用 CRF 质量控制（23是默认，越小质量越高）
            
            // 码率控制：提高码率以保持画质
            ffmpegArgs.push('-maxrate', '5M');       // 最大码率 5Mbps
            ffmpegArgs.push('-bufsize', '2M');       // 缓冲区大小
            
            // 音频滤镜：atempo（范围0.5-2.0，超出需要链式调用）
            // 音频会跟随视频的 realtime 滤镜同步
            let audioFilter;
            if (speed >= 0.5 && speed <= 2.0) {
                audioFilter = `atempo=${speed}`;
            } else if (speed > 2.0) {
                // 超过2倍需要链式 atempo
                const atempo1 = Math.min(speed, 2.0);
                const atempo2 = speed / atempo1;
                audioFilter = `atempo=${atempo1},atempo=${atempo2}`;
            } else {
                // 小于0.5倍
                const atempo1 = Math.max(speed, 0.5);
                const atempo2 = speed / atempo1;
                audioFilter = `atempo=${atempo1},atempo=${atempo2}`;
            }
            ffmpegArgs.push('-filter:a', audioFilter);
            ffmpegArgs.push('-c:a', 'aac');
            ffmpegArgs.push('-b:a', '128k');         // 音频码率
        }
        
        // RTSP 输出格式
        ffmpegArgs.push('-f', 'rtsp');
        ffmpegArgs.push('-rtsp_transport', 'tcp');
        ffmpegArgs.push(rtspUrl);
        
        const speedStr = speed === 1 ? '1x' : `${speed}x`;
        const rangeStr = endTime > 0 ? ` -> ${formatDuration(endTime)}` : '';
        const loopStr = loop ? ' [循环]' : '';
        logger.info('[RTSP推流]', `开始 | ${path.basename(videoPath)} | ${formatDuration(startTime)}${rangeStr} | ${speedStr}${loopStr}`);
        logger.info('[RTSP推流]', `命令: ffmpeg ${ffmpegArgs.join(' ')}`);
        
        const ffmpeg = spawn(config.ffmpegPath, ffmpegArgs);
        rtspState.streamProcess = ffmpeg;
        rtspState.isStreaming = true;
        rtspState.isPaused = false;
        rtspState.currentVideoPath = videoPath;
        rtspState.currentTime = startTime;
        rtspState.startTime = startTime;
        rtspState.endTime = endTime;
        rtspState.streamStartTimestamp = Date.now();
        rtspState.speed = speed;
        rtspState.loop = loop;
        rtspState.loopCount = 0;
        // 重置统计信息
        rtspState.stats = { fps: 0, bitrate: 0, frames: 0, droppedFrames: 0, speed: '0x', size: 0 };
        
        let stderrBuffer = '';
        let hasStarted = false;
        
        ffmpeg.stderr.on('data', (data) => {
            const msg = data.toString();
            stderrBuffer += msg;
            
            // 解析时间进度: time=00:01:23.45
            const timeMatch = msg.match(/time=(\d{2}):(\d{2}):(\d{2})\.(\d{2})/);
            if (timeMatch) {
                hasStarted = true;
                const h = parseInt(timeMatch[1]);
                const m = parseInt(timeMatch[2]);
                const s = parseInt(timeMatch[3]);
                const progressTime = h * 3600 + m * 60 + s;
                rtspState.currentTime = rtspState.startTime + progressTime;
            }
            
            // 解析帧率: fps= 24
            const fpsMatch = msg.match(/fps=\s*(\d+(?:\.\d+)?)/);
            if (fpsMatch) {
                rtspState.stats.fps = parseFloat(fpsMatch[1]);
            }
            
            // 解析码率: bitrate= 3205.3kbits/s
            const bitrateMatch = msg.match(/bitrate=\s*(\d+(?:\.\d+)?)\s*kbits/);
            if (bitrateMatch) {
                rtspState.stats.bitrate = parseFloat(bitrateMatch[1]);
            }
            
            // 解析帧数: frame= 1234
            const frameMatch = msg.match(/frame=\s*(\d+)/);
            if (frameMatch) {
                rtspState.stats.frames = parseInt(frameMatch[1]);
            }
            
            // 解析丢帧: drop= 0
            const dropMatch = msg.match(/drop=\s*(\d+)/);
            if (dropMatch) {
                rtspState.stats.droppedFrames = parseInt(dropMatch[1]);
            }
            
            // 解析推流速度: speed= 1.0x
            const speedMatch = msg.match(/speed=\s*(\d+(?:\.\d+)?x)/);
            if (speedMatch) {
                rtspState.stats.speed = speedMatch[1];
            }
            
            // 解析已推送大小: size= 12345kB
            const sizeMatch = msg.match(/size=\s*(\d+)\s*kB/);
            if (sizeMatch) {
                rtspState.stats.size = parseInt(sizeMatch[1]) * 1024;
            }
        });
        
        ffmpeg.on('close', (code) => {
            if (rtspState.streamProcess === ffmpeg) {
                // 检查是否是循环推流且正常结束
                if (loop && code === 0 && rtspState.isStreaming) {
                    rtspState.loopCount++;
                    logger.info('[RTSP推流]', `循环 | 第 ${rtspState.loopCount} 次循环结束，继续推流...`);
                    // 循环由 FFmpeg -stream_loop 自动处理
                    return;
                }
                
                rtspState.isStreaming = false;
                rtspState.streamProcess = null;
                
                if (code !== 0 && !hasStarted) {
                    const errorLines = stderrBuffer.split('\n').slice(-10).join('\n');
                    logger.error('[RTSP推流]', `失败 | 退出码: ${code}\n${errorLines}`);
                } else {
                    logger.info('[RTSP推流]', `结束 | 退出码: ${code} | 已推送 ${rtspState.stats.frames} 帧`);
                }
            }
        });
        
        ffmpeg.on('error', (err) => {
            logger.error('[RTSP推流]', `错误: ${err.message}`);
            reject(err);
        });
        
        // 等待一段时间检查是否成功启动
        setTimeout(() => {
            if (ffmpeg && !ffmpeg.killed && rtspState.isStreaming) {
                resolve();
            } else if (!hasStarted) {
                const errorLines = stderrBuffer.split('\n').filter(l => l.includes('Error') || l.includes('error')).join('\n');
                if (errorLines) {
                    reject(new Error(errorLines.substring(0, 200)));
                } else {
                    resolve();
                }
            }
        }, 800);
    });
}

/**
 * 推送静帧（暂停时使用）
 */
function startPauseFrameStream(videoPath, frameTime) {
    return new Promise(async (resolve, reject) => {
        const config = getConfig();
        const rtspConfig = getRtspConfig();
        const rtspUrl = `rtsp://localhost:${rtspConfig.rtspPort}/${rtspConfig.streamName}`;
        
        // 先截取当前帧为图片
        const pauseFramePath = path.join(TEMP_DIR, `pause_frame_${Date.now()}.jpg`);
        rtspState.pauseFramePath = pauseFramePath;
        
        const captureArgs = [
            '-ss', formatDuration(frameTime),
            '-i', videoPath,
            '-vframes', '1',
            '-q:v', '2',
            '-y',
            pauseFramePath
        ];
        
        // 截取帧
        await new Promise((res, rej) => {
            const capture = spawn(config.ffmpegPath, captureArgs);
            capture.on('close', (code) => {
                if (code === 0 && fs.existsSync(pauseFramePath)) {
                    res();
                } else {
                    rej(new Error('截取帧失败'));
                }
            });
            capture.on('error', rej);
        });
        
        logger.info('[RTSP推流]', `暂停 | 推送静帧 @ ${formatDuration(frameTime)}`);
        
        // 循环推送静帧
        const ffmpegArgs = [
            '-re',
            '-loop', '1',              // 循环
            '-i', pauseFramePath,
            '-c:v', 'libx264',
            '-preset', 'ultrafast',
            '-tune', 'stillimage',
            '-pix_fmt', 'yuv420p',
            '-r', '1',                 // 1fps，减少CPU占用
            '-f', 'rtsp',
            '-rtsp_transport', 'tcp',
            rtspUrl
        ];
        
        const ffmpeg = spawn(config.ffmpegPath, ffmpegArgs);
        rtspState.streamProcess = ffmpeg;
        rtspState.isPaused = true;
        rtspState.isStreaming = true;
        
        ffmpeg.on('close', (code) => {
            if (rtspState.streamProcess === ffmpeg) {
                rtspState.isStreaming = false;
                rtspState.isPaused = false;
                rtspState.streamProcess = null;
            }
        });
        
        ffmpeg.on('error', (err) => {
            logger.error('[RTSP推流]', `静帧推送错误: ${err.message}`);
            reject(err);
        });
        
        setTimeout(() => resolve(), 500);
    });
}

/**
 * 开始推流API
 */
app.post('/api/rtsp/stream/start', async (req, res) => {
    const { videoPath, startTime = 0, endTime = 0, speed = 1, loop = false } = req.body;
    
    if (!videoPath) {
        res.json({ success: false, error: '请提供视频路径' });
        return;
    }
    
    if (!fs.existsSync(videoPath)) {
        res.json({ success: false, error: '视频文件不存在' });
        return;
    }
    
    if (!rtspState.serverRunning) {
        res.json({ success: false, error: '请先启动 RTSP 服务器' });
        return;
    }
    
    // 验证速度参数
    const validSpeeds = [0.5, 0.75, 1, 1.25, 1.5, 2, 4];
    if (!validSpeeds.includes(speed)) {
        res.json({ success: false, error: `不支持的速度: ${speed}x，支持: ${validSpeeds.join(', ')}` });
        return;
    }
    
    // 停止当前推流
    stopRtspStream();
    
    try {
        await startRtspStreamInternal(videoPath, startTime, { speed, endTime, loop });
        
        const rtspConfig = getRtspConfig();
        const localIP = getLocalIP();
        const rtspUrl = `rtsp://${localIP}:${rtspConfig.rtspPort}/${rtspConfig.streamName}`;
        
        res.json({
            success: true,
            rtspUrl,
            message: '推流已开始',
            options: { speed, endTime, loop }
        });
    } catch (e) {
        res.json({ success: false, error: e.message });
    }
});

/**
 * 停止推流API
 */
app.post('/api/rtsp/stream/stop', (req, res) => {
    stopRtspStream();
    logger.info('[RTSP推流]', '推流已停止');
    res.json({ success: true });
});

/**
 * 暂停推流API（切换到静帧模式）
 */
app.post('/api/rtsp/stream/pause', async (req, res) => {
    if (!rtspState.isStreaming || !rtspState.currentVideoPath) {
        res.json({ success: false, error: '没有正在进行的推流' });
        return;
    }
    
    if (rtspState.isPaused) {
        res.json({ success: true, message: '已经处于暂停状态' });
        return;
    }
    
    const currentTime = rtspState.currentTime;
    const videoPath = rtspState.currentVideoPath;
    
    // 停止当前推流
    if (rtspState.streamProcess) {
        rtspState.streamProcess.kill('SIGKILL');
        rtspState.streamProcess = null;
    }
    
    try {
        await startPauseFrameStream(videoPath, currentTime);
        res.json({ success: true, message: '推流已暂停（推送静帧）' });
    } catch (e) {
        res.json({ success: false, error: e.message });
    }
});

/**
 * 恢复推流API（从静帧模式切换回视频）
 */
app.post('/api/rtsp/stream/resume', async (req, res) => {
    if (!rtspState.isStreaming || !rtspState.currentVideoPath) {
        res.json({ success: false, error: '没有正在进行的推流' });
        return;
    }
    
    if (!rtspState.isPaused) {
        res.json({ success: true, message: '推流未暂停' });
        return;
    }
    
    const currentTime = rtspState.currentTime;
    const videoPath = rtspState.currentVideoPath;
    
    // 保留之前的推流设置
    const previousOptions = {
        speed: rtspState.speed,
        endTime: rtspState.endTime,
        loop: rtspState.loop
    };
    
    // 停止静帧推流
    stopRtspStream();
    
    try {
        await startRtspStreamInternal(videoPath, currentTime, previousOptions);
        res.json({ success: true, message: '推流已恢复' });
    } catch (e) {
        res.json({ success: false, error: e.message });
    }
});

/**
 * 跳转推流位置API（保留之前的推流设置）
 */
app.post('/api/rtsp/stream/seek', async (req, res) => {
    const { time } = req.body;
    
    if (time === undefined || time < 0) {
        res.json({ success: false, error: '无效的时间' });
        return;
    }
    
    if (!rtspState.currentVideoPath) {
        res.json({ success: false, error: '没有正在进行的推流' });
        return;
    }
    
    const videoPath = rtspState.currentVideoPath;
    const wasPaused = rtspState.isPaused;
    // 保留之前的推流设置
    const previousOptions = {
        speed: rtspState.speed,
        endTime: rtspState.endTime,
        loop: rtspState.loop
    };
    
    // 停止当前推流
    stopRtspStream();
    
    try {
        if (wasPaused) {
            // 如果之前是暂停状态，跳转后继续暂停
            await startPauseFrameStream(videoPath, time);
        } else {
            // 使用保留的设置
            await startRtspStreamInternal(videoPath, time, previousOptions);
        }
        
        rtspState.currentTime = time;
        logger.info('[RTSP推流]', `跳转到 ${formatDuration(time)}`);
        res.json({ success: true, message: `已跳转到 ${formatDuration(time)}` });
    } catch (e) {
        res.json({ success: false, error: e.message });
    }
});

/**
 * 获取推流状态API（包含详细监控信息）
 */
app.get('/api/rtsp/stream/status', (req, res) => {
    const rtspConfig = getRtspConfig();
    const localIP = getLocalIP();
    
    // 计算实时的当前时间（如果正在推流且未暂停）
    let currentTime = rtspState.currentTime;
    if (rtspState.isStreaming && !rtspState.isPaused && rtspState.streamStartTimestamp > 0) {
        const elapsed = (Date.now() - rtspState.streamStartTimestamp) / 1000;
        currentTime = rtspState.startTime + elapsed * rtspState.speed;
    }
    
    res.json({
        success: true,
        serverRunning: rtspState.serverRunning,
        isStreaming: rtspState.isStreaming,
        isPaused: rtspState.isPaused,
        currentTime: currentTime,
        startTime: rtspState.startTime,
        endTime: rtspState.endTime,
        videoPath: rtspState.currentVideoPath,
        rtspUrl: rtspState.serverRunning 
            ? `rtsp://${localIP}:${rtspConfig.rtspPort}/${rtspConfig.streamName}`
            : null,
        // 推流选项
        options: {
            speed: rtspState.speed,
            loop: rtspState.loop,
            loopCount: rtspState.loopCount
        },
        // 实时统计信息
        stats: rtspState.stats
    });
});

/**
 * 获取本机IP API
 */
app.get('/api/rtsp/local-ip', (req, res) => {
    res.json({
        success: true,
        ip: getLocalIP()
    });
});

// ==================== 启动服务 ====================

app.listen(PORT, () => {
    logger.raw('');
    logger.raw('============================================================');
    logger.raw('           视频剪辑工具 已启动');
    logger.raw('============================================================');
    logger.raw(`  访问地址: http://localhost:${PORT}`);
    logger.raw('  按 Ctrl+C 停止服务');
    logger.raw(`  日志目录: ${logger.getLogDir()}`);
    logger.raw('============================================================');
    logger.raw('');
    
    // 确保输出目录存在
    ensureOutputDir();
});
