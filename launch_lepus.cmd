@echo off
rem ============================================================
rem  LEPUS dev launcher (Windows cmd / PowerShell / double-click)
rem
rem  Starts the built Lepus binary via mach run, which ensures:
rem    - -no-remote          (refuse to join an existing firefox.exe
rem                           process, so a fresh JS module context
rem                           is always loaded)
rem    - -profile obj-lepus/tmp/profile-default
rem                          (dev profile isolated from stock Firefox)
rem    - MOZCONFIG=mozconfig.lepus
rem                          (uses the Lepus build config and objdir)
rem
rem  Usage:
rem    double-click this file, OR
rem    launch_lepus.cmd                     (from cmd.exe)
rem    .\launch_lepus.cmd                   (from PowerShell)
rem    launch_lepus.cmd --new-window https://example.com
rem                                         (extra args passed to mach run)
rem ============================================================

rem cd to the directory this script lives in, regardless of where it
rem was invoked from.
pushd "%~dp0"

if not exist "mozconfig.lepus" (
  echo [launch_lepus] ERROR: mozconfig.lepus not found in %CD%
  echo                        Are you sure this is the Lepus repo root?
  popd
  exit /b 1
)
if not exist "mach.cmd" (
  echo [launch_lepus] ERROR: mach.cmd not found in %CD%
  popd
  exit /b 1
)

set MOZCONFIG=mozconfig.lepus

echo [launch_lepus] Starting Lepus...
echo [launch_lepus]   repo:     %CD%
echo [launch_lepus]   MOZCONFIG: %MOZCONFIG%
echo [launch_lepus]   args:     %*
echo.

call mach.cmd run %*

set EXIT_CODE=%ERRORLEVEL%
popd
exit /b %EXIT_CODE%
