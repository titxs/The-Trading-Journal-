#!/usr/bin/env python3
"""
trades_sync.py -- direct read/write access to Titus's "Alpha Journal" Firestore
database (the-trading-journal-f677a), the same "trades" collection his Vercel
app (thetradingjournal-...vercel.app) reads/writes via onSnapshot. No Node.js
or npm required -- pure stdlib, talks to the Firebase REST APIs directly:

1. Identity Toolkit "accounts:signUp" with the app's public client apiKey to
   get an anonymous ID token (same auth flow the app itself uses -- this key
   is not a secret, Firestore Security Rules are the actual gate).
2. Firestore REST API (firestore.googleapis.com) using that token as Bearer
   auth to list / create / update / delete documents in the "trades"
   collection.

Usage (from this folder):
    python3 trades_sync.py list                       # print all trades (id, date, direction, result, pnl)
    python3 trades_sync.py get <id>                    # print one trade in full
    python3 trades_sync.py upsert <id> '<json fields>'  # create/update a trade -- json is a flat dict of field:value
    python3 trades_sync.py delete <id>

Field shape matches src/TradeJournal.jsx's `defaultTrade` -- see that file for
the full field list (date, pair, direction, regime, setup, keyLevel,
levelType[], confluence[], entry, stop, tp1, tp2, posSize, leverage, result,
pnl, pnlDollar, closePrice, notes, screenshots[], createdAt, ...).
"""

import json
import sys
import urllib.error
import urllib.request

API_KEY = "AIzaSyCE2inSOEE-dWIkNOND_hBGfkYeZbgopDw"
PROJECT = "the-trading-journal-f677a"
COLLECTION = "trades"
BASE = f"https://firestore.googleapis.com/v1/projects/{PROJECT}/databases/(default)/documents/{COLLECTION}"


def _request(url, token=None, method="GET", body=None):
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            return json.loads(r.read() or b"{}")
    except urllib.error.HTTPError as e:
        sys.exit(f"HTTP {e.code} on {method} {url}: {e.read().decode()[:500]}")


def get_token():
    url = f"https://identitytoolkit.googleapis.com/v1/accounts:signUp?key={API_KEY}"
    data = _request(url, method="POST", body={"returnSecureToken": True})
    return data["idToken"]


# ---- Firestore <-> plain Python value conversion ----

def to_firestore_value(v):
    if v is None:
        return {"nullValue": None}
    if isinstance(v, bool):
        return {"booleanValue": v}
    if isinstance(v, int):
        return {"integerValue": str(v)}
    if isinstance(v, float):
        return {"doubleValue": v}
    if isinstance(v, str):
        return {"stringValue": v}
    if isinstance(v, list):
        return {"arrayValue": {"values": [to_firestore_value(x) for x in v]}}
    if isinstance(v, dict):
        return {"mapValue": {"fields": {k: to_firestore_value(x) for k, x in v.items()}}}
    return {"stringValue": str(v)}


def from_firestore_value(v):
    if "nullValue" in v:
        return None
    if "booleanValue" in v:
        return v["booleanValue"]
    if "integerValue" in v:
        return int(v["integerValue"])
    if "doubleValue" in v:
        return v["doubleValue"]
    if "stringValue" in v:
        return v["stringValue"]
    if "arrayValue" in v:
        return [from_firestore_value(x) for x in v["arrayValue"].get("values", [])]
    if "mapValue" in v:
        return {k: from_firestore_value(x) for k, x in v["mapValue"].get("fields", {}).items()}
    return None


def doc_to_dict(doc):
    out = {k: from_firestore_value(v) for k, v in doc.get("fields", {}).items()}
    out["_docId"] = doc["name"].rsplit("/", 1)[-1]
    return out


def dict_to_fields(d):
    return {k: to_firestore_value(v) for k, v in d.items()}


# ---- public operations ----

def list_trades(token):
    trades, page_token = [], None
    while True:
        url = BASE + (f"?pageToken={page_token}" if page_token else "")
        data = _request(url, token=token)
        for doc in data.get("documents", []):
            trades.append(doc_to_dict(doc))
        page_token = data.get("nextPageToken")
        if not page_token:
            break
    return trades


def get_trade(token, doc_id):
    data = _request(f"{BASE}/{doc_id}", token=token)
    return doc_to_dict(data)


def upsert_trade(token, doc_id, fields):
    body = {"fields": dict_to_fields(fields)}
    _request(f"{BASE}/{doc_id}", token=token, method="PATCH", body=body)


def delete_trade(token, doc_id):
    _request(f"{BASE}/{doc_id}", token=token, method="DELETE")


def main():
    if len(sys.argv) < 2:
        print(__doc__)
        return
    cmd = sys.argv[1]
    token = get_token()

    if cmd == "list":
        trades = list_trades(token)
        trades.sort(key=lambda t: t.get("createdAt", 0), reverse=True)
        print(f"{len(trades)} trades\n")
        for t in trades:
            print(f"{t.get('_docId'):>15}  {t.get('date',''):<10} {t.get('direction','')  :<6} "
                  f"result={t.get('result','') or '-':<5} pnl={t.get('pnl','') or '-':<7} "
                  f"setup={t.get('setup','')}")
    elif cmd == "get":
        print(json.dumps(get_trade(token, sys.argv[2]), indent=2))
    elif cmd == "upsert":
        doc_id = sys.argv[2]
        fields = json.loads(sys.argv[3])
        upsert_trade(token, doc_id, fields)
        print(f"Upserted {doc_id}")
    elif cmd == "delete":
        delete_trade(token, sys.argv[2])
        print(f"Deleted {sys.argv[2]}")
    else:
        print(__doc__)


if __name__ == "__main__":
    main()
