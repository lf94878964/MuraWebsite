#!/usr/bin/env python3
"""
scripts/check-calculator.py — 檢查網頁版計算機的「可用函數」清單有沒有跟引擎對齊。

    pip install sympy          # 只需要這個
    python3 scripts/check-calculator.py

做兩件事：
  1. 引擎（py/calc_engine.py）的 build_namespace() 裡每一個函數／常數，都要出現在
     data/calculator-functions.json（名稱或別名）。機器人新增函數後，這裡會告訴你漏了哪些。
  2. JSON 裡每個範例（ex）真的丟進引擎算一次，結果要跟 out 一致（隨機與佔位符範例略過）。
"""
import json
import os
import re
import sys
import warnings

warnings.filterwarnings("ignore")
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "py"))

import sympy  # noqa: E402
from sympy import MatrixBase  # noqa: E402

import calc_engine as E  # noqa: E402

# 引擎內部用的建構子，使用者不會直接呼叫，不需要列在清單裡
INTERNAL = {"Integer", "Float", "Rational", "Symbol", "Add", "Mul", "Pow"}
# 希臘字母寫法 → 引擎名稱（σ(n) 會被前處理成 divisor_sigma(n)）
GREEK = {"τ": "divisor_count", "σ": "divisor_sigma", "ω": "prime_omega", "Ω": "prime_bigomega",
         "μ": "mobius", "λ": "liouville", "π": "prime_pi", "φ": "totient"}
# 清單用「語法」呈現的名稱 → 實際在引擎裡的函式
SYNTAX_NAMES = {"limit": "lim", "integrate": "∫", "summation": "Σ", "product": "∏",
                "factorial2": "!!", "π": "pi", "tau": "τ"}

with open(os.path.join(ROOT, "data", "calculator-functions.json"), encoding="utf-8") as f:
    data = json.load(f)

listed = set()
for g in data["groups"]:
    for it in g["items"]:
        for text in [it["name"], *it.get("alias", [])]:
            listed.update(re.findall(r"[^\W\d]\w*", text))
            listed.update(ch for ch in text if ch in GREEK)
listed |= {GREEK[c] for c in list(listed) if c in GREEK}

ns_keys = set()
for mode in ("scalar", "vector", "matrix"):
    for ang in ("radian", "degree"):
        ns_keys |= set(E.build_namespace(mode, ang, allow_random=True))
ns_keys -= INTERNAL

missing = sorted(k for k in ns_keys if k not in listed)
# i / I / oo / inf / e 等已用別名列出；剩下的才是真的漏掉
print(f"引擎共 {len(ns_keys)} 個名稱，清單漏列 {len(missing)} 個：{missing or '無'}")

fails = 0
checked = 0
for g in data["groups"]:
    for it in g["items"]:
        ex, out = it["ex"], it.get("out")
        if ex.startswith("random("):
            continue
        try:
            raw = E.substitute_placeholders(E.normalize_input(ex), it.get("vars"))
            mode = E.detect_mode(raw)
            res = E._do_calculate(raw, mode, it.get("angle", "radian")).result
        except Exception as e:  # noqa: BLE001
            fails += 1
            print(f"  ✗ {ex}  → 引擎報錯：{e}")
            continue
        checked += 1
        if out is None:
            continue

        def one(v):
            if isinstance(v, MatrixBase):
                r, c = v.shape
                if r == 1 or c == 1:
                    return "[" + ", ".join(one(x) for x in v) + "]"
                return "[" + ", ".join("[" + ", ".join(one(v[i, j]) for j in range(c)) + "]" for i in range(r)) + "]"
            p = sympy.pretty(v, use_unicode=True)
            if "\n" in p:
                p = re.sub(r"\bpi\b", "π", str(v).replace("**", "^"))
            return p

        got = one(res) if (isinstance(res, MatrixBase) or hasattr(res, "has")) else str(res).replace("**", "^")
        got = got.replace("⋅ⅈ", "i").replace("ⅈ", "i").replace("ℯ", "e").replace("⋅π", "π")
        if got != out:
            fails += 1
            print(f"  ✗ {ex}  → 引擎給 {got!r}，清單寫 {out!r}")

print(f"範例 {checked} 個已執行，{fails} 個有問題")
sys.exit(1 if (missing or fails) else 0)
