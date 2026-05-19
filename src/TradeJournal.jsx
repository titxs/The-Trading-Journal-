import { useState, useEffect, useRef } from "react";
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
const defaultTrade = { id:"",date:"",pair:"BTC/USD",direction:"",regime:"",setup:"",keyLevel:"",levelType:[],levelTypeOther:"",confluence:[],confluenceOther:"",conviction:"",entryType:"",entry:"",stop:"",tp1:"",tp2:"",rr:"",posSize:"1%",leverage:"",result:"",pnl:"",pnlDollar:"",closePrice:"",hitTp1:false,hitTp2:false,followedRules:"",confirmed:"",mistakes:"",different:"",notes:"",screenshots:[] };

// ── design tokens ─────────────────────────────────────────────────────────────
const F  = "'JetBrains Mono',monospace";
const FD = "'Syne',sans-serif";
const bg="#07070B", bg2="#0D0D13", bg3="#13131A", b1="#1A1A26", b2="#222230";
const g="#00E676", r="#FF3D3D", y="#FFD600", bl="#448AFF", cy="#18FFFF";
const w="#EEEEF5", gr="#5A5A72", gd="#2E2E42";
const iS={width:"100%",padding:"10px 12px",background:bg,color:w,border:`1px solid ${b2}`,borderRadius:8,fontSize:13,fontFamily:F,outline:"none",transition:"border-color 0.2s"};
const cS={background:bg2,border:`1px solid ${b1}`,borderRadius:14,padding:20,marginBottom:12};

// ── helpers ───────────────────────────────────────────────────────────────────
function calcRR(t){const e=parseFloat(t.entry),s=parseFloat(t.stop),tp=parseFloat(t.tp1);if(!e||!s||!tp)return"";const risk=Math.abs(e-s);if(!risk)return"";return(Math.abs(tp-e)/risk).toFixed(1);}
function calcTP(t){const e=parseFloat(t.entry),c=parseFloat(t.closePrice);if(!e||!c)return"";const p=((c-e)/e)*100*(t.direction==="SHORT"?-1:1);return p.toFixed(2);}
function signPnl(result,v){const n=Math.abs(parseFloat(v)||0);if(result==="LOSS")return-n;if(result==="BE")return 0;return n;}
function todayStr(){return new Date().toISOString().slice(0,10);}

// ── sub-components ────────────────────────────────────────────────────────────
function Sec({title,children,accent=g}){return(<div style={cS}><div style={{fontSize:10,fontWeight:700,color:accent,textTransform:"uppercase",letterSpacing:"0.12em",fontFamily:F,marginBottom:16,display:"flex",alignItems:"center",gap:8}}><div style={{width:2,height:12,background:accent,borderRadius:2}}/>{title}</div>{children}</div>);}
function Fld({label,children}){return(<div style={{marginBottom:12}}><div style={{fontSize:9,color:gr,textTransform:"uppercase",letterSpacing:"0.1em",fontFamily:F,marginBottom:6,fontWeight:600}}>{label}</div>{children}</div>);}
function Pill({label,selected,onClick,color=g}){return(<button onClick={onClick} style={{padding:"5px 12px",borderRadius:20,border:`1px solid ${selected?color:b2}`,background:selected?`${color}15`:"transparent",color:selected?color:gr,fontSize:11,fontFamily:F,fontWeight:600,cursor:"pointer",transition:"all 0.15s",whiteSpace:"nowrap"}}>{label}</button>);}
function RCard({o,sel,onClick}){return(<button onClick={onClick} style={{flex:1,minWidth:130,padding:"10px 12px",background:sel?`${o.color}10`:bg,border:`1px solid ${sel?o.color:b2}`,borderRadius:10,cursor:"pointer",textAlign:"left",transition:"all 0.15s"}}><div style={{fontSize:10,fontWeight:700,color:sel?o.color:gr,fontFamily:F}}>{o.label}</div><div style={{fontSize:8,color:gd,fontFamily:F,marginTop:3,lineHeight:1.4}}>{o.desc}</div></button>);}

function StatCard({label,value,sub,color=w,accent}){
  return(
    <div style={{background:bg2,border:`1px solid ${b1}`,borderRadius:12,padding:"16px 18px",flex:1,minWidth:90,position:"relative",overflow:"hidden"}}>
      {accent&&<div style={{position:"absolute",top:0,left:0,right:0,height:2,background:accent,borderRadius:"12px 12px 0 0"}}/>}
      <div style={{fontSize:9,color:gr,textTransform:"uppercase",letterSpacing:"0.1em",fontFamily:F,fontWeight:600,marginBottom:6}}>{label}</div>
      <div style={{fontSize:20,fontWeight:700,color,fontFamily:F,letterSpacing:"-0.02em"}}>{value}</div>
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
export default function TradeJournal(){
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
  const cs=(fl)=>{const t=fl.length,wi=fl.filter(x=>x.result==="WIN").length,lo=fl.filter(x=>x.result==="LOSS").length,be=fl.filter(x=>x.result==="BE").length;const wr=t?((wi/t)*100).toFixed(1):"0";const pnls=fl.filter(x=>x.pnl).map(x=>parseFloat(x.pnl));const tp=pnls.reduce((a,b)=>a+b,0).toFixed(2);const dols=fl.filter(x=>x.pnlDollar).map(x=>parseFloat(x.pnlDollar));const td=dols.length?dols.reduce((a,b)=>a+b,0).toFixed(2):"0";const wRR=fl.filter(x=>x.result==="WIN"&&x.rr).map(x=>parseFloat(x.rr));const ar=wRR.length?(wRR.reduce((a,b)=>a+b,0)/wRR.length).toFixed(1):"0";const rf=fl.filter(x=>x.followedRules==="YES").length;const rr=t?((rf/t)*100).toFixed(0):"0";const bt=pnls.length?Math.max(...pnls).toFixed(2):"0";const wt=pnls.length?Math.min(...pnls).toFixed(2):"0";const tps=fl.filter(x=>x.tradePercent).map(x=>parseFloat(x.tradePercent));const ttp=tps.reduce((a,b)=>a+b,0).toFixed(2);return{total:t,wins:wi,losses:lo,be,winRate:wr,totalPnl:tp,totalDollar:td,avgRR:ar,rulesRate:rr,bestTrade:bt,worstTrade:wt,totalTradePercent:ttp};};

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
    input:focus,textarea:focus,select:focus{border-color:${g}!important;outline:none;}
    ::-webkit-scrollbar{width:3px;}
    ::-webkit-scrollbar-track{background:transparent;}
    ::-webkit-scrollbar-thumb{background:${b2};border-radius:4px;}
    @keyframes fadeUp{from{opacity:0;transform:translateY(12px);}to{opacity:1;transform:translateY(0);}}
    @keyframes pulse{0%,100%{opacity:1;}50%{opacity:0.5;}}
    .fi{animation:fadeUp 0.25s ease both;}
    .fi2{animation:fadeUp 0.25s ease 0.05s both;opacity:0;animation-fill-mode:forwards;}
    .fi3{animation:fadeUp 0.25s ease 0.1s both;opacity:0;animation-fill-mode:forwards;}
    .nav-btn:hover{background:${b1}!important;}
    .trade-row:hover{background:${bg3}!important;}
    input[type=date]::-webkit-calendar-picker-indicator{filter:invert(0.4);}
  `;

  return(
    <div style={{minHeight:"100vh",background:bg,color:w,fontFamily:F,paddingBottom:72}}>
      <style>{globalStyles}</style>

      {/* ── top bar ── */}
      <div style={{position:"sticky",top:0,zIndex:100,background:`${bg}ee`,backdropFilter:"blur(12px)",borderBottom:`1px solid ${b1}`,padding:"0 20px",display:"flex",alignItems:"center",justifyContent:"space-between",height:52}}>
        <div style={{display:"flex",alignItems:"center",gap:10}}>
          <div style={{width:28,height:28,borderRadius:7,background:`linear-gradient(135deg,${g},${cy})`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:13,fontWeight:800,color:bg,fontFamily:FD}}>T</div>
          <span style={{fontSize:13,fontWeight:700,fontFamily:FD,letterSpacing:"0.01em"}}>Trading Journal</span>
        </div>
        <div style={{display:"flex",alignItems:"center",gap:6}}>
          <div style={{width:6,height:6,borderRadius:"50%",background:g,boxShadow:`0 0 6px ${g}`}}/>
          <span style={{fontSize:10,color:gr,fontFamily:F}}>BTC/USD · LIVE</span>
        </div>
      </div>

      {/* ── bottom nav ── */}
      <div style={{position:"fixed",bottom:0,left:0,right:0,zIndex:100,background:`${bg}f0`,backdropFilter:"blur(16px)",borderTop:`1px solid ${b1}`,display:"flex",alignItems:"center",padding:"6px 8px 8px"}}>
        {navItems.map(({id,label,Icon})=>{
          const active=view===id;
          return(
            <button key={id} className="nav-btn" onClick={()=>{setView(id);setSelDay(null);}} style={{flex:1,display:"flex",flexDirection:"column",alignItems:"center",gap:3,padding:"6px 4px",borderRadius:10,border:"none",cursor:"pointer",background:"transparent",color:active?g:gr,transition:"all 0.15s",fontFamily:F}}>
              <div style={{color:active?g:gr,transition:"color 0.15s"}}><Icon/></div>
              <span style={{fontSize:9,fontWeight:active?700:500,letterSpacing:"0.04em",textTransform:"uppercase"}}>{label}</span>
              {active&&<div style={{width:16,height:2,background:g,borderRadius:2,marginTop:-2}}/>}
            </button>
          );
        })}
      </div>

      <div style={{maxWidth:900,margin:"0 auto",padding:"20px 16px"}}>

        {/* ════════════ HOME ════════════ */}
        {view==="home"&&(<div>
          {/* greeting */}
          <div className="fi" style={{marginBottom:24}}>
            <div style={{fontSize:22,fontWeight:800,fontFamily:FD,letterSpacing:"-0.02em",lineHeight:1.2}}>
              {new Date().getHours()<12?"Good morning":"new Date().getHours()<17?Good afternoon":"Good evening"}, Titus.
            </div>
            <div style={{fontSize:12,color:gr,marginTop:4,fontFamily:F}}>{new Date().toLocaleDateString("en-AU",{weekday:"long",day:"numeric",month:"long"})}</div>
          </div>

          {/* today strip */}
          <div className="fi" style={{background:bg2,border:`1px solid ${b1}`,borderRadius:14,padding:"16px 18px",marginBottom:12,display:"flex",alignItems:"center",justifyContent:"space-between"}}>
            <div>
              <div style={{fontSize:9,color:gr,textTransform:"uppercase",letterSpacing:"0.1em",fontFamily:F,fontWeight:600,marginBottom:4}}>Today</div>
              <div style={{display:"flex",alignItems:"baseline",gap:8}}>
                <span style={{fontSize:26,fontWeight:700,color:todayPnl>=0?g:todayPnl===0?gr:r,fontFamily:F,letterSpacing:"-0.02em"}}>{todayPnl>=0?"+":""}{todayPnl.toFixed(2)}%</span>
                <span style={{fontSize:11,color:gr}}>{todayTrades.length} trade{todayTrades.length!==1?"s":""}</span>
              </div>
            </div>
            <button onClick={()=>setView("quick")} style={{display:"flex",alignItems:"center",gap:6,padding:"10px 16px",borderRadius:10,border:`1px solid ${g}30`,background:`${g}10`,color:g,fontFamily:F,fontSize:11,fontWeight:700,cursor:"pointer",letterSpacing:"0.04em"}}>
              <NavIcon.quick/> QUICK LOG
            </button>
          </div>

          {/* key stats row */}
          <div className="fi2" style={{display:"flex",gap:8,marginBottom:12,flexWrap:"wrap"}}>
            <StatCard label="Monthly P/L" value={`${mp>=0?"+":""}${mp.toFixed(2)}%`} sub={`${mtp!==0?`pre-lev ${mtp>=0?"+":""}${mtp.toFixed(2)}%`:""} · ${md>=0?"+":""}$${Math.abs(md).toFixed(0)}`} color={mp>=0?g:r} accent={mp>=0?g:r}/>
            <StatCard label="Win Rate" value={`${allStats.winRate}%`} sub={`${allStats.wins}W · ${allStats.losses}L · ${allStats.be}BE`} color={parseFloat(allStats.winRate)>=50?g:r} accent={parseFloat(allStats.winRate)>=50?g:r}/>
            <StatCard label="Avg R:R" value={`${allStats.avgRR}:1`} sub="on winning trades" color={g} accent={bl}/>
            <StatCard label="Rules %" value={`${allStats.rulesRate}%`} sub="followed rules" color={parseFloat(allStats.rulesRate)>=80?g:y} accent={parseFloat(allStats.rulesRate)>=80?g:y}/>
          </div>

          {/* equity curve */}
          <div className="fi2" style={{...cS,marginBottom:12}}>
            <div style={{fontSize:9,color:gr,textTransform:"uppercase",letterSpacing:"0.1em",fontFamily:F,fontWeight:600,marginBottom:12,display:"flex",alignItems:"center",justifyContent:"space-between"}}>
              <span>All-time equity curve</span>
              <span style={{color:parseFloat(allStats.totalPnl)>=0?g:r}}>{parseFloat(allStats.totalPnl)>=0?"+":""}{allStats.totalPnl}%</span>
            </div>
            <EQ trades={trades}/>
          </div>

          {/* recent trades */}
          <div className="fi3" style={cS}>
            <div style={{fontSize:9,color:gr,textTransform:"uppercase",letterSpacing:"0.1em",fontFamily:F,fontWeight:600,marginBottom:12,display:"flex",alignItems:"center",justifyContent:"space-between"}}>
              <span>Recent trades</span>
              <button onClick={()=>setView("history")} style={{background:"none",border:"none",color:bl,fontSize:9,fontFamily:F,cursor:"pointer",letterSpacing:"0.06em"}}>VIEW ALL →</button>
            </div>
            {recentTrades.length===0&&<div style={{textAlign:"center",padding:"20px 0",color:gr,fontSize:12}}>No trades yet — log your first trade.</div>}
            {recentTrades.map(t=>(
              <div key={t.id} className="trade-row" onClick={()=>{setCt({...defaultTrade,...t});setEditingId(t.id);setSsFiles([]);setView("log");}} style={{display:"flex",alignItems:"center",gap:10,padding:"10px 0",borderBottom:`1px solid ${b1}`,cursor:"pointer",borderRadius:6,transition:"background 0.1s"}}>
                <div style={{width:6,height:6,borderRadius:"50%",background:t.result==="WIN"?g:t.result==="LOSS"?r:y,flexShrink:0}}/>
                <div style={{flex:1,minWidth:0}}>
                  <div style={{fontSize:11,fontWeight:600}}>{t.date} <span style={{color:gr,fontWeight:400}}>· {t.direction} {t.pair}</span></div>
                  {t.setup&&<div style={{fontSize:9,color:gd,marginTop:1}}>{setupOptions.find(s=>s.id===t.setup)?.label||""}</div>}
                </div>
                <div style={{textAlign:"right"}}>
                  <div style={{fontSize:12,fontWeight:700,color:parseFloat(t.pnl)>=0?g:r}}>{parseFloat(t.pnl)>=0?"+":""}{t.pnl}%</div>
                  {t.pnlDollar&&<div style={{fontSize:9,color:gr}}>${t.pnlDollar}</div>}
                </div>
              </div>
            ))}
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
                <div style={{width:16,height:16,borderRadius:4,border:`1px solid ${b2}`,background:bg,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>
                  <svg width="9" height="9" viewBox="0 0 12 12" fill="none"><polyline points="2,6 5,9 10,3" stroke={g} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
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
          <Sec title="Key Level" accent={bl}>
            <Fld label="Price Level"><input value={ct.keyLevel} onChange={e=>up("keyLevel",e.target.value)} placeholder="e.g. 78005" style={iS}/></Fld>
            <Fld label="Level Type"><div style={{display:"flex",gap:6,flexWrap:"wrap"}}>{levelTypes.map(l=><Pill key={l} label={l} selected={ct.levelType?.includes(l)} onClick={()=>tog("levelType",l)} color={bl}/>)}</div><div style={{marginTop:8}}><input value={ct.levelTypeOther||""} onChange={e=>up("levelTypeOther",e.target.value)} placeholder="Other level type..." style={{...iS,fontSize:11}}/></div></Fld>
          </Sec>
          <Sec title="Confluence" accent={cy}>
            <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>{confluenceOptions.map(c=><Pill key={c} label={c} selected={ct.confluence?.includes(c)} onClick={()=>tog("confluence",c)} color={cy}/>)}</div>
            <div style={{marginTop:8}}><input value={ct.confluenceOther||""} onChange={e=>up("confluenceOther",e.target.value)} placeholder="Other confluence..." style={{...iS,fontSize:11}}/></div>
            <div style={{marginTop:8,fontSize:11,fontWeight:600,color:(ct.confluence?.length||0)>=3?g:(ct.confluence?.length||0)>=1?y:r}}>{ct.confluence?.length||0} factor{(ct.confluence?.length||0)!==1?"s":""}{(ct.confluence?.length||0)===0?" — no confluence":""}{(ct.confluence?.length||0)>=1&&(ct.confluence?.length||0)<3?" — low confluence":""}{(ct.confluence?.length||0)>=3?" — strong confluence":""}</div>
          </Sec>
          <Sec title="Execution">
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>
              <Fld label="Conviction"><div style={{display:"flex",gap:4}}>{["LOW","MED","HIGH"].map(c=><Pill key={c} label={c} selected={ct.conviction===c} onClick={()=>up("conviction",c)} color={c==="HIGH"?g:c==="MED"?y:r}/>)}</div></Fld>
              <Fld label="Entry Type"><div style={{display:"flex",gap:4}}>{["Aggressive","Conservative"].map(t=><Pill key={t} label={t} selected={ct.entryType===t} onClick={()=>up("entryType",t)}/>)}</div></Fld>
            </div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr 1fr 1fr 1fr",gap:10}}>
              {[{k:"entry",l:"Entry",p:"Entry price"},{k:"stop",l:"Stop",p:"SL price"},{k:"tp1",l:"TP1",p:"Target 1"},{k:"tp2",l:"TP2",p:"Target 2"},{k:"posSize",l:"Size",p:"1%"},{k:"leverage",l:"Leverage",p:"10x"}].map(f=><Fld key={f.k} label={f.l}><input value={ct[f.k]} onChange={e=>up(f.k,e.target.value)} placeholder={f.p} style={iS}/></Fld>)}
            </div>
            {ct.entry&&ct.stop&&ct.tp1&&<div style={{fontSize:12,color:g,fontWeight:700,marginTop:4}}>R:R → {calcRR(ct)}:1</div>}
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
            <button onClick={()=>fRef.current?.click()} style={{width:"100%",padding:12,background:bg,border:`1px dashed ${b2}`,borderRadius:8,color:gr,fontSize:12,fontFamily:F,cursor:"pointer"}}>+ Add Screenshots</button>
            {ct.screenshots?.length>0&&<div style={{display:"flex",gap:8,marginTop:10,flexWrap:"wrap"}}>{ct.screenshots.map((s,i)=><div key={i} style={{position:"relative"}}><img src={s} alt="" style={{width:80,height:60,objectFit:"cover",borderRadius:6,border:`1px solid ${b1}`}}/><button onClick={()=>{setCt(p=>({...p,screenshots:p.screenshots.filter((_,j)=>j!==i)}));setSsFiles(p=>p.filter((_,j)=>j!==i));}} style={{position:"absolute",top:-6,right:-6,width:18,height:18,borderRadius:"50%",background:r,border:"none",color:w,fontSize:10,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center"}}>×</button></div>)}</div>}
          </Sec>
          <button onClick={submit} disabled={!ct.date||!ct.direction||!ct.keyLevel||saving} style={{width:"100%",padding:16,marginTop:8,border:"none",borderRadius:12,fontSize:12,fontWeight:700,fontFamily:F,textTransform:"uppercase",letterSpacing:"0.06em",cursor:saving?"not-allowed":"pointer",background:saving||!ct.date||!ct.direction||!ct.keyLevel?bg3:`linear-gradient(135deg,${g},${cy})`,color:saving||!ct.date||!ct.direction||!ct.keyLevel?gd:bg,transition:"opacity 0.15s"}}>{saving?"SAVING...":editingId?"UPDATE TRADE":"LOG TRADE"}</button>
          {editingId&&<button onClick={()=>{setEditingId(null);setCt({...defaultTrade});setSsFiles([]);}} style={{width:"100%",padding:10,marginTop:6,background:"transparent",color:gr,border:`1px solid ${b1}`,borderRadius:8,fontSize:11,fontFamily:F,cursor:"pointer"}}>CANCEL EDIT</button>}
        </div>)}

        {/* ════════════ P&L ════════════ */}
        {view==="pnl"&&(<div className="fi">
          {/* monthly header */}
          <div style={{background:bg2,border:`1px solid ${b1}`,borderRadius:14,padding:"18px 20px",marginBottom:12}}>
            <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:12}}>
              <button onClick={()=>setCalMonth(new Date(yr,mo-1,1))} style={{width:28,height:28,borderRadius:8,background:bg,border:`1px solid ${b1}`,color:gr,cursor:"pointer",fontSize:14,display:"flex",alignItems:"center",justifyContent:"center",fontFamily:F}}>‹</button>
              <span style={{fontSize:14,fontWeight:700,fontFamily:FD}}>{mn[mo]} {yr}</span>
              <button onClick={()=>setCalMonth(new Date(yr,mo+1,1))} style={{width:28,height:28,borderRadius:8,background:bg,border:`1px solid ${b1}`,color:gr,cursor:"pointer",fontSize:14,display:"flex",alignItems:"center",justifyContent:"center",fontFamily:F}}>›</button>
            </div>
            <div style={{display:"flex",alignItems:"baseline",gap:10,marginBottom:4}}>
              <span style={{fontSize:28,fontWeight:700,color:mp>=0?g:r,fontFamily:F,letterSpacing:"-0.02em"}}>{mp>=0?"+":""}{mp.toFixed(2)}%</span>
              {md!==0&&<span style={{fontSize:14,fontWeight:600,color:mp>=0?g:r,opacity:0.6}}>{md>=0?"+":""}${Math.abs(md).toFixed(0)}</span>}
              {mtp!==0&&<span style={{fontSize:13,fontWeight:600,color:gr}}>· pre-lev <span style={{color:mtp>=0?g:r}}>{mtp>=0?"+":""}{mtp.toFixed(2)}%</span></span>}
            </div>
            <div style={{display:"flex",gap:16}}>
              {[{l:"Trades",v:mt},{l:"Green Days",v:mw,c:g},{l:"Red Days",v:ml,c:r}].map(x=><div key={x.l}><span style={{fontSize:9,color:gr,textTransform:"uppercase",letterSpacing:"0.08em",fontFamily:F}}>{x.l} </span><span style={{fontSize:12,fontWeight:700,color:x.c||w,fontFamily:F}}>{x.v}</span></div>)}
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
                  {hd&&<><div style={{fontSize:10,fontWeight:700,color:ip?g:iN?r:y,marginTop:1}}>{ip?"+":""}{dp.toFixed(1)}%</div>{dd!==undefined&&dd!==0&&<div style={{fontSize:8,color:ip?g:r,opacity:0.6}}>{dd>=0?"+":" "}-${Math.abs(dd).toFixed(0)}</div>}<div style={{fontSize:8,color:gr}}>{dc}t</div></>}
                </button>);
              })}
            </div>
          </div>
          {selDay&&tlbd[selDay]&&<div className="fi" style={{marginBottom:12}}>
            <div style={{fontSize:10,color:gr,fontFamily:F,textTransform:"uppercase",letterSpacing:"0.1em",fontWeight:600,marginBottom:8}}>{selDay}</div>
            {tlbd[selDay].map(t=><div key={t.id} style={{...cS,padding:"12px 14px",display:"flex",alignItems:"center",gap:10,cursor:"pointer",marginBottom:6}} onClick={()=>{setCt({...defaultTrade,...t});setEditingId(t.id);setSsFiles([]);setView("log");}}>
              <div style={{width:6,height:6,borderRadius:"50%",background:t.result==="WIN"?g:t.result==="LOSS"?r:y,flexShrink:0}}/>
              <div style={{flex:1}}><span style={{fontSize:11,fontWeight:600}}>{t.pair}</span><span style={{fontSize:10,color:gr,marginLeft:8}}>{t.direction}</span></div>
              <div style={{fontSize:12,fontWeight:700,color:parseFloat(t.pnl)>=0?g:r}}>{parseFloat(t.pnl)>=0?"+":""}{t.pnl}%</div>
              <span style={{fontSize:9,color:bl}}>Edit →</span>
            </div>)}
          </div>}
          <div style={cS}><div style={{fontSize:9,color:gr,textTransform:"uppercase",letterSpacing:"0.1em",fontFamily:F,fontWeight:600,marginBottom:12}}>Equity Curve</div><EQ trades={trades}/></div>
        </div>)}

        {/* ════════════ HISTORY ════════════ */}
        {view==="history"&&(<div className="fi">
          <div style={{display:"flex",gap:6,marginBottom:14}}>{["ALL","WIN","LOSS","BE"].map(f=><Pill key={f} label={f} selected={filterR===f} onClick={()=>setFilterR(f)} color={f==="WIN"?g:f==="LOSS"?r:f==="BE"?y:w}/>)}</div>
          {trades.filter(t=>filterR==="ALL"||t.result===filterR).map(t=>(
            <div key={t.id} className="trade-row" style={{...cS,padding:"12px 14px",cursor:"pointer",transition:"background 0.1s",marginBottom:6}} onClick={()=>setExpTrade(expTrade===t.id?null:t.id)}>
              <div style={{display:"flex",alignItems:"center",gap:10}}>
                <div style={{width:6,height:6,borderRadius:"50%",background:t.result==="WIN"?g:t.result==="LOSS"?r:y,flexShrink:0}}/>
                <div style={{flex:1,minWidth:0}}>
                  <span style={{fontSize:11,fontWeight:600}}>{t.date}</span>
                  <span style={{fontSize:10,color:gr,marginLeft:8}}>{t.direction} {t.pair}</span>
                  {t.setup&&<span style={{fontSize:9,color:gd,marginLeft:8}}>{setupOptions.find(s=>s.id===t.setup)?.label}</span>}
                </div>
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
                {t.screenshots?.length>0&&<div style={{display:"flex",gap:6,marginTop:8,flexWrap:"wrap"}}>{t.screenshots.map((s,i)=><img key={i} src={s} alt="" style={{width:100,height:70,objectFit:"cover",borderRadius:6,border:`1px solid ${b1}`}}/>)}</div>}
                <div style={{display:"flex",gap:8,marginTop:12}}>
                  <button onClick={e=>{e.stopPropagation();setCt({...defaultTrade,...t});setEditingId(t.id);setSsFiles([]);setView("log");}} style={{padding:"6px 14px",borderRadius:6,background:`${bl}12`,border:`1px solid ${bl}25`,color:bl,fontSize:10,fontFamily:F,fontWeight:600,cursor:"pointer"}}>Edit</button>
                  <button onClick={e=>{e.stopPropagation();if(confirm("Delete this trade?"))del(t.id);}} style={{padding:"6px 14px",borderRadius:6,background:`${r}10`,border:`1px solid ${r}20`,color:r,fontSize:10,fontFamily:F,fontWeight:600,cursor:"pointer"}}>Delete</button>
                </div>
              </div>}
            </div>
          ))}
        </div>)}

        {/* ════════════ STATS ════════════ */}
        {view==="stats"&&(()=>{const fl=gf(sFilter),s=cs(fl);return(<div className="fi">
          <div style={{display:"flex",gap:4,marginBottom:14,flexWrap:"wrap"}}>
            <Pill label="All" selected={sFilter==="all"} onClick={()=>setSFilter("all")} color={w}/>
            {setupOptions.map(o=><Pill key={o.id} label={o.label} selected={sFilter===`setup_${o.id}`} onClick={()=>setSFilter(`setup_${o.id}`)} color={o.color}/>)}
            {regimeOptions.slice(0,4).map(o=><Pill key={o.id} label={o.label} selected={sFilter===`regime_${o.id}`} onClick={()=>setSFilter(`regime_${o.id}`)} color={o.color}/>)}
          </div>
          <div style={{display:"flex",gap:8,flexWrap:"wrap",marginBottom:8}}>
            <StatCard label="Trades" value={s.total}/>
            <StatCard label="Win Rate" value={`${s.winRate}%`} color={parseFloat(s.winRate)>=50?g:r} accent={parseFloat(s.winRate)>=50?g:r}/>
            <StatCard label="Rules %" value={`${s.rulesRate}%`} color={parseFloat(s.rulesRate)>=80?g:y} accent={parseFloat(s.rulesRate)>=80?g:y}/>
          </div>
          <div style={{display:"flex",gap:8,flexWrap:"wrap",marginBottom:8}}>
            <StatCard label="Wins" value={s.wins} color={g}/>
            <StatCard label="Losses" value={s.losses} color={r}/>
            <StatCard label="BE" value={s.be} color={y}/>
            <StatCard label="Avg R:R" value={`${s.avgRR}:1`} color={g} accent={bl}/>
          </div>
          <div style={{display:"flex",gap:8,flexWrap:"wrap",marginBottom:8}}>
            <StatCard label="P&L %" value={`${parseFloat(s.totalPnl)>=0?"+":""}${s.totalPnl}%`} color={parseFloat(s.totalPnl)>=0?g:r} accent={parseFloat(s.totalPnl)>=0?g:r}/>
            <StatCard label="P&L $" value={parseFloat(s.totalDollar)!==0?`${parseFloat(s.totalDollar)>=0?"+":""}$${Math.abs(parseFloat(s.totalDollar)).toFixed(0)}`:"—"} color={parseFloat(s.totalDollar)>=0?g:r}/>
            <StatCard label="Pre-Lev %" value={`${parseFloat(s.totalTradePercent)>=0?"+":""}${s.totalTradePercent}%`} color={parseFloat(s.totalTradePercent)>=0?g:r}/>
          </div>
          <div style={{display:"flex",gap:8,flexWrap:"wrap",marginBottom:12}}>
            <StatCard label="Best Trade" value={`+${s.bestTrade}%`} color={g}/>
            <StatCard label="Worst Trade" value={`${s.worstTrade}%`} color={r}/>
          </div>
          <div style={cS}>
            <div style={{fontSize:9,color:gr,textTransform:"uppercase",letterSpacing:"0.1em",fontFamily:F,fontWeight:600,marginBottom:12}}>By Setup</div>
            {setupOptions.map(o=>{const st=cs(trades.filter(t=>t.result&&t.setup===o.id));if(!st.total)return null;return(<div key={o.id} style={{display:"flex",alignItems:"center",gap:10,padding:"9px 0",borderBottom:`1px solid ${b1}`}}><div style={{width:2,height:20,background:o.color,borderRadius:2}}/><div style={{flex:1,fontSize:11,fontWeight:700,color:o.color,fontFamily:F}}>{o.label}</div><div style={{fontSize:10,color:gr}}>{st.total}t</div><div style={{fontSize:10,color:parseFloat(st.winRate)>=50?g:r,fontWeight:700,minWidth:42}}>{st.winRate}%</div><div style={{fontSize:10,color:parseFloat(st.totalPnl)>=0?g:r,fontWeight:700,minWidth:52}}>{parseFloat(st.totalPnl)>=0?"+":""}{st.totalPnl}%</div><div style={{fontSize:10,color:g,minWidth:36}}>{st.avgRR}:1</div></div>);})}
          </div>
          <div style={cS}>
            <div style={{fontSize:9,color:gr,textTransform:"uppercase",letterSpacing:"0.1em",fontFamily:F,fontWeight:600,marginBottom:12}}>By Regime</div>
            {regimeOptions.map(o=>{const rt=cs(trades.filter(t=>t.result&&t.regime===o.id));if(!rt.total)return null;return(<div key={o.id} style={{display:"flex",alignItems:"center",gap:10,padding:"9px 0",borderBottom:`1px solid ${b1}`}}><div style={{width:2,height:20,background:o.color,borderRadius:2}}/><div style={{flex:1,fontSize:11,fontWeight:700,color:o.color,fontFamily:F}}>{o.label}</div><div style={{fontSize:10,color:gr}}>{rt.total}t</div><div style={{fontSize:10,color:parseFloat(rt.winRate)>=50?g:r,fontWeight:700,minWidth:42}}>{rt.winRate}%</div><div style={{fontSize:10,color:parseFloat(rt.totalPnl)>=0?g:r,fontWeight:700,minWidth:52}}>{parseFloat(rt.totalPnl)>=0?"+":""}{rt.totalPnl}%</div><div style={{fontSize:10,color:g,minWidth:36}}>{rt.avgRR}:1</div></div>);})}
          </div>
        </div>);})()}

      </div>
    </div>
  );
}

function EQ({trades}){
  const sorted=[...trades].filter(t=>t.date&&t.pnl).sort((a,b)=>a.date.localeCompare(b.date));
  if(!sorted.length)return<div style={{textAlign:"center",padding:24,color:"#5A5A72",fontSize:12,fontFamily:"'JetBrains Mono',monospace"}}>No data yet.</div>;
  const dp=[];const seen={};sorted.forEach(t=>{if(!seen[t.date]){seen[t.date]={date:t.date,pnl:0};dp.push(seen[t.date]);}seen[t.date].pnl+=parseFloat(t.pnl)||0;});
  let cum=0;const pts=dp.map(d=>{cum+=d.pnl;return{date:d.date,c:cum};});
  const W=820,H=160,pL=48,pR=16,pT=16,pB=24,pW=W-pL-pR,pH=H-pT-pB;
  const mx=Math.max(...pts.map(p=>p.c),0),mn2=Math.min(...pts.map(p=>p.c),0),rn=mx-mn2||1;
  const xS=i=>pL+(i/Math.max(pts.length-1,1))*pW,yS=v=>pT+pH-((v-mn2)/rn)*pH;
  const lp=pts.map((p,i)=>`${i===0?"M":"L"}${xS(i).toFixed(1)},${yS(p.c).toFixed(1)}`).join(" ");
  const ap=`${lp} L${xS(pts.length-1).toFixed(1)},${(pT+pH).toFixed(1)} L${xS(0).toFixed(1)},${(pT+pH).toFixed(1)} Z`;
  const last=pts[pts.length-1],lc=last.c>=0?"#00E676":"#FF3D3D";
  return(<svg viewBox={`0 0 ${W} ${H}`} style={{width:"100%",height:"auto"}}><defs><linearGradient id="eq_grad" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={lc} stopOpacity="0.15"/><stop offset="100%" stopColor={lc} stopOpacity="0"/></linearGradient></defs><line x1={pL} y1={yS(0)} x2={W-pR} y2={yS(0)} stroke="#1A1A26" strokeWidth={1} strokeDasharray="3,4"/><text x={pL-6} y={yS(0)+4} textAnchor="end" fill="#5A5A72" fontSize={8} fontFamily="JetBrains Mono">0%</text><path d={ap} fill="url(#eq_grad)"/><path d={lp} fill="none" stroke={lc} strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round"/><circle cx={xS(pts.length-1)} cy={yS(last.c)} r={3.5} fill={lc}/><text x={xS(pts.length-1)} y={yS(last.c)-8} textAnchor="middle" fill={lc} fontSize={9} fontWeight={700} fontFamily="JetBrains Mono">{last.c>=0?"+":""}{last.c.toFixed(2)}%</text><text x={pL} y={H-4} textAnchor="start" fill="#5A5A72" fontSize={7} fontFamily="JetBrains Mono">{pts[0].date}</text><text x={W-pR} y={H-4} textAnchor="end" fill="#5A5A72" fontSize={7} fontFamily="JetBrains Mono">{last.date}</text></svg>);
}
