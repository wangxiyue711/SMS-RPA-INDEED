@echo off
chcp 65001 >nul
rem one_click_start.bat - robust one-click installer + starter
rem Features:
rem - create virtual environment
rem - install requirements.txt
rem - optionally download rpa script from RPA_SCRIPT_URL
rem - accept --sa-file to specify service account
setlocal enabledelayedexpansion
set SCRIPT_DIR=%~dp0
set PAUSE_ON_EXIT=0
for %%A in (%*) do (
  if /I "%%~A"=="--pause" set PAUSE_ON_EXIT=1
  if /I "%%~A"=="--sa-file" (
    rem support --sa-file=path style handled later by worker arg parsing
  )
)
echo ワンクリック起動: %SCRIPT_DIR%

rem If requirements.txt missing, create a default one (safe fallback)
if not exist "%SCRIPT_DIR%requirements.txt" (
  echo requirements.txt not found. Creating default requirements.txt in %SCRIPT_DIR%
  > "%SCRIPT_DIR%requirements.txt" echo google-cloud-firestore
  >> "%SCRIPT_DIR%requirements.txt" echo firebase-admin
  >> "%SCRIPT_DIR%requirements.txt" echo cryptography
  >> "%SCRIPT_DIR%requirements.txt" echo undetected-chromedriver
  >> "%SCRIPT_DIR%requirements.txt" echo selenium
  >> "%SCRIPT_DIR%requirements.txt" echo beautifulsoup4
  >> "%SCRIPT_DIR%requirements.txt" echo lxml
  >> "%SCRIPT_DIR%requirements.txt" echo requests
  echo Created %SCRIPT_DIR%requirements.txt
)

rem Create venv if not exists
if not exist "%SCRIPT_DIR%.venv\Scripts\activate.bat" (
  echo 仮想環境を作成しています...
  python -m venv "%SCRIPT_DIR%.venv"
  if errorlevel 1 (
    echo 仮想環境の作成に失敗しました。Python が PATH にあるか確認してください。
    exit /b 1
  )
)

echo 仮想環境を有効化しています...
call "%SCRIPT_DIR%.venv\Scripts\activate.bat"

echo 依存パッケージをインストール中です...
set INSTALL_LOG=%SCRIPT_DIR%install.log
echo インストールログを %INSTALL_LOG% に出力します
echo ---- install started at %DATE% %TIME% ---- > "%INSTALL_LOG%"
python -m pip install --upgrade pip setuptools wheel >> "%INSTALL_LOG%" 2>&1
python -m pip install -r "%SCRIPT_DIR%requirements.txt" >> "%INSTALL_LOG%" 2>&1
if %ERRORLEVEL% NEQ 0 (
  echo 依存関係のインストールに失敗しました。詳細は %INSTALL_LOG% を参照してください。
  echo ログを確認できます: %INSTALL_LOG%
  if "%PAUSE_ON_EXIT%"=="1" (
    echo Press any key to continue...
    pause
  )
  exit /b 1
)
echo 依存関係のインストールが完了しました。詳細は %INSTALL_LOG% を参照してください。


rem If RPA script missing and RPA_SCRIPT_URL env var set, try download
set RPA_LOCAL=%SCRIPT_DIR%rpa_gmail_indeed_test.py
if not exist "%RPA_LOCAL%" (
  if defined RPA_SCRIPT_URL (
    echo rpa_gmail_indeed_test.py がローカルに見つかりません。%RPA_SCRIPT_URL% からダウンロードを試みます
    powershell -Command "try{ Invoke-WebRequest -Uri '%RPA_SCRIPT_URL%' -OutFile '%RPA_LOCAL%'; exit 0 } catch { exit 1 }"
    if errorlevel 1 (
      echo %RPA_SCRIPT_URL% からのダウンロードに失敗しました
    ) else (
      echo rpa_gmail_indeed_test.py を %RPA_LOCAL% にダウンロードしました
    )
  )
)

rem Resolve service account JSON path
set SERVICE_ACCOUNT_PATH=
if exist "%SCRIPT_DIR%service-account.json" (
  set SERVICE_ACCOUNT_PATH=%SCRIPT_DIR%service-account.json
  echo サービスアカウントを使用: %SERVICE_ACCOUNT_PATH%
)
if not defined SERVICE_ACCOUNT_PATH (
  if defined GOOGLE_APPLICATION_CREDENTIALS (
    set SERVICE_ACCOUNT_PATH=%GOOGLE_APPLICATION_CREDENTIALS%
    echo 環境変数 GOOGLE_APPLICATION_CREDENTIALS を使用: %SERVICE_ACCOUNT_PATH%
  )
)

rem If service-account.json not present, prompt user to pick a file via PowerShell dialog (one-time)
if not exist "%SCRIPT_DIR%service-account.json" (
  echo service-account.json not found in %SCRIPT_DIR%. Opening file picker to choose the service account JSON...
  powershell -NoProfile -Command "Add-Type -AssemblyName System.Windows.Forms; $ofd = New-Object System.Windows.Forms.OpenFileDialog; $ofd.Filter='JSON Files (*.json)|*.json'; $ofd.InitialDirectory='%USERPROFILE%'; if($ofd.ShowDialog() -eq 'OK'){ Copy-Item -Path $ofd.FileName -Destination '%SCRIPT_DIR%service-account.json' ; exit 0 } else { exit 1 }"
  if errorlevel 1 (
    echo No service account selected. Cannot continue. Exiting.
    exit /b 1
  ) else (
    set SERVICE_ACCOUNT_PATH=%SCRIPT_DIR%service-account.json
    echo Copied service account to %SERVICE_ACCOUNT_PATH%
  )
)

rem allow user to pass --sa-file=path as argument
for %%A in (%*) do (
  echo %%~A | findstr /R /C:"--sa-file=.*" >nul && (
    for /f "tokens=1* delims==" %%i in ("%%~A") do set SERVICE_ACCOUNT_PATH=%%j
  )
)

if not defined SERVICE_ACCOUNT_PATH (
  echo Error: service account JSON not found. Place service-account.json in worker folder, set GOOGLE_APPLICATION_CREDENTIALS, or pass --sa-file=PATH
  exit /b 1
)
rem Ensure RPA script exists; if not, try download or prompt user to select
set RPA_LOCAL=%SCRIPT_DIR%rpa_gmail_indeed_test.py
if not exist "%RPA_LOCAL%" (
  if defined RPA_SCRIPT_URL (
    echo rpa_gmail_indeed_test.py not found; attempting download from %RPA_SCRIPT_URL%
    powershell -Command "try{ Invoke-WebRequest -Uri '%RPA_SCRIPT_URL%' -OutFile '%RPA_LOCAL%'; exit 0 } catch { exit 1 }"
    if errorlevel 1 (
      echo Download failed. Opening file picker to select local rpa_gmail_indeed_test.py
      powershell -NoProfile -Command "Add-Type -AssemblyName System.Windows.Forms; $ofd = New-Object System.Windows.Forms.OpenFileDialog; $ofd.Filter='Python Files (*.py)|*.py'; if($ofd.ShowDialog() -eq 'OK'){ Copy-Item -Path $ofd.FileName -Destination '%RPA_LOCAL%'; exit 0 } else { exit 1 }"
      if errorlevel 1 (
        echo No rpa script selected. Worker requires rpa_gmail_indeed_test.py. Exiting.
        exit /b 1
      )
    ) else (
      echo Downloaded rpa_gmail_indeed_test.py to %RPA_LOCAL%
    )
  ) else (
    echo rpa_gmail_indeed_test.py not found. Opening file picker to select local rpa_gmail_indeed_test.py
    powershell -NoProfile -Command "Add-Type -AssemblyName System.Windows.Forms; $ofd = New-Object System.Windows.Forms.OpenFileDialog; $ofd.Filter='Python Files (*.py)|*.py'; if($ofd.ShowDialog() -eq 'OK'){ Copy-Item -Path $ofd.FileName -Destination '%RPA_LOCAL%'; exit 0 } else { exit 1 }"
    if errorlevel 1 (
      echo No rpa script selected. Worker requires rpa_gmail_indeed_test.py. Exiting.
      exit /b 1
    )
  )
)

rem Start worker in foreground so user can input UID interactively
set PY_EXE=%SCRIPT_DIR%.venv\Scripts\python.exe
if exist "%PY_EXE%" (
  set "PY_CMD=%PY_EXE%"
) else (
  set "PY_CMD=python"
)

rem Export service account for this session so worker and child processes can access Firestore
set GOOGLE_APPLICATION_CREDENTIALS=%SERVICE_ACCOUNT_PATH%
echo Using GOOGLE_APPLICATION_CREDENTIALS=%GOOGLE_APPLICATION_CREDENTIALS%

echo ワーカーを起動します（UID を入力すると監視モードを開始します）。
"%PY_CMD%" "%SCRIPT_DIR%worker.py"

endlocal
