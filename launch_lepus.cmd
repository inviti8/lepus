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
rem    launch_lepus.cmd --purge             (purge startup cache before run --
rem                                          use after XUL/CSS/manifest changes
rem                                          land that aren't picked up by a
rem                                          warm-cache restart)
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

rem Detect a leading --purge flag and translate it to mach run --purgecaches.
rem Done with a goto-based shift loop because cmd batch can't reliably
rem rebuild %* inside an if-block.
set PURGE_FLAG=
if "%~1"=="--purge" (
  set PURGE_FLAG=--purgecaches
  shift
  goto build_args
)
set RUN_ARGS=%*
goto print_banner

:build_args
set RUN_ARGS=
:build_args_loop
if "%~1"=="" goto print_banner
set RUN_ARGS=%RUN_ARGS% %1
shift
goto build_args_loop

:print_banner
echo [launch_lepus] Starting Lepus...
echo [launch_lepus]   repo:      %CD%
echo [launch_lepus]   MOZCONFIG: %MOZCONFIG%
if defined PURGE_FLAG (
  echo [launch_lepus]   purge:     yes -- chrome startup cache will be rebuilt
)
echo [launch_lepus]   args:     %RUN_ARGS%
echo.

call mach.cmd run %PURGE_FLAG% %RUN_ARGS%

set EXIT_CODE=%ERRORLEVEL%
popd
exit /b %EXIT_CODE%
