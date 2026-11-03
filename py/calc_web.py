# -*- coding: utf-8 -*-
"""
calc_web.py — 網頁版計算機的轉接層（在瀏覽器的 Pyodide 裡執行）。

計算本身完全交給機器人原本的引擎（calc_engine.py，即 _engine.py，一個字都沒改）：
  - 預處理、安全檢查、步驟拆解、精確值／小數顯示，行為與 /計算機 指令一致。
  - 機器人是把結果用 matplotlib 畫成 PNG；網頁改成輸出 LaTeX（sympy.latex），由前端的 KaTeX 排版。
  - 機器人用子行程 + 6 秒逾時；網頁改由 Web Worker 計時，逾時就整個 Worker 重開（見 calculator-worker.js）。

對外只有 run(payload_json) -> json 字串；payload = {raw, mode, angle, variables}。
"""
from __future__ import annotations

import json
import re

import sympy
from sympy import MatrixBase

import calc_engine as E


# ────────────────────────────────────────────────────────────────
#  LaTeX 轉換
# ────────────────────────────────────────────────────────────────

def _tex_escape_text(s: str) -> str:
    """把原始輸入放進 \\text{} 之前，跳脫 LaTeX 特殊字元。"""
    table = {
        "\\": r"\textbackslash{}", "{": r"\{", "}": r"\}", "$": r"\$", "&": r"\&",
        "#": r"\#", "%": r"\%", "_": r"\_", "^": r"\^{}", "~": r"\~{}",
    }
    return "".join(table.get(c, c) for c in s)


def _decimal_tex(s: str) -> str:
    """小數字串（如 '-0.333333333333...'、'1.5+2i'）→ LaTeX。"""
    ell = s.endswith("...")
    core = s[:-3] if ell else s
    core = _tex_escape_text(core).replace("-", "{-}")
    return rf"\mathrm{{{core}}}" + (r"\ldots" if ell else "")


def _value_tex(v) -> str:
    """任何一側的值（sympy 物件／純文字／小數格線）→ LaTeX 字串。"""
    if isinstance(v, str):
        return rf"\text{{{_tex_escape_text(v)}}}"
    if isinstance(v, list):  # 小數顯示的矩陣：二維字串陣列
        rows = r" \\ ".join(" & ".join(_decimal_tex(c) for c in row) for row in v)
        return r"\left[\begin{matrix}" + rows + r"\end{matrix}\right]"
    return sympy.latex(v)


def _decimal_scalar_tex(v) -> str:
    return _decimal_tex(v) if isinstance(v, str) else _value_tex(v)


def _equation_tex(lhs, rhs, *, decimal: bool = False) -> str:
    rhs_tex = (_decimal_scalar_tex(rhs) if decimal else _value_tex(rhs))
    if lhs is None:
        return rhs_tex
    lhs_tex = _value_tex(lhs)
    return f"{lhs_tex} = {rhs_tex}"


def _plain(v) -> str:
    """純文字版（機器人『輸出』欄位用的 sympy.pretty）。"""
    try:
        return sympy.pretty(v, use_unicode=True)
    except Exception:
        return str(v)


def _plain_decimal(v) -> str:
    if isinstance(v, str):
        return v
    if isinstance(v, list):
        widths = [max(len(str(row[j])) for row in v) for j in range(len(v[0]))] if v else []
        return "\n".join(
            "[" + "  ".join(str(c).rjust(widths[j]) for j, c in enumerate(row)) + "]" for row in v
        )
    return str(v)


def _safe_tex_equation(lhs, rhs, *, decimal=False) -> str:
    """與 command.py 相同的退路：算式排版失敗時，只放純文字的結果。"""
    try:
        return _equation_tex(lhs, rhs, decimal=decimal)
    except Exception:
        return rf"\text{{{_tex_escape_text(str(rhs))}}}"


# ────────────────────────────────────────────────────────────────
#  主流程（對應 engine.safe_calculate + command.py）
# ────────────────────────────────────────────────────────────────

def _calculate(raw_input: str, requested_mode, angle_unit: str, variables):
    raw = E.normalize_input(raw_input.strip())
    raw = E.substitute_placeholders(raw, variables)
    E._check_raw_safety(E._convert_hex_literals(raw))

    mode = requested_mode or E.detect_mode(raw)
    if mode in ("vector", "matrix") or mode in E._MATRIX_OP_MODES:
        E._check_matrix_dim_safety(raw)

    calc = E._do_calculate(raw, mode, angle_unit)

    original = calc.steps[0][2] if calc.steps else None
    out = {
        "ok": True,
        "mode": calc.mode,
        "result": {
            "tex": _safe_tex_equation(original, calc.result),
            "text": _plain(calc.result),
        },
        "decimal": None,
        "steps": [],
    }

    if E.has_decimal_variant(calc.result):
        dec = E.to_decimal_display_text(calc.result)
        out["decimal"] = {
            "tex": _safe_tex_equation(original, dec, decimal=True),
            "text": _plain_decimal(dec),
        }

    for title, lhs, rhs in calc.steps:
        try:
            tex = _equation_tex(lhs, rhs)
        except Exception:
            tex = rf"\text{{{_tex_escape_text(str(rhs))}}}"
        out["steps"].append({"title": title, "tex": tex})
    return out


def run(payload_json: str) -> str:
    """Worker 的唯一入口。永遠回傳 JSON 字串：{ok:true,...} 或 {ok:false,error}。"""
    try:
        p = json.loads(payload_json)
        out = _calculate(
            str(p.get("raw", "")),
            p.get("mode") or None,
            p.get("angle") or "radian",
            p.get("variables") or None,
        )
    except E.CalcError as e:
        out = {"ok": False, "error": str(e)}
    except RecursionError:
        out = {"ok": False, "error": "算式巢狀太深或運算過於複雜，請簡化後再試一次。"}
    except MemoryError:
        out = {"ok": False, "error": "運算需要的記憶體過多，請縮小數字或矩陣規模。"}
    except Exception as e:  # 與機器人的行為一致：包成友善訊息
        out = {"ok": False, "error": f"計算過程發生未預期的錯誤：{e}"}
    return json.dumps(out, ensure_ascii=False)


def limits() -> str:
    """給前端顯示用的限制值（直接讀引擎常數，避免兩邊不一致）。"""
    return json.dumps({
        "max_number": E.MAX_NUMBER, "max_exponent": E.MAX_EXPONENT,
        "max_fact_arg": E.MAX_FACT_ARG, "max_matrix_dim": E.MAX_MATRIX_DIM,
        "timeout": E.COMPUTE_TIMEOUT, "decimal_digits": E.DECIMAL_DIGITS,
    })
