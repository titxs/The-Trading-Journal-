import { useState, useEffect, useRef } from "react";
import { db, storage } from "./firebase";
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

const F = "'JetBrains Mono',monospace";
const bg="#08080C",bg2="#0E0E14",bg3="#14141C",b1="#1C1C28",b2="#252535",g="#00E676",r="#FF3D3D",y="#FFD600",bl="#448AFF",cy="#18FFFF",w="#F0F0F5",gr="#6B6B80",gd="#3D3D50";
const iS={width:"100%",padding:"10px 12px",background:bg,color:w,border:`1px solid ${b2}`,borderRadius:8,fontSize:13,fontFamily:F,outline:"none"};
const cS={background:bg2,border:`1px solid ${b1}`,borderRadius:12,padding:20,marginBottom:12};

function calcRR(t){const e=parseFloat(t.entry),s=parseFloat(t.stop),tp=parseFloat(t.tp1);if(!e||!s||!tp)return"";const risk=Math.abs(e-s);if(!risk)return"";return(Math.abs(tp-e)/risk).toFixed(1);}
function calcTP(t){const e=parseFloat(t.entry),c=parseFloat(t.closePrice);if(!e||!c)return"";const p=((c-e)/e)*100*(t.direction==="SHORT"?-1:1);return p.toFixed(2);}
function signPnl(result,v){const n=Math.abs(parseFloat(v)||0);if(result==="LOSS")return-n;if(result==="BE")return 0;return n;}

function Sec({title,children,accent=g}){return(<div style={cS}><div style={{fontSize:11,fontWeight:700,color:accent,textTransform:"uppercase",letterSpacing:"0.1em",fontFamily:F,marginBottom:16,display:"flex",alignItems:"center",gap:8}}><div style={{width:3,height:14,background:accent,borderRadius:2}}/>{title}</div>{children}</div>);}
function Fld({label,children}){return(<div style={{marginBottom:12}}><div style={{fontSize:10,color:gr,textTransform:"uppercase",letterSpacing:"0.08em",fontFamily:F,marginBottom:6,fontWeight:600}}>{label}</div>{children}</div>);}
function Pill({label,selected,onClick,color=g}){return(<button onClick={onClick} style={{padding:"6px 14px",borderRadius:20,border:`1px solid ${selected?color:b2}`,background:selected?`${color}15`:"transparent",color:selected?color:gr,fontSize:11,fontFamily:F,fontWeight:600,cursor:"pointer",transition:"all 0.2s",whiteSpace:"nowrap"}}>{label}</button>);}
function RCard({o,sel,onClick}){return(<button onClick={onClick} style={{flex:1,minWidth:130,padding:"10px 12px",background:sel?`${o.color}10`:bg,border:`1px solid ${sel?o.color:b2}`,borderRadius:10,cursor:"pointer",textAlign:"left"}}><div style={{fontSize:10,fontWeight:700,color:sel?o.color:gr,fontFamily:F}}>{o.label}</div><div style={{fontSize:8,color:gd,fontFamily:F,marginTop:3,lineHeight:1.4}}>{o.desc}</div></button>);}
function SB({label,value,color=w}){return(<div style={{background:bg2,border:`1px solid ${b1}`,borderRadius:10,padding:"14px 16px",textAlign:"center",flex:1,minWidth:90}}><div style={{fontSize:22,fontWeight:700,color,fontFamily:F}}>{value}</div><div style={{fontSize:9,color:gr,textTransform:"uppercase",letterSpacing:"0.08em",fontFamily:F,marginTop:4}}>{label}</div></div>);}

export default function TradeJournal(){
  const[trades,setTrades]=useState([]);
  const[ct,setCt]=useState({...defaultTrade});
  const[view,setView]=useState("log");
  const[editingId,setEditingId]=useState(null);
  const[expTrade,setExpTrade]=useState(null);
  const[filterR,setFilterR]=useState("ALL");
  const[calMonth,setCalMonth]=useState(new Date());
  const[selDay,setSelDay]=useState(null);
  const[saving,setSaving]=useState(false);
  const[ssFiles,setSsFiles]=useState([]);
  const[sFilter,setSFilter]=useState("all");
  const fRef=useRef(null);

  useEffect(()=>{const q=query(collection(db,COLLECTION),orderBy("createdAt","desc"));const u=onSnapshot(q,s=>{setTrades(s.docs.map(d=>({id:d.id,...d.data()})));},e=>console.error(e));return()=>u();},[]);

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
      await save(trade);setEditingId(null);setCt({...defaultTrade});setSsFiles([]);setView("dashboard");
    }catch(e){console.error(e);alert("Failed to save.");}finally{setSaving(false);}
  };

  const up=(k,v)=>setCt(p=>({...p,[k]:v}));
  const tog=(k,v)=>setCt(p=>({...p,[k]:p[k]?.includes(v)?p[k].filter(x=>x!==v):[...(p[k]||[]),v]}));

  const gf=(f)=>{if(f==="all")return trades.filter(t=>t.result);if(f.startsWith("setup_"))return trades.filter(t=>t.result&&t.setup===f.replace("setup_",""));if(f.startsWith("regime_"))return trades.filter(t=>t.result&&t.regime===f.replace("regime_",""));return trades.filter(t=>t.result);};
  const cs=(fl)=>{const t=fl.length,wi=fl.filter(x=>x.result==="WIN").length,lo=fl.filter(x=>x.result==="LOSS").length,be=fl.filter(x=>x.result==="BE").length;const wr=t?((wi/t)*100).toFixed(1):"0";const pnls=fl.filter(x=>x.pnl).map(x=>parseFloat(x.pnl));const tp=pnls.reduce((a,b)=>a+b,0).toFixed(2);const dols=fl.filter(x=>x.pnlDollar).map(x=>parseFloat(x.pnlDollar));const td=dols.length?dols.reduce((a,b)=>a+b,0).toFixed(2):"0";const wRR=fl.filter(x=>x.result==="WIN"&&x.rr).map(x=>parseFloat(x.rr));const ar=wRR.length?(wRR.reduce((a,b)=>a+b,0)/wRR.length).toFixed(1):"0";const rf=fl.filter(x=>x.followedRules==="YES").length;const rr=t?((rf/t)*100).toFixed(0):"0";const bt=pnls.length?Math.max(...pnls).toFixed(2):"0";const wt=pnls.length?Math.min(...pnls).toFixed(2):"0";const tps=fl.filter(x=>x.tradePercent).map(x=>parseFloat(x.tradePercent));const ttp=tps.reduce((a,b)=>a+b,0).toFixed(2);return{total:t,wins:wi,losses:lo,be,winRate:wr,totalPnl:tp,totalDollar:td,avgRR:ar,rulesRate:rr,bestTrade:bt,worstTrade:wt,totalTradePercent:ttp};};

  const yr=calMonth.getFullYear(),mo=calMonth.getMonth(),dim=new Date(yr,mo+1,0).getDate(),fdw=new Date(yr,mo,1).getDay();
  const mn=["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  const td2=new Date();
  const pbd={},dbd={},tbd={},tlbd={};
  trades.forEach(t=>{if(!t.date)return;const p=parseFloat(t.pnl)||0,d=parseFloat(t.pnlDollar)||0;if(!pbd[t.date]){pbd[t.date]=0;dbd[t.date]=0;tbd[t.date]=0;tlbd[t.date]=[];}pbd[t.date]+=p;dbd[t.date]+=d;tbd[t.date]+=1;tlbd[t.date].push(t);});
  const ms=`${yr}-${String(mo+1).padStart(2,"0")}`;
  let mp=0,md=0,mt=0,mw=0,ml=0;
  Object.keys(pbd).forEach(d=>{if(d.startsWith(ms)){mp+=pbd[d];md+=dbd[d]||0;mt+=tbd[d];if(pbd[d]>0)mw++;if(pbd[d]<0)ml++;}});

  return(
    <div style={{minHeight:"100vh",background:bg,color:w,fontFamily:F,paddingBottom:40}}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600;700&display=swap');*{box-sizing:border-box;}input:focus,textarea:focus{border-color:${g}!important;}::-webkit-scrollbar{width:4px;}::-webkit-scrollbar-thumb{background:${b2};border-radius:4px;}@keyframes fadeIn{from{opacity:0;transform:translateY(8px);}to{opacity:1;transform:translateY(0);}}.fi{animation:fadeIn .3s ease both;}`}</style>

      <div style={{padding:"16px 20px",borderBottom:`1px solid ${b1}`,display:"flex",alignItems:"center",gap:10,background:bg2}}>
        <div style={{width:32,height:32,borderRadius:8,background:`linear-gradient(135deg,${g},${cy})`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:16,fontWeight:700,color:bg}}>T</div>
        <div><div style={{fontSize:14,fontWeight:700}}>Trading Journal</div><div style={{fontSize:9,color:gr}}>BTC/USD · Orderflow</div></div>
      </div>

      <div style={{display:"flex",gap:4,padding:"8px 20px",borderBottom:`1px solid ${b1}`,background:bg2}}>
        {[{id:"log",l:editingId?"✏️ Edit":"＋ Log"},{id:"dashboard",l:"📅 P&L"},{id:"history",l:"📋 History"},{id:"stats",l:"📊 Stats"}].map(t=>
          <button key={t.id} onClick={()=>{setView(t.id);setSelDay(null);}} style={{padding:"8px 16px",borderRadius:"8px 8px 0 0",border:"none",cursor:"pointer",fontSize:11,fontWeight:600,fontFamily:F,background:view===t.id?`${g}12`:"transparent",color:view===t.id?g:gr,borderBottom:view===t.id?`2px solid ${g}`:"2px solid transparent"}}>{t.l}</button>
        )}
      </div>

      <div style={{maxWidth:900,margin:"0 auto",padding:"20px 16px"}}>

      {view==="log"&&(<div className="fi">
        <Sec title="Trade Setup"><div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:12}}>
          <Fld label="Date"><input type="date" value={ct.date} onChange={e=>up("date",e.target.value)} style={iS}/></Fld>
          <Fld label="Pair"><input value={ct.pair} onChange={e=>up("pair",e.target.value)} style={iS}/></Fld>
          <Fld label="Direction"><div style={{display:"flex",gap:6}}>{["LONG","SHORT"].map(d=><button key={d} onClick={()=>up("direction",d)} style={{flex:1,padding:"10px 0",borderRadius:8,border:`1px solid ${ct.direction===d?(d==="LONG"?g:r):b2}`,background:ct.direction===d?(d==="LONG"?`${g}20`:`${r}20`):bg,color:ct.direction===d?(d==="LONG"?g:r):gr,fontFamily:F,fontSize:12,fontWeight:700,cursor:"pointer"}}>{d==="LONG"?"▲":"▼"} {d}</button>)}</div></Fld>
        </div></Sec>

        <Sec title="Regime & Setup" accent={y}>
          <Fld label="Market Regime"><div style={{display:"flex",gap:6,flexWrap:"wrap"}}>{regimeOptions.map(o=><RCard key={o.id} o={o} sel={ct.regime===o.id} onClick={()=>up("regime",o.id)}/>)}</div></Fld>
          <Fld label="Setup Type"><div style={{display:"flex",gap:6,flexWrap:"wrap"}}>{setupOptions.map(o=><RCard key={o.id} o={o} sel={ct.setup===o.id} onClick={()=>up("setup",o.id)}/>)}</div></Fld>
        </Sec>

        <Sec title="Key Level" accent={bl}>
          <Fld label="Price Level"><input value={ct.keyLevel} onChange={e=>up("keyLevel",e.target.value)} placeholder="e.g. 78005" style={iS}/></Fld>
          <Fld label="Level Type (stacked = stronger)"><div style={{display:"flex",gap:6,flexWrap:"wrap"}}>{levelTypes.map(l=><Pill key={l} label={l} selected={ct.levelType?.includes(l)} onClick={()=>tog("levelType",l)} color={bl}/>)}</div><div style={{marginTop:8}}><input value={ct.levelTypeOther||""} onChange={e=>up("levelTypeOther",e.target.value)} placeholder="Other level type..." style={{...iS,fontSize:11}}/></div></Fld>
        </Sec>

        <Sec title="Confluence" accent={cy}>
          <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>{confluenceOptions.map(c=><Pill key={c} label={c} selected={ct.confluence?.includes(c)} onClick={()=>tog("confluence",c)} color={cy}/>)}</div>
          <div style={{marginTop:8}}><input value={ct.confluenceOther||""} onChange={e=>up("confluenceOther",e.target.value)} placeholder="Other confluence..." style={{...iS,fontSize:11}}/></div>
          <div style={{marginTop:8,fontSize:11,fontWeight:600,color:(ct.confluence?.length||0)>=3?g:(ct.confluence?.length||0)>=1?y:r}}>{ct.confluence?.length||0} factor{(ct.confluence?.length||0)!==1?"s":""}{(ct.confluence?.length||0)===0?" → No confluence":""}{(ct.confluence?.length||0)>=1&&(ct.confluence?.length||0)<3?" → Low confluence":""}{(ct.confluence?.length||0)>=3?" → Strong confluence":""}</div>
        </Sec>

        <Sec title="Execution">
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>
            <Fld label="Conviction"><div style={{display:"flex",gap:4}}>{["LOW","MED","HIGH"].map(c=><Pill key={c} label={c} selected={ct.conviction===c} onClick={()=>up("conviction",c)} color={c==="HIGH"?g:c==="MED"?y:r}/>)}</div></Fld>
            <Fld label="Entry Type"><div style={{display:"flex",gap:4}}>{["Aggressive","Conservative"].map(t=><Pill key={t} label={t} selected={ct.entryType===t} onClick={()=>up("entryType",t)}/>)}</div></Fld>
          </div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr 1fr 1fr 1fr",gap:10}}>
            {[{k:"entry",l:"Entry",p:"Entry price"},{k:"stop",l:"Stop Loss",p:"SL price"},{k:"tp1",l:"TP1",p:"Target 1"},{k:"tp2",l:"TP2",p:"Target 2"},{k:"posSize",l:"Size",p:"1%"},{k:"leverage",l:"Leverage",p:"e.g. 10x"}].map(f=><Fld key={f.k} label={f.l}><input value={ct[f.k]} onChange={e=>up(f.k,e.target.value)} placeholder={f.p} style={iS}/></Fld>)}
          </div>
          {ct.entry&&ct.stop&&ct.tp1&&<div style={{fontSize:12,color:g,fontWeight:600,marginTop:4}}>R:R → {calcRR(ct)}:1</div>}
        </Sec>

        <Sec title="Result" accent={y}>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr 1fr",gap:12}}>
            <Fld label="Outcome"><div style={{display:"flex",gap:6}}>{["WIN","LOSS","BE"].map(x=><button key={x} onClick={()=>up("result",x)} style={{flex:1,padding:"10px 0",borderRadius:8,border:`1px solid ${ct.result===x?(x==="WIN"?g:x==="LOSS"?r:y):b2}`,background:ct.result===x?(x==="WIN"?`${g}20`:x==="LOSS"?`${r}20`:`${y}20`):bg,color:ct.result===x?(x==="WIN"?g:x==="LOSS"?r:y):gr,fontFamily:F,fontSize:11,fontWeight:700,cursor:"pointer"}}>{x}</button>)}</div></Fld>
            <Fld label={`P&L % ${ct.result==="LOSS"?"(auto -)":ct.result==="WIN"?"(auto +)":""}`}><input value={ct.pnl} onChange={e=>up("pnl",e.target.value)} placeholder="e.g. 3.34" style={iS}/></Fld>
            <Fld label="P&L $"><input value={ct.pnlDollar} onChange={e=>up("pnlDollar",e.target.value)} placeholder="e.g. 150" style={iS}/></Fld>
            <Fld label="Close Price"><input value={ct.closePrice||""} onChange={e=>up("closePrice",e.target.value)} placeholder="Actual close" style={iS}/></Fld>
          </div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:12}}>
            <Fld label="TP Hits"><div style={{display:"flex",gap:8}}>{[{k:"hitTp1",l:"TP1"},{k:"hitTp2",l:"TP2"}].map(tp=><button key={tp.k} onClick={()=>up(tp.k,!ct[tp.k])} style={{padding:"8px 14px",borderRadius:8,border:`1px solid ${ct[tp.k]?g:b2}`,background:ct[tp.k]?`${g}15`:bg,color:ct[tp.k]?g:gr,fontSize:11,fontFamily:F,fontWeight:600,cursor:"pointer"}}>{ct[tp.k]?"✓":"○"} {tp.l}</button>)}</div></Fld>
            <Fld label="Rules Followed"><div style={{display:"flex",gap:6}}>{["YES","NO"].map(x=><Pill key={x} label={x} selected={ct.followedRules===x} onClick={()=>up("followedRules",x)} color={x==="YES"?g:r}/>)}</div></Fld>
            <Fld label="Trade % (no leverage)"><div style={{...iS,background:bg3,cursor:"default",color:ct.entry&&ct.closePrice?(parseFloat(calcTP(ct))>=0?g:r):gd}}>{ct.entry&&ct.closePrice?`${calcTP(ct)}%`:"Auto from entry/close"}</div></Fld>
          </div>
        </Sec>

        <Sec title="Journal" accent={w}>
          <Fld label="What confirmed the setup?"><textarea value={ct.confirmed||""} onChange={e=>up("confirmed",e.target.value)} rows={2} placeholder="What trapped traders? What did orderflow show?" style={{...iS,resize:"vertical"}}/></Fld>
          <Fld label="Mistakes or rules broken"><textarea value={ct.mistakes||""} onChange={e=>up("mistakes",e.target.value)} rows={2} placeholder="Any FOMO? Entered too early? Didn't wait for confirmation?" style={{...iS,resize:"vertical"}}/></Fld>
          <Fld label="What would I do differently?"><textarea value={ct.different||""} onChange={e=>up("different",e.target.value)} rows={2} placeholder="e.g. Wait for backtest, take partials at TP1" style={{...iS,resize:"vertical"}}/></Fld>
          <Fld label="Notes"><textarea value={ct.notes||""} onChange={e=>up("notes",e.target.value)} rows={2} placeholder="Market context, mindset, anything else..." style={{...iS,resize:"vertical"}}/></Fld>
        </Sec>

        <Sec title="Screenshots" accent={gr}>
          <input ref={fRef} type="file" multiple accept="image/*" onChange={e=>{Array.from(e.target.files).forEach(f=>{const rd=new FileReader();rd.onload=ev=>{setCt(p=>({...p,screenshots:[...p.screenshots,ev.target.result]}));setSsFiles(p=>[...p,f]);};rd.readAsDataURL(f);});}} style={{display:"none"}}/>
          <button onClick={()=>fRef.current?.click()} style={{width:"100%",padding:12,background:bg,border:`1px dashed ${b2}`,borderRadius:8,color:gr,fontSize:12,fontFamily:F,cursor:"pointer"}}>+ Add Screenshots</button>
          {ct.screenshots?.length>0&&<div style={{display:"flex",gap:8,marginTop:10,flexWrap:"wrap"}}>{ct.screenshots.map((s,i)=><div key={i} style={{position:"relative"}}><img src={s} alt="" style={{width:80,height:60,objectFit:"cover",borderRadius:6,border:`1px solid ${b1}`}}/><button onClick={()=>{setCt(p=>({...p,screenshots:p.screenshots.filter((_,j)=>j!==i)}));setSsFiles(p=>p.filter((_,j)=>j!==i));}} style={{position:"absolute",top:-6,right:-6,width:18,height:18,borderRadius:"50%",background:r,border:"none",color:w,fontSize:10,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center"}}>×</button></div>)}</div>}
        </Sec>

        <button onClick={submit} disabled={!ct.date||!ct.direction||!ct.keyLevel||saving} style={{width:"100%",padding:16,marginTop:8,border:"none",borderRadius:10,fontSize:13,fontWeight:700,fontFamily:F,textTransform:"uppercase",letterSpacing:"0.05em",cursor:saving?"not-allowed":"pointer",background:saving||!ct.date||!ct.direction||!ct.keyLevel?bg3:`linear-gradient(135deg,${g},${cy})`,color:saving||!ct.date||!ct.direction||!ct.keyLevel?gd:bg}}>{saving?"SAVING...":editingId?"UPDATE TRADE":"LOG TRADE"}</button>
        {editingId&&<button onClick={()=>{setEditingId(null);setCt({...defaultTrade});setSsFiles([]);}} style={{width:"100%",padding:10,marginTop:6,background:"transparent",color:gr,border:`1px solid ${b1}`,borderRadius:8,fontSize:11,fontFamily:F,cursor:"pointer"}}>CANCEL EDIT</button>}
      </div>)}

      {view==="dashboard"&&(<div className="fi">
        <div style={{textAlign:"center",marginBottom:16}}>
          <span style={{fontSize:12,color:gr,fontWeight:600,textTransform:"uppercase",letterSpacing:"0.08em"}}>Monthly P/L: </span>
          <span style={{fontSize:22,fontWeight:700,color:mp>=0?g:r}}>{mp>=0?"+":""}{mp.toFixed(2)}%</span>
          {md!==0&&<span style={{fontSize:14,fontWeight:600,color:md>=0?g:r,opacity:0.7,marginLeft:8}}>({md>=0?"+":""}${Math.abs(md).toFixed(0)})</span>}
        </div>
        <div style={{display:"flex",gap:8,marginBottom:16,flexWrap:"wrap"}}>
          <SB label="Trades" value={mt}/><SB label="Green Days" value={mw} color={g}/><SB label="Red Days" value={ml} color={r}/><SB label="Monthly $" value={md!==0?`${md>=0?"+":""}$${Math.abs(md).toFixed(0)}`:"—"} color={md>=0?g:r}/>
        </div>
        <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:12}}>
          <button onClick={()=>setCalMonth(new Date(yr,mo-1,1))} style={{width:30,height:30,borderRadius:"50%",background:bg2,border:`1px solid ${b1}`,color:gr,cursor:"pointer",fontSize:14,display:"flex",alignItems:"center",justifyContent:"center",fontFamily:F}}>‹</button>
          <span style={{fontSize:14,fontWeight:700}}>{mn[mo]} {yr}</span>
          <button onClick={()=>setCalMonth(new Date(yr,mo+1,1))} style={{width:30,height:30,borderRadius:"50%",background:bg2,border:`1px solid ${b1}`,color:gr,cursor:"pointer",fontSize:14,display:"flex",alignItems:"center",justifyContent:"center",fontFamily:F}}>›</button>
        </div>
        <div style={{display:"grid",gridTemplateColumns:"repeat(7,1fr)",gap:3,marginBottom:3}}>{["Su","Mo","Tu","We","Th","Fr","Sa"].map(d=><div key={d} style={{textAlign:"center",fontSize:10,fontWeight:600,color:gr,padding:"4px 0"}}>{d}</div>)}</div>
        <div style={{display:"grid",gridTemplateColumns:"repeat(7,1fr)",gap:3}}>
          {Array(fdw).fill(null).map((_,i)=><div key={`e${i}`}/>)}
          {Array.from({length:dim},(_,i)=>i+1).map(day=>{
            const ds=`${yr}-${String(mo+1).padStart(2,"0")}-${String(day).padStart(2,"0")}`;
            const dp=pbd[ds],dd=dbd[ds],dc=tbd[ds],hd=dp!==undefined,ip=hd&&dp>0,iN=hd&&dp<0,iS2=selDay===ds,iT=td2.getFullYear()===yr&&td2.getMonth()===mo&&td2.getDate()===day;
            return(<button key={ds} onClick={()=>hd&&setSelDay(iS2?null:ds)} style={{minHeight:75,borderRadius:8,padding:"5px 6px",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"flex-start",gap:2,cursor:hd?"pointer":"default",background:iS2?`${ip?g:r}20`:ip?`${g}10`:iN?`${r}10`:bg2,border:`1px solid ${iS2?(ip?g:r):ip?`${g}25`:iN?`${r}25`:b1}`,fontFamily:F}}>
              <div style={{fontSize:10,color:iT?cy:gr,fontWeight:iT?700:500,alignSelf:"flex-start"}}>{iT?<span style={{background:cy,color:bg,borderRadius:"50%",width:18,height:18,display:"inline-flex",alignItems:"center",justifyContent:"center",fontSize:9}}>{day}</span>:day}</div>
              {hd&&<><div style={{fontSize:12,fontWeight:700,color:ip?g:iN?r:y,marginTop:2}}>{ip?"+":""}{dp.toFixed(2)}%</div>{dd!==undefined&&dd!==0&&<div style={{fontSize:9,fontWeight:600,color:ip?g:r,opacity:0.6}}>{dd>=0?"+":"-"}${Math.abs(dd).toFixed(0)}</div>}<div style={{fontSize:9,color:gr}}>{dc} trade{dc!==1?"s":""}</div></>}
            </button>);
          })}
        </div>
        {selDay&&tlbd[selDay]&&<div style={{marginTop:16}} className="fi"><div style={{fontSize:12,fontWeight:700,marginBottom:10}}>Trades on {selDay}</div>
          {tlbd[selDay].map(t=><div key={t.id} style={{...cS,padding:14,display:"flex",alignItems:"center",gap:12,cursor:"pointer"}} onClick={()=>{setCt({...defaultTrade,...t});setEditingId(t.id);setSsFiles([]);setView("log");}}>
            <div style={{padding:"3px 8px",borderRadius:4,fontSize:10,fontWeight:700,background:t.result==="WIN"?`${g}15`:t.result==="LOSS"?`${r}15`:`${y}15`,color:t.result==="WIN"?g:t.result==="LOSS"?r:y}}>{t.result}</div>
            <div style={{flex:1}}><span style={{fontSize:12,fontWeight:600}}>{t.pair}</span><span style={{fontSize:10,color:gr,marginLeft:8}}>{t.direction}</span>{t.setup&&<span style={{fontSize:9,color:gd,marginLeft:8}}>{setupOptions.find(s=>s.id===t.setup)?.label}</span>}</div>
            <div style={{fontSize:13,fontWeight:700,color:parseFloat(t.pnl)>=0?g:r}}>{parseFloat(t.pnl)>=0?"+":""}{t.pnl}%{t.pnlDollar&&<span style={{opacity:0.6,marginLeft:4,fontSize:11}}>(${t.pnlDollar})</span>}</div>
            <div style={{fontSize:9,color:bl}}>Edit →</div>
          </div>)}
        </div>}
        <div style={{...cS,marginTop:20}}><div style={{...{fontSize:10,color:gr,textTransform:"uppercase",letterSpacing:"0.08em",fontFamily:F,marginBottom:6,fontWeight:600},marginBottom:12}}>Equity Curve</div><EQ trades={trades}/></div>
      </div>)}

      {view==="history"&&(<div className="fi">
        <div style={{display:"flex",gap:6,marginBottom:16}}>{["ALL","WIN","LOSS","BE"].map(f=><Pill key={f} label={f} selected={filterR===f} onClick={()=>setFilterR(f)} color={f==="WIN"?g:f==="LOSS"?r:f==="BE"?y:w}/>)}</div>
        {trades.filter(t=>filterR==="ALL"||t.result===filterR).map(t=><div key={t.id} style={{...cS,padding:14,cursor:"pointer"}} onClick={()=>setExpTrade(expTrade===t.id?null:t.id)}>
          <div style={{display:"flex",alignItems:"center",gap:10}}>
            <div style={{padding:"3px 8px",borderRadius:4,fontSize:10,fontWeight:700,background:t.result==="WIN"?`${g}15`:t.result==="LOSS"?`${r}15`:`${y}15`,color:t.result==="WIN"?g:t.result==="LOSS"?r:y}}>{t.result||"—"}</div>
            <div style={{flex:1}}><span style={{fontSize:12,fontWeight:600}}>{t.date}</span><span style={{fontSize:10,color:gr,marginLeft:8}}>{t.direction} {t.pair}</span>{t.setup&&<span style={{fontSize:9,color:gd,marginLeft:8}}>{setupOptions.find(s=>s.id===t.setup)?.label}</span>}</div>
            {t.pnl&&<span style={{fontSize:12,fontWeight:700,color:parseFloat(t.pnl)>=0?g:r}}>{parseFloat(t.pnl)>=0?"+":""}{t.pnl}%{t.pnlDollar&&<span style={{opacity:0.6,marginLeft:4}}>(${t.pnlDollar})</span>}</span>}
            <span style={{color:gd,fontSize:10}}>{expTrade===t.id?"▲":"▼"}</span>
          </div>
          {expTrade===t.id&&<div style={{marginTop:14,paddingTop:14,borderTop:`1px solid ${b1}`}} className="fi">
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr 1fr",gap:10,marginBottom:12}}>{[{l:"Entry",v:t.entry},{l:"Stop",v:t.stop},{l:"TP1",v:t.tp1},{l:"Close",v:t.closePrice}].map(x=><div key={x.l}><span style={{fontSize:9,color:gr}}>{x.l}</span><div style={{fontSize:11}}>{x.v||"—"}</div></div>)}</div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr 1fr",gap:10,marginBottom:12}}>{[{l:"R:R",v:t.rr?`${t.rr}:1`:"—",c:g},{l:"Leverage",v:t.leverage||"—"},{l:"Trade %",v:t.tradePercent?`${t.tradePercent}%`:"—"},{l:"TP Hits",v:`${t.hitTp1?"TP1 ✓ ":""}${t.hitTp2?"TP2 ✓":""}`||"—"}].map(x=><div key={x.l}><span style={{fontSize:9,color:gr}}>{x.l}</span><div style={{fontSize:11,color:x.c||w}}>{x.v}</div></div>)}</div>
            {t.regime&&<div style={{marginBottom:8}}><span style={{fontSize:9,color:gr}}>Regime: </span><span style={{fontSize:10,color:regimeOptions.find(x=>x.id===t.regime)?.color||w}}>{regimeOptions.find(x=>x.id===t.regime)?.label}</span></div>}
            {t.levelType?.length>0&&<div style={{marginBottom:8}}><span style={{fontSize:9,color:gr}}>Levels: </span><span style={{fontSize:10,color:bl}}>{t.levelType.join(" · ")}</span></div>}
            {t.confluence?.length>0&&<div style={{marginBottom:8}}><span style={{fontSize:9,color:gr}}>Confluence: </span><span style={{fontSize:10,color:cy}}>{t.confluence.join(" · ")}</span></div>}
            {t.confirmed&&<div style={{marginBottom:6}}><span style={{fontSize:9,color:gr}}>Confirmation: </span><span style={{fontSize:10}}>{t.confirmed}</span></div>}
            {t.mistakes&&<div style={{marginBottom:6}}><span style={{fontSize:9,color:gr}}>Mistakes: </span><span style={{fontSize:10,color:r}}>{t.mistakes}</span></div>}
            {t.different&&<div style={{marginBottom:6}}><span style={{fontSize:9,color:gr}}>Do differently: </span><span style={{fontSize:10,color:y}}>{t.different}</span></div>}
            {t.notes&&<div style={{marginBottom:6}}><span style={{fontSize:9,color:gr}}>Notes: </span><span style={{fontSize:10}}>{t.notes}</span></div>}
            {t.screenshots?.length>0&&<div style={{display:"flex",gap:6,marginTop:8,flexWrap:"wrap"}}>{t.screenshots.map((s,i)=><img key={i} src={s} alt="" style={{width:100,height:70,objectFit:"cover",borderRadius:6,border:`1px solid ${b1}`}}/>)}</div>}
            <div style={{display:"flex",gap:8,marginTop:12}}>
              <button onClick={e=>{e.stopPropagation();setCt({...defaultTrade,...t});setEditingId(t.id);setSsFiles([]);setView("log");}} style={{padding:"6px 16px",borderRadius:6,background:`${bl}15`,border:`1px solid ${bl}30`,color:bl,fontSize:10,fontFamily:F,fontWeight:600,cursor:"pointer"}}>Edit</button>
              <button onClick={e=>{e.stopPropagation();if(confirm("Delete?"))del(t.id);}} style={{padding:"6px 16px",borderRadius:6,background:`${r}10`,border:`1px solid ${r}25`,color:r,fontSize:10,fontFamily:F,fontWeight:600,cursor:"pointer"}}>Delete</button>
            </div>
          </div>}
        </div>)}
      </div>)}

      {view==="stats"&&(()=>{const fl=gf(sFilter),s=cs(fl);return(<div className="fi">
        <div style={{display:"flex",gap:4,marginBottom:16,flexWrap:"wrap"}}>
          <Pill label="All" selected={sFilter==="all"} onClick={()=>setSFilter("all")} color={w}/>
          {setupOptions.map(o=><Pill key={o.id} label={o.label} selected={sFilter===`setup_${o.id}`} onClick={()=>setSFilter(`setup_${o.id}`)} color={o.color}/>)}
          {regimeOptions.slice(0,4).map(o=><Pill key={o.id} label={o.label} selected={sFilter===`regime_${o.id}`} onClick={()=>setSFilter(`regime_${o.id}`)} color={o.color}/>)}
        </div>
        <div style={{display:"flex",gap:8,flexWrap:"wrap",marginBottom:12}}><SB label="Trades" value={s.total}/><SB label="Win Rate" value={`${s.winRate}%`} color={parseFloat(s.winRate)>=50?g:r}/><SB label="Rules" value={`${s.rulesRate}%`} color={parseFloat(s.rulesRate)>=80?g:y}/></div>
        <div style={{display:"flex",gap:8,flexWrap:"wrap",marginBottom:12}}><SB label="Wins" value={s.wins} color={g}/><SB label="Losses" value={s.losses} color={r}/><SB label="BE" value={s.be} color={y}/><SB label="Avg RR" value={`${s.avgRR}:1`} color={g}/></div>
        <div style={{display:"flex",gap:8,flexWrap:"wrap",marginBottom:12}}><SB label="P&L %" value={`${parseFloat(s.totalPnl)>=0?"+":""}${s.totalPnl}%`} color={parseFloat(s.totalPnl)>=0?g:r}/><SB label="P&L $" value={parseFloat(s.totalDollar)!==0?`${parseFloat(s.totalDollar)>=0?"+":""}$${Math.abs(parseFloat(s.totalDollar)).toFixed(0)}`:"—"} color={parseFloat(s.totalDollar)>=0?g:r}/><SB label="Trade %" value={`${parseFloat(s.totalTradePercent)>=0?"+":""}${s.totalTradePercent}%`} color={parseFloat(s.totalTradePercent)>=0?g:r}/></div>
        <div style={{display:"flex",gap:8,flexWrap:"wrap",marginBottom:12}}><SB label="Best" value={`+${s.bestTrade}%`} color={g}/><SB label="Worst" value={`${s.worstTrade}%`} color={r}/></div>
        <div style={cS}><div style={{fontSize:10,color:gr,textTransform:"uppercase",letterSpacing:"0.08em",fontFamily:F,marginBottom:12,fontWeight:600}}>By Setup</div>
          {setupOptions.map(o=>{const st=cs(trades.filter(t=>t.result&&t.setup===o.id));if(!st.total)return null;return(<div key={o.id} style={{display:"flex",alignItems:"center",gap:12,padding:"8px 0",borderBottom:`1px solid ${b1}`}}><div style={{width:3,height:24,background:o.color,borderRadius:2}}/><div style={{flex:1,fontSize:11,fontWeight:700,color:o.color}}>{o.label}</div><div style={{fontSize:10,color:gr}}>{st.total}t</div><div style={{fontSize:10,color:parseFloat(st.winRate)>=50?g:r,fontWeight:600,minWidth:45}}>{st.winRate}%</div><div style={{fontSize:10,color:parseFloat(st.totalPnl)>=0?g:r,fontWeight:600,minWidth:55}}>{parseFloat(st.totalPnl)>=0?"+":""}{st.totalPnl}%</div><div style={{fontSize:10,color:g,minWidth:40}}>{st.avgRR}:1</div></div>);})}
        </div>
        <div style={cS}><div style={{fontSize:10,color:gr,textTransform:"uppercase",letterSpacing:"0.08em",fontFamily:F,marginBottom:12,fontWeight:600}}>By Regime</div>
          {regimeOptions.map(o=>{const rt=cs(trades.filter(t=>t.result&&t.regime===o.id));if(!rt.total)return null;return(<div key={o.id} style={{display:"flex",alignItems:"center",gap:12,padding:"8px 0",borderBottom:`1px solid ${b1}`}}><div style={{width:3,height:24,background:o.color,borderRadius:2}}/><div style={{flex:1,fontSize:11,fontWeight:700,color:o.color}}>{o.label}</div><div style={{fontSize:10,color:gr}}>{rt.total}t</div><div style={{fontSize:10,color:parseFloat(rt.winRate)>=50?g:r,fontWeight:600,minWidth:45}}>{rt.winRate}%</div><div style={{fontSize:10,color:parseFloat(rt.totalPnl)>=0?g:r,fontWeight:600,minWidth:55}}>{parseFloat(rt.totalPnl)>=0?"+":""}{rt.totalPnl}%</div><div style={{fontSize:10,color:g,minWidth:40}}>{rt.avgRR}:1</div></div>);})}
        </div>
      </div>);})()}

      </div>
    </div>
  );
}

function EQ({trades}){
  const sorted=[...trades].filter(t=>t.date&&t.pnl).sort((a,b)=>a.date.localeCompare(b.date));
  if(!sorted.length)return<div style={{textAlign:"center",padding:30,color:"#6B6B80",fontSize:12}}>Log trades to see equity curve.</div>;
  const dp=[];const seen={};sorted.forEach(t=>{if(!seen[t.date]){seen[t.date]={date:t.date,pnl:0};dp.push(seen[t.date]);}seen[t.date].pnl+=parseFloat(t.pnl)||0;});
  let cum=0;const pts=dp.map(d=>{cum+=d.pnl;return{date:d.date,c:cum};});
  const W=820,H=180,pL=50,pR=16,pT=16,pB=24,pW=W-pL-pR,pH=H-pT-pB;
  const mx=Math.max(...pts.map(p=>p.c),0),mn2=Math.min(...pts.map(p=>p.c),0),rn=mx-mn2||1;
  const xS=i=>pL+(i/Math.max(pts.length-1,1))*pW,yS=v=>pT+pH-((v-mn2)/rn)*pH;
  const lp=pts.map((p,i)=>`${i===0?"M":"L"}${xS(i).toFixed(1)},${yS(p.c).toFixed(1)}`).join(" ");
  const ap=`${lp} L${xS(pts.length-1).toFixed(1)},${yS(0).toFixed(1)} L${xS(0).toFixed(1)},${yS(0).toFixed(1)} Z`;
  const last=pts[pts.length-1],lc=last.c>=0?"#00E676":"#FF3D3D";
  return(<svg viewBox={`0 0 ${W} ${H}`} style={{width:"100%",height:"auto"}}><line x1={pL} y1={yS(0)} x2={W-pR} y2={yS(0)} stroke="#252535" strokeWidth={1} strokeDasharray="4,4"/><text x={pL-6} y={yS(0)+4} textAnchor="end" fill="#6B6B80" fontSize={9} fontFamily="JetBrains Mono">0%</text><path d={ap} fill={lc} opacity={0.06}/><path d={lp} fill="none" stroke={lc} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round"/><circle cx={xS(pts.length-1)} cy={yS(last.c)} r={4} fill={lc}/><text x={xS(pts.length-1)} y={yS(last.c)-8} textAnchor="middle" fill={lc} fontSize={10} fontWeight={700} fontFamily="JetBrains Mono">{last.c>=0?"+":""}{last.c.toFixed(2)}%</text><text x={pL} y={H-4} textAnchor="start" fill="#6B6B80" fontSize={8} fontFamily="JetBrains Mono">{pts[0].date}</text><text x={W-pR} y={H-4} textAnchor="end" fill="#6B6B80" fontSize={8} fontFamily="JetBrains Mono">{last.date}</text></svg>);
}
