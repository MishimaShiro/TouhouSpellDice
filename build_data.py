#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
東方スペルカード抽選器 - データ生成スクリプト (build_data.py)
SpellList.csv (マスターデータ) を読み込み、file:// 実行用の内蔵データ spellData.js を自動生成します。

使い方:
    python build_data.py
"""

import sys
import os
import json
import datetime

# Windowsコンソールの文字化け・エンコード例外防止
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")

# ファイルパス定義
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
CSV_PATH = os.path.join(SCRIPT_DIR, "SpellList.csv")
JS_PATH = os.path.join(SCRIPT_DIR, "spellData.js")


def read_csv_file(path: str) -> tuple[str, str]:
    """
    CSVファイルを適切なエンコーディング（UTF-8, UTF-8-BOM, CP932/Shift-JIS）で読み込みます。
    """
    if not os.path.exists(path):
        raise FileNotFoundError(f"CSVファイルが見つかりません: {path}")

    with open(path, "rb") as f:
        raw_bytes = f.read()

    # エンコーディングの自動判別試行
    encodings_to_try = [
        ("utf-8-sig", "UTF-8 (BOM付き)"),
        ("utf-8", "UTF-8"),
        ("cp932", "Shift-JIS (CP932)"),
    ]

    for enc, label in encodings_to_try:
        try:
            text = raw_bytes.decode(enc)
            return text, label
        except (UnicodeDecodeError, LookupError):
            continue

    raise UnicodeDecodeError("csv", raw_bytes, 0, len(raw_bytes), "対応する文字コード（UTF-8またはShift-JIS）でデコードできませんでした。")


def generate_spell_data():
    print("=" * 60)
    print("東方スペルカード抽選器: spellData.js 自動生成")
    print("=" * 60)

    # 1. CSV読み込み
    try:
        csv_text, enc_name = read_csv_file(CSV_PATH)
        print(f"[*] マスターCSV読込完了: {os.path.basename(CSV_PATH)} ({enc_name})")
    except Exception as e:
        print(f"[!] エラー: CSVファイルの読み込みに失敗しました: {e}", file=sys.stderr)
        sys.exit(1)

    # 2. 改行コードの正規化 (\r\n -> \n)
    normalized_csv = csv_text.replace("\r\n", "\n").replace("\r", "\n").strip()
    lines = normalized_csv.split("\n")
    data_rows = len(lines) - 1

    if data_rows <= 0:
        print("[!] エラー: CSVデータが空またはヘッダー行のみです。", file=sys.stderr)
        sys.exit(1)

    header = lines[0]
    print(f"[*] データ件数: {data_rows} 件 (ヘッダー: {header[:40]}...)")

    # 3. JavaScript用コードの生成
    # json.dumps を使用してエスケープ（改行、クォート等を安全に処理）
    json_escaped_csv = json.dumps(normalized_csv, ensure_ascii=False)
    timestamp = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")

    js_content = f"""/**
 * 東方スペルカード抽選器 - デフォルト内蔵データ
 * ※ このファイルは SpellList.csv から自動生成されています。手動で直接編集しないでください。
 * ※ 生成日時: {timestamp} / 収録データ件数: {data_rows} 件
 */
window.DEFAULT_SPELL_CSV = {json_escaped_csv};
"""

    # 4. 出力 (UTF-8)
    try:
        with open(JS_PATH, "w", encoding="utf-8", newline="\n") as f:
            f.write(js_content)
        file_size_kb = os.path.getsize(JS_PATH) / 1024
        print(f"[*] 出力完了: {os.path.basename(JS_PATH)} ({file_size_kb:.1f} KB)")
        print(f"[OK] 成功: {data_rows} 件のスペルカードデータを spellData.js に反映しました。")
        print("=" * 60)
    except Exception as e:
        print(f"[!] エラー: JSファイルの書き出しに失敗しました: {e}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    generate_spell_data()
