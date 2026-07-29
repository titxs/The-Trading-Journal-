import { useState, useEffect, useRef, useMemo } from "react";
import { db, storage } from "./firebase";
import QuickEntry from "./QuickEntry";
import { collection, doc, setDoc, deleteDoc, onSnapshot, query, orderBy } from "firebase/firestore";
import { ref, uploadBytes, getDownloadURL } from "firebase/storage";

const COLLECTION = "trades";
const regimeOptions = [
  { id: "trending_bull", label: "Trending Bull", desc: "Elongated up, CVDs up, OI building", color: "#00E676" },
  { id: "trending_bear", label: "Trending Bear", desc: "Elongated down, CVDs down, OI building", color: "#FF3D3D" },
  { id: "balanced", label: "Balanced / Range", desc: "RF near zero, CVDs choppy, D-shape", color: "#448AFF" },
  { id: "post_trend", label: "Post-Trend Reversal", desc: "RF transitioning, CVD exhaustion, OI dropping", color: "#FFD600" },
  { id: "high_vol", label: "High Vol / Unclear", desc: "Wide ranges, no structure — reduce or sit out", color: "#FF6D00" },
];
const setupOptions = [
  { id: "reversal", label: "Reversal", desc: "CVD divergence, absorption/exhaustion, trapped unwind", color: "#00E676" },
  { id: "continuation", label: "Continuation", desc: "Broken level retest, delta confirms, CVD holding", color: "#448AFF" },
  { id: "seventy_pct", label: "70% Rule", desc: "Opens outside PD VA, two 30m closes back inside", color: "#FFD600" },
  { id: "mean_reversion", label: "Mean Reversion", desc: "D-shape extreme, CVD divergence, fade to POC", color: "#18FFFF" },
];
const levelTypes = ["Daily VWAP","Weekly VWAP","Monthly VWAP","Yearly VWAP","VWAP Deviation Band","Anchored VWAP","POC","Composite POC","Naked POC","Composite VAH","Composite VAL","PD VAH","PD VAL","PD POC","PW VAH","PW VAL","PW POC","Monthly VAH","Monthly VAL","Monthly POC","FRVP POC","FRVP VAH","FRVP VAL","Single Prints","Poor High","Poor Low","Buying Tail","Selling Tail","Imbalance","Round Number"];
const confluenceOptions = ["CVD divergence at level","Spot vs perps divergence","OI rising (new positions)","OI dropping (forced closures)","Absorption (high vol, no movement)","Exhaustion (shrinking delta, wicks)","Delta bubble absorbed at level","Wall holding (filled not pulled)","Wall pulled (spoof)","Levels stacking (2+ same price)","Naked POC as magnet","Poor high/low target","Single prints in direction","Buying/selling tail quality","TPO shape confirms (b/P/B/D)","Backtest of broken level","Multi-TF VWAP alignment","Funding confirms crowded side","Net positioning extreme"];
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
const netGexTrendOptions = ["rising", "falling", "flat"];
const skewReadOptions = ["bullish", "bearish", "neutral"];
const defaultTrade = { id:"",date:"",pair:"BTC/USD",direction:"",regime:"",setup:"",keyLevel:"",levelType:[],levelTypeOther:"",confluence:[],confluenceOther:"",conviction:"",entryType:"",entry:"",stop:"",tp1:"",tp2:"",rr:"",posSize:"1%",leverage:"",result:"",pnl:"",pnlDollar:"",closePrice:"",hitTp1:false,hitTp2:false,followedRules:"",confirmed:"",mistakes:"",different:"",notes:"",screenshots:[],grade:"",frameworkSetup:"",gexRegime:"",gexFlip:"",netGexTrend:"",skewRead:"",skewDays:"",volRead:"",macroEvent:false,riskPercent:"" };

// ── design tokens ─────────────────────────────────────────────────────────────
const F  = "'JetBrains Mono',monospace";
const FD = "'Syne',sans-serif";
const bg="#06060A", bg2="#0C0C12", bg3="#13131A", b1="#1A1A26", b2="#222230";
const g="#00E676", r="#FF3D3D", y="#FFD600", bl="#448AFF", cy="#18FFFF", pu="#A855F7";
const w="#EEEEF5", gr="#5A5A72", gd="#2E2E42";
const iS={width:"100%",padding:"10px 12px",background:bg,color:w,border:`1px solid ${b2}`,borderRadius:8,fontSize:13,fontFamily:F,outline:"none",transition:"border-color 0.2s"};
const cS={background:bg2,border:`1px solid ${b1}`,borderRadius:14,padding:20,marginBottom:12};

// ── helpers ───────────────────────────────────────────────────────────────────
function calcRR(t){const e=parseFloat(t.entry),s=parseFloat(t.stop),tp=parseFloat(t.tp1);if(!e||!s||!tp)return"";const risk=Math.abs(e-s);if(!risk)return"";return(Math.abs(tp-e)/risk).toFixed(1);}
function calcTP(t){const e=parseFloat(t.entry),c=parseFloat(t.closePrice);if(!e||!c)return"";const p=((c-e)/e)*100*(t.direction==="SHORT"?-1:1);return p.toFixed(2);}
function signPnl(result,v){const n=Math.abs(parseFloat(v)||0);if(result==="LOSS")return-n;if(result==="BE")return 0;return n;}
function todayStr(){return new Date().toISOString().slice(0,10);}

// R-multiple: realised P&L expressed in units of risk
function calcRMultiple(t){
  const e=parseFloat(t.entry), s=parseFloat(t.stop), c=parseFloat(t.closePrice);
  if(!e||!s||!c) return null;
  const riskPct = Math.abs((s-e)/e)*100;
  if(!riskPct) return null;
  const rawPct = ((c-e)/e)*100 * (t.direction==="SHORT"?-1:1);
  return rawPct/riskPct;
}

// Profit factor: gross winning P&L / gross losing P&L
function profitFactor(trades){
  const wins = trades.filter(t=>parseFloat(t.pnl)>0).reduce((a,t)=>a+parseFloat(t.pnl),0);
  const losses = Math.abs(trades.filter(t=>parseFloat(t.pnl)<0).reduce((a,t)=>a+parseFloat(t.pnl),0));
  if(!losses) return wins>0 ? "∞" : "0.00";
  return (wins/losses).toFixed(2);
}

// Current win/loss streak (most recent)
function calcStreak(trades){
  const sorted = [...trades].filter(t=>t.result).sort((a,b)=>(b.createdAt||0)-(a.createdAt||0));
  if(!sorted.length) return { type:"NONE", count:0 };
  const first = sorted[0].result;
  let count = 0;
  for(const t of sorted){ if(t.result===first) count++; else break; }
  return { type:first, count };
}

// Max drawdown — peak-to-trough on cumulative %
function maxDrawdown(trades){
  const sorted = [...trades].filter(t=>t.date&&t.pnl).sort((a,b)=>a.date.localeCompare(b.date));
  let cum=0, peak=0, maxDD=0;
  sorted.forEach(t=>{cum+=parseFloat(t.pnl)||0; if(cum>peak)peak=cum; const dd=peak-cum; if(dd>maxDD)maxDD=dd;});
  return maxDD.toFixed(2);
}

// Rolling N-trade win rate
function rollingWinRate(trades, n=10){
  const recent = [...trades].filter(t=>t.result).slice(0, n);
  if(!recent.length) return null;
  const wins = recent.filter(t=>t.result==="WIN").length;
  return ((wins/recent.length)*100).toFixed(0);
}

// Day-of-week breakdown
function dowBreakdown(trades){
  const days = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
  const out = days.map(d=>({day:d, total:0, wins:0, pnl:0}));
  trades.filter(t=>t.result&&t.date).forEach(t=>{
    const d = new Date(t.date).getDay();
    out[d].total++;
    if(t.result==="WIN") out[d].wins++;
    out[d].pnl += parseFloat(t.pnl)||0;
  });
  return out;
}

// Find best performer in an option list by total P&L (min 2 trades to qualify)
function bestPerformer(trades, options, key){
  const stats = options.map(o=>{
    const ts = trades.filter(t=>t.result&&t[key]===o.id);
    const pnls = ts.filter(t=>t.pnl).map(t=>parseFloat(t.pnl));
    const total = pnls.reduce((a,b)=>a+b,0);
    const wins = ts.filter(t=>t.result==="WIN").length;
    const wr = ts.length ? (wins/ts.length)*100 : 0;
    return { ...o, count:ts.length, pnl:total, winRate:wr };
  }).filter(s=>s.count>=2);
  if(!stats.length) return null;
  return stats.sort((a,b)=>b.pnl-a.pnl)[0];
}

// ── sub-components ────────────────────────────────────────────────────────────
function Sec({title,children,accent=g}){return(<div style={cS}><div style={{fontSize:10,fontWeight:700,color:accent,textTransform:"uppercase",letterSpacing:"0.12em",fontFamily:F,marginBottom:16,display:"flex",alignItems:"center",gap:8}}><div style={{width:2,height:12,background:accent,borderRadius:2}}/>{title}</div>{children}</div>);}
function Fld({label,children}){return(<div style={{marginBottom:12}}><div style={{fontSize:9,color:gr,textTransform:"uppercase",letterSpacing:"0.1em",fontFamily:F,marginBottom:6,fontWeight:600}}>{label}</div>{children}</div>);}
function Pill({label,selected,onClick,color=g}){return(<button onClick={onClick} style={{padding:"5px 12px",borderRadius:20,border:`1px solid ${selected?color:b2}`,background:selected?`${color}15`:"transparent",color:selected?color:gr,fontSize:11,fontFamily:F,fontWeight:600,cursor:"pointer",transition:"all 0.15s",whiteSpace:"nowrap"}}>{label}</button>);}
function RCard({o,sel,onClick}){return(<button onClick={onClick} style={{flex:1,minWidth:130,padding:"10px 12px",background:sel?`${o.color}10`:bg,border:`1px solid ${sel?o.color:b2}`,borderRadius:10,cursor:"pointer",textAlign:"left",transition:"all 0.15s"}}><div style={{fontSize:10,fontWeight:700,color:sel?o.color:gr,fontFamily:F}}>{o.label}</div><div style={{fontSize:8,color:gd,fontFamily:F,marginTop:3,lineHeight:1.4}}>{o.desc}</div></button>);}

function StatCard({label,value,sub,color=w,accent,tooltip}){
  return(
    <div title={tooltip||""} className="stat-card" style={{background:`linear-gradient(180deg,${bg2} 0%,${bg2}cc 100%)`,border:`1px solid ${b1}`,borderRadius:12,padding:"16px 18px",flex:1,minWidth:96,position:"relative",overflow:"hidden",transition:"all 0.15s"}}>
      {accent&&<div style={{position:"absolute",top:0,left:0,right:0,height:2,background:`linear-gradient(90deg,${accent},${accent}66)`,borderRadius:"12px 12px 0 0"}}/>}
      <div style={{fontSize:9,color:gr,textTransform:"uppercase",letterSpacing:"0.1em",fontFamily:F,fontWeight:600,marginBottom:6}}>{label}</div>
      <div style={{fontSize:21,fontWeight:700,color,fontFamily:F,letterSpacing:"-0.02em"}}>{value}</div>
      {sub&&<div style={{fontSize:9,color:gr,marginTop:3,fontFamily:F}}>{sub}</div>}
    </div>
  );
}

// ── nav icons ─────────────────────────────────────────────────────────────────
const NavIcon = {
  home: ()=><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z"/><polyline points="9,22 9,12 15,12 15,22"/></svg>,
  quick: ()=><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polygon points="13,2 3,14 12,14 11,22 21,10 12,10"/></svg>,
  pnl: ()=><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>,
  history: ()=><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>,
  log: ()=><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>,
  stats: ()=><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>,
};

// ── main ──────────────────────────────────────────────────────────────────────
export default function AlphaJournal(){
  const[trades,setTrades]=useState([]);
  const[ct,setCt]=useState({...defaultTrade});
  const[view,setView]=useState("home");
  const[editingId,setEditingId]=useState(null);
  const[expTrade,setExpTrade]=useState(null);
  const[filterR,setFilterR]=useState("ALL");
  const[calMonth,setCalMonth]=useState(new Date());
  const[selDay,setSelDay]=useState(null);
  const[saving,setSaving]=useState(false);
  const[ssFiles,setSsFiles]=useState([]);
  const[sFilter,setSFilter]=useState("all");
  const[lightbox,setLightbox]=useState(null);
  const fRef=useRef(null);

  useEffect(()=>{
    const q=query(collection(db,COLLECTION),orderBy("createdAt","desc"));
    const u=onSnapshot(q,s=>{setTrades(s.docs.map(d=>({id:d.id,...d.data()})));},e=>console.error(e));
    return()=>u();
  },[]);

  const save=async(t)=>{try{await setDoc(doc(db,COLLECTION,t.id),t);}catch(e){console.error(e);}};
  const del=async(id)=>{try{await deleteDoc(doc(db,COLLECTION,id));}catch(e){console.error(e);}};

  const submit=async()=>{
    if(!ct.date||!ct.direction||!ct.keyLevel||saving)return;
    setSaving(true);
    try{
      const id=editingId||Date.now().toString();
      const urls=[];
      for(let i=0;i<ssFiles.length;i++){const f=ssFiles[i];const sr=ref(storage,`screenshots/${id}/${Date.now()}_${i}_${f.name}`);await uploadBytes(sr,f);urls.push(await getDownloadURL(sr));}
      const existing=ct.screenshots.filter(s=>typeof s==="string"&&s.startsWith("http"));
      const sp=ct.pnl?signPnl(ct.result,ct.pnl):"";
      const sd=ct.pnlDollar?signPnl(ct.result,ct.pnlDollar):"";
      const trade={...ct,id,screenshots:[...existing,...urls],pnl:sp!==""?String(sp):"",pnlDollar:sd!==""?String(sd):"",tradePercent:calcTP(ct),rr:calcRR(ct),createdAt:editingId?(trades.find(t=>t.id===editingId)?.createdAt||Date.now()):Date.now()};
      await save(trade);setEditingId(null);setCt({...defaultTrade});setSsFiles([]);setView("home");
    }catch(e){console.error(e);alert("Failed to save.");}finally{setSaving(false);}
  };

  const up=(k,v)=>setCt(p=>({...p,[k]:v}));
  const tog=(k,v)=>setCt(p=>({...p,[k]:p[k]?.includes(v)?p[k].filter(x=>x!==v):[...(p[k]||[]),v]}));
  const gf=(f)=>{if(f==="all")return trades.filter(t=>t.result);if(f.startsWith("setup_"))return trades.filter(t=>t.result&&t.setup===f.replace("setup_",""));if(f.startsWith("regime_"))return trades.filter(t=>t.result&&t.regime===f.replace("regime_",""));return trades.filter(t=>t.result);};
  const cs=(fl)=>{const t=fl.length,wi=fl.filter(x=>x.result==="WIN").length,lo=fl.filter(x=>x.result==="LOSS").length,be=fl.filter(x=>x.result==="BE").length;const wr=t?((wi/t)*100).toFixed(1):"0";const pnls=fl.filter(x=>x.pnl).map(x=>parseFloat(x.pnl));const tp=pnls.reduce((a,b)=>a+b,0).toFixed(2);const dols=fl.filter(x=>x.pnlDollar).map(x=>parseFloat(x.pnlDollar));const td=dols.length?dols.reduce((a,b)=>a+b,0).toFixed(2):"0";const wRR=fl.filter(x=>x.result==="WIN"&&x.rr).map(x=>parseFloat(x.rr));const ar=wRR.length?(wRR.reduce((a,b)=>a+b,0)/wRR.length).toFixed(1):"0";const rf=fl.filter(x=>x.followedRules==="YES").length;const rr=t?((rf/t)*100).toFixed(0):"0";const bt=pnls.length?Math.max(...pnls).toFixed(2):"0";const wt=pnls.length?Math.min(...pnls).toFixed(2):"0";const tps=fl.filter(x=>x.tradePercent).map(x=>parseFloat(x.tradePercent));const ttp=tps.reduce((a,b)=>a+b,0).toFixed(2);const winPnls=pnls.filter(p=>p>0);const lossPnls=pnls.filter(p=>p<0).map(Math.abs);const avgWin=winPnls.length?(winPnls.reduce((a,b)=>a+b,0)/winPnls.length):0;const avgLoss=lossPnls.length?(lossPnls.reduce((a,b)=>a+b,0)/lossPnls.length):0;const pf=profitFactor(fl);const p=parseFloat(wr)/100;const expectancy=(p*avgWin)-((1-p)*avgLoss);const payoff=avgLoss>0?(avgWin/avgLoss).toFixed(2):"—";return{total:t,wins:wi,losses:lo,be,winRate:wr,totalPnl:tp,totalDollar:td,avgRR:ar,rulesRate:rr,bestTrade:bt,worstTrade:wt,totalTradePercent:ttp,avgWin:avgWin.toFixed(2),avgLoss:avgLoss.toFixed(2),profitFactor:pf,expectancy:expectancy.toFixed(2),payoff};};

  // monthly stats
  const now=new Date();
  const yr=calMonth.getFullYear(),mo=calMonth.getMonth();
  const ms=`${yr}-${String(mo+1).padStart(2,"0")}`;
  const mn=["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  const pbd={},dbd={},tbd={},tlbd={};
  trades.forEach(t=>{if(!t.date)return;const p=parseFloat(t.pnl)||0,d=parseFloat(t.pnlDollar)||0;if(!pbd[t.date]){pbd[t.date]=0;dbd[t.date]=0;tbd[t.date]=0;tlbd[t.date]=[];}pbd[t.date]+=p;dbd[t.date]+=d;tbd[t.date]+=1;tlbd[t.date].push(t);});
  let mp=0,md=0,mt=0,mw=0,ml=0,mtp=0;
  Object.keys(pbd).forEach(d=>{if(d.startsWith(ms)){mp+=pbd[d];md+=dbd[d]||0;mt+=tbd[d];if(pbd[d]>0)mw++;if(pbd[d]<0)ml++;}});
  trades.forEach(t=>{if(t.date&&t.date.startsWith(ms)&&t.tradePercent)mtp+=parseFloat(t.tradePercent)||0;});

  const allStats=cs(trades.filter(t=>t.result));
  const todayTrades=trades.filter(t=>t.date===todayStr());
  const todayPnl=todayTrades.reduce((a,t)=>a+(parseFloat(t.pnl)||0),0);
  const recentTrades=trades.filter(t=>t.result).slice(0,5);
  const dim=new Date(yr,mo+1,0).getDate(),fdw=new Date(yr,mo,1).getDay();
  const td2=new Date();

  // derived stats memoized
  const streak = useMemo(()=>calcStreak(trades), [trades]);
  const maxDD = useMemo(()=>maxDrawdown(trades), [trades]);
  const roll10 = useMemo(()=>rollingWinRate(trades, 10), [trades]);
  const dow = useMemo(()=>dowBreakdown(trades), [trades]);
  const topSetup = useMemo(()=>bestPerformer(trades, setupOptions, "setup"), [trades]);
  const topRegime = useMemo(()=>bestPerformer(trades, regimeOptions, "regime"), [trades]);

  const navItems=[
    {id:"home",label:"Home",Icon:NavIcon.home},
    {id:"quick",label:"Quick",Icon:NavIcon.quick},
    {id:"log",label:editingId?"Edit":"Log",Icon:NavIcon.log},
    {id:"pnl",label:"P&L",Icon:NavIcon.pnl},
    {id:"history",label:"History",Icon:NavIcon.history},
    {id:"stats",label:"Stats",Icon:NavIcon.stats},
  ];

  const globalStyles=`
    @import url('https://fonts.googleapis.com/css2?family=Syne:wght@400;600;700;800&family=JetBrains+Mono:wght@400;500;600;700&display=swap');
    *{box-sizing:border-box;margin:0;padding:0;}
    body{background:${bg};}
    input:focus,textarea:focus,select:focus{border-color:${g}!important;outline:none;box-shadow:0 0 0 3px ${g}10;}
    ::-webkit-scrollbar{width:3px;height:3px;}
    ::-webkit-scrollbar-track{background:transparent;}
    ::-webkit-scrollbar-thumb{background:${b2};border-radius:4px;}
    ::-webkit-scrollbar-thumb:hover{background:${gr};}
    @keyframes fadeUp{from{opacity:0;transform:translateY(12px);}to{opacity:1;transform:translateY(0);}}
    @keyframes pulse{0%,100%{opacity:1;}50%{opacity:0.5;}}
    .fi{animation:fadeUp 0.25s ease both;}
    .fi2{animation:fadeUp 0.25s ease 0.05s both;opacity:0;animation-fill-mode:forwards;}
    .fi3{animation:fadeUp 0.25s ease 0.1s both;opacity:0;animation-fill-mode:forwards;}
    .nav-btn:hover{background:${b1}!important;}
    .trade-row:hover{background:${bg3}!important;border-color:${b2}!important;}
    .stat-card:hover{transform:translateY(-1px);border-color:${b2}!important;}
    input[type=date]::-webkit-calendar-picker-indicator{filter:invert(0.4);}
  `;

  return(
    <div style={{minHeight:"100vh",background:`radial-gradient(ellipse at top, ${bg2} 0%, ${bg} 50%)`,color:w,fontFamily:F,paddingBottom:80}}>
      <style>{globalStyles}</style>

      {/* ── top bar ── */}
      <div style={{position:"sticky",top:0,zIndex:100,background:`${bg}ee`,backdropFilter:"blur(14px)",WebkitBackdropFilter:"blur(14px)",borderBottom:`1px solid ${b1}`,padding:"0 20px",display:"flex",alignItems:"center",justifyContent:"space-between",height:54}}>
        <div style={{display:"flex",alignItems:"center",gap:10}}>
          <div style={{width:34,height:34,borderRadius:9,background:`linear-gradient(145deg,#0d0d14,#0a0a10)`,border:`1px solid ${g}35`,boxShadow:`0 0 12px ${g}20, 0 4px 16px rgba(0,0,0,0.6), inset 0 1px 0 ${g}10`,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>
            <span style={{fontSize:22,fontStyle:"italic",fontWeight:900,fontFamily:"Georgia,'Times New Roman',serif",background:`linear-gradient(135deg,${cy} 0%,${g} 100%)`,WebkitBackgroundClip:"text",WebkitTextFillColor:"transparent",backgroundClip:"text",lineHeight:1,userSelect:"none",letterSpacing:"-0.02em"}}>α</span>
          </div>
          <div>
            <div style={{fontSize:13,fontWeight:700,fontFamily:FD,letterSpacing:"0.01em",lineHeight:1,background:`linear-gradient(90deg,${w} 0%,${cy} 150%)`,WebkitBackgroundClip:"text",WebkitTextFillColor:"transparent",backgroundClip:"text"}}>The Alpha Journal</div>
            <div style={{fontSize:8,color:gd,fontFamily:F,letterSpacing:"0.1em",marginTop:2}}>ORDERFLOW · BTC/USD</div>
          </div>
        </div>
        <div style={{display:"flex",alignItems:"center",gap:10}}>
          {streak.count>0&&<div style={{display:"flex",alignItems:"center",gap:5,padding:"4px 9px",borderRadius:6,background:streak.type==="WIN"?`${g}10`:streak.type==="LOSS"?`${r}10`:`${y}10`,border:`1px solid ${streak.type==="WIN"?g:streak.type==="LOSS"?r:y}30`}}>
            <span style={{fontSize:9,color:streak.type==="WIN"?g:streak.type==="LOSS"?r:y,fontWeight:700,letterSpacing:"0.06em",fontFamily:F}}>{streak.count}{streak.type==="WIN"?"W":streak.type==="LOSS"?"L":"BE"} STREAK</span>
          </div>}
          <div style={{display:"flex",alignItems:"center",gap:6}}>
            <div style={{width:6,height:6,borderRadius:"50%",background:g,boxShadow:`0 0 8px ${g}`,animation:"pulse 2s infinite"}}/>
            <span style={{fontSize:10,color:gr,fontFamily:F,letterSpacing:"0.08em"}}>LIVE</span>
          </div>
        </div>
      </div>

      {/* ── bottom nav ── */}
      <div style={{position:"fixed",bottom:0,left:0,right:0,zIndex:100,background:`${bg}f5`,backdropFilter:"blur(16px)",WebkitBackdropFilter:"blur(16px)",borderTop:`1px solid ${b1}`,display:"flex",alignItems:"center",padding:"6px 8px 10px"}}>
        {navItems.map(({id,label,Icon})=>{
          const active=view===id;
          return(
            <button key={id} className="nav-btn" onClick={()=>{setView(id);setSelDay(null);}} style={{flex:1,display:"flex",flexDirection:"column",alignItems:"center",gap:3,padding:"6px 4px",borderRadius:10,border:"none",cursor:"pointer",background:"transparent",color:active?g:gr,transition:"all 0.15s",fontFamily:F,position:"relative"}}>
              {active&&<div style={{position:"absolute",top:-7,left:"50%",transform:"translateX(-50%)",width:24,height:2,background:`linear-gradient(90deg,${g},${cy})`,borderRadius:2,boxShadow:`0 0 8px ${g}`}}/>}
              <div style={{color:active?g:gr,transition:"color 0.15s"}}><Icon/></div>
              <span style={{fontSize:9,fontWeight:active?700:500,letterSpacing:"0.04em",textTransform:"uppercase"}}>{label}</span>
            </button>
          );
        })}
      </div>

      <div style={{maxWidth:920,margin:"0 auto",padding:"24px 16px"}}>

        {/* ════════════ HOME ════════════ */}
        {view==="home"&&(<div>
          {/* greeting */}
          <div className="fi" style={{marginBottom:24,display:"flex",alignItems:"flex-end",justifyContent:"space-between",flexWrap:"wrap",gap:12}}>
            <div>
              <div style={{fontSize:26,fontWeight:800,fontFamily:FD,letterSpacing:"-0.025em",lineHeight:1.1,background:`linear-gradient(135deg,${w} 0%,${gr} 100%)`,WebkitBackgroundClip:"text",WebkitTextFillColor:"transparent",backgroundClip:"text"}}>
                {new Date().getHours()<12?"Good morning":new Date().getHours()<17?"Good afternoon":"Good evening"}, Titus.
              </div>
              <div style={{fontSize:12,color:gr,marginTop:6,fontFamily:F,letterSpacing:"0.02em"}}>{new Date().toLocaleDateString("en-AU",{weekday:"long",day:"numeric",month:"long",year:"numeric"})}</div>
            </div>
            {roll10!==null&&<div style={{textAlign:"right"}}>
              <div style={{fontSize:9,color:gr,textTransform:"uppercase",letterSpacing:"0.1em",fontFamily:F,fontWeight:600}}>Form · Last 10</div>
              <div style={{fontSize:18,fontWeight:700,color:parseFloat(roll10)>=parseFloat(allStats.winRate)?g:r,fontFamily:F,letterSpacing:"-0.02em"}}>{roll10}% {parseFloat(roll10)>=parseFloat(allStats.winRate)?"↑":"↓"}</div>
            </div>}
          </div>

          {/* today strip */}
          <div className="fi" style={{background:`linear-gradient(135deg,${bg2} 0%,${bg2}80 100%)`,border:`1px solid ${b1}`,borderRadius:16,padding:"18px 22px",marginBottom:12,display:"flex",alignItems:"center",justifyContent:"space-between",overflow:"hidden",position:"relative"}}>
            <div>
              <div style={{fontSize:9,color:gr,textTransform:"uppercase",letterSpacing:"0.12em",fontFamily:F,fontWeight:600,marginBottom:6}}>Today's P&L</div>
              <div style={{display:"flex",alignItems:"baseline",gap:10}}>
                <span style={{fontSize:30,fontWeight:700,color:todayPnl>=0?g:todayPnl===0?gr:r,fontFamily:F,letterSpacing:"-0.03em"}}>{todayPnl>=0?"+":""}{todayPnl.toFixed(2)}%</span>
                <span style={{fontSize:11,color:gr,letterSpacing:"0.04em"}}>{todayTrades.length} TRADE{todayTrades.length!==1?"S":""}</span>
              </div>
            </div>
            <button onClick={()=>setView("quick")} style={{display:"flex",alignItems:"center",gap:7,padding:"11px 18px",borderRadius:10,border:`1px solid ${g}40`,background:`linear-gradient(135deg,${g}15,${g}05)`,color:g,fontFamily:F,fontSize:11,fontWeight:700,cursor:"pointer",letterSpacing:"0.06em",boxShadow:`0 0 20px ${g}10`}}>
              <NavIcon.quick/> QUICK LOG
            </button>
          </div>

          {/* key stats row 1 */}
          <div className="fi2" style={{display:"flex",gap:8,marginBottom:8,flexWrap:"wrap"}}>
            <StatCard label="Monthly P/L" value={`${mp>=0?"+":""}${mp.toFixed(2)}%`} sub={`${mtp!==0?`Trade P&L ${mtp>=0?"+":""}${mtp.toFixed(2)}%`:""} · ${md>=0?"+":""}$${Math.abs(md).toFixed(0)}`} color={mp>=0?g:r} accent={mp>=0?g:r}/>
            <StatCard label="Win Rate" value={`${allStats.winRate}%`} sub={`${allStats.wins}W · ${allStats.losses}L · ${allStats.be}BE`} color={parseFloat(allStats.winRate)>=50?g:r} accent={parseFloat(allStats.winRate)>=50?g:r}/>
            <StatCard label="Profit Factor" value={allStats.profitFactor} sub="gross W / gross L" color={parseFloat(allStats.profitFactor)>=1.5?g:parseFloat(allStats.profitFactor)>=1?y:r} accent={parseFloat(allStats.profitFactor)>=1.5?g:parseFloat(allStats.profitFactor)>=1?y:r} tooltip="Profit Factor — sum of winning trades / sum of losing trades. >1.5 healthy, >2 strong."/>
            <StatCard label="Expectancy" value={`${parseFloat(allStats.expectancy)>=0?"+":""}${allStats.expectancy}%`} sub="avg per trade" color={parseFloat(allStats.expectancy)>=0?g:r} accent={bl} tooltip="(WinRate × AvgWin) − (LossRate × AvgLoss). Avg % expected per trade."/>
          </div>

          {/* key stats row 2 */}
          <div className="fi2" style={{display:"flex",gap:8,marginBottom:12,flexWrap:"wrap"}}>
            <StatCard label="Avg Win" value={`+${allStats.avgWin}%`} sub={`vs ${allStats.avgLoss}% avg loss`} color={g} accent={g}/>
            <StatCard label="Payoff" value={allStats.payoff!=="—"?`${allStats.payoff}:1`:"—"} sub="avg win / avg loss" color={parseFloat(allStats.payoff)>=2?g:parseFloat(allStats.payoff)>=1?y:r} accent={pu} tooltip="Avg winning trade / avg losing trade. Surfaces 'cutting winners short' patterns."/>
            <StatCard label="Max DD" value={`-${maxDD}%`} sub="peak to trough" color={parseFloat(maxDD)<10?g:parseFloat(maxDD)<20?y:r} accent={r}/>
            <StatCard label="Rules" value={`${allStats.rulesRate}%`} sub="followed" color={parseFloat(allStats.rulesRate)>=80?g:y} accent={parseFloat(allStats.rulesRate)>=80?g:y}/>
          </div>

          {/* equity curve */}
          <div className="fi2" style={{...cS,marginBottom:12}}>
            <div style={{fontSize:9,color:gr,textTransform:"uppercase",letterSpacing:"0.1em",fontFamily:F,fontWeight:600,marginBottom:12,display:"flex",alignItems:"center",justifyContent:"space-between"}}>
              <span>All-time equity curve</span>
              <span style={{color:parseFloat(allStats.totalPnl)>=0?g:r,fontWeight:700}}>{parseFloat(allStats.totalPnl)>=0?"+":""}{allStats.totalPnl}%</span>
            </div>
            <EQ trades={trades}/>
          </div>

          {/* top performers — most profitable setup & regime */}
          {(topSetup||topRegime)&&<div className="fi2" style={{display:"flex",gap:8,marginBottom:12,flexWrap:"wrap"}}>
            {topSetup&&<div style={{flex:1,minWidth:200,background:`linear-gradient(180deg,${bg2} 0%,${bg2}cc 100%)`,border:`1px solid ${b1}`,borderRadius:12,padding:"16px 18px",position:"relative",overflow:"hidden",transition:"all 0.15s"}} className="stat-card">
              <div style={{position:"absolute",top:0,left:0,right:0,height:2,background:`linear-gradient(90deg,${topSetup.color},${topSetup.color}66)`,borderRadius:"12px 12px 0 0"}}/>
              <div style={{fontSize:9,color:gr,textTransform:"uppercase",letterSpacing:"0.1em",fontFamily:F,fontWeight:600,marginBottom:6}}>Top Setup</div>
              <div style={{fontSize:15,fontWeight:700,color:topSetup.color,fontFamily:F,letterSpacing:"-0.01em",marginBottom:6}}>{topSetup.label}</div>
              <div style={{display:"flex",gap:14,fontSize:10,fontFamily:F}}>
                <span><span style={{color:gr}}>P&L </span><span style={{color:topSetup.pnl>=0?g:r,fontWeight:700}}>{topSetup.pnl>=0?"+":""}{topSetup.pnl.toFixed(2)}%</span></span>
                <span><span style={{color:gr}}>Win </span><span style={{color:topSetup.winRate>=50?g:r,fontWeight:700}}>{topSetup.winRate.toFixed(0)}%</span></span>
                <span><span style={{color:gr}}>{topSetup.count} trades</span></span>
              </div>
            </div>}
            {topRegime&&<div style={{flex:1,minWidth:200,background:`linear-gradient(180deg,${bg2} 0%,${bg2}cc 100%)`,border:`1px solid ${b1}`,borderRadius:12,padding:"16px 18px",position:"relative",overflow:"hidden",transition:"all 0.15s"}} className="stat-card">
              <div style={{position:"absolute",top:0,left:0,right:0,height:2,background:`linear-gradient(90deg,${topRegime.color},${topRegime.color}66)`,borderRadius:"12px 12px 0 0"}}/>
              <div style={{fontSize:9,color:gr,textTransform:"uppercase",letterSpacing:"0.1em",fontFamily:F,fontWeight:600,marginBottom:6}}>Top Regime</div>
              <div style={{fontSize:15,fontWeight:700,color:topRegime.color,fontFamily:F,letterSpacing:"-0.01em",marginBottom:6}}>{topRegime.label}</div>
              <div style={{display:"flex",gap:14,fontSize:10,fontFamily:F}}>
                <span><span style={{color:gr}}>P&L </span><span style={{color:topRegime.pnl>=0?g:r,fontWeight:700}}>{topRegime.pnl>=0?"+":""}{topRegime.pnl.toFixed(2)}%</span></span>
                <span><span style={{color:gr}}>Win </span><span style={{color:topRegime.winRate>=50?g:r,fontWeight:700}}>{topRegime.winRate.toFixed(0)}%</span></span>
                <span><span style={{color:gr}}>{topRegime.count} trades</span></span>
              </div>
            </div>}
          </div>}

          {/* recent trades */}
          <div className="fi3" style={cS}>
            <div style={{fontSize:9,color:gr,textTransform:"uppercase",letterSpacing:"0.1em",fontFamily:F,fontWeight:600,marginBottom:12,display:"flex",alignItems:"center",justifyContent:"space-between"}}>
              <span>Recent trades</span>
              <button onClick={()=>setView("history")} style={{background:"none",border:"none",color:bl,fontSize:9,fontFamily:F,cursor:"pointer",letterSpacing:"0.06em"}}>VIEW ALL →</button>
            </div>
            {recentTrades.length===0&&<div style={{textAlign:"center",padding:"28px 0",color:gr,fontSize:12}}>No trades yet — log your first one.</div>}
            {recentTrades.map(t=>{
              const rMult = calcRMultiple(t);
              return(
              <div key={t.id} className="trade-row" onClick={()=>{setCt({...defaultTrade,...t});setEditingId(t.id);setSsFiles([]);setView("log");}} style={{display:"flex",alignItems:"center",gap:10,padding:"10px 8px",borderBottom:`1px solid ${b1}`,cursor:"pointer",borderRadius:6,transition:"all 0.12s",border:`1px solid transparent`,borderBottomColor:b1}}>
                <div style={{width:6,height:6,borderRadius:"50%",background:t.result==="WIN"?g:t.result==="LOSS"?r:y,flexShrink:0,boxShadow:`0 0 6px ${t.result==="WIN"?g:t.result==="LOSS"?r:y}80`}}/>
                <div style={{flex:1,minWidth:0}}>
                  <div style={{fontSize:11,fontWeight:600}}>{t.date} <span style={{color:gr,fontWeight:400}}>· {t.direction} {t.pair}</span></div>
                  {t.setup&&<div style={{fontSize:9,color:gd,marginTop:1}}>{setupOptions.find(s=>s.id===t.setup)?.label||""}</div>}
                </div>
                {rMult!==null&&<div style={{fontSize:10,fontWeight:700,color:rMult>=0?g:r,fontFamily:F,minWidth:46,textAlign:"center",padding:"3px 7px",borderRadius:5,background:rMult>=0?`${g}10`:`${r}10`,border:`1px solid ${rMult>=0?g:r}25`}}>{rMult>=0?"+":""}{rMult.toFixed(1)}R</div>}
                <div style={{textAlign:"right",minWidth:60}}>
                  <div style={{fontSize:12,fontWeight:700,color:parseFloat(t.pnl)>=0?g:r}}>{parseFloat(t.pnl)>=0?"+":""}{t.pnl}%</div>
                  {t.pnlDollar&&<div style={{fontSize:9,color:gr}}>${t.pnlDollar}</div>}
                </div>
              </div>
            );})}
          </div>

          {/* discipline rules */}
          <div className="fi3" style={{...cS,marginTop:0}}>
            <div style={{fontSize:9,color:gr,textTransform:"uppercase",letterSpacing:"0.1em",fontFamily:F,fontWeight:600,marginBottom:12}}>Session rules</div>
            {[
              {rule:"Max 2–3 trades per session",key:"rule1"},
              {rule:"Pre-define TP levels before entry",key:"rule2"},
              {rule:"No trades after 2 consecutive losses",key:"rule3"},
              {rule:"Must have 3+ confluence factors",key:"rule4"},
              {rule:"No entries without a key level",key:"rule5"},
            ].map(({rule,key})=>(
              <div key={key} style={{display:"flex",alignItems:"center",gap:10,padding:"8px 0",borderBottom:`1px solid ${b1}`}}>
                <div style={{width:18,height:18,borderRadius:5,border:`1px solid ${g}30`,background:`${g}08`,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>
                  <svg width="10" height="10" viewBox="0 0 12 12" fill="none"><polyline points="2,6 5,9 10,3" stroke={g} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></svg>
                </div>
                <span style={{fontSize:11,color:gr}}>{rule}</span>
              </div>
            ))}
          </div>
        </div>)}

        {/* ════════════ QUICK ════════════ */}
        {view==="quick"&&(<div className="fi" style={{display:"flex",justifyContent:"center"}}>
          <QuickEntry onSaved={()=>setView("home")} onCancel={()=>setView("home")}/>
        </div>)}

        {/* ════════════ LOG ════════════ */}
        {view==="log"&&(<div className="fi">
          <Sec title="Trade Setup"><div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:12}}>
            <Fld label="Date"><input type="date" value={ct.date} onChange={e=>up("date",e.target.value)} style={iS}/></Fld>
            <Fld label="Pair"><input value={ct.pair} onChange={e=>up("pair",e.target.value)} style={iS}/></Fld>
            <Fld label="Direction"><div style={{display:"flex",gap:6}}>{["LONG","SHORT"].map(d=><button key={d} onClick={()=>up("direction",d)} style={{flex:1,padding:"10px 0",borderRadius:8,border:`1px solid ${ct.direction===d?(d==="LONG"?g:r):b2}`,background:ct.direction===d?(d==="LONG"?`${g}20`:`${r}20`):bg,color:ct.direction===d?(d==="LONG"?g:r):gr,fontFamily:F,fontSize:12,fontWeight:700,cursor:"pointer",transition:"all 0.15s"}}>{d==="LONG"?"▲":"▼"} {d}</button>)}</div></Fld>
          </div></Sec>
          <Sec title="Regime & Setup" accent={y}>
            <Fld label="Market Regime"><div style={{display:"flex",gap:6,flexWrap:"wrap"}}>{regimeOptions.map(o=><RCard key={o.id} o={o} sel={ct.regime===o.id} onClick={()=>up("regime",o.id)}/>)}</div></Fld>
            <Fld label="Setup Type"><div style={{display:"flex",gap:6,flexWrap:"wrap"}}>{setupOptions.map(o=><RCard key={o.id} o={o} sel={ct.setup===o.id} onClick={()=>up("setup",o.id)}/>)}</div></Fld>
          </Sec>
          <Sec title="CLAUDE.md Framework" accent={pu}>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>
              <Fld label="Grade"><div style={{display:"flex",gap:6}}>{gradeOptions.map(x=><Pill key={x} label={x} selected={ct.grade===x} onClick={()=>up("grade",x)} color={x==="A+"?g:x==="A"?bl:x==="B"?y:r}/>)}</div></Fld>
              <Fld label="GEX Regime"><div style={{display:"flex",gap:6,flexWrap:"wrap"}}>{gexRegimeOptions.map(o=><Pill key={o.id} label={o.label} selected={ct.gexRegime===o.id} onClick={()=>up("gexRegime",o.id)} color={o.color}/>)}</div></Fld>
            </div>
            <Fld label="Framework Setup"><div style={{display:"flex",gap:6,flexWrap:"wrap"}}>{frameworkSetupOptions.map(o=><Pill key={o.id} label={o.label} selected={ct.frameworkSetup===o.id} onClick={()=>up("frameworkSetup",o.id)} color={pu}/>)}</div></Fld>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:12}}>
              <Fld label="GEX Flip"><input value={ct.gexFlip||""} onChange={e=>up("gexFlip",e.target.value)} placeholder="e.g. 63600" style={iS}/></Fld>
              <Fld label="Net GEX Trend"><div style={{display:"flex",gap:4}}>{netGexTrendOptions.map(x=><Pill key={x} label={x} selected={ct.netGexTrend===x} onClick={()=>up("netGexTrend",x)} color={bl}/>)}</div></Fld>
              <Fld label="Risk %"><input value={ct.riskPercent||""} onChange={e=>up("riskPercent",e.target.value)} placeholder="e.g. 1.6" style={iS}/></Fld>
            </div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:12}}>
              <Fld label="Skew Read"><div style={{display:"flex",gap:4}}>{skewReadOptions.map(x=><Pill key={x} label={x} selected={ct.skewRead===x} onClick={()=>up("skewRead",x)} color={x==="bullish"?g:x==="bearish"?r:gr}/>)}</div></Fld>
              <Fld label="Skew Days Sustained"><input value={ct.skewDays||""} onChange={e=>up("skewDays",e.target.value)} placeholder="e.g. 7" style={iS}/></Fld>
              <Fld label="Vol Read"><input value={ct.volRead||""} onChange={e=>up("volRead",e.target.value)} placeholder="e.g. VRP+6.2%" style={iS}/></Fld>
            </div>
            <Fld label="Major Macro Event Today?"><div style={{display:"flex",gap:6}}>{[{v:true,l:"YES"},{v:false,l:"NO"}].map(x=><Pill key={x.l} label={x.l} selected={ct.macroEvent===x.v} onClick={()=>up("macroEvent",x.v)} color={x.v?r:g}/>)}</div></Fld>
          </Sec>
          <Sec title="Key Level" accent={bl}>
            <Fld label="Price Level"><input value={ct.keyLevel} onChange={e=>up("keyLevel",e.target.value)} placeholder="e.g. 78005" style={iS}/></Fld>
            <Fld label="Level Type"><div style={{display:"flex",gap:6,flexWrap:"wrap"}}>{levelTypes.map(l=><Pill key={l} label={l} selected={ct.levelType?.includes(l)} onClick={()=>tog("levelType",l)} color={bl}/>)}</div><div style={{marginTop:8}}><input value={ct.levelTypeOther||""} onChange={e=>up("levelTypeOther",e.target.value)} placeholder="Other level type..." style={{...iS,fontSize:11}}/></div></Fld>
          </Sec>
          <Sec title="Confluence" accent={cy}>
            <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>{confluenceOptions.map(c=><Pill key={c} label={c} selected={ct.confluence?.includes(c)} onClick={()=>tog("confluence",c)} color={cy}/>)}</div>
            <div style={{marginTop:8}}><input value={ct.confluenceOther||""} onChange={e=>up("confluenceOther",e.target.value)} placeholder="Other confluence..." style={{...iS,fontSize:11}}/></div>
            <div style={{marginTop:10,fontSize:11,fontWeight:600,color:(ct.confluence?.length||0)>=3?g:(ct.confluence?.length||0)>=1?y:r,padding:"6px 10px",borderRadius:6,background:`${(ct.confluence?.length||0)>=3?g:(ct.confluence?.length||0)>=1?y:r}10`,border:`1px solid ${(ct.confluence?.length||0)>=3?g:(ct.confluence?.length||0)>=1?y:r}25`,display:"inline-block"}}>{ct.confluence?.length||0} factor{(ct.confluence?.length||0)!==1?"s":""}{(ct.confluence?.length||0)===0?" — no confluence":""}{(ct.confluence?.length||0)>=1&&(ct.confluence?.length||0)<3?" — low confluence":""}{(ct.confluence?.length||0)>=3?" — strong confluence":""}</div>
          </Sec>
          <Sec title="Execution">
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>
              <Fld label="Conviction"><div style={{display:"flex",gap:4}}>{["LOW","MED","HIGH"].map(c=><Pill key={c} label={c} selected={ct.conviction===c} onClick={()=>up("conviction",c)} color={c==="HIGH"?g:c==="MED"?y:r}/>)}</div></Fld>
              <Fld label="Entry Type"><div style={{display:"flex",gap:4}}>{["Aggressive","Conservative"].map(t=><Pill key={t} label={t} selected={ct.entryType===t} onClick={()=>up("entryType",t)}/>)}</div></Fld>
            </div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr 1fr 1fr 1fr",gap:10}}>
              {[{k:"entry",l:"Entry",p:"Entry price"},{k:"stop",l:"Stop",p:"SL price"},{k:"tp1",l:"TP1",p:"Target 1"},{k:"tp2",l:"TP2",p:"Target 2"},{k:"posSize",l:"Size",p:"1%"},{k:"leverage",l:"Leverage",p:"10x"}].map(f=><Fld key={f.k} label={f.l}><input value={ct[f.k]} onChange={e=>up(f.k,e.target.value)} placeholder={f.p} style={iS}/></Fld>)}
            </div>
            {ct.entry&&ct.stop&&ct.tp1&&<div style={{fontSize:12,color:g,fontWeight:700,marginTop:4,padding:"6px 10px",background:`${g}10`,border:`1px solid ${g}25`,borderRadius:6,display:"inline-block"}}>R:R → {calcRR(ct)}:1</div>}
          </Sec>
          <Sec title="Result" accent={y}>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr 1fr",gap:12}}>
              <Fld label="Outcome"><div style={{display:"flex",gap:6}}>{["WIN","LOSS","BE"].map(x=><button key={x} onClick={()=>up("result",x)} style={{flex:1,padding:"10px 0",borderRadius:8,border:`1px solid ${ct.result===x?(x==="WIN"?g:x==="LOSS"?r:y):b2}`,background:ct.result===x?(x==="WIN"?`${g}20`:x==="LOSS"?`${r}20`:`${y}20`):bg,color:ct.result===x?(x==="WIN"?g:x==="LOSS"?r:y):gr,fontFamily:F,fontSize:11,fontWeight:700,cursor:"pointer",transition:"all 0.15s"}}>{x}</button>)}</div></Fld>
              <Fld label={`P&L % ${ct.result==="LOSS"?"(auto -)":ct.result==="WIN"?"(auto +)":""}`}><input value={ct.pnl} onChange={e=>up("pnl",e.target.value)} placeholder="3.34" style={iS}/></Fld>
              <Fld label="P&L $"><input value={ct.pnlDollar} onChange={e=>up("pnlDollar",e.target.value)} placeholder="150" style={iS}/></Fld>
              <Fld label="Close Price"><input value={ct.closePrice||""} onChange={e=>up("closePrice",e.target.value)} placeholder="Close price" style={iS}/></Fld>
            </div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:12}}>
              <Fld label="TP Hits"><div style={{display:"flex",gap:8}}>{[{k:"hitTp1",l:"TP1"},{k:"hitTp2",l:"TP2"}].map(tp=><button key={tp.k} onClick={()=>up(tp.k,!ct[tp.k])} style={{padding:"8px 14px",borderRadius:8,border:`1px solid ${ct[tp.k]?g:b2}`,background:ct[tp.k]?`${g}15`:bg,color:ct[tp.k]?g:gr,fontSize:11,fontFamily:F,fontWeight:600,cursor:"pointer"}}>{ct[tp.k]?"✓":"○"} {tp.l}</button>)}</div></Fld>
              <Fld label="Rules Followed"><div style={{display:"flex",gap:6}}>{["YES","NO"].map(x=><Pill key={x} label={x} selected={ct.followedRules===x} onClick={()=>up("followedRules",x)} color={x==="YES"?g:r}/>)}</div></Fld>
              <Fld label="Trade % (no leverage)"><div style={{...iS,background:bg3,cursor:"default",color:ct.entry&&ct.closePrice?(parseFloat(calcTP(ct))>=0?g:r):gd}}>{ct.entry&&ct.closePrice?`${calcTP(ct)}%`:"Auto from entry/close"}</div></Fld>
            </div>
          </Sec>
          <Sec title="Journal" accent={w}>
            <Fld label="What confirmed the setup?"><textarea value={ct.confirmed||""} onChange={e=>up("confirmed",e.target.value)} rows={2} placeholder="What trapped traders? What did orderflow show?" style={{...iS,resize:"vertical"}}/></Fld>
            <Fld label="Mistakes or rules broken"><textarea value={ct.mistakes||""} onChange={e=>up("mistakes",e.target.value)} rows={2} placeholder="FOMO? Entered too early? Didn't wait for confirmation?" style={{...iS,resize:"vertical"}}/></Fld>
            <Fld label="What would I do differently?"><textarea value={ct.different||""} onChange={e=>up("different",e.target.value)} rows={2} placeholder="e.g. Wait for backtest, take partials at TP1" style={{...iS,resize:"vertical"}}/></Fld>
            <Fld label="Notes"><textarea value={ct.notes||""} onChange={e=>up("notes",e.target.value)} rows={2} placeholder="Market context, mindset..." style={{...iS,resize:"vertical"}}/></Fld>
          </Sec>
          <Sec title="Screenshots" accent={gr}>
            <input ref={fRef} type="file" multiple accept="image/*" onChange={e=>{Array.from(e.target.files).forEach(f=>{const rd=new FileReader();rd.onload=ev=>{setCt(p=>({...p,screenshots:[...p.screenshots,ev.target.result]}));setSsFiles(p=>[...p,f]);};rd.readAsDataURL(f);});}} style={{display:"none"}}/>
            <button onClick={()=>fRef.current?.click()} style={{width:"100%",padding:14,background:bg,border:`1px dashed ${b2}`,borderRadius:10,color:gr,fontSize:12,fontFamily:F,cursor:"pointer",transition:"all 0.15s"}}>+ Add Screenshots</button>
            {ct.screenshots?.length>0&&<div style={{display:"flex",gap:8,marginTop:10,flexWrap:"wrap"}}>{ct.screenshots.map((s,i)=><div key={i} style={{position:"relative"}}><img src={s} alt="" style={{width:80,height:60,objectFit:"cover",borderRadius:6,border:`1px solid ${b1}`}}/><button onClick={()=>{setCt(p=>({...p,screenshots:p.screenshots.filter((_,j)=>j!==i)}));setSsFiles(p=>p.filter((_,j)=>j!==i));}} style={{position:"absolute",top:-6,right:-6,width:18,height:18,borderRadius:"50%",background:r,border:"none",color:w,fontSize:10,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center"}}>×</button></div>)}</div>}
          </Sec>
          <button onClick={submit} disabled={!ct.date||!ct.direction||!ct.keyLevel||saving} style={{width:"100%",padding:16,marginTop:8,border:"none",borderRadius:12,fontSize:12,fontWeight:700,fontFamily:F,textTransform:"uppercase",letterSpacing:"0.08em",cursor:saving?"not-allowed":"pointer",background:saving||!ct.date||!ct.direction||!ct.keyLevel?bg3:`linear-gradient(135deg,${g},${cy})`,color:saving||!ct.date||!ct.direction||!ct.keyLevel?gd:bg,transition:"all 0.2s",boxShadow:saving||!ct.date||!ct.direction||!ct.keyLevel?"none":`0 4px 20px ${g}30`}}>{saving?"SAVING...":editingId?"UPDATE TRADE":"LOG TRADE"}</button>
          {editingId&&<button onClick={()=>{setEditingId(null);setCt({...defaultTrade});setSsFiles([]);}} style={{width:"100%",padding:10,marginTop:6,background:"transparent",color:gr,border:`1px solid ${b1}`,borderRadius:8,fontSize:11,fontFamily:F,cursor:"pointer"}}>CANCEL EDIT</button>}
        </div>)}

        {/* ════════════ P&L ════════════ */}
        {view==="pnl"&&(<div className="fi">
          {/* monthly header */}
          <div style={{background:`linear-gradient(135deg,${bg2} 0%,${bg2}80 100%)`,border:`1px solid ${b1}`,borderRadius:16,padding:"24px 26px",marginBottom:12}}>
            <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:18}}>
              <button onClick={()=>setCalMonth(new Date(yr,mo-1,1))} style={{width:30,height:30,borderRadius:8,background:bg,border:`1px solid ${b1}`,color:gr,cursor:"pointer",fontSize:14,display:"flex",alignItems:"center",justifyContent:"center",fontFamily:F,transition:"all 0.15s"}}>‹</button>
              <span style={{fontSize:15,fontWeight:700,fontFamily:FD,letterSpacing:"0.01em"}}>{mn[mo]} {yr}</span>
              <button onClick={()=>setCalMonth(new Date(yr,mo+1,1))} style={{width:30,height:30,borderRadius:8,background:bg,border:`1px solid ${b1}`,color:gr,cursor:"pointer",fontSize:14,display:"flex",alignItems:"center",justifyContent:"center",fontFamily:F,transition:"all 0.15s"}}>›</button>
            </div>
            {/* primary monthly P&L */}
            <div style={{fontSize:9,color:gr,textTransform:"uppercase",letterSpacing:"0.12em",fontFamily:F,fontWeight:600,marginBottom:6}}>Monthly P&L</div>
            <div style={{display:"flex",alignItems:"baseline",gap:12,marginBottom:14,flexWrap:"wrap"}}>
              <span style={{fontSize:42,fontWeight:800,color:mp>=0?g:r,fontFamily:F,letterSpacing:"-0.035em",lineHeight:1}}>{mp>=0?"+":""}{mp.toFixed(2)}%</span>
              {md!==0&&<span style={{fontSize:18,fontWeight:700,color:mp>=0?g:r,opacity:0.7,fontFamily:F,letterSpacing:"-0.02em"}}>{md>=0?"+":"-"}${Math.abs(md).toFixed(0)}</span>}
            </div>
            {/* Trade P&L % at same visual weight */}
            {mtp!==0&&<div style={{marginBottom:14,paddingTop:12,borderTop:`1px solid ${b1}`}}>
              <div style={{fontSize:9,color:gr,textTransform:"uppercase",letterSpacing:"0.12em",fontFamily:F,fontWeight:600,marginBottom:4}}>Trade P&L % <span style={{color:gd,letterSpacing:"0.04em",textTransform:"none"}}>· pre-leverage</span></div>
              <span style={{fontSize:22,fontWeight:700,color:mtp>=0?g:r,fontFamily:F,letterSpacing:"-0.02em"}}>{mtp>=0?"+":""}{mtp.toFixed(2)}%</span>
            </div>}
            <div style={{display:"flex",gap:22,paddingTop:12,borderTop:`1px solid ${b1}`}}>
              {[{l:"Trades",v:mt},{l:"Green Days",v:mw,c:g},{l:"Red Days",v:ml,c:r}].map(x=><div key={x.l}><div style={{fontSize:9,color:gr,textTransform:"uppercase",letterSpacing:"0.1em",fontFamily:F,fontWeight:600,marginBottom:3}}>{x.l}</div><div style={{fontSize:15,fontWeight:700,color:x.c||w,fontFamily:F,letterSpacing:"-0.01em"}}>{x.v}</div></div>)}
            </div>
          </div>
          {/* calendar */}
          <div style={{background:bg2,border:`1px solid ${b1}`,borderRadius:14,padding:"14px",marginBottom:12}}>
            <div style={{display:"grid",gridTemplateColumns:"repeat(7,1fr)",gap:2,marginBottom:4}}>{["Su","Mo","Tu","We","Th","Fr","Sa"].map(d=><div key={d} style={{textAlign:"center",fontSize:9,fontWeight:600,color:gr,padding:"3px 0",fontFamily:F}}>{d}</div>)}</div>
            <div style={{display:"grid",gridTemplateColumns:"repeat(7,1fr)",gap:2}}>
              {Array(fdw).fill(null).map((_,i)=><div key={`e${i}`}/>)}
              {Array.from({length:dim},(_,i)=>i+1).map(day=>{
                const ds=`${yr}-${String(mo+1).padStart(2,"0")}-${String(day).padStart(2,"0")}`;
                const dp=pbd[ds],dd=dbd[ds],dc=tbd[ds],hd=dp!==undefined,ip=hd&&dp>0,iN=hd&&dp<0,iS2=selDay===ds,iT=td2.getFullYear()===yr&&td2.getMonth()===mo&&td2.getDate()===day;
                return(<button key={ds} onClick={()=>hd&&setSelDay(iS2?null:ds)} style={{minHeight:64,borderRadius:8,padding:"5px 4px",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"flex-start",gap:1,cursor:hd?"pointer":"default",background:iS2?`${ip?g:r}20`:ip?`${g}08`:iN?`${r}08`:bg,border:`1px solid ${iS2?(ip?g:r):ip?`${g}20`:iN?`${r}20`:b1}`,fontFamily:F,transition:"all 0.1s"}}>
                  <div style={{fontSize:9,color:iT?cy:gr,fontWeight:iT?700:400,alignSelf:"flex-start"}}>{iT?<span style={{background:cy,color:bg,borderRadius:"50%",width:16,height:16,display:"inline-flex",alignItems:"center",justifyContent:"center",fontSize:8,fontWeight:700}}>{day}</span>:day}</div>
                  {hd&&<><div style={{fontSize:10,fontWeight:700,color:ip?g:iN?r:y,marginTop:1}}>{ip?"+":""}{dp.toFixed(1)}%</div>{dd!==undefined&&dd!==0&&<div style={{fontSize:8,color:ip?g:r,opacity:0.7}}>{dd>=0?"+":"-"}${Math.abs(dd).toFixed(0)}</div>}<div style={{fontSize:8,color:gr}}>{dc} trade{dc!==1?"s":""}</div></>}
                </button>);
              })}
            </div>
          </div>
          {selDay&&tlbd[selDay]&&<div className="fi" style={{marginBottom:12}}>
            <div style={{fontSize:10,color:gr,fontFamily:F,textTransform:"uppercase",letterSpacing:"0.1em",fontWeight:600,marginBottom:8}}>{selDay}</div>
            {tlbd[selDay].map(t=>{
              const rMult = calcRMultiple(t);
              return(
              <div key={t.id} style={{...cS,padding:"14px 16px",marginBottom:8}}>
                {/* header row */}
                <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:14,paddingBottom:12,borderBottom:`1px solid ${b1}`}}>
                  <div style={{width:8,height:8,borderRadius:"50%",background:t.result==="WIN"?g:t.result==="LOSS"?r:y,flexShrink:0,boxShadow:`0 0 6px ${t.result==="WIN"?g:t.result==="LOSS"?r:y}60`}}/>
                  <div style={{flex:1,minWidth:0}}>
                    <span style={{fontSize:12,fontWeight:600}}>{t.pair}</span>
                    <span style={{fontSize:10,color:gr,marginLeft:8}}>{t.direction}</span>
                    {t.setup&&<span style={{fontSize:9,color:gd,marginLeft:8}}>{setupOptions.find(s=>s.id===t.setup)?.label}</span>}
                  </div>
                  {rMult!==null&&<span style={{fontSize:10,fontWeight:700,color:rMult>=0?g:r,fontFamily:F,padding:"3px 7px",borderRadius:5,background:rMult>=0?`${g}10`:`${r}10`,border:`1px solid ${rMult>=0?g:r}25`}}>{rMult>=0?"+":""}{rMult.toFixed(1)}R</span>}
                  {t.pnl&&<span style={{fontSize:13,fontWeight:700,color:parseFloat(t.pnl)>=0?g:r}}>{parseFloat(t.pnl)>=0?"+":""}{t.pnl}%</span>}
                </div>
                {/* details */}
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr 1fr",gap:10,marginBottom:10}}>{[{l:"Entry",v:t.entry},{l:"Stop",v:t.stop},{l:"TP1",v:t.tp1},{l:"Close",v:t.closePrice}].map(x=><div key={x.l}><div style={{fontSize:9,color:gr,fontFamily:F}}>{x.l}</div><div style={{fontSize:11,fontWeight:600}}>{x.v||"—"}</div></div>)}</div>
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr 1fr",gap:10,marginBottom:10}}>{[{l:"R:R",v:t.rr?`${t.rr}:1`:"—",c:g},{l:"Leverage",v:t.leverage||"—"},{l:"Trade %",v:t.tradePercent?`${t.tradePercent}%`:"—"},{l:"TP Hits",v:`${t.hitTp1?"TP1✓ ":""}${t.hitTp2?"TP2✓":""}`||"—"}].map(x=><div key={x.l}><div style={{fontSize:9,color:gr,fontFamily:F}}>{x.l}</div><div style={{fontSize:11,fontWeight:600,color:x.c||w}}>{x.v}</div></div>)}</div>
                {t.keyLevel&&<div style={{marginBottom:6,fontSize:10}}><span style={{color:gr}}>Key Level: </span><span style={{color:w}}>{t.keyLevel}</span></div>}
                {t.levelType?.length>0&&<div style={{marginBottom:6,fontSize:10}}><span style={{color:gr}}>Levels: </span><span style={{color:bl}}>{t.levelType.join(" · ")}</span></div>}
                {t.confluence?.length>0&&<div style={{marginBottom:6,fontSize:10}}><span style={{color:gr}}>Confluence: </span><span style={{color:cy}}>{t.confluence.join(" · ")}</span></div>}
                {t.confirmed&&<div style={{marginBottom:5,fontSize:10}}><span style={{color:gr}}>Confirmation: </span>{t.confirmed}</div>}
                {t.mistakes&&<div style={{marginBottom:5,fontSize:10}}><span style={{color:gr}}>Mistakes: </span><span style={{color:r}}>{t.mistakes}</span></div>}
                {t.different&&<div style={{marginBottom:5,fontSize:10}}><span style={{color:gr}}>Do Different: </span><span style={{color:y}}>{t.different}</span></div>}
                {t.notes&&<div style={{marginBottom:5,fontSize:10}}><span style={{color:gr}}>Notes: </span>{t.notes}</div>}
                {/* bigger clickable screenshots */}
                {t.screenshots?.length>0&&<div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill, minmax(240px, 1fr))",gap:10,marginTop:14}}>{t.screenshots.map((s,i)=><img key={i} src={s} alt="" onClick={()=>setLightbox(s)} style={{width:"100%",height:180,objectFit:"cover",borderRadius:8,border:`1px solid ${b1}`,cursor:"zoom-in",transition:"border-color 0.15s"}} onMouseEnter={e=>e.currentTarget.style.borderColor=bl} onMouseLeave={e=>e.currentTarget.style.borderColor=b1}/>)}</div>}
                <div style={{display:"flex",gap:8,marginTop:14}}>
                  <button onClick={()=>{setCt({...defaultTrade,...t});setEditingId(t.id);setSsFiles([]);setView("log");}} style={{padding:"6px 14px",borderRadius:6,background:`${bl}12`,border:`1px solid ${bl}25`,color:bl,fontSize:10,fontFamily:F,fontWeight:600,cursor:"pointer"}}>Edit</button>
                  <button onClick={()=>{if(confirm("Delete this trade?"))del(t.id);}} style={{padding:"6px 14px",borderRadius:6,background:`${r}10`,border:`1px solid ${r}20`,color:r,fontSize:10,fontFamily:F,fontWeight:600,cursor:"pointer"}}>Delete</button>
                </div>
              </div>
            );})}
          </div>}
          <div style={cS}>
            <div style={{fontSize:9,color:gr,textTransform:"uppercase",letterSpacing:"0.1em",fontFamily:F,fontWeight:600,marginBottom:12,display:"flex",justifyContent:"space-between"}}>
              <span>Equity Curve</span>
              <span style={{color:gr}}>Max DD: <span style={{color:r,fontWeight:700}}>-{maxDD}%</span></span>
            </div>
            <EQ trades={trades}/>
          </div>
          {/* underwater drawdown */}
          <div style={cS}>
            <div style={{fontSize:9,color:gr,textTransform:"uppercase",letterSpacing:"0.1em",fontFamily:F,fontWeight:600,marginBottom:12}}>Underwater Curve · distance from peak</div>
            <UnderwaterChart trades={trades}/>
          </div>
        </div>)}

        {/* ════════════ HISTORY ════════════ */}
        {view==="history"&&(<div className="fi">
          <div style={{display:"flex",gap:6,marginBottom:14,flexWrap:"wrap"}}>{["ALL","WIN","LOSS","BE"].map(f=><Pill key={f} label={f} selected={filterR===f} onClick={()=>setFilterR(f)} color={f==="WIN"?g:f==="LOSS"?r:f==="BE"?y:w}/>)}</div>
          {trades.filter(t=>filterR==="ALL"||t.result===filterR).map(t=>{
            const rMult = calcRMultiple(t);
            return(
            <div key={t.id} className="trade-row" style={{...cS,padding:"12px 14px",cursor:"pointer",transition:"all 0.12s",marginBottom:6}} onClick={()=>setExpTrade(expTrade===t.id?null:t.id)}>
              <div style={{display:"flex",alignItems:"center",gap:10}}>
                <div style={{width:6,height:6,borderRadius:"50%",background:t.result==="WIN"?g:t.result==="LOSS"?r:y,flexShrink:0,boxShadow:`0 0 6px ${t.result==="WIN"?g:t.result==="LOSS"?r:y}60`}}/>
                <div style={{flex:1,minWidth:0}}>
                  <span style={{fontSize:11,fontWeight:600}}>{t.date}</span>
                  <span style={{fontSize:10,color:gr,marginLeft:8}}>{t.direction} {t.pair}</span>
                  {t.setup&&<span style={{fontSize:9,color:gd,marginLeft:8}}>{setupOptions.find(s=>s.id===t.setup)?.label}</span>}
                </div>
                {rMult!==null&&<span style={{fontSize:10,fontWeight:700,color:rMult>=0?g:r,fontFamily:F,padding:"3px 7px",borderRadius:5,background:rMult>=0?`${g}10`:`${r}10`,border:`1px solid ${rMult>=0?g:r}25`}}>{rMult>=0?"+":""}{rMult.toFixed(1)}R</span>}
                {t.pnl&&<span style={{fontSize:12,fontWeight:700,color:parseFloat(t.pnl)>=0?g:r}}>{parseFloat(t.pnl)>=0?"+":""}{t.pnl}%</span>}
                <span style={{color:gd,fontSize:10}}>{expTrade===t.id?"▲":"▼"}</span>
              </div>
              {expTrade===t.id&&<div style={{marginTop:14,paddingTop:14,borderTop:`1px solid ${b1}`}} className="fi">
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr 1fr",gap:10,marginBottom:10}}>{[{l:"Entry",v:t.entry},{l:"Stop",v:t.stop},{l:"TP1",v:t.tp1},{l:"Close",v:t.closePrice}].map(x=><div key={x.l}><div style={{fontSize:9,color:gr,fontFamily:F}}>{x.l}</div><div style={{fontSize:11,fontWeight:600}}>{x.v||"—"}</div></div>)}</div>
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr 1fr",gap:10,marginBottom:10}}>{[{l:"R:R",v:t.rr?`${t.rr}:1`:"—",c:g},{l:"Leverage",v:t.leverage||"—"},{l:"Trade %",v:t.tradePercent?`${t.tradePercent}%`:"—"},{l:"TP Hits",v:`${t.hitTp1?"TP1✓ ":""}${t.hitTp2?"TP2✓":""}`||"—"}].map(x=><div key={x.l}><div style={{fontSize:9,color:gr,fontFamily:F}}>{x.l}</div><div style={{fontSize:11,fontWeight:600,color:x.c||w}}>{x.v}</div></div>)}</div>
                {t.levelType?.length>0&&<div style={{marginBottom:6,fontSize:10}}><span style={{color:gr}}>Levels: </span><span style={{color:bl}}>{t.levelType.join(" · ")}</span></div>}
                {t.confluence?.length>0&&<div style={{marginBottom:6,fontSize:10}}><span style={{color:gr}}>Confluence: </span><span style={{color:cy}}>{t.confluence.join(" · ")}</span></div>}
                {t.confirmed&&<div style={{marginBottom:5,fontSize:10}}><span style={{color:gr}}>Confirmation: </span>{t.confirmed}</div>}
                {t.mistakes&&<div style={{marginBottom:5,fontSize:10}}><span style={{color:gr}}>Mistakes: </span><span style={{color:r}}>{t.mistakes}</span></div>}
                {t.notes&&<div style={{marginBottom:5,fontSize:10}}><span style={{color:gr}}>Notes: </span>{t.notes}</div>}
                {t.screenshots?.length>0&&<div style={{display:"flex",gap:6,marginTop:8,flexWrap:"wrap"}}>{t.screenshots.map((s,i)=><img key={i} src={s} alt="" onClick={e=>{e.stopPropagation();setLightbox(s);}} style={{width:100,height:70,objectFit:"cover",borderRadius:6,border:`1px solid ${b1}`,cursor:"zoom-in"}}/>)}</div>}
                <div style={{display:"flex",gap:8,marginTop:12}}>
                  <button onClick={e=>{e.stopPropagation();setCt({...defaultTrade,...t});setEditingId(t.id);setSsFiles([]);setView("log");}} style={{padding:"6px 14px",borderRadius:6,background:`${bl}12`,border:`1px solid ${bl}25`,color:bl,fontSize:10,fontFamily:F,fontWeight:600,cursor:"pointer"}}>Edit</button>
                  <button onClick={e=>{e.stopPropagation();if(confirm("Delete this trade?"))del(t.id);}} style={{padding:"6px 14px",borderRadius:6,background:`${r}10`,border:`1px solid ${r}20`,color:r,fontSize:10,fontFamily:F,fontWeight:600,cursor:"pointer"}}>Delete</button>
                </div>
              </div>}
            </div>
          );})}
        </div>)}

        {/* ════════════ STATS ════════════ */}
        {view==="stats"&&(()=>{const fl=gf(sFilter),s=cs(fl);return(<div className="fi">
          <div style={{display:"flex",gap:4,marginBottom:14,flexWrap:"wrap"}}>
            <Pill label="All" selected={sFilter==="all"} onClick={()=>setSFilter("all")} color={w}/>
            {setupOptions.map(o=><Pill key={o.id} label={o.label} selected={sFilter===`setup_${o.id}`} onClick={()=>setSFilter(`setup_${o.id}`)} color={o.color}/>)}
            {regimeOptions.slice(0,4).map(o=><Pill key={o.id} label={o.label} selected={sFilter===`regime_${o.id}`} onClick={()=>setSFilter(`regime_${o.id}`)} color={o.color}/>)}
          </div>
          {/* core edge metrics */}
          <div style={{display:"flex",gap:8,flexWrap:"wrap",marginBottom:8}}>
            <StatCard label="Trades" value={s.total}/>
            <StatCard label="Win Rate" value={`${s.winRate}%`} color={parseFloat(s.winRate)>=50?g:r} accent={parseFloat(s.winRate)>=50?g:r}/>
            <StatCard label="Profit Factor" value={s.profitFactor} color={parseFloat(s.profitFactor)>=1.5?g:parseFloat(s.profitFactor)>=1?y:r} accent={parseFloat(s.profitFactor)>=1.5?g:parseFloat(s.profitFactor)>=1?y:r} tooltip="Gross winning P&L / Gross losing P&L"/>
            <StatCard label="Expectancy" value={`${parseFloat(s.expectancy)>=0?"+":""}${s.expectancy}%`} color={parseFloat(s.expectancy)>=0?g:r} accent={bl} tooltip="Avg expected P&L per trade"/>
          </div>
          {/* win/loss shape */}
          <div style={{display:"flex",gap:8,flexWrap:"wrap",marginBottom:8}}>
            <StatCard label="Avg Win" value={`+${s.avgWin}%`} color={g}/>
            <StatCard label="Avg Loss" value={`-${s.avgLoss}%`} color={r}/>
            <StatCard label="Payoff" value={s.payoff!=="—"?`${s.payoff}:1`:"—"} color={parseFloat(s.payoff)>=2?g:parseFloat(s.payoff)>=1?y:r} accent={pu} tooltip="Avg win / Avg loss"/>
            <StatCard label="Avg R:R" value={`${s.avgRR}:1`} color={g} accent={bl}/>
          </div>
          {/* outcome counts */}
          <div style={{display:"flex",gap:8,flexWrap:"wrap",marginBottom:8}}>
            <StatCard label="Wins" value={s.wins} color={g}/>
            <StatCard label="Losses" value={s.losses} color={r}/>
            <StatCard label="BE" value={s.be} color={y}/>
            <StatCard label="Rules %" value={`${s.rulesRate}%`} color={parseFloat(s.rulesRate)>=80?g:y} accent={parseFloat(s.rulesRate)>=80?g:y}/>
          </div>
          {/* totals */}
          <div style={{display:"flex",gap:8,flexWrap:"wrap",marginBottom:8}}>
            <StatCard label="P&L %" value={`${parseFloat(s.totalPnl)>=0?"+":""}${s.totalPnl}%`} color={parseFloat(s.totalPnl)>=0?g:r} accent={parseFloat(s.totalPnl)>=0?g:r}/>
            <StatCard label="P&L $" value={parseFloat(s.totalDollar)!==0?`${parseFloat(s.totalDollar)>=0?"+":""}$${Math.abs(parseFloat(s.totalDollar)).toFixed(0)}`:"—"} color={parseFloat(s.totalDollar)>=0?g:r}/>
            <StatCard label="Trade P&L %" value={`${parseFloat(s.totalTradePercent)>=0?"+":""}${s.totalTradePercent}%`} sub="pre-leverage" color={parseFloat(s.totalTradePercent)>=0?g:r}/>
            <StatCard label="Max DD" value={`-${maxDD}%`} color={parseFloat(maxDD)<10?g:parseFloat(maxDD)<20?y:r} accent={r}/>
          </div>
          {/* extremes */}
          <div style={{display:"flex",gap:8,flexWrap:"wrap",marginBottom:12}}>
            <StatCard label="Best Trade" value={`+${s.bestTrade}%`} color={g}/>
            <StatCard label="Worst Trade" value={`${s.worstTrade}%`} color={r}/>
          </div>

          {/* top performers — most profitable setup & regime */}
          {(topSetup||topRegime)&&<div style={{display:"flex",gap:8,marginBottom:12,flexWrap:"wrap"}}>
            {topSetup&&<div style={{flex:1,minWidth:200,background:`linear-gradient(180deg,${bg2} 0%,${bg2}cc 100%)`,border:`1px solid ${b1}`,borderRadius:12,padding:"16px 18px",position:"relative",overflow:"hidden"}} className="stat-card">
              <div style={{position:"absolute",top:0,left:0,right:0,height:2,background:`linear-gradient(90deg,${topSetup.color},${topSetup.color}66)`,borderRadius:"12px 12px 0 0"}}/>
              <div style={{fontSize:9,color:gr,textTransform:"uppercase",letterSpacing:"0.1em",fontFamily:F,fontWeight:600,marginBottom:6}}>Most Profitable Setup</div>
              <div style={{fontSize:15,fontWeight:700,color:topSetup.color,fontFamily:F,letterSpacing:"-0.01em",marginBottom:6}}>{topSetup.label}</div>
              <div style={{display:"flex",gap:14,fontSize:10,fontFamily:F}}>
                <span><span style={{color:gr}}>P&L </span><span style={{color:topSetup.pnl>=0?g:r,fontWeight:700}}>{topSetup.pnl>=0?"+":""}{topSetup.pnl.toFixed(2)}%</span></span>
                <span><span style={{color:gr}}>Win </span><span style={{color:topSetup.winRate>=50?g:r,fontWeight:700}}>{topSetup.winRate.toFixed(0)}%</span></span>
                <span><span style={{color:gr}}>{topSetup.count} trades</span></span>
              </div>
            </div>}
            {topRegime&&<div style={{flex:1,minWidth:200,background:`linear-gradient(180deg,${bg2} 0%,${bg2}cc 100%)`,border:`1px solid ${b1}`,borderRadius:12,padding:"16px 18px",position:"relative",overflow:"hidden"}} className="stat-card">
              <div style={{position:"absolute",top:0,left:0,right:0,height:2,background:`linear-gradient(90deg,${topRegime.color},${topRegime.color}66)`,borderRadius:"12px 12px 0 0"}}/>
              <div style={{fontSize:9,color:gr,textTransform:"uppercase",letterSpacing:"0.1em",fontFamily:F,fontWeight:600,marginBottom:6}}>Most Profitable Regime</div>
              <div style={{fontSize:15,fontWeight:700,color:topRegime.color,fontFamily:F,letterSpacing:"-0.01em",marginBottom:6}}>{topRegime.label}</div>
              <div style={{display:"flex",gap:14,fontSize:10,fontFamily:F}}>
                <span><span style={{color:gr}}>P&L </span><span style={{color:topRegime.pnl>=0?g:r,fontWeight:700}}>{topRegime.pnl>=0?"+":""}{topRegime.pnl.toFixed(2)}%</span></span>
                <span><span style={{color:gr}}>Win </span><span style={{color:topRegime.winRate>=50?g:r,fontWeight:700}}>{topRegime.winRate.toFixed(0)}%</span></span>
                <span><span style={{color:gr}}>{topRegime.count} trades</span></span>
              </div>
            </div>}
          </div>}

          {/* R-multiple distribution histogram */}
          <div style={cS}>
            <div style={{fontSize:9,color:gr,textTransform:"uppercase",letterSpacing:"0.1em",fontFamily:F,fontWeight:600,marginBottom:12}}>R-Multiple Distribution</div>
            <RDistribution trades={fl}/>
          </div>

          {/* day of week breakdown */}
          <div style={cS}>
            <div style={{fontSize:9,color:gr,textTransform:"uppercase",letterSpacing:"0.1em",fontFamily:F,fontWeight:600,marginBottom:12}}>Day of Week · win rate & P&L</div>
            {dow.map(d=>{const wr=d.total?((d.wins/d.total)*100).toFixed(0):"0";return(
              <div key={d.day} style={{display:"flex",alignItems:"center",gap:10,padding:"8px 0",borderBottom:`1px solid ${b1}`}}>
                <div style={{width:32,fontSize:11,fontWeight:600,color:w,fontFamily:F}}>{d.day}</div>
                <div style={{flex:1,height:5,background:bg,borderRadius:3,overflow:"hidden",position:"relative"}}>
                  {d.total>0&&<div style={{height:"100%",width:`${wr}%`,background:`linear-gradient(90deg,${parseFloat(wr)>=50?g:r},${parseFloat(wr)>=50?cy:y})`,borderRadius:3,transition:"width 0.4s"}}/>}
                </div>
                <div style={{fontSize:10,color:gr,minWidth:36,textAlign:"right",fontFamily:F}}>{d.total}t</div>
                <div style={{fontSize:10,color:parseFloat(wr)>=50?g:r,fontWeight:700,minWidth:42,textAlign:"right",fontFamily:F}}>{wr}%</div>
                <div style={{fontSize:10,color:d.pnl>=0?g:r,fontWeight:700,minWidth:54,textAlign:"right",fontFamily:F}}>{d.pnl>=0?"+":""}{d.pnl.toFixed(1)}%</div>
              </div>
            );})}
          </div>

          <div style={cS}>
            <div style={{fontSize:9,color:gr,textTransform:"uppercase",letterSpacing:"0.1em",fontFamily:F,fontWeight:600,marginBottom:12}}>By Setup</div>
            {setupOptions.map(o=>{const st=cs(trades.filter(t=>t.result&&t.setup===o.id));if(!st.total)return null;return(<div key={o.id} style={{display:"flex",alignItems:"center",gap:10,padding:"9px 0",borderBottom:`1px solid ${b1}`}}><div style={{width:2,height:20,background:o.color,borderRadius:2}}/><div style={{flex:1,fontSize:11,fontWeight:700,color:o.color,fontFamily:F}}>{o.label}</div><div style={{fontSize:10,color:gr}}>{st.total}t</div><div style={{fontSize:10,color:parseFloat(st.winRate)>=50?g:r,fontWeight:700,minWidth:42}}>{st.winRate}%</div><div style={{fontSize:10,color:parseFloat(st.profitFactor)>=1.5?g:parseFloat(st.profitFactor)>=1?y:r,fontWeight:700,minWidth:42}}>{st.profitFactor}PF</div><div style={{fontSize:10,color:parseFloat(st.totalPnl)>=0?g:r,fontWeight:700,minWidth:52}}>{parseFloat(st.totalPnl)>=0?"+":""}{st.totalPnl}%</div></div>);})}
          </div>
          <div style={cS}>
            <div style={{fontSize:9,color:gr,textTransform:"uppercase",letterSpacing:"0.1em",fontFamily:F,fontWeight:600,marginBottom:12}}>By Regime</div>
            {regimeOptions.map(o=>{const rt=cs(trades.filter(t=>t.result&&t.regime===o.id));if(!rt.total)return null;return(<div key={o.id} style={{display:"flex",alignItems:"center",gap:10,padding:"9px 0",borderBottom:`1px solid ${b1}`}}><div style={{width:2,height:20,background:o.color,borderRadius:2}}/><div style={{flex:1,fontSize:11,fontWeight:700,color:o.color,fontFamily:F}}>{o.label}</div><div style={{fontSize:10,color:gr}}>{rt.total}t</div><div style={{fontSize:10,color:parseFloat(rt.winRate)>=50?g:r,fontWeight:700,minWidth:42}}>{rt.winRate}%</div><div style={{fontSize:10,color:parseFloat(rt.profitFactor)>=1.5?g:parseFloat(rt.profitFactor)>=1?y:r,fontWeight:700,minWidth:42}}>{rt.profitFactor}PF</div><div style={{fontSize:10,color:parseFloat(rt.totalPnl)>=0?g:r,fontWeight:700,minWidth:52}}>{parseFloat(rt.totalPnl)>=0?"+":""}{rt.totalPnl}%</div></div>);})}
          </div>
        </div>);})()}

      </div>
      {/* screenshot lightbox */}
      {lightbox&&<div onClick={()=>setLightbox(null)} style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.92)",zIndex:9999,display:"flex",alignItems:"center",justifyContent:"center",padding:24,cursor:"zoom-out",animation:"fadeIn 0.15s ease"}}>
        <button onClick={e=>{e.stopPropagation();setLightbox(null);}} style={{position:"absolute",top:18,right:18,width:38,height:38,borderRadius:"50%",background:"rgba(255,255,255,0.08)",border:`1px solid ${b2}`,color:w,fontSize:18,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",fontFamily:F}}>×</button>
        <img src={lightbox} alt="" onClick={e=>e.stopPropagation()} style={{maxWidth:"95vw",maxHeight:"92vh",objectFit:"contain",borderRadius:8,boxShadow:"0 12px 48px rgba(0,0,0,0.6)",cursor:"default"}}/>
      </div>}
    </div>
  );
}

function EQ({trades}){
  const sorted=[...trades].filter(t=>t.date&&t.pnl).sort((a,b)=>a.date.localeCompare(b.date));
  if(!sorted.length)return<div style={{textAlign:"center",padding:24,color:"#5A5A72",fontSize:12,fontFamily:"'JetBrains Mono',monospace"}}>No data yet.</div>;
  const dp=[];const seen={};sorted.forEach(t=>{if(!seen[t.date]){seen[t.date]={date:t.date,pnl:0};dp.push(seen[t.date]);}seen[t.date].pnl+=parseFloat(t.pnl)||0;});
  let cum=0;const pts=dp.map(d=>{cum+=d.pnl;return{date:d.date,c:cum};});
  const W=820,H=180,pL=48,pR=16,pT=16,pB=24,pW=W-pL-pR,pH=H-pT-pB;
  const mx=Math.max(...pts.map(p=>p.c),0),mn2=Math.min(...pts.map(p=>p.c),0),rn=mx-mn2||1;
  const xS=i=>pL+(i/Math.max(pts.length-1,1))*pW,yS=v=>pT+pH-((v-mn2)/rn)*pH;
  const lp=pts.map((p,i)=>`${i===0?"M":"L"}${xS(i).toFixed(1)},${yS(p.c).toFixed(1)}`).join(" ");
  const ap=`${lp} L${xS(pts.length-1).toFixed(1)},${(pT+pH).toFixed(1)} L${xS(0).toFixed(1)},${(pT+pH).toFixed(1)} Z`;
  const last=pts[pts.length-1],lc=last.c>=0?"#00E676":"#FF3D3D";
  const gridLines=[0.25,0.5,0.75].map(f=>pT+pH*f);
  const gid="eq_grad_"+(last.c>=0?"g":"r");
  return(<svg viewBox={`0 0 ${W} ${H}`} style={{width:"100%",height:"auto"}}>
    <defs>
      <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stopColor={lc} stopOpacity="0.25"/>
        <stop offset="100%" stopColor={lc} stopOpacity="0"/>
      </linearGradient>
      <filter id="eq_glow"><feGaussianBlur stdDeviation="2" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
    </defs>
    {gridLines.map((y,i)=><line key={i} x1={pL} y1={y} x2={W-pR} y2={y} stroke="#1A1A26" strokeWidth={0.5} strokeDasharray="2,4"/>)}
    <line x1={pL} y1={yS(0)} x2={W-pR} y2={yS(0)} stroke="#222230" strokeWidth={1} strokeDasharray="3,4"/>
    <text x={pL-6} y={yS(0)+4} textAnchor="end" fill="#5A5A72" fontSize={8} fontFamily="JetBrains Mono">0%</text>
    <path d={ap} fill={`url(#${gid})`}/>
    <path d={lp} fill="none" stroke={lc} strokeWidth={1.8} strokeLinejoin="round" strokeLinecap="round" filter="url(#eq_glow)"/>
    <circle cx={xS(pts.length-1)} cy={yS(last.c)} r={4} fill={lc} filter="url(#eq_glow)"/>
    <circle cx={xS(pts.length-1)} cy={yS(last.c)} r={2} fill="#06060A"/>
    <text x={xS(pts.length-1)} y={yS(last.c)-10} textAnchor="middle" fill={lc} fontSize={10} fontWeight={700} fontFamily="JetBrains Mono">{last.c>=0?"+":""}{last.c.toFixed(2)}%</text>
    <text x={pL} y={H-4} textAnchor="start" fill="#5A5A72" fontSize={7} fontFamily="JetBrains Mono">{pts[0].date}</text>
    <text x={W-pR} y={H-4} textAnchor="end" fill="#5A5A72" fontSize={7} fontFamily="JetBrains Mono">{last.date}</text>
  </svg>);
}

// Underwater drawdown chart — shows distance from equity peak over time
function UnderwaterChart({trades}){
  const sorted=[...trades].filter(t=>t.date&&t.pnl).sort((a,b)=>a.date.localeCompare(b.date));
  if(!sorted.length)return<div style={{textAlign:"center",padding:24,color:"#5A5A72",fontSize:12,fontFamily:"'JetBrains Mono',monospace"}}>No data yet.</div>;
  let cum=0,peak=0;
  const pts=sorted.map(t=>{cum+=parseFloat(t.pnl)||0;if(cum>peak)peak=cum;return{date:t.date,dd:cum-peak};});
  const W=820,H=120,pL=48,pR=16,pT=10,pB=22,pW=W-pL-pR,pH=H-pT-pB;
  const mn2=Math.min(...pts.map(p=>p.dd),0),rn=Math.abs(mn2)||1;
  const xS=i=>pL+(i/Math.max(pts.length-1,1))*pW,yS=v=>pT+(Math.abs(v)/rn)*pH;
  const lp=pts.map((p,i)=>`${i===0?"M":"L"}${xS(i).toFixed(1)},${yS(p.dd).toFixed(1)}`).join(" ");
  const ap=`M${xS(0).toFixed(1)},${pT} ${lp} L${xS(pts.length-1).toFixed(1)},${pT} Z`;
  return(<svg viewBox={`0 0 ${W} ${H}`} style={{width:"100%",height:"auto"}}>
    <defs><linearGradient id="dd_grad" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#FF3D3D" stopOpacity="0"/><stop offset="100%" stopColor="#FF3D3D" stopOpacity="0.3"/></linearGradient></defs>
    <line x1={pL} y1={pT} x2={W-pR} y2={pT} stroke="#222230" strokeWidth={1} strokeDasharray="3,4"/>
    <text x={pL-6} y={pT+3} textAnchor="end" fill="#5A5A72" fontSize={8} fontFamily="JetBrains Mono">0</text>
    <text x={pL-6} y={pT+pH+3} textAnchor="end" fill="#5A5A72" fontSize={8} fontFamily="JetBrains Mono">-{rn.toFixed(0)}%</text>
    <path d={ap} fill="url(#dd_grad)"/>
    <path d={lp} fill="none" stroke="#FF3D3D" strokeWidth={1.4} strokeLinejoin="round" strokeLinecap="round"/>
    <text x={pL} y={H-4} textAnchor="start" fill="#5A5A72" fontSize={7} fontFamily="JetBrains Mono">{pts[0].date}</text>
    <text x={W-pR} y={H-4} textAnchor="end" fill="#5A5A72" fontSize={7} fontFamily="JetBrains Mono">{pts[pts.length-1].date}</text>
  </svg>);
}

// R-Multiple distribution histogram
function RDistribution({trades}){
  const rs = trades.map(t=>calcRMultiple(t)).filter(v=>v!==null);
  if(!rs.length) return <div style={{textAlign:"center",padding:14,color:"#5A5A72",fontSize:11,fontFamily:"'JetBrains Mono',monospace"}}>Need entry/stop/close prices on trades to compute R.</div>;
  const bins = [
    {label:"≤-3R",min:-Infinity,max:-3,color:"#FF3D3D"},
    {label:"-3 to -2R",min:-3,max:-2,color:"#FF3D3D"},
    {label:"-2 to -1R",min:-2,max:-1,color:"#FF6D00"},
    {label:"-1 to 0R",min:-1,max:0,color:"#FFD600"},
    {label:"0 to 1R",min:0,max:1,color:"#448AFF"},
    {label:"1 to 2R",min:1,max:2,color:"#18FFFF"},
    {label:"2 to 3R",min:2,max:3,color:"#00E676"},
    {label:"3R+",min:3,max:Infinity,color:"#00E676"},
  ];
  const counts = bins.map(b=>rs.filter(r=>r>b.min&&r<=b.max).length);
  const mx = Math.max(...counts,1);
  const avgR = (rs.reduce((a,b)=>a+b,0)/rs.length).toFixed(2);
  return(
    <div>
      <div style={{display:"flex",alignItems:"flex-end",gap:6,height:120,marginBottom:8}}>
        {bins.map((b,i)=>(
          <div key={b.label} style={{flex:1,display:"flex",flexDirection:"column",alignItems:"center",gap:4}}>
            <div style={{fontSize:9,color:"#EEEEF5",fontFamily:"'JetBrains Mono',monospace",fontWeight:600,minHeight:12}}>{counts[i]||""}</div>
            <div style={{width:"100%",height:`${(counts[i]/mx)*90}px`,background:`linear-gradient(180deg,${b.color},${b.color}40)`,borderRadius:"4px 4px 0 0",minHeight:counts[i]?2:0,transition:"height 0.4s"}}/>
          </div>
        ))}
      </div>
      <div style={{display:"flex",gap:6}}>
        {bins.map(b=>(<div key={b.label} style={{flex:1,fontSize:7,color:"#5A5A72",fontFamily:"'JetBrains Mono',monospace",textAlign:"center",letterSpacing:"0.02em"}}>{b.label}</div>))}
      </div>
      <div style={{marginTop:12,fontSize:10,color:"#5A5A72",fontFamily:"'JetBrains Mono',monospace"}}>
        Avg R: <span style={{color:parseFloat(avgR)>=0?"#00E676":"#FF3D3D",fontWeight:700}}>{parseFloat(avgR)>=0?"+":""}{avgR}R</span> · n={rs.length}
      </div>
    </div>
  );
}
