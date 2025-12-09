/**
 * 日志管理模块
 * 功能：统一日志输出，支持控制台和文件双输出，带时间戳（精确到毫秒）
 */

const fs = require('fs');
const path = require('path');

// 日志目录
const LOG_DIR = path.join(__dirname, 'logs');

// 确保日志目录存在
if (!fs.existsSync(LOG_DIR)) {
    fs.mkdirSync(LOG_DIR, { recursive: true });
}

// 当前日志文件路径（按日期分文件）
let currentLogFile = null;
let currentLogDate = null;
let logStream = null;

/**
 * 获取当前日志文件路径
 */
function getLogFilePath() {
    const now = new Date();
    const dateStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    
    // 如果日期变了，更新日志文件
    if (dateStr !== currentLogDate) {
        currentLogDate = dateStr;
        currentLogFile = path.join(LOG_DIR, `app_${dateStr}.log`);
        
        // 关闭旧的流
        if (logStream) {
            logStream.end();
        }
        
        // 如果是新文件，先写入 UTF-8 BOM
        const isNewFile = !fs.existsSync(currentLogFile);
        
        // 创建新的写入流（追加模式）
        logStream = fs.createWriteStream(currentLogFile, { flags: 'a', encoding: 'utf8' });
        
        // 写入 UTF-8 BOM，让 Windows 记事本正确识别编码
        if (isNewFile) {
            logStream.write('\uFEFF');
        }
    }
    
    return currentLogFile;
}

/**
 * 格式化时间戳（精确到毫秒）
 * 格式: YYYY-MM-DD HH:mm:ss.SSS
 */
function formatTimestamp(date = new Date()) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    const seconds = String(date.getSeconds()).padStart(2, '0');
    const ms = String(date.getMilliseconds()).padStart(3, '0');
    
    return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}.${ms}`;
}

/**
 * 写入日志
 * @param {string} level - 日志级别 (INFO, WARN, ERROR, DEBUG)
 * @param {string} category - 分类标签 (如 [剪辑], [转码] 等)
 * @param {string} message - 日志内容
 */
function writeLog(level, category, message) {
    const timestamp = formatTimestamp();
    const logLine = `[${timestamp}] [${level}] ${category} ${message}`;
    
    // 输出到控制台
    const consoleMethod = level === 'ERROR' ? console.error : console.log;
    consoleMethod(logLine);
    
    // 写入文件
    getLogFilePath();
    if (logStream) {
        logStream.write(logLine + '\n');
    }
}

/**
 * 日志接口
 */
const logger = {
    /**
     * 信息日志
     */
    info(category, message) {
        writeLog('INFO', category, message);
    },
    
    /**
     * 警告日志
     */
    warn(category, message) {
        writeLog('WARN', category, message);
    },
    
    /**
     * 错误日志
     */
    error(category, message) {
        writeLog('ERROR', category, message);
    },
    
    /**
     * 调试日志
     */
    debug(category, message) {
        writeLog('DEBUG', category, message);
    },
    
    /**
     * 直接输出（不带分类，用于启动信息等）
     */
    raw(message) {
        const timestamp = formatTimestamp();
        const logLine = `[${timestamp}] ${message}`;
        console.log(logLine);
        
        getLogFilePath();
        if (logStream) {
            logStream.write(logLine + '\n');
        }
    },
    
    /**
     * 获取日志目录路径
     */
    getLogDir() {
        return LOG_DIR;
    },
    
    /**
     * 关闭日志流（程序退出时调用）
     */
    close() {
        if (logStream) {
            logStream.end();
            logStream = null;
        }
    }
};

// 程序退出时关闭日志流
process.on('exit', () => logger.close());
process.on('SIGINT', () => {
    logger.close();
    process.exit(0);
});
process.on('SIGTERM', () => {
    logger.close();
    process.exit(0);
});

module.exports = logger;

