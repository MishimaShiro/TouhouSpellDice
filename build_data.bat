@echo off
chcp 65001 > nul
echo ============================================================
echo 東方スペルカード抽選器 - データ生成ツール
echo SpellList.csv -^> spellData.js
echo ============================================================
echo.

where python >nul 2>nul
if %ERRORLEVEL% NEQ 0 (
    echo [エラー] Python が見つかりませんでした。
    echo Python 3 がインストールされ、PATH に登録されているか確認してください。
    echo.
    pause
    exit /b 1
)

python build_data.py
if %ERRORLEVEL% EQU 0 (
    echo.
    echo 完了しました。何かキーを押すとこのウィンドウを閉じます。
) else (
    echo.
    echo [エラー] データ生成中にエラーが発生しました。
)
echo.
pause
