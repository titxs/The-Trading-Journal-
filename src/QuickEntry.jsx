import { useState, useEffect, useRef } from "react";
import { db, storage } from "./firebase";
import { doc, setDoc } from "firebase/firestore";
import { ref, uploadBytes, getDownloadURL } from "firebase/storage";

// ── shared style tokens (match TradeJournal-6) ────────────────────────────────
const F = "'JetBrains Mono',monospace";
const bg="#08080C",bg2="#0E0E14",bg3="#14141C",b1="#1C1C28",b2="#252535";
const g="#00E676",r="#FF3D3D",y="#FFD600",bl="#448AFF",cy="#18FFFF";
const w="#F0F0F5",gr="#6B6B80";

const levelTypes = ["Daily VWAP","Weekly VWAP","Monthly VWAP","Yearly VWAP","VWAP Deviation Band","Anchored VWAP","POC","Composite POC","Naked POC","Composite VAH","Composite VAL","PD VAH","PD VAL","PD POC","PW VAH","PW VAL","PW POC","Monthly VAH","Monthly VAL","Monthly POC","FRVP POC","FRVP VAH","FRVP VAL","Single Prints","Poor High","Poor Low","Buying Tail","Selling Tail","Imbalance","Round Number"];
const gradeOptions = ["A+","A","B","C"];
const frameworkSetupOptions = [
  { id: "vwap_revisit", label: "VWAP Revisit" },
  { id: "value_area_edge", label: "Value Area Edge" },
  { id: "seventy_pct", label: "70% Rule" },
  { id: "profile_tail", label: "Profile Tail" },
  { id: "poc_frvp_stack", label: "POC/FRVP Stack" },
];
const gexRegimeOptions = [
  { id: "long_gamma", label: "Long Gamma", color: "#00E676" },
  { id: "near_flip", label: "Near Flip", color: "#FFD600" },
  { id: "short_gamma", label: "Short Gamma", color: "#FF3D3D" },
];

// ── helpers ───────────────────────────────────────────────────────────────────
function calcRR(entry, stop, tp1) {
  const e = parseFloat(entry), s = parseFloat(stop), t = parseFloat(tp1);
  if (!e || !s || !t) return "";
  const risk = Math.abs(e - s);
  if (!risk) return "";
  return (Math.abs(t - e) / risk).toFixed(1);
}

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

// ── sub-components ────────────────────────────────────────────────────────────
function DirBtn({ label, active, color, onClick }) {
  return (
    <button
      onClick={onClick}
      style={{
        flex: 1, padding: "12px 0", borderRadius: 8, cursor: "pointer",
        fontFamily: F, fontSize: 13, fontWeight: 700, letterSpacing: "0.06em",
        border: `1px solid ${active ? color : b2}`,
        background: active ? `${color}20` : bg,
        color: active ? color : gr,
        transition: "all 0.15s",
      }}
    >
      {label === "LONG" ? "▲ LONG" : "▼ SHORT"}
    </button>
  );
}

function LevelPill({ label, selected, onClick }) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: "5px 10px", borderRadius: 16, cursor: "pointer",
        fontFamily: F, fontSize: 10, fontWeight: 600, whiteSpace: "nowrap",
        border: `1px solid ${selected ? bl : b2}`,
        background: selected ? `${bl}20` : "transparent",
        color: selected ? bl : gr,
        transition: "all 0.15s",
      }}
    >
      {label}
    </button>
  );
}

function Field({ label, children }) {
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ fontSize: 9, color: gr, textTransform: "uppercase", letterSpacing: "0.1em", fontFamily: F, marginBottom: 5, fontWeight: 600 }}>{label}</div>
      {children}
    </div>
  );
}

const iS = { width: "100%", padding: "9px 12px", background: bg, color: w, border: `1px solid ${b2}`, borderRadius: 8, fontSize: 13, fontFamily: F, outline: "none" };

// ── main component ────────────────────────────────────────────────────────────
export default function QuickEntry({ onSaved, onCancel }) {
  const [direction, setDirection] = useState("");
  const [entry, setEntry]         = useState("");
  const [stop, setStop]           = useState("");
  const [tp1, setTp1]             = useState("");
  const [tp2, setTp2]             = useState("");
  const [size, setSize]           = useState("1%");
  const [leverage, setLeverage]   = useState("");
  const [levelType, setLevelType] = useState([]);
  const [keyLevel, setKeyLevel]   = useState("");
  const [grade, setGrade]         = useState("");
  const [frameworkSetup, setFrameworkSetup] = useState("");
  const [gexRegime, setGexRegime] = useState("");
  const [riskPercent, setRiskPercent] = useState("");
  const [notes, setNotes]         = useState("");
  const [screenshots, setScreenshots] = useState([]); // { file, preview }
  const [saving, setSaving]       = useState(false);
  const [toast, setToast]         = useState("");
  const fileRef = useRef(null);
  const rootRef = useRef(null);

  const rr = calcRR(entry, stop, tp1);
  const canSave = direction && entry && stop && !saving;

  // ── clipboard paste ────────────────────────────────────────────────────────
  useEffect(() => {
    const handler = (e) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      for (const item of items) {
        if (item.type.startsWith("image/")) {
          const file = item.getAsFile();
          if (file) attachFile(file);
          break;
        }
      }
    };
    window.addEventListener("paste", handler);
    return () => window.removeEventListener("paste", handler);
  }, [screenshots]);

  function attachFile(file) {
    const reader = new FileReader();
    reader.onload = (ev) => {
      setScreenshots((prev) => [...prev, { file, preview: ev.target.result }]);
      showToast("Screenshot attached ✓");
    };
    reader.readAsDataURL(file);
  }

  function handleFileInput(e) {
    Array.from(e.target.files).forEach(attachFile);
    e.target.value = "";
  }

  function removeScreenshot(i) {
    setScreenshots((prev) => prev.filter((_, j) => j !== i));
  }

  function showToast(msg) {
    setToast(msg);
    setTimeout(() => setToast(""), 2200);
  }

  function toggleLevel(l) {
    setLevelType((prev) =>
      prev.includes(l) ? prev.filter((x) => x !== l) : [...prev, l]
    );
  }

  // ── save ───────────────────────────────────────────────────────────────────
  async function handleSave() {
    if (!canSave) return;
    setSaving(true);
    try {
      const id = Date.now().toString();
      // upload screenshots to Firebase Storage (same path as main journal)
      const urls = [];
      for (let i = 0; i < screenshots.length; i++) {
        const { file } = screenshots[i];
        const sr = ref(storage, `screenshots/${id}/${Date.now()}_${i}_${file.name}`);
        await uploadBytes(sr, file);
        urls.push(await getDownloadURL(sr));
      }

      const trade = {
        id,
        date: todayStr(),
        pair: "BTC/USD",
        direction,
        entry,
        stop,
        tp1,
        tp2,
        posSize: size,
        leverage,
        keyLevel: keyLevel || entry, // fall back to entry price if blank
        levelType,
        levelTypeOther: "",
        confluence: [],
        confluenceOther: "",
        regime: "",
        setup: "",
        conviction: "",
        entryType: "",
        result: "",
        pnl: "",
        pnlDollar: "",
        closePrice: "",
        hitTp1: false,
        hitTp2: false,
        followedRules: "",
        confirmed: "",
        mistakes: "",
        different: "",
        notes,
        screenshots: urls,
        rr,
        tradePercent: "",
        createdAt: Date.now(),
        // flag so you can filter "needs review" later if you want
        quickEntry: true,
        // CLAUDE.md framework fields
        grade,
        frameworkSetup,
        gexRegime,
        riskPercent,
        gexFlip: "",
        netGexTrend: "",
        skewRead: "",
        skewDays: "",
        volRead: "",
        macroEvent: false,
      };

      await setDoc(doc(db, "trades", id), trade);
      showToast("Trade logged ✓");
      setTimeout(() => {
        if (onSaved) onSaved(trade);
      }, 600);
    } catch (e) {
      console.error(e);
      showToast("Save failed — check console");
    } finally {
      setSaving(false);
    }
  }

  // ── render ─────────────────────────────────────────────────────────────────
  return (
    <div
      ref={rootRef}
      style={{ background: bg2, borderRadius: 12, border: `1px solid ${b1}`, padding: 20, maxWidth: 520, fontFamily: F, position: "relative" }}
    >
      <style>{`@import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600;700&display=swap');*{box-sizing:border-box;}input:focus,textarea:focus{border-color:${g}!important;outline:none;}@keyframes slideUp{from{opacity:0;transform:translateY(6px);}to{opacity:1;transform:translateY(0);}}`}</style>

      {/* header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
        <div>
          <div style={{ fontSize: 11, fontWeight: 700, color: g, letterSpacing: "0.12em", textTransform: "uppercase" }}>⚡ Quick Entry</div>
          <div style={{ fontSize: 9, color: gr, marginTop: 2 }}>{todayStr()} · BTC/USD PERP · Ctrl+V to paste screenshot</div>
        </div>
        {onCancel && (
          <button onClick={onCancel} style={{ background: "transparent", border: "none", color: gr, fontSize: 18, cursor: "pointer", padding: "0 4px", fontFamily: F }}>✕</button>
        )}
      </div>

      {/* direction */}
      <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
        <DirBtn label="LONG"  active={direction === "LONG"}  color={g} onClick={() => setDirection("LONG")} />
        <DirBtn label="SHORT" active={direction === "SHORT"} color={r} onClick={() => setDirection("SHORT")} />
      </div>

      {/* prices */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, marginBottom: 8 }}>
        <Field label="Entry $">
          <input value={entry} onChange={e => setEntry(e.target.value)} type="number" placeholder="93450" style={iS} autoFocus />
        </Field>
        <Field label="Stop $">
          <input value={stop} onChange={e => setStop(e.target.value)} type="number" placeholder="93100" style={iS} />
        </Field>
        <Field label="Size">
          <input value={size} onChange={e => setSize(e.target.value)} placeholder="1%" style={iS} />
        </Field>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, marginBottom: 8 }}>
        <Field label="TP1 $">
          <input value={tp1} onChange={e => setTp1(e.target.value)} type="number" placeholder="94200" style={iS} />
        </Field>
        <Field label="TP2 $">
          <input value={tp2} onChange={e => setTp2(e.target.value)} type="number" placeholder="94800" style={iS} />
        </Field>
        <Field label="Leverage">
          <input value={leverage} onChange={e => setLeverage(e.target.value)} placeholder="e.g. 10x" style={iS} />
        </Field>
      </div>

      {/* live R:R */}
      {rr && (
        <div style={{ fontSize: 11, color: g, fontWeight: 700, marginBottom: 10 }}>
          R:R → {rr}:1
        </div>
      )}

      {/* CLAUDE.md framework fields */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 8 }}>
        <Field label="Grade">
          <div style={{ display: "flex", gap: 4 }}>
            {gradeOptions.map(x => (
              <LevelPill key={x} label={x} selected={grade === x} onClick={() => setGrade(x)} />
            ))}
          </div>
        </Field>
        <Field label="Risk %">
          <input value={riskPercent} onChange={e => setRiskPercent(e.target.value)} placeholder="e.g. 1.6" style={iS} />
        </Field>
      </div>
      <Field label="GEX Regime">
        <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
          {gexRegimeOptions.map(o => (
            <LevelPill key={o.id} label={o.label} selected={gexRegime === o.id} onClick={() => setGexRegime(o.id)} />
          ))}
        </div>
      </Field>
      <Field label="Framework Setup">
        <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
          {frameworkSetupOptions.map(o => (
            <LevelPill key={o.id} label={o.label} selected={frameworkSetup === o.id} onClick={() => setFrameworkSetup(o.id)} />
          ))}
        </div>
      </Field>

      {/* key level */}
      <Field label="Key Level Price (optional)">
        <input value={keyLevel} onChange={e => setKeyLevel(e.target.value)} placeholder="Leave blank to use entry price" style={iS} />
      </Field>

      {/* level type pills */}
      <Field label="Level Type">
        <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
          {levelTypes.map(l => (
            <LevelPill key={l} label={l} selected={levelType.includes(l)} onClick={() => toggleLevel(l)} />
          ))}
        </div>
      </Field>

      {/* notes */}
      <Field label="Notes">
        <textarea
          value={notes}
          onChange={e => setNotes(e.target.value)}
          rows={2}
          placeholder="Setup rationale, confluence, bias..."
          style={{ ...iS, resize: "vertical" }}
        />
      </Field>

      {/* screenshot zone */}
      <div
        onClick={() => !screenshots.length && fileRef.current?.click()}
        style={{
          border: `1px dashed ${screenshots.length ? g : b2}`,
          borderRadius: 8, padding: 12, marginBottom: 12,
          cursor: screenshots.length ? "default" : "pointer",
          textAlign: screenshots.length ? "left" : "center",
          transition: "border-color 0.15s",
        }}
      >
        {screenshots.length === 0 ? (
          <>
            <div style={{ fontSize: 11, color: gr }}>+ Screenshot</div>
            <div style={{ fontSize: 9, color: gr, opacity: 0.6, marginTop: 3 }}>Ctrl+V / ⌘V · or click to upload</div>
          </>
        ) : (
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {screenshots.map((s, i) => (
              <div key={i} style={{ position: "relative" }}>
                <img src={s.preview} alt="" style={{ width: 80, height: 56, objectFit: "cover", borderRadius: 6, border: `1px solid ${b1}` }} />
                <button
                  onClick={e => { e.stopPropagation(); removeScreenshot(i); }}
                  style={{ position: "absolute", top: -6, right: -6, width: 18, height: 18, borderRadius: "50%", background: r, border: "none", color: w, fontSize: 10, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: F }}
                >×</button>
              </div>
            ))}
            <button
              onClick={e => { e.stopPropagation(); fileRef.current?.click(); }}
              style={{ width: 80, height: 56, borderRadius: 6, border: `1px dashed ${b2}`, background: bg, color: gr, fontSize: 11, cursor: "pointer", fontFamily: F }}
            >+</button>
          </div>
        )}
      </div>
      <input ref={fileRef} type="file" multiple accept="image/*" onChange={handleFileInput} style={{ display: "none" }} />

      {/* actions */}
      <div style={{ display: "flex", gap: 8 }}>
        <button
          onClick={handleSave}
          disabled={!canSave}
          style={{
            flex: 1, padding: 13, border: "none", borderRadius: 10,
            fontFamily: F, fontSize: 12, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase",
            cursor: canSave ? "pointer" : "not-allowed",
            background: canSave ? `linear-gradient(135deg,${g},${cy})` : bg3,
            color: canSave ? bg : gr,
            transition: "opacity 0.15s",
          }}
        >
          {saving ? "Saving..." : "⚡ Log Trade"}
        </button>
        {onCancel && (
          <button
            onClick={onCancel}
            style={{ padding: "13px 18px", borderRadius: 10, background: "transparent", border: `1px solid ${b1}`, color: gr, fontFamily: F, fontSize: 11, cursor: "pointer" }}
          >
            Cancel
          </button>
        )}
      </div>

      {/* incomplete-fields reminder */}
      {!canSave && (direction || entry || stop) && (
        <div style={{ fontSize: 9, color: gr, marginTop: 8, textAlign: "center" }}>
          {!direction ? "Select direction · " : ""}{!entry ? "Entry price required · " : ""}{!stop ? "Stop required" : ""}
        </div>
      )}

      {/* toast */}
      {toast && (
        <div style={{
          position: "absolute", bottom: -44, left: "50%", transform: "translateX(-50%)",
          background: w, color: bg, fontFamily: F, fontSize: 11, fontWeight: 700,
          padding: "8px 20px", borderRadius: 6, whiteSpace: "nowrap",
          animation: "slideUp 0.2s ease",
        }}>
          {toast}
        </div>
      )}
    </div>
  );
}
