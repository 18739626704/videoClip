@echo off
chcp 65001 >nul 2>&1
title 视频剪辑工具

:: 设置颜色
color 0A

echo.
echo ╔═══════════════════════════════════════════════════════════════╗
echo ║                     视频剪辑工具 启动器                        ║
echo ╚═══════════════════════════════════════════════════════════════╝
echo.

:: 切换到脚本所在目录
cd /d "%~dp0"

:: 检查 Node.js 是否安装
echo [检查] 正在检查 Node.js 环境...
where node >nul 2>&1
if %errorlevel% neq 0 (
    color 0C
    echo.
    echo ╔═══════════════════════════════════════════════════════════════╗
    echo ║  [错误] 未检测到 Node.js，请先安装 Node.js                    ║
    echo ║                                                               ║
    echo ║  下载地址: https://nodejs.org/                                ║
    echo ║  建议下载 LTS 版本，安装时保持默认选项即可                    ║
    echo ╚═══════════════════════════════════════════════════════════════╝
    echo.
    pause
    exit /b 1
)

:: 显示 Node.js 版本
for /f "tokens=*" %%i in ('node -v') do set NODE_VERSION=%%i
echo [完成] Node.js 版本: %NODE_VERSION%

:: 检查是否需要安装依赖
if not exist "node_modules" (
    echo.
    echo [安装] 首次运行，正在安装依赖包...
    echo [安装] 这可能需要几分钟，请耐心等待...
    echo.
    call npm install
    if %errorlevel% neq 0 (
        color 0C
        echo.
        echo [错误] 依赖安装失败，请检查网络连接后重试
        pause
        exit /b 1
    )
    echo.
    echo [完成] 依赖安装成功！
) else (
    echo [完成] 依赖已安装
)

echo.
echo ╔═══════════════════════════════════════════════════════════════╗
echo ║                      正在启动服务...                          ║
echo ╚═══════════════════════════════════════════════════════════════╝
echo.

:: 延迟打开浏览器（等待服务启动）
start "" cmd /c "timeout /t 2 /nobreak >nul && start http://localhost:3000"

:: 启动服务器（这会阻塞，关闭窗口即关闭服务）
echo [运行] 服务已启动，浏览器将自动打开
echo [运行] 访问地址: http://localhost:3000
echo.
echo ────────────────────────────────────────────────────────────────
echo   提示: 关闭此窗口将停止服务
echo ────────────────────────────────────────────────────────────────
echo.

node server.js

:: 如果服务器意外退出
echo.
color 0C
echo [错误] 服务器已停止运行
pause

