import { useState, useEffect, useRef } from "react";
import { db } from "./firebase";
import {
  collection,
  doc,
  setDoc,
  deleteDoc,
  onSnapshot,
  query,
  orderBy,
} from "firebase/firestore";

const COLLECTION = "trades";

const defaultTrade = {
  id: "",
  date: "",
  pair: "BTC/USD",
  direction: "",
  keyLevel: "",
  levelType: [],
  confluence: [],
  conviction: "",
  entryType: "",
  bubbleSize: "",
  bubbleDirection: "",
  entry: "",
  stop: "",
  tp1: "",
  tp2: "",
  rr: "",
  posSize: "1%",
  result: "",
  pnl: "",
  pnlDollar: "",
  followedRules: "",
  confirmed: "",
  different: "",
  notes: "",
  screenshots: [],
};

const confluenceOptions = [
  "CVD diverging",
  "CVD trending",
  "OI rising",
  "OI dropping (liquidations)",
  "Wall holding (filled not pulled)",
  "Wall getting pulled (spoof)",
  "Funding confirming crowded side",
  "B-shape candle",
  "P-shape candle",
  "Single prints in direction",
  "LVNs in direction",
  "Liquidation cluster swept",
  "Naked POC at level",
  "Levels stacking",
  "SFP at swing point",
  "Absorption visible",
  "Exhaustion (no wall, move died)",
  "Delta flip",
  "Second bubble (same direction)",
  "Backtest confirmed",
  "Multi-timeframe VWAP alignment",
  "Composite level",
  "Options expiry context",
  "Stealth accumulation / distribution",
];

const levelTypes = [
  "Daily VWAP",
  "Weekly VWAP",
  "Monthly VWAP",
  "VWAP Deviation Band",
  "POC",
  "Composite POC",
  "Naked POC",
  "VAH",
  "VAL",
  "Previous Day VAH",
  "Previous Day VAL",
  "Previous Day POC",
  "Previous Week VAH",
  "Previous Week VAL",
  "Previous Week POC",
  "Composite VAH",
  "Composite VAL",
  "Single Prints",
  "Poor High",
  "Poor Low",
  "Swing High",
  "Swing Low",
  "Equal POCs",
  "Liq Cluster",
  "Max Pain (Expiry)",
  "High OI Strike",
  "RVWAP",
  "Anchored VWAP",
];

export default function TradeJournal() {
  const [trades, setTrades] = useState([]);
  const [currentTrade, setCurrentTrade] = useState({ ...defaultTrade });
  const [view, setView] = useState("log");
  const [editingId, setEditingId] = useState(null);
  const [expandedTrade, setExpandedTrade] = useState(null);
  const [filterResult, setFilterResult] = useState("ALL");
  const [calendarMonth, setCalendarMonth] = useState(new Date());
  const fileInputRef = useRef(null);

  useEffect(() => {
    const q = query(collection(db, COLLECTION), orderBy("createdAt", "desc"));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const loaded = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
      setTrades(loaded);
    }, (error) => {
      console.error("Firebase error:", error);
    });
    return () => unsubscribe();
  }, []);

  const saveTrades = () => {};

  const saveTrade = async (trade) => {
    try {
      const tradeData = { ...trade, createdAt: trade.createdAt || Date.now() };
      await setDoc(doc(db, COLLECTION, trade.id), tradeData);
    } catch (e) {
      console.error("Save failed:", e);
    }
  };

  const removeTrade = async (id) => {
    try {
      await deleteDoc(doc(db, COLLECTION, id));
    } catch (e) {
      console.error("Delete failed:", e);
    }
  };

  const handleSubmit = () => {
    if (!currentTrade.date || !currentTrade.direction || !currentTrade.keyLevel) return;
    const trade = {
      ...currentTrade,
      id: editingId || Date.now().toString(),
      rr: calculateRR(currentTrade),
      createdAt: editingId ? (trades.find(t => t.id === editingId)?.createdAt || Date.now()) : Date.now(),
    };
    saveTrade(trade);
    setEditingId(null);
    setCurrentTrade({ ...defaultTrade });
    setView("history");
  };

  const deleteTrade = (id) => {
    removeTrade(id);
    if (expandedTrade === id) setExpandedTrade(null);
  };

  const editTrade = (trade) => {
    setCurrentTrade({ ...trade });
    setEditingId(trade.id);
    setView("log");
  };

  const calculateRR = (t) => {
    const entry = parseFloat(t.entry);
    const stop = parseFloat(t.stop);
    const tp1 = parseFloat(t.tp1);
    if (!entry || !stop || !tp1) return "";
    const risk = Math.abs(entry - stop);
    if (risk === 0) return "";
    const reward = Math.abs(tp1 - entry);
    return (reward / risk).toFixed(1) + ":1";
  };

  const handleScreenshot = (e) => {
    const files = Array.from(e.target.files);
    files.forEach((file) => {
      const reader = new FileReader();
      reader.onload = (ev) => {
        setCurrentTrade((prev) => ({
          ...prev,
          screenshots: [...prev.screenshots, ev.target.result],
        }));
      };
      reader.readAsDataURL(file);
    });
  };

  const removeScreenshot = (idx) => {
    setCurrentTrade((prev) => ({
      ...prev,
      screenshots: prev.screenshots.filter((_, i) => i !== idx),
    }));
  };

  const stats = {
    total: trades.filter((t) => t.result).length,
    wins: trades.filter((t) => t.result === "WIN").length,
    losses: trades.filter((t) => t.result === "LOSS").length,
    be: trades.filter((t) => t.result === "BE").length,
    rulesFollowed: trades.filter((t) => t.followedRules === "YES").length,
    winRate: 0,
    rulesRate: 0,
    totalPnl: 0,
    totalDollar: 0,
    avgRR: 0,
    bestTrade: 0,
    worstTrade: 0,
  };
  if (stats.total > 0) {
    stats.winRate = ((stats.wins / stats.total) * 100).toFixed(1);
    stats.rulesRate = ((stats.rulesFollowed / stats.total) * 100).toFixed(1);
    const pnls = trades.filter((t) => t.pnl).map((t) => parseFloat(t.pnl));
    stats.totalPnl = pnls.reduce((a, b) => a + b, 0).toFixed(2);
    const dollars = trades.filter((t) => t.pnlDollar).map((t) => parseFloat(t.pnlDollar));
    stats.totalDollar = dollars.length ? dollars.reduce((a, b) => a + b, 0).toFixed(2) : 0;
    stats.bestTrade = pnls.length ? Math.max(...pnls).toFixed(2) : 0;
    stats.worstTrade = pnls.length ? Math.min(...pnls).toFixed(2) : 0;
    const winRRs = trades
      .filter((t) => t.result === "WIN" && t.rr)
      .map((t) => parseFloat(t.rr));
    stats.avgRR = winRRs.length
      ? (winRRs.reduce((a, b) => a + b, 0) / winRRs.length).toFixed(1)
      : 0;
  }

  const filteredTrades =
    filterResult === "ALL"
      ? trades
      : trades.filter((t) => t.result === filterResult);

  const toggleConfluence = (item) => {
    setCurrentTrade((prev) => ({
      ...prev,
      confluence: prev.confluence.includes(item)
        ? prev.confluence.filter((c) => c !== item)
        : [...prev.confluence, item],
    }));
  };

  const inputStyle = {
    background: "#0d1117",
    border: "1px solid #21262d",
    borderRadius: 6,
    color: "#e6edf3",
    padding: "8px 12px",
    fontSize: 13,
    width: "100%",
    outline: "none",
    fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
    transition: "border-color 0.2s",
  };

  const labelStyle = {
    color: "#7d8590",
    fontSize: 11,
    fontWeight: 600,
    textTransform: "uppercase",
    letterSpacing: "0.05em",
    marginBottom: 4,
    display: "block",
    fontFamily: "'JetBrains Mono', monospace",
  };

  const chipBase = {
    padding: "6px 12px",
    borderRadius: 20,
    fontSize: 12,
    cursor: "pointer",
    transition: "all 0.2s",
    border: "1px solid transparent",
    fontFamily: "'JetBrains Mono', monospace",
    fontWeight: 500,
    userSelect: "none",
  };

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "linear-gradient(180deg, #0a0c10 0%, #0d1117 50%, #0a0c10 100%)",
        color: "#e6edf3",
        fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
        padding: "0 16px 40px",
      }}
    >
      {/* Header */}
      <div
        style={{
          padding: "20px 0 16px",
          borderBottom: "1px solid #21262d",
          marginBottom: 20,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          flexWrap: "wrap",
          gap: 12,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div
            style={{
              width: 8,
              height: 8,
              borderRadius: "50%",
              background: "#00ff88",
              boxShadow: "0 0 8px #00ff8866",
            }}
          />
          <span
            style={{
              fontSize: 18,
              fontWeight: 700,
              letterSpacing: "-0.02em",
              color: "#f0f6fc",
            }}
          >
            TRADE JOURNAL
          </span>
        </div>

        <div style={{ display: "flex", gap: 4, background: "#161b22", borderRadius: 8, padding: 3 }}>
          {["log", "history", "dashboard", "stats"].map((v) => (
            <button
              key={v}
              onClick={() => setView(v)}
              style={{
                padding: "7px 16px",
                borderRadius: 6,
                border: "none",
                cursor: "pointer",
                fontSize: 12,
                fontWeight: 600,
                fontFamily: "'JetBrains Mono', monospace",
                textTransform: "uppercase",
                letterSpacing: "0.05em",
                background: view === v ? "#00ff8820" : "transparent",
                color: view === v ? "#00ff88" : "#7d8590",
                transition: "all 0.2s",
              }}
            >
              {v === "log" ? (editingId ? "✏️ Edit" : "＋ Log") : v === "history" ? "📋 History" : v === "dashboard" ? "📅 P&L" : "📊 Stats"}
            </button>
          ))}
        </div>
      </div>

      {/* LOG VIEW */}
      {view === "log" && (
        <div style={{ maxWidth: 800, margin: "0 auto" }}>
          {/* Basic Info */}
          <Section title="TRADE INFO">
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
              <Field label="Date">
                <input
                  type="date"
                  value={currentTrade.date}
                  onChange={(e) => setCurrentTrade({ ...currentTrade, date: e.target.value })}
                  style={inputStyle}
                />
              </Field>
              <Field label="Pair">
                <input
                  value={currentTrade.pair}
                  onChange={(e) => setCurrentTrade({ ...currentTrade, pair: e.target.value })}
                  style={inputStyle}
                />
              </Field>
              <Field label="Direction">
                <div style={{ display: "flex", gap: 6 }}>
                  {["LONG", "SHORT"].map((d) => (
                    <button
                      key={d}
                      onClick={() => setCurrentTrade({ ...currentTrade, direction: d })}
                      style={{
                        ...chipBase,
                        flex: 1,
                        background:
                          currentTrade.direction === d
                            ? d === "LONG"
                              ? "#00ff8825"
                              : "#ff445525"
                            : "#161b22",
                        color:
                          currentTrade.direction === d
                            ? d === "LONG"
                              ? "#00ff88"
                              : "#ff4455"
                            : "#7d8590",
                        border: `1px solid ${
                          currentTrade.direction === d
                            ? d === "LONG"
                              ? "#00ff8844"
                              : "#ff445544"
                            : "#21262d"
                        }`,
                      }}
                    >
                      {d === "LONG" ? "▲" : "▼"} {d}
                    </button>
                  ))}
                </div>
              </Field>
            </div>
          </Section>

          {/* Key Level */}
          <Section title="KEY LEVEL">
            <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 12 }}>
              <Field label="Price Level">
                <input
                  value={currentTrade.keyLevel}
                  onChange={(e) => setCurrentTrade({ ...currentTrade, keyLevel: e.target.value })}
                  placeholder="e.g. 65123"
                  style={inputStyle}
                />
              </Field>
              <Field label="Level Type (select all that apply — stacked = stronger)">
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                  {levelTypes.map((lt) => (
                    <button
                      key={lt}
                      onClick={() => {
                        setCurrentTrade((prev) => ({
                          ...prev,
                          levelType: prev.levelType.includes(lt)
                            ? prev.levelType.filter((l) => l !== lt)
                            : [...prev.levelType, lt],
                        }));
                      }}
                      style={{
                        ...chipBase,
                        background: currentTrade.levelType.includes(lt) ? "#f0c00020" : "#161b22",
                        color: currentTrade.levelType.includes(lt) ? "#f0c000" : "#7d8590",
                        border: `1px solid ${currentTrade.levelType.includes(lt) ? "#f0c00044" : "#21262d"}`,
                      }}
                    >
                      {currentTrade.levelType.includes(lt) ? "✓ " : ""}{lt}
                    </button>
                  ))}
                </div>
                {currentTrade.levelType.length > 1 && (
                  <div style={{ marginTop: 6, fontSize: 12, color: "#f0c000", fontWeight: 600 }}>
                    ⚡ {currentTrade.levelType.length} levels stacking
                  </div>
                )}
              </Field>
            </div>
          </Section>

          {/* Confluence */}
          <Section title="CONFLUENCE FACTORS">
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {confluenceOptions.map((item) => (
                <button
                  key={item}
                  onClick={() => toggleConfluence(item)}
                  style={{
                    ...chipBase,
                    background: currentTrade.confluence.includes(item)
                      ? "#00b4d820"
                      : "#161b22",
                    color: currentTrade.confluence.includes(item) ? "#00b4d8" : "#7d8590",
                    border: `1px solid ${
                      currentTrade.confluence.includes(item) ? "#00b4d844" : "#21262d"
                    }`,
                  }}
                >
                  {currentTrade.confluence.includes(item) ? "✓ " : ""}
                  {item}
                </button>
              ))}
            </div>
            <div
              style={{
                marginTop: 8,
                fontSize: 12,
                color: (currentTrade.confluence.length + (currentTrade.levelType.length > 1 ? 1 : 0)) >= 3 ? "#00ff88" : (currentTrade.confluence.length + (currentTrade.levelType.length > 1 ? 1 : 0)) >= 2 ? "#f0c000" : "#ff4455",
                fontWeight: 600,
              }}
            >
              {currentTrade.confluence.length} factors{currentTrade.levelType.length > 1 ? ` + stacked levels` : ""} →{" "}
              {(currentTrade.confluence.length + (currentTrade.levelType.length > 1 ? 1 : 0)) >= 3
                ? "HIGH conviction"
                : (currentTrade.confluence.length + (currentTrade.levelType.length > 1 ? 1 : 0)) >= 2
                ? "MEDIUM conviction"
                : (currentTrade.confluence.length + (currentTrade.levelType.length > 1 ? 1 : 0)) >= 1
                ? "LOW conviction"
                : "No confluence"}
            </div>
          </Section>

          {/* Delta Bubble */}
          <Section title="DELTA BUBBLE">
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
              <Field label="Bubble Size">
                <input
                  value={currentTrade.bubbleSize}
                  onChange={(e) => setCurrentTrade({ ...currentTrade, bubbleSize: e.target.value })}
                  placeholder="e.g. 53M"
                  style={inputStyle}
                />
              </Field>
              <Field label="Bubble Delta">
                <div style={{ display: "flex", gap: 6 }}>
                  {["POSITIVE", "NEGATIVE"].map((d) => (
                    <button
                      key={d}
                      onClick={() => setCurrentTrade({ ...currentTrade, bubbleDirection: d })}
                      style={{
                        ...chipBase,
                        flex: 1,
                        fontSize: 11,
                        background: currentTrade.bubbleDirection === d ? "#00b4d820" : "#161b22",
                        color: currentTrade.bubbleDirection === d ? "#00b4d8" : "#7d8590",
                        border: `1px solid ${currentTrade.bubbleDirection === d ? "#00b4d844" : "#21262d"}`,
                      }}
                    >
                      {d === "POSITIVE" ? "＋" : "−"} {d}
                    </button>
                  ))}
                </div>
              </Field>
              <Field label="Entry Type">
                <div style={{ display: "flex", gap: 6 }}>
                  {["Aggressive", "Conservative"].map((t) => (
                    <button
                      key={t}
                      onClick={() => setCurrentTrade({ ...currentTrade, entryType: t })}
                      style={{
                        ...chipBase,
                        flex: 1,
                        fontSize: 11,
                        background: currentTrade.entryType === t ? "#f0c00020" : "#161b22",
                        color: currentTrade.entryType === t ? "#f0c000" : "#7d8590",
                        border: `1px solid ${currentTrade.entryType === t ? "#f0c00044" : "#21262d"}`,
                      }}
                    >
                      {t}
                    </button>
                  ))}
                </div>
              </Field>
            </div>
          </Section>

          {/* Prices */}
          <Section title="EXECUTION">
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr 1fr", gap: 12 }}>
              {[
                ["Entry", "entry", "Entry price"],
                ["Stop Loss", "stop", "SL price"],
                ["TP1", "tp1", "First target"],
                ["TP2", "tp2", "Second target"],
                ["Position Size", "posSize", "1% or 2%"],
              ].map(([label, key, ph]) => (
                <Field key={key} label={label}>
                  <input
                    value={currentTrade[key]}
                    onChange={(e) => setCurrentTrade({ ...currentTrade, [key]: e.target.value })}
                    placeholder={ph}
                    style={inputStyle}
                  />
                </Field>
              ))}
            </div>
            {currentTrade.entry && currentTrade.stop && currentTrade.tp1 && (
              <div
                style={{
                  marginTop: 10,
                  padding: "8px 14px",
                  background: "#161b22",
                  borderRadius: 8,
                  fontSize: 13,
                  color: "#00ff88",
                  fontWeight: 600,
                  display: "inline-block",
                }}
              >
                R:R → {calculateRR(currentTrade) || "..."}
              </div>
            )}
          </Section>

          {/* Result */}
          <Section title="RESULT">
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 12 }}>
              <Field label="Outcome">
                <div style={{ display: "flex", gap: 6 }}>
                  {["WIN", "LOSS", "BE"].map((r) => (
                    <button
                      key={r}
                      onClick={() => setCurrentTrade({ ...currentTrade, result: r })}
                      style={{
                        ...chipBase,
                        flex: 1,
                        background:
                          currentTrade.result === r
                            ? r === "WIN"
                              ? "#00ff8825"
                              : r === "LOSS"
                              ? "#ff445525"
                              : "#f0c00025"
                            : "#161b22",
                        color:
                          currentTrade.result === r
                            ? r === "WIN"
                              ? "#00ff88"
                              : r === "LOSS"
                              ? "#ff4455"
                              : "#f0c000"
                            : "#7d8590",
                        border: `1px solid ${
                          currentTrade.result === r
                            ? r === "WIN"
                              ? "#00ff8844"
                              : r === "LOSS"
                              ? "#ff445544"
                              : "#f0c00044"
                            : "#21262d"
                        }`,
                      }}
                    >
                      {r}
                    </button>
                  ))}
                </div>
              </Field>
              <Field label="P&L %">
                <input
                  value={currentTrade.pnl}
                  onChange={(e) => setCurrentTrade({ ...currentTrade, pnl: e.target.value })}
                  placeholder="e.g. +3.34"
                  style={inputStyle}
                />
              </Field>
              <Field label="P&L $">
                <input
                  value={currentTrade.pnlDollar}
                  onChange={(e) => setCurrentTrade({ ...currentTrade, pnlDollar: e.target.value })}
                  placeholder="e.g. +150"
                  style={inputStyle}
                />
              </Field>
              <Field label="Followed Rules?">
                <div style={{ display: "flex", gap: 6 }}>
                  {["YES", "NO"].map((r) => (
                    <button
                      key={r}
                      onClick={() => setCurrentTrade({ ...currentTrade, followedRules: r })}
                      style={{
                        ...chipBase,
                        flex: 1,
                        background:
                          currentTrade.followedRules === r
                            ? r === "YES"
                              ? "#00ff8825"
                              : "#ff445525"
                            : "#161b22",
                        color:
                          currentTrade.followedRules === r
                            ? r === "YES"
                              ? "#00ff88"
                              : "#ff4455"
                            : "#7d8590",
                        border: `1px solid ${
                          currentTrade.followedRules === r
                            ? r === "YES"
                              ? "#00ff8844"
                              : "#ff445544"
                            : "#21262d"
                        }`,
                      }}
                    >
                      {r}
                    </button>
                  ))}
                </div>
              </Field>
            </div>
          </Section>

          {/* Journal */}
          <Section title="JOURNAL">
            <Field label="What confirmed the setup?">
              <textarea
                value={currentTrade.confirmed}
                onChange={(e) => setCurrentTrade({ ...currentTrade, confirmed: e.target.value })}
                placeholder="What worked? What trapped traders? What did the orderflow show?"
                rows={2}
                style={{ ...inputStyle, resize: "vertical" }}
              />
            </Field>
            <Field label="What would I do differently?">
              <textarea
                value={currentTrade.different}
                onChange={(e) => setCurrentTrade({ ...currentTrade, different: e.target.value })}
                placeholder="Lessons learned. Mistakes made. What to improve."
                rows={2}
                style={{ ...inputStyle, resize: "vertical", marginTop: 8 }}
              />
            </Field>
            <Field label="Notes">
              <textarea
                value={currentTrade.notes}
                onChange={(e) => setCurrentTrade({ ...currentTrade, notes: e.target.value })}
                placeholder="Any additional context, market conditions, mindset..."
                rows={2}
                style={{ ...inputStyle, resize: "vertical", marginTop: 8 }}
              />
            </Field>
          </Section>

          {/* Screenshots */}
          <Section title="SCREENSHOTS">
            <div
              onClick={() => fileInputRef.current?.click()}
              style={{
                border: "2px dashed #21262d",
                borderRadius: 8,
                padding: 24,
                textAlign: "center",
                cursor: "pointer",
                color: "#7d8590",
                fontSize: 13,
                transition: "border-color 0.2s",
              }}
              onMouseEnter={(e) => (e.currentTarget.style.borderColor = "#00b4d8")}
              onMouseLeave={(e) => (e.currentTarget.style.borderColor = "#21262d")}
            >
              📸 Click to add screenshots (entry, exit, orderflow)
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                multiple
                onChange={handleScreenshot}
                style={{ display: "none" }}
              />
            </div>
            {currentTrade.screenshots.length > 0 && (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 12 }}>
                {currentTrade.screenshots.map((src, idx) => (
                  <div key={idx} style={{ position: "relative" }}>
                    <img
                      src={src}
                      style={{
                        width: 120,
                        height: 80,
                        objectFit: "cover",
                        borderRadius: 6,
                        border: "1px solid #21262d",
                      }}
                    />
                    <button
                      onClick={() => removeScreenshot(idx)}
                      style={{
                        position: "absolute",
                        top: -6,
                        right: -6,
                        background: "#ff4455",
                        color: "white",
                        border: "none",
                        borderRadius: "50%",
                        width: 20,
                        height: 20,
                        fontSize: 11,
                        cursor: "pointer",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                      }}
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            )}
          </Section>

          {/* Submit */}
          <button
            onClick={handleSubmit}
            disabled={!currentTrade.date || !currentTrade.direction || !currentTrade.keyLevel}
            style={{
              width: "100%",
              padding: 14,
              marginTop: 16,
              background:
                currentTrade.date && currentTrade.direction && currentTrade.keyLevel
                  ? "linear-gradient(135deg, #00ff88 0%, #00b4d8 100%)"
                  : "#161b22",
              color:
                currentTrade.date && currentTrade.direction && currentTrade.keyLevel
                  ? "#0a0c10"
                  : "#7d8590",
              border: "none",
              borderRadius: 8,
              fontSize: 14,
              fontWeight: 700,
              cursor:
                currentTrade.date && currentTrade.direction && currentTrade.keyLevel
                  ? "pointer"
                  : "not-allowed",
              fontFamily: "'JetBrains Mono', monospace",
              textTransform: "uppercase",
              letterSpacing: "0.05em",
              transition: "all 0.3s",
            }}
          >
            {editingId ? "UPDATE TRADE" : "LOG TRADE"}
          </button>
          {editingId && (
            <button
              onClick={() => {
                setEditingId(null);
                setCurrentTrade({ ...defaultTrade });
              }}
              style={{
                width: "100%",
                padding: 10,
                marginTop: 8,
                background: "transparent",
                color: "#7d8590",
                border: "1px solid #21262d",
                borderRadius: 8,
                fontSize: 12,
                cursor: "pointer",
                fontFamily: "'JetBrains Mono', monospace",
              }}
            >
              CANCEL EDIT
            </button>
          )}
        </div>
      )}

      {/* HISTORY VIEW */}
      {view === "history" && (
        <div style={{ maxWidth: 800, margin: "0 auto" }}>
          <div style={{ display: "flex", gap: 6, marginBottom: 16 }}>
            {["ALL", "WIN", "LOSS", "BE"].map((f) => (
              <button
                key={f}
                onClick={() => setFilterResult(f)}
                style={{
                  ...chipBase,
                  background: filterResult === f ? "#21262d" : "transparent",
                  color: filterResult === f ? "#e6edf3" : "#7d8590",
                  border: `1px solid ${filterResult === f ? "#30363d" : "transparent"}`,
                }}
              >
                {f}
              </button>
            ))}
            <span style={{ marginLeft: "auto", color: "#7d8590", fontSize: 12, alignSelf: "center" }}>
              {filteredTrades.length} trade{filteredTrades.length !== 1 ? "s" : ""}
            </span>
          </div>

          {filteredTrades.length === 0 ? (
            <div
              style={{
                textAlign: "center",
                padding: 60,
                color: "#7d8590",
                fontSize: 14,
              }}
            >
              {trades.length === 0
                ? "No trades logged yet. Start by logging your first trade."
                : "No trades match this filter."}
            </div>
          ) : (
            filteredTrades.map((trade) => (
              <div
                key={trade.id}
                style={{
                  background: "#161b22",
                  border: "1px solid #21262d",
                  borderRadius: 10,
                  marginBottom: 8,
                  overflow: "hidden",
                  transition: "border-color 0.2s",
                }}
              >
                <div
                  onClick={() =>
                    setExpandedTrade(expandedTrade === trade.id ? null : trade.id)
                  }
                  style={{
                    padding: "12px 16px",
                    display: "flex",
                    alignItems: "center",
                    gap: 12,
                    cursor: "pointer",
                    flexWrap: "wrap",
                  }}
                >
                  <span
                    style={{
                      color:
                        trade.result === "WIN"
                          ? "#00ff88"
                          : trade.result === "LOSS"
                          ? "#ff4455"
                          : "#f0c000",
                      fontWeight: 700,
                      fontSize: 12,
                      padding: "3px 10px",
                      borderRadius: 4,
                      background:
                        trade.result === "WIN"
                          ? "#00ff8815"
                          : trade.result === "LOSS"
                          ? "#ff445515"
                          : "#f0c00015",
                    }}
                  >
                    {trade.result || "OPEN"}
                  </span>
                  <span
                    style={{
                      color:
                        trade.direction === "LONG" ? "#00ff88" : "#ff4455",
                      fontWeight: 600,
                      fontSize: 13,
                    }}
                  >
                    {trade.direction === "LONG" ? "▲" : "▼"} {trade.direction}
                  </span>
                  <span style={{ color: "#e6edf3", fontSize: 13, fontWeight: 600 }}>
                    {trade.pair}
                  </span>
                  <span style={{ color: "#7d8590", fontSize: 12 }}>@ {trade.keyLevel}</span>
                  <span style={{ color: "#7d8590", fontSize: 11, marginLeft: "auto" }}>
                    {trade.date}
                  </span>
                  {trade.rr && (
                    <span style={{ color: "#00b4d8", fontSize: 12, fontWeight: 600 }}>
                      {trade.rr}
                    </span>
                  )}
                  {trade.pnl && (
                    <span
                      style={{
                        color: parseFloat(trade.pnl) >= 0 ? "#00ff88" : "#ff4455",
                        fontSize: 12,
                        fontWeight: 600,
                      }}
                    >
                      {parseFloat(trade.pnl) >= 0 ? "+" : ""}
                      {trade.pnl}%
                      {trade.pnlDollar && (
                        <span style={{ opacity: 0.7, marginLeft: 4 }}>
                          (${trade.pnlDollar})
                        </span>
                      )}
                    </span>
                  )}
                  <span style={{ color: "#7d8590", fontSize: 10 }}>
                    {expandedTrade === trade.id ? "▲" : "▼"}
                  </span>
                </div>

                {expandedTrade === trade.id && (
                  <div
                    style={{
                      padding: "0 16px 16px",
                      borderTop: "1px solid #21262d",
                    }}
                  >
                    <div
                      style={{
                        display: "grid",
                        gridTemplateColumns: "1fr 1fr 1fr",
                        gap: 12,
                        marginTop: 12,
                      }}
                    >
                      <MiniStat label="Level Type" value={Array.isArray(trade.levelType) ? trade.levelType.join(" + ") : trade.levelType} />
                      <MiniStat label="Bubble" value={`${trade.bubbleSize} ${trade.bubbleDirection}`} />
                      <MiniStat label="Entry Type" value={trade.entryType} />
                      <MiniStat label="Entry" value={trade.entry} />
                      <MiniStat label="Stop" value={trade.stop} />
                      <MiniStat label="TP1" value={trade.tp1} />
                      <MiniStat label="TP2" value={trade.tp2} />
                      <MiniStat label="Position" value={trade.posSize} />
                      <MiniStat label="Rules?" value={trade.followedRules} color={trade.followedRules === "YES" ? "#00ff88" : "#ff4455"} />
                      <MiniStat label="Conviction" value={`${trade.confluence.length} factors`} />
                    </div>

                    {trade.confluence.length > 0 && (
                      <div style={{ marginTop: 12 }}>
                        <span style={{ ...labelStyle, marginBottom: 6 }}>Confluence</span>
                        <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                          {trade.confluence.map((c) => (
                            <span
                              key={c}
                              style={{
                                padding: "4px 10px",
                                background: "#00b4d815",
                                color: "#00b4d8",
                                borderRadius: 12,
                                fontSize: 11,
                              }}
                            >
                              {c}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}

                    {trade.confirmed && (
                      <div style={{ marginTop: 12 }}>
                        <span style={labelStyle}>What confirmed</span>
                        <p style={{ color: "#adbac7", fontSize: 12, margin: "4px 0 0", lineHeight: 1.5 }}>
                          {trade.confirmed}
                        </p>
                      </div>
                    )}
                    {trade.different && (
                      <div style={{ marginTop: 8 }}>
                        <span style={labelStyle}>What I'd do differently</span>
                        <p style={{ color: "#adbac7", fontSize: 12, margin: "4px 0 0", lineHeight: 1.5 }}>
                          {trade.different}
                        </p>
                      </div>
                    )}
                    {trade.notes && (
                      <div style={{ marginTop: 8 }}>
                        <span style={labelStyle}>Notes</span>
                        <p style={{ color: "#adbac7", fontSize: 12, margin: "4px 0 0", lineHeight: 1.5 }}>
                          {trade.notes}
                        </p>
                      </div>
                    )}

                    {trade.screenshots?.length > 0 && (
                      <div style={{ marginTop: 12 }}>
                        <span style={labelStyle}>Screenshots</span>
                        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 6 }}>
                          {trade.screenshots.map((src, idx) => (
                            <img
                              key={idx}
                              src={src}
                              style={{
                                width: 200,
                                height: 130,
                                objectFit: "cover",
                                borderRadius: 6,
                                border: "1px solid #21262d",
                                cursor: "pointer",
                              }}
                              onClick={() => window.open(src, "_blank")}
                            />
                          ))}
                        </div>
                      </div>
                    )}

                    <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
                      <button
                        onClick={() => editTrade(trade)}
                        style={{
                          padding: "6px 16px",
                          background: "#21262d",
                          color: "#e6edf3",
                          border: "none",
                          borderRadius: 6,
                          fontSize: 12,
                          cursor: "pointer",
                          fontFamily: "'JetBrains Mono', monospace",
                        }}
                      >
                        ✏️ Edit
                      </button>
                      <button
                        onClick={() => deleteTrade(trade.id)}
                        style={{
                          padding: "6px 16px",
                          background: "#ff445520",
                          color: "#ff4455",
                          border: "none",
                          borderRadius: 6,
                          fontSize: 12,
                          cursor: "pointer",
                          fontFamily: "'JetBrains Mono', monospace",
                        }}
                      >
                        🗑 Delete
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      )}

      {/* DASHBOARD / PnL CALENDAR VIEW */}
      {view === "dashboard" && (
        <PnlCalendar
          trades={trades}
          calendarMonth={calendarMonth}
          setCalendarMonth={setCalendarMonth}
          labelStyle={labelStyle}
        />
      )}

      {/* STATS VIEW */}
      {view === "stats" && (
        <div style={{ maxWidth: 800, margin: "0 auto" }}>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr 1fr",
              gap: 12,
              marginBottom: 20,
            }}
          >
            <StatCard label="Total Trades" value={stats.total} />
            <StatCard label="Win Rate" value={`${stats.winRate}%`} color={parseFloat(stats.winRate) >= 50 ? "#00ff88" : parseFloat(stats.winRate) >= 30 ? "#f0c000" : "#ff4455"} />
            <StatCard label="Rules Followed" value={`${stats.rulesRate}%`} color={parseFloat(stats.rulesRate) >= 80 ? "#00ff88" : "#f0c000"} />
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 12, marginBottom: 20 }}>
            <StatCard label="Wins" value={stats.wins} color="#00ff88" small />
            <StatCard label="Losses" value={stats.losses} color="#ff4455" small />
            <StatCard label="Breakeven" value={stats.be} color="#f0c000" small />
            <StatCard label="Avg R:R (wins)" value={`${stats.avgRR}:1`} color="#00b4d8" small />
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 12 }}>
            <StatCard
              label="Total P&L %"
              value={`${parseFloat(stats.totalPnl) >= 0 ? "+" : ""}${stats.totalPnl}%`}
              color={parseFloat(stats.totalPnl) >= 0 ? "#00ff88" : "#ff4455"}
            />
            <StatCard
              label="Total P&L $"
              value={parseFloat(stats.totalDollar) !== 0 ? `${parseFloat(stats.totalDollar) >= 0 ? "+" : "-"}$${Math.abs(parseFloat(stats.totalDollar)).toFixed(2)}` : "—"}
              color={parseFloat(stats.totalDollar) >= 0 ? "#00ff88" : "#ff4455"}
            />
            <StatCard label="Best Trade" value={`+${stats.bestTrade}%`} color="#00ff88" />
            <StatCard label="Worst Trade" value={`${stats.worstTrade}%`} color="#ff4455" />
          </div>

          {stats.total === 0 && (
            <div style={{ textAlign: "center", padding: 40, color: "#7d8590", fontSize: 13 }}>
              Start logging trades to see your stats here.
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Section({ title, children }) {
  return (
    <div
      style={{
        marginBottom: 16,
        background: "#161b22",
        border: "1px solid #21262d",
        borderRadius: 10,
        padding: 16,
      }}
    >
      <div
        style={{
          fontSize: 11,
          fontWeight: 700,
          color: "#7d8590",
          textTransform: "uppercase",
          letterSpacing: "0.08em",
          marginBottom: 12,
          fontFamily: "'JetBrains Mono', monospace",
        }}
      >
        {title}
      </div>
      {children}
    </div>
  );
}

function Field({ label, children }) {
  return (
    <div>
      <label
        style={{
          color: "#7d8590",
          fontSize: 11,
          fontWeight: 600,
          textTransform: "uppercase",
          letterSpacing: "0.05em",
          marginBottom: 4,
          display: "block",
          fontFamily: "'JetBrains Mono', monospace",
        }}
      >
        {label}
      </label>
      {children}
    </div>
  );
}

function StatCard({ label, value, color = "#e6edf3", small = false }) {
  return (
    <div
      style={{
        background: "#161b22",
        border: "1px solid #21262d",
        borderRadius: 10,
        padding: small ? "12px 14px" : "16px 18px",
        textAlign: "center",
      }}
    >
      <div
        style={{
          fontSize: small ? 22 : 28,
          fontWeight: 700,
          color,
          fontFamily: "'JetBrains Mono', monospace",
        }}
      >
        {value}
      </div>
      <div
        style={{
          fontSize: 10,
          color: "#7d8590",
          textTransform: "uppercase",
          letterSpacing: "0.08em",
          marginTop: 4,
          fontFamily: "'JetBrains Mono', monospace",
        }}
      >
        {label}
      </div>
    </div>
  );
}

function MiniStat({ label, value, color = "#e6edf3" }) {
  return (
    <div>
      <div
        style={{
          fontSize: 10,
          color: "#7d8590",
          textTransform: "uppercase",
          letterSpacing: "0.05em",
          fontFamily: "'JetBrains Mono', monospace",
        }}
      >
        {label}
      </div>
      <div style={{ fontSize: 13, color, fontWeight: 600, marginTop: 2 }}>
        {value || "—"}
      </div>
    </div>
  );
}

function PnlCalendar({ trades, calendarMonth, setCalendarMonth }) {
  const year = calendarMonth.getFullYear();
  const month = calendarMonth.getMonth();

  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const firstDayOfWeek = new Date(year, month, 1).getDay(); // 0=Sun

  const monthNames = [
    "Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
  ];

  // Group trades by date
  const pnlByDate = {};
  const dollarByDate = {};
  const tradesByDate = {};
  trades.forEach((t) => {
    if (!t.date) return;
    const pnl = parseFloat(t.pnl) || 0;
    const dollar = parseFloat(t.pnlDollar) || 0;
    if (!pnlByDate[t.date]) {
      pnlByDate[t.date] = 0;
      dollarByDate[t.date] = 0;
      tradesByDate[t.date] = 0;
    }
    pnlByDate[t.date] += pnl;
    dollarByDate[t.date] += dollar;
    tradesByDate[t.date] += 1;
  });

  // Filter to current month
  const monthStr = `${year}-${String(month + 1).padStart(2, "0")}`;
  let monthlyPnl = 0;
  let monthlyDollar = 0;
  let monthWins = 0;
  let monthLosses = 0;
  let monthTrades = 0;
  let bestDay = -Infinity;
  let worstDay = Infinity;
  let bestDayDollar = -Infinity;
  let worstDayDollar = Infinity;

  Object.keys(pnlByDate).forEach((date) => {
    if (date.startsWith(monthStr)) {
      const dayPnl = pnlByDate[date];
      const dayDol = dollarByDate[date] || 0;
      monthlyPnl += dayPnl;
      monthlyDollar += dayDol;
      monthTrades += tradesByDate[date];
      if (dayPnl > 0) monthWins++;
      if (dayPnl < 0) monthLosses++;
      if (dayPnl > bestDay) { bestDay = dayPnl; bestDayDollar = dayDol; }
      if (dayPnl < worstDay) { worstDay = dayPnl; worstDayDollar = dayDol; }
    }
  });

  if (bestDay === -Infinity) { bestDay = 0; bestDayDollar = 0; }
  if (worstDay === Infinity) { worstDay = 0; worstDayDollar = 0; }

  const prevMonth = () => {
    setCalendarMonth(new Date(year, month - 1, 1));
  };
  const nextMonth = () => {
    setCalendarMonth(new Date(year, month + 1, 1));
  };

  const days = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];

  // Build calendar grid
  const cells = [];
  for (let i = 0; i < firstDayOfWeek; i++) {
    cells.push(null);
  }
  for (let d = 1; d <= daysInMonth; d++) {
    cells.push(d);
  }

  const today = new Date();
  const isToday = (d) =>
    d && today.getFullYear() === year && today.getMonth() === month && today.getDate() === d;

  const cellStyle = {
    minHeight: 80,
    borderRadius: 6,
    padding: "6px 8px",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "flex-start",
    gap: 4,
    transition: "background 0.2s",
    position: "relative",
  };

  return (
    <div style={{ maxWidth: 900, margin: "0 auto" }}>
      {/* Monthly P/L header */}
      <div style={{ textAlign: "center", marginBottom: 16 }}>
        <span
          style={{
            fontSize: 13,
            color: "#7d8590",
            fontFamily: "'JetBrains Mono', monospace",
            fontWeight: 600,
            textTransform: "uppercase",
            letterSpacing: "0.05em",
          }}
        >
          Monthly P/L:{" "}
        </span>
        <span
          style={{
            fontSize: 20,
            fontWeight: 700,
            fontFamily: "'JetBrains Mono', monospace",
            color: monthlyPnl >= 0 ? "#00ff88" : "#ff4455",
          }}
        >
          {monthlyPnl >= 0 ? "+" : ""}
          {monthlyPnl.toFixed(2)}%
        </span>
        {monthlyDollar !== 0 && (
          <span
            style={{
              fontSize: 16,
              fontWeight: 600,
              fontFamily: "'JetBrains Mono', monospace",
              color: monthlyDollar >= 0 ? "#00ff88" : "#ff4455",
              opacity: 0.7,
              marginLeft: 8,
            }}
          >
            ({monthlyDollar >= 0 ? "+" : ""}${Math.abs(monthlyDollar).toFixed(2)})
          </span>
        )}
      </div>

      {/* Summary row */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr 1fr 1fr 1fr 1fr",
          gap: 8,
          marginBottom: 16,
        }}
      >
        {[
          { label: "Trades", value: monthTrades, color: "#e6edf3" },
          { label: "Green Days", value: monthWins, color: "#00ff88" },
          { label: "Red Days", value: monthLosses, color: "#ff4455" },
          {
            label: "Best Day",
            value: bestDay !== 0 ? `+${bestDay.toFixed(2)}%` : "—",
            sub: bestDayDollar !== 0 ? `+$${Math.abs(bestDayDollar).toFixed(2)}` : null,
            color: "#00ff88",
          },
          {
            label: "Worst Day",
            value: worstDay !== 0 ? `${worstDay.toFixed(2)}%` : "—",
            sub: worstDayDollar !== 0 ? `-$${Math.abs(worstDayDollar).toFixed(2)}` : null,
            color: "#ff4455",
          },
          {
            label: "Monthly $",
            value: monthlyDollar !== 0 ? `${monthlyDollar >= 0 ? "+" : "-"}$${Math.abs(monthlyDollar).toFixed(2)}` : "—",
            color: monthlyDollar >= 0 ? "#00ff88" : "#ff4455",
          },
        ].map((s) => (
          <div
            key={s.label}
            style={{
              background: "#161b22",
              border: "1px solid #21262d",
              borderRadius: 8,
              padding: "10px 12px",
              textAlign: "center",
            }}
          >
            <div
              style={{
                fontSize: 18,
                fontWeight: 700,
                color: s.color,
                fontFamily: "'JetBrains Mono', monospace",
              }}
            >
              {s.value}
            </div>
            {s.sub && (
              <div
                style={{
                  fontSize: 11,
                  fontWeight: 600,
                  color: s.color,
                  fontFamily: "'JetBrains Mono', monospace",
                  opacity: 0.6,
                  marginTop: 1,
                }}
              >
                {s.sub}
              </div>
            )}
            <div
              style={{
                fontSize: 9,
                color: "#7d8590",
                textTransform: "uppercase",
                letterSpacing: "0.08em",
                marginTop: 2,
                fontFamily: "'JetBrains Mono', monospace",
              }}
            >
              {s.label}
            </div>
          </div>
        ))}
      </div>

      {/* Month navigation */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          marginBottom: 12,
        }}
      >
        <button
          onClick={prevMonth}
          style={{
            width: 32,
            height: 32,
            borderRadius: "50%",
            background: "#161b22",
            border: "1px solid #21262d",
            color: "#7d8590",
            cursor: "pointer",
            fontSize: 14,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontFamily: "'JetBrains Mono', monospace",
          }}
        >
          ‹
        </button>
        <span
          style={{
            fontSize: 15,
            fontWeight: 700,
            color: "#e6edf3",
            fontFamily: "'JetBrains Mono', monospace",
          }}
        >
          {monthNames[month]} {year}
        </span>
        <button
          onClick={nextMonth}
          style={{
            width: 32,
            height: 32,
            borderRadius: "50%",
            background: "#161b22",
            border: "1px solid #21262d",
            color: "#7d8590",
            cursor: "pointer",
            fontSize: 14,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontFamily: "'JetBrains Mono', monospace",
          }}
        >
          ›
        </button>
      </div>

      {/* Day headers */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(7, 1fr)",
          gap: 4,
          marginBottom: 4,
        }}
      >
        {days.map((d) => (
          <div
            key={d}
            style={{
              textAlign: "center",
              fontSize: 11,
              fontWeight: 600,
              color: "#7d8590",
              padding: "6px 0",
              fontFamily: "'JetBrains Mono', monospace",
              textTransform: "uppercase",
              letterSpacing: "0.05em",
            }}
          >
            {d}
          </div>
        ))}
      </div>

      {/* Calendar grid */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(7, 1fr)",
          gap: 4,
        }}
      >
        {cells.map((day, idx) => {
          if (day === null) {
            return <div key={`empty-${idx}`} style={{ ...cellStyle, background: "transparent" }} />;
          }

          const dateStr = `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
          const dayPnl = pnlByDate[dateStr];
          const dayDollar = dollarByDate[dateStr];
          const dayTrades = tradesByDate[dateStr];
          const hasData = dayPnl !== undefined;
          const isPositive = hasData && dayPnl > 0;
          const isNegative = hasData && dayPnl < 0;
          const isBreakeven = hasData && dayPnl === 0;

          let bg = "#0d1117";
          let border = "1px solid #21262d";
          if (isPositive) {
            bg = "#00ff8818";
            border = "1px solid #00ff8833";
          } else if (isNegative) {
            bg = "#ff445518";
            border = "1px solid #ff445533";
          } else if (isBreakeven) {
            bg = "#f0c00012";
            border = "1px solid #f0c00028";
          }

          return (
            <div
              key={dateStr}
              style={{
                ...cellStyle,
                background: bg,
                border,
              }}
            >
              <div
                style={{
                  fontSize: 11,
                  color: isToday(day) ? "#00b4d8" : "#7d8590",
                  fontWeight: isToday(day) ? 700 : 500,
                  fontFamily: "'JetBrains Mono', monospace",
                  alignSelf: "flex-start",
                }}
              >
                {isToday(day) ? (
                  <span
                    style={{
                      background: "#00b4d8",
                      color: "#0a0c10",
                      borderRadius: "50%",
                      width: 20,
                      height: 20,
                      display: "inline-flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontSize: 10,
                      fontWeight: 700,
                    }}
                  >
                    {day}
                  </span>
                ) : (
                  day
                )}
              </div>
              {hasData && (
                <>
                  <div
                    style={{
                      fontSize: 14,
                      fontWeight: 700,
                      color: isPositive ? "#00ff88" : isNegative ? "#ff4455" : "#f0c000",
                      fontFamily: "'JetBrains Mono', monospace",
                      marginTop: 4,
                    }}
                  >
                    {isPositive ? "+" : ""}
                    {dayPnl.toFixed(2)}%
                  </div>
                  {dayDollar !== undefined && dayDollar !== 0 && (
                    <div
                      style={{
                        fontSize: 11,
                        fontWeight: 600,
                        color: isPositive ? "#00ff88" : isNegative ? "#ff4455" : "#f0c000",
                        fontFamily: "'JetBrains Mono', monospace",
                        opacity: 0.7,
                      }}
                    >
                      {dayDollar >= 0 ? "+" : "-"}${Math.abs(dayDollar).toFixed(2)}
                    </div>
                  )}
                  <div
                    style={{
                      fontSize: 10,
                      color: "#7d8590",
                      fontFamily: "'JetBrains Mono', monospace",
                    }}
                  >
                    {dayTrades} trade{dayTrades !== 1 ? "s" : ""}
                  </div>
                </>
              )}
            </div>
          );
        })}
      </div>

      {/* Equity curve */}
      <div
        style={{
          marginTop: 24,
          background: "#161b22",
          border: "1px solid #21262d",
          borderRadius: 10,
          padding: 20,
        }}
      >
        <div
          style={{
            fontSize: 11,
            fontWeight: 700,
            color: "#7d8590",
            textTransform: "uppercase",
            letterSpacing: "0.08em",
            marginBottom: 16,
            fontFamily: "'JetBrains Mono', monospace",
          }}
        >
          Equity Curve (Cumulative P/L %)
        </div>
        <EquityCurve trades={trades} />
      </div>
    </div>
  );
}

function EquityCurve({ trades }) {
  // Sort trades by date, then compute cumulative PnL
  const sorted = [...trades]
    .filter((t) => t.date && t.pnl)
    .sort((a, b) => a.date.localeCompare(b.date));

  if (sorted.length === 0) {
    return (
      <div
        style={{
          textAlign: "center",
          padding: 40,
          color: "#7d8590",
          fontSize: 13,
          fontFamily: "'JetBrains Mono', monospace",
        }}
      >
        Log trades with P/L to see your equity curve.
      </div>
    );
  }

  // Group by date and sum PnL per day
  const dailyPnl = [];
  const seen = {};
  sorted.forEach((t) => {
    if (!seen[t.date]) {
      seen[t.date] = { date: t.date, pnl: 0 };
      dailyPnl.push(seen[t.date]);
    }
    seen[t.date].pnl += parseFloat(t.pnl) || 0;
  });

  // Build cumulative
  let cumulative = 0;
  const points = dailyPnl.map((d) => {
    cumulative += d.pnl;
    return { date: d.date, cumPnl: cumulative };
  });

  // SVG dimensions
  const width = 820;
  const height = 200;
  const padL = 50;
  const padR = 16;
  const padT = 16;
  const padB = 30;

  const plotW = width - padL - padR;
  const plotH = height - padT - padB;

  const maxPnl = Math.max(...points.map((p) => p.cumPnl), 0);
  const minPnl = Math.min(...points.map((p) => p.cumPnl), 0);
  const range = maxPnl - minPnl || 1;

  const xScale = (i) => padL + (i / Math.max(points.length - 1, 1)) * plotW;
  const yScale = (v) => padT + plotH - ((v - minPnl) / range) * plotH;

  const linePath = points
    .map((p, i) => `${i === 0 ? "M" : "L"}${xScale(i).toFixed(1)},${yScale(p.cumPnl).toFixed(1)}`)
    .join(" ");

  // Area fill
  const areaPath = `${linePath} L${xScale(points.length - 1).toFixed(1)},${yScale(0).toFixed(1)} L${xScale(0).toFixed(1)},${yScale(0).toFixed(1)} Z`;

  const lastPoint = points[points.length - 1];
  const lineColor = lastPoint.cumPnl >= 0 ? "#00ff88" : "#ff4455";

  // Zero line
  const zeroY = yScale(0);

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      style={{ width: "100%", height: "auto" }}
    >
      {/* Zero line */}
      <line
        x1={padL}
        y1={zeroY}
        x2={width - padR}
        y2={zeroY}
        stroke="#21262d"
        strokeWidth={1}
        strokeDasharray="4,4"
      />
      <text
        x={padL - 6}
        y={zeroY + 4}
        textAnchor="end"
        fill="#7d8590"
        fontSize={10}
        fontFamily="'JetBrains Mono', monospace"
      >
        0%
      </text>

      {/* Max label */}
      {maxPnl !== 0 && (
        <text
          x={padL - 6}
          y={padT + 4}
          textAnchor="end"
          fill="#00ff88"
          fontSize={10}
          fontFamily="'JetBrains Mono', monospace"
        >
          +{maxPnl.toFixed(1)}%
        </text>
      )}

      {/* Min label */}
      {minPnl !== 0 && (
        <text
          x={padL - 6}
          y={padT + plotH + 4}
          textAnchor="end"
          fill="#ff4455"
          fontSize={10}
          fontFamily="'JetBrains Mono', monospace"
        >
          {minPnl.toFixed(1)}%
        </text>
      )}

      {/* Area fill */}
      <path d={areaPath} fill={lineColor} opacity={0.08} />

      {/* Line */}
      <path d={linePath} fill="none" stroke={lineColor} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />

      {/* End dot */}
      <circle
        cx={xScale(points.length - 1)}
        cy={yScale(lastPoint.cumPnl)}
        r={4}
        fill={lineColor}
      />

      {/* End label */}
      <text
        x={xScale(points.length - 1)}
        y={yScale(lastPoint.cumPnl) - 10}
        textAnchor="middle"
        fill={lineColor}
        fontSize={11}
        fontWeight={700}
        fontFamily="'JetBrains Mono', monospace"
      >
        {lastPoint.cumPnl >= 0 ? "+" : ""}{lastPoint.cumPnl.toFixed(2)}%
      </text>

      {/* Date labels (first and last) */}
      <text
        x={padL}
        y={height - 4}
        textAnchor="start"
        fill="#7d8590"
        fontSize={9}
        fontFamily="'JetBrains Mono', monospace"
      >
        {points[0].date}
      </text>
      <text
        x={width - padR}
        y={height - 4}
        textAnchor="end"
        fill="#7d8590"
        fontSize={9}
        fontFamily="'JetBrains Mono', monospace"
      >
        {lastPoint.date}
      </text>
    </svg>
  );
}
