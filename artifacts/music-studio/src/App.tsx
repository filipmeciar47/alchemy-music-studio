import { useState, useRef, useCallback, useEffect } from "react";
import { analyze } from "./audioAnalysis";
import { repairOrFallback } from "./seqValidator";

const C={bg:"#1a1a2e",bgD:"#0e0e1a",bgP:"#14142a",bgL:"#222244",ac:"#ff6b35",ac2:"#00d4aa",ac3:"#7b68ee",tx:"#e0e0e0",txD:"#7777aa",bd:"#252545",wf:"#00d4aa",wfBg:"#0a0a15",red:"#ff4455",grn:"#44ff88"};
const TK={bg:"#0d0d0d",bgD:"#080808",bgP:"#111111",bgL:"#1a1a1a",ac:"#00ffaa",ac2:"#ff0066",ac3:"#ffcc00",tx:"#cccccc",txD:"#555555",bd:"#222222",wf:"#00ffaa",wfBg:"#050505",red:"#ff0044",grn:"#00ff66"};
const TC=["#00d4aa","#7b68ee","#ff6b35","#ff4488","#44bbff","#ffcc00","#88ff44","#ff8844","#aa66ff","#66ffcc"];
const TKC=["#00ffaa","#ff0066","#ffcc00","#00ccff","#ff6600","#cc44ff","#66ff44","#ff3388","#44ffcc","#ffaa00"];

const FX0={gain:1,fadeIn:0,fadeOut:0,lpFreq:20000,hpFreq:20,saturation:0,delay:0,delayTime:.25,delayFb:.3,compress:0,loop:1,reverb:0,reverbDecay:1.5,chorus:0,chorusRate:.5,bitCrush:0,speed:1};
const SWATCH=["#ff6b35","#00d4aa","#7b68ee","#ff4488","#44bbff","#ffcc00","#88ff44","#ff8844","#aa66ff","#ff0066","#00ffaa","#e5523b","#66ccff","#ff99cc","#99ff66"];
// EQ multiplier (0..3, 1=flat) -> dB for live BiquadFilter
const eqDb=(m: number)=>m<=0?-40:Math.max(-40,Math.min(18,20*Math.log10(m)));

const b1=(a: boolean,c: string|null,t: any)=>{const p=t||C;return{background:a?(c||p.ac):p.bgL,color:a?"#fff":p.tx,border:`1px solid ${a?(c||p.ac):p.bd}`,borderRadius:3,padding:"6px 12px",cursor:"pointer",fontSize:12,fontFamily:"inherit",fontWeight:a?600:400};};
const sb=(a: boolean,c: string|null,t: any)=>({...b1(a,c,t),padding:"3px 8px",fontSize:11});
const LBL=176;


function drawWf(cv: HTMLCanvasElement|null,buf: AudioBuffer|undefined,sel: {start:number,end:number}|null,pos: number|null,th: any){if(!cv)return;const p=th||C;const x=cv.getContext("2d");if(!x)return;const w=cv.width,h=cv.height;x.fillStyle=p.wfBg;x.fillRect(0,0,w,h);x.strokeStyle=p.bd;x.lineWidth=.5;for(let i=1;i<10;i++){const px=(w/10)*i;x.beginPath();x.moveTo(px,0);x.lineTo(px,h);x.stroke();}x.beginPath();x.moveTo(0,h/2);x.lineTo(w,h/2);x.stroke();if(sel){x.fillStyle="rgba(255,107,53,.12)";x.fillRect(sel.start*w,0,(sel.end-sel.start)*w,h);}if(!buf)return;const d=buf.getChannelData(0),st=Math.max(1,Math.floor(d.length/w));x.beginPath();x.strokeStyle=p.wf;x.lineWidth=1;for(let i=0;i<w;i++){let mn=1,mx2=-1;for(let j=0;j<st;j++){const idx=i*st+j;if(idx<d.length){if(d[idx]<mn)mn=d[idx];if(d[idx]>mx2)mx2=d[idx];}}x.moveTo(i,(1-mx2)*h/2);x.lineTo(i,(1-mn)*h/2);}x.stroke();if(pos!=null){x.strokeStyle="#fff";x.lineWidth=1.5;x.beginPath();x.moveTo(pos*w,0);x.lineTo(pos*w,h);x.stroke();}}

function applyFx(buf: AudioBuffer,fx: any,ctx: AudioContext){const len=buf.length,ch=buf.numberOfChannels,sr=buf.sampleRate,out=ctx.createBuffer(ch,len,sr);for(let c=0;c<ch;c++){const inp=buf.getChannelData(c),o=out.getChannelData(c);for(let j=0;j<len;j++)o[j]=inp[j];if(fx.gain!=null&&fx.gain!==1)for(let j=0;j<len;j++)o[j]*=fx.gain;if(fx.reverse)for(let j=0;j<len/2;j++){const t=o[j];o[j]=o[len-1-j];o[len-1-j]=t;}if(fx.normalize){let m=0;for(let j=0;j<len;j++){const a=Math.abs(o[j]);if(a>m)m=a;}if(m>0){const s=.95/m;for(let j=0;j<len;j++)o[j]*=s;}}if(fx.fadeIn>0){const s=Math.floor(fx.fadeIn*sr);for(let j=0;j<Math.min(s,len);j++)o[j]*=j/s;}if(fx.fadeOut>0){const s=Math.floor(fx.fadeOut*sr);for(let j=0;j<Math.min(s,len);j++)o[len-1-j]*=j/s;}if(fx.lpFreq!=null&&fx.lpFreq<20000){const rc=1/(2*Math.PI*fx.lpFreq),dt=1/sr,a=dt/(rc+dt);let p2=o[0];for(let j=1;j<len;j++){o[j]=p2+a*(o[j]-p2);p2=o[j];}}if(fx.hpFreq!=null&&fx.hpFreq>20){const rc=1/(2*Math.PI*fx.hpFreq),dt=1/sr,a=rc/(rc+dt);let p2=o[0],pi=o[0];for(let j=1;j<len;j++){const v=a*(p2+o[j]-pi);pi=o[j];o[j]=v;p2=v;}}if(fx.saturation>0)for(let j=0;j<len;j++)o[j]=Math.tanh(o[j]*(1+fx.saturation*3))/(1+fx.saturation*.5);if(fx.delay>0){const dt2=Math.floor((fx.delayTime||.25)*sr),fb=fx.delayFb||.4;for(let j=dt2;j<len;j++)o[j]+=o[j-dt2]*fb*fx.delay;}if(fx.compress>0){const th2=1-fx.compress*.7,rat=1+fx.compress*8;for(let j=0;j<len;j++){const a=Math.abs(o[j]);if(a>th2)o[j]*=(th2+(a-th2)/rat)/a;}}
    if(fx.chorus>0){const rate=fx.chorusRate||.5,depth=Math.floor((.003+fx.chorus*.009)*sr),wet=fx.chorus,tmp=new Float32Array(len);for(let j=0;j<len;j++){const lfo=Math.sin(2*Math.PI*rate*j/sr);const di=Math.floor(depth*(lfo*.5+.5));tmp[j]=j-di>=0?o[j-di]:0;}for(let j=0;j<len;j++)o[j]=o[j]*(1-wet*.4)+tmp[j]*wet*.4;}
    if(fx.bitCrush>0){const bits=Math.max(1,Math.round(16-fx.bitCrush*14)),step=2/Math.pow(2,bits);for(let j=0;j<len;j++)o[j]=Math.round(o[j]/step)*step;}
    if(fx.reverb>0){const wet=fx.reverb,decay=fx.reverbDecay||1.5,dry=new Float32Array(len);for(let j=0;j<len;j++)dry[j]=o[j];const taps=[.023,.031,.041,.053,.067,.083,.1,.13,.17];for(let t=0;t<taps.length;t++){const tapS=Math.floor(taps[t]*sr),g=wet*.28*Math.exp(-taps[t]*2.5/decay);for(let j=tapS;j<len;j++)o[j]+=dry[j-tapS]*g;}}}
  // Speed resampling (linear interpolation) — must be last as it changes buffer length
  if(fx.speed&&fx.speed!==1&&fx.speed>0){const spd=Math.max(.1,Math.min(4,fx.speed));const newLen=Math.round(len/spd);const spdBuf=ctx.createBuffer(ch,newLen,sr);for(let c=0;c<ch;c++){const src=out.getChannelData(c),dst=spdBuf.getChannelData(c);for(let i=0;i<newLen;i++){const p=i*spd;const pi=Math.floor(p),frac=p-pi;dst[i]=(src[pi]||0)*(1-frac)+((pi+1<len?src[pi+1]:0)||0)*frac;}}return spdBuf;}
  return out;}

function trimSil(buf: AudioBuffer,ctx: AudioContext){const d=buf.getChannelData(0);let s=0,e=d.length-1;while(s<d.length&&Math.abs(d[s])<.01)s++;while(e>s&&Math.abs(d[e])<.01)e--;s=Math.max(0,s-80);e=Math.min(d.length-1,e+80);const l=e-s+1,o=ctx.createBuffer(buf.numberOfChannels,l,buf.sampleRate);for(let c=0;c<buf.numberOfChannels;c++){const src=buf.getChannelData(c),dst=o.getChannelData(c);for(let i=0;i<l;i++)dst[i]=src[s+i];}return o;}
function cropT(buf: AudioBuffer,ss: number,es: number,ctx: AudioContext){const s=Math.max(0,Math.floor(ss*buf.sampleRate)),e=Math.min(buf.length,Math.floor(es*buf.sampleRate)),l=e-s;if(l<=0)return buf;const o=ctx.createBuffer(buf.numberOfChannels,l,buf.sampleRate);for(let c=0;c<buf.numberOfChannels;c++){const src=buf.getChannelData(c),dst=o.getChannelData(c);for(let i=0;i<l;i++)dst[i]=src[s+i];}return o;}
function cropR(buf: AudioBuffer,a: number,b2: number,ctx: AudioContext){return cropT(buf,a*buf.duration,b2*buf.duration,ctx);}

function splitAt(buf: AudioBuffer,timeSec: number,ctx: AudioContext){
  const sr=buf.sampleRate,ch=buf.numberOfChannels;
  const splitSample=Math.max(1,Math.min(buf.length-1,Math.floor(timeSec*sr)));
  const a=ctx.createBuffer(ch,splitSample,sr);
  const b=ctx.createBuffer(ch,buf.length-splitSample,sr);
  for(let c=0;c<ch;c++){
    const src=buf.getChannelData(c),dA=a.getChannelData(c),dB=b.getChannelData(c);
    for(let i=0;i<splitSample;i++)dA[i]=src[i];
    for(let i=0;i<buf.length-splitSample;i++)dB[i]=src[splitSample+i];
  }
  return[a,b];
}

function mergeBufs(buffers: AudioBuffer[],gaps: number[],ctx: AudioContext){
  const sr=buffers[0]?.sampleRate||44100;
  const ch=Math.max(...buffers.map(b=>b.numberOfChannels));
  let totalLen=0;
  for(let i=0;i<buffers.length;i++){totalLen+=buffers[i].length;if(i<buffers.length-1)totalLen+=Math.floor((gaps?.[i]||0)*sr);}
  const out=ctx.createBuffer(ch,totalLen,sr);
  let pos=0;
  for(let i=0;i<buffers.length;i++){
    const b=buffers[i];
    for(let c=0;c<ch;c++){
      const dst=out.getChannelData(c);
      const src=b.numberOfChannels>c?b.getChannelData(c):b.getChannelData(0);
      for(let j=0;j<b.length;j++)dst[pos+j]+=src[j];
    }
    pos+=b.length;if(i<buffers.length-1)pos+=Math.floor((gaps?.[i]||0)*sr);
  }
  return out;
}

function mkLoop(buf: AudioBuffer,n: number,cf: number,ctx: AudioContext){const cfs=Math.floor((cf||.02)*buf.sampleRate),body=Math.max(1,buf.length-cfs),tl=body*n+cfs,o=ctx.createBuffer(buf.numberOfChannels,tl,buf.sampleRate);for(let c=0;c<buf.numberOfChannels;c++){const s=buf.getChannelData(c),d=o.getChannelData(c);for(let t=0;t<n;t++){const off=t*body;for(let i=0;i<buf.length&&off+i<tl;i++){if(t>0&&i<cfs)d[off+i]+=s[i]*(i/cfs);else d[off+i]=(d[off+i]||0)+s[i];}if(t<n-1)for(let i=0;i<cfs&&off+body+i<tl;i++)d[off+body+i]=(d[off+body+i]||0)+s[body+i]*(1-i/cfs);}}return o;}
function eq3(buf: AudioBuffer,l: number,m: number,h: number,ctx: AudioContext){const len=buf.length,sr=buf.sampleRate,ch=buf.numberOfChannels,o=ctx.createBuffer(ch,len,sr);for(let c=0;c<ch;c++){const inp=buf.getChannelData(c),d=o.getChannelData(c);const lp=[0,0],hp=[0,0];const f1=300/sr,f2=3000/sr;for(let i=0;i<len;i++){lp[0]+=f1*(inp[i]-lp[0]);lp[1]+=f1*(lp[0]-lp[1]);hp[0]+=f2*(inp[i]-hp[0]);hp[1]+=f2*(hp[0]-hp[1]);d[i]=lp[1]*l+(inp[i]-lp[1]-(inp[i]-hp[1]))*m+(inp[i]-hp[1])*h;}}return o;}

function bouncePat(chs: any[],samples: any[],bpm: number,steps: number,swing: number,ctx: AudioContext){
  const stepDur=60/bpm/4;const sr=44100;const totalLen=Math.ceil(steps*stepDur*sr);
  const o=ctx.createBuffer(2,totalLen,sr);const oL=o.getChannelData(0),oR=o.getChannelData(1);
  const solo=chs.some(c=>c.solo);
  // Find kick channel for sidechain
  const kickCh=chs.findIndex(c=>c.isKick);
  const kickEnv=new Float32Array(totalLen).fill(1);
  if(kickCh>=0){const kc=chs[kickCh];const att=Math.floor(.005*sr),rel=Math.floor(.15*sr);for(let st=0;st<steps;st++){if(!kc.steps[st])continue;const swOff=st%2===1?(swing-50)/100*stepDur:0;const ratch=kc.ratchets?.[st]||1;for(let r=0;r<ratch;r++){const rOff=r*(stepDur/ratch);const pos=Math.floor((st*stepDur+swOff+rOff)*sr);for(let i=0;i<att+rel&&pos+i<totalLen;i++){const env=i<att?1-i/att*0.8:0.2+(i-att)/rel*0.8;kickEnv[pos+i]=Math.min(kickEnv[pos+i],env);}}}}
  for(let ci=0;ci<chs.length;ci++){const ch=chs[ci];if(ch.mute||(solo&&!ch.solo))continue;const s=samples[ch.sampleIdx];if(!s)continue;
    let buf=s.buffer;if(ch.eqL!==1||ch.eqM!==1||ch.eqH!==1)buf=eq3(buf,ch.eqL,ch.eqM,ch.eqH,ctx);
    const lG=ch.vol*Math.cos((ch.pan+1)*Math.PI/4),rG=ch.vol*Math.sin((ch.pan+1)*Math.PI/4);
    const d=buf.getChannelData(0),d2=buf.numberOfChannels>1?buf.getChannelData(1):d;
    const rate=ch.pitch||1;const useSC=ch.sidechain&&kickCh>=0&&ci!==kickCh;
    for(let st=0;st<steps;st++){if(!ch.steps?.[st])continue;
      const vel=(ch.velocities?.[st]??80)/127;const ratch=ch.ratchets?.[st]||1;
      const swOff=st%2===1?(swing-50)/100*stepDur:0;
      const fAuto=ch.filterAuto?.[st]??1;
      for(let r=0;r<ratch;r++){
        const rOff=r*(stepDur/ratch);const pos=Math.floor((st*stepDur+swOff+rOff)*sr);
        const sLen=Math.floor(d.length/rate/ratch);
        for(let i=0;i<sLen&&pos+i<totalLen;i++){
          const si=Math.floor(i*rate);if(si>=d.length)break;
          let scMul=useSC?kickEnv[pos+i]:1;
          // Simple LP for filter automation
          let samp=d[si],samp2=d2[si];
          oL[pos+i]+=samp*lG*vel*scMul/ratch;oR[pos+i]+=samp2*rG*vel*scMul/ratch;
        }
      }
    }
  }
  // Master safety: peak-normalize with headroom to avoid hard digital clipping on dense/distorted tekno mixes
  let peak=0;for(let i=0;i<totalLen;i++){const a=Math.abs(oL[i]);if(a>peak)peak=a;const b2=Math.abs(oR[i]);if(b2>peak)peak=b2;}
  if(peak>0.99){const g=0.99/peak;for(let i=0;i<totalLen;i++){oL[i]*=g;oR[i]*=g;}}
  return o;
}

function bufToWav(buf: AudioBuffer){const nCh=buf.numberOfChannels,sr=buf.sampleRate,len=buf.length,ab=new ArrayBuffer(44+len*nCh*2),v=new DataView(ab);const ws=(o: number,s: string)=>{for(let i=0;i<s.length;i++)v.setUint8(o+i,s.charCodeAt(i));};ws(0,'RIFF');v.setUint32(4,36+len*nCh*2,true);ws(8,'WAVE');ws(12,'fmt ');v.setUint32(16,16,true);v.setUint16(20,1,true);v.setUint16(22,nCh,true);v.setUint32(24,sr,true);v.setUint32(28,sr*nCh*2,true);v.setUint16(32,nCh*2,true);v.setUint16(34,16,true);ws(36,'data');v.setUint32(40,len*nCh*2,true);let off=44;for(let i=0;i<len;i++)for(let c=0;c<nCh;c++){const s=Math.max(-1,Math.min(1,buf.getChannelData(c)[i]));v.setInt16(off,s<0?s*0x8000:s*0x7FFF,true);off+=2;}return new Blob([ab],{type:'audio/wav'});}
const ft=(s: number)=>`${Math.floor(s/60)}:${String(Math.floor(s%60)).padStart(2,'0')}.${Math.floor((s%1)*10)}`;

// Synthesized tekno sounds (free tekno / hardtek — Web Audio, no external files)
function mkB(ctx: AudioContext,dur: number){const sr=44100,len=Math.max(1,Math.floor(sr*dur));return{b:ctx.createBuffer(1,len,sr),sr,len};}
// Hardtek kick: fast pitch sweep, heavy distortion + hard clip, punchy click. Distortion drive scales with hardness (0..1).
function synthKick(ctx: AudioContext,hard: number=.8){const{b,sr,len}=mkB(ctx,.42),d=b.getChannelData(0);let ph=0;const drv=3+hard*7;for(let i=0;i<len;i++){const t=i/sr;const f=170*Math.exp(-t*55)+50;ph+=2*Math.PI*f/sr;const env=Math.exp(-t*7.5);let s=Math.tanh(Math.sin(ph)*drv);s=Math.max(-1,Math.min(1,s*1.5));d[i]=s*env*.96;if(i<40)d[i]=Math.max(-1,Math.min(1,d[i]+(Math.random()*2-1)*.45*(1-i/40)));}return b;}
function synthHat(ctx: AudioContext,open: boolean){const{b,sr,len}=mkB(ctx,open?.32:.07),d=b.getChannelData(0);let prev=0;for(let i=0;i<len;i++){const t=i/sr;const n=Math.random()*2-1;const hp=n-prev;prev=n;const env=Math.exp(-t*(open?14:62));d[i]=hp*env*.5;}return b;}
function synthClap(ctx: AudioContext){const{b,sr,len}=mkB(ctx,.32),d=b.getChannelData(0);const bursts=[0,.011,.022,.034];let prev=0;for(let i=0;i<len;i++){const t=i/sr;let env=0;for(const bt of bursts)if(t>=bt)env=Math.max(env,Math.exp(-(t-bt)*55));if(t>.04)env=Math.max(env,Math.exp(-(t-.04)*17)*.9);const n=Math.random()*2-1;const hp=n-prev;prev=n;d[i]=hp*env*.62;}return b;}
function synthSnare(ctx: AudioContext){const{b,sr,len}=mkB(ctx,.26),d=b.getChannelData(0);let ph=0,prev=0;for(let i=0;i<len;i++){const t=i/sr;const env=Math.exp(-t*21);ph+=2*Math.PI*185/sr;const tone=Math.sin(ph)*.5;const n=Math.random()*2-1;const hp=n-prev;prev=n;d[i]=(tone+hp*.85)*env*.7;}return b;}
// Aggressive distorted tekno bassline: detuned saw stack, heavy drive, snappy env.
function synthBass(ctx: AudioContext,freq: number){const{b,sr,len}=mkB(ctx,.4),d=b.getChannelData(0);let p1=0,p2=0;const f=freq||48;for(let i=0;i<len;i++){const t=i/sr;p1+=2*Math.PI*f/sr;p2+=2*Math.PI*f*1.01/sr;const env=Math.min(1,t*140)*Math.exp(-t*4.6);const s1=2*((p1/(2*Math.PI))%1)-1,s2=2*((p2/(2*Math.PI))%1)-1;let v=Math.tanh((s1+s2*.6)*4);v=Math.max(-1,Math.min(1,v*1.3));d[i]=v*env*.7;}return b;}
function synthTom(ctx: AudioContext,freq: number){const{b,sr,len}=mkB(ctx,.3),d=b.getChannelData(0);let ph=0;const f0=freq||120;for(let i=0;i<len;i++){const t=i/sr;const f=f0*Math.exp(-t*6)+f0*.5;ph+=2*Math.PI*f/sr;const env=Math.exp(-t*9);d[i]=Math.sin(ph)*env*.82;}return b;}
function synthRim(ctx: AudioContext){const{b,sr,len}=mkB(ctx,.05),d=b.getChannelData(0);let ph=0;for(let i=0;i<len;i++){const t=i/sr;ph+=2*Math.PI*1700/sr;const env=Math.exp(-t*120);d[i]=(Math.sin(ph)+(Math.random()*2-1)*.5)*env*.6;}return b;}
function synthStab(ctx: AudioContext){const{b,sr,len}=mkB(ctx,.36),d=b.getChannelData(0);const fr=[110,130.81,164.81,220];for(let i=0;i<len;i++){const t=i/sr;const env=Math.min(1,t*200)*Math.exp(-t*7);let v=0;for(const f of fr)v+=2*((t*f)%1)-1;d[i]=Math.tanh(v/fr.length*1.4)*env*.42;}return b;}
function synthAcid(ctx: AudioContext,note=0){const{b,sr,len}=mkB(ctx,.28),d=b.getChannelData(0);const f0=55*Math.pow(2,note/12);let ph=0,filt=0;for(let i=0;i<len;i++){const t=i/sr;ph+=2*Math.PI*f0/sr;const saw=2*((ph/(2*Math.PI))%1)-1;const env=Math.min(1,t*60)*Math.exp(-t*5);const cut=300+4000*Math.exp(-t*10);const rc=1/(2*Math.PI*cut),dt=1/sr,a=dt/(rc+dt);filt+=a*(saw-filt);d[i]=Math.tanh(filt*2.5)*env*.85;}return b;}
function synthSub(ctx: AudioContext){const{b,sr,len}=mkB(ctx,.55),d=b.getChannelData(0);let ph=0;for(let i=0;i<len;i++){const t=i/sr;const f=42*Math.exp(-t*1.5)+32;ph+=2*Math.PI*f/sr;d[i]=Math.sin(ph)*Math.exp(-t*2.8)*.92;}return b;}
function synthCymbal(ctx: AudioContext){const{b,sr,len}=mkB(ctx,.65),d=b.getChannelData(0);const fr=[4050,4840,5765,6843,7823,9100];for(let i=0;i<len;i++){const t=i/sr;const env=Math.exp(-t*7.5);let v=0;for(const f of fr)v+=Math.sin(2*Math.PI*f*t)*(Math.random()*.3+.7);d[i]=v/fr.length*env*.48;}return b;}
function synthConga(ctx: AudioContext,freq=220){const{b,sr,len}=mkB(ctx,.28),d=b.getChannelData(0);let ph=0;for(let i=0;i<len;i++){const t=i/sr;const f=freq*Math.exp(-t*18)+freq*.45;ph+=2*Math.PI*f/sr;const env=Math.exp(-t*15);d[i]=(Math.sin(ph)*.7+(Math.random()*2-1)*.3)*env*.75;}return b;}
function synthCowbell(ctx: AudioContext){const{b,sr,len}=mkB(ctx,.55),d=b.getChannelData(0);let p1=0,p2=0;for(let i=0;i<len;i++){const t=i/sr;p1+=2*Math.PI*540/sr;p2+=2*Math.PI*800/sr;d[i]=(Math.sin(p1)+Math.sin(p2))*.5*Math.exp(-t*11)*.62;}return b;}
function synthGroove(ctx: AudioContext){const{b,sr,len}=mkB(ctx,.14),d=b.getChannelData(0);let ph=0,prev=0;for(let i=0;i<len;i++){const t=i/sr;ph+=2*Math.PI*900/sr;const n=Math.random()*2-1;const hp=n-prev;prev=n;d[i]=(Math.sin(ph)*.25+hp*.75)*Math.exp(-t*28)*.62;}return b;}
function synthLead(ctx: AudioContext,freq=440){const{b,sr,len}=mkB(ctx,.32),d=b.getChannelData(0);let ph=0,ph2=0;for(let i=0;i<len;i++){const t=i/sr;ph+=2*Math.PI*freq/sr;ph2+=2*Math.PI*(freq*1.005)/sr;const env=Math.min(1,t*80)*Math.exp(-t*4.5);d[i]=Math.tanh((Math.sin(ph)+Math.sin(ph2)*.6)*1.8)*env*.5;}return b;}
function synthPad(ctx: AudioContext){const{b,sr,len}=mkB(ctx,1.2),d=b.getChannelData(0);const fr=[110,130.8,164.8,220];for(let i=0;i<len;i++){const t=i/sr;const atk=Math.min(1,t*1.8),rel=1-Math.max(0,(t-.9)/.3);const env=atk*Math.max(0,rel);let v=0;for(const f of fr)v+=Math.sin(2*Math.PI*f*t+Math.sin(2*Math.PI*2.8*t)*.12);d[i]=v/fr.length*.38*env;}return b;}
function synthKickHard(ctx: AudioContext){const{b,sr,len}=mkB(ctx,.35),d=b.getChannelData(0);let ph=0;for(let i=0;i<len;i++){const t=i/sr;const f=200*Math.exp(-t*70)+45;ph+=2*Math.PI*f/sr;const env=Math.exp(-t*6);let s=Math.tanh(Math.sin(ph)*8);s=Math.max(-1,Math.min(1,s*1.6));d[i]=s*env*.98;if(i<30)d[i]=Math.max(-1,Math.min(1,d[i]+(Math.random()*2-1)*.5*(1-i/30)));}return b;}
function synthBassGroove(ctx: AudioContext){const{b,sr,len}=mkB(ctx,.45),d=b.getChannelData(0);let p1=0,p2=0;const f=72;for(let i=0;i<len;i++){const t=i/sr;p1+=2*Math.PI*f/sr;p2+=2*Math.PI*f*2.02/sr;const env=Math.min(1,t*120)*Math.exp(-t*3.8);const s1=2*((p1/(2*Math.PI))%1)-1,s2=2*((p2/(2*Math.PI))%1)-1;d[i]=Math.tanh((s1+s2*.4)*3.5)*env*.68;}return b;}
function buildKit(ctx: AudioContext){return[
  {name:'Kick',buf:synthKick(ctx)},
  {name:'KickHard',buf:synthKickHard(ctx)},
  {name:'Clap',buf:synthClap(ctx)},
  {name:'Snare',buf:synthSnare(ctx)},
  {name:'HatClosed',buf:synthHat(ctx,false)},
  {name:'HatOpen',buf:synthHat(ctx,true)},
  {name:'Cymbal',buf:synthCymbal(ctx)},
  {name:'Rim',buf:synthRim(ctx)},
  {name:'Conga',buf:synthConga(ctx,220)},
  {name:'Cowbell',buf:synthCowbell(ctx)},
  {name:'Groove',buf:synthGroove(ctx)},
  {name:'Tom',buf:synthTom(ctx,110)},
  {name:'Bass',buf:synthBass(ctx,55)},
  {name:'BassGroove',buf:synthBassGroove(ctx)},
  {name:'Sub',buf:synthSub(ctx)},
  {name:'Acid',buf:synthAcid(ctx,0)},
  {name:'Stab',buf:synthStab(ctx)},
  {name:'Lead',buf:synthLead(ctx,440)},
  {name:'Pad',buf:synthPad(ctx)},
];}
// Kit indices: 0=Kick,1=KickHard,2=Clap,3=Snare,4=HatClosed,5=HatOpen,6=Cymbal,7=Rim
//              8=Conga,9=Cowbell,10=Groove,11=Tom,12=Bass,13=BassGroove,14=Sub,15=Acid,16=Stab,17=Lead,18=Pad
const KIT_PATTERNS: {s:number,steps:number[],ratchets?:number[],isKick?:boolean,sidechain?:boolean,vol:number}[][]=[
  // Driving 4x4 hardtek + end roll
  [
    {s:0,steps:[1,0,0,0,1,0,0,0,1,0,0,0,1,0,1,1],ratchets:[1,1,1,1,1,1,1,1,1,1,1,1,1,1,2,3],isKick:true,vol:1},
    {s:12,steps:[0,0,1,0,0,0,1,0,0,0,1,0,0,0,1,0],sidechain:true,vol:.75},
    {s:4,steps:[1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1],vol:.34},
    {s:2,steps:[0,0,0,0,1,0,0,0,0,0,0,0,1,0,0,0],vol:.8},
  ],
  // Rolling hardtek offbeat kicks + acid
  [
    {s:0,steps:[1,0,0,1,0,0,1,0,1,0,0,1,0,0,1,1],ratchets:[1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,3],isKick:true,vol:1},
    {s:12,steps:[0,0,1,0,1,0,0,1,0,0,1,0,1,0,0,1],sidechain:true,vol:.72},
    {s:5,steps:[0,0,1,0,0,0,1,0,0,0,1,0,0,0,1,0],vol:.42},
    {s:15,steps:[1,0,0,1,0,0,1,0,0,1,0,0,1,0,0,0],vol:.65},
    {s:2,steps:[0,0,0,0,1,0,0,0,0,0,0,0,1,0,0,0],vol:.78},
  ],
  // Galloping + stab + groove
  [
    {s:0,steps:[1,0,1,0,1,0,0,1,1,0,1,0,1,0,0,1],ratchets:[1,1,1,1,1,1,1,2,1,1,1,1,1,1,1,2],isKick:true,vol:1},
    {s:12,steps:[0,0,0,1,0,0,0,1,0,0,0,1,0,0,0,1],sidechain:true,vol:.7},
    {s:4,steps:[0,1,0,1,0,1,0,1,0,1,0,1,0,1,0,1],vol:.38},
    {s:16,steps:[0,0,0,0,0,0,0,0,1,0,0,0,0,0,0,0],vol:.42},
    {s:2,steps:[0,0,0,0,1,0,0,0,0,0,0,0,1,0,0,0],vol:.75},
    {s:10,steps:[0,0,0,1,0,0,0,1,0,0,0,1,0,0,0,1],vol:.4},
  ],
  // BassGroove + KickHard + Conga + Hat
  [
    {s:1,steps:[1,0,0,0,1,0,0,0,1,0,0,0,1,0,0,0],ratchets:[1,1,1,1,1,1,1,1,1,1,1,1,2,1,1,1],isKick:true,vol:1},
    {s:13,steps:[1,0,0,1,1,0,1,0,1,0,0,1,1,0,1,0],sidechain:true,vol:.8},
    {s:8,steps:[0,0,1,0,0,0,1,0,0,0,1,0,0,1,0,1],vol:.6},
    {s:4,steps:[1,0,1,0,1,0,1,0,1,0,1,0,1,0,1,0],vol:.3},
    {s:3,steps:[0,0,0,0,1,0,0,0,0,0,0,0,1,0,0,0],vol:.7},
  ],
  // Acid + Sub + Cymbal minimal
  [
    {s:0,steps:[1,0,0,0,0,0,1,0,1,0,0,0,0,0,1,0],ratchets:[1,1,1,1,1,1,1,1,2,1,1,1,1,1,1,1],isKick:true,vol:1},
    {s:14,steps:[1,0,0,0,1,0,0,0,1,0,0,0,1,0,0,0],sidechain:true,vol:.9},
    {s:15,steps:[0,0,1,0,0,1,0,0,1,0,0,1,0,0,1,1],vol:.7},
    {s:6,steps:[0,0,0,0,0,0,0,1,0,0,0,0,0,0,0,1],vol:.5},
    {s:7,steps:[0,1,0,1,0,1,0,0,0,1,0,1,0,1,0,0],vol:.4},
  ],
];

const MKCH=(sc: number)=>({sampleIdx:0,steps:new Array(sc).fill(false),velocities:new Array(sc).fill(80),ratchets:new Array(sc).fill(1),filterAuto:new Array(sc).fill(1),vol:.8,pan:0,pitch:1,mute:false,solo:false,eqL:1,eqM:1,eqH:1,sidechain:false,isKick:false,truncate:false,playMark:false});

const FX_DESC:Record<string,string>={
  gain:'Hlasitosť / zosilnenie. 1 = originál, >1 hlasnejší, <1 tichší.',
  saturation:'Saturácia / Drive: pridáva harmonické skreslenie a teplo. Nízke = warm analog, vysoké = agresívne distortion.',
  lpFreq:'Low-pass filter: orezáva vysoké frekvencie. Nižšia hodnota = tmavší, dunivejší zvuk. OFF = bez filtra.',
  hpFreq:'High-pass filter: orezáva basové frekvencie. Vyššia hodnota = tenší, vzdušnejší zvuk. OFF = bez filtra.',
  fadeIn:'Fade In: postupné nájdenie zvuku od ticha na začiatku stopy (v sekundách).',
  fadeOut:'Fade Out: postupné stíšenie zvuku na konci stopy (v sekundách).',
  delay:'Delay / Echo: opakovanie zvuku s časovým odstupom. Mixuje suchý a mokrý signál.',
  delayTime:'Echo čas: dĺžka oneskorenia medzi originálom a echom (v sekundách).',
  compress:'Kompresor: vyrovnáva dynamiku — stlačí hlasné časti, čím sa celok zdá vyrovnanejší a silnejší.',
  loop:'Loop: opakuje vzorku N-krát za sebou a spojí ich do jedného buffra.',
  reverb:'Reverb: simuluje priestorový dozvuk (miestnosť, hala). Viac = väčší priestor.',
  reverbDecay:'Reverb dĺžka: ako dlho doznieva dozvuk (v sekundách).',
  chorus:'Chorus / Flanger: zdvojuje zvuk s malým posunom výšky a časovým oneskorením — plnší, pohyblivý zvuk.',
  chorusRate:'Rýchlosť chorusu: frekvencia modulácie zdvojeného signálu (Hz).',
  bitCrush:'Bitcrusher: znižuje digitálne rozlíšenie zvuku — lo-fi, crunch, retro 8-bit charakter.',
  speed:'Rýchlosť (Playback Rate): mení tempo prehrávania. <1 = pomalšie + nižší tón, >1 = rýchlejšie + vyšší tón.',
};

const SYSP_CL=`ROLA: AI producent. Slovenčina. STRUČNE - max 2 vety v message.
FORMÁT: VŽDY zavolaj funkciu execute_audio_operations s {message:"krátka odpoveď", operations:[{op:"..."}]}. Nepíš voľný text ani markdown.

OPS: select(sample), trim_silence, crop_time(start,end), split(time), merge(samples:[0,1],gaps:[0.5],name), loop(times,crossfade), effects(params:{gain,lpFreq,hpFreq,saturation,fadeIn,fadeOut,normalize,reverse,delay,delayTime,delayFb,compress,reverb,reverbDecay,chorus,chorusRate,bitCrush}), rename(name), duplicate(newName), create_from(source,newName,operations:[]), add_channel(sample,steps:[1,0,...],volume,pan,pitch,eqLow,eqMid,eqHigh), set_channel(channel,volume,pan,pitch,steps,eqLow,eqMid,eqHigh,mute,solo), shift_channel(channel,steps:N — posun stopy v čase: +N neskôr/vpravo, -N skôr/vľavo, 1 krok=1/16 taktu), set_bpm(bpm), bounce_pattern(name), export, export_pattern
STOPY: clear_channel(channel)=vyčisti kroky, remove_channel(channel)=zmaž stopu, duplicate_channel(channel)=zduplikuj stopu, euclid(channel,pulses,rotate)=euklidovský rytmus (rovnomerne rozloží pulses úderov), humanize(channel,amount:0-1)=ľudská variácia velocity, apply_genre(genre:tekno|hardtek|acidcore)=nastaví BPM+swing pre žáner
ARANŽMÁN/MIX: add_to_track(times,name)=bounce aktuálny pattern a vlož ho do skladby (timeline), times=koľkokrát za sebou; add_sample_to_track(sample,dir,times)=pridaj konkrétnu vzorku z knižnice priamo do skladby (timeline), dir:'h'=za seba na aktívnu stopu / 'v'=nová paralelná stopa; save_to_library(target,name)=ulož výsledok do knižnice ako novú vzorku, target:'pattern'=aktuálny pattern (default) / 'track'=celá skladba (timeline), bez name sa pomenuje AIoutput1, AIoutput2…; auto_mix=automaticky vyrovná hlasitosti stôp podľa analýzy (LUFS), kicku dá priestor; match_reference(source)=zladí BPM a mix podľa referenčnej vzorky #source
ULOŽENIE: keď vytvoríš/skomponuješ slučku alebo beat (strihanie, skladanie vzoriek, úprava stôp), na záver to ulož do knižnice cez save_to_library, aby si používateľ výsledok nestratil.
EFEKTY: reverb(0-1)+reverbDecay(0.3-4s)=dozvuk; chorus(0-1)=chorus/flanger; bitCrush(0-1)=bitcrusher/lo-fi; saturation=skreslenie; delay=echo. Kombinuj pre zaujímavé zvuky.

LIVE MIXING: na stíšenie/zhlasnenie stopy použi set_channel(volume), mute(true/false), pan, eqLow/Mid/High (1=neutrál). Na posun zvuku v čase ("posuň kick neskôr/skôr") použi shift_channel.

ANALÝZA: pri každej vzorke v kontexte máš ~BPM, tóninu (napr. Am = A mol), LUFS (hlasitosť) a hits (počet úderov). Využi ich: zlaď set_bpm podľa vzoriek, vyrovnaj príliš tiché/hlasné vzorky cez volume/gain, kicku nechaj priestor.

split: rozdelí vzorku na dve nové (A+B) v danom čase. merge: spojí viaceré vzorky za seba, gaps=medzery v sekundách.
DÔLEŽITÉ: Ak nemáš vzorky, povedz nech nahrajú. Ak máš, VŽDY generuj commands. Neopisuj kód, nepíš návody. KONAJ.

SEQ ŠABLÓNY (16 krokov, použi ako základ):
kick 4/4:    [1,0,0,0,1,0,0,0,1,0,0,0,1,0,0,0] isKick:true vel:110
snare/clap:  [0,0,0,0,1,0,0,0,0,0,0,0,1,0,0,0] vel:95
hihat off:   [0,0,1,0,0,0,1,0,0,0,1,0,0,0,1,0] vel:70
hihat 8ths:  [1,0,1,0,1,0,1,0,1,0,1,0,1,0,1,0] vel:60
bass tekno:  [1,0,0,0,0,1,0,0,1,0,0,0,0,1,0,0] sidechain:true
bass reggae: [1,0,0,1,0,0,0,1,0,0,1,0,0,0,1,0] sidechain:true
perc:        [0,1,0,0,0,1,0,0,0,1,0,0,0,0,1,0] vel:75

SEQ PRAVIDLÁ — POVINNÉ: MAX 5 kanálov pre základný beat. KAŽDÝ kanál musí mať MIN 2 aktívne kroky — ak by mal menej, vynechaj ho úplne. Bass VŽDY sidechain:true na kick. Kick dostane isKick:true. NIKDY nepridávaj kanál kde sú všetky kroky 0/false.

INTERAKCIE (zo knowledge base):
BASS-KICK: tekno→bass na 3,7,10,14 (nie 1,5,9,13 kde hrá kick). dub_techno→bass na 3,11,15 dlhé noty. hardtek→unison kick+bass OK ak sidechain.
HAT-KICK: hat NESMIE byť len na 1,5,9,13 (zdvojenie kicku). tekno→off-beat 2,4,6,8,10,12,14,16. dub_techno→quarter 3,7,11,15.
VELOCITY: kick(9)≥snare(9)≥bass(7)≥hat(6)≥perc(4). NIKDY všetky kanály na velocity 9.
ANTI-VZORY: bass+kick na viacerých krokoch bez sidechain=blatistý mix. bass na 16 krokoch=nie bass. hat=kick pattern=zlé. snare na 1 alebo 9=kolízia.
FINGERPRINTS: tekno=kick 1,5,9,13+off-beat hat+bass mimo kicku. hard_tekno=kick+predkrok 4+16th hat. dub_techno=kick 1,9,13+priestor+bass 3,11,15. acidcore=kick 1,5,9,13+acid_bass cez celý takt+distortion. hardtek=rolling kick 1,3,5,9,11,13+tribal+unison bass.`;

const SYSP_TK=`ROLA: AI tekno producent (free tekno / hardtek). Slovenčina. STRUČNE - max 2 vety.
FORMÁT: VŽDY zavolaj funkciu execute_audio_operations s {message:"krátka odpoveď", operations:[{op:"..."}]}. Nepíš voľný text ani markdown.

OPS (klasické + tekno):
split(time), merge(samples:[],gaps:[],name) — rozdeľ a spájaj vzorky
add_channel: +velocities[0-127], ratchets[1-4], sidechain(bool), isKick(bool)
set_channel: +velocities, ratchets, sidechain, isKick, filterAuto[0-1]
effects: params={gain,saturation,lpFreq,hpFreq,delay,delayTime,compress,reverb,reverbDecay,chorus,chorusRate,bitCrush,fadeIn,fadeOut,normalize,reverse}
shift_channel(channel,steps:N) — posun stopy v čase: +N neskôr/vpravo, -N skôr (napr. "posuň kick neskôr"). 1 krok = 1/16 taktu.
LIVE MIX: set_channel(volume,mute,pan,eqLow/Mid/High) — stíš/zhlasni/uprav stopu naživo počas hrania.
ANALÝZA: pri každej vzorke máš ~BPM, tóninu (Am=A mol), LUFS (hlasitosť), hits (údery). Zlaď set_bpm podľa vzoriek, vyrovnaj hlasitosti cez volume, kicku daj priestor (sidechain/EQ).
set_swing(swing:50-75), set_pattern(pattern:0-7), copy_pattern(from,to)
STOPY: clear_channel(channel), remove_channel(channel), duplicate_channel(channel), euclid(channel,pulses,rotate)=euklidovský rytmus, humanize(channel,amount:0-1)=variácia velocity, apply_genre(genre:tekno|hardtek|acidcore)=BPM+swing pre žáner
ŽÁNRE: tekno→160 BPM rolling; hardtek→178 BPM tvrdý kick+ratchety; acidcore→190 BPM skreslený 303 acid. Pre euklidovské hihat/perc skús pulses 5-7 na 16 krokov.
ARANŽMÁN/MIX: add_to_track(times,name)=bounce pattern do skladby (timeline) times×; add_sample_to_track(sample,dir,times)=pridaj konkrétnu vzorku do skladby (dir:'h'=za seba na aktívnu stopu / 'v'=nová paralelná stopa); save_to_library(target,name)=ulož výsledok do knižnice (target:'pattern'=aktuálny pattern default / 'track'=celá skladba; bez name – AIoutput1, AIoutput2…); auto_mix=vyrovná hlasitosti stôp podľa LUFS, kicku dá priestor + sidechain na bass; match_reference(source)=zladí BPM a mix podľa referenčnej vzorky #source. Stavba skladby: rob patterny (set_pattern, copy_pattern) a reťaz ich cez add_to_track (intro/build/drop/break).
ULOŽENIE: keď zložíš slučku/beat (strihanie, skladanie, úprava stôp), na záver ho ulož cez save_to_library (default AIoutputN). Vytvorené vzorky pridaj do skladby cez add_sample_to_track alebo do sekvencera cez add_channel.

PRAVIDLÁ (FREE TEKNO / HARDTEK): BPM 150-185. Skreslený, rýchly kick — nie len 4-on-floor, ale rolling/offbeat kicky s ratchet 2-4 pre rýchle rolly. Agresívny, skreslený bassline (sidechain na kick). Hihat offset. Swing tesný 50-56. Energia a tvrdosť. VŽDY generuj commands, neopisuj. KONAJ.

SEQ ŠABLÓNY (16 krokov, použi ako základ, varíruj ±2 kroky):
TEKNO kick 4/4:     [1,0,0,0,1,0,0,0,1,0,0,0,1,0,0,0] isKick:true vel:110
TEKNO kick rolling: [1,0,0,1,0,0,1,0,0,1,0,0,1,0,0,0] isKick:true ratchets:[2,1,1,2,1,1,2,1,1,2,1,1,2,1,1,1]
TEKNO snare:        [0,0,0,0,1,0,0,0,0,0,0,0,1,0,0,0] vel:95
TEKNO hihat off:    [0,0,1,0,0,0,1,0,0,0,1,0,0,0,1,0] vel:65
TEKNO hihat 8ths:   [1,0,1,0,1,0,1,0,1,0,1,0,1,0,1,0] vel:55
TEKNO bass:         [1,0,0,0,0,1,0,0,1,0,0,0,0,1,0,0] sidechain:true saturation:0.4
HARDTEK kick:       [1,0,1,0,1,0,1,0,1,0,1,0,1,0,1,0] isKick:true ratchets:[2,1,2,1,2,1,2,1,2,1,2,1,2,1,2,1] vel:115
HARDTEK bass:       [1,0,0,1,0,0,1,0,1,0,0,1,0,0,1,0] sidechain:true saturation:0.6
ACIDCORE 303:       [1,1,0,1,1,0,1,0,1,1,0,1,0,1,1,0] sidechain:true lpFreq:900 saturation:0.7
ACIDCORE kick:      [1,0,0,0,1,0,1,0,1,0,0,0,1,0,1,0] isKick:true vel:120

SEQ PRAVIDLÁ — POVINNÉ: MAX 5 kanálov pre základný beat. KAŽDÝ kanál min 2 aktívne kroky — ak by mal menej, vynechaj ho. Bass VŽDY sidechain:true. Kick VŽDY isKick:true. NIKDY nepridávaj kanál kde všetky kroky = 0/false. Kick a bass nehrajú na rovnakých krokoch (bass hrá medzi kickmi). Najprv postav rytmický základ (kick+snare+hihat), POTOM pridaj bass.

INTERAKCIE (knowledge base):
BASS-KICK: tekno→bass na 3,7,10,14. hard_tekno→bass na 3,7,11,15. dub_techno→bass na 3,11,15 dlhé noty. hardtek/acidcore→unison OK ak sidechain:true. Bass koliduje s kickom MAX 2× za bar.
HAT: hat NESMIE byť len na 1,5,9,13 (to je kick). tekno off-beat=2,4,6,8,10,12,14,16. dub_techno quarter=3,7,11,15. rolling kick+on-beat hat=kaša.
VELOCITY: kick(9)≥snare(9)≥bass(7-8)≥hat(5-6)≥perc(4-5). NIKDY všetky na 9.
ANTI-VZORY (zakázané): bass+kick 1,5,9,13 bez sidechain. bass>6 krokov. snare na 1 alebo 9. hat=kick pattern. bass hustejší ako hat. open hat+snare na rovnakom kroku.
FINGERPRINTS: tekno=4floor kick+offbeat hat+bass mimo kick. hard_tekno=kick+predkrok 4+16th hat+sat bass. dub_techno=kick 1,9,13+priestor+bass 3,11,15. acidcore=4floor+acid_bass celý takt. hardtek=rolling kick+tribal perc+kick-bass unison.`;

function euclidSteps(n: number,k: number,rot: number): boolean[]{
  n=Math.max(1,Math.floor(n));k=Math.max(0,Math.min(n,Math.floor(k||0)));
  const out:boolean[]=new Array(n).fill(false);if(k===0)return out;
  const res:boolean[]=[];let bucket=0;
  for(let i=0;i<n;i++){bucket+=k;if(bucket>=n){bucket-=n;res.push(true);}else res.push(false);}
  const r=((Math.round(rot||0)%n)+n)%n;
  for(let i=0;i<n;i++)out[i]=res[((i-r)%n+n)%n];
  return out;
}
function humanizeVels(vels: number[],amount: number): number[]{
  const a=Math.max(0,Math.min(1,Number(amount)||0));let seed=(vels.length*97+Math.round(a*1000)+1)>>>0;
  const rnd=()=>{seed=(seed*1103515245+12345)&0x7fffffff;return seed/0x7fffffff;};
  return vels.map(v=>{const d=(rnd()*2-1)*a*40;return Math.max(1,Math.min(127,Math.round((Number(v)||80)+d)));});
}
const GENRE: Record<string,{bpm:number,swing:number}>={tekno:{bpm:160,swing:54},hardtek:{bpm:178,swing:50},acidcore:{bpm:190,swing:50}};
const chSampleLufs=(c: any,arr: any[])=>{const l=arr?.[c?.sampleIdx]?.info?.lufs;return Number.isFinite(l)?l:-23;};
function autoBalance(chs: any[],arr: any[],targetLufs?: number): {chs: any[],target: number}{
  const active=chs.filter((c)=>!c.mute);
  const ls=active.map((c)=>chSampleLufs(c,arr)).sort((a,b)=>a-b);
  const med=Number.isFinite(targetLufs as number)?(targetLufs as number):(ls.length?ls[Math.floor(ls.length/2)]:-23);
  const out=chs.map((c)=>{
    const l=chSampleLufs(c,arr);
    let v=0.8*Math.pow(10,(med-l)/20);
    if(c.isKick)v*=1.1;
    v=Math.max(0.15,Math.min(1.5,Number.isFinite(v)?v:0.8));
    const nm=String(arr?.[c?.sampleIdx]?.name||'');
    const sc=(/bass|sub|303|acid|reese/i.test(nm)&&!c.isKick)?true:c.sidechain;
    return {...c,vol:v,sidechain:sc};
  });
  return {chs:out,target:med};
}

export default function App(){
  const[mode,setMode]=useState<'classic'|'tekno'>('classic');
  const[samples,setSamples]=useState<any[]>([]);
  const[sel,setSel]=useState<number|null>(null);
  const[wfSel,setWfSel]=useState<{start:number,end:number}|null>(null);
  const[playPos,setPlayPos]=useState<number|null>(null);
  const[playing,setPlaying]=useState(false);
  const[recording,setRecording]=useState(false);
  const[recLvl,setRecLvl]=useState(0);
  const[msgs,setMsgs]=useState<{role:'user'|'assistant'|'system',content:string}[]>([{role:'assistant',content:'Ahoj! Nahraj vzorky a poďme tvoriť. Prepni režim hore — Classic alebo Tekno.'}]);
  const[input,setInput]=useState('');
  const[loading,setLoading]=useState(false);
  const[panel,setPanel]=useState('seq');
  const[log,setLog]=useState<string[]>([]);
  const[bpm,setBpm]=useState(128);
  const[stepCount,setStepCount]=useState(16);
  const[addSel,setAddSel]=useState(0);
  const[swing,setSwing]=useState(50);
  const[seqPlaying,setSeqPlaying]=useState(false);
  const[curStep,setCurStep]=useState(-1);
  const[editCh,setEditCh]=useState<number|null>(null);
  const[patterns,setPatterns]=useState<any[][]>(Array.from({length:8},()=>[]));
  const[curPat,setCurPat]=useState(0);
  const[exportAudio,setExportAudio]=useState<{url:string,name:string}|null>(null);
  const[fx,setFx]=useState({...FX0});
  const[masterVol,setMasterVol]=useState(1);
  const[cmdInput,setCmdInput]=useState('');
  const[renameTarget,setRenameTarget]=useState<{idx:number,name:string}|null>(null);
  const[trackBlocks,setTrackBlocks]=useState<any[]>([]);
  const[trackPos,setTrackPos]=useState(0);
  const[trackPlaying,setTrackPlaying]=useState(false);
  const[trackSel,setTrackSel]=useState<number|null>(null);
  const[trackBlockFx,setTrackBlockFx]=useState({...FX0});
  const[trackCropRange,setTrackCropRange]=useState<[number,number]|null>(null);
  const[activeLayer,setActiveLayer]=useState(0);
  const[layerVols,setLayerVols]=useState<{[k:number]:number}>({0:1});
  const trackIdR=useRef(0);
  const trackSrcR=useRef<AudioBufferSourceNode[]>([]);
  const trackStR=useRef(0);
  const trackAfR=useRef<number|null>(null);
  const dragRef=useRef<any>(null);
  const justMovedRef=useRef(false);
  const[dragDur,setDragDur]=useState<number|null>(null);
  const[showClips,setShowClips]=useState(false);
  const[clips,setClips]=useState<any[]>([]);
  const[clipSel,setClipSel]=useState<number|null>(null);
  const[clipFx,setClipFx]=useState({...FX0});
  const[clipHistory,setClipHistory]=useState<any[][]>([]);
  const[seqPreviewBuf,setSeqPreviewBuf]=useState<AudioBuffer|null>(null);
  const seqCvR=useRef<HTMLCanvasElement|null>(null);
  let clipIdR=useRef(0);
  const[undoStack,setUndoStack]=useState<any[]>([]);
  const[redoStack,setRedoStack]=useState<any[]>([]);
  const[abSnap,setAbSnap]=useState<{before:any,after:any,showing:'A'|'B'}|null>(null);
  const[abPending,setAbPending]=useState<any>(null);
  // Decompositor state
  const[showDecompose,setShowDecompose]=useState(false);
  const[decompMode,setDecompMode]=useState<'track'|'stem'|'zoom'>('track');
  const[decompStep,setDecompStep]=useState('');
  const[decompResult,setDecompResult]=useState<any>(null);
  const[decompLoading,setDecompLoading]=useState(false);
  const[decompFile,setDecompFile]=useState<File|null>(null);
  const[zoomTarget,setZoomTarget]=useState('');
  const[zoomStart,setZoomStart]=useState('0:00');
  const[zoomEnd,setZoomEnd]=useState('0:30');

  const channels=patterns[curPat]||[];
  const setChannels=(fn: any)=>setPatterns(p=>{const n=[...p];n[curPat]=typeof fn==='function'?fn(n[curPat]||[]):fn;return n;});

  const th=mode==='tekno'?TK:C;
  const cols=mode==='tekno'?TKC:TC;

  const actxR=useRef<AudioContext|null>(null),cvR=useRef<HTMLCanvasElement|null>(null),srcR=useRef<AudioBufferSourceNode|null>(null),afR=useRef<number|null>(null),stR=useRef(0),sdR=useRef<{s:number}|null>(null),ceR=useRef<HTMLDivElement|null>(null),anR=useRef<AnalyserNode|null>(null),seqTR=useRef<any>(null),nstR=useRef(0),csR=useRef(0),recRef=useRef<any>(null),chRef=useRef<any[]>([]),smpRef=useRef<any[]>([]),bpmRef=useRef(128),swRef=useRef(50),mvR=useRef(1),masterGR=useRef<GainNode|null>(null),scR=useRef(16);
  const getCtx=useCallback(()=>{if(!actxR.current)actxR.current=new(window.AudioContext||(window as any).webkitAudioContext)();return actxR.current;},[]);
  const cur=sel!=null?samples[sel]:null;
  const lastReply=[...msgs].reverse().find(m=>m.role==='assistant')?.content||'';

  useEffect(()=>{ceR.current?.scrollIntoView({behavior:'smooth'});},[msgs]);
  useEffect(()=>{chRef.current=channels;},[channels]);
  useEffect(()=>{smpRef.current=samples;},[samples]);
  useEffect(()=>{bpmRef.current=bpm;},[bpm]);
  useEffect(()=>{swRef.current=swing;},[swing]);
  useEffect(()=>{scR.current=stepCount;},[stepCount]);
  useEffect(()=>{mvR.current=masterVol;if(masterGR.current)masterGR.current.gain.value=masterVol;},[masterVol]);
  useEffect(()=>()=>{if(seqTR.current)clearInterval(seqTR.current);},[]);
  useEffect(()=>{const c=cvR.current;if(!c)return;const ro=new ResizeObserver(()=>{c.width=c.offsetWidth;c.height=c.offsetHeight;drawWf(c,cur?.buffer,wfSel,playPos,th);});ro.observe(c);return()=>ro.disconnect();},[cur,wfSel,playPos,th]);
  useEffect(()=>{const c=cvR.current;if(!c)return;c.width=c.offsetWidth;c.height=c.offsetHeight;drawWf(c,cur?.buffer,wfSel,playPos,th);},[cur,wfSel,playPos,th]);

  const addSample=useCallback((name: string,buf: AudioBuffer,color?: string,tag?: string)=>{if(!buf||!buf.duration)return;const info=analyze(buf);setSamples(p=>{const col=color||SWATCH[p.length%SWATCH.length];const n=[...p,{name,buffer:buf,info,original:buf,color:col,tag:tag||''}];setSel(n.length-1);return n;});setLog(p=>[...p,`✓ "${name}" (${ft(buf.duration)})`]);},[]);
  useEffect(()=>{if(!seqCvR.current||!seqPreviewBuf)return;const c=seqCvR.current;c.width=c.offsetWidth;c.height=c.offsetHeight;const th2=mode==='tekno'?TK:C;drawWf(c,seqPreviewBuf,null,null,th2);if(seqPlaying&&curStep>=0&&stepCount>0){const x=(curStep/stepCount)*c.width;const x2=c.getContext('2d');if(x2){x2.strokeStyle='rgba(255,255,255,.85)';x2.lineWidth=2;x2.shadowColor='#fff';x2.shadowBlur=8;x2.beginPath();x2.moveTo(x,0);x2.lineTo(x,c.height);x2.stroke();}}},[seqPreviewBuf,mode,curStep,seqPlaying,stepCount]);
  const handleFiles=useCallback(async(files: File[])=>{const ctx=getCtx();for(const f of files){if(!f.name.match(/\.(wav|mp3|ogg|flac|m4a|aac|webm)$/i)&&!f.type.startsWith('audio/'))continue;try{const ab=await f.arrayBuffer();const buf=await ctx.decodeAudioData(ab);addSample(f.name.replace(/\.[^.]+$/,''),buf);}catch(e){}}},[getCtx,addSample]);

  const playSmp=useCallback(()=>{if(!cur)return;const ctx=getCtx();if(ctx.state==='suspended')ctx.resume();stopSmp();const s=ctx.createBufferSource();s.buffer=cur.buffer;s.connect(ctx.destination);s.start();srcR.current=s;stR.current=ctx.currentTime;setPlaying(true);const u=()=>{const p=(ctx.currentTime-stR.current)/cur.buffer.duration;if(p>=1){setPlaying(false);setPlayPos(null);return;}setPlayPos(p);afR.current=requestAnimationFrame(u);};afR.current=requestAnimationFrame(u);s.onended=()=>{setPlaying(false);setPlayPos(null);};},[cur,getCtx]);
  const stopSmp=useCallback(()=>{if(srcR.current)try{srcR.current.stop();}catch(e){}srcR.current=null;if(afR.current)cancelAnimationFrame(afR.current);setPlaying(false);setPlayPos(null);},[]);

  const startRec=useCallback(async()=>{
    if(recRef.current)return;
    if(!navigator.mediaDevices?.getUserMedia){alert('Tento prehliadač nepodporuje nahrávanie. Otvor aplikáciu v novom okne prehliadača.');return;}
    let stream: MediaStream;
    try{stream=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:false,noiseSuppression:false,autoGainControl:false}});}
    catch(e: any){const n=e?.name||'';if(n==='NotAllowedError')alert('Prístup k mikrofónu bol zamietnutý. Povoľ mikrofón v prehliadači a skús znova.');else if(n==='NotFoundError')alert('Nenašiel sa žiadny mikrofón.');else alert('Mikrofón nedostupný: '+(e?.message||n));setLog(p=>[...p,`✗ Mikrofón: ${n||'chyba'}`]);return;}
    const ctx=getCtx();if(ctx.state==='suspended')await ctx.resume();
    const src=ctx.createMediaStreamSource(stream);
    const an=ctx.createAnalyser();an.fftSize=256;src.connect(an);anR.current=an;
    const proc=ctx.createScriptProcessor(4096,1,1);
    const sink=ctx.createGain();sink.gain.value=0;
    const chunks: Float32Array[]=[];
    proc.onaudioprocess=(e)=>{chunks.push(new Float32Array(e.inputBuffer.getChannelData(0)));};
    src.connect(proc);proc.connect(sink);sink.connect(ctx.destination);
    recRef.current={stream,src,proc,sink,chunks,sr:ctx.sampleRate};
    setRecording(true);
    const mon=()=>{if(!recRef.current||!anR.current)return;const d=new Uint8Array(anR.current.frequencyBinCount);anR.current.getByteFrequencyData(d);let s=0;for(let i=0;i<d.length;i++)s+=d[i];setRecLvl(s/d.length/255);requestAnimationFrame(mon);};mon();
  },[getCtx]);
  const stopRec=useCallback(()=>{
    const r=recRef.current;if(!r){setRecording(false);setRecLvl(0);return;}
    try{r.proc.disconnect();r.src.disconnect();r.sink.disconnect();r.proc.onaudioprocess=null;}catch(e){}
    r.stream.getTracks().forEach((t: MediaStreamTrack)=>t.stop());
    const total=r.chunks.reduce((a: number,c: Float32Array)=>a+c.length,0);
    if(total>1000){const ctx=getCtx();const buf=ctx.createBuffer(1,total,r.sr);const d=buf.getChannelData(0);let off=0;for(const c of r.chunks){d.set(c,off);off+=c.length;}const tr=trimSil(buf,ctx);addSample(`Rec_${Date.now()%10000}`,tr.length>500?tr:buf);}
    else setLog(p=>[...p,'✗ Nahrávka príliš krátka alebo tichá']);
    anR.current=null;recRef.current=null;setRecording(false);setRecLvl(0);
  },[getCtx,addSample]);

  useEffect(()=>()=>{const r=recRef.current;if(r){try{r.proc.disconnect();r.src.disconnect();r.sink.disconnect();r.proc.onaudioprocess=null;}catch(e){}r.stream.getTracks().forEach((t: MediaStreamTrack)=>t.stop());recRef.current=null;}},[]);

  const loadTeknoKit=useCallback(()=>{
    const ctx=getCtx();if(ctx.state==='suspended')ctx.resume();
    const kit=buildKit(ctx);
    const base=samples.length;
    const newSamples=kit.map(k=>({name:k.name,buffer:k.buf,info:analyze(k.buf),original:k.buf}));
    const pat=KIT_PATTERNS[Math.floor(Math.random()*KIT_PATTERNS.length)];
    const kitChs=pat.map(p=>{const c=MKCH(stepCount);c.sampleIdx=base+p.s;const ps=p.steps.map((x:any)=>!!x);for(let i=0;i<stepCount;i++)c.steps[i]=ps[i]||false;if(p.ratchets){for(let i=0;i<stepCount;i++)c.ratchets[i]=p.ratchets[i]||1;}c.vol=p.vol;if(p.isKick)c.isKick=true;if(p.sidechain)c.sidechain=true;return c;});
    const tbpm=150+Math.floor(Math.random()*36); // 150-185 BPM free-tekno range
    setMode('tekno');setBpm(tbpm);
    setSamples(p=>[...p,...newSamples]);
    setChannels((p:any[])=>[...p,...kitChs]);
    setSel(base);setPanel('seq');
    setLog(p=>[...p,`✓ Tekno kit načítaný (${kit.length} zvukov, ${tbpm} BPM)`]);
  },[getCtx,samples,stepCount]);

  // Sequencer playback with swing
  const startSeq=useCallback(()=>{const ctx=getCtx();if(ctx.state==='suspended')ctx.resume();stopSeq();
    if(!masterGR.current){masterGR.current=ctx.createGain();masterGR.current.connect(ctx.destination);}
    const master=masterGR.current;master.gain.value=mvR.current;
    csR.current=0;nstR.current=ctx.currentTime+.05;setSeqPlaying(true);
    // Live scheduler — reads latest state from refs each tick so volume/pan/EQ/mute/solo/BPM apply in real time
    const sched=()=>{const chs=chRef.current,smp=smpRef.current,bp=bpmRef.current,sw=swRef.current,sc=Math.max(1,scR.current|0);const stepDur=60/bp/4;const solo=chs.some((c:any)=>c.solo);
      while(nstR.current<ctx.currentTime+.1){const st=csR.current%sc;setCurStep(st);const swOff=st%2===1?(sw-50)/100*stepDur:0;
      for(const ch of chs){if(ch.mute||(solo&&!ch.solo)||!ch.steps?.[st])continue;const s=smp[ch.sampleIdx];if(!s)continue;
        const ratch=ch.ratchets?.[st]||1;const vel=(ch.velocities?.[st]??80)/127;
        for(let r=0;r<ratch;r++){const src=ctx.createBufferSource();
          // Truncate long samples to step boundary to prevent overlap
          if(ch.truncate&&s.buffer.duration>stepDur/ratch){const tb=ctx.createBuffer(s.buffer.numberOfChannels,Math.floor(stepDur/ratch*ctx.sampleRate),ctx.sampleRate);for(let c=0;c<tb.numberOfChannels;c++){const d=tb.getChannelData(c),sd=s.buffer.getChannelData(c);for(let i=0;i<tb.length;i++)d[i]=sd[i]||0;}src.buffer=tb;}else{src.buffer=s.buffer;}
          if(ch.pitch&&ch.pitch!==1)src.playbackRate.value=ch.pitch;
          let node: AudioNode=src;
          if((ch.eqL??1)!==1||(ch.eqM??1)!==1||(ch.eqH??1)!==1){const lo=ctx.createBiquadFilter();lo.type='lowshelf';lo.frequency.value=250;lo.gain.value=eqDb(ch.eqL??1);const md=ctx.createBiquadFilter();md.type='peaking';md.frequency.value=1200;md.Q.value=1;md.gain.value=eqDb(ch.eqM??1);const hi=ctx.createBiquadFilter();hi.type='highshelf';hi.frequency.value=3500;hi.gain.value=eqDb(ch.eqH??1);node.connect(lo);lo.connect(md);md.connect(hi);node=hi;}
          const g=ctx.createGain();g.gain.value=ch.vol*vel/ratch;node.connect(g);if(ch.pan!==0){const pan=ctx.createStereoPanner();pan.pan.value=ch.pan;g.connect(pan);pan.connect(master);}else g.connect(master);src.start(nstR.current+swOff+r*(stepDur/ratch));}}
      nstR.current+=stepDur;csR.current++;}};
    seqTR.current=setInterval(sched,25);},[getCtx]);
  const stopSeq=useCallback(()=>{if(seqTR.current)clearInterval(seqTR.current);seqTR.current=null;setSeqPlaying(false);setCurStep(-1);},[]);

  const doBounce=useCallback((name?: string)=>{const ctx=getCtx();const buf=bouncePat(channels,samples,bpm,stepCount,swing,ctx);addSample(name||`Pat${curPat}_${bpm}`,buf);},[channels,samples,bpm,stepCount,swing,curPat,getCtx,addSample]);
  const doExport=useCallback((buf?: AudioBuffer,name?: string)=>{const b=buf||cur?.buffer;if(!b)return;const blob=bufToWav(b);const reader=new FileReader();reader.onload=()=>{setExportAudio({url:reader.result as string,name:`${name||cur?.name||'export'}.wav`});};reader.readAsDataURL(blob);},[cur]);

  // Build a processed buffer from the selected sample using current FX slider values
  const buildFx=useCallback((b: AudioBuffer)=>{const ctx=getCtx();let out=applyFx(b,{gain:fx.gain,fadeIn:fx.fadeIn,fadeOut:fx.fadeOut,lpFreq:fx.lpFreq,hpFreq:fx.hpFreq,saturation:fx.saturation,delay:fx.delay,delayTime:fx.delayTime,delayFb:fx.delayFb,compress:fx.compress},ctx);if(fx.loop>1)out=mkLoop(out,fx.loop,.02,ctx);return out;},[fx,getCtx]);
  const previewFx=useCallback(()=>{if(!cur)return;const ctx=getCtx();if(ctx.state==='suspended')ctx.resume();stopSmp();const b=buildFx(cur.buffer);const s=ctx.createBufferSource();s.buffer=b;s.connect(ctx.destination);s.start();srcR.current=s;stR.current=ctx.currentTime;setPlaying(true);const u=()=>{const p=(ctx.currentTime-stR.current)/b.duration;if(p>=1){setPlaying(false);setPlayPos(null);return;}setPlayPos(p);afR.current=requestAnimationFrame(u);};afR.current=requestAnimationFrame(u);s.onended=()=>{setPlaying(false);setPlayPos(null);};},[cur,getCtx,buildFx,stopSmp]);
  const applyFxToSel=useCallback(()=>{if(!cur||sel==null)return;const b=buildFx(cur.buffer);setSamples(p=>p.map((s,i)=>i===sel?{...s,buffer:b,info:analyze(b)}:s));setFx({...FX0});setLog(p=>[...p,`✓ FX aplikované na "${cur.name}" (${ft(b.duration)})`]);},[cur,sel,buildFx]);
  const saveFxAsNew=useCallback(()=>{if(!cur)return;const b=buildFx(cur.buffer);addSample(cur.name+'_fx',b);setFx({...FX0});},[cur,buildFx,addSample]);

  const stopTrack=useCallback(()=>{for(const s of trackSrcR.current)try{s.stop();}catch(e){}trackSrcR.current=[];if(trackAfR.current)cancelAnimationFrame(trackAfR.current);setTrackPlaying(false);},[]);
  const startTrack=useCallback(()=>{const ctx=getCtx();if(ctx.state==='suspended')ctx.resume();stopTrack();if(!trackBlocks.length)return;if(!masterGR.current){masterGR.current=ctx.createGain();masterGR.current.connect(ctx.destination);}const t0=ctx.currentTime+.05;trackStR.current=t0;const srcs:AudioBufferSourceNode[]=[];for(const bl of trackBlocks){if(bl.mute)continue;const s=ctx.createBufferSource();s.buffer=bl.buffer;const g=ctx.createGain();g.gain.value=bl.vol;s.connect(g);g.connect(masterGR.current!);s.start(t0+bl.startSec);srcs.push(s);}trackSrcR.current=srcs;setTrackPlaying(true);const total=trackBlocks.reduce((mx,b)=>Math.max(mx,b.startSec+b.buffer.duration),0);const anim=()=>{const el=ctx.currentTime-t0;if(el>=total){setTrackPlaying(false);setTrackPos(0);return;}setTrackPos(el);trackAfR.current=requestAnimationFrame(anim);};trackAfR.current=requestAnimationFrame(anim);},[getCtx,stopTrack,trackBlocks]);
  const addSeqToTrack=useCallback((dir:'h'|'v')=>{const ctx=getCtx();const buf=bouncePat(channels,samples,bpm,stepCount,swing,ctx);const col=SWATCH[trackBlocks.length%SWATCH.length];trackIdR.current++;const targetLayer=dir==='h'?activeLayer:trackBlocks.reduce((mx,b)=>Math.max(mx,b.layer),0)+1;const endSec=trackBlocks.filter(b=>b.layer===targetLayer).reduce((mx,b)=>Math.max(mx,b.startSec+b.buffer.duration),0);const newBlock={id:trackIdR.current,name:`Pat${curPat}_${bpm}`,buffer:buf,startSec:dir==='h'?endSec:0,layer:targetLayer,vol:1,color:col,fx:{...FX0},mute:false};setTrackBlocks(p=>[...p,newBlock]);if(dir==='v')setLayerVols(lv=>({...lv,[targetLayer]:1}));setLog(p=>[...p,`▸ Sekvencia → ${dir==='h'?`Track ${targetLayer} (za seba)`:'nový paralelný track'}`]);},[getCtx,channels,samples,bpm,stepCount,swing,curPat,trackBlocks,activeLayer]);
  const addSampleToTrack=useCallback((si:number,dir:'h'|'v')=>{if(!samples[si])return;trackIdR.current++;const col=samples[si].color||SWATCH[trackBlocks.length%SWATCH.length];const targetLayer=dir==='h'?activeLayer:trackBlocks.reduce((mx,b)=>Math.max(mx,b.layer),0)+1;const endSec=trackBlocks.filter(b=>b.layer===targetLayer).reduce((mx,b)=>Math.max(mx,b.startSec+b.buffer.duration),0);const newBlock={id:trackIdR.current,name:samples[si].name,buffer:samples[si].buffer,startSec:dir==='h'?endSec:0,layer:targetLayer,vol:1,color:col,fx:{...FX0},mute:false};setTrackBlocks(p=>[...p,newBlock]);if(dir==='v')setLayerVols(lv=>({...lv,[targetLayer]:1}));setLog(p=>[...p,`▸ "${samples[si].name}" → Track`]);},[samples,trackBlocks,activeLayer]);
  const bakeLayerIntoMain=useCallback((layer:number)=>{if(layer===0)return;const ctx=getCtx();const lbs=trackBlocks.filter(b=>b.layer===layer);if(!lbs.length)return;const sr=44100;const startSec=Math.min(...lbs.map(b=>b.startSec));const endSec=Math.max(...lbs.map(b=>b.startSec+b.buffer.duration));const len=Math.ceil((endSec-startSec)*sr);const out=ctx.createBuffer(2,len,sr);const oL=out.getChannelData(0),oR=out.getChannelData(1);for(const bl of lbs){const off=Math.floor((bl.startSec-startSec)*sr);const ch0=bl.buffer.getChannelData(0),ch1=bl.buffer.numberOfChannels>1?bl.buffer.getChannelData(1):ch0;for(let i=0;i<bl.buffer.length&&off+i<len;i++){oL[off+i]+=ch0[i]*(layerVols[layer]??1)*bl.vol;oR[off+i]+=ch1[i]*(layerVols[layer]??1)*bl.vol;}}let pk=0;for(let i=0;i<len;i++)pk=Math.max(pk,Math.abs(oL[i]),Math.abs(oR[i]));if(pk>0.98){const g=0.98/pk;for(let i=0;i<len;i++){oL[i]*=g;oR[i]*=g;}}trackIdR.current++;const nb={id:trackIdR.current,name:`Track${layer}_do_main`,buffer:out,startSec,layer:0,vol:1,color:SWATCH[layer%SWATCH.length],fx:{...FX0},mute:false};setTrackBlocks(p=>[...p.filter(b=>b.layer!==layer),nb]);setLayerVols(lv=>{const n={...lv};delete n[layer];return n;});setLog(p=>[...p,`▸ Track ${layer} zakomponovaný do MAIN`]);},[trackBlocks,getCtx,layerVols]);
  const renderBlockWithOverlap=useCallback((id:number)=>{const bl=trackBlocks.find(b=>b.id===id);if(!bl)return null;const ctx=getCtx();const sr=44100;const s0=bl.startSec,s1=bl.startSec+bl.buffer.duration,dur=s1-s0;const len=Math.ceil(dur*sr);const out=ctx.createBuffer(2,len,sr);const oL=out.getChannelData(0),oR=out.getChannelData(1);for(const b of trackBlocks){if(b.mute)continue;const bE=b.startSec+b.buffer.duration;if(bE<=s0||b.startSec>=s1)continue;const oS=Math.max(b.startSec,s0),oE=Math.min(bE,s1);const srcOff=Math.floor((oS-b.startSec)*sr),dstOff=Math.floor((oS-s0)*sr),olen=Math.floor((oE-oS)*sr);const ch0=b.buffer.getChannelData(0),ch1=b.buffer.numberOfChannels>1?b.buffer.getChannelData(1):ch0;for(let i=0;i<olen;i++){oL[dstOff+i]+=(ch0[srcOff+i]||0)*(layerVols[b.layer]??1)*b.vol;oR[dstOff+i]+=(ch1[srcOff+i]||0)*(layerVols[b.layer]??1)*b.vol;}}let pk=0;for(let i=0;i<len;i++)pk=Math.max(pk,Math.abs(oL[i]),Math.abs(oR[i]));if(pk>0.98){const g=0.98/pk;for(let i=0;i<len;i++){oL[i]*=g;oR[i]*=g;}}return out;},[trackBlocks,getCtx,layerVols]);
  const splitTrackBlock=useCallback((id:number,fracPos:number)=>{const bl=trackBlocks.find(b=>b.id===id);if(!bl)return;const ctx=getCtx();const splitSec=fracPos*bl.buffer.duration;if(splitSec<.1||splitSec>bl.buffer.duration-.1)return;const[a,b2]=splitAt(bl.buffer,splitSec,ctx);trackIdR.current++;const nb={...bl,id:trackIdR.current,buffer:b2,startSec:bl.startSec+splitSec,name:bl.name+'_B'};setTrackBlocks(p=>p.map(x=>x.id===id?{...x,buffer:a,name:x.name+'_A'}:x).concat(nb));},[trackBlocks,getCtx]);
  const bounceTrack=useCallback(()=>{if(!trackBlocks.length)return null;const ctx=getCtx();const sr=44100;const totalDur=trackBlocks.reduce((mx,b)=>Math.max(mx,b.startSec+b.buffer.duration),0);const totalLen=Math.ceil(totalDur*sr);const out=ctx.createBuffer(2,totalLen,sr);const oL=out.getChannelData(0),oR=out.getChannelData(1);for(const bl of trackBlocks){if(bl.mute)continue;const buf=bl.buffer;const startS=Math.floor(bl.startSec*sr);const ch0=buf.getChannelData(0),ch1=buf.numberOfChannels>1?buf.getChannelData(1):ch0;for(let i=0;i<buf.length&&startS+i<totalLen;i++){oL[startS+i]+=ch0[i]*bl.vol;oR[startS+i]+=ch1[i]*bl.vol;}}let pk=0;for(let i=0;i<totalLen;i++){const a=Math.max(Math.abs(oL[i]),Math.abs(oR[i]));if(a>pk)pk=a;}if(pk>0.98){const g=0.98/pk;for(let i=0;i<totalLen;i++){oL[i]*=g;oR[i]*=g;}}return out;},[trackBlocks,getCtx]);

  const addCh=(si: number)=>{const c=MKCH(stepCount);c.sampleIdx=si;setChannels((p:any[])=>[...p,c]);};
  const rmCh=(i: number)=>setChannels((p:any[])=>p.filter((_,j)=>j!==i));
  const updCh=(i: number,k: string,v: any)=>setChannels((p:any[])=>p.map((c,j)=>j===i?{...c,[k]:v}:c));
  const toggleStep=(ci: number,si: number)=>setChannels((p:any[])=>p.map((c,j)=>j===ci?{...c,steps:c.steps.map((s:boolean,k:number)=>k===si?!s:s)}:c));
  const setVel=(ci: number,si: number,v: number)=>setChannels((p:any[])=>p.map((c,j)=>j===ci?{...c,velocities:c.velocities.map((vel:number,k:number)=>k===si?v:vel)}:c));
  const setRatch=(ci: number,si: number)=>setChannels((p:any[])=>p.map((c,j)=>j===ci?{...c,ratchets:c.ratchets.map((r:number,k:number)=>k===si?(r%4)+1:r)}:c));
  const nudgeCh=(ci: number,n: number)=>setChannels((p:any[])=>p.map((c,j)=>{if(j!==ci)return c;const L=c.steps.length;if(!L)return c;const rot=(a:any[])=>a&&a.length?a.map((_:any,i:number)=>a[((i-n)%L+L)%L]):a;return{...c,steps:rot(c.steps),velocities:rot(c.velocities),ratchets:rot(c.ratchets),filterAuto:rot(c.filterAuto)};}));
  const setBarLen=(n: number)=>{scR.current=n;setStepCount(n);setPatterns((ps:any[])=>ps.map(pat=>pat.map((c:any)=>{const rs=(a:any[],f:any)=>{const r=(a||[]).slice(0,n);while(r.length<n)r.push(f);return r;};return{...c,steps:rs(c.steps,false),velocities:rs(c.velocities,80),ratchets:rs(c.ratchets,1),filterAuto:rs(c.filterAuto,1)};})));};
  const dropToSeq=async(files: File[])=>{const ctx=getCtx();let base=smpRef.current.length,i=0;for(const f of files){if(!f.type.startsWith('audio/')&&!f.name.match(/\.(wav|mp3|ogg|flac|m4a|aac|webm)$/i))continue;try{const ab=await f.arrayBuffer();const buf=await ctx.decodeAudioData(ab);const name=f.name.replace(/\.[^.]+$/,'');addSample(name,buf);const idx=base+i;setChannels((cs:any[])=>[...cs,{...MKCH(scR.current),sampleIdx:idx}]);i++;}catch(e){}}};

  // AI
  const snapshot=useCallback(()=>({samples:samples.slice(),patterns:patterns.map((p:any[])=>p.slice()),bpm,swing,stepCount,curPat,sel}),[samples,patterns,bpm,swing,stepCount,curPat,sel]);
  const restoreSnap=useCallback((s:any)=>{if(!s)return;setSamples(s.samples.slice());setPatterns(s.patterns.map((p:any[])=>p.slice()));setBpm(s.bpm);setSwing(s.swing);setStepCount(s.stepCount);scR.current=s.stepCount;setCurPat(s.curPat);setSel(s.sel);},[]);
  const undo=useCallback(()=>{if(!undoStack.length)return;const snap=undoStack[undoStack.length-1];setRedoStack(r=>[...r,snapshot()]);setUndoStack(p=>p.slice(0,-1));restoreSnap(snap);setAbSnap(null);setLog(p=>[...p,'◶ Undo']);},[undoStack,snapshot,restoreSnap]);
  const redo=useCallback(()=>{if(!redoStack.length)return;const snap=redoStack[redoStack.length-1];setUndoStack(p=>[...p,snapshot()]);setRedoStack(r=>r.slice(0,-1));restoreSnap(snap);setAbSnap(null);setLog(p=>[...p,'◷ Redo']);},[redoStack,snapshot,restoreSnap]);
  const abToggle=useCallback(()=>{if(!abSnap)return;if(abSnap.showing==='B'){restoreSnap(abSnap.before);setAbSnap({...abSnap,showing:'A'});}else{restoreSnap(abSnap.after);setAbSnap({...abSnap,showing:'B'});}},[abSnap,restoreSnap]);
  const abKeep=useCallback(()=>{if(abSnap)restoreSnap(abSnap.after);setAbSnap(null);},[abSnap,restoreSnap]);
  const abRevert=useCallback(()=>{if(abSnap){restoreSnap(abSnap.before);setUndoStack(p=>p.slice(0,-1));setRedoStack([]);}setAbSnap(null);},[abSnap,restoreSnap]);
  useEffect(()=>{if(abPending){setAbSnap({before:abPending,after:snapshot(),showing:'B'});setAbPending(null);}},[abPending,snapshot]);

  const execCmds=useCallback(async(cmds: any[],sa: any[])=>{const ctx=getCtx();let ci=sel;let arr=[...sa];let chs=[...channels];let tb=[...trackBlocks];let tbDirty=false;let lg:string[]=[];let bp=bpm;let sw=swing;

    // SEQ batch validator — runs before the main loop
    const addChBatch=cmds.filter((c:any)=>c.op==='add_channel');
    let processedCmds=cmds;
    if(addChBatch.length>0){
      const detectedGenre=bp>=170?'acidcore':bp>=158?'hardtek':bp>=142?'hard_tekno':bp>=128?'tekno':bp>=118?'dub_techno':bp<=90?'reggae':'tekno';
      const valResult=repairOrFallback(addChBatch,detectedGenre,0);
      valResult.issues.filter((i:any)=>i.severity==='error').forEach((i:any)=>lg.push(`⚠ SEQ: ${i.message}`));
      if(valResult.usedFallback)lg.push(`⚠ SEQ: použitý fallback template (${detectedGenre})`);
      const repaired=[...valResult.repairedCmds];let ri=0;
      processedCmds=cmds.flatMap((c:any)=>{
        if(c.op!=='add_channel')return[c];
        return ri<repaired.length?[repaired[ri++]]:[];
      });
      if(ri<repaired.length)processedCmds=[...processedCmds,...repaired.slice(ri)];
    }

    for(const cmd of processedCmds){try{
      if(cmd.op==='select'){ci=cmd.sample;setSel(ci);}
      else if(cmd.op==='trim_silence'&&ci!=null&&arr[ci]){const b=trimSil(arr[ci].buffer,ctx);arr[ci]={...arr[ci],buffer:b,info:analyze(b)};lg.push(`▸ Trim`);}
      else if(cmd.op==='crop_time'&&ci!=null&&arr[ci]){const b=cropT(arr[ci].buffer,cmd.start||0,cmd.end||arr[ci].buffer.duration,ctx);arr[ci]={...arr[ci],buffer:b,info:analyze(b)};lg.push(`▸ Crop`);}
      else if(cmd.op==='loop'&&ci!=null&&arr[ci]){const b=mkLoop(arr[ci].buffer,cmd.times||4,cmd.crossfade||.02,ctx);arr[ci]={...arr[ci],buffer:b,info:analyze(b)};lg.push(`▸ Loop ${cmd.times}×`);}
      else if(cmd.op==='effects'&&ci!=null&&arr[ci]){const p=cmd.params||{};const b=applyFx(arr[ci].buffer,{gain:p.gain??1,reverse:!!p.reverse,normalize:!!p.normalize,fadeIn:p.fadeIn||0,fadeOut:p.fadeOut||0,lpFreq:p.lpFreq??20000,hpFreq:p.hpFreq??20,saturation:p.saturation||0,delay:p.delay||0,delayTime:p.delayTime||.25,delayFb:p.delayFb||.3,compress:p.compress||0},ctx);arr[ci]={...arr[ci],buffer:b,info:analyze(b)};lg.push(`▸ FX`);}
      else if(cmd.op==='rename'&&ci!=null){arr[ci]={...arr[ci],name:cmd.name};lg.push(`▸ Rename`);}
      else if(cmd.op==='duplicate'&&ci!=null&&arr[ci]){arr.push({...arr[ci],name:cmd.newName||arr[ci].name+'_dup'});lg.push(`▸ Dup #${arr.length-1}`);}
      else if(cmd.op==='create_from'){const si2=cmd.source??ci;if(si2!=null&&arr[si2]){let b=arr[si2].buffer;for(const op of(cmd.operations||[])){if(op.op==='trim_silence')b=trimSil(b,ctx);else if(op.op==='crop_time')b=cropT(b,op.start||0,op.end||b.duration,ctx);else if(op.op==='loop')b=mkLoop(b,op.times||4,op.crossfade||.02,ctx);else if(op.op==='effects')b=applyFx(b,{gain:op.params?.gain??1,reverse:!!op.params?.reverse,normalize:!!op.params?.normalize,fadeIn:op.params?.fadeIn||0,fadeOut:op.params?.fadeOut||0,lpFreq:op.params?.lpFreq??20000,hpFreq:op.params?.hpFreq??20,saturation:op.params?.saturation||0,delay:op.params?.delay||0,delayTime:op.params?.delayTime||.25,delayFb:op.params?.delayFb||.3,compress:op.params?.compress||0},ctx);}arr.push({name:cmd.newName||`new_${arr.length}`,buffer:b,info:analyze(b),original:b});lg.push(`▸ Nová "${cmd.newName}" #${arr.length-1}`);}}
      else if(cmd.op==='add_channel'){const si2=cmd.sample??ci;if(si2!=null){const c=MKCH(stepCount);c.sampleIdx=si2;if(cmd.steps)c.steps=cmd.steps.map((v:any)=>!!v);if(cmd.velocities)c.velocities=cmd.velocities;if(cmd.ratchets)c.ratchets=cmd.ratchets;if(cmd.volume!=null)c.vol=cmd.volume;if(cmd.pan!=null)c.pan=cmd.pan;if(cmd.pitch!=null)c.pitch=cmd.pitch;if(cmd.eqLow!=null)c.eqL=cmd.eqLow;if(cmd.eqMid!=null)c.eqM=cmd.eqMid;if(cmd.eqHigh!=null)c.eqH=cmd.eqHigh;if(cmd.sidechain!=null)c.sidechain=cmd.sidechain;if(cmd.isKick!=null)c.isKick=cmd.isKick;if(cmd.filterAuto)c.filterAuto=cmd.filterAuto;const activeSteps=(c.steps||[]).filter(Boolean).length;if(activeSteps<2){lg.push(`✗ Ch "${arr[si2]?.name}" preskočený — menej ako 2 aktívne kroky`);}else{chs.push(c);lg.push(`▸ Ch: "${arr[si2]?.name}"`);}}}
      else if(cmd.op==='set_channel'&&cmd.channel!=null&&chs[cmd.channel]){const c={...chs[cmd.channel]};if(cmd.volume!=null)c.vol=cmd.volume;if(cmd.pan!=null)c.pan=cmd.pan;if(cmd.pitch!=null)c.pitch=cmd.pitch;if(cmd.steps)c.steps=cmd.steps.map((v:any)=>!!v);if(cmd.velocities)c.velocities=cmd.velocities;if(cmd.ratchets)c.ratchets=cmd.ratchets;if(cmd.eqLow!=null)c.eqL=cmd.eqLow;if(cmd.eqMid!=null)c.eqM=cmd.eqMid;if(cmd.eqHigh!=null)c.eqH=cmd.eqHigh;if(cmd.mute!=null)c.mute=cmd.mute;if(cmd.solo!=null)c.solo=cmd.solo;if(cmd.sidechain!=null)c.sidechain=cmd.sidechain;if(cmd.isKick!=null)c.isKick=cmd.isKick;if(cmd.filterAuto)c.filterAuto=cmd.filterAuto;chs[cmd.channel]=c;lg.push(`▸ Ch${cmd.channel} upd`);}
      else if(cmd.op==='shift_channel'&&cmd.channel!=null&&chs[cmd.channel]){const c={...chs[cmd.channel]};const n=Math.round(cmd.steps||0);const L=c.steps.length;const rot=(a:any[])=>a&&a.length?a.map((_,i)=>a[((i-n)%L+L)%L]):a;c.steps=rot(c.steps);c.velocities=rot(c.velocities);c.ratchets=rot(c.ratchets);c.filterAuto=rot(c.filterAuto);chs[cmd.channel]=c;lg.push(`▸ Posun Ch${cmd.channel} ${n>0?'+':''}${n}`);}
      else if(cmd.op==='clear_channel'&&cmd.channel!=null&&chs[cmd.channel]){const c={...chs[cmd.channel]};c.steps=c.steps.map(()=>false);chs[cmd.channel]=c;lg.push(`▸ Vyčisti Ch${cmd.channel}`);}
      else if(cmd.op==='remove_channel'&&cmd.channel!=null&&chs[cmd.channel]){const nm=arr[chs[cmd.channel].sampleIdx]?.name;chs=chs.filter((_,j)=>j!==cmd.channel);lg.push(`▸ Zmaž Ch${cmd.channel}${nm?` "${nm}"`:''}`);}
      else if(cmd.op==='duplicate_channel'&&cmd.channel!=null&&chs[cmd.channel]){chs.push(JSON.parse(JSON.stringify(chs[cmd.channel])));lg.push(`▸ Dup Ch${cmd.channel}`);}
      else if(cmd.op==='euclid'&&cmd.channel!=null&&chs[cmd.channel]){const c={...chs[cmd.channel]};const L=c.steps.length||stepCount;const k=cmd.pulses??4;c.steps=euclidSteps(L,k,cmd.rotate||0);chs[cmd.channel]=c;lg.push(`▸ Euclid Ch${cmd.channel} ${k}/${L}`);}
      else if(cmd.op==='humanize'&&cmd.channel!=null&&chs[cmd.channel]){const c={...chs[cmd.channel]};c.velocities=humanizeVels(c.velocities,cmd.amount??.3);chs[cmd.channel]=c;lg.push(`▸ Humanize Ch${cmd.channel}`);}
      else if(cmd.op==='apply_genre'){const g=GENRE[String(cmd.genre||'').toLowerCase()];if(g){bp=g.bpm;setBpm(g.bpm);sw=g.swing;setSwing(g.swing);lg.push(`▸ Žáner ${cmd.genre} → BPM ${g.bpm}, swing ${g.swing}%`);}}
      else if(cmd.op==='auto_mix'){if(chs.length){const r=autoBalance(chs,arr);chs=r.chs;lg.push(`▸ Auto-mix ${chs.length} stôp (cieľ ${r.target.toFixed(1)} LUFS)`);}else lg.push(`✗ auto_mix: žiadne stopy`);}
      else if(cmd.op==='match_reference'){const si2=cmd.source??cmd.sample??ci;const ref=arr[si2];if(ref&&ref.info){const rb=ref.info.bpm;if(Number.isFinite(rb)&&rb>=20&&rb<=400){bp=Math.round(rb);setBpm(bp);}const tgt=Number.isFinite(ref.info.lufs)?ref.info.lufs:-23;if(chs.length){const r=autoBalance(chs,arr,tgt);chs=r.chs;}const ks=ref.info.key?` ${ref.info.key}${ref.info.scale==='minor'?'m':''}`:'';lg.push(`▸ Referencia "${ref.name}" → BPM ${bp},${ks?` tónina${ks},`:''} hlasitosť ${tgt.toFixed(1)} LUFS`);}else lg.push(`✗ match_reference: vzorka #${si2} neexistuje`);}
      else if(cmd.op==='add_to_track'){if(chs.length){const buf=bouncePat(chs,arr,bp,stepCount,sw,ctx);const times=Math.max(1,Math.min(16,Math.round(cmd.times||1)));const nm=cmd.name||`Pat${curPat}_${bp}`;for(let t=0;t<times;t++){const endSec=tb.filter(b=>b.layer===activeLayer).reduce((mx,b)=>Math.max(mx,b.startSec+b.buffer.duration),0);trackIdR.current++;tb.push({id:trackIdR.current,name:nm,buffer:buf,startSec:Number.isFinite(endSec)?endSec:0,layer:activeLayer,vol:1,color:SWATCH[tb.length%SWATCH.length],fx:{...FX0},mute:false});}tbDirty=true;lg.push(`▸ Aranžmán: "${nm}" ${times}× → skladba`);}else lg.push(`✗ add_to_track: žiadne stopy`);}
      else if(cmd.op==='add_sample_to_track'){const si2=cmd.sample??ci;if(si2!=null&&arr[si2]){const dir=cmd.dir==='v'?'v':'h';const times=Math.max(1,Math.min(16,Math.round(cmd.times||1)));const buf=arr[si2].buffer;const nm=arr[si2].name;const targetLayer=dir==='h'?activeLayer:tb.reduce((mx,b)=>Math.max(mx,b.layer),0)+1;for(let t=0;t<times;t++){const endSec=tb.filter(b=>b.layer===targetLayer).reduce((mx,b)=>Math.max(mx,b.startSec+b.buffer.duration),0);trackIdR.current++;tb.push({id:trackIdR.current,name:nm,buffer:buf,startSec:Number.isFinite(endSec)?endSec:0,layer:targetLayer,vol:1,color:samples[si2]?.color||SWATCH[tb.length%SWATCH.length],fx:{...FX0},mute:false});}tbDirty=true;lg.push(`▸ "${nm}" ${times}× → Track${dir==='v'?` (paralelne, vrstva ${targetLayer})`:''}`);}else lg.push(`✗ add_sample_to_track: vzorka #${si2} neexistuje`);}
      else if(cmd.op==='save_to_library'){const tgt=cmd.target==='track'?'track':'pattern';let buf:AudioBuffer|null=null;if(tgt==='track'){buf=bounceTrack();}else if(chs.length){buf=bouncePat(chs,arr,bp,stepCount,sw,ctx);}if(buf){let nm=cmd.name;if(!nm){let mx=0;for(const s of arr){const m=/^AIoutput(\d+)$/.exec(s.name);if(m)mx=Math.max(mx,+m[1]);}nm=`AIoutput${mx+1}`;}arr.push({name:nm,buffer:buf,info:analyze(buf),original:buf});lg.push(`💾 Uložené do knižnice: "${nm}" (${ft(buf.duration)})`);}else lg.push(`✗ save_to_library: ${tgt==='track'?'prázdny track':'žiadne stopy'}`);}
      else if(cmd.op==='set_bpm'){const v=Math.max(20,Math.min(400,Number(cmd.bpm)||128));bp=v;setBpm(v);lg.push(`▸ BPM ${v}`);}
      else if(cmd.op==='set_swing'){const v=Math.max(50,Math.min(75,Number(cmd.swing)||50));sw=v;setSwing(v);lg.push(`▸ Swing ${v}%`);}
      else if(cmd.op==='set_pattern'){setCurPat(cmd.pattern);lg.push(`▸ Pattern ${cmd.pattern}`);}
      else if(cmd.op==='copy_pattern'){const from=cmd.from??curPat;setPatterns(p=>{const n=[...p];n[cmd.to]=JSON.parse(JSON.stringify(n[from]));return n;});lg.push(`▸ Copy pat ${cmd.from}→${cmd.to}`);}
      else if(cmd.op==='bounce_pattern'){const buf=bouncePat(chs,arr,bp,stepCount,sw,ctx);arr.push({name:cmd.name||`Pat_${bp}`,buffer:buf,info:analyze(buf),original:buf});lg.push(`▸ Bounce→"${cmd.name}"`);}
      else if(cmd.op==='split'&&ci!=null&&arr[ci]){const t=cmd.time||arr[ci].buffer.duration/2;const[a,b2]=splitAt(arr[ci].buffer,t,ctx);const nm=arr[ci].name;arr[ci]={...arr[ci],name:nm+'_A',buffer:a,info:analyze(a)};arr.push({name:nm+'_B',buffer:b2,info:analyze(b2),original:b2});lg.push(`▸ Split "${nm}" @ ${t.toFixed(2)}s → A(${ft(a.duration)}) + B(${ft(b2.duration)})`);}
      else if(cmd.op==='merge'){const idxs=cmd.samples||[];if(idxs.length>=2){const bufs=idxs.map((i:number)=>arr[i]?.buffer).filter(Boolean);if(bufs.length>=2){const gaps=cmd.gaps||[];const merged=mergeBufs(bufs,gaps,ctx);const nm=cmd.name||'Merged_'+arr.length;arr.push({name:nm,buffer:merged,info:analyze(merged),original:merged});lg.push(`▸ Merge ${idxs.length} vzoriek → "${nm}" (${ft(merged.duration)})`);}}}
      else if(cmd.op==='export'&&ci!=null&&arr[ci])doExport(arr[ci].buffer,arr[ci].name);
      else if(cmd.op==='export_pattern'){const buf=bouncePat(chs,arr,bp,stepCount,sw,ctx);doExport(buf,'pattern');}
    }catch(e: any){lg.push(`✗ ${cmd.op}: ${e.message}`);}}
    setSamples(arr);setChannels(chs);if(tbDirty)setTrackBlocks(tb);setLog(p=>[...p,...lg]);return lg;
  },[sel,channels,bpm,swing,stepCount,curPat,getCtx,doExport,addSample,bounceTrack,activeLayer,samples,trackBlocks]);

  const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

  const sendChat = useCallback(async (override?: string) => {
    const msg = (override ?? input).trim();
    if (!msg || loading) return;
    if (override === undefined) setInput(""); else setCmdInput("");
    const nm = [...msgs, { role: "user" as const, content: msg }];
    setMsgs(nm);
    setLoading(true);
    try {
      const si = samples.map((s, i) => { const f = s.info; return `${i}."${s.name}" ${f.duration.toFixed(2)}s${f.bpm ? ` ~${f.bpm}BPM` : ""}${f.key ? ` ${f.key}${f.scale === "minor" ? "m" : ""}` : ""}${(f as any).lufs != null ? ` ${(f as any).lufs.toFixed(1)}LUFS` : ""}${(f as any).onsetCount ? ` ${(f as any).onsetCount}hits` : ""}`; }).join("\n");
      const ci2 = channels.map((c, i) => `Ch${i}:"${samples[c.sampleIdx]?.name}" vol${c.vol} pan${c.pan} pitch${c.pitch}${c.mute ? " MUTE" : ""}${c.solo ? " SOLO" : ""} eq[${c.eqL ?? 1}/${c.eqM ?? 1}/${c.eqH ?? 1}] steps[${c.steps.map((s: boolean) => (s ? 1 : 0)).join("")}]`).join("\n");
      const context = `\nSamples:\n${si || "(empty)"}\n${sel != null ? `Sel:#${sel}"${samples[sel]?.name}"` : ""}\nBPM:${bpm} Swing:${swing} Steps:${stepCount} Pattern:${curPat}\nChannels:\n${ci2 || "(empty)"}\nMode:${mode}`;
      const sysp = mode === "tekno" ? SYSP_TK : SYSP_CL;

      const response = await fetch(`${BASE}/api/ai/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: nm.slice(-10).map(m => ({ role: m.role === "system" ? "user" : m.role, content: m.content })),
          systemPrompt: sysp,
          context,
          mode,
        }),
      });

      if (!response.body) throw new Error("No body");
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let parsed: { message?: string; commands?: Array<{ op: string; [k: string]: unknown }>; warnings?: string[] } = {};
      
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const text = decoder.decode(value);
        for (const line of text.split("\n")) {
          if (!line.startsWith("data: ")) continue;
          try {
            const evt = JSON.parse(line.slice(6));
            if (evt.done && evt.parsed) parsed = evt.parsed;
          } catch { /* ignore */ }
        }
      }

      if (parsed.message) setMsgs(p => [...p, { role: "assistant", content: parsed.message! }]);
      if (parsed.warnings && parsed.warnings.length) setMsgs(p => [...p, { role: "system", content: "⚠ " + parsed.warnings!.join("; ") }]);
      if (parsed.commands && parsed.commands.length > 0) {
        const before = snapshot();
        setUndoStack(p => [...p.slice(-19), before]);
        setRedoStack([]);
        const lg = await execCmds(parsed.commands, samples);
        setAbPending(before);
        if (lg.length) setMsgs(p => [...p, { role: "system", content: ">> " + lg.join("\n") }]);
      }
    } catch (e) {
      setMsgs(p => [...p, { role: "assistant", content: "Chyba. Skús znova." }]);
    }
    setLoading(false);
  }, [input, msgs, loading, samples, sel, channels, bpm, swing, stepCount, curPat, mode, execCmds, BASE]);

  const onCvD=(e: any)=>{if(!cur)return;if(!cvR.current)return;const r=cvR.current.getBoundingClientRect();sdR.current={s:(e.clientX-r.left)/r.width};setWfSel({start:sdR.current.s,end:sdR.current.s});};
  const onCvM=(e: any)=>{if(!sdR.current)return;if(!cvR.current)return;const r=cvR.current.getBoundingClientRect();const x=Math.max(0,Math.min(1,(e.clientX-r.left)/r.width));setWfSel({start:Math.min(sdR.current.s,x),end:Math.max(sdR.current.s,x)});};
  const onCvU=useCallback(()=>{
    if(sdR.current&&wfSel){
      if(wfSel.end-wfSel.start<.005){
        setWfSel(null);
        const pos=wfSel.start;
        if(cur){
          if(playing){
            const ctx=getCtx();
            try{srcR.current?.stop();}catch(e){}
            if(afR.current)cancelAnimationFrame(afR.current);
            const s=ctx.createBufferSource();s.buffer=cur.buffer;s.connect(ctx.destination);
            const off=pos*cur.buffer.duration;s.start(0,off);srcR.current=s;stR.current=ctx.currentTime-off;
            const u=()=>{const p=(ctx.currentTime-stR.current)/cur.buffer.duration;if(p>=1){setPlaying(false);setPlayPos(null);return;}setPlayPos(p);afR.current=requestAnimationFrame(u);};afR.current=requestAnimationFrame(u);
            s.onended=()=>{setPlaying(false);setPlayPos(null);};
          } else {setPlayPos(pos);}
        }
      }
    }
    sdR.current=null;
  },[wfSel,playing,cur,getCtx]);

  const isTK=mode==='tekno';

  return(
  <div style={{width:'100%',height:'100vh',display:'flex',flexDirection:'column',background:th.bg,color:th.tx,fontFamily:isTK?"'Courier New',monospace":"'Segoe UI',sans-serif",fontSize:13,overflow:'hidden',userSelect:'none'}}>
    {/* Transport */}
    <div style={{display:'flex',alignItems:'center',gap:8,padding:'8px 12px',background:th.bgD,borderBottom:`1px solid ${th.bd}`,flexShrink:0,flexWrap:'wrap',boxShadow:'0 2px 8px rgba(0,0,0,0.2)',zIndex:10}}>
      {/* Mode toggle */}
      <div style={{display:'flex',borderRadius:4,overflow:'hidden',border:`1px solid ${th.bd}`}}>
        <button onClick={()=>setMode('classic')} style={{padding:'6px 14px',fontSize:12,fontWeight:600,cursor:'pointer',border:'none',background:!isTK?C.ac:C.bgL,color:!isTK?'#fff':C.txD}}>CLASSIC</button>
        <button onClick={()=>setMode('tekno')} style={{padding:'6px 14px',fontSize:12,fontWeight:600,cursor:'pointer',border:'none',background:isTK?TK.ac:TK.bgL,color:isTK?'#000':TK.txD}}>TEKNO</button>
      </div>
      <div style={{width:1,height:24,background:th.bd}}/>
      <button style={{...sb(playing,null,th), padding: '6px 14px', fontWeight: 600, minWidth: 60}} onClick={playing?stopSmp:playSmp} disabled={!cur}>{playing?'STOP':'PLAY'}</button>
      <button style={{...sb(recording,th.red,th), padding: '6px 14px', fontWeight: 600, minWidth: 60}} onClick={recording?stopRec:startRec}><span style={{color:recording?'#fff':th.red}}>{recording?'REC':'REC'}</span></button>
      {recording&&<div style={{width:50,height:6,background:th.bgD,borderRadius:3,overflow:'hidden'}}><div style={{height:'100%',width:`${recLvl*100}%`,background:recLvl>.8?th.red:th.ac,transition:'width .05s'}}/></div>}
      <div style={{width:1,height:24,background:th.bd}}/>
      <button style={{...sb(seqPlaying,th.ac2,th), padding: '6px 14px', fontWeight: 600, minWidth: 60}} onClick={seqPlaying?stopSeq:startSeq}>{seqPlaying?'STOP SEQ':'PLAY SEQ'}</button>
      <div style={{display:'flex',alignItems:'center',gap:4,background:th.bgL,borderRadius:4,padding:'4px 8px',border:`1px solid ${th.bd}`}}>
        <span style={{fontSize:10,fontWeight:600,color:th.txD,letterSpacing:1}}>BPM</span>
        <input type="number" value={bpm} onChange={e=>setBpm(Math.max(40,Math.min(300,+e.target.value||128)))} style={{width:44,background:'transparent',border:'none',color:th.ac,fontSize:14,fontWeight:700,textAlign:'center',outline:'none',fontFamily:'inherit'}}/>
      </div>
      <button onClick={()=>setShowDecompose(p=>!p)} style={{...sb(showDecompose,'#aa44ff',th),padding:'4px 12px',fontWeight:700,letterSpacing:.5,fontSize:11}} title="Multilayer Track Decompositor — izoluj stopy z nahrávky">⬡ DECOMPOSE</button>
      {isTK&&<div style={{display:'flex',alignItems:'center',gap:4,background:th.bgL,borderRadius:4,padding:'4px 8px',border:`1px solid ${th.bd}`}}>
        <span style={{fontSize:10,fontWeight:600,color:th.txD,letterSpacing:1}}>SWG</span>
        <input type="range" min={50} max={75} value={swing} onChange={e=>setSwing(+e.target.value)} style={{width:50,accentColor:th.ac}}/>
        <span style={{fontSize:11,fontWeight:600,color:th.ac,width:26}}>{swing}%</span>
      </div>}
      {/* Pattern bank */}
      {isTK&&<div style={{display:'flex',gap:2}}>
        {patterns.map((_,i)=>(
          <button key={i} onClick={()=>{if(seqPlaying)stopSeq();setCurPat(i);}} style={{width:26,height:26,borderRadius:4,fontSize:11,fontWeight:700,cursor:'pointer',border:`1px solid ${i===curPat?th.ac:th.bd}`,background:i===curPat?th.ac+'33':th.bgL,color:i===curPat?th.ac:th.txD}}>{String.fromCharCode(65+i)}</button>
        ))}
      </div>}
      <div style={{flex:1}}/>
      <button style={{...sb(false,th.ac2,th), padding: '6px 14px', fontWeight:600}} onClick={loadTeknoKit} title="Načítaj náhodný tekno kit + pattern (150-185 BPM, hardtek)">Tekno Kit</button>
      <button style={{...sb(false,null,th), padding: '6px 14px'}} onClick={()=>doBounce()}>Bounce</button>
      <label style={{...sb(false,null,th), padding: '6px 14px', cursor:'pointer'}}>Add Sample<input type="file" accept="audio/*" multiple style={{display:'none'}} onChange={e=>{if(e.target.files)handleFiles(Array.from(e.target.files));}}/></label>
      <button style={{...sb(false,null,th), padding: '6px 14px'}} onClick={()=>{const ctx=getCtx();const buf=bouncePat(channels,samples,bpm,stepCount,swing,ctx);doExport(buf,'mix');}} disabled={!channels.length}>Export Mix</button>
    </div>

    <div style={{display:'flex',flex:1,overflow:'hidden'}}>
      {/* Left — Samples */}
      <div style={{width:200,background:th.bgP,borderRight:`1px solid ${th.bd}`,display:'flex',flexDirection:'column',flexShrink:0,zIndex:5}}>
        <div style={{padding:'8px 12px',borderBottom:`1px solid ${th.bd}`,fontSize:11,fontWeight:700,textTransform:'uppercase',color:th.txD,letterSpacing:1.5}}>Library ({samples.length})</div>
        <div style={{flex:1,overflow:'auto',padding:4}} onDrop={e=>{e.preventDefault();if(e.dataTransfer.files)handleFiles(Array.from(e.dataTransfer.files));}} onDragOver={e=>e.preventDefault()}>
          {!samples.length&&<div style={{padding:20,textAlign:'center',color:th.txD,fontSize:11}}>Drag & drop audio files</div>}
          {samples.map((s,i)=>(
            <div key={i} style={{padding:'5px 6px',margin:2,borderRadius:4,cursor:'pointer',display:'flex',alignItems:'center',gap:4,background:i===sel?th.bgL:'transparent',border:`1px solid ${i===sel?(s.color||th.ac):'transparent'}`,transition:'all 0.1s'}}>
              <div style={{width:8,height:8,borderRadius:'50%',background:s.color||th.ac,flexShrink:0,cursor:'pointer'}} onClick={()=>{const nc=SWATCH[(SWATCH.indexOf(s.color)+1)%SWATCH.length];setSamples(p=>p.map((x,j)=>j===i?{...x,color:nc}:x));}} title="Klikni na zmenu farby"/>
              <div onClick={()=>{setSel(i);setWfSel(null);}} style={{flex:1,minWidth:0}}>
                <div style={{fontSize:11,fontWeight:i===sel?600:400,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{s.name}</div>
                <div style={{fontSize:9,color:th.txD}}>{ft(s.info.duration)}{s.info.bpm?` ${s.info.bpm}bpm`:''}{(s.info as any).key?` ${(s.info as any).key}${(s.info as any).scale==='minor'?'m':''}`:''}{s.tag?<span style={{marginLeft:4,background:s.color+'33',color:s.color,padding:'1px 4px',borderRadius:3,fontSize:8}}>{s.tag}</span>:null}</div>
              </div>
              <button onClick={()=>setRenameTarget({idx:i,name:s.name})} style={{background:'none',border:'none',color:th.txD,cursor:'pointer',fontSize:10,padding:'2px 3px',borderRadius:3}} title="Premenovať">✎</button>
              <button onClick={()=>addCh(i)} title="Add to Sequencer" style={{background:'none',border:'none',color:th.ac2,cursor:'pointer',fontSize:10,fontWeight:600,padding:4,borderRadius:3}}>+SEQ</button>
              <button onClick={()=>addSampleToTrack(i,'h')} title="Pridaj do Tracku (za)" style={{background:'none',border:'none',color:th.ac3,cursor:'pointer',fontSize:10,fontWeight:600,padding:4,borderRadius:3}}>+T</button>
              <button onClick={()=>{setSamples(p=>p.filter((_,j)=>j!==i));if(sel===i)setSel(null);else if(sel!=null&&sel>i)setSel(p=>(p as number)-1);}} style={{background:'none',border:'none',color:th.txD,cursor:'pointer',fontSize:12,padding:4,borderRadius:3}}>x</button>
            </div>
          ))}
        </div>
      </div>

      {/* Center */}
      <div style={{flex:1,display:'flex',flexDirection:'column',overflow:'hidden'}}>
        {/* Waveform */}
        <div style={{height:120,flexShrink:0,padding:'6px 8px 2px',borderBottom:`1px solid ${th.bd}`,background:th.bgD}}>
          <div style={{width:'100%',height:'100%',borderRadius:4,overflow:'hidden',border:`1px solid ${th.bd}`,position:'relative',boxShadow:'inset 0 2px 4px rgba(0,0,0,0.5)'}}>
            <canvas ref={cvR} style={{width:'100%',height:'100%',display:'block',cursor:cur?'crosshair':'default'}} onMouseDown={onCvD} onMouseMove={onCvM} onMouseUp={onCvU} onMouseLeave={onCvU}/>
            {!cur&&<div style={{position:'absolute',inset:0,display:'flex',alignItems:'center',justifyContent:'center',color:th.txD,fontSize:12,fontWeight:600,letterSpacing:2}}>SELECT A SAMPLE</div>}
          </div>
        </div>
        {cur&&<div style={{display:'flex',gap:4,padding:'6px 8px',borderBottom:`1px solid ${th.bd}`,flexShrink:0,background:th.bgD,flexWrap:'wrap'}}>
          <button style={sb(false,null,th)} onClick={()=>{setUndoStack(p=>[...p.slice(-19),snapshot()]);setRedoStack([]);const ctx=getCtx();const b=trimSil(cur.buffer,ctx);setSamples(p=>p.map((s,i)=>i===sel?{...s,buffer:b,info:analyze(b)}:s));}}>Trim Silence</button>
          {wfSel&&<button style={sb(false,null,th)} onClick={()=>{setUndoStack(p=>[...p.slice(-19),snapshot()]);setRedoStack([]);const ctx=getCtx();const b=cropR(cur.buffer,wfSel.start,wfSel.end,ctx);setSamples(p=>p.map((s,i)=>i===sel?{...s,buffer:b,info:analyze(b)}:s));setWfSel(null);}}>Crop Selection</button>}
          <button style={sb(true,th.ac2,th)} onClick={()=>{const ctx=getCtx();const r=wfSel||{start:0,end:Math.min(1,1/cur.buffer.duration)};const b=cropR(cur.buffer,r.start,r.end,ctx);addSample(cur.name+'_clip',b);setWfSel(null);setLog(p=>[...p,`✓ Krátky zvuk "${cur.name}_clip" (${ft(b.duration)})`]);}} title="Vytvor krátky zvuk z výberu (alebo prvá 1s) a pridaj do knižnice">Create Sound</button>
          {wfSel&&<button style={sb(false,null,th)} onClick={()=>{setUndoStack(p=>[...p.slice(-19),snapshot()]);setRedoStack([]);const ctx=getCtx();const t=wfSel.start*cur.buffer.duration;const[a,b2]=splitAt(cur.buffer,t,ctx);const nm=cur.name;setSamples(p=>{const n=[...p];n[sel as number]={...n[sel as number],name:nm+'_A',buffer:a,info:analyze(a)};n.push({name:nm+'_B',buffer:b2,info:analyze(b2),original:b2});return n;});setWfSel(null);setLog(p=>[...p,`▸ Split "${nm}" @ ${t.toFixed(2)}s`]);}}>Split Here</button>}
          <button style={sb(false,null,th)} onClick={()=>{if(samples.length<2)return;const ctx=getCtx();const bufs=samples.map(s=>s.buffer);const merged=mergeBufs(bufs,[],ctx);addSample('Merged_'+Date.now()%10000,merged);setLog(p=>[...p,`▸ Merge all → nová vzorka`]);}}>Merge All</button>
          <button style={sb(false,null,th)} onClick={()=>{setUndoStack(p=>[...p.slice(-19),snapshot()]);setRedoStack([]);const ctx=getCtx();const b=applyFx(cur.buffer,{normalize:true},ctx);setSamples(p=>p.map((s,i)=>i===sel?{...s,buffer:b,info:analyze(b)}:s));}}>Normalize</button>
          <button style={sb(false,null,th)} onClick={()=>{setUndoStack(p=>[...p.slice(-19),snapshot()]);setRedoStack([]);const ctx=getCtx();const b=applyFx(cur.buffer,{reverse:true},ctx);setSamples(p=>p.map((s,i)=>i===sel?{...s,buffer:b,info:analyze(b)}:s));}}>Reverse</button>
          <button style={sb(false,th.ac2,th)} onClick={()=>{if(!cur)return;const nm=cur.name+'_lib';addSample(nm,cur.buffer,cur.color,cur.tag);setLog(p=>[...p,`✓ "${nm}" pridaný do knižnice`]);}} title="Ulož aktuálnu (upravenú) verziu vzorky ako novú položku v knižnici">➕ Library</button>
          <button style={sb(false,null,th)} onClick={()=>{const nm=cur.name+'_dup';setSamples(p=>[...p,{...cur,name:nm}]);setSel(samples.length);}}>Duplicate</button>
          <button style={sb(false,null,th)} onClick={()=>{setUndoStack(p=>[...p.slice(-19),snapshot()]);setRedoStack([]);setSamples(p=>p.map((s,i)=>i===sel?{...s,buffer:s.original,info:analyze(s.original)}:s));}}>Reset</button>
          <button style={sb(false,null,th)} onClick={()=>doExport()}>Export WAV</button>
        </div>}

        {/* Tabs */}
        <div style={{display:'flex',borderBottom:`1px solid ${th.bd}`,flexShrink:0,background:th.bgP}}>
          {[['seq','SEQUENCER'],['track','TRACK'],['fx','FX EDITOR'],['mix','MIXER'],['chat','AI ASSISTANT'],['log','LOGS']].map(([k,l])=>(
            <button key={k} onClick={()=>setPanel(k)} style={{padding:'8px 16px',fontSize:11,fontWeight:panel===k?700:600,letterSpacing:1,cursor:'pointer',background:panel===k?th.bgL:'transparent',color:panel===k?th.ac:th.txD,border:'none',borderBottom:panel===k?`2px solid ${th.ac}`:'2px solid transparent',fontFamily:'inherit',transition:'all 0.1s'}}>{l}</button>
          ))}
        </div>

        {/* SEQUENCER */}
        {panel==='seq'&&(
          <div style={{flex:1,overflow:'auto',padding:8,background:th.bg}}
            onDrop={e=>{e.preventDefault();if(e.dataTransfer.files?.length)dropToSeq(Array.from(e.dataTransfer.files));}} onDragOver={e=>e.preventDefault()}>
            {/* Toolbar: bar length + add sound */}
            <div style={{display:'flex',alignItems:'center',gap:8,flexWrap:'wrap',marginBottom:8,padding:'6px 8px',background:th.bgD,borderRadius:6,border:`1px solid ${th.bd}`}}>
              <span style={{fontSize:10,fontWeight:700,color:th.txD,letterSpacing:1}}>DĹŽKA</span>
              {([[16,'1 takt'],[32,'2 takty'],[64,'4 takty']] as [number,string][]).map(([n,l])=>(
                <button key={n} onClick={()=>setBarLen(n)} style={{...sb(stepCount===n,th.ac,th),fontSize:10,padding:'3px 10px'}}>{l}</button>
              ))}
              <div style={{flex:1,minWidth:8}}/>
              <span style={{fontSize:10,fontWeight:700,color:th.txD,letterSpacing:1}}>＋ ZVUK</span>
              <select value={addSel} onChange={e=>setAddSel(+e.target.value)} disabled={!samples.length} style={{background:th.bgL,color:th.tx,border:`1px solid ${th.bd}`,borderRadius:3,fontSize:11,padding:'4px 6px',maxWidth:170}}>
                {!samples.length&&<option>(žiadne zvuky)</option>}
                {samples.map((s,i)=><option key={i} value={i}>{s.name}</option>)}
              </select>
              <button onClick={()=>{if(samples.length)addCh(addSel);}} disabled={!samples.length} style={{...b1(true,null,th),fontSize:11,padding:'4px 12px',fontWeight:700}} title="Pridať vybraný zvuk ako novú stopu">Pridať stopu</button>
              <div style={{width:1,height:20,background:th.bd}}/>
              <button onClick={()=>addSeqToTrack('h')} disabled={!channels.length} style={{...sb(false,th.ac3,th),fontSize:10,padding:'3px 10px'}} title="Bounce + pridaj za Track">SEQ→Track</button>
              <button onClick={()=>addSeqToTrack('v')} disabled={!channels.length} style={{...sb(false,th.ac3,th),fontSize:10,padding:'3px 10px'}} title="Bounce + pridaj paralelne k Tracku">SEQ↕Track</button>
              <button onClick={()=>doBounce()} disabled={!channels.length} style={{...sb(false,th.ac2,th),fontSize:10,padding:'3px 10px'}} title="Ulož sekvenciu ako vzorku do knižnice">SEQ→Knižnica</button>
              <button onClick={()=>{const ctx=getCtx();const buf=bouncePat(channels,samples,bpm,stepCount,swing,ctx);doExport(buf,`SEQ_${bpm}bpm`);}} disabled={!channels.length} style={{...sb(false,null,th),fontSize:10,padding:'3px 10px'}} title="Exportuj sekvenciu ako WAV">Export SEQ</button>
              {channels.some((c:any)=>c.solo)&&<button onClick={()=>setChannels((p:any[])=>p.map((c:any)=>({...c,solo:false})))} style={{...sb(true,th.ac2,th),fontSize:10,padding:'3px 10px'}} title="Zruš solo — znova hrá celá sekvencia">⊘ Sólo</button>}
              {channels.some((c:any)=>c.playMark)&&<button onClick={()=>{const marked=channels.filter((c:any)=>c.playMark);if(!marked.length)return;stopSeq();const ctx=getCtx();if(ctx.state==='suspended')ctx.resume();if(!masterGR.current){masterGR.current=ctx.createGain();masterGR.current.connect(ctx.destination);}masterGR.current.gain.value=mvR.current;csR.current=0;nstR.current=ctx.currentTime+.05;setSeqPlaying(true);const sched=()=>{const chs=chRef.current.filter((_:any,i:number)=>chRef.current[i]?.playMark);const smp=smpRef.current,bp=bpmRef.current,sw=swRef.current,sc=Math.max(1,scR.current|0);const stepDur=60/bp/4;while(nstR.current<ctx.currentTime+.1){const st=csR.current%sc;setCurStep(st);const swOff=st%2===1?(sw-50)/100*stepDur:0;for(const ch of chs){if(ch.mute||!ch.steps?.[st])continue;const s=smp[ch.sampleIdx];if(!s)continue;const ratch=Math.max(1,Math.min(8,Math.floor(Number(ch.ratchets?.[st])||1)));const vel=(ch.velocities?.[st]??80)/127;for(let r=0;r<ratch;r++){const src=ctx.createBufferSource();src.buffer=s.buffer;if(ch.pitch&&isFinite(ch.pitch)&&ch.pitch>0&&ch.pitch!==1)src.playbackRate.value=ch.pitch;const g=ctx.createGain();g.gain.value=Math.max(0,ch.vol*vel/ratch);src.connect(g);g.connect(masterGR.current!);const when=nstR.current+swOff+r*(stepDur/ratch);src.start(Math.max(ctx.currentTime,when));}}nstR.current+=stepDur;csR.current++;}};seqTR.current=setInterval(sched,25);}} style={{...sb(true,th.ac3,th),fontSize:10,padding:'3px 10px'}} title="Prehrať iba označené stopy (★)">▶ Označené</button>}
            </div>

            {/* SEQ Overview waveform */}
            <div style={{marginBottom:8,background:th.bgD,borderRadius:6,border:`1px solid ${th.bd}`,overflow:'hidden'}}>
              <div style={{display:'flex',alignItems:'center',gap:6,padding:'4px 8px',borderBottom:`1px solid ${th.bd}`}}>
                <span style={{fontSize:9,fontWeight:700,color:th.txD,letterSpacing:1,flex:1}}>SEQ PREHĽAD</span>
                <button style={{...sb(false,th.ac2,th),fontSize:9,padding:'2px 8px'}} onClick={()=>{const ctx=getCtx();const buf=bouncePat(channels,samples,bpm,stepCount,swing,ctx);setSeqPreviewBuf(buf);}} disabled={!channels.length}>Render</button>
                {seqPreviewBuf&&<button style={{...sb(false,null,th),fontSize:9,padding:'2px 8px'}} onClick={()=>{if(!seqPreviewBuf)return;const ctx=getCtx();const s=ctx.createBufferSource();s.buffer=seqPreviewBuf;s.connect(ctx.destination);s.start();}}>▶</button>}
              </div>
              <canvas ref={seqCvR} style={{width:'100%',height:56,display:'block'}}/>
            </div>

            {!channels.length&&<div style={{textAlign:'center',color:th.txD,margin:'28px 12px',fontSize:12,lineHeight:1.7}}>Zatiaľ žiadne stopy v hlavnom tracku.<br/>Pridaj zvuk hore (＋ ZVUK), načítaj <b>Tekno Kit</b>, alebo <b>pretiahni audio súbor z PC</b> priamo sem.</div>}

            {/* CLIPS sub-layer */}
            <div style={{marginBottom:8,background:th.bgD,borderRadius:6,border:`1px solid ${th.bd}`}}>
              <div style={{display:'flex',alignItems:'center',gap:6,padding:'5px 8px',borderBottom:showClips?`1px solid ${th.bd}`:'none',cursor:'pointer'}} onClick={()=>setShowClips(p=>!p)}>
                <span style={{fontSize:9,fontWeight:700,color:th.ac3,letterSpacing:1,flex:1}}>⬓ CLIPS — uprav & vlož zvuky do SEQ {showClips?'▲':'▼'}</span>
                {showClips&&clips.length>0&&<button style={{...sb(false,null,th),fontSize:9,padding:'2px 8px'}} onClick={e=>{e.stopPropagation();if(clipHistory.length){const prev=clipHistory[clipHistory.length-1];setClips(prev);setClipHistory(p=>p.slice(0,-1));}}} title="Vráť späť posledný krok">↩ Undo</button>}
                {showClips&&<button style={{...sb(false,th.ac3,th),fontSize:9,padding:'2px 8px'}} onClick={e=>{e.stopPropagation();if(!samples.length)return;clipIdR.current++;setClipHistory(p=>[...p,clips]);setClips(p=>[...p,{id:clipIdR.current,sampleIdx:addSel,startBeat:0,endBeat:Math.min(stepCount,Math.ceil(samples[addSel]?.info.duration/(60/bpm/4)||4)),trimS:0,trimE:1,vol:.8,fx:{...FX0},name:samples[addSel]?.name||'clip'}]);setClipSel(clipIdR.current);}} disabled={!samples.length}>+ Pridať clip</button>}
              </div>
              {showClips&&<div style={{padding:8}}>
                {!clips.length&&<div style={{fontSize:11,color:th.txD,textAlign:'center',padding:'12px 0'}}>Pridaj clip zo zvukov v knižnici → uprav → vlož do SEQ ako stopu</div>}
                {clips.map((cl,ci)=>{const s=samples[cl.sampleIdx];const col=s?.color||SWATCH[ci%SWATCH.length];const isS=clipSel===cl.id;
                  return(<div key={cl.id} style={{marginBottom:6,border:`1px solid ${isS?col:th.bd}`,borderRadius:5,overflow:'hidden'}}>
                    <div style={{display:'flex',alignItems:'center',gap:6,padding:'4px 8px',background:isS?col+'22':th.bgP,cursor:'pointer'}} onClick={()=>{setClipSel(isS?null:cl.id);if(!isS)setClipFx({...cl.fx});}}>
                      <div style={{width:8,height:8,borderRadius:'50%',background:col,flexShrink:0}}/>
                      <span style={{fontSize:11,fontWeight:600,color:col,flex:1,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{cl.name||s?.name||'?'}</span>
                      <span style={{fontSize:9,color:th.txD}}>beat {cl.startBeat+1}–{cl.endBeat}</span>
                      <button style={{...sb(false,th.ac2,th),fontSize:9,padding:'2px 8px'}} onClick={e=>{e.stopPropagation();const ctx=getCtx();let buf=s?.buffer;if(!buf)return;const dur=buf.duration;const ts=cl.trimS*dur,te=cl.trimE*dur;if(te>ts)buf=cropT(buf,ts,te,ctx);if(cl.fx&&JSON.stringify(cl.fx)!==JSON.stringify(FX0)){buf=applyFx(buf,cl.fx,ctx);if(cl.fx.loop>1)buf=mkLoop(buf,cl.fx.loop,.02,ctx);}const nc=MKCH(stepCount);nc.sampleIdx=cl.sampleIdx;nc.vol=cl.vol;const beatsPerStep=1;const startStep=Math.min(stepCount-1,Math.floor(cl.startBeat*beatsPerStep));nc.steps[startStep]=true;setChannels((p:any[])=>[...p,nc]);setLog(p=>[...p,`▸ Clip "${cl.name}" → SEQ stopa (krok ${startStep+1})`]);}} title="Vlož do SEQ ako novú stopu">→ SEQ</button>
                      <button style={{background:'none',border:'none',color:th.txD,cursor:'pointer',fontSize:12,padding:'0 3px'}} onClick={e=>{e.stopPropagation();setClipHistory(p=>[...p,clips]);setClips(p=>p.filter(x=>x.id!==cl.id));if(clipSel===cl.id)setClipSel(null);}}>×</button>
                    </div>
                    {isS&&<div style={{padding:8,background:th.bgD,display:'flex',flexDirection:'column',gap:8}}>
                      <div style={{display:'flex',gap:8,flexWrap:'wrap',alignItems:'center'}}>
                        <div style={{flex:1,minWidth:200}}>
                          <div style={{fontSize:9,color:th.txD,marginBottom:2}}>Názov</div>
                          <input value={cl.name||''} onChange={e=>{const v=e.target.value;setClips(p=>p.map(x=>x.id===cl.id?{...x,name:v}:x));}} style={{width:'100%',background:th.bgL,color:th.tx,border:`1px solid ${th.bd}`,borderRadius:3,padding:'3px 6px',fontSize:11,fontFamily:'inherit'}}/>
                        </div>
                        <div style={{flex:1,minWidth:120}}>
                          <div style={{fontSize:9,color:th.txD,marginBottom:2}}>Zvuk</div>
                          <select value={cl.sampleIdx} onChange={e=>{const v=+e.target.value;setClips(p=>p.map(x=>x.id===cl.id?{...x,sampleIdx:v,name:samples[v]?.name||x.name}:x));}} style={{width:'100%',background:th.bgL,color:th.tx,border:`1px solid ${th.bd}`,borderRadius:3,fontSize:10,padding:3}}>{samples.map((s2,i)=><option key={i} value={i}>{s2.name}</option>)}</select>
                        </div>
                        <div style={{display:'flex',flexDirection:'column',gap:2}}>
                          <div style={{fontSize:9,color:th.txD}}>Hlasitosť: {(cl.vol*100).toFixed(0)}%</div>
                          <input type="range" min={0} max={1.5} step={.01} value={cl.vol} onChange={e=>setClips(p=>p.map(x=>x.id===cl.id?{...x,vol:+e.target.value}:x))} style={{width:100,accentColor:col}}/>
                        </div>
                      </div>
                      <div style={{display:'flex',gap:8,flexWrap:'wrap'}}>
                        <div style={{flex:1,minWidth:120}}>
                          <div style={{fontSize:9,color:th.txD,marginBottom:2}}>Orezať začiatok: {(cl.trimS*100).toFixed(0)}%</div>
                          <input type="range" min={0} max={.99} step={.01} value={cl.trimS} onChange={e=>setClips(p=>p.map(x=>x.id===cl.id?{...x,trimS:Math.min(+e.target.value,x.trimE-.01)}:x))} style={{width:'100%',accentColor:col}}/>
                        </div>
                        <div style={{flex:1,minWidth:120}}>
                          <div style={{fontSize:9,color:th.txD,marginBottom:2}}>Orezať koniec: {(cl.trimE*100).toFixed(0)}%</div>
                          <input type="range" min={.01} max={1} step={.01} value={cl.trimE} onChange={e=>setClips(p=>p.map(x=>x.id===cl.id?{...x,trimE:Math.max(+e.target.value,x.trimS+.01)}:x))} style={{width:'100%',accentColor:col}}/>
                        </div>
                        <div style={{flex:1,minWidth:100}}>
                          <div style={{fontSize:9,color:th.txD,marginBottom:2}}>Beat pozícia: {cl.startBeat+1}</div>
                          <input type="range" min={0} max={Math.max(0,stepCount-1)} step={1} value={cl.startBeat} onChange={e=>setClips(p=>p.map(x=>x.id===cl.id?{...x,startBeat:+e.target.value}:x))} style={{width:'100%',accentColor:col}}/>
                        </div>
                      </div>
                      <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(150px,1fr))',gap:6}}>
                        {([['Skreslenie',(clipFx.saturation*100).toFixed(0)+'%','saturation',0,1,.01],['Reverb',(clipFx.reverb*100).toFixed(0)+'%','reverb',0,1,.01],['Chorus',(clipFx.chorus*100).toFixed(0)+'%','chorus',0,1,.01],['Bitcrusher',(clipFx.bitCrush*100).toFixed(0)+'%','bitCrush',0,1,.01],['Filter LP',clipFx.lpFreq>=20000?'OFF':(clipFx.lpFreq/1000).toFixed(1)+'k','lpFreq',200,20000,100],['Delay',(clipFx.delay*100).toFixed(0)+'%','delay',0,1,.01],['Kompresia',(clipFx.compress*100).toFixed(0)+'%','compress',0,1,.01]] as [string,string,string,number,number,number][]).map(([lbl,val,key,mn,mx,st])=>(
                          <div key={key} style={{background:th.bgP,border:`1px solid ${th.bd}`,borderRadius:4,padding:'5px 8px'}}>
                            <div style={{display:'flex',justifyContent:'space-between',marginBottom:3}}><span style={{fontSize:9,color:th.txD}}>{lbl}</span><span style={{fontSize:10,color:col,fontWeight:700}}>{val}</span></div>
                            <input type="range" min={mn} max={mx} step={st} value={(clipFx as any)[key]} onChange={e=>{const nf={...clipFx,[key]:+e.target.value};setClipFx(nf);setClips(p=>p.map(x=>x.id===cl.id?{...x,fx:nf}:x));}} style={{width:'100%',accentColor:col}}/>
                          </div>
                        ))}
                      </div>
                      <div style={{display:'flex',gap:6,flexWrap:'wrap'}}>
                        <button style={{...sb(false,th.ac2,th),padding:'4px 12px'}} onClick={()=>{const ctx=getCtx();if(ctx.state==='suspended')ctx.resume();let buf=s?.buffer;if(!buf)return;const ts=cl.trimS*buf.duration,te=cl.trimE*buf.duration;if(te>ts)buf=cropT(buf,ts,te,ctx);buf=applyFx(buf,clipFx,ctx);if(clipFx.loop>1)buf=mkLoop(buf,clipFx.loop,.02,ctx);const src=ctx.createBufferSource();src.buffer=buf;src.connect(ctx.destination);src.start();}}>▶ Vypočuť</button>
                        <button style={{...sb(false,null,th),padding:'4px 12px'}} onClick={()=>{const ctx=getCtx();let buf=s?.buffer;if(!buf)return;const ts=cl.trimS*buf.duration,te=cl.trimE*buf.duration;if(te>ts)buf=cropT(buf,ts,te,ctx);buf=applyFx(buf,clipFx,ctx);if(clipFx.loop>1)buf=mkLoop(buf,clipFx.loop,.02,ctx);addSample((cl.name||s?.name||'clip')+'_edit',buf);setLog(p=>[...p,`▸ Clip uložený ako nová vzorka`]);}}>Uložiť ako vzorku</button>
                      </div>
                    </div>}
                  </div>);
                })}
              </div>}
            </div>

            {channels.length>0&&<>
              {/* Main track ruler / playhead */}
              <div style={{display:'flex',alignItems:'flex-end',gap:2,marginBottom:6,position:'sticky',top:0,zIndex:2,background:th.bg,paddingBottom:3,borderBottom:`1px solid ${th.bd}`}}>
                <div style={{width:LBL,flexShrink:0,fontSize:9,fontWeight:700,color:th.txD,letterSpacing:1,textTransform:'uppercase'}}>Hlavný track ({stepCount/4} {stepCount/4===1?'takt':stepCount/4<5?'takty':'taktov'})</div>
                <div style={{display:'flex',gap:2,flex:1}}>
                  {Array.from({length:stepCount}).map((_,si)=>{const isBeat=si%4===0;const ph=si===curStep&&seqPlaying;return(
                    <div key={si} style={{flex:'1 0 0',textAlign:'center',fontSize:9,fontWeight:700,color:ph?'#fff':isBeat?th.ac:th.txD,paddingBottom:2,borderLeft:isBeat?`2px solid ${th.bd}`:'1px solid transparent',background:ph?th.ac2+'66':'transparent',borderRadius:2}}>{isBeat?(si/4+1):'·'}</div>);})}
                </div>
              </div>

              {/* Lanes — one per sound, timed across the track */}
              {channels.map((ch:any,ci:number)=>{const s=samples[ch.sampleIdx];const col=cols[ci%cols.length];const anySolo=channels.some((c:any)=>c.solo);const dimmed=anySolo&&!ch.solo;
                return(
                <div key={ci} style={{marginBottom:4,opacity:dimmed?.38:1,transition:'opacity .12s'}}>
                  <div style={{display:'flex',alignItems:'stretch',gap:2}}>
                    {/* Lane header (left) */}
                    <div style={{width:LBL,flexShrink:0,background:th.bgD,border:`1px solid ${ch.mute?th.bd:col+'44'}`,borderRadius:4,padding:'4px 6px',display:'flex',flexDirection:'column',gap:3,opacity:ch.mute?.55:1}}>
                      <div style={{display:'flex',alignItems:'center',gap:4}}>
                        <div style={{width:4,height:14,borderRadius:2,background:col,flexShrink:0}}/>
                        <span style={{fontSize:11,fontWeight:700,flex:1,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',cursor:'pointer',color:col}} onClick={()=>setEditCh(editCh===ci?null:ci)} title="Klik = viac nastavení (pan, pitch, EQ, zvuk)">{s?.name||'?'}</span>
                        <button onClick={()=>rmCh(ci)} style={{background:'none',border:'none',color:th.txD,cursor:'pointer',fontSize:13,padding:'0 2px',lineHeight:1}} title="Odstrániť stopu">×</button>
                      </div>
                      <div style={{display:'flex',alignItems:'center',gap:3}}>
                        <button onClick={()=>nudgeCh(ci,-1)} style={{...sb(false,null,th),fontSize:10,padding:'1px 5px'}} title="Posuň skôr (o 1 krok vľavo)">◀</button>
                        <button onClick={()=>nudgeCh(ci,1)} style={{...sb(false,null,th),fontSize:10,padding:'1px 5px'}} title="Posuň neskôr (o 1 krok vpravo)">▶</button>
                        <input type="range" min={0} max={1.5} step={.01} value={ch.vol} onChange={e=>updCh(ci,'vol',+e.target.value)} style={{flex:1,height:5,accentColor:col}} title="Hlasitosť"/>
                        <button onClick={()=>updCh(ci,'mute',!ch.mute)} style={{...sb(ch.mute,th.red,th),fontSize:9,padding:'1px 5px'}}>M</button>
                        <button onClick={()=>updCh(ci,'solo',!ch.solo)} style={{...sb(ch.solo,th.ac2,th),fontSize:9,padding:'1px 5px'}} title="Solo — hrá iba táto stopa (môžeš zapnúť viac)">S</button>
                        <button onClick={()=>updCh(ci,'playMark',!ch.playMark)} style={{...sb(ch.playMark,th.ac3,th),fontSize:9,padding:'1px 5px'}} title="Označ pre selektívne prehranie (▶ Označené)">★</button>
                        <button onClick={()=>updCh(ci,'truncate',!ch.truncate)} style={{...sb(ch.truncate,null,th),fontSize:9,padding:'1px 5px'}} title="Orezať zvuk na dĺžku stepu">✂</button>
                      </div>
                      {isTK&&<div style={{display:'flex',gap:3}}>
                        <button onClick={()=>updCh(ci,'isKick',!ch.isKick)} style={{...sb(ch.isKick,th.ac3,th),fontSize:8,padding:'1px 5px',flex:1}} title="Kick (zdroj sidechain)">KICK</button>
                        <button onClick={()=>updCh(ci,'sidechain',!ch.sidechain)} style={{...sb(ch.sidechain,'#ff006644',th),fontSize:8,padding:'1px 5px',flex:1}} title="Sidechain duck">SC</button>
                      </div>}
                    </div>
                    {/* Steps (right) */}
                    <div style={{display:'flex',gap:2,flex:1}}>
                      {(ch.steps||[]).slice(0,stepCount).map((on:boolean,si:number)=>{
                        const vel=ch.velocities?.[si]??80;const ratch=ch.ratchets?.[si]||1;
                        const isActive=si===curStep&&seqPlaying;const isBeat=si%4===0;
                        return(
                        <div key={si} style={{display:'flex',flexDirection:'column',alignItems:'center',gap:0,flex:'1 0 0',borderLeft:isBeat?`2px solid ${th.bd}`:'none',paddingLeft:isBeat?1:0}}>
                          {isTK&&on&&<div style={{width:'100%',height:18,background:th.bgP,borderRadius:'2px 2px 0 0',position:'relative',cursor:'ns-resize'}}
                            onMouseDown={e=>{e.preventDefault();const rect=e.currentTarget.getBoundingClientRect();const handle=(ev:any)=>{const y=1-Math.max(0,Math.min(1,(ev.clientY-rect.top)/rect.height));setVel(ci,si,Math.round(y*127));};const up=()=>{window.removeEventListener('mousemove',handle);window.removeEventListener('mouseup',up);};window.addEventListener('mousemove',handle);window.addEventListener('mouseup',up);const y=1-Math.max(0,Math.min(1,(e.clientY-rect.top)/rect.height));setVel(ci,si,Math.round(y*127));}}>
                            <div style={{position:'absolute',bottom:0,width:'100%',height:`${vel/127*100}%`,background:col+'99',borderRadius:2}}/>
                          </div>}
                          <div onClick={()=>toggleStep(ci,si)} onContextMenu={e=>{e.preventDefault();if(isTK)setRatch(ci,si);}}
                            style={{width:'100%',height:isTK?24:30,borderRadius:isTK?2:3,cursor:'pointer',
                              background:on?col:(isBeat?th.bgL:th.bgP),
                              border:`1px solid ${isActive?'#fff':on?col+'88':th.bd}`,
                              boxShadow:isActive?`0 0 8px ${th.ac}`:'none',
                              display:'flex',alignItems:'center',justifyContent:'center',
                              opacity:on?(.4+vel/127*.6):1,transition:'all 0.1s'}}>
                            {isTK&&on&&ratch>1&&<span style={{fontSize:8,color:'#fff',fontWeight:700}}>{ratch}x</span>}
                          </div>
                        </div>);
                      })}
                    </div>
                  </div>
                  {/* Expanded per-lane settings */}
                  {editCh===ci&&(
                    <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(120px,1fr))',gap:8,marginTop:4,marginLeft:LBL+2,padding:8,background:th.bgP,borderRadius:4}}>
                      <div><div style={{fontSize:9,color:th.txD,marginBottom:2}}>Pan</div><input type="range" min={-1} max={1} step={.01} value={ch.pan} onChange={e=>updCh(ci,'pan',+e.target.value)} style={{width:'100%',accentColor:col}}/></div>
                      <div><div style={{fontSize:9,color:th.txD,marginBottom:2}}>Rýchlosť / Pitch</div><input type="range" min={.25} max={4} step={.01} value={ch.pitch} onChange={e=>updCh(ci,'pitch',+e.target.value)} style={{width:'100%',accentColor:col}}/><div style={{display:'flex',justifyContent:'space-between'}}><span style={{fontSize:9,color:th.txD}}>{ch.pitch.toFixed(2)}×</span><button style={{...sb(false,th.ac2,th),fontSize:8,padding:'1px 5px'}} onClick={()=>{const ctx=getCtx();const spd=ch.pitch||1;if(spd===1)return;const buf=applyFx(samples[ch.sampleIdx]?.buffer,{speed:spd},ctx);if(!buf)return;const nm=(samples[ch.sampleIdx]?.name||'zvuk')+'_spd';addSample(nm,buf);updCh(ci,'pitch',1);setLog(p=>[...p,`▸ Rýchlosť ${spd}× aplikovaná na "${nm}"`]);updCh(ci,'sampleIdx',samples.length);}} title="Aplikuj rýchlosť na buffer (preresamplovanie) a zresetuj pitch na 1×">Apply</button></div></div>
                      <div><div style={{fontSize:9,color:'#f66',marginBottom:2}}>Bass</div><input type="range" min={0} max={3} step={.05} value={ch.eqL} onChange={e=>updCh(ci,'eqL',+e.target.value)} style={{width:'100%',accentColor:'#f66'}}/></div>
                      <div><div style={{fontSize:9,color:'#fc4',marginBottom:2}}>Mid</div><input type="range" min={0} max={3} step={.05} value={ch.eqM} onChange={e=>updCh(ci,'eqM',+e.target.value)} style={{width:'100%',accentColor:'#fc4'}}/></div>
                      <div><div style={{fontSize:9,color:'#4af',marginBottom:2}}>High</div><input type="range" min={0} max={3} step={.05} value={ch.eqH} onChange={e=>updCh(ci,'eqH',+e.target.value)} style={{width:'100%',accentColor:'#4af'}}/></div>
                      <div><div style={{fontSize:9,color:th.txD,marginBottom:2}}>Zvuk</div><select value={ch.sampleIdx} onChange={e=>updCh(ci,'sampleIdx',+e.target.value)} style={{width:'100%',background:th.bgL,color:th.tx,border:`1px solid ${th.bd}`,borderRadius:3,fontSize:10,padding:3}}>{samples.map((s,i)=><option key={i} value={i}>{s.name}</option>)}</select></div>
                    </div>
                  )}
                </div>);
              })}
            </>}
          </div>
        )}

        {/* TRACK VIEW */}
        {panel==='track'&&(()=>{
          const totalDur=trackBlocks.reduce((mx,b)=>Math.max(mx,b.startSec+b.buffer.duration),0);
          const LANE_H=60;const LBL_W=88;const MAX_VIS=3;
          const dispDur=dragDur??totalDur;
          const layers=[...new Set(trackBlocks.map(b=>b.layer))].sort((a,b)=>a-b);
          const selBlock=trackBlocks.find(b=>b.id===trackSel)||null;
          const layerColor=(l:number)=>SWATCH[(l*3)%SWATCH.length];
          const beginBlockDrag=(e:any,bl:any,laneEl:HTMLElement)=>{
            if(!(totalDur>0))return;
            const w=laneEl.getBoundingClientRect().width;if(!(w>0))return;
            justMovedRef.current=false;
            dragRef.current={id:bl.id,x0:e.clientX,y0:e.clientY,start0:bl.startSec,layer0:bl.layer,pxPerSec:w/totalDur,moved:false};
            setDragDur(totalDur);
            try{(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);}catch{}
          };
          const moveBlockDrag=(e:any,id:number)=>{
            const d=dragRef.current;if(!d||d.id!==id)return;
            const dx=e.clientX-d.x0,dy=e.clientY-d.y0;
            if(!d.moved&&(Math.abs(dx)>3||Math.abs(dy)>8))d.moved=true;
            if(!d.moved)return;
            justMovedRef.current=true;
            const next=Math.max(0,d.start0+dx/d.pxPerSec);
            if(!Number.isFinite(next))return;
            const layerShift=Math.round(dy/(LANE_H+3));
            const newLayer=Math.max(0,d.layer0+layerShift);
            setTrackBlocks(p=>p.map(b=>b.id===id?{...b,startSec:next,layer:newLayer}:b));
          };
          const endBlockDrag=(e:any,id:number)=>{
            try{(e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);}catch{}
            const d=dragRef.current;
            dragRef.current=null;setDragDur(null);
            if(d?.moved)setLayerVols(lv=>{const needed=trackBlocks.find(b=>b.id===id);if(needed&&!(needed.layer in lv))return{...lv,[needed.layer]:1};return lv;});
          };
          const clickBlock=(e:any,bl:any,isSel:boolean)=>{
            e.stopPropagation();
            if(justMovedRef.current){justMovedRef.current=false;return;}
            setTrackSel(isSel?null:bl.id);if(!isSel)setTrackBlockFx({...bl.fx});
          };
          return(
          <div style={{flex:1,overflow:'auto',padding:8,background:th.bg,display:'flex',flexDirection:'column',gap:6}}>
            {/* Transport — stays at top */}
            <div style={{display:'flex',alignItems:'center',gap:6,padding:'6px 10px',background:th.bgD,borderRadius:6,border:`1px solid ${th.bd}`,flexWrap:'wrap',flexShrink:0}}>
              <button style={{...sb(trackPlaying,th.ac2,th),padding:'4px 14px',fontWeight:700}} onClick={trackPlaying?stopTrack:startTrack}>{trackPlaying?'⏹ Stop':'▶ Play'}</button>
              <span style={{fontSize:11,color:th.txD,fontFamily:'monospace'}}>{ft(trackPos)}{totalDur>0?' / '+ft(totalDur):''}</span>
              <span style={{fontSize:10,color:activeLayer===0?th.ac:layerColor(activeLayer),fontWeight:700}}>Aktívny: {activeLayer===0?'MAIN':`Track ${activeLayer}`}</span>
              <div style={{flex:1}}/>
              <button style={{...sb(false,th.ac3,th),padding:'3px 9px',fontSize:10}} onClick={()=>addSeqToTrack('h')} disabled={!channels.length} title={`Pridaj bounced SEQ za aktívny ${activeLayer===0?'MAIN':'Track '+activeLayer}`}>+ SEQ →</button>
              <button style={{...sb(false,th.ac3,th),padding:'3px 9px',fontSize:10}} onClick={()=>addSeqToTrack('v')} disabled={!channels.length} title="Pridaj bounced SEQ ako nový paralelný track">+ SEQ ↕</button>
              {trackBlocks.length>0&&<button style={{...sb(false,th.ac2,th),padding:'3px 9px',fontSize:10}} onClick={()=>{const buf=bounceTrack();if(!buf)return;addSample('Track_'+Date.now()%10000,buf);setPanel('seq');setLog(p=>[...p,'✓ Track → Library']);}}>Track → Library</button>}
              {trackBlocks.length>0&&<button style={{...sb(false,null,th),padding:'3px 9px',fontSize:10}} onClick={()=>{const buf=bounceTrack();if(!buf)return;doExport(buf,'Track_'+Date.now()%10000);}}>Export WAV</button>}
              {trackBlocks.length>0&&<button style={{...sb(false,th.red,th),padding:'3px 9px',fontSize:10}} onClick={()=>{stopTrack();setTrackBlocks([]);setTrackSel(null);setActiveLayer(0);setLayerVols({0:1});}}>Vyčistiť</button>}
            </div>

            {!trackBlocks.length&&<div style={{textAlign:'center',color:th.txD,padding:40,fontSize:12,lineHeight:1.8}}>
              Track je prázdny. Pridaj sekvenciu cez <b>+ SEQ →</b> (za seba do aktívneho tracku) alebo <b>+ SEQ ↕</b> (nový paralelný track).<br/>
              Alebo klikni <b>+T</b> pri vzorke v knižnici vľavo.
            </div>}

            {/* Time ruler (sticky) */}
            {trackBlocks.length>0&&<div style={{display:'flex',background:th.bgP,borderRadius:4,border:`1px solid ${th.bd}`,flexShrink:0,overflow:'hidden'}}>
              <div style={{width:LBL_W,flexShrink:0,borderRight:`1px solid ${th.bd}`}}/>
              <div style={{flex:1,height:18,position:'relative'}}>
                {dispDur>0&&Array.from({length:Math.min(20,Math.ceil(dispDur)+1)},(_,i)=>(
                  <div key={i} style={{position:'absolute',left:`${(i/dispDur)*100}%`,top:0,height:'100%',borderLeft:`1px solid ${th.bd}33`,paddingLeft:2}}>
                    <span style={{fontSize:8,color:th.txD,fontFamily:'monospace'}}>{ft(i)}</span>
                  </div>
                ))}
              </div>
            </div>}

            {/* Track rows — scrollable if > MAX_VIS */}
            {trackBlocks.length>0&&<div style={{overflowY:layers.length>MAX_VIS?'auto':'visible',maxHeight:layers.length>MAX_VIS?MAX_VIS*LANE_H+16:undefined,flexShrink:0}}>
              {layers.map(li=>{
                const isActive=activeLayer===li;const lCol=li===0?th.ac:layerColor(li);
                const lBlocks=trackBlocks.filter(b=>b.layer===li);
                const lVol=layerVols[li]??1;
                return(
                <div key={li} style={{display:'flex',height:LANE_H,marginBottom:3,border:`1.5px solid ${isActive?lCol:th.bd}`,borderRadius:6,overflow:'hidden',background:th.bgD,cursor:'pointer'}} onClick={()=>setActiveLayer(li)}>
                  {/* Track label column */}
                  <div style={{width:LBL_W,flexShrink:0,background:isActive?lCol+'22':th.bgP,borderRight:`1px solid ${isActive?lCol:th.bd}`,display:'flex',flexDirection:'column',justifyContent:'center',padding:'4px 6px',gap:2}}>
                    <div style={{display:'flex',alignItems:'center',gap:4}}>
                      <div style={{width:6,height:6,borderRadius:'50%',background:lCol,flexShrink:0}}/>
                      <span style={{fontSize:10,fontWeight:700,color:lCol,flex:1,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{li===0?'MAIN':`Track ${li}`}</span>
                    </div>
                    <input type="range" min={0} max={1.5} step={.05} value={lVol} onClick={e=>e.stopPropagation()} onChange={e=>{e.stopPropagation();setLayerVols(lv=>({...lv,[li]:+e.target.value}));}} style={{width:'100%',height:4,accentColor:lCol}} title={`Hlasitosť ${(lVol*100).toFixed(0)}%`}/>
                    {li>0&&<div style={{display:'flex',gap:3}}>
                      <button style={{flex:1,fontSize:8,background:lCol+'22',border:`1px solid ${lCol}44`,color:lCol,borderRadius:3,padding:'1px 4px',cursor:'pointer'}} onClick={e=>{e.stopPropagation();bakeLayerIntoMain(li);}} title="Zlúčiť do MAIN (zakomponovať napevno)">→ MAIN</button>
                      <button style={{fontSize:8,background:'#ff000022',border:'1px solid #ff000044',color:'#ff4455',borderRadius:3,padding:'1px 6px',cursor:'pointer'}} onClick={e=>{e.stopPropagation();setTrackBlocks(p=>p.filter(b=>b.layer!==li));setLayerVols(lv=>{const n={...lv};delete n[li];return n;});if(activeLayer===li)setActiveLayer(0);setTrackSel(s=>{const blk=trackBlocks.find(b=>b.id===s);return blk&&blk.layer===li?null:s;});setLog(p=>[...p,`▸ Track ${li} zmazaný`]);}} title="Zmazať celý tento track">Zmaž</button>
                    </div>}
                  </div>
                  {/* Timeline area */}
                  <div style={{flex:1,position:'relative',overflow:'hidden',background:isActive?lCol+'08':'transparent'}} data-lane={li}>
                    {/* Playhead */}
                    {dispDur>0&&trackPlaying&&<div style={{position:'absolute',top:0,bottom:0,left:`${(trackPos/dispDur)*100}%`,width:1.5,background:'rgba(255,255,255,.8)',zIndex:5,pointerEvents:'none'}}/>}
                    {/* Blocks */}
                    {lBlocks.map(bl=>{
                      const left=dispDur>0?(bl.startSec/dispDur*100):0;
                      const width=dispDur>0?Math.max(.5,bl.buffer.duration/dispDur*100):5;
                      const isSel=trackSel===bl.id;
                      const isDragging=dragRef.current?.id===bl.id&&dragRef.current?.moved;
                      return(
                      <div key={bl.id}
                        onPointerDown={e=>{e.stopPropagation();const lane=(e.currentTarget as HTMLElement).parentElement;if(lane)beginBlockDrag(e,bl,lane);}}
                        onPointerMove={e=>moveBlockDrag(e,bl.id)}
                        onPointerUp={e=>endBlockDrag(e,bl.id)}
                        onPointerCancel={e=>endBlockDrag(e,bl.id)}
                        onLostPointerCapture={e=>endBlockDrag(e,bl.id)}
                        onClick={e=>clickBlock(e,bl,isSel)}
                        style={{position:'absolute',left:`${left}%`,width:`${width}%`,top:2,bottom:2,
                          background:bl.color+(isSel?'55':'28'),border:`1.5px solid ${isSel?'#fff':bl.color+(bl.mute?'44':'99')}`,
                          borderRadius:3,cursor:isDragging?'grabbing':'grab',overflow:'hidden',opacity:bl.mute?.35:1,zIndex:isSel?4:2,transition:isDragging?'none':'border .1s',touchAction:'none',userSelect:'none'}}>
                        <div style={{padding:'1px 4px',display:'flex',gap:3,alignItems:'center'}}>
                          <span style={{fontSize:8,fontWeight:700,color:bl.color,flex:1,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{bl.name}</span>
                          <span style={{fontSize:7,color:'rgba(255,255,255,.4)',whiteSpace:'nowrap'}}>{ft(bl.buffer.duration)}</span>
                        </div>
                        <div style={{position:'absolute',bottom:0,left:0,right:0,height:20,display:'flex',alignItems:'flex-end',gap:.3,padding:'0 2px',opacity:.5}}>
                          {Array.from({length:24},(_,i)=>{const c=bl.buffer.getChannelData(0);const st=Math.floor(c.length/24);let mx=0;for(let j=0;j<st;j++){const v=Math.abs(c[i*st+j]||0);if(v>mx)mx=v;}return(<div key={i} style={{flex:1,background:bl.color,borderRadius:1,height:`${mx*100}%`,minHeight:1}}/>);})}
                        </div>
                      </div>);
                    })}
                  </div>
                </div>);
              })}
            </div>}

            {/* Selected block edit panel — shows below tracks */}
            {selBlock&&<div style={{background:th.bgD,borderRadius:6,border:`2px solid ${selBlock.color}`,padding:10,flexShrink:0}}>
              <div style={{display:'flex',alignItems:'center',gap:6,marginBottom:8,flexWrap:'wrap'}}>
                <div style={{width:8,height:8,borderRadius:'50%',background:selBlock.color,flexShrink:0}}/>
                <span style={{fontSize:12,fontWeight:700,color:selBlock.color,flex:1}}>{selBlock.name}</span>
                <span style={{fontSize:10,color:th.txD}}>{ft(selBlock.buffer.duration)}</span>
                <button style={{...sb(false,th.ac2,th),fontSize:10,padding:'3px 9px'}} onClick={()=>{const ctx=getCtx();if(ctx.state==='suspended')ctx.resume();const s=ctx.createBufferSource();s.buffer=selBlock.buffer;if(!masterGR.current){masterGR.current=ctx.createGain();masterGR.current.connect(ctx.destination);}const g=ctx.createGain();g.gain.value=selBlock.vol;s.connect(g);g.connect(masterGR.current);s.start();}}>▶</button>
                <button style={{...sb(false,null,th),fontSize:10,padding:'3px 9px'}} onClick={()=>addSample(selBlock.name,selBlock.buffer)} title="Uložiť blok do Library">→ Library</button>
                <button style={{...sb(false,null,th),fontSize:10,padding:'3px 9px'}} onClick={()=>{const buf=renderBlockWithOverlap(trackSel!);if(buf)addSample(selBlock.name+'_mix',buf);}} title="Render tohto bloku + všetky prekrývajúce sa zvuky z ostatných trackov → Library">+ prekryvy → Library</button>
                <button style={{...sb(false,null,th),fontSize:10,padding:'3px 9px'}} onClick={()=>doExport(selBlock.buffer,selBlock.name)} title="Export bloku ako WAV">Export WAV</button>
                <button style={{...sb(selBlock.mute,th.red,th),fontSize:10,padding:'3px 9px'}} onClick={()=>setTrackBlocks(p=>p.map(b=>b.id===trackSel?{...b,mute:!b.mute}:b))}>{selBlock.mute?'Unmute':'Mute'}</button>
                <button style={{...sb(false,th.ac3,th),fontSize:10,padding:'3px 9px'}} onClick={()=>{trackIdR.current++;const layerEnd=trackBlocks.filter(b=>b.layer===selBlock.layer).reduce((mx,b)=>Math.max(mx,b.startSec+b.buffer.duration),0);setTrackBlocks(p=>[...p,{...selBlock,id:trackIdR.current,name:selBlock.name+'_dup',startSec:layerEnd}]);}} title="Duplikuj a vlož na koniec stopy">Dup</button>
                <button style={{...sb(false,null,th),fontSize:10,padding:'3px 9px'}} onClick={()=>splitTrackBlock(trackSel!,.5)}>Split ½</button>
                <button style={{...sb(trackCropRange!=null,th.ac2,th),fontSize:10,padding:'3px 9px'}} onClick={()=>setTrackCropRange(r=>r?null:[0,selBlock.buffer.duration])} title="Orezať (Crop) začiatok/koniec bloku">Crop</button>
                <button style={{background:'none',border:`1px solid ${th.red}`,color:th.red,borderRadius:3,fontSize:10,padding:'3px 9px',cursor:'pointer'}} onClick={()=>{setTrackBlocks(p=>p.filter(b=>b.id!==trackSel));setTrackSel(null);setTrackCropRange(null);}}>×</button>
              </div>
              {trackCropRange&&<div style={{background:th.bgD,border:`1px solid ${th.ac2}`,borderRadius:5,padding:'8px 10px',marginBottom:8}}>
                <div style={{fontSize:9,color:th.ac2,fontWeight:700,marginBottom:6}}>✂ Crop — orezanie bloku</div>
                <div style={{display:'flex',gap:10,alignItems:'center',marginBottom:4}}>
                  <span style={{fontSize:9,color:th.txD,minWidth:60}}>Začiatok: {trackCropRange[0].toFixed(2)}s</span>
                  <input type="range" min={0} max={selBlock.buffer.duration} step={.01} value={trackCropRange[0]}
                    onChange={e=>setTrackCropRange(r=>r?[Math.min(+e.target.value,r[1]-.05),r[1]]:null)}
                    style={{flex:1,accentColor:th.ac2}}/>
                </div>
                <div style={{display:'flex',gap:10,alignItems:'center',marginBottom:8}}>
                  <span style={{fontSize:9,color:th.txD,minWidth:60}}>Koniec: {trackCropRange[1].toFixed(2)}s</span>
                  <input type="range" min={0} max={selBlock.buffer.duration} step={.01} value={trackCropRange[1]}
                    onChange={e=>setTrackCropRange(r=>r?[r[0],Math.max(+e.target.value,r[0]+.05)]:null)}
                    style={{flex:1,accentColor:th.ac2}}/>
                </div>
                <div style={{display:'flex',gap:6}}>
                  <button style={{...sb(false,th.ac2,th),fontSize:10,padding:'3px 12px'}} onClick={()=>{
                    if(!trackCropRange)return;const ctx=getCtx();
                    const buf=cropT(selBlock.buffer,trackCropRange[0],trackCropRange[1],ctx);
                    setTrackBlocks(p=>p.map(b=>b.id===trackSel?{...b,buffer:buf}:b));
                    setTrackCropRange(null);setLog(p=>[...p,`✂ Crop "${selBlock.name}" ${trackCropRange[0].toFixed(2)}s–${trackCropRange[1].toFixed(2)}s`]);
                  }}>Použiť Crop</button>
                  <button style={{...sb(false,null,th),fontSize:10,padding:'3px 12px'}} onClick={()=>{
                    if(!trackCropRange)return;const ctx=getCtx();
                    const buf=cropT(selBlock.buffer,trackCropRange[0],trackCropRange[1],ctx);
                    addSample(selBlock.name+'_crop',buf);
                    setLog(p=>[...p,`▸ Crop úsek → Library "${selBlock.name}_crop"`]);
                  }}>→ Library</button>
                  <button style={{...sb(false,null,th),fontSize:10,padding:'3px 12px'}} onClick={()=>setTrackCropRange(null)}>Zrušiť</button>
                </div>
              </div>}
              <div style={{display:'flex',gap:8,flexWrap:'wrap',marginBottom:8}}>
                <div style={{flex:1,minWidth:120}}>
                  <div style={{fontSize:9,color:th.txD,marginBottom:2}}>Hlasitosť: {(selBlock.vol*100).toFixed(0)}%</div>
                  <input type="range" min={0} max={1.5} step={.01} value={selBlock.vol} onChange={e=>setTrackBlocks(p=>p.map(b=>b.id===trackSel?{...b,vol:+e.target.value}:b))} style={{width:'100%',accentColor:selBlock.color}}/>
                </div>
                <div style={{flex:1,minWidth:120}}>
                  <div style={{fontSize:9,color:th.txD,marginBottom:2}}>Rýchlosť: {(trackBlockFx.speed||1).toFixed(2)}×</div>
                  <input type="range" min={.25} max={4} step={.01} value={trackBlockFx.speed||1} onChange={e=>setTrackBlockFx(f=>({...f,speed:+e.target.value}))} style={{width:'100%',accentColor:selBlock.color}}/>
                </div>
                <button style={{...sb(false,th.ac2,th),padding:'4px 14px',fontSize:10,alignSelf:'flex-end'}} onClick={()=>{const ctx=getCtx();let buf=selBlock.buffer;const nfx={...trackBlockFx};buf=applyFx(buf,nfx,ctx);if(nfx.loop>1)buf=mkLoop(buf,nfx.loop,.02,ctx);setTrackBlocks(p=>p.map(b=>b.id===trackSel?{...b,buffer:buf,fx:{...nfx}}:b));setLog(p=>[...p,`▸ FX → "${selBlock.name}"`]);}}>Použiť FX</button>
              </div>
              <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(130px,1fr))',gap:5}}>
                {([['Skreslenie',(trackBlockFx.saturation*100).toFixed(0)+'%','saturation',0,1,.01],['Reverb',(trackBlockFx.reverb*100).toFixed(0)+'%','reverb',0,1,.01],['Chorus',(trackBlockFx.chorus*100).toFixed(0)+'%','chorus',0,1,.01],['Bitcrusher',(trackBlockFx.bitCrush*100).toFixed(0)+'%','bitCrush',0,1,.01],['Filter LP',trackBlockFx.lpFreq>=20000?'OFF':(trackBlockFx.lpFreq/1000).toFixed(1)+'k','lpFreq',200,20000,100],['Delay',(trackBlockFx.delay*100).toFixed(0)+'%','delay',0,1,.01]] as [string,string,string,number,number,number][]).map(([lbl,val,key,mn,mx,st])=>(
                  <div key={key} style={{background:th.bgP,border:`1px solid ${th.bd}`,borderRadius:4,padding:'4px 7px'}}>
                    <div style={{display:'flex',justifyContent:'space-between',marginBottom:2}}>
                      <span style={{fontSize:8,color:th.txD,display:'flex',alignItems:'center',gap:3}}>
                        {lbl}
                        {FX_DESC[key]&&<span title={FX_DESC[key]} style={{cursor:'help',color:th.txD,opacity:.5,fontSize:7,border:`1px solid ${th.txD}`,borderRadius:'50%',width:10,height:10,display:'inline-flex',alignItems:'center',justifyContent:'center',flexShrink:0}}>?</span>}
                      </span>
                      <span style={{fontSize:9,color:selBlock.color,fontWeight:700}}>{val}</span>
                    </div>
                    <input type="range" min={mn} max={mx} step={st} value={(trackBlockFx as any)[key]} onChange={e=>setTrackBlockFx(f=>({...f,[key]:+e.target.value}))} style={{width:'100%',accentColor:selBlock.color}}/>
                  </div>
                ))}
              </div>
            </div>}
          </div>);
        })()}

        {/* FX EDITOR — manual editing of the selected sample */}
        {panel==='fx'&&(
          <div style={{flex:1,overflow:'auto',padding:16,background:th.bg}}>
            {!cur&&<div style={{textAlign:'center',color:th.txD,marginTop:32,fontSize:12}}>Vyber vzorku v knižnici vľavo (alebo nahraj / vytvor zvuk), potom ju tu uprav efektmi, hlasitosťou a dĺžkou.</div>}
            {cur&&<div style={{maxWidth:680,margin:'0 auto'}}>
              <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:14}}>
                <span style={{fontSize:13,fontWeight:700,color:th.ac}}>{cur.name}</span>
                <span style={{fontSize:11,color:th.txD}}>{ft(cur.info.duration)} · {cur.info.ch}ch{cur.info.bpm?` · ~${cur.info.bpm}bpm`:''}{(cur.info as any).key?` · ${(cur.info as any).key}${(cur.info as any).scale==='minor'?'m':''}`:''}{(cur.info as any).lufs!=null?` · ${(cur.info as any).lufs.toFixed(1)}LUFS`:''}{(cur.info as any).onsetCount?` · ${(cur.info as any).onsetCount} hits`:''}</span>
              </div>
              <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(200px,1fr))',gap:14}}>
                {([
                  ['Hlasitosť',(fx.gain*100).toFixed(0)+'%','gain',0,2,.01],
                  ['Skreslenie / Drive',(fx.saturation*100).toFixed(0)+'%','saturation',0,1,.01],
                  ['Výšky filter (LP)',fx.lpFreq>=20000?'OFF':(fx.lpFreq/1000).toFixed(1)+'k','lpFreq',200,20000,100],
                  ['Basy filter (HP)',fx.hpFreq<=20?'OFF':fx.hpFreq+'Hz','hpFreq',20,2000,10],
                  ['Fade In',fx.fadeIn.toFixed(2)+'s','fadeIn',0,2,.01],
                  ['Fade Out',fx.fadeOut.toFixed(2)+'s','fadeOut',0,2,.01],
                  ['Echo / Delay',(fx.delay*100).toFixed(0)+'%','delay',0,1,.01],
                  ['Echo čas',fx.delayTime.toFixed(2)+'s','delayTime',.05,.6,.01],
                  ['Kompresia',(fx.compress*100).toFixed(0)+'%','compress',0,1,.01],
                  ['Dĺžka (loop ×)',fx.loop+'×','loop',1,8,1],
                  ['Reverb',(fx.reverb*100).toFixed(0)+'%','reverb',0,1,.01],
                  ['Reverb dĺžka',fx.reverbDecay.toFixed(1)+'s','reverbDecay',.3,4,.1],
                  ['Chorus',(fx.chorus*100).toFixed(0)+'%','chorus',0,1,.01],
                  ['Chorus rýchlosť',fx.chorusRate.toFixed(1)+'Hz','chorusRate',.1,5,.1],
                  ['Bitcrusher',(fx.bitCrush*100).toFixed(0)+'%','bitCrush',0,1,.01],
                  ['Rýchlosť (Speed)',fx.speed.toFixed(2)+'×','speed',.25,4,.01],
                ] as [string,string,keyof typeof fx,number,number,number][]).map(([label,val,key,min,max,step])=>(
                  <div key={key} style={{background:th.bgD,border:`1px solid ${th.bd}`,borderRadius:6,padding:'8px 10px'}}>
                    <div style={{display:'flex',justifyContent:'space-between',marginBottom:6}}>
                      <span style={{fontSize:10,fontWeight:600,color:th.txD,textTransform:'uppercase',letterSpacing:1,display:'flex',alignItems:'center',gap:4}}>
                        {label}
                        {FX_DESC[key]&&<span title={FX_DESC[key]} style={{cursor:'help',opacity:.5,fontSize:8,border:`1px solid ${th.txD}`,borderRadius:'50%',width:12,height:12,display:'inline-flex',alignItems:'center',justifyContent:'center',flexShrink:0,textTransform:'none',letterSpacing:0}}>?</span>}
                      </span>
                      <span style={{fontSize:11,fontWeight:700,color:th.ac}}>{val}</span>
                    </div>
                    <input type="range" min={min} max={max} step={step} value={fx[key] as number} onChange={e=>setFx(f=>({...f,[key]:+e.target.value}))} style={{width:'100%',accentColor:th.ac}}/>
                  </div>
                ))}
              </div>
              <div style={{display:'flex',flexWrap:'wrap',gap:8,marginTop:18}}>
                <button style={{...b1(true,th.ac2,th),padding:'8px 16px',fontWeight:600}} onClick={previewFx}>▶ Vypočuť s efektmi</button>
                <button style={{...b1(true,null,th),padding:'8px 16px',fontWeight:700}} onClick={applyFxToSel}>Použiť na vzorku</button>
                <button style={{...b1(true,th.ac3,th),padding:'8px 16px',fontWeight:600}} onClick={saveFxAsNew}>Uložiť ako novú</button>
                <button style={{...b1(false,null,th),padding:'8px 16px'}} onClick={()=>setFx({...FX0})}>Vynulovať efekty</button>
                <div style={{flex:1}}/>
                <button style={{...b1(false,null,th),padding:'8px 16px'}} onClick={()=>doExport(buildFx(cur.buffer),cur.name+'_fx')}>Exportovať WAV</button>
                <button style={{...b1(false,th.red,th),padding:'8px 16px'}} onClick={()=>setSamples(p=>p.map((s,i)=>i===sel?{...s,buffer:s.original,info:analyze(s.original)}:s))} title="Vráti vzorku do pôvodného stavu">Reset vzorky</button>
              </div>
            </div>}
          </div>
        )}

        {/* MIXER */}
        {panel==='mix'&&(
          <div style={{flex:1,overflow:'auto',padding:8,background:th.bg}}>
            <div style={{fontSize:10,fontWeight:700,color:th.txD,letterSpacing:1,marginBottom:8,textTransform:'uppercase'}}>Mixážny pult — zmeny pôsobia naživo počas hrania</div>
            <div style={{display:'flex',gap:8,overflow:'auto',paddingBottom:8}}>
              <div style={{minWidth:100,background:th.bgL,borderRadius:6,padding:10,display:'flex',flexDirection:'column',alignItems:'center',gap:6,border:`1px solid ${th.ac}66`}}>
                <div style={{fontSize:10,fontWeight:800,color:th.ac,letterSpacing:1}}>MASTER</div>
                <div style={{height:120,display:'flex',alignItems:'center',marginTop:8,marginBottom:8}}><input type="range" min={0} max={1.5} step={.01} value={masterVol} onChange={e=>setMasterVol(+e.target.value)} style={{width:120,accentColor:th.ac,transform:'rotate(-90deg)'}}/></div>
                <span style={{fontSize:10,color:th.txD,fontWeight:600}}>{(masterVol*100).toFixed(0)}%</span>
                <div style={{fontSize:8,color:th.txD,textAlign:'center',marginTop:'auto',lineHeight:1.3}}>hlavná<br/>hlasitosť</div>
              </div>
              {channels.length===0&&<div style={{color:th.txD,fontSize:12,padding:'20px 16px',alignSelf:'center'}}>Zatiaľ žiadne stopy — pridaj zvuky do sekvencera (záložka SEQUENCER) alebo načítaj Tekno Kit.</div>}
              {channels.map((ch:any,ci:number)=>{const s=samples[ch.sampleIdx];const col=cols[ci%cols.length];
                return(
                <div key={ci} style={{minWidth:100,background:th.bgD,borderRadius:6,padding:10,display:'flex',flexDirection:'column',alignItems:'center',gap:6,border:`1px solid ${col}33`,boxShadow:'0 4px 12px rgba(0,0,0,0.1)'}}>
                  <div style={{fontSize:10,fontWeight:700,color:col,maxWidth:80,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',textAlign:'center'}}>{s?.name||`CH ${ci+1}`}</div>
                  {isTK&&ch.isKick&&<span style={{fontSize:9,background:th.ac3,color:'#000',padding:'2px 6px',borderRadius:3,fontWeight:700}}>KICK</span>}
                  {isTK&&ch.sidechain&&<span style={{fontSize:9,background:th.ac2+'44',color:th.ac2,padding:'2px 6px',borderRadius:3,fontWeight:700}}>SC</span>}
                  <div style={{height:120,display:'flex',alignItems:'center',marginTop:8,marginBottom:8}}><input type="range" min={0} max={1.5} step={.01} value={ch.vol} onChange={e=>updCh(ci,'vol',+e.target.value)} style={{width:120,accentColor:col,transform:'rotate(-90deg)'}}/></div>
                  <span style={{fontSize:10,color:th.txD,fontWeight:600}}>{(ch.vol*100).toFixed(0)}%</span>
                  
                  <div style={{width:'100%',marginTop:8}}><div style={{fontSize:8,color:th.txD,textAlign:'center',marginBottom:2}}>PAN</div><input type="range" min={-1} max={1} step={.01} value={ch.pan} onChange={e=>updCh(ci,'pan',+e.target.value)} style={{width:'100%',accentColor:col}}/></div>
                  <div style={{width:'100%'}}><div style={{fontSize:8,color:'#f66',textAlign:'center',marginBottom:2}}>LO</div><input type="range" min={0} max={3} step={.05} value={ch.eqL} onChange={e=>updCh(ci,'eqL',+e.target.value)} style={{width:'100%',accentColor:'#f66'}}/></div>
                  <div style={{width:'100%'}}><div style={{fontSize:8,color:'#fc4',textAlign:'center',marginBottom:2}}>MID</div><input type="range" min={0} max={3} step={.05} value={ch.eqM} onChange={e=>updCh(ci,'eqM',+e.target.value)} style={{width:'100%',accentColor:'#fc4'}}/></div>
                  <div style={{width:'100%'}}><div style={{fontSize:8,color:'#4af',textAlign:'center',marginBottom:2}}>HI</div><input type="range" min={0} max={3} step={.05} value={ch.eqH} onChange={e=>updCh(ci,'eqH',+e.target.value)} style={{width:'100%',accentColor:'#4af'}}/></div>
                  
                  <div style={{display:'flex',gap:4,marginTop:8}}>
                    <button onClick={()=>updCh(ci,'mute',!ch.mute)} style={{...sb(ch.mute,th.red,th),fontSize:10,padding:'4px 8px',width:36}}>M</button>
                    <button onClick={()=>updCh(ci,'solo',!ch.solo)} style={{...sb(ch.solo,th.ac2,th),fontSize:10,padding:'4px 8px',width:36}}>S</button>
                  </div>
                </div>);
              })}
            </div>
          </div>
        )}

        {/* AI CHAT */}
        {panel==='chat'&&(
          <div style={{flex:1,display:'flex',flexDirection:'column',overflow:'hidden',background:th.bg}}>
            <div style={{flex:1,overflow:'auto',padding:12,display:'flex',flexDirection:'column',gap:8}}>
              {msgs.map((m,i)=>(
                <div key={i} style={{alignSelf:m.role==='user'?'flex-end':m.role==='system'?'center':'flex-start',maxWidth:m.role==='system'?'95%':'85%',padding:m.role==='system'?'6px 12px':'8px 14px',borderRadius:8,fontSize:m.role==='system'?10:13,lineHeight:1.5,whiteSpace:'pre-wrap',background:m.role==='user'?th.ac:th.bgD,color:m.role==='user'?(isTK?'#000':'#fff'):m.role==='system'?th.ac2:th.tx,border:`1px solid ${m.role==='user'?th.ac:m.role==='system'?th.ac2+'44':th.bd}`,fontFamily:m.role==='system'?'monospace':'inherit',boxShadow:m.role!=='system'?'0 2px 5px rgba(0,0,0,0.1)':'none'}}>{m.content}</div>
              ))}
              {loading&&<div style={{alignSelf:'flex-start',color:th.txD,fontSize:12,padding:'8px 14px',background:th.bgD,borderRadius:8,border:`1px solid ${th.bd}`}}>Thinking...</div>}
              <div ref={ceR}/>
            </div>
            <div style={{display:'flex',gap:6,padding:'10px 12px',borderTop:`1px solid ${th.bd}`,background:th.bgP,flexShrink:0}}>
              <input value={input} onChange={e=>setInput(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();sendChat();}}} placeholder={isTK?"sprav mi tvrdý tekno beat 175bpm...":"napíš čo potrebuješ..."} style={{flex:1,background:th.bgD,color:th.tx,border:`1px solid ${th.bd}`,borderRadius:4,padding:'8px 12px',fontSize:13,outline:'none',fontFamily:'inherit',boxShadow:'inset 0 1px 3px rgba(0,0,0,0.2)'}}/>
              <button style={{...b1(true,null,th), padding: '8px 20px', fontWeight: 700}} onClick={()=>sendChat()} disabled={loading}>SEND</button>
            </div>
          </div>
        )}
        {panel==='log'&&(<div style={{flex:1,overflow:'auto',padding:10,background:th.bg,fontFamily:'monospace',fontSize:11,lineHeight:1.8}}>{!log.length&&<div style={{color:th.txD}}>Empty</div>}{log.map((l,i)=><div key={i} style={{color:l.startsWith('✗')?th.red:l.startsWith('✓')?th.grn:th.ac2}}>{l}</div>)}</div>)}
      </div>
    </div>
    {/* Persistent LIVE AI command bar — always available on every tab */}
    <div style={{display:'flex',flexDirection:'column',gap:4,padding:'6px 10px',background:th.bgP,borderTop:`2px solid ${th.ac}`,flexShrink:0}}>
      {(loading||lastReply)&&<div style={{fontSize:11,color:loading?th.txD:th.tx,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{loading?'AI premýšľa…':<span><b style={{color:th.ac}}>AI:</b> {lastReply}</span>}</div>}
      <div style={{display:'flex',gap:6,alignItems:'center'}}>
        <span style={{fontSize:11,fontWeight:800,color:th.ac,letterSpacing:1,whiteSpace:'nowrap'}}>⚡ AI</span>
        <input value={cmdInput} onChange={e=>setCmdInput(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();const v=cmdInput.trim();if(v)sendChat(v);}}} placeholder={isTK?'napr. „posuň kick neskôr", „stíš hi-hat", „pridaj sidechain na bas"…':'opýtaj sa AI alebo zadaj príkaz… napr. „stíš bubon", „posuň kick neskôr"'} style={{flex:1,background:th.bgD,color:th.tx,border:`1px solid ${th.bd}`,borderRadius:4,padding:'7px 12px',fontSize:12,outline:'none',fontFamily:'inherit'}}/>
        <button style={{...b1(true,null,th),padding:'7px 16px',fontWeight:700}} onClick={()=>{const v=cmdInput.trim();if(v)sendChat(v);}} disabled={loading}>{loading?'…':'OK'}</button>
        <button style={{...sb(panel==='chat',th.ac2,th),padding:'7px 10px'}} onClick={()=>setPanel('chat')} title="Otvoriť celý chat">💬</button>
      </div>
    </div>

    <div style={{padding:'4px 12px',background:th.bgD,borderTop:`1px solid ${th.bd}`,fontSize:10,fontWeight:600,color:th.txD,display:'flex',gap:12,flexShrink:0}}>

    {/* ── DECOMPOSE PANEL ── */}
    {showDecompose&&(
      <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,.82)',zIndex:200,display:'flex',alignItems:'flex-start',justifyContent:'center',padding:'24px 16px',overflowY:'auto'}}>
        <div style={{width:'100%',maxWidth:720,background:th.bgD,border:'1px solid #aa44ff66',borderRadius:10,padding:20,display:'flex',flexDirection:'column',gap:14,boxShadow:'0 12px 40px rgba(0,0,0,.6)'}}>
          {/* Header */}
          <div style={{display:'flex',alignItems:'center',gap:10}}>
            <span style={{fontSize:14,fontWeight:800,color:'#aa44ff',letterSpacing:1}}>⬡ MULTILAYER DECOMPOSITOR</span>
            <span style={{fontSize:10,color:th.txD,flex:1}}>Izoluj stopy z nahrávky pomocou Demucs + Gemini + GPT-4o</span>
            <button onClick={()=>{setShowDecompose(false);setDecompResult(null);setDecompStep('');setDecompFile(null);}} style={{background:'none',border:'none',color:th.txD,cursor:'pointer',fontSize:18,lineHeight:1}}>×</button>
          </div>

          {/* Mode selection */}
          {!decompLoading&&!decompResult&&<div style={{display:'flex',gap:8}}>
            {([
              ['track','Track Analysis','Rýchla · 4 stopy · základný prehľad','#44bbff'],
              ['stem','Stem Analysis','Detailná · 6 stôp · identifikácia nástrojov','#00d4aa'],
              ['zoom','Deep Zoom','Chirurgická · extrakt konkrétneho zvuku','#ffcc00'],
            ] as [string,string,string,string][]).map(([m,title,sub,col])=>(
              <div key={m} onClick={()=>setDecompMode(m as any)} style={{flex:1,padding:'10px 12px',border:`2px solid ${decompMode===m?col:th.bd}`,borderRadius:6,cursor:'pointer',background:decompMode===m?col+'18':'transparent',transition:'all .1s'}}>
                <div style={{fontSize:12,fontWeight:700,color:col,marginBottom:3}}>{title}</div>
                <div style={{fontSize:10,color:th.txD}}>{sub}</div>
              </div>
            ))}
          </div>}

          {/* Deep Zoom extra fields */}
          {!decompLoading&&!decompResult&&decompMode==='zoom'&&(
            <div style={{display:'flex',flexDirection:'column',gap:8,padding:'10px 12px',background:th.bgP,borderRadius:6,border:`1px solid ${'#ffcc00'}44`}}>
              <div style={{fontSize:11,fontWeight:700,color:'#ffcc00'}}>Deep Zoom — nastavenia</div>
              <div style={{fontSize:10,color:th.red}}>⚠ Používa prémiové spracovanie. Max 30 sekúnd fragmentu.</div>
              <div style={{display:'flex',gap:10,flexWrap:'wrap'}}>
                <div style={{flex:1,minWidth:180}}>
                  <div style={{fontSize:9,color:th.txD,marginBottom:2}}>Cieľový nástroj / zvuk</div>
                  <input value={zoomTarget} onChange={e=>setZoomTarget(e.target.value)} placeholder="napr. basa, gitara, spev..." style={{width:'100%',background:th.bgL,color:th.tx,border:`1px solid ${'#ffcc00'}44`,borderRadius:4,padding:'5px 8px',fontSize:12,fontFamily:'inherit',outline:'none'}}/>
                </div>
                <div style={{display:'flex',gap:6}}>
                  <div><div style={{fontSize:9,color:th.txD,marginBottom:2}}>Začiatok</div><input value={zoomStart} onChange={e=>setZoomStart(e.target.value)} placeholder="0:00" style={{width:70,background:th.bgL,color:th.tx,border:`1px solid ${th.bd}`,borderRadius:4,padding:'5px 8px',fontSize:12,fontFamily:'monospace',outline:'none'}}/></div>
                  <div><div style={{fontSize:9,color:th.txD,marginBottom:2}}>Koniec</div><input value={zoomEnd} onChange={e=>setZoomEnd(e.target.value)} placeholder="0:30" style={{width:70,background:th.bgL,color:th.tx,border:`1px solid ${th.bd}`,borderRadius:4,padding:'5px 8px',fontSize:12,fontFamily:'monospace',outline:'none'}}/></div>
                </div>
              </div>
            </div>
          )}

          {/* Upload + Library selector */}
          {!decompLoading&&!decompResult&&(
            <div style={{display:'flex',gap:10,flexWrap:'wrap',alignItems:'stretch'}}>
              <label style={{flex:1,minWidth:200,display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',gap:6,padding:'20px 12px',border:`2px dashed ${'#aa44ff'}66`,borderRadius:6,cursor:'pointer',background:decompFile?'#aa44ff18':th.bgP,transition:'all .1s'}}>
                <span style={{fontSize:22}}>🎵</span>
                <span style={{fontSize:11,fontWeight:700,color:'#aa44ff'}}>{decompFile?decompFile.name:'Nahraj audio súbor'}</span>
                <span style={{fontSize:9,color:th.txD}}>WAV, MP3, OGG, FLAC, M4A, AAC, WebM</span>
                <input type="file" accept="audio/*" style={{display:'none'}} onChange={e=>setDecompFile(e.target.files?.[0]||null)}/>
              </label>
              {samples.length>0&&<div style={{flex:1,minWidth:160,display:'flex',flexDirection:'column',gap:4,padding:'8px',background:th.bgP,borderRadius:6,border:`1px solid ${th.bd}`}}>
                <div style={{fontSize:9,fontWeight:700,color:th.txD,letterSpacing:1,marginBottom:4}}>ALEBO Z KNIŽNICE</div>
                {samples.slice(0,6).map((s,i)=>(
                  <div key={i} onClick={async()=>{const ctx=getCtx();const wav=bufToWav(s.buffer);const ab=await wav.arrayBuffer();const f=new File([ab],s.name+'.wav',{type:'audio/wav'});setDecompFile(f);}} style={{padding:'4px 8px',borderRadius:4,cursor:'pointer',background:th.bgL,fontSize:10,display:'flex',alignItems:'center',gap:6,border:`1px solid ${decompFile?.name===s.name+'.wav'?s.color||'#aa44ff':th.bd}`}}>
                    <div style={{width:6,height:6,borderRadius:'50%',background:s.color||th.ac,flexShrink:0}}/>
                    <span style={{overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{s.name}</span>
                    <span style={{fontSize:8,color:th.txD,marginLeft:'auto'}}>{ft(s.info.duration)}</span>
                  </div>
                ))}
              </div>}
            </div>
          )}

          {/* Start button */}
          {!decompLoading&&!decompResult&&(
            <button disabled={!decompFile} onClick={async()=>{
              if(!decompFile)return;
              setDecompLoading(true);setDecompResult(null);setDecompStep('Pripravujem...');
              try{
                const fd=new FormData();
                fd.append('audio',decompFile);
                fd.append('mode',decompMode);
                if(decompMode==='zoom'){fd.append('target_instrument',zoomTarget);fd.append('fragment_start',zoomStart);fd.append('fragment_end',zoomEnd);}
                const resp=await fetch(`${BASE}/api/decompose`,{method:'POST',body:fd});
                if(!resp.body)throw new Error('No response body');
                const reader=resp.body.getReader();const dec=new TextDecoder();
                while(true){
                  const{done,value}=await reader.read();if(done)break;
                  const txt=dec.decode(value);
                  for(const line of txt.split('\n')){
                    if(!line.startsWith('data: '))continue;
                    try{const ev=JSON.parse(line.slice(6));
                      if(ev.step==='error'){setDecompStep('✗ '+ev.message);setDecompLoading(false);return;}
                      if(ev.step==='done'){setDecompResult(ev.data);setDecompLoading(false);setDecompStep('');return;}
                      if(ev.message)setDecompStep(ev.message);
                    }catch{}
                  }
                }
              }catch(e:any){setDecompStep('✗ '+e.message);setDecompLoading(false);}
            }} style={{...b1(true,'#aa44ff',th),padding:'10px 20px',fontWeight:800,fontSize:12,opacity:decompFile?1:.45}}>
              ▶ Spustiť dekompozíciu
            </button>
          )}

          {/* Loading state */}
          {decompLoading&&(
            <div style={{display:'flex',flexDirection:'column',alignItems:'center',gap:12,padding:'32px 0'}}>
              <div style={{fontSize:24}}>⬡</div>
              <div style={{fontSize:13,fontWeight:700,color:'#aa44ff'}}>{decompStep||'Spracovávam...'}</div>
              <div style={{fontSize:10,color:th.txD}}>Môže trvať 1–5 minút podľa dĺžky nahrávky</div>
              <div style={{display:'flex',gap:4}}>{[0,1,2,3].map(i=><div key={i} style={{width:8,height:8,borderRadius:'50%',background:'#aa44ff',opacity:.3+.175*i,animation:'none'}}/>)}</div>
            </div>
          )}

          {/* Results */}
          {decompResult&&(
            <div style={{display:'flex',flexDirection:'column',gap:12}}>
              {/* Smart Preview */}
              {decompResult.smart_preview&&(
                <div style={{padding:'10px 12px',background:th.bgP,borderRadius:6,border:`1px solid ${'#aa44ff'}44`}}>
                  <div style={{fontSize:11,fontWeight:700,color:'#aa44ff',marginBottom:6}}>Smart Preview</div>
                  <div style={{display:'flex',gap:12,flexWrap:'wrap',fontSize:10}}>
                    {decompResult.smart_preview.genre&&<span style={{color:th.ac}}>🎵 {decompResult.smart_preview.genre}</span>}
                    {decompResult.smart_preview.bpm&&<span style={{color:th.ac2}}>♩ {decompResult.smart_preview.bpm} BPM</span>}
                    {decompResult.smart_preview.key&&<span style={{color:th.ac3}}>🎹 {decompResult.smart_preview.key}</span>}
                    <span style={{color:th.txD}}>{decompResult.smart_preview.complexity} complexity</span>
                  </div>
                  {decompResult.smart_preview.summary&&<div style={{marginTop:6,fontSize:11,color:th.tx,lineHeight:1.5}}>{decompResult.smart_preview.summary}</div>}
                  {decompResult.smart_preview.notable_elements?.length>0&&(
                    <div style={{marginTop:6,display:'flex',gap:4,flexWrap:'wrap'}}>
                      {decompResult.smart_preview.notable_elements.map((el:string,i:number)=>(
                        <span key={i} style={{fontSize:9,padding:'2px 6px',background:'#aa44ff22',color:'#aa44ff',borderRadius:3}}>{el}</span>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* Stems */}
              <div style={{fontSize:11,fontWeight:700,color:th.txD,letterSpacing:1}}>STOPY ({decompResult.stems?.length??0})</div>
              {(decompResult.stems||[]).map((stem:any,i:number)=>{
                const layer=decompResult.layers?.find((l:any)=>l.stem_id===stem.stem_id);
                const conf=layer?.confidence??null;
                const confCol=conf==null?th.txD:conf>=.8?'#44ff88':conf>=.6?'#ffcc00':'#ff4455';
                return(
                <div key={i} style={{padding:'10px 12px',background:th.bgP,borderRadius:6,border:`1px solid ${th.bd}`}}>
                  <div style={{display:'flex',alignItems:'center',gap:8,flexWrap:'wrap',marginBottom:layer?6:0}}>
                    <span style={{fontSize:12,fontWeight:700,color:th.ac}}>{layer?.layer_name||stem.demucs_label}</span>
                    {conf!=null&&<span style={{fontSize:9,padding:'2px 6px',background:confCol+'22',color:confCol,borderRadius:3,fontWeight:700}}>{Math.round(conf*100)}%</span>}
                    <span style={{fontSize:9,color:th.txD,marginLeft:'auto'}}>{stem.filename}</span>
                    <button onClick={async()=>{
                      try{const r=await fetch(stem.file_url);const ab=await r.arrayBuffer();
                        const ctx=getCtx();const buf=await ctx.decodeAudioData(ab);
                        addSample(layer?.layer_name||stem.demucs_label,buf,'#aa44ff');
                        setLog(p=>[...p,`✓ "${layer?.layer_name||stem.demucs_label}" pridaný do knižnice`]);
                      }catch(e:any){setLog(p=>[...p,`✗ Chyba: ${e.message}`]);}
                    }} style={{...sb(false,'#aa44ff',th),fontSize:9,padding:'2px 8px'}}>+ Library</button>
                    <a href={stem.file_url} download={stem.filename} style={{...sb(false,null,th),fontSize:9,padding:'2px 8px',textDecoration:'none'}}>↓ WAV</a>
                  </div>
                  {layer&&<>
                    {layer.instruments?.length>0&&<div style={{fontSize:10,color:th.txD,marginBottom:3}}>{layer.instruments.join(' · ')}</div>}
                    {layer.description&&<div style={{fontSize:10,color:th.tx,marginBottom:3,lineHeight:1.4}}>{layer.description}</div>}
                    {layer.effects_detected?.length>0&&<div style={{display:'flex',gap:3,flexWrap:'wrap'}}>
                      {layer.effects_detected.map((ef:string,j:number)=><span key={j} style={{fontSize:8,padding:'1px 5px',background:th.bgL,color:th.ac2,borderRadius:3}}>{ef}</span>)}
                    </div>}
                  </>}
                </div>);
              })}

              {/* Escalation suggestions */}
              {(decompResult.escalation_suggestions||[]).map((esc:any,i:number)=>(
                <div key={i} style={{padding:'8px 12px',background:'#ff445520',border:'1px solid #ff445544',borderRadius:6,fontSize:10}}>
                  <span style={{color:'#ff4455',fontWeight:700}}>⚠ {esc.layer_name}</span>
                  <span style={{color:th.txD,marginLeft:8}}>{esc.message}</span>
                  <button onClick={()=>{setDecompMode('zoom');setZoomStart(esc.suggested_range?.start||'0:00');setZoomEnd(esc.suggested_range?.end||'0:30');setDecompResult(null);}} style={{...sb(false,'#ffcc00',th),fontSize:9,padding:'2px 8px',marginLeft:8}}>Deep Zoom</button>
                </div>
              ))}

              <button onClick={()=>{setDecompResult(null);setDecompStep('');}} style={{...sb(false,null,th),padding:'6px 14px',alignSelf:'flex-start'}}>← Nová dekompozícia</button>
            </div>
          )}
        </div>
      </div>
    )}

    {/* Rename modal */}
    {renameTarget&&(
      <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,.75)',display:'flex',alignItems:'center',justifyContent:'center',zIndex:998}} onClick={()=>setRenameTarget(null)}>
        <div onClick={e=>e.stopPropagation()} style={{background:th.bgD,border:`1px solid ${th.bd}`,borderRadius:8,padding:24,minWidth:320,display:'flex',flexDirection:'column',gap:12,boxShadow:'0 10px 30px rgba(0,0,0,.5)'}}>
          <div style={{fontSize:14,fontWeight:700,color:th.ac}}>Premenovať vzorku</div>
          <input autoFocus value={renameTarget.name} onChange={e=>setRenameTarget(p=>p?{...p,name:e.target.value}:null)} onKeyDown={e=>{if(e.key==='Enter'){setSamples(p=>p.map((s,i)=>i===renameTarget.idx?{...s,name:renameTarget.name}:s));setLog(p=>[...p,`✎ Premenované na "${renameTarget.name}"`]);setRenameTarget(null);}if(e.key==='Escape')setRenameTarget(null);}} style={{background:th.bgL,color:th.tx,border:`1px solid ${th.ac}`,borderRadius:4,padding:'8px 12px',fontSize:13,outline:'none',fontFamily:'inherit'}}/>
          <div>
            <div style={{fontSize:11,color:th.txD,marginBottom:4}}>Kategória / tag</div>
            <input placeholder="napr. kick, bass, ambient..." value={samples[renameTarget.idx]?.tag||''} onChange={e=>{const v=e.target.value;setSamples(p=>p.map((s,i)=>i===renameTarget.idx?{...s,tag:v}:s));}} style={{width:'100%',background:th.bgL,color:th.tx,border:`1px solid ${th.bd}`,borderRadius:4,padding:'6px 10px',fontSize:12,outline:'none',fontFamily:'inherit'}}/>
          </div>
          <div style={{display:'flex',gap:6,flexWrap:'wrap'}}>
            {SWATCH.map(col=><div key={col} onClick={()=>setSamples(p=>p.map((s,i)=>i===renameTarget.idx?{...s,color:col}:s))} style={{width:20,height:20,borderRadius:'50%',background:col,cursor:'pointer',border:`2px solid ${samples[renameTarget.idx]?.color===col?'#fff':'transparent'}`,transition:'border .1s'}}/>)}
          </div>
          <div style={{display:'flex',gap:8,justifyContent:'flex-end'}}>
            <button style={{...sb(false,null,th),padding:'6px 14px'}} onClick={()=>setRenameTarget(null)}>Zrušiť</button>
            <button style={{...b1(true,null,th),padding:'6px 14px',fontWeight:700}} onClick={()=>{setSamples(p=>p.map((s,i)=>i===renameTarget.idx?{...s,name:renameTarget.name}:s));setLog(p=>[...p,`✎ Premenované na "${renameTarget.name}"`]);setRenameTarget(null);}}>Uložiť</button>
          </div>
        </div>
      </div>
    )}

    {/* Export dialog */}
    {exportAudio&&(
      <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,.8)',display:'flex',alignItems:'center',justifyContent:'center',zIndex:999}} onClick={()=>setExportAudio(null)}>
        <div onClick={e=>e.stopPropagation()} style={{background:th.bgD,border:`1px solid ${th.bd}`,borderRadius:8,padding:24,minWidth:320,display:'flex',flexDirection:'column',gap:16,alignItems:'center',boxShadow:'0 10px 30px rgba(0,0,0,0.5)'}}>
          <div style={{fontSize:16,fontWeight:700,color:th.ac,letterSpacing:1}}>EXPORT READY</div>
          <div style={{fontSize:13,color:th.tx}}>{exportAudio.name}</div>
          <audio controls src={exportAudio.url} style={{width:'100%'}}/>
          <a href={exportAudio.url} download={exportAudio.name} style={{...b1(true,null,th),textDecoration:'none',textAlign:'center',width:'100%',padding:'10px 16px',fontWeight:700,display:'block'}}>DOWNLOAD WAV</a>
          <button onClick={()=>setExportAudio(null)} style={{...sb(false,null,th),marginTop:8,padding:'6px 16px'}}>CLOSE</button>
        </div>
      </div>
    )}
      <span style={{color:th.ac,letterSpacing:1}}>{mode.toUpperCase()}</span>
      <span>{samples.length} SAMPLES</span>
      <span>{channels.length} TRACKS</span>
      <span>{bpm} BPM</span>
      {isTK&&<span>SWING {swing}%</span>}
      {isTK&&<span>PATTERN: {String.fromCharCode(65+curPat)}</span>}
      {seqPlaying&&<span style={{color:th.ac2,letterSpacing:1}}>PLAYING {curStep+1}/{stepCount}</span>}
    </div>
  </div>);
}
