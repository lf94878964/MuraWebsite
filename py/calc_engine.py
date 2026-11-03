from __future__ import annotations

import ast
import functools
import multiprocessing as mp
import random as _random
import re
import unicodedata
from decimal import Decimal, ROUND_DOWN, getcontext
from collections import Counter
from dataclasses import dataclass, field
from typing import Any, List, Optional, Tuple

import sympy
from sympy import (
    Abs, E, Matrix, MatrixBase, oo, pi,
    acos, acosh, acot, acsc, asec, asin, asinh, atan, atanh,
    binomial, ceiling, cos, cosh, cot, coth, csc, csch, erf, exp, factorial, sech,
    floor, gamma, log as sympy_log, sec, simplify, sin, sinh, sqrt, tan, tanh,
)

tau = 2 * pi
from sympy.parsing.sympy_parser import (
    convert_xor,
    implicit_multiplication_application,
    parse_expr,
    standard_transformations,
)


class CalcError(Exception):
    pass


MAX_NUMBER = 10 ** 6
MAX_EXPONENT = 1000
MAX_FACT_ARG = 500
MAX_MATRIX_DIM = 12
COMPUTE_TIMEOUT = 6.0

LARGE_INT_THRESHOLD = 2 ** 31
DECIMAL_DIGITS = 12


_NUM_PATTERN = re.compile(r"\d+(\.\d+)?")
_POW_PATTERN = re.compile(r"(\*\*|\^)\s*\(?\s*(\d+(\.\d+)?)")
_POW_TOWER_PATTERN = re.compile(r"(\*\*|\^)\s*\d+(\.\d+)?\s*(\*\*|\^)")
_SCI_PATTERN = re.compile(r"(?<![\w.])\d+(?:\.\d+)?[eE][+-]?\d+")


def _check_raw_safety(raw: str) -> None:
    for m in _SCI_PATTERN.finditer(raw):
        try:
            val = float(m.group())
        except (ValueError, OverflowError):
            val = float("inf")
        if abs(val) > MAX_NUMBER:
            raise CalcError(
                f"數字 `{m.group()}` 超過允許範圍（上限 {MAX_NUMBER:,}），"
                "請輸入較小的數值。"
            )
    for m in _NUM_PATTERN.finditer(raw):
        try:
            val = float(m.group())
        except ValueError:
            continue
        if abs(val) > MAX_NUMBER:
            raise CalcError(
                f"數字 `{m.group()}` 超過允許範圍（上限 {MAX_NUMBER:,}），"
                "請輸入較小的數值。"
            )
    for m in _POW_PATTERN.finditer(raw):
        try:
            val = float(m.group(2))
        except ValueError:
            continue
        if abs(val) > MAX_EXPONENT:
            raise CalcError(
                f"次方數 `{m.group(2)}` 過大（上限 {MAX_EXPONENT:,}），"
                "可能導致運算卡住，請縮小範圍。"
            )
    if _POW_TOWER_PATTERN.search(raw):
        raise CalcError(
            "偵測到連續冪次（例如 `9**9**9`），結果可能瞬間變成天文數字。"
            "請用括號明確拆開，例如 `9**(9**2)`。"
        )


def _guard_int_arg(value, name: str):
    v = sympy.sympify(value)
    if v.free_symbols:
        return v  # 符號（例如 Σ 內的 n）：保持不展開
    if not v.is_number:
        raise CalcError(f"`{name}` 需要數值引數。")
    fv = float(v)
    if fv < 0:
        raise CalcError(f"`{name}` 的引數不可為負數。")
    if fv > MAX_FACT_ARG:
        raise CalcError(
            f"`{name}` 的引數過大（上限 {MAX_FACT_ARG}），避免運算時間過長。"
        )
    return v


def _safe_factorial(n):
    n = _guard_int_arg(n, "factorial(x) / x!")
    return factorial(n)


def _guard_nonneg_integer(value, name: str):
    """雙階乘／子階乘專用：必須是 0 ~ MAX_FACT_ARG 的整數，回傳 sympy.Integer。"""
    v = _guard_int_arg(value, name)
    if v.free_symbols:
        return v
    fv = float(v)
    if fv != int(fv):
        raise CalcError(f"`{name}` 僅支援非負整數。")
    return sympy.Integer(int(fv))


def _safe_double_factorial(n):
    """雙階乘 n!! = n·(n-2)·(n-4)…（0!! = 1）。"""
    n = _guard_nonneg_integer(n, "double_factorial(x) / x!!")
    return sympy.factorial2(n)


def _safe_subfactorial(n):
    """子階乘 !n（錯排數）：!0 = 1、!1 = 0、!2 = 1、!3 = 2、!4 = 9…"""
    n = _guard_nonneg_integer(n, "subfactorial(x) / !x")
    return sympy.subfactorial(n)


def _comb(n, k):
    n = _guard_int_arg(n, "comb(n, k)")
    k = _guard_int_arg(k, "comb(n, k)")
    return binomial(n, k)


def _perm(n, k):
    n = _guard_int_arg(n, "perm(n, k)")
    k = _guard_int_arg(k, "perm(n, k)")
    return factorial(n) / factorial(n - k)


def _h_repetition(n, k):
    n = _guard_int_arg(n, "h(n, k)")
    k = _guard_int_arg(k, "h(n, k)")
    return binomial(n + k - 1, k)


def _isqrt(n):
    n = _guard_int_arg(n, "isqrt(n)")
    if n.free_symbols:
        return floor(sqrt(n))
    if not n.is_integer:
        raise CalcError("isqrt(n) 僅支援整數輸入。")
    return floor(sqrt(n))


def _cbrt(x):
    return sympy.cbrt(sympy.sympify(x))


def _gcd_variadic(*args):
    if len(args) < 2:
        raise CalcError("gcd() 至少需要兩個引數。")
    vals = [sympy.sympify(a) for a in args]
    return functools.reduce(lambda a, b: sympy.gcd(a, b), vals)


def _lcm_variadic(*args):
    if len(args) < 2:
        raise CalcError("lcm() 至少需要兩個引數。")
    vals = [sympy.sympify(a) for a in args]
    return functools.reduce(lambda a, b: sympy.lcm(a, b), vals)


def _hypot(a, b):
    a, b = sympy.sympify(a), sympy.sympify(b)
    return sqrt(a ** 2 + b ** 2)


def _as_point(p):
    if isinstance(p, (list, tuple)):
        return Matrix(list(p))
    if isinstance(p, MatrixBase):
        return p
    return Matrix([sympy.sympify(p)])


def _dist(p, q):
    pv, qv = _as_point(p), _as_point(q)
    if pv.shape != qv.shape:
        raise CalcError("dist(p, q) 的兩個點維度不一致。")
    return sqrt(sum((a - b) ** 2 for a, b in zip(pv, qv)))


def _round_custom(x, n=0):
    x = sympy.sympify(x)
    n = int(n)
    if not x.is_number:
        raise CalcError("round() 僅支援數值運算。")
    return sympy.Float(round(float(x), n)) if n else sympy.Integer(round(float(x)))


def _degrees(x):
    return sympy.sympify(x) * 180 / pi


def _radians(x):
    return sympy.sympify(x) * pi / 180


def _versin(x):
    return 1 - cos(x)


def _vercosin(x):
    return 1 + cos(x)


def _coversin(x):
    return 1 - sin(x)


def _covercosin(x):
    return 1 + sin(x)


def _haversin(x):
    return (1 - cos(x)) / 2


def _havercosin(x):
    return (1 + cos(x)) / 2


def _hacoversin(x):
    return (1 - sin(x)) / 2


def _hacovercosin(x):
    return (1 + sin(x)) / 2


def _exsec(x):
    return sec(x) - 1


def _excsc(x):
    return csc(x) - 1


def _crd(x):
    return 2 * sin(x / 2)


def _nth_root(x, n):
    x = sympy.sympify(x)
    n_sym = sympy.sympify(n)
    if not n_sym.is_number:
        raise CalcError("root(x, n) 的 n 必須是數值。")
    if not n_sym.is_integer:
        raise CalcError("root(x, n) 的 n 必須是整數。")
    n_val = int(n_sym)
    if n_val == 0:
        raise CalcError("root(x, n) 的 n 不可為零。")
    if x.is_number and x.is_real and x.is_negative:
        if n_val % 2 == 0:
            raise CalcError("負數無法計算偶數次方根（結果為虛數，暫不支援）。")
        return -((-x) ** sympy.Rational(1, n_val))
    return x ** sympy.Rational(1, n_val)


def _stat_values(args) -> List[Any]:
    if len(args) < 1:
        raise CalcError("統計函數至少需要一個數值。")
    return [sympy.sympify(a) for a in args]


def _stat_min(*args):
    return sympy.Min(*_stat_values(args))


def _stat_max(*args):
    return sympy.Max(*_stat_values(args))


def _stat_mean(*args):
    vals = _stat_values(args)
    return sympy.Add(*vals) / len(vals)


def _stat_median(*args):
    vals = sorted(_stat_values(args), key=lambda v: float(v))
    n = len(vals)
    mid = n // 2
    if n % 2 == 1:
        return vals[mid]
    return (vals[mid - 1] + vals[mid]) / 2


def _stat_mode(*args):
    vals = _stat_values(args)
    counts = Counter(vals)
    max_count = max(counts.values())
    if max_count == 1:
        raise CalcError("mode()：資料沒有明顯的眾數（每個數值都只出現一次）。")
    modes = []
    for v in vals:
        if counts[v] == max_count and v not in modes:
            modes.append(v)
    if len(modes) == 1:
        return modes[0]
    return Matrix(modes)


def _stat_variance(args, sample: bool = True):
    vals = _stat_values(args)
    n = len(vals)
    if sample and n < 2:
        raise CalcError("樣本變異數至少需要兩個數值。")
    mean = sympy.Add(*vals) / n
    ss = sympy.Add(*[(v - mean) ** 2 for v in vals])
    denom = (n - 1) if sample else n
    return ss / denom


def _stat_var(*args):
    return _stat_variance(args, sample=True)


def _stat_sd(*args):
    return sqrt(_stat_var(*args))


def _stat_ppmcc(*args):
    vals = _stat_values(args)
    n = len(vals)
    if n < 4 or n % 2 != 0:
        raise CalcError(
            "ppmcc(x1,x2,...,y1,y2,...) 需要成對的偶數個數值"
            "（前半段視為 X 資料，後半段視為 Y 資料）。"
        )
    half = n // 2
    xs, ys = vals[:half], vals[half:]
    mx = sympy.Add(*xs) / half
    my = sympy.Add(*ys) / half
    cov = sympy.Add(*[(x - mx) * (y - my) for x, y in zip(xs, ys)])
    sx = sqrt(sympy.Add(*[(x - mx) ** 2 for x in xs]))
    sy = sqrt(sympy.Add(*[(y - my) ** 2 for y in ys]))
    if sx == 0 or sy == 0:
        raise CalcError("ppmcc()：其中一組資料的變異為零，無法計算相關係數。")
    return cov / (sx * sy)


def _stat_zscore(*args):
    vals = _stat_values(args)
    mean = sympy.Add(*vals) / len(vals)
    sd = _stat_sd(*args)
    if sd == 0:
        raise CalcError("z-score()：資料標準差為零，無法計算。")
    return Matrix([(v - mean) / sd for v in vals])


def _stat_cv(*args):
    vals = _stat_values(args)
    mean = sympy.Add(*vals) / len(vals)
    if mean == 0:
        raise CalcError("cv()：平均數為零，無法計算變異係數。")
    return _stat_sd(*args) / mean


def _quantile(vals_sorted: List[Any], q):
    n = len(vals_sorted)
    if n == 1:
        return vals_sorted[0]
    pos = q * (n - 1)
    lo = int(sympy.floor(pos))
    hi = int(sympy.ceiling(pos))
    lo = max(0, min(lo, n - 1))
    hi = max(0, min(hi, n - 1))
    if lo == hi:
        return vals_sorted[lo]
    frac = pos - lo
    return vals_sorted[lo] + (vals_sorted[hi] - vals_sorted[lo]) * frac


def _stat_quartile(args, which: int):
    vals = sorted(_stat_values(args), key=lambda v: float(v))
    qmap = {1: sympy.Rational(1, 4), 2: sympy.Rational(1, 2),
            3: sympy.Rational(3, 4), 4: sympy.Integer(1)}
    return _quantile(vals, qmap[which])


def _stat_qd1(*args):
    return _stat_quartile(args, 1)


def _stat_qd2(*args):
    return _stat_quartile(args, 2)


def _stat_qd3(*args):
    return _stat_quartile(args, 3)


def _stat_qd4(*args):
    return _stat_quartile(args, 4)


def _stat_iqr(*args):
    return _stat_qd3(*args) - _stat_qd1(*args)


def _stat_asym(*args):
    vals = _stat_values(args)
    n = len(vals)
    if n < 3:
        raise CalcError("asym()（偏度）至少需要三個數值。")
    mean = sympy.Add(*vals) / n
    m2 = sympy.Add(*[(v - mean) ** 2 for v in vals]) / n
    m3 = sympy.Add(*[(v - mean) ** 3 for v in vals]) / n
    if m2 == 0:
        raise CalcError("asym()：資料變異為零，無法計算偏度。")
    return m3 / (m2 ** sympy.Rational(3, 2))


def _as_matrix(v):
    if isinstance(v, MatrixBase):
        return v
    if isinstance(v, (list, tuple)):
        return Matrix(v)
    raise CalcError("此函數需要向量或矩陣作為引數（請用中括號輸入，如 [1,2,3]）。")


def _dot(v1, v2):
    v1, v2 = _as_matrix(v1), _as_matrix(v2)
    return v1.dot(v2)


def _cross(v1, v2):
    v1, v2 = _as_matrix(v1), _as_matrix(v2)
    if v1.shape != (3, 1) and v1.shape != (1, 3):
        raise CalcError("cross(v1, v2) 僅支援三維向量。")
    return v1.cross(v2)


def _norm(v):
    return _as_matrix(v).norm()


def _normalize(v):
    m = _as_matrix(v)
    n = m.norm()
    if n == 0:
        raise CalcError("零向量無法正規化。")
    return m / n


def _make_angle_between(to_unit):
    def wrapped(v1, v2):
        v1, v2 = _as_matrix(v1), _as_matrix(v2)
        denom = v1.norm() * v2.norm()
        if denom == 0:
            raise CalcError("零向量無法計算夾角。")
        return to_unit(sympy.acos(v1.dot(v2) / denom))
    return wrapped


def _projection(v1, v2):
    v1, v2 = _as_matrix(v1), _as_matrix(v2)
    denom = v2.dot(v2)
    if denom == 0:
        raise CalcError("無法投影到零向量上。")
    return (v1.dot(v2) / denom) * v2


def _distance_vec(v1, v2):
    v1, v2 = _as_matrix(v1), _as_matrix(v2)
    return (v1 - v2).norm()


# ────────────────────────────────────────────────────────────────
#  數論函數（用 sympy.Function 子類別實作：整數引數即時求值，符號引數保持不展開，
#  這樣放進 Σ 裡面也能正確逐項展開）
# ────────────────────────────────────────────────────────────────

MAX_ARITH_ARG = 10 ** 15
MAX_PRIME_PI_ARG = 10 ** 7
MAX_FIB_ARG = 20000
MAX_HYPER_ARG = 70          # H(70) 約 4054 位，再大會超過 Python 4300 位的整數轉字串上限
MAX_PRIMORIAL_ARG = 5000
MAX_SIGMA_K = 10             # σ(n, k) 的 k 上限
MAX_SERIES_TERMS = 5000      # Σ / ∏ 有限區間最多展開的項數
MAX_CALC_BOUND = 10 ** 6     # 微積分邊界（積分區間、極限點、Σ/∏ 邊界）的絕對值上限


def _symbolic(*vals) -> bool:
    return any(getattr(v, "free_symbols", None) for v in vals)


def _as_checked_int(value, label: str, minimum: int, limit: int) -> int:
    if not value.is_Integer:
        raise CalcError(f"`{label}` 僅支援整數引數。")
    iv = int(value)
    if iv < minimum:
        raise CalcError(f"`{label}` 的引數需為 {minimum} 以上的整數。")
    if iv > limit:
        raise CalcError(f"`{label}` 的引數過大（上限 {limit:,}），避免運算時間過長。")
    return iv


def _make_arith_function(key: str, display_name: str, compute, label: str,
                         minimum: int = 1, limit: int = MAX_ARITH_ARG):
    class _Arith(sympy.Function):
        @classmethod
        def eval(cls, n):
            if _symbolic(n) or not n.is_number:
                return None
            return sympy.Integer(compute(_as_checked_int(n, label, minimum, limit)))

    # qualname 要能在模組層級找到，結果才能跨行程 pickle
    _Arith.__qualname__ = f"_ARITH_{key}"
    _Arith.__name__ = display_name
    globals()[_Arith.__qualname__] = _Arith
    return _Arith


def _c_divisor_count(n):
    return int(sympy.divisor_count(n))


def _c_omega(n):
    return len(sympy.factorint(n))


def _c_bigomega(n):
    return sum(sympy.factorint(n).values())


def _c_radical(n):
    r = 1
    for p in sympy.factorint(n):
        r *= p
    return r


def _c_mobius(n):
    f = sympy.factorint(n)
    if any(e > 1 for e in f.values()):
        return 0
    return -1 if len(f) % 2 else 1


def _c_liouville(n):
    return -1 if _c_bigomega(n) % 2 else 1


def _c_primepi(n):
    return int(sympy.primepi(n))


def _c_fib(n):
    return int(sympy.fibonacci(n))


def _c_totient(n):
    return int(sympy.totient(n))


def _c_hyperfactorial(n):
    r = 1
    for k in range(2, n + 1):
        r *= k ** k
    return r


def _c_superfactorial(n):
    r, f = 1, 1
    for k in range(2, n + 1):
        f *= k
        r *= f
    return r


def _c_primorial(n):
    r = 1
    for p in sympy.primerange(2, n + 1):
        r *= p
    return r


DivisorCount = _make_arith_function("divisor_count", "d", _c_divisor_count, "d(n) / τ(n)")
PrimeOmega = _make_arith_function("prime_omega", "omega", _c_omega, "ω(n)")
PrimeBigOmega = _make_arith_function("prime_bigomega", "Omega", _c_bigomega, "Ω(n)")
Radical = _make_arith_function("radical", "rad", _c_radical, "rad(n)")
Mobius = _make_arith_function("mobius", "mu", _c_mobius, "μ(n)")
Liouville = _make_arith_function("liouville", "lamda", _c_liouville, "λ(n)")
PrimePi = _make_arith_function("prime_pi", "pi", _c_primepi, "π(n)",
                               minimum=0, limit=MAX_PRIME_PI_ARG)
Fibonacci = _make_arith_function("fib", "F", _c_fib, "F(n)", minimum=0, limit=MAX_FIB_ARG)
Totient = _make_arith_function("totient", "phi", _c_totient, "φ(n)")
Hyperfactorial = _make_arith_function("hyperfactorial", "H", _c_hyperfactorial, "H(n)",
                                      minimum=0, limit=MAX_HYPER_ARG)
Superfactorial = _make_arith_function("superfactorial", "sf", _c_superfactorial, "sf(n)",
                                      minimum=0, limit=MAX_HYPER_ARG)
Primorial = _make_arith_function("primorial", "primorial", _c_primorial, "n#",
                                 minimum=0, limit=MAX_PRIMORIAL_ARG)


class _DivisorSigma(sympy.Function):
    """σ(n) = 因數和；σ(n, k) = 所有因數的 k 次方和。"""

    @classmethod
    def eval(cls, n, k=1):
        k = sympy.sympify(k)
        if _symbolic(n, k) or not (n.is_number and k.is_number):
            return None
        nv = _as_checked_int(n, "σ(n)", 1, MAX_ARITH_ARG)
        kv = _as_checked_int(k, "σ(n, k)", 0, MAX_SIGMA_K)
        return sympy.Integer(sympy.divisor_sigma(nv, kv))


_DivisorSigma.__name__ = "sigma"


class _MultiFactorial(sympy.Function):
    """n!^(k) = n·(n-k)·(n-2k)…（最後一項為正數）。"""

    @classmethod
    def eval(cls, n, k):
        if _symbolic(n, k) or not (n.is_number and k.is_number):
            return None
        nv = _as_checked_int(n, "n!^(k)", 0, MAX_FACT_ARG)
        kv = _as_checked_int(k, "n!^(k)", 1, MAX_FACT_ARG)
        r = 1
        for t in range(nv, 0, -kv):
            r *= t
        return sympy.Integer(r)


_MultiFactorial.__name__ = "multifactorial"


def _H_dispatch(*args):
    """H(n) = 過階乘（1¹·2²·…·nⁿ）；H(n, k) = 重複組合。"""
    if len(args) == 1:
        return Hyperfactorial(sympy.sympify(args[0]))
    if len(args) == 2:
        return _h_repetition(*args)
    raise CalcError("H() 需要 1 個引數（過階乘）或 2 個引數（重複組合 H(n, k)）。")


def _mod_fn(a, b):
    a, b = sympy.sympify(a), sympy.sympify(b)
    if b == 0:
        raise CalcError("取餘數的除數不可為 0。")
    return sympy.Mod(a, b)


def _fourth_root(x):
    return sympy.root(sympy.sympify(x), 4)


def _sign(x):
    return sympy.sign(sympy.sympify(x))


def _trunc(x):
    x = sympy.sympify(x)
    return sympy.sign(x) * floor(Abs(x))


# ────────────────────────────────────────────────────────────────
#  random(a, b)：精確的隨機數（不使用浮點數）
#  前處理會把每個 random(...) 標上「出現順序」與「小數位數」，
#  同一次計算裡顯示用與計算用的算式會拿到同一個值。
# ────────────────────────────────────────────────────────────────

_random_memo: dict = {}


def _random_decimal(*args):
    if len(args) != 4:
        raise CalcError("random(a, b) 需要兩個引數（最小值與最大值）。")
    a, b, rid, digits = args
    key = int(rid)
    if key in _random_memo:
        return _random_memo[key]
    a, b = sympy.sympify(a), sympy.sympify(b)
    if not (a.is_Rational and b.is_Rational):
        raise CalcError(
            "random(a, b) 的引數必須是有理數（整數、小數或分數），"
            "請不要使用 π、√2 這類無理數。"
        )
    if a > b:
        a, b = b, a
    scale = sympy.ilcm(a.q, b.q, 10 ** int(digits))
    if scale > 10 ** 12:
        raise CalcError("random() 的小數位數過多。")
    lo = int(sympy.ceiling(a * scale))
    hi = int(sympy.floor(b * scale))
    if lo > hi:
        raise CalcError("random(a, b) 的範圍內沒有可取的值。")
    value = sympy.Rational(_random.randint(lo, hi), scale)
    _random_memo[key] = value
    return value


# ────────────────────────────────────────────────────────────────
#  極限 / 積分 / 級數
# ────────────────────────────────────────────────────────────────

def _as_symbol(var):
    if isinstance(var, sympy.Symbol):
        return var
    raise CalcError("微積分的變數必須是單一的變數名稱（例如 x、n）。")


def _infer_var(f, var):
    if var is None:
        syms = sorted(f.free_symbols, key=lambda s: s.name)
        if len(syms) == 1:
            return syms[0]
        if not syms:
            return sympy.Symbol("x")
        raise CalcError("被積函數有多個變數，請在後面加上 dx（或 dt 等）指定積分變數。")
    return _as_symbol(var)


def _fmt_extended(v) -> str:
    if v == oo:
        return "∞"
    if v == -oo:
        return "-∞"
    return str(v)


def _same_value(a, b) -> bool:
    if a == b:
        return True
    try:
        if a.is_finite and b.is_finite:
            return sympy.simplify(a - b) == 0
    except Exception:
        pass
    return False


def _validate_calc_result(res, what: str):
    try:
        if res is sympy.nan or res.has(sympy.nan):
            raise CalcError(f"{what}不存在（結果不是一個數）。")
        if res.has(sympy.zoo):
            raise CalcError(f"{what}不存在（結果為複無窮，例如除以零）。")
        if res.has(sympy.AccumBounds):
            raise CalcError(f"{what}不存在（數值會在一段範圍內震盪，不會趨近單一值）。")
        if res.has(sympy.Limit, sympy.Integral, sympy.Sum, sympy.Product):
            raise CalcError(f"{what}無法求出結果（沒有簡單的封閉形式，或運算過於複雜）。")
    except AttributeError:
        pass
    return res


def _check_bound(v, what: str) -> None:
    """邊界若是數值，絕對值不可超過 MAX_CALC_BOUND（∞ 除外）。"""
    try:
        if v in (oo, -oo) or v.free_symbols or not v.is_number:
            return
        if abs(float(v)) > MAX_CALC_BOUND:
            raise CalcError(f"{what}過大（上限 {MAX_CALC_BOUND:,}），請縮小範圍。")
    except CalcError:
        raise
    except Exception:
        return


def _calc_limit(f, var, point, direction=None):
    f = sympy.sympify(f)
    var = _as_symbol(var)
    point = sympy.sympify(point)
    _check_bound(point, "極限的趨近值")
    try:
        if point in (oo, -oo):
            res = sympy.limit(f, var, point)
        elif direction in ("+", "-"):
            res = sympy.limit(f, var, point, direction)
        else:
            right = sympy.limit(f, var, point, "+")
            left = sympy.limit(f, var, point, "-")
            if not _same_value(left, right):
                raise CalcError(
                    f"極限不存在：左極限為 {_fmt_extended(left)}，"
                    f"右極限為 {_fmt_extended(right)}。"
                )
            res = right
    except CalcError:
        raise
    except Exception as e:
        raise CalcError(f"極限計算失敗：{e}")
    return _validate_calc_result(res, "極限")


def _check_interior_poles(f, var, lo, hi) -> None:
    """有限區間內部若有發散點，sympy 可能給出誤導的數值（例如 ∫(-1→1) 1/x），這裡先攔下。"""
    try:
        if not (lo.is_finite and hi.is_finite):
            return
        from sympy.calculus.util import singularities
        poles = [p for p in singularities(f, var)
                 if p.is_real and bool(lo < p) and bool(p < hi)]
    except Exception:
        return
    for p in poles:
        for a, b in ((lo, p), (p, hi)):
            try:
                part = sympy.integrate(f, (var, a, b))
            except Exception:
                return
            if part.has(oo, -oo, sympy.zoo, sympy.nan, sympy.Integral):
                raise CalcError(f"積分不存在：被積函數在 {var} = {p} 處發散。")


def _calc_integral(f, var=None, lo=None, hi=None):
    f = sympy.sympify(f)
    var = _infer_var(f, var)
    try:
        if lo is None:
            res = sympy.integrate(f, var)
        else:
            lo, hi = sympy.sympify(lo), sympy.sympify(hi)
            _check_bound(lo, "積分下限")
            _check_bound(hi, "積分上限")
            _check_interior_poles(f, var, lo, hi)
            res = sympy.integrate(f, (var, lo, hi))
    except CalcError:
        raise
    except Exception as e:
        raise CalcError(f"積分計算失敗：{e}")
    return _validate_calc_result(res, "積分")


def _calc_series(kind, f, var, lo, hi):
    f = sympy.sympify(f)
    var = _as_symbol(var)
    lo, hi = sympy.sympify(lo), sympy.sympify(hi)
    what0 = "級數" if kind is sympy.Sum else "連乘積"
    _check_bound(lo, f"{what0}的下界")
    _check_bound(hi, f"{what0}的上界")
    if lo.is_number and hi.is_number and lo.is_finite and hi.is_finite:
        if float(hi) - float(lo) + 1 > MAX_SERIES_TERMS:
            raise CalcError(f"{what0}的項數過多（上限 {MAX_SERIES_TERMS:,} 項），請縮小區間。")
    series = kind(f, (var, lo, hi))
    what = "級數" if kind is sympy.Sum else "連乘積"
    try:
        res = series.doit()
    except Exception as e:
        raise CalcError(f"{what}計算失敗：{e}")
    if isinstance(res, kind) or res.has(kind):
        if kind is sympy.Sum:
            try:
                conv = series.is_convergent()
            except Exception:
                conv = None
            if conv is False:
                raise CalcError("級數發散（不收斂）。")
            if conv is True:
                try:
                    approx = series.evalf(30)
                    if approx.is_number and not approx.has(kind):
                        return approx
                except Exception:
                    pass
        raise CalcError(f"{what}無法求出結果（沒有簡單的封閉形式，或運算過於複雜）。")
    return _validate_calc_result(res, what)


def _calc_sum(f, var, lo, hi):
    return _calc_series(sympy.Sum, f, var, lo, hi)


def _calc_product(f, var, lo, hi):
    return _calc_series(sympy.Product, f, var, lo, hi)


# 顯示用（不求值）：讓步驟圖能把 lim / ∫ / Σ 畫成真正的數學符號
def _display_limit(f, var, point, direction=None):
    return sympy.Limit(sympy.sympify(f), _as_symbol(var), sympy.sympify(point),
                       direction if direction in ("+", "-") else "+-")


def _display_integral(f, var=None, lo=None, hi=None):
    f = sympy.sympify(f)
    var = _infer_var(f, var)
    if lo is None:
        return sympy.Integral(f, var)
    return sympy.Integral(f, (var, sympy.sympify(lo), sympy.sympify(hi)))


def _display_sum(f, var, lo, hi):
    return sympy.Sum(sympy.sympify(f), (_as_symbol(var), sympy.sympify(lo), sympy.sympify(hi)))


def _display_product(f, var, lo, hi):
    return sympy.Product(sympy.sympify(f), (_as_symbol(var), sympy.sympify(lo), sympy.sympify(hi)))


_ANGLE_INPUT_FUNCS = {
    "tg": tan, "ctg": cot, "cosec": csc,
    "sin": sin, "cos": cos, "tan": tan, "cot": cot, "sec": sec, "csc": csc,
    "versin": _versin, "vercosin": _vercosin,
    "coversin": _coversin, "covercosin": _covercosin,
    "haversin": _haversin, "havercosin": _havercosin,
    "hacoversin": _hacoversin, "hacovercosin": _hacovercosin,
    "exsec": _exsec, "excsc": _excsc, "crd": _crd,
}

_ANGLE_OUTPUT_FUNCS = {
    "asin": asin, "acos": acos, "atan": atan,
    "acot": acot, "asec": asec, "acsc": acsc,
    "arcsin": asin, "arccos": acos, "arctan": atan,
    "arccot": acot, "arcsec": asec, "arccsc": acsc,
}

_HYPERBOLIC_FUNCS = {
    "sinh": sinh, "cosh": cosh, "tanh": tanh,
    "asinh": asinh, "acosh": acosh, "atanh": atanh,
    "arsinh": asinh, "arcosh": acosh, "artanh": atanh,
    "arcsinh": asinh, "arccosh": acosh, "arctanh": atanh,
    "coth": coth, "sech": sech, "csch": csch,
}


def _make_angle_input_wrapper(func, to_rad):
    def wrapped(x):
        return func(to_rad(sympy.sympify(x)))
    return wrapped


def _make_angle_output_wrapper(func, to_unit):
    def wrapped(x):
        return to_unit(func(sympy.sympify(x)))
    return wrapped


_step_log: List[Tuple[Any, Any]] = []

_TRACKED_FUNC_NAMES = {
    "sqrt", "isqrt", "cbrt", "pow", "exp", "abs", "Abs",
    "log", "ln", "log10", "log2", "root",
    "degrees", "deg", "radians", "rad",
    "floor", "ceil", "ceiling", "round",
    "factorial", "double_factorial", "factorial2", "subfactorial",
    "gcd", "lcm", "comb", "C", "perm", "P", "h", "H",
    "hypot", "dist",
    "gamma", "erf",
    "min", "max", "avg", "mean", "med", "mode", "var", "sd",
    "ppmcc", "pccs", "zscore", "cv",
    "qd1", "qd2", "qd3", "qd4", "iqr", "asym",
    "mod", "lg", "lb", "sign", "sgn", "trunc",
    "d", "divisor_count", "divisor_sigma", "prime_omega", "prime_bigomega",
    "rad", "radical", "mobius", "liouville", "prime_pi", "fib", "fibonacci", "F",
    "totient", "hyperfactorial", "superfactorial", "sf", "primorial", "multifactorial",
} | set(_ANGLE_INPUT_FUNCS) | set(_ANGLE_OUTPUT_FUNCS) | set(_HYPERBOLIC_FUNCS)


def _record_and_wrap(display_name: str, func):
    def wrapped(*args, **kwargs):
        result = func(*args, **kwargs)
        try:
            sym_args = [a if isinstance(a, (sympy.Basic, MatrixBase)) else sympy.sympify(a)
                        for a in args]
            call_expr = sympy.Function(display_name)(*sym_args)
            if call_expr != result:
                _step_log.append((call_expr, result))
        except Exception:
            pass
        return result
    return wrapped


def build_namespace(mode: str, angle_unit: str, allow_random: bool = False) -> dict:

    if angle_unit == "degree":
        to_rad = lambda x: x * pi / 180
        to_unit = lambda x: x * 180 / pi
    else:
        to_rad = lambda x: x
        to_unit = lambda x: x

    ns: dict = {
        "pi": pi, "π": pi, "e": E, "tau": tau, "τ": tau, "inf": oo, "oo": oo,
        "i": sympy.I, "I": sympy.I,
        "sqrt": lambda x: sqrt(sympy.sympify(x)),
        "isqrt": _isqrt,
        "cbrt": _cbrt,
        "pow": lambda x, y: sympy.sympify(x) ** sympy.sympify(y),
        "exp": lambda x: exp(sympy.sympify(x)),
        "abs": lambda x: Abs(sympy.sympify(x)),
        "Abs": lambda x: Abs(sympy.sympify(x)),
        "log": lambda x, b=None: (sympy_log(sympy.sympify(x), 10) if b is None
                                   else sympy_log(sympy.sympify(b)) / sympy_log(sympy.sympify(x))),
        "ln": lambda x: sympy_log(sympy.sympify(x)),
        "log10": lambda x: sympy_log(sympy.sympify(x), 10),
        "log2": lambda x: sympy_log(sympy.sympify(x), 2),
        "degrees": _degrees, "deg": _degrees,
        "radians": _radians,
        "floor": lambda x: floor(sympy.sympify(x)),
        "ceil": lambda x: ceiling(sympy.sympify(x)),
        "ceiling": lambda x: ceiling(sympy.sympify(x)),
        "round": _round_custom,
        "factorial": _safe_factorial,
        "double_factorial": _safe_double_factorial,
        "factorial2": _safe_double_factorial,
        "subfactorial": _safe_subfactorial,
        "gcd": _gcd_variadic,
        "lcm": _lcm_variadic,
        "comb": _comb, "C": _comb,
        "perm": _perm, "P": _perm,
        "h": _h_repetition, "H": _H_dispatch,
        "hypot": _hypot,
        "dist": _dist,
        **_HYPERBOLIC_FUNCS,
        "gamma": lambda x: gamma(sympy.sympify(x)),
        "erf": lambda x: erf(sympy.sympify(x)),
        "root": _nth_root,
        "min": _stat_min, "max": _stat_max,
        "avg": _stat_mean, "mean": _stat_mean,
        "med": _stat_median,
        "mode": _stat_mode,
        "var": _stat_var,
        "sd": _stat_sd,
        "ppmcc": _stat_ppmcc, "pccs": _stat_ppmcc,
        "zscore": _stat_zscore,
        "cv": _stat_cv,
        "qd1": _stat_qd1, "qd2": _stat_qd2, "qd3": _stat_qd3, "qd4": _stat_qd4,
        "iqr": _stat_iqr,
        "asym": _stat_asym,
        "mod": _mod_fn,
        "lg": lambda x: sympy_log(sympy.sympify(x), 10),
        "lb": lambda x: sympy_log(sympy.sympify(x), 2),
        "sign": _sign, "sgn": _sign, "trunc": _trunc,
        "fourthroot": _fourth_root,
        "d": DivisorCount, "divisor_count": DivisorCount,
        "divisor_sigma": _DivisorSigma,
        "prime_omega": PrimeOmega, "prime_bigomega": PrimeBigOmega,
        "rad": Radical, "radical": Radical,
        "mobius": Mobius, "liouville": Liouville,
        "prime_pi": PrimePi,
        "fib": Fibonacci, "fibonacci": Fibonacci, "F": Fibonacci,
        "totient": Totient,
        "hyperfactorial": Hyperfactorial,
        "superfactorial": Superfactorial, "sf": Superfactorial,
        "primorial": Primorial,
        "multifactorial": _MultiFactorial,
        "limit": _calc_limit,
        "integrate": _calc_integral,
        "summation": _calc_sum,
        "product": _calc_product,
        "Matrix": Matrix,
        "Integer": sympy.Integer,
        "Float": sympy.Float,
        "Rational": sympy.Rational,
        "Symbol": sympy.Symbol,
        "Add": sympy.Add,
        "Mul": sympy.Mul,
        "Pow": sympy.Pow,
    }

    for name, func in _ANGLE_INPUT_FUNCS.items():
        ns[name] = _make_angle_input_wrapper(func, to_rad)
    for name, func in _ANGLE_OUTPUT_FUNCS.items():
        ns[name] = _make_angle_output_wrapper(func, to_unit)

    if mode in ("vector", "matrix") or mode in _MATRIX_OP_MODES:
        ns.update({
            "dot": _dot,
            "cross": _cross,
            "norm": _norm,
            "normalize": _normalize,
            "angle": _make_angle_between(to_unit),
            "projection": _projection,
            "distance": _distance_vec,
        })

    if allow_random:
        ns["random"] = _random_decimal

    for name in list(ns.keys()):
        if name in _TRACKED_FUNC_NAMES and callable(ns[name]):
            ns[name] = _record_and_wrap(name, ns[name])

    return ns


def _convert_sqrt_symbol(s: str) -> str:
    s = re.sub(r"√\s*([A-Za-z0-9_.]+)", r"sqrt(\1)", s)
    s = s.replace("√", "sqrt")
    return s


_IDENT_TAIL = re.compile(r"[A-Za-z_][A-Za-z0-9_]*$")


def _ends_operand(out: List[str]) -> bool:
    """out 目前的結尾（略過空白）是否是一個運算元的結尾：數字／名稱／右括號。"""
    k = len(out) - 1
    while k >= 0 and out[k].isspace():
        k -= 1
    return k >= 0 and (out[k].isalnum() or out[k] in "_.)")


def _match_paren(s: str, i: int) -> int:
    """s[i] 是 '('，回傳對應 ')' 的索引。"""
    depth = 0
    for j in range(i, len(s)):
        if s[j] == "(":
            depth += 1
        elif s[j] == ")":
            depth -= 1
            if depth == 0:
                return j
    raise CalcError("括號不成對，請檢查算式。")


def _pop_postfix_atom(out: List[str]) -> str:
    """取出後綴 `!`／`!!` 作用的運算元（含前面的函式名稱），並從 out 移除。"""
    while out and out[-1].isspace():
        out.pop()
    if not out:
        raise CalcError("`!` 前面缺少可計算的數值或變數。")
    if out[-1] == ")":
        depth = 0
        k = len(out) - 1
        while k >= 0:
            if out[k] == ")":
                depth += 1
            elif out[k] == "(":
                depth -= 1
                if depth == 0:
                    break
            k -= 1
        if k < 0:
            raise CalcError("`!` 前面的括號不成對。")
        m = _IDENT_TAIL.search("".join(out[:k]))
        if m:  # sin(30)! 這類「函式名稱＋括號」要整個當運算元
            k -= len(m.group())
        atom = "".join(out[k:])
        del out[k:]
        return atom
    k = len(out) - 1
    while k >= 0 and (out[k].isalnum() or out[k] in "_."):
        k -= 1
    atom = "".join(out[k + 1:])
    if not atom:
        raise CalcError("`!` 前面缺少可計算的數值或變數。")
    del out[k + 1:]
    return atom


def _take_prefix_operand(s: str, i: int) -> Tuple[str, int]:
    """前綴 `!x`（子階乘）：從 s[i] 取出運算元，回傳 (運算元, 下一個索引)。"""
    n = len(s)
    while i < n and s[i].isspace():
        i += 1
    if i >= n:
        raise CalcError("`!` 後面缺少可計算的數值或變數。")
    if s[i] == "(":
        j = _match_paren(s, i)
        return _convert_factorial_symbol(s[i:j + 1]), j + 1
    j = i
    while j < n and (s[j].isalnum() or s[j] in "_."):
        j += 1
    token = s[i:j]
    if not token:
        raise CalcError("`!` 後面缺少可計算的數值或變數。")
    if j < n and s[j] == "(" and (token[0].isalpha() or token[0] == "_"):
        k = _match_paren(s, j)  # !sqrt(16) 這類函式呼叫
        return _convert_factorial_symbol(s[i:k + 1]), k + 1
    return token, j


_MULTI_K = re.compile(r"\s*(?:\^|\*\*)\s*\(")


def _convert_primorial_symbol(s: str) -> str:
    """x# → primorial(x)（不超過 x 的所有質數之積）。"""
    if "#" not in s:
        return s
    out: List[str] = []
    for c in s:
        if c != "#":
            out.append(c)
            continue
        if not _ends_operand(out):
            raise CalcError("`#` 前面缺少可計算的數值或變數。")
        atom = _pop_postfix_atom(out)
        out.extend(f"primorial({atom})")
    return "".join(out)


def _convert_factorial_symbol(s: str) -> str:
    """階乘符號轉換：
        x!   → factorial(x)
        x!!  → factorial2(x)       雙階乘
        !x   → subfactorial(x)     子階乘（`!` 在運算元前面時）
    """
    out: List[str] = []
    i, n = 0, len(s)
    while i < n:
        c = s[i]
        if c != "!":
            out.append(c)
            i += 1
            continue
        if _ends_operand(out):
            run = 1
            while i + run < n and s[i + run] == "!":
                run += 1
            j = i + run
            atom = _pop_postfix_atom(out)
            if run == 1:
                mk = _MULTI_K.match(s, j)
                if mk:  # n!^(k) 多重階乘
                    close = _match_paren(s, mk.end() - 1)
                    k = _convert_factorial_symbol(s[mk.end():close])
                    out.extend(f"multifactorial({atom}, {k})")
                    i = close + 1
                    continue
                out.extend(f"factorial({atom})")
            elif run == 2:
                out.extend(f"factorial2({atom})")
            else:  # n!!! … 三重（以上）階乘
                out.extend(f"multifactorial({atom}, {run})")
            i = j
        else:
            if i + 1 < n and s[i + 1] == "!":
                raise CalcError("`!!` 前面缺少可計算的數值或變數。")
            atom, i = _take_prefix_operand(s, i + 1)
            out.extend(f"subfactorial({atom})")
    return "".join(out)


_HEX_PATTERN = re.compile(r"(?<![\w.])0(?:[xX][0-9A-Fa-f]+|[bB][01]+|[oO][0-7]+)")


def _convert_hex_literals(s: str) -> str:
    """0x1F／0b101／0o17 → 十進位整數。"""
    return _HEX_PATTERN.sub(lambda m: str(int(m.group(), 0)), s)


_SUPERSCRIPT_MAP = str.maketrans("⁰¹²³⁴⁵⁶⁷⁸⁹⁻⁺", "0123456789-+")
_SUBSCRIPT_MAP = str.maketrans("₀₁₂₃₄₅₆₇₈₉₋₊", "0123456789-+")
_SUPERSCRIPT_PATTERN = re.compile(r"⁽?[⁰¹²³⁴⁵⁶⁷⁸⁹⁻⁺]+⁾?")


def _convert_superscript_exponents(s: str) -> str:
    def repl(m):
        core = m.group(0).replace("⁽", "").replace("⁾", "").translate(_SUPERSCRIPT_MAP)
        if core in ("+", "-"):      # x→0⁺ 之類的方向記號
            return "^" + core
        return f"**({core})"
    return _SUPERSCRIPT_PATTERN.sub(repl, s)


# ── 輸入正規化：全形 → 半形、分數字元、各種符號別名 ──
_ZERO_WIDTH = re.compile("[\u200b\u200c\u200d\u2060\ufeff]")
_CALC_SCRIPT_RE = re.compile(r"([∫∑Σ∏])([₀-₉₋₊]*)([⁰¹²³⁴⁵⁶⁷⁸⁹⁻⁺]*)")

_VULGAR = {
    "½": (1, 2), "⅓": (1, 3), "⅔": (2, 3), "¼": (1, 4), "¾": (3, 4),
    "⅕": (1, 5), "⅖": (2, 5), "⅗": (3, 5), "⅘": (4, 5), "⅙": (1, 6), "⅚": (5, 6),
    "⅐": (1, 7), "⅛": (1, 8), "⅜": (3, 8), "⅝": (5, 8), "⅞": (7, 8),
    "⅑": (1, 9), "⅒": (1, 10), "↉": (0, 3),
}
_VULGAR_RE = re.compile(r"(?:(?<![\w.])(\d+)\s?)?([" + "".join(_VULGAR) + "])")

_SYMBOL_TRANSLATION = str.maketrans({
    "−": "-", "–": "-", "—": "-", "‐": "-", "‑": "-", "﹣": "-",
    "∕": "/", "⁄": "/", "∶": "/",
    "·": "*", "⋅": "*", "∙": "*", "∗": "*", "•": "*",
    "︿": "^", "∑": "Σ", "。": ".", "、": ",",
    "「": "(", "」": ")", "『": "(", "』": ")",
    "【": "[", "】": "]", "〔": "[", "〕": "]",
})

_WORD_SUBS = [
    (re.compile("無窮大|無限大|無窮|無限|無穷大|无穷|infinity", re.I), " oo "),
    (re.compile("極限|极限"), " lim "),
    (re.compile("根號|根号"), "√"),
    (re.compile("乘以|乘"), "*"),
    (re.compile("除以|除"), "/"),
    (re.compile("加上|加"), "+"),
    (re.compile("減去|减去|減|减"), "-"),
]


def _vulgar_repl(m) -> str:
    whole, ch = m.group(1), m.group(2)
    num, den = _VULGAR[ch]
    frac = f"({num}/{den})"
    return f"({whole}+{frac})" if whole else frac


def normalize_input(raw: str) -> str:
    """全形轉半形，並把 ⅕、x²、∞ 等特殊字元整理成引擎看得懂的寫法。可重複呼叫。"""
    s = _ZERO_WIDTH.sub("", raw)

    def script_repl(m):
        sub, sup = m.group(2), m.group(3)
        if not sub and not sup:
            return m.group(0)
        text = m.group(1)
        if sub:
            text += "_{" + sub.translate(_SUBSCRIPT_MAP) + "}"
        if sup:
            text += "^{" + sup.translate(_SUPERSCRIPT_MAP) + "}"
        return text
    s = _CALC_SCRIPT_RE.sub(script_repl, s)

    s = re.sub(
        r"!\s*⁽([⁰¹²³⁴⁵⁶⁷⁸⁹]+)⁾",
        lambda m: "!^(" + m.group(1).translate(_SUPERSCRIPT_MAP) + ")", s,
    )
    s = _convert_superscript_exponents(s)
    s = _VULGAR_RE.sub(_vulgar_repl, s)
    s = unicodedata.normalize("NFKC", s)
    s = s.translate(_SYMBOL_TRANSLATION)
    s = s.replace("∞", " oo ")
    for pattern, repl in _WORD_SUBS:
        s = pattern.sub(repl, s)
    s = re.sub(r"\s*=+\s*\??\s*$", "", s)  # 結尾的「=」「=?」
    return s.strip()


_FUNC_SYMBOLS = {
    "τ": "divisor_count", "σ": "divisor_sigma", "ω": "prime_omega", "Ω": "prime_bigomega",
    "μ": "mobius", "λ": "liouville", "π": "prime_pi", "φ": "totient",
}
_FUNC_SYMBOL_RE = re.compile(r"([" + "".join(_FUNC_SYMBOLS) + r"])\s*\(")


def _prev_is_operand(s: str, pos: int) -> bool:
    k = pos - 1
    while k >= 0 and s[k].isspace():
        k -= 1
    return k >= 0 and (s[k].isalnum() or s[k] in ")]}_.")


def _convert_function_symbols(s: str) -> str:
    """τ(n) σ(n) ω(n) Ω(n) μ(n) λ(n) π(n) φ(n)：前面接著運算元時（如 2π(3)）視為乘法，不轉換。"""
    def repl(m):
        if _prev_is_operand(s, m.start()):
            return m.group(0)
        return _FUNC_SYMBOLS[m.group(1)] + "("
    return _FUNC_SYMBOL_RE.sub(repl, s)


def _strip_digit_underscores(s: str) -> str:
    return re.sub(r"(?<![A-Za-z_])\d+(?:_\d+)+", lambda m: m.group().replace("_", ""), s)


def _convert_degree_symbol(s: str) -> str:
    s = re.sub(r"(\d+(?:\.\d+)?)\s*°", r"(\1*pi/180)", s)
    return re.sub(r"\)\s*°", ")*(pi/180)", s)


def _convert_percent(s: str) -> str:
    """50% → 50/100。後面還接著運算元時（10%3）仍視為取餘數。"""
    return re.sub(
        r"(\d+(?:\.\d+)?|\))\s*%(?=\s*(?:$|[)\]*/,]))",
        lambda m: f"{m.group(1)}*(1/100)", s,
    )


def _convert_misc_symbols(s: str) -> str:
    s = re.sub(r"∛\s*([A-Za-z0-9_.]+)", r"cbrt(\1)", s).replace("∛", "cbrt")
    s = re.sub(r"∜\s*([A-Za-z0-9_.]+)", r"fourthroot(\1)", s).replace("∜", "fourthroot")
    for _ in range(20):
        t = re.sub(r"⌊([^⌊⌋]*)⌋", r"floor(\1)", s)
        t = re.sub(r"⌈([^⌈⌉]*)⌉", r"ceil(\1)", t)
        if t == s:
            break
        s = t
    return s


# ── random(a, b)：標記出現順序與小數位數（讓顯示用與計算用拿到同一個值）──
_RANDOM_RE = re.compile(r"(?<![A-Za-z0-9_.])random\s*\(", re.I)
_DECIMAL_LITERAL = re.compile(r"(?<![\w.])(\d+)\.(\d+)(?![\w.])")


def _tag_random_calls(s: str) -> str:
    starts = list(_RANDOM_RE.finditer(s))
    for idx in reversed(range(len(starts))):
        m = starts[idx]
        open_i = m.end() - 1
        close = _match_paren(s, open_i)
        inner = s[open_i + 1:close]
        digits = max((len(f) for _, f in _DECIMAL_LITERAL.findall(inner)), default=0)
        inner = _DECIMAL_LITERAL.sub(
            lambda mm: f"Rational({int(mm.group(1) + mm.group(2))},{10 ** len(mm.group(2))})",
            inner,
        )
        tag = f"{idx}, {digits}"
        new_inner = f"{inner}, {tag}" if inner.strip() else tag
        s = s[:m.start()] + "random(" + new_inner + ")" + s[close + 1:]
    return s


# ── 極限 / 積分 / 級數：把 lim、∫、Σ、∏ 改寫成函式呼叫 ──
_OPEN, _CLOSE = "([{", ")]}"
_IDENT = re.compile(r"[^\W\d]\w*")
_CALC_START = re.compile(r"[∫Σ∏]|(?<![A-Za-z0-9_])lim(?:it)?(?![A-Za-z0-9_])", re.I)
_ARROW_DELIM = re.compile(r"\s*(?:⟶|⟼|→|-->|->|=>|⇒|\bto\b|\bapproaches\b)\s*")
_RANGE_DELIM = re.compile(r"\s*(?:\bto\b|→|⟶|\.\.\.?|…|~|,|;|至|到)\s*")
_BARE_LIM = re.compile(
    r"\s*([^\W\d]\w*)\s*(?:⟶|⟼|→|-->|->|=>|⇒|\bto\b)\s*"
    r"([+\-]?\s*(?:\d+(?:\.\d+)?|oo|[^\W\d]\w*)(?:\^[+\-]|[+\-](?=\s|$))?)"
)
_DIR_SUFFIX = re.compile(r"^(.*?[^\s+\-*/^(])\s*\^?\s*([+\-])$", re.S)
_SCRIPT_TOKEN = re.compile(r"([+\-]?\s*(?:\d+(?:\.\d+)?|oo|[^\W\d]\w*))")
_SCRIPT_SIGMA_TOKEN = re.compile(r"([^\W\d]\w*\s*=\s*[+\-]?\s*(?:\d+(?:\.\d+)?|oo|[^\W\d]\w*))")
_SERIES_SPEC = re.compile(r"\s*([^\W\d]\w*)\s*=\s*(.*?)\s*$", re.S)
_RESERVED_CACHE = None


def _reserved_names():
    global _RESERVED_CACHE
    if _RESERVED_CACHE is None:
        _RESERVED_CACHE = frozenset(build_namespace("scalar", "radian", allow_random=True))
    return _RESERVED_CACHE


def _skip_ws(s: str, i: int) -> int:
    while i < len(s) and s[i].isspace():
        i += 1
    return i


def _match_bracket(s: str, i: int) -> int:
    depth = 0
    for j in range(i, len(s)):
        if s[j] in _OPEN:
            depth += 1
        elif s[j] in _CLOSE:
            depth -= 1
            if depth == 0:
                return j
    raise CalcError("括號不成對，請檢查算式。")


def _group_end(s: str, i: int) -> int:
    """本體的結尾：目前括號層結束、或最外層的逗號、或字串結尾。"""
    depth = 0
    for j in range(i, len(s)):
        c = s[j]
        if c in _OPEN:
            depth += 1
        elif c in _CLOSE:
            if depth == 0:
                return j
            depth -= 1
        elif c == "," and depth == 0:
            return j
    return len(s)


def _split_top(text: str, regex):
    depth = 0
    for j, c in enumerate(text):
        if c in _OPEN:
            depth += 1
        elif c in _CLOSE:
            depth -= 1
        elif depth == 0:
            m = regex.match(text, j)
            if m and m.end() > j:
                return text[:j], text[m.end():]
    return None


def _read_script(s: str, k: int, sigma: bool = False):
    k = _skip_ws(s, k)
    if k < len(s) and s[k] in _OPEN:
        close = _match_bracket(s, k)
        return s[k + 1:close], close + 1
    m = (_SCRIPT_SIGMA_TOKEN if sigma else _SCRIPT_TOKEN).match(s, k)
    if not m:
        raise CalcError("上下限格式錯誤，例如 ∫_0^1 x dx、Σ_{n=1}^{10} n。")
    return m.group(1).strip(), m.end()


def _mask_variable(var: str, *texts: str):
    """變數名稱和內建名稱衝突（例如 i、h、e、C）時，改用 `i__` 這種內部名稱，算完再換回來。"""
    if var not in _reserved_names():
        return (var,) + texts
    masked = var + "__"
    pat = re.compile(r"(?<![A-Za-z_.\d])(\d+)?" + re.escape(var) + r"(?![A-Za-z0-9_])")

    def make(text):
        def repl(m):
            nxt = _skip_ws(text, m.end())
            star = "*" if nxt < len(text) and text[nxt] == "(" else ""
            pre = (m.group(1) + "*") if m.group(1) else ""
            return pre + masked + star
        return pat.sub(repl, text)
    return (masked,) + tuple(make(t) for t in texts)


def _find_dvar(s: str, start: int):
    depth, pending = 0, 1
    n = len(s)
    for j in range(start, n):
        c = s[j]
        if c in _OPEN:
            depth += 1
            continue
        if c in _CLOSE:
            if depth == 0:
                return None
            depth -= 1
            continue
        if depth:
            continue
        if c == "∫":
            pending += 1
        elif c == "d" and j + 1 < n and s[j + 1].isalpha():
            prev = s[j - 1] if j > 0 else ""
            if prev and (prev.isalpha() or prev == "_") and prev != s[j + 1]:
                continue
            nxt = s[j + 2] if j + 2 < n else ""
            if nxt and (nxt.isalnum() or nxt in "_("):
                continue
            pending -= 1
            if pending == 0:
                return j, s[j + 1]
    return None


def _build_integral(s: str, j: int):
    n = len(s)
    lo = hi = None
    if j < n and s[j] == "_":
        lo, j = _read_script(s, j + 1)
        j = _skip_ws(s, j)
        if j < n and s[j] == "^":
            hi, j = _read_script(s, j + 1)
        else:
            raise CalcError("積分下限後面需要上限，例如 ∫_0^1 x dx。")
    elif j < n and s[j] in _OPEN:
        close = _match_bracket(s, j)
        sp = _split_top(s[j + 1:close], _RANGE_DELIM)
        if sp:
            lo, hi = sp[0].strip(), sp[1].strip()
            j = close + 1
    found = _find_dvar(s, j)
    if found:
        dpos, var = found
        body, end = s[j:dpos], dpos + 2
    else:
        end = _group_end(s, j)
        body, var = s[j:end], None
    body = body.strip()
    if not body:
        raise CalcError("∫ 後面缺少被積函數，例如 ∫(0 to 1) x^2 dx。")
    if var:
        var, body = _mask_variable(var, body)
    body = _convert_calculus(body)
    text = f"integrate(({body}), {var if var else 'None'}"
    if lo is not None:
        text += f", ({lo}), ({hi})"
    return text + ")", end


def _build_series(s: str, j: int, func: str):
    n = len(s)
    help_text = "級數格式：Σ(n=1 to 10) n^2，或 Σ_{n=1}^{10} n^2。"
    if j < n and s[j] == "_":
        sub, j = _read_script(s, j + 1, sigma=True)
    elif j < n and s[j] in _OPEN:
        close = _match_bracket(s, j)
        sub, j = s[j + 1:close], close + 1
    else:
        raise CalcError(help_text)
    mm = _SERIES_SPEC.match(sub)
    if not mm:
        raise CalcError(help_text)
    var, rest = mm.group(1), mm.group(2)
    sp = _split_top(rest, _RANGE_DELIM)
    if sp:
        lo, hi = sp[0].strip(), sp[1].strip()
    else:
        k = _skip_ws(s, j)
        if k < n and s[k] == "^":
            hi, j = _read_script(s, k + 1)
            lo = rest.strip()
        else:
            raise CalcError(help_text)
    end = _group_end(s, j)
    body = s[j:end].strip()
    if not body:
        raise CalcError("Σ／∏ 後面缺少要加總（連乘）的算式。")
    var, body = _mask_variable(var, body)
    body = _convert_calculus(body)
    return f"{func}(({body}), {var}, ({lo}), ({hi}))", end


def _split_direction(tgt: str):
    m = _DIR_SUFFIX.match(tgt)
    if m:
        return m.group(1).strip(), m.group(2)
    return tgt, None


def _build_limit(s: str, j: int, kw: str):
    n = len(s)
    if j < n and s[j] == "_":
        j = _skip_ws(s, j + 1)
    spec, nxt = None, j
    if j < n and s[j] in _OPEN:
        close = _match_bracket(s, j)
        sp = _split_top(s[j + 1:close], _ARROW_DELIM)
        if sp:
            spec, nxt = sp, close + 1
    if spec is None:
        bm = _BARE_LIM.match(s, j)
        if bm:
            spec, nxt = (bm.group(1), bm.group(2)), bm.end()
    if spec is None:
        if kw.lower() == "limit" and j < n and s[j] == "(":
            return None  # limit(f, x, a) 當一般函式
        raise CalcError("極限格式錯誤，請寫成 lim (x→a) f(x)，例如 lim (x→∞) 1/x。")
    var, tgt = spec[0].strip(), spec[1].strip()
    if not _IDENT.fullmatch(var):
        raise CalcError("極限的變數必須是單一變數名稱，例如 lim (x→0) …。")
    tgt, direction = _split_direction(tgt)
    if not tgt:
        raise CalcError("極限缺少趨近的目標，例如 lim (x→0) …。")
    end = _group_end(s, nxt)
    body = s[nxt:end].strip()
    if not body:
        raise CalcError("lim 後面缺少要取極限的算式。")
    var, body = _mask_variable(var, body)
    body = _convert_calculus(body)
    text = f"limit(({body}), {var}, ({tgt})"
    if direction:
        text += f", '{direction}'"
    return text + ")", end


def _convert_calculus(s: str) -> str:
    out: List[str] = []
    pos = 0
    while True:
        m = _CALC_START.search(s, pos)
        if m is None:
            out.append(s[pos:])
            break
        out.append(s[pos:m.start()])
        kw = m.group(0)
        j = _skip_ws(s, m.end())
        if kw == "∫":
            text, pos = _build_integral(s, j)
        elif kw == "Σ":
            text, pos = _build_series(s, j, "summation")
        elif kw == "∏":
            text, pos = _build_series(s, j, "product")
        else:
            res = _build_limit(s, j, kw)
            if res is None:
                out.append(kw)
                pos = m.end()
                continue
            text, pos = res
        out.append(text)
    return "".join(out)


def _unmask_symbols(value):
    if value is None or isinstance(value, str):
        return value
    try:
        if isinstance(value, MatrixBase):
            return value.applyfunc(_unmask_symbols)
        syms = [a for a in value.atoms(sympy.Symbol) if a.name.endswith("__")]
        if not syms:
            return value
        return value.xreplace({a: sympy.Symbol(a.name[:-2]) for a in syms})
    except Exception:
        return value


def _check_undefined(value) -> None:
    if isinstance(value, MatrixBase):
        for v in value:
            _check_undefined(v)
        return
    try:
        if value is sympy.nan or value.has(sympy.nan):
            raise CalcError("結果未定義（不是一個數）。")
        if value.has(sympy.zoo):
            raise CalcError("結果未定義（例如除以零）。")
        if value.has(sympy.AccumBounds):
            raise CalcError("結果不存在（數值會在一段範圍內震盪）。")
    except AttributeError:
        pass


_THOUSANDS_PATTERN = re.compile(r"(?<![\d(,])\d{1,3}(?:,\d{3})+(?:\.\d+)?")


def _strip_thousands_separators(s: str) -> str:
    return _THOUSANDS_PATTERN.sub(lambda m: m.group(0).replace(",", ""), s)


_REPEAT_NINE_PATTERN = re.compile(r"\d+\.\d*9{13,}\d*")


def _collapse_repeating_nines(s: str) -> str:
    def repl(m):
        try:
            return str(int(round(float(m.group(0)))))
        except Exception:
            return m.group(0)
    return _REPEAT_NINE_PATTERN.sub(repl, s)


def _convert_abs_bars(s: str) -> str:
    buffers: List[List[str]] = [[]]
    for c in s:
        if c == "|":
            if len(buffers) == 1:
                buffers.append([])
            elif not buffers[-1]:
                buffers.append([])
            else:
                content = "".join(buffers.pop())
                buffers[-1].append(f"Abs({content})")
        else:
            buffers[-1].append(c)
    while len(buffers) > 1:
        content = "".join(buffers.pop())
        buffers[-1].append("|" + content)
    return "".join(buffers[0])


_MOD_WORD = re.compile(r"(?<![A-Za-z_])(?:mod|modulo)(?![A-Za-z_])", re.IGNORECASE)


def _convert_mod_operator(s: str) -> str:
    """`10 mod 3`、`10mod3`、`(10)mod(3)` → 10%3；`mod(10,3)` 保留為函式。"""
    def repl(m):
        return "%" if _prev_is_operand(s, m.start()) else "mod"
    return _MOD_WORD.sub(repl, s)


def _convert_zscore_alias(s: str) -> str:
    return re.sub(r"z-score", "zscore", s, flags=re.IGNORECASE)


_LOG_BASE_SHORTHAND_PATTERN = re.compile(r"\blog(\d+)\(")


def _convert_log_base_shorthand(s: str) -> str:
    def repl(m: "re.Match") -> str:
        base = m.group(1)
        if base in ("2", "10"):
            return m.group(0)
        return f"log({base},"
    return _LOG_BASE_SHORTHAND_PATTERN.sub(repl, s)


def substitute_placeholders(raw: str, variables: Optional[str]) -> str:
    if "?" not in raw:
        return raw
    count = raw.count("?")
    if not variables or not variables.strip():
        raise CalcError(f"算式包含 {count} 個 `?` 佔位符，請在「替換值」欄位提供對應的數值。")
    parts = [v.strip() for v in re.split(r"[,，、]", variables) if v.strip() != ""]
    if len(parts) != count:
        raise CalcError(
            f"`?` 佔位符數量（{count}）與提供的替換值數量（{len(parts)}）不一致。"
        )
    it = iter(parts)
    return re.sub(r"\?", lambda _m: next(it), raw)


_IMAG_LITERAL_PATTERN = re.compile(r"(?<![A-Za-z0-9_.])(\d+(?:\.\d+)?)[iI](?![A-Za-z0-9_])")
_IMAG_LITERAL_AFTER_PAREN_PATTERN = re.compile(r"(\))[iI](?![A-Za-z0-9_])")


def _convert_imaginary_literal(s: str) -> str:
    s = _IMAG_LITERAL_PATTERN.sub(lambda m: f"{m.group(1)}*I", s)
    s = _IMAG_LITERAL_AFTER_PAREN_PATTERN.sub(lambda m: f"{m.group(1)}*I", s)
    return s


def _insert_implicit_mult(s: str) -> str:
    s = re.sub(r"(?<![A-Za-z0-9_])(\d+(?:\.\d+)?)(\()", r"\1*\2", s)
    s = re.sub(r"(\))(\d+(?:\.\d+)?)", r"\1*\2", s)
    s = re.sub(r"(\))(\()", r"\1*\2", s)
    return s


def _wrap_bracket_literals(s: str) -> str:
    out: List[str] = []
    i, n = 0, len(s)
    while i < n:
        c = s[i]
        if c == "[":
            depth = 1
            j = i + 1
            while j < n and depth > 0:
                if s[j] == "[":
                    depth += 1
                elif s[j] == "]":
                    depth -= 1
                j += 1
            if depth != 0:
                raise CalcError("中括號不成對，請檢查向量/矩陣輸入格式。")
            inner = s[i:j]
            out.append(f"Matrix({inner})")
            i = j
        else:
            out.append(c)
            i += 1
    return "".join(out)


def preprocess(raw: str, mode: str) -> str:
    s = normalize_input(raw)
    s = _convert_function_symbols(s)
    s = _convert_calculus(s)
    s = _collapse_repeating_nines(s)
    s = _strip_thousands_separators(s)
    s = _strip_digit_underscores(s)
    s = _convert_hex_literals(s)
    s = _tag_random_calls(s)
    s = s.replace("×", "*").replace("÷", "/").replace("^", "**")
    s = re.sub(r"(?<=[\d\)\]])\s*(?=[π𝝅τ])", "*", s)
    s = s.replace("π", "pi").replace("𝝅", "pi").replace("τ", "tau")
    s = _convert_superscript_exponents(s)
    s = _convert_degree_symbol(s)
    s = _convert_percent(s)
    s = _convert_misc_symbols(s)
    if mode == "scalar":
        s = s.replace("[", "(").replace("]", ")")
        s = s.replace("{", "(").replace("}", ")")
    s = _convert_abs_bars(s)
    s = _convert_sqrt_symbol(s)
    s = _convert_primorial_symbol(s)
    s = _convert_factorial_symbol(s)
    s = _convert_imaginary_literal(s)
    s = _convert_log_base_shorthand(s)
    s = _insert_implicit_mult(s)
    s = _convert_mod_operator(s)
    s = _convert_zscore_alias(s)
    if mode in ("vector", "matrix") or mode in _MATRIX_OP_MODES or ("[" in s and "]" in s):
        s = _wrap_bracket_literals(s)
    return s


_MATRIX_OP_MODES = ("determinant", "permanent", "diagonal")


def detect_mode(raw: str) -> str:
    raw = normalize_input(raw)
    if "[" in raw and "]" in raw:
        if re.search(r"\[\s*\[", raw):
            return "matrix"
        return "vector"
    return "scalar"


_ALLOWED_METHODS = {
    "T", "inv", "det", "rank", "trace", "eigenvals", "eigenvects",
    "nullspace", "columnspace", "LUdecomposition", "QRdecomposition",
    "diagonalize", "jordan_form", "solve", "pinv", "applyfunc", "norm",
    "distance", "dot", "cross", "normalize", "doit", "evalf", "simplify",
    "expand", "factor", "eye", "zeros", "ones", "per", "diagonal",
}

_ALLOWED_NODES = (
    ast.Expression, ast.BinOp, ast.UnaryOp, ast.Call, ast.Name, ast.Load,
    ast.Constant, ast.Attribute, ast.List, ast.Tuple,
    ast.Add, ast.Sub, ast.Mult, ast.Div, ast.Pow, ast.Mod, ast.FloorDiv,
    ast.USub, ast.UAdd, ast.keyword,
)


def validate_ast(s: str) -> None:
    try:
        tree = ast.parse(s, mode="eval")
    except SyntaxError as e:
        raise CalcError(f"算式格式錯誤，請確認輸入是否正確：{e}")

    for node in ast.walk(tree):
        if not isinstance(node, _ALLOWED_NODES):
            raise CalcError(
                f"算式包含不支援的語法（{type(node).__name__}），請確認輸入。"
            )
        if isinstance(node, ast.Attribute):
            if node.attr.startswith("__") and node.attr.endswith("__"):
                raise CalcError("算式包含不允許的屬性存取。")
            if node.attr not in _ALLOWED_METHODS:
                raise CalcError(f"不支援的方法：`.{node.attr}()`")
        if isinstance(node, ast.Name) and node.id.startswith("__"):
            raise CalcError("算式包含不允許的名稱。")


def _check_matrix_dim_safety(raw: str) -> None:
    rows = re.findall(r"\[([^\[\]]*)\]", raw)
    for row in rows:
        count = len([p for p in row.split(",") if p.strip() != ""])
        if count > MAX_MATRIX_DIM:
            raise CalcError(
                f"向量/矩陣單一維度過大（上限 {MAX_MATRIX_DIM}），請縮小輸入規模。"
            )
    if len(rows) > MAX_MATRIX_DIM:
        raise CalcError(
            f"矩陣列數過多（上限 {MAX_MATRIX_DIM}），請縮小輸入規模。"
        )


@dataclass
class CalcResult:
    mode: str
    original_display: str
    result: Any
    steps: List[Tuple[str, Any, Any]] = field(default_factory=list)


def _make_display_wrapper(display_name: str):
    def wrapped(*args, **kwargs):
        sym_args = [a if isinstance(a, (sympy.Basic, MatrixBase)) else sympy.sympify(a)
                    for a in args]
        return sympy.Function(display_name)(*sym_args)
    return wrapped


def build_display_namespace(angle_unit: str) -> dict:
    ns = build_namespace("scalar", angle_unit, allow_random=True)
    for name in list(ns.keys()):
        if name in _TRACKED_FUNC_NAMES:
            ns[name] = _make_display_wrapper(name)
    ns.update({
        "limit": _display_limit, "integrate": _display_integral,
        "summation": _display_sum, "product": _display_product,
    })
    return ns


def _find_reducible_node(node: Any):
    args = getattr(node, "args", ())
    if not args:
        return None
    for child in reversed(args):
        found = _find_reducible_node(child)
        if found is not None:
            return found
    if all(isinstance(a, sympy.Number) for a in args):
        return node
    return None


def _replace_node_keep_unevaluated(state: Any, target: Any, value: Any):
    if state == target:
        return value
    args = getattr(state, "args", ())
    if not args:
        return state
    new_args = tuple(_replace_node_keep_unevaluated(a, target, value) for a in args)
    if new_args == args:
        return state
    try:
        return state.func(*new_args, evaluate=False)
    except TypeError:
        return state.func(*new_args)


def _reduce_one_step(state: Any, step_log_map: dict):
    target = _find_reducible_node(state)
    if target is None:
        return None, None

    if isinstance(target, sympy.core.function.AppliedUndef):
        if target not in step_log_map:
            return None, None
        value = step_log_map[target]
    else:
        try:
            value = target.func(*target.args)
        except Exception:
            return None, None
        if not isinstance(value, sympy.Number):
            return None, None

    new_state = _replace_node_keep_unevaluated(state, target, value)
    return target, new_state


from sympy.parsing.sympy_parser import (
    EvaluateFalseTransformer,
    eval_expr as _sympy_eval_expr,
    stringify_expr as _sympy_stringify_expr,
)


class _ModAwareEvaluateFalseTransformer(EvaluateFalseTransformer):

    def visit_BinOp(self, node):
        if isinstance(node.op, ast.Mod):
            left = self.visit(node.left)
            right = self.visit(node.right)
            return ast.Call(
                func=ast.Name(id="Mod", ctx=ast.Load()),
                args=[left, right],
                keywords=[ast.keyword(arg="evaluate", value=ast.Constant(value=False))],
            )
        return super().visit_BinOp(node)


def _evaluate_false_mod_aware(code: str):
    node = ast.parse(code)
    transformed_node = _ModAwareEvaluateFalseTransformer().visit(node)
    transformed_node = ast.Expression(transformed_node.body[0].value)
    return ast.fix_missing_locations(transformed_node)


def _build_display_expr(processed: str, angle_unit: str):
    try:
        display_namespace = build_display_namespace(angle_unit)
        display_namespace.setdefault("Mod", sympy.Mod)
        display_global = {"__builtins__": {}}
        display_global.update(display_namespace)
        transformations = standard_transformations + (
            implicit_multiplication_application,
            convert_xor,
        )
        code = _sympy_stringify_expr(processed, display_namespace, display_global, transformations)
        compiled = compile(_evaluate_false_mod_aware(code), "<string>", "eval")
        display_expr = _sympy_eval_expr(compiled, display_namespace, display_global)
        if isinstance(display_expr, list) or isinstance(display_expr, MatrixBase):
            return None
        return display_expr
    except Exception:
        return None


def _exprs_equal(a: Any, b: Any) -> bool:
    if isinstance(a, str) or isinstance(b, str):
        return False
    if isinstance(a, MatrixBase) or isinstance(b, MatrixBase):
        return False
    try:
        if a == b:
            return True
        diff = sympy.simplify(sympy.sympify(a) - sympy.sympify(b))
        return diff == 0
    except Exception:
        return False


def _exprs_equal_after_subs(a: Any, b: Any, subs_map: dict) -> bool:
    if isinstance(a, str) or isinstance(b, str):
        return False
    if isinstance(a, MatrixBase) or isinstance(b, MatrixBase):
        return False
    try:
        aa = sympy.sympify(a).xreplace(subs_map) if subs_map else sympy.sympify(a)
        bb = sympy.sympify(b).xreplace(subs_map) if subs_map else sympy.sympify(b)
        if aa == bb:
            return True
        diff = sympy.simplify(aa - bb)
        return diff == 0
    except Exception:
        return False


def _guard_degenerate_lhs(lhs: Any, rhs: Any, raw: str) -> Any:
    if lhs is None or isinstance(lhs, str):
        return lhs
    if isinstance(lhs, MatrixBase) or isinstance(rhs, MatrixBase):
        return lhs
    try:
        if lhs == rhs:
            return raw
    except Exception:
        pass
    return lhs


def _format_float_str(value: Any, digits: int = DECIMAL_DIGITS) -> Any:
    fv = float(value)
    s = f"{fv:.{digits}f}"
    if "." in s:
        s = s.rstrip("0").rstrip(".")
    if s in ("", "-", "-0"):
        s = "0"
    if "." in s:
        sig = len(s.replace(".", "").replace("-", "").lstrip("0")) or 1
        return sympy.Float(s, sig)
    return sympy.Integer(s)


def _cap_float_precision(expr: Any, digits: int = DECIMAL_DIGITS) -> Any:
    if isinstance(expr, MatrixBase):
        return expr.applyfunc(lambda v: _cap_float_precision(v, digits))
    try:
        if isinstance(expr, sympy.Float):
            return _format_float_str(expr, digits)
        if hasattr(expr, "atoms"):
            floats = expr.atoms(sympy.Float)
            if floats:
                mapping = {f: _format_float_str(f, digits) for f in floats}
                return expr.xreplace(mapping)
    except Exception:
        pass
    return expr


_SCI_NOTATION_SMALL_THRESHOLD = Decimal(1).scaleb(-DECIMAL_DIGITS)


def format_large_result(value: Any) -> Any:
    if isinstance(value, MatrixBase):
        return value.applyfunc(format_large_result)
    try:
        v = sympy.sympify(value)
        if not (v.is_number and getattr(v, "is_real", False) and v.is_finite):
            return value
        if v == 0:
            return value
        ev = v.evalf(30)
        dec = Decimal(str(ev))
        abs_dec = abs(dec)
        if not (abs_dec > LARGE_INT_THRESHOLD or abs_dec < _SCI_NOTATION_SMALL_THRESHOLD):
            return value
        sci_str = format(dec, ".6e")
        mant, exp_str = sci_str.split("e")
        exp = int(exp_str)
        if "." in mant:
            mant = mant.rstrip("0").rstrip(".")
        if mant in ("", "-"):
            mant += "0"
        mant_val = sympy.Float(mant)
        power = sympy.Pow(sympy.Integer(10), exp, evaluate=False)
        return sympy.Mul(mant_val, power, evaluate=False)
    except Exception:
        pass
    return value


def has_decimal_variant(value: Any) -> bool:
    if isinstance(value, MatrixBase):
        return any(has_decimal_variant(v) for v in value)
    try:
        v = sympy.sympify(value)
        if not v.is_number:
            return False
        if v.is_infinite or v is sympy.nan:
            return False
        re_part, im_part = sympy.re(v), sympy.im(v)
        if im_part != 0:
            return has_decimal_variant(re_part) or has_decimal_variant(im_part)
        if re_part.is_Integer:
            return False
        return True
    except Exception:
        return False


def to_decimal_display(value: Any, digits: int = DECIMAL_DIGITS) -> Any:
    if isinstance(value, MatrixBase):
        return value.applyfunc(lambda v: to_decimal_display(v, digits))
    try:
        v = sympy.sympify(value)
        if not v.is_number:
            return value
        re_part, im_part = sympy.re(v), sympy.im(v)
        if im_part != 0:
            re_val = to_decimal_display(re_part, digits) if re_part != 0 else sympy.Integer(0)
            im_val = to_decimal_display(im_part, digits)
            return sympy.Add(re_val, sympy.Mul(im_val, sympy.I, evaluate=False), evaluate=False)
        fv = v.evalf(30)
        return _format_float_str(fv, digits)
    except Exception:
        return value


def format_decimal_string(value: Any, digits: int = DECIMAL_DIGITS) -> str:
    try:
        v = sympy.sympify(value)
    except Exception:
        return str(value)

    if not v.is_number:
        return str(value)

    re_part, im_part = sympy.re(v), sympy.im(v)
    if im_part != 0:
        im_is_neg = bool(im_part.is_negative)
        im_abs_str = format_decimal_string(Abs(im_part), digits)
        if re_part == 0:
            return f"-{im_abs_str}i" if im_is_neg else f"{im_abs_str}i"
        re_str = format_decimal_string(re_part, digits)
        sign = "-" if im_is_neg else "+"
        return f"{re_str}{sign}{im_abs_str}i"

    v = re_part

    if v.is_Integer:
        return str(int(v))

    old_prec = getcontext().prec
    try:
        getcontext().prec = digits + 40

        if v.is_Rational:
            p, q = int(v.p), int(v.q)
            neg = p < 0
            exact = Decimal(abs(p)) / Decimal(q)
            has_more = None
        else:
            neg = bool(v.is_negative)
            try:
                exact = abs(Decimal(str(v.evalf(digits + 30))))
            except Exception:
                exact = abs(Decimal(str(float(v.evalf(digits + 30)))))
            has_more = True

        quant = Decimal(1).scaleb(-digits)
        truncated = exact.quantize(quant, rounding=ROUND_DOWN)
        if has_more is None:
            has_more = (exact - truncated) != 0
    except Exception:
        return str(value)
    finally:
        getcontext().prec = old_prec

    s = f"{truncated:.{digits}f}"
    if not has_more:
        if "." in s:
            s = s.rstrip("0").rstrip(".")
    if s in ("", "-0"):
        s = "0"
    if neg and s != "0" and not s.startswith("-"):
        s = "-" + s
    if has_more:
        s += "..."
    return s


def to_decimal_display_text(value: Any, digits: int = DECIMAL_DIGITS):
    if isinstance(value, MatrixBase):
        rows, cols = value.shape
        return [
            [format_decimal_string(value[i, j], digits) for j in range(cols)]
            for i in range(rows)
        ]
    return format_decimal_string(value, digits)


def _do_calculate(raw: str, mode: str, angle_unit: str) -> CalcResult:
    processed = preprocess(raw, mode)
    validate_ast(processed)

    namespace = build_namespace(mode, angle_unit, allow_random=True)
    transformations = standard_transformations + (
        implicit_multiplication_application,
        convert_xor,
    )
    global_dict = {"__builtins__": {}}
    global_dict.update(namespace)

    _step_log.clear()
    _random_memo.clear()
    try:
        expr = parse_expr(
            processed,
            local_dict=namespace,
            global_dict=global_dict,
            transformations=transformations,
            evaluate=True,
        )
    except CalcError:
        raise
    except Exception as e:
        raise CalcError(f"算式格式錯誤，請確認輸入是否正確：{e}")

    if isinstance(expr, list):
        expr = Matrix(expr)

    sub_steps = list(_step_log)
    step_log_map = dict(sub_steps)

    display_expr = _build_display_expr(processed, angle_unit) if mode == "scalar" else None

    matrix_op_display = (
        expr if (mode in _MATRIX_OP_MODES and isinstance(expr, MatrixBase)) else None
    )

    steps: List[Tuple[str, Any, Any]] = [
        ("原始算式", None,
         display_expr if display_expr is not None
         else (matrix_op_display if matrix_op_display is not None else raw))
    ]

    if mode == "scalar" and display_expr is not None:
        state = display_expr
        guard = 0
        while guard < 60:
            guard += 1
            prev_state = state
            try:
                target, new_state = _reduce_one_step(state, step_log_map)
            except Exception:
                break
            if target is None:
                break
            if isinstance(target, sympy.core.function.AppliedUndef):
                steps.append((f"計算 {target}", prev_state, new_state))
            state = new_state
            if isinstance(state, sympy.Number):
                break
    else:
        for call_expr, value in sub_steps:
            steps.append((f"計算 {call_expr}", call_expr, value))

    if mode == "scalar":
        try:
            expanded = sympy.expand(expr)
        except Exception:
            expanded = expr
        if expanded != expr:
            steps.append(("展開 / 化簡", expr, expanded))
        try:
            simplified = simplify(expr)
        except Exception:
            simplified = expanded
        if simplified != expanded:
            steps.append(("進一步化簡", expanded, simplified))
        result = simplified
    elif mode == "determinant":
        if not isinstance(expr, MatrixBase):
            raise CalcError("「行列式」模式請直接輸入矩陣，例如 [[1,2],[3,4]]。")
        if expr.rows != expr.cols:
            raise CalcError(
                f"行列式只能用在方陣（列數＝欄數），目前輸入的是 {expr.rows}x{expr.cols} 矩陣。"
            )
        try:
            result = expr.det()
        except Exception as e:
            raise CalcError(f"行列式計算失敗，請確認矩陣內容：{e}")
    elif mode == "permanent":
        if not isinstance(expr, MatrixBase):
            raise CalcError("「積和式」模式請直接輸入矩陣，例如 [[1,2],[3,4]]。")
        if expr.rows != expr.cols:
            raise CalcError(
                f"積和式只能用在方陣（列數＝欄數），目前輸入的是 {expr.rows}x{expr.cols} 矩陣。"
            )
        try:
            result = expr.per()
        except Exception as e:
            raise CalcError(f"積和式計算失敗，請確認矩陣內容：{e}")
    elif mode == "diagonal":
        if not isinstance(expr, MatrixBase):
            raise CalcError("「對角線」模式請直接輸入矩陣，例如 [[1,2],[3,4]]。")
        try:
            result = expr.diagonal().T
        except Exception as e:
            raise CalcError(f"取對角線失敗，請確認矩陣內容：{e}")
    else:
        result = expr

    _check_undefined(result)
    result = _cap_float_precision(result)
    result = format_large_result(result)
    result = _unmask_symbols(result)

    final_lhs = (
        display_expr if display_expr is not None
        else (matrix_op_display if matrix_op_display is not None else raw)
    )

    skip_final_step = False
    if steps:
        _, last_lhs, last_rhs = steps[-1]
        if (
            last_lhs is not None
            and not isinstance(last_lhs, str)
            and not isinstance(final_lhs, str)
            and not isinstance(last_lhs, MatrixBase)
            and not isinstance(final_lhs, MatrixBase)
            and not isinstance(last_rhs, MatrixBase)
            and not isinstance(result, MatrixBase)
        ):
            try:
                if last_lhs == final_lhs and last_rhs == result:
                    skip_final_step = True
            except Exception:
                pass

    if skip_final_step:
        _, last_lhs, last_rhs = steps[-1]
        steps[-1] = ("最終結果", last_lhs, last_rhs)
    else:
        steps.append(("最終結果", final_lhs, result))

    guarded_steps: List[Tuple[str, Any, Any]] = []
    for title, lhs, rhs in steps:
        lhs, rhs = _unmask_symbols(lhs), _unmask_symbols(rhs)
        guarded_steps.append((title, _guard_degenerate_lhs(lhs, rhs, raw), rhs))

    return CalcResult(mode=mode, original_display=raw, result=result, steps=guarded_steps)


from sympy.core.parameters import evaluate as _sympy_evaluate_ctx

_FROZEN_TAG = "__frozen_sympy_expr__"


def _freeze_step_value(value: Any) -> Any:
    if value is None or isinstance(value, str) or isinstance(value, MatrixBase):
        return value
    try:
        return (_FROZEN_TAG, sympy.srepr(value))
    except Exception:
        return value


def _thaw_step_value(value: Any) -> Any:
    if (
        isinstance(value, tuple)
        and len(value) == 2
        and value[0] == _FROZEN_TAG
    ):
        with _sympy_evaluate_ctx(False):
            return sympy.sympify(value[1], evaluate=False)
    return value


def _freeze_calc_result(result: "CalcResult") -> "CalcResult":
    result.steps = [
        (title, _freeze_step_value(lhs), _freeze_step_value(rhs))
        for title, lhs, rhs in result.steps
    ]
    return result


def _thaw_calc_result(result: "CalcResult") -> "CalcResult":
    result.steps = [
        (title, _thaw_step_value(lhs), _thaw_step_value(rhs))
        for title, lhs, rhs in result.steps
    ]
    return result


def _worker(raw: str, mode: str, angle_unit: str, queue: "mp.Queue") -> None:
    try:
        result = _do_calculate(raw, mode, angle_unit)
        queue.put(("ok", _freeze_calc_result(result)))
    except CalcError as e:
        queue.put(("error", str(e)))
    except Exception as e:
        queue.put(("error", f"計算過程發生未預期的錯誤：{e}"))


async def safe_calculate(
    raw: str,
    mode: Optional[str],
    angle_unit: str,
    loop=None,
    timeout: float = COMPUTE_TIMEOUT,
    variables: Optional[str] = None,
) -> CalcResult:
    import asyncio

    raw = normalize_input(raw)
    raw = substitute_placeholders(raw, variables)

    _check_raw_safety(_convert_hex_literals(raw))

    resolved_mode = mode or detect_mode(raw)
    if resolved_mode in ("vector", "matrix") or resolved_mode in _MATRIX_OP_MODES:
        _check_matrix_dim_safety(raw)

    if loop is None:
        loop = asyncio.get_event_loop()

    def _run() -> CalcResult:
        ctx = mp.get_context("spawn")
        q: "mp.Queue" = ctx.Queue()
        p = ctx.Process(target=_worker, args=(raw, resolved_mode, angle_unit, q))
        p.start()
        p.join(timeout)
        if p.is_alive():
            p.terminate()
            p.join()
            raise CalcError(
                "計算時間過長（可能是數字過大或運算過於複雜），請簡化算式後再試一次。"
            )
        if q.empty():
            raise CalcError("計算過程發生未知錯誤（子行程未回傳結果）。")
        status, payload = q.get()
        if status == "error":
            raise CalcError(payload)
        return _thaw_calc_result(payload)

    return await loop.run_in_executor(None, _run)