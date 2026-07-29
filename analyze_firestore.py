#!/usr/bin/env python3
"""
analyze_firestore.py -- trade_journal.csv's analysis, but against the live
Firestore "trades" collection (the real journal now: 52+ trades with full
notes/screenshots/self-review, vs. the CSV's 1 backfilled row).

Run:
    python3 analyze_firestore.py

Two tiers of stats:
1. App-native fields (result, pnl, setup, regime, rr) -- present on nearly
   every trade already logged through the app's own Log/Quick Entry forms.
2. Framework fields (grade, gexRegime, frameworkSetup) -- added on top of the
   app's schema so it can also answer CLAUDE.md's specific questions (win
   rate by A+/A/B/C grade, by GEX regime, by the five named setups). Only
   present on trades logged going forward (via Claude Code) or manually
   filled in-app -- most of the 52 historical trades won't have these yet.
   Coverage is reported so you know how much of the framework-specific
   breakdown to trust.
"""

import sys
from collections import defaultdict

from trades_sync import get_token, list_trades


def to_float(v):
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def summarize(trades, key):
    groups = defaultdict(lambda: {"wins": 0, "losses": 0, "be": 0, "total": 0})
    for t in trades:
        result = (t.get("result") or "").strip().upper()
        if result not in ("WIN", "LOSS", "BE"):
            continue
        k = t.get(key) or "(unlabeled)"
        g = groups[k]
        g["total"] += 1
        if result == "WIN":
            g["wins"] += 1
        elif result == "LOSS":
            g["losses"] += 1
        else:
            g["be"] += 1
    return groups


def print_group(title, groups):
    print(f"\n-- {title} --")
    if not groups:
        print("  (no closed trades with this field set yet)")
        return
    for k, g in sorted(groups.items(), key=lambda kv: -kv[1]["total"]):
        decided = g["wins"] + g["losses"]
        wr = (g["wins"] / decided * 100) if decided else 0
        print(f"  {str(k):<22} trades={g['total']:<3} wins={g['wins']:<3} "
              f"losses={g['losses']:<3} be={g['be']:<3} win_rate={wr:5.1f}%")


def main():
    token = get_token()
    trades = list_trades(token)

    closed = [t for t in trades if (t.get("result") or "").strip().upper() in ("WIN", "LOSS", "BE")]
    open_or_unlogged = [t for t in trades if t not in closed]

    print("=== Firestore Trade Journal Summary ===")
    print(f"Total docs: {len(trades)}  |  Closed (WIN/LOSS/BE): {len(closed)}  |  "
          f"No result logged yet: {len(open_or_unlogged)}")

    if len(closed) < 5:
        print("\n[!] Fewer than 5 closed trades -- treat everything below as too small a sample.")

    print_group("By result / setup (app-native)", summarize(closed, "setup"))
    print_group("By structural regime (app-native: trending_bull/bear/balanced/post_trend/high_vol)",
                 summarize(closed, "regime"))

    graded = [t for t in closed if t.get("grade")]
    print(f"\nFramework-field coverage: {len(graded)}/{len(closed)} closed trades have a "
          f"CLAUDE.md 'grade' logged ({len(graded)/len(closed)*100:.0f}%).")
    if graded:
        print_group("By grade (A+/A/B/C)", summarize(graded, "grade"))
        print_group("By GEX regime (long_gamma/near_flip/short_gamma)", summarize(graded, "gexRegime"))
        print_group("By framework setup (VWAP revisit / value_area_edge / 70pct / profile_tail / poc_frvp_stack)",
                     summarize(graded, "frameworkSetup"))

    rr_vals = [v for v in (to_float(t.get("rr")) for t in closed) if v is not None]
    if rr_vals:
        print(f"\nAverage logged R:R across closed trades: {sum(rr_vals)/len(rr_vals):.2f}")

    pnl_pairs = [((t.get("result") or "").upper(), to_float(t.get("pnl"))) for t in closed]
    pnl_pairs = [(o, v) for o, v in pnl_pairs if v is not None]
    wins = [v for o, v in pnl_pairs if o == "WIN"]
    losses = [v for o, v in pnl_pairs if o == "LOSS"]
    if wins or losses:
        win_rate = len(wins) / (len(wins) + len(losses)) if (wins or losses) else 0
        avg_win = sum(wins) / len(wins) if wins else 0
        avg_loss = sum(losses) / len(losses) if losses else 0
        expectancy = win_rate * avg_win + (1 - win_rate) * avg_loss
        print(f"Avg win: {avg_win:+.2f}%  |  Avg loss: {avg_loss:+.2f}%  |  "
              f"Simple expectancy per trade: {expectancy:+.2f}%")

    violations = []
    for t in graded:
        grade = (t.get("grade") or "").upper()
        rr = to_float(t.get("rr"))
        if grade in ("A+", "A") and rr is not None and rr < 2.0:
            violations.append((t.get("date"), grade, rr))
    if violations:
        print("\n[!] Rule check -- graded A/A+ but logged below your 2:1 minimum R:R:")
        for date, grade, rr in violations:
            print(f"    {date}: grade={grade} rr={rr}")

    followed = [t for t in closed if t.get("followedRules")]
    if followed:
        yes = sum(1 for t in followed if (t.get("followedRules") or "").upper() == "YES")
        print(f"\nFollowed own rules: {yes}/{len(followed)} ({yes/len(followed)*100:.0f}%) of trades with that field logged.")


if __name__ == "__main__":
    main()
