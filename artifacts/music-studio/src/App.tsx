import { useState, useRef, useCallback, useEffect } from "react";

const C={bg:"#1a1a2e",bgD:"#0e0e1a",bgP:"#14142a",bgL:"#222244",ac:"#ff6b35",ac2:"#00d4aa",ac3:"#7b68ee",tx:"#e0e0e0",txD:"#7777aa",bd:"#252545",wf:"#00d4aa",wfBg:"#0a0a15",red:"#ff4455",grn:"#44ff88"};
const TK={bg:"#0d0d0d",bgD:"#080808",bgP:"#111111",bgL:"#1a1a1a",ac:"#00ffaa",ac2:"#ff0066",ac3:"#ffcc00",tx:"#cccccc",txD:"#555555",bd:"#222222",wf:"#00ffaa",wfBg:"#050505",red:"#ff0044",grn:"#00ff66"};
const TC=["#00d4aa","#7b68ee","#ff6b35","#ff4488","#44bbff","#ffcc00","#88ff44","#ff8844","#aa66ff","#66ffcc"];
const TKC=["#00ffaa","#ff0066","#ffcc00","#00ccff","#ff6600","#cc44ff","#66ff44","#ff3388","#44ffcc","#ffaa00"];

const FX0={gain:1,fadeIn:0,fadeOut:0,lpFreq:20000,hpFreq:20,saturation:0,delay:0,delayTime:.25,delayFb:.3,compress:0,loop:1,reverb:0,reverbDecay:1.5,chorus:0,chorusRate:.5,bitCrush:0};
const SWATCH=["#ff6b35","#00d4aa","#7b68ee","#ff4488","#44bbff","#ffcc00","#88ff44","#ff8844","#aa66ff","#ff0066","#00ffaa","#e5523b","#66ccff","#ff99cc","#99ff66"];
// EQ multiplier (0..3, 1=flat) -> dB for live BiquadFilter
const eqDb=(m: number)=>m<=0?-40:Math.max(-40,Math.min(18,20*Math.log10(m)));

const b1=(a: boolean,c: string|null,t: any)=>{const p=t||C;return{background:a?(c||p.ac):p.bgL,color:a?"#fff":p.tx,border:`1px solid ${a?(c||p.ac):p.bd}`,borderRadius:3,padding:"6px 12px",cursor:"pointer",fontSize:12,fontFamily:"inherit",fontWeight:a?600:400};};
const sb=(a: boolean,c: string|null,t: any)=>({...b1(a,c,t),padding:"3px 8px",fontSize:11});
const LBL=176;

function analyze(b: AudioBuffer){const d=b.getChannelData(0);let mx=0,rm=0;for(let i=0;i<d.length;i++){const a=Math.abs(d[i]);if(a>mx)mx=a;rm+=d[i]*d[i];}rm=Math.sqrt(rm/d.length);let pk=[],th=mx*.65;for(let i=1;i<d.length-1;i++)if(d[i]>th&&d[i]>d[i-1]&&d[i]>d[i+1]&&(!pk.length||i-pk[pk.length-1]>b.sampleRate*.15))pk.push(i);let bpm=null;if(pk.length>2){let av=0;for(let i=1;i<Math.min(pk.length,20);i++)av+=pk[i]-pk[i-1];av/=Math.min(pk.length-1,19);bpm=Math.round(60/(av/b.sampleRate));while(bpm<60)bpm*=2;while(bpm>200)bpm=Math.round(bpm/2);}return{duration:b.duration,sr:b.sampleRate,ch:b.numberOfChannels,peak:mx,rms:rm,bpm};}

function drawWf(cv: HTMLCanvasElement|null,buf: AudioBuffer|undefined,sel: {start:number,end:number}|null,pos: number|null,th: any){if(!cv)return;const p=th||C;const x=cv.getContext("2d");if(!x)return;const w=cv.width,h=cv.height;x.fillStyle=p.wfBg;x.fillRect(0,0,w,h);x.strokeStyle=p.bd;x.lineWidth=.5;for(let i=1;i<10;i++){const px=(w/10)*i;x.beginPath();x.moveTo(px,0);x.lineTo(px,h);x.stroke();}x.beginPath();x.moveTo(0,h/2);x.lineTo(w,h/2);x.stroke();if(sel){x.fillStyle="rgba(255,107,53,.12)";x.fillRect(sel.start*w,0,(sel.end-sel.start)*w,h);}if(!buf)return;const d=buf.getChannelData(0),st=Math.max(1,Math.floor(d.length/w));x.beginPath();x.strokeStyle=p.wf;x.lineWidth=1;for(let i=0;i<w;i++){let mn=1,mx2=-1;for(let j=0;j<st;j++){const idx=i*st+j;if(idx<d.length){if(d[idx]<mn)mn=d[idx];if(d[idx]>mx2)mx2=d[idx];}}x.moveTo(i,(1-mx2)*h/2);x.lineTo(i,(1-mn)*h/2);}x.stroke();if(pos!=null){x.strokeStyle="#fff";x.lineWidth=1.5;x.beginPath();x.moveTo(pos*w,0);x.lineTo(pos*w,h);x.stroke();}}

function applyFx(buf: AudioBuffer,fx: any,ctx: AudioContext){const len=buf.length,ch=buf.numberOfChannels,sr=buf.sampleRate,out=ctx.createBuffer(ch,len,sr);for(let c=0;c<ch;c++){const inp=buf.getChannelData(c),o=out.getChannelData(c);for(let j=0;j<len;j++)o[j]=inp[j];if(fx.gain!=null&&fx.gain!==1)for(let j=0;j<len;j++)o[j]*=fx.gain;if(fx.reverse)for(let j=0;j<len/2;j++){const t=o[j];o[j]=o[len-1-j];o[len-1-j]=t;}if(fx.normalize){let m=0;for(let j=0;j<len;j++){const a=Math.abs(o[j]);if(a>m)m=a;}if(m>0){const s=.95/m;for(let j=0;j<len;j++)o[j]*=s;}}if(fx.fadeIn>0){const s=Math.floor(fx.fadeIn*sr);for(let j=0;j<Math.min(s,len);j++)o[j]*=j/s;}if(fx.fadeOut>0){const s=Math.floor(fx.fadeOut*sr);for(let j=0;j<Math.min(s,len);j++)o[len-1-j]*=j/s;}if(fx.lpFreq!=null&&fx.lpFreq<20000){const rc=1/(2*Math.PI*fx.lpFreq),dt=1/sr,a=dt/(rc+dt);let p2=o[0];for(let j=1;j<len;j++){o[j]=p2+a*(o[j]-p2);p2=o[j];}}if(fx.hpFreq!=null&&fx.hpFreq>20){const rc=1/(2*Math.PI*fx.hpFreq),dt=1/sr,a=rc/(rc+dt);let p2=o[0],pi=o[0];for(let j=1;j<len;j++){const v=a*(p2+o[j]-pi);pi=o[j];o[j]=v;p2=v;}}if(fx.saturation>0)for(let j=0;j<len;j++)o[j]=Math.tanh(o[j]*(1+fx.saturation*3))/(1+fx.saturation*.5);if(fx.delay>0){const dt2=Math.floor((fx.delayTime||.25)*sr),fb=fx.delayFb||.4;for(let j=dt2;j<len;j++)o[j]+=o[j-dt2]*fb*fx.delay;}if(fx.compress>0){const th2=1-fx.compress*.7,rat=1+fx.compress*8;for(let j=0;j<len;j++){const a=Math.abs(o[j]);if(a>th2)o[j]*=(th2+(a-th2)/rat)/a;}}
    if(fx.chorus>0){const rate=fx.chorusRate||.5,depth=Math.floor((.003+fx.chorus*.009)*sr),wet=fx.chorus,tmp=new Float32Array(len);for(let j=0;j<len;j++){const lfo=Math.sin(2*Math.PI*rate*j/sr);const di=Math.floor(depth*(lfo*.5+.5));tmp[j]=j-di>=0?o[j-di]:0;}for(let j=0;j<len;j++)o[j]=o[j]*(1-wet*.4)+tmp[j]*wet*.4;}
    if(fx.bitCrush>0){const bits=Math.max(1,Math.round(16-fx.bitCrush*14)),step=2/Math.pow(2,bits);for(let j=0;j<len;j++)o[j]=Math.round(o[j]/step)*step;}
    if(fx.reverb>0){const wet=fx.reverb,decay=fx.reverbDecay||1.5,dry=new Float32Array(len);for(let j=0;j<len;j++)dry[j]=o[j];const taps=[.023,.031,.041,.053,.067,.083,.1,.13,.17];for(let t=0;t<taps.length;t++){const tapS=Math.floor(taps[t]*sr),g=wet*.28*Math.exp(-taps[t]*2.5/decay);for(let j=tapS;j<len;j++)o[j]+=dry[j-tapS]*g;}}}return out;}

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
    for(let st=0;st<steps;st++){if(!ch.steps[st])continue;
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

const MKCH=(sc: number)=>({sampleIdx:0,steps:new Array(sc).fill(false),velocities:new Array(sc).fill(80),ratchets:new Array(sc).fill(1),filterAuto:new Array(sc).fill(1),vol:.8,pan:0,pitch:1,mute:false,solo:false,eqL:1,eqM:1,eqH:1,sidechain:false,isKick:false});

const SYSP_CL=`ROLA: AI producent. Slovenčina. STRUČNE - max 2 vety v message.
FORMÁT: Odpovedaj VÝHRADNE platným JSON bez markdown. Žiadny text pred ani za JSON.
{"message":"krátka odpoveď","commands":[{"op":"..."}]}

OPS: select(sample), trim_silence, crop_time(start,end), split(time), merge(samples:[0,1],gaps:[0.5],name), loop(times,crossfade), effects(params:{gain,lpFreq,hpFreq,saturation,fadeIn,fadeOut,normalize,reverse,delay,delayTime,delayFb,compress,reverb,reverbDecay,chorus,chorusRate,bitCrush}), rename(name), duplicate(newName), create_from(source,newName,operations:[]), add_channel(sample,steps:[1,0,...],volume,pan,pitch,eqLow,eqMid,eqHigh), set_channel(channel,volume,pan,pitch,steps,eqLow,eqMid,eqHigh,mute,solo), shift_channel(channel,steps:N — posun stopy v čase: +N neskôr/vpravo, -N skôr/vľavo, 1 krok=1/16 taktu), set_bpm(bpm), bounce_pattern(name), export, export_pattern
EFEKTY: reverb(0-1)+reverbDecay(0.3-4s)=dozvuk; chorus(0-1)=chorus/flanger; bitCrush(0-1)=bitcrusher/lo-fi; saturation=skreslenie; delay=echo. Kombinuj pre zaujímavé zvuky.

LIVE MIXING: na stíšenie/zhlasnenie stopy použi set_channel(volume), mute(true/false), pan, eqLow/Mid/High (1=neutrál). Na posun zvuku v čase ("posuň kick neskôr/skôr") použi shift_channel.

split: rozdelí vzorku na dve nové (A+B) v danom čase. merge: spojí viaceré vzorky za seba, gaps=medzery v sekundách.
DÔLEŽITÉ: Ak nemáš vzorky, povedz nech nahrajú. Ak máš, VŽDY generuj commands. Neopisuj kód, nepíš návody. KONAJ.`;

const SYSP_TK=`ROLA: AI tekno producent (free tekno / hardtek). Slovenčina. STRUČNE - max 2 vety.
FORMÁT: Odpovedaj VÝHRADNE platným JSON bez markdown. Žiadny text pred ani za JSON.
{"message":"krátka odpoveď","commands":[{"op":"..."}]}

OPS (klasické + tekno):
split(time), merge(samples:[],gaps:[],name) — rozdeľ a spájaj vzorky
add_channel: +velocities[0-127], ratchets[1-4], sidechain(bool), isKick(bool)
set_channel: +velocities, ratchets, sidechain, isKick, filterAuto[0-1]
effects: params={gain,saturation,lpFreq,hpFreq,delay,delayTime,compress,reverb,reverbDecay,chorus,chorusRate,bitCrush,fadeIn,fadeOut,normalize,reverse}
shift_channel(channel,steps:N) — posun stopy v čase: +N neskôr/vpravo, -N skôr (napr. "posuň kick neskôr"). 1 krok = 1/16 taktu.
LIVE MIX: set_channel(volume,mute,pan,eqLow/Mid/High) — stíš/zhlasni/uprav stopu naživo počas hrania.
set_swing(swing:50-75), set_pattern(pattern:0-7), copy_pattern(from,to)

PRAVIDLÁ (FREE TEKNO / HARDTEK): BPM 150-185. Skreslený, rýchly kick — nie len 4-on-floor, ale rolling/offbeat kicky s ratchet 2-4 pre rýchle rolly. Agresívny, skreslený bassline (sidechain na kick). Hihat offset. Swing tesný 50-56. Energia a tvrdosť. VŽDY generuj commands, neopisuj. KONAJ.`;

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
  const[showClips,setShowClips]=useState(false);
  const[clips,setClips]=useState<any[]>([]);
  const[clipSel,setClipSel]=useState<number|null>(null);
  const[clipFx,setClipFx]=useState({...FX0});
  const[clipHistory,setClipHistory]=useState<any[][]>([]);
  const[seqPreviewBuf,setSeqPreviewBuf]=useState<AudioBuffer|null>(null);
  const seqCvR=useRef<HTMLCanvasElement|null>(null);
  let clipIdR=useRef(0);

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
      for(const ch of chs){if(ch.mute||(solo&&!ch.solo)||!ch.steps[st])continue;const s=smp[ch.sampleIdx];if(!s)continue;
        const ratch=ch.ratchets?.[st]||1;const vel=(ch.velocities?.[st]??80)/127;
        for(let r=0;r<ratch;r++){const src=ctx.createBufferSource();src.buffer=s.buffer;if(ch.pitch&&ch.pitch!==1)src.playbackRate.value=ch.pitch;
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
  const execCmds=useCallback(async(cmds: any[],sa: any[])=>{const ctx=getCtx();let ci=sel;let arr=[...sa];let chs=[...channels];let lg:string[]=[];let bp=bpm;let sw=swing;
    for(const cmd of cmds){try{
      if(cmd.op==='select'){ci=cmd.sample;setSel(ci);}
      else if(cmd.op==='trim_silence'&&ci!=null&&arr[ci]){const b=trimSil(arr[ci].buffer,ctx);arr[ci]={...arr[ci],buffer:b,info:analyze(b)};lg.push(`▸ Trim`);}
      else if(cmd.op==='crop_time'&&ci!=null&&arr[ci]){const b=cropT(arr[ci].buffer,cmd.start||0,cmd.end||arr[ci].buffer.duration,ctx);arr[ci]={...arr[ci],buffer:b,info:analyze(b)};lg.push(`▸ Crop`);}
      else if(cmd.op==='loop'&&ci!=null&&arr[ci]){const b=mkLoop(arr[ci].buffer,cmd.times||4,cmd.crossfade||.02,ctx);arr[ci]={...arr[ci],buffer:b,info:analyze(b)};lg.push(`▸ Loop ${cmd.times}×`);}
      else if(cmd.op==='effects'&&ci!=null&&arr[ci]){const p=cmd.params||{};const b=applyFx(arr[ci].buffer,{gain:p.gain??1,reverse:!!p.reverse,normalize:!!p.normalize,fadeIn:p.fadeIn||0,fadeOut:p.fadeOut||0,lpFreq:p.lpFreq??20000,hpFreq:p.hpFreq??20,saturation:p.saturation||0,delay:p.delay||0,delayTime:p.delayTime||.25,delayFb:p.delayFb||.3,compress:p.compress||0},ctx);arr[ci]={...arr[ci],buffer:b,info:analyze(b)};lg.push(`▸ FX`);}
      else if(cmd.op==='rename'&&ci!=null){arr[ci]={...arr[ci],name:cmd.name};lg.push(`▸ Rename`);}
      else if(cmd.op==='duplicate'&&ci!=null&&arr[ci]){arr.push({...arr[ci],name:cmd.newName||arr[ci].name+'_dup'});lg.push(`▸ Dup #${arr.length-1}`);}
      else if(cmd.op==='create_from'){const si2=cmd.source??ci;if(si2!=null&&arr[si2]){let b=arr[si2].buffer;for(const op of(cmd.operations||[])){if(op.op==='trim_silence')b=trimSil(b,ctx);else if(op.op==='crop_time')b=cropT(b,op.start||0,op.end||b.duration,ctx);else if(op.op==='loop')b=mkLoop(b,op.times||4,op.crossfade||.02,ctx);else if(op.op==='effects')b=applyFx(b,{gain:op.params?.gain??1,reverse:!!op.params?.reverse,normalize:!!op.params?.normalize,fadeIn:op.params?.fadeIn||0,fadeOut:op.params?.fadeOut||0,lpFreq:op.params?.lpFreq??20000,hpFreq:op.params?.hpFreq??20,saturation:op.params?.saturation||0,delay:op.params?.delay||0,delayTime:op.params?.delayTime||.25,delayFb:op.params?.delayFb||.3,compress:op.params?.compress||0},ctx);}arr.push({name:cmd.newName||`new_${arr.length}`,buffer:b,info:analyze(b),original:b});lg.push(`▸ Nová "${cmd.newName}" #${arr.length-1}`);}}
      else if(cmd.op==='add_channel'){const si2=cmd.sample??ci;if(si2!=null){const c=MKCH(stepCount);c.sampleIdx=si2;if(cmd.steps)c.steps=cmd.steps.map((v:any)=>!!v);if(cmd.velocities)c.velocities=cmd.velocities;if(cmd.ratchets)c.ratchets=cmd.ratchets;if(cmd.volume!=null)c.vol=cmd.volume;if(cmd.pan!=null)c.pan=cmd.pan;if(cmd.pitch!=null)c.pitch=cmd.pitch;if(cmd.eqLow!=null)c.eqL=cmd.eqLow;if(cmd.eqMid!=null)c.eqM=cmd.eqMid;if(cmd.eqHigh!=null)c.eqH=cmd.eqHigh;if(cmd.sidechain!=null)c.sidechain=cmd.sidechain;if(cmd.isKick!=null)c.isKick=cmd.isKick;if(cmd.filterAuto)c.filterAuto=cmd.filterAuto;chs.push(c);lg.push(`▸ Ch: "${arr[si2]?.name}"`);}}
      else if(cmd.op==='set_channel'&&cmd.channel!=null&&chs[cmd.channel]){const c={...chs[cmd.channel]};if(cmd.volume!=null)c.vol=cmd.volume;if(cmd.pan!=null)c.pan=cmd.pan;if(cmd.pitch!=null)c.pitch=cmd.pitch;if(cmd.steps)c.steps=cmd.steps.map((v:any)=>!!v);if(cmd.velocities)c.velocities=cmd.velocities;if(cmd.ratchets)c.ratchets=cmd.ratchets;if(cmd.eqLow!=null)c.eqL=cmd.eqLow;if(cmd.eqMid!=null)c.eqM=cmd.eqMid;if(cmd.eqHigh!=null)c.eqH=cmd.eqHigh;if(cmd.mute!=null)c.mute=cmd.mute;if(cmd.solo!=null)c.solo=cmd.solo;if(cmd.sidechain!=null)c.sidechain=cmd.sidechain;if(cmd.isKick!=null)c.isKick=cmd.isKick;if(cmd.filterAuto)c.filterAuto=cmd.filterAuto;chs[cmd.channel]=c;lg.push(`▸ Ch${cmd.channel} upd`);}
      else if(cmd.op==='shift_channel'&&cmd.channel!=null&&chs[cmd.channel]){const c={...chs[cmd.channel]};const n=Math.round(cmd.steps||0);const L=c.steps.length;const rot=(a:any[])=>a&&a.length?a.map((_,i)=>a[((i-n)%L+L)%L]):a;c.steps=rot(c.steps);c.velocities=rot(c.velocities);c.ratchets=rot(c.ratchets);c.filterAuto=rot(c.filterAuto);chs[cmd.channel]=c;lg.push(`▸ Posun Ch${cmd.channel} ${n>0?'+':''}${n}`);}
      else if(cmd.op==='set_bpm'){bp=cmd.bpm;setBpm(cmd.bpm);lg.push(`▸ BPM ${cmd.bpm}`);}
      else if(cmd.op==='set_swing'){sw=cmd.swing;setSwing(cmd.swing);lg.push(`▸ Swing ${cmd.swing}%`);}
      else if(cmd.op==='set_pattern'){setCurPat(cmd.pattern);lg.push(`▸ Pattern ${cmd.pattern}`);}
      else if(cmd.op==='copy_pattern'){const from=cmd.from??curPat;setPatterns(p=>{const n=[...p];n[cmd.to]=JSON.parse(JSON.stringify(n[from]));return n;});lg.push(`▸ Copy pat ${cmd.from}→${cmd.to}`);}
      else if(cmd.op==='bounce_pattern'){const buf=bouncePat(chs,arr,bp,stepCount,sw,ctx);arr.push({name:cmd.name||`Pat_${bp}`,buffer:buf,info:analyze(buf),original:buf});lg.push(`▸ Bounce→"${cmd.name}"`);}
      else if(cmd.op==='split'&&ci!=null&&arr[ci]){const t=cmd.time||arr[ci].buffer.duration/2;const[a,b2]=splitAt(arr[ci].buffer,t,ctx);const nm=arr[ci].name;arr[ci]={...arr[ci],name:nm+'_A',buffer:a,info:analyze(a)};arr.push({name:nm+'_B',buffer:b2,info:analyze(b2),original:b2});lg.push(`▸ Split "${nm}" @ ${t.toFixed(2)}s → A(${ft(a.duration)}) + B(${ft(b2.duration)})`);}
      else if(cmd.op==='merge'){const idxs=cmd.samples||[];if(idxs.length>=2){const bufs=idxs.map((i:number)=>arr[i]?.buffer).filter(Boolean);if(bufs.length>=2){const gaps=cmd.gaps||[];const merged=mergeBufs(bufs,gaps,ctx);const nm=cmd.name||'Merged_'+arr.length;arr.push({name:nm,buffer:merged,info:analyze(merged),original:merged});lg.push(`▸ Merge ${idxs.length} vzoriek → "${nm}" (${ft(merged.duration)})`);}}}
      else if(cmd.op==='export'&&ci!=null&&arr[ci])doExport(arr[ci].buffer,arr[ci].name);
      else if(cmd.op==='export_pattern'){const buf=bouncePat(chs,arr,bp,stepCount,sw,ctx);doExport(buf,'pattern');}
    }catch(e: any){lg.push(`✗ ${cmd.op}: ${e.message}`);}}
    setSamples(arr);setChannels(chs);setLog(p=>[...p,...lg]);return lg;
  },[sel,channels,bpm,swing,stepCount,curPat,getCtx,doExport,addSample]);

  const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

  const sendChat = useCallback(async (override?: string) => {
    const msg = (override ?? input).trim();
    if (!msg || loading) return;
    if (override === undefined) setInput(""); else setCmdInput("");
    const nm = [...msgs, { role: "user" as const, content: msg }];
    setMsgs(nm);
    setLoading(true);
    try {
      const si = samples.map((s, i) => `${i}."${s.name}" ${s.info.duration.toFixed(2)}s${s.info.bpm ? ` ~${s.info.bpm}BPM` : ""}`).join("\n");
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
      let parsed: { message?: string; commands?: Array<{ op: string; [k: string]: unknown }> } = {};
      
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
      if (parsed.commands && parsed.commands.length > 0) {
        const lg = await execCmds(parsed.commands, samples);
        if (lg.length) setMsgs(p => [...p, { role: "system", content: ">> " + lg.join("\n") }]);
      }
    } catch (e) {
      setMsgs(p => [...p, { role: "assistant", content: "Chyba. Skús znova." }]);
    }
    setLoading(false);
  }, [input, msgs, loading, samples, sel, channels, bpm, swing, stepCount, curPat, mode, execCmds, BASE]);

  const onCvD=(e: any)=>{if(!cur)return;if(!cvR.current)return;const r=cvR.current.getBoundingClientRect();sdR.current={s:(e.clientX-r.left)/r.width};setWfSel({start:sdR.current.s,end:sdR.current.s});};
  const onCvM=(e: any)=>{if(!sdR.current)return;if(!cvR.current)return;const r=cvR.current.getBoundingClientRect();const x=Math.max(0,Math.min(1,(e.clientX-r.left)/r.width));setWfSel({start:Math.min(sdR.current.s,x),end:Math.max(sdR.current.s,x)});};
  const onCvU=()=>{if(sdR.current&&wfSel&&wfSel.end-wfSel.start<.005)setWfSel(null);sdR.current=null;};

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
                <div style={{fontSize:9,color:th.txD}}>{ft(s.info.duration)}{s.info.bpm?` ${s.info.bpm}bpm`:''}{s.tag?<span style={{marginLeft:4,background:s.color+'33',color:s.color,padding:'1px 4px',borderRadius:3,fontSize:8}}>{s.tag}</span>:null}</div>
              </div>
              <button onClick={()=>setRenameTarget({idx:i,name:s.name})} style={{background:'none',border:'none',color:th.txD,cursor:'pointer',fontSize:10,padding:'2px 3px',borderRadius:3}} title="Premenovať">✎</button>
              <button onClick={()=>addCh(i)} title="Add to Sequencer" style={{background:'none',border:'none',color:th.ac2,cursor:'pointer',fontSize:10,fontWeight:600,padding:4,borderRadius:3}}>+SEQ</button>
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
        {cur&&<div style={{display:'flex',gap:4,padding:'6px 8px',borderBottom:`1px solid ${th.bd}`,flexShrink:0,background:th.bgD}}>
          <button style={sb(false,null,th)} onClick={()=>{const ctx=getCtx();const b=trimSil(cur.buffer,ctx);setSamples(p=>p.map((s,i)=>i===sel?{...s,buffer:b,info:analyze(b)}:s));}}>Trim Silence</button>
          {wfSel&&<button style={sb(false,null,th)} onClick={()=>{const ctx=getCtx();const b=cropR(cur.buffer,wfSel.start,wfSel.end,ctx);setSamples(p=>p.map((s,i)=>i===sel?{...s,buffer:b,info:analyze(b)}:s));setWfSel(null);}}>Crop Selection</button>}
          <button style={sb(true,th.ac2,th)} onClick={()=>{const ctx=getCtx();const r=wfSel||{start:0,end:Math.min(1,1/cur.buffer.duration)};const b=cropR(cur.buffer,r.start,r.end,ctx);addSample(cur.name+'_clip',b);setWfSel(null);setLog(p=>[...p,`✓ Krátky zvuk "${cur.name}_clip" (${ft(b.duration)})`]);}} title="Vytvor krátky zvuk z výberu (alebo prvá 1s) a pridaj do knižnice">Create Sound</button>
          {wfSel&&<button style={sb(false,null,th)} onClick={()=>{const ctx=getCtx();const t=wfSel.start*cur.buffer.duration;const[a,b2]=splitAt(cur.buffer,t,ctx);const nm=cur.name;setSamples(p=>{const n=[...p];n[sel as number]={...n[sel as number],name:nm+'_A',buffer:a,info:analyze(a)};n.push({name:nm+'_B',buffer:b2,info:analyze(b2),original:b2});return n;});setWfSel(null);setLog(p=>[...p,`▸ Split "${nm}" @ ${t.toFixed(2)}s`]);}}>Split Here</button>}
          <button style={sb(false,null,th)} onClick={()=>{if(samples.length<2)return;const ctx=getCtx();const bufs=samples.map(s=>s.buffer);const merged=mergeBufs(bufs,[],ctx);addSample('Merged_'+Date.now()%10000,merged);setLog(p=>[...p,`▸ Merge all → nová vzorka`]);}}>Merge All</button>
          <button style={sb(false,null,th)} onClick={()=>{const ctx=getCtx();const b=applyFx(cur.buffer,{normalize:true},ctx);setSamples(p=>p.map((s,i)=>i===sel?{...s,buffer:b,info:analyze(b)}:s));}}>Normalize</button>
          <button style={sb(false,null,th)} onClick={()=>{const ctx=getCtx();const b=applyFx(cur.buffer,{reverse:true},ctx);setSamples(p=>p.map((s,i)=>i===sel?{...s,buffer:b,info:analyze(b)}:s));}}>Reverse</button>
          <button style={sb(false,null,th)} onClick={()=>{const nm=cur.name+'_dup';setSamples(p=>[...p,{...cur,name:nm}]);setSel(samples.length);}}>Duplicate</button>
          <button style={sb(false,null,th)} onClick={()=>setSamples(p=>p.map((s,i)=>i===sel?{...s,buffer:s.original,info:analyze(s.original)}:s))}>Reset</button>
          <button style={sb(false,null,th)} onClick={()=>doExport()}>Export Sample</button>
        </div>}

        {/* Tabs */}
        <div style={{display:'flex',borderBottom:`1px solid ${th.bd}`,flexShrink:0,background:th.bgP}}>
          {[['seq','SEQUENCER'],['fx','FX EDITOR'],['mix','MIXER'],['chat','AI ASSISTANT'],['log','LOGS']].map(([k,l])=>(
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
              {channels.map((ch:any,ci:number)=>{const s=samples[ch.sampleIdx];const col=cols[ci%cols.length];
                return(
                <div key={ci} style={{marginBottom:4}}>
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
                        <button onClick={()=>updCh(ci,'solo',!ch.solo)} style={{...sb(ch.solo,th.ac2,th),fontSize:9,padding:'1px 5px'}}>S</button>
                      </div>
                      {isTK&&<div style={{display:'flex',gap:3}}>
                        <button onClick={()=>updCh(ci,'isKick',!ch.isKick)} style={{...sb(ch.isKick,th.ac3,th),fontSize:8,padding:'1px 5px',flex:1}} title="Kick (zdroj sidechain)">KICK</button>
                        <button onClick={()=>updCh(ci,'sidechain',!ch.sidechain)} style={{...sb(ch.sidechain,'#ff006644',th),fontSize:8,padding:'1px 5px',flex:1}} title="Sidechain duck">SC</button>
                      </div>}
                    </div>
                    {/* Steps (right) */}
                    <div style={{display:'flex',gap:2,flex:1}}>
                      {ch.steps.slice(0,stepCount).map((on:boolean,si:number)=>{
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
                      <div><div style={{fontSize:9,color:th.txD,marginBottom:2}}>Pitch</div><input type="range" min={.25} max={4} step={.01} value={ch.pitch} onChange={e=>updCh(ci,'pitch',+e.target.value)} style={{width:'100%',accentColor:col}}/><div style={{fontSize:9,color:th.txD,textAlign:'center'}}>{ch.pitch.toFixed(2)}x</div></div>
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

        {/* FX EDITOR — manual editing of the selected sample */}
        {panel==='fx'&&(
          <div style={{flex:1,overflow:'auto',padding:16,background:th.bg}}>
            {!cur&&<div style={{textAlign:'center',color:th.txD,marginTop:32,fontSize:12}}>Vyber vzorku v knižnici vľavo (alebo nahraj / vytvor zvuk), potom ju tu uprav efektmi, hlasitosťou a dĺžkou.</div>}
            {cur&&<div style={{maxWidth:680,margin:'0 auto'}}>
              <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:14}}>
                <span style={{fontSize:13,fontWeight:700,color:th.ac}}>{cur.name}</span>
                <span style={{fontSize:11,color:th.txD}}>{ft(cur.info.duration)} · {cur.info.ch}ch</span>
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
                ] as [string,string,keyof typeof fx,number,number,number][]).map(([label,val,key,min,max,step])=>(
                  <div key={key} style={{background:th.bgD,border:`1px solid ${th.bd}`,borderRadius:6,padding:'8px 10px'}}>
                    <div style={{display:'flex',justifyContent:'space-between',marginBottom:6}}>
                      <span style={{fontSize:10,fontWeight:600,color:th.txD,textTransform:'uppercase',letterSpacing:1}}>{label}</span>
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
