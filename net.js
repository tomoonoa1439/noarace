// =====================================================================
// NOA競馬 ネットワーク層（Firebase / GitHub Pages版）
//  - マスター（中央管理）：NOA総量1,000万を管理。すべての出入りを記帳
//  - プレイヤー情報・ランキング・送金（手数料5%）
//  - オンラインレース：エントリー共有・抽選・パリミュチュエル（控除20%）
//  - ホースマーケット：プレイヤー同士の売買（手数料10%）
//  - 運用アカウント（BOT）20個：マスターが自動運用
// Sparkプラン（サーバー処理なし）のため、処理は「開いている誰かの端末」が順番に代行する。
// =====================================================================
(function(){
const db=firebase.firestore(), FV=firebase.firestore.FieldValue, inc=n=>FV.increment(Math.round(n));
const TOTAL=10000000, BOT_N=20, BOT_CAP=200000, BOT_FLOOR=30000, BOT_REFILL=100000, RAKE=0.2, SEND_FEE=0.05, MKT_FEE_N=0.1;
const TICK_MS=4*60e3;
const now=()=>Date.now();
const esc=s=>String(s==null?'':s).replace(/[<>&"]/g,c=>({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;'}[c]));
const rid=()=>now().toString(36)+Math.floor(Math.random()*1e6).toString(36);
const codeOf=uid=>{ let h=hash(uid+'code'), s=''; const A='ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; for(let i=0;i<6;i++){ s+=A[h%A.length]; h=Math.floor(h/A.length)^hash(s+uid); h=Math.abs(h); } return s; };
const BOT_NAMES=['北斗ファーム','白樺牧場','青葉レーシング','紅葉ホースクラブ','銀河ステーブル','富士見ファーム','星川レーシング','ひまわり牧場','湖畔ステーブル','月影ファーム','ネオン厩舎','クロノス牧場','オリオンレーシング','桜坂ステーブル','雷鳴ファーム','蒼穹レーシング','翡翠牧場','極光ステーブル','流星ファーム','プリズム厩舎'];
const PERSONA=[['steady','堅実派'],['longshot','大穴狙い'],['breeder','育成重視'],['trader','転売屋']];

const NET=window.NET={on:false,uid:null,name:'',code:'',master:null,mult:1,ratio:1,lastBal:null,p2pAcc:0,dirty:false,fields:{},pools:{},poolAt:{},rank:[],botsCache:null,
  // ------------------------------------------------ 起動
  async start(user){
    this.uid=user.uid; this.code=codeOf(user.uid);
    await this.ensureMaster();
    const me=await db.doc('players/'+this.uid).get();
    if(me.exists){ const d=me.data(); this.name=d.name||user.displayName||'プレイヤー'; this.lastBal=+d.balance||0; }
    else { this.name=(user.displayName||'プレイヤー').slice(0,16); this.lastBal=0; }
    this.on=true; this.dirty=true; await this.flush();
    hookGame();
    await this.applyInbox();
    setInterval(()=>this.flush().catch(()=>{}),5000);
    setInterval(()=>this.applyInbox().catch(()=>{}),30000);
    setInterval(()=>this.refreshMaster().catch(()=>{}),120000);
    setInterval(()=>this.tryTick().catch(e=>console.warn('tick',e)),60000);
    setTimeout(()=>this.tryTick().catch(e=>console.warn('tick',e)),4000);
    try{ if($('#s-online').classList.contains('active')) renderOnline(); if($('#s-farm').classList.contains('active')) renderFarm(); }catch(e){}
  },
  async ensureMaster(){ const ref=db.doc('master/bank');
    await db.runTransaction(async t=>{ const s=await t.get(ref); if(!s.exists) t.set(ref,{total:TOTAL,balance:TOTAL,created:now()}); });
    await this.refreshMaster(); },
  async refreshMaster(){ const s=await db.doc('master/bank').get(); if(!s.exists) return; this.master=s.data(); this.ratio=this.master.balance/this.master.total;
    this.mult=this.ratio>=0.5?1:this.ratio>=0.3?0.8:this.ratio>=0.1?0.6:0.4; },
  // ------------------------------------------------ 記帳
  // 通常の増減はマスターとの取引。p2p（送金・馬券プール・マーケット）はマスターを通らない
  async flush(){ if(!this.on||this.busy) return; const bal=balance, d=bal-this.lastBal-this.p2pAcc;
    if(!d&&!this.dirty&&this.lastBal===bal) return; this.busy=true; const p2p=this.p2pAcc;
    try{ const b=db.batch();
      b.set(db.doc('players/'+this.uid),{name:this.name,code:this.code,balance:bal,stats:myStats(),updated:now(),bot:false},{merge:true});
      if(d) b.update(db.doc('master/bank'),{balance:inc(-d)});
      await b.commit(); this.lastBal=bal; this.p2pAcc-=p2p; this.dirty=false; if(d&&this.master) this.master.balance-=d;
    }catch(e){ console.warn('flush',e); } this.busy=false; },
  p2p(delta){ this.p2pAcc+=Math.round(delta); },
  async applyInbox(){ if(!this.on) return; const q=await db.collection('players/'+this.uid+'/inbox').get(); if(!q.docs.length) return;
    for(const d of q.docs){ const x=d.data(); try{ await d.ref.delete(); }catch(e){ continue; }
      const amt=Math.round(+x.amt||0); if(amt){ this.p2p(amt); setBal(balance+amt); }
      toast(`<i class="ic ic-coin"></i> ${esc(x.msg||'NOAを受け取りました')}　+${fmt(amt)} NOA`); }
    this.flush(); },
  // ------------------------------------------------ 送金
  async send(code,amt,msg){ amt=Math.round(amt/100)*100; if(!(amt>=100)) throw new Error('100 NOA以上で送金してください'); if(amt>balance) throw new Error('NOAが足りません');
    const q=await db.collection('players').where('code','==',code.toUpperCase()).get(); const to=q.docs[0]; if(!to) throw new Error('そのフレンドコードの人が見つかりません'); if(to.id===this.uid) throw new Error('自分には送れません');
    const get=Math.floor(amt*(1-SEND_FEE)), fee=amt-get;
    const b=db.batch(); b.set(db.collection('players/'+to.id+'/inbox').doc(rid()),{amt:get,kind:'transfer',from:this.name,msg:`${this.name} さんから送金${msg?'「'+msg.slice(0,40)+'」':''}`,t:now()});
    b.update(db.doc('master/bank'),{balance:inc(fee)}); await b.commit();
    this.p2p(-amt); setBal(balance-amt); if(this.master) this.master.balance+=fee; this.flush(); return {to:to.data().name,get,fee}; },
  // ------------------------------------------------ ランキング
  async loadRank(){ const [p,b]=await Promise.all([db.collection('players').get(),db.collection('bots').get()]);
    this.rank=[...p.docs.map(d=>({id:d.id,...d.data()})),...b.docs.map(d=>({id:d.id,...d.data(),bot:true}))].sort((a,b)=>b.balance-a.balance);
    this.supply={players:p.docs.reduce((a,d)=>a+(+d.data().balance||0),0),bots:b.docs.reduce((a,d)=>a+(+d.data().balance||0),0)}; return this.rank; },
  // ------------------------------------------------ オンラインレース
  deadline(key){ return onlineSpec(key).post-15*60e3; },
  async ensure(key,force){ const sp=onlineSpec(key), ph=onPhase(sp);
    if(this.fields[key]&&this.fields[key].frozen&&!force) return this.fields[key];
    const q=await db.collection('online/'+key+'/entries').get(), dl=this.deadline(key);
    let ents=q.docs.map(d=>({id:d.id,...d.data()})).filter(e=>{ const ts=e.ts&&e.ts.toMillis?e.ts.toMillis():e.t; return ts<=dl+5000; }).sort((a,b)=>a.id<b.id?-1:1);
    if(ents.length>16){ const R=rng(hash(key+'lottery')); for(let i=ents.length-1;i>0;i--){ const j=Math.floor(R()*(i+1)); [ents[i],ents[j]]=[ents[j],ents[i]]; } ents=ents.slice(0,16).sort((a,b)=>a.id<b.id?-1:1); }
    const frozen=Date.now()>dl+20000; const F={frozen,all:ents,mine:ents.some(e=>e.id===this.uid),ents:ents.map(e=>({snap:e.snap,owner:e.name,uid:e.id,bot:!!e.bot}))};
    if(ph==='entry'||ph==='entry2') F.frozen=false; this.fields[key]=F; return F; },
  fieldOf(key){ return this.fields[key]||null; },
  comboKey(type,c){ const u=['fuku','umaren','wide','trio'].includes(type)||type==='tan'; return type+':'+(u?c.slice().sort((a,b)=>a-b):c).join('-'); },
  winKeys(type,ord){ const [a,b,c]=ord, S=x=>x.slice().sort((p,q)=>p-q).join('-');
    switch(type){ case 'tan': return ['tan:'+a]; case 'fuku': return [a,b,c].map(x=>'fuku:'+x); case 'umaren': return ['umaren:'+S([a,b])];
      case 'wide': return [S([a,b]),S([a,c]),S([b,c])].map(x=>'wide:'+x); case 'umatan': return [`umatan:${a}-${b}`]; case 'trio': return ['trio:'+S([a,b,c])]; case 'tierce': return [`tierce:${a}-${b}-${c}`]; } return []; },
  async loadPool(key,force){ if(!force&&this.pools[key]&&(now()-this.poolAt[key]<20000||this.pools[key].final)) return this.pools[key];
    const q=await db.collection('online/'+key+'/bets').get(); const P={bets:[],stake:{},tot:{},final:now()>onlineSpec(key).post-5*60e3+20000};
    P.all=0; q.docs.forEach(d=>{ const x=d.data(); (x.items||[]).forEach(it=>P.all+=it.amount*it.keys.length); if((x.t||0)>onlineSpec(key).post-5*60e3+15000) return; P.bets.push({id:d.id,...x}); (x.items||[]).forEach(it=>it.keys.forEach(k=>{ P.stake[k]=(P.stake[k]||0)+it.amount; const ty=k.split(':')[0]; P.tot[ty]=(P.tot[ty]||0)+it.amount; })); });
    this.pools[key]=P; this.poolAt[key]=now(); return P; },
  // 1口あたりの払戻倍率（確定）
  payRate(P,type,ord,key){ const ks=this.winKeys(type,ord), net=(P.tot[type]||0)*(1-RAKE), share=net/ks.length; return ks.includes(key)&&P.stake[key]?share/P.stake[key]:0; },
  payoutOf(P,items,ord){ let s=0; (items||[]).forEach(it=>it.keys.forEach(k=>{ const ty=k.split(':')[0], r=this.payRate(P,ty,ord,k); if(r) s+=Math.floor(it.amount*r/10)*10; })); return s; },
  estOdds(key,type,c){ const P=this.pools[key]; if(!P) return null; const k=this.comboKey(type,c), st=P.stake[k], tot=P.tot[type]||0; if(!st||tot<1000) return null;
    const div=type==='fuku'||type==='wide'?3:1; return Math.max(1,Math.floor(tot*(1-RAKE)/div/st*10)/10); },
  wrapOdds(key,base){ const self=this; const W={get(type,picks){ const e=self.estOdds(key,type,picks); return e==null?base.get(type,picks):e; }};
    try{ if(RACE&&RACE.hs) RACE.hs.forEach((h,i)=>{ const e=self.estOdds(key,'tan',[i]); if(e!=null) h.odds=e; }); }catch(e){}
    return W; },
  slipItems(sl){ return sl.map(b=>({type:b.type,amount:b.amount,keys:b.combos.map(c=>this.comboKey(b.type,c))})); },
  async placeBets(key,sl){ const items=this.slipItems(sl), tot=items.reduce((a,it)=>a+it.amount*it.keys.length,0);
    await db.collection('online/'+key+'/bets').doc(this.uid+'_'+rid()).set({uid:this.uid,name:this.name,items,t:now(),ts:FV.serverTimestamp()});
    this.p2p(-tot); delete this.pools[key]; return tot; },
  async enter(key,h){ await db.doc('online/'+key+'/entries/'+this.uid).set({name:this.name,snap:h,t:now(),ts:FV.serverTimestamp(),bot:false}); delete this.fields[key]; },
  async unenter(key){ await db.doc('online/'+key+'/entries/'+this.uid).delete(); delete this.fields[key]; },
  // ------------------------------------------------ ホースマーケット（プレイヤー同士）
  mk:[], mkAt:0,
  async loadMarket(force){ if(!force&&now()-this.mkAt<15000) return this.mk; const q=await db.collection('market').where('t0','>=',now()-4*86400e3).get();
    this.mk=q.docs.map(d=>({id:d.id,...d.data()})); this.mkAt=now(); return this.mk; },
  async settleListing(id){ const ref=db.doc('market/'+id); return db.runTransaction(async t=>{ const s=await t.get(ref); if(!s.exists) return; const L=s.data(); if(L.status!=='open'||now()<L.ends) return;
      if(L.high){ t.update(ref,{status:'sold',closed:now()}); creditSale(t,L,L.high.amt); } else t.update(ref,{status:'expired',closed:now()}); }); },
  async bid(id,amt,buy){ const ref=db.doc('market/'+id); let res=null;
    await db.runTransaction(async t=>{ const s=await t.get(ref); if(!s.exists) throw new Error('出品が見つかりません'); const L=s.data();
      if(L.status!=='open'||now()>=L.ends) throw new Error('このオークションは終了しました'); if(L.seller===this.uid) throw new Error('自分の出品には入札できません');
      const mn=L.high?L.high.amt+mktStep(L.high.amt):L.start; if(buy) amt=L.buyout; amt=Math.min(Math.round(amt/100)*100,L.buyout); if(amt<mn) throw new Error(`${fmt(mn)} NOA以上で入札してください`);
      const myPrev=L.high&&L.high.uid===this.uid?L.high.amt:0; if(balance+myPrev<amt) throw new Error('NOAが足りません');
      if(L.high) refundBid(t,L.high,L.horse.name);
      const upd={high:{uid:this.uid,name:this.name,amt,t:now()},bids:(L.bids||[]).concat([{name:this.name,amt,t:now()}]).slice(-12)};
      if(amt>=L.buyout){ upd.status='sold'; upd.closed=now(); creditSale(t,L,amt); }
      t.update(ref,upd); res={amt,myPrev,sold:amt>=L.buyout}; });
    // 預かり（p2p）。前回の自分の入札分は返金ドキュメントで戻る
    this.p2p(-res.amt); setBal(balance-res.amt); this.flush(); this.mkAt=0; return res; },
  async list(h,start){ const est=horseValue(h), cap=mktCapOf(est); if(start>cap) throw new Error(`推定売却額の140%（${fmt(cap)} NOA）を超える金額は登録できません`);
    const id='L'+rid(); await db.doc('market/'+id).set({seller:this.uid,sellerName:this.name,horse:JSON.parse(JSON.stringify(h)),est,start,buyout:cap,t0:now(),ends:now()+MKT_DUR,status:'open',bids:[],high:null,claimed:false});
    h.listed=id; saveStable(); this.mkAt=0; return id; },
  async cancel(id){ const ref=db.doc('market/'+id); await db.runTransaction(async t=>{ const s=await t.get(ref); const L=s.data(); if(L.status!=='open'||L.high) throw new Error('入札が入っている出品は取り下げできません'); t.update(ref,{status:'cancel',closed:now()}); });
    const h=stable.find(x=>x.listed===id); if(h){ delete h.listed; saveStable(); } this.mkAt=0; },
  // 自分に関係する出品の後処理（売れた馬を手放す・落札した馬を受け取る）
  async reconcileMarket(){ const L=await this.loadMarket(); let ch=false;
    for(const x of L){
      if(x.status==='open'&&now()>=x.ends){ try{ await this.settleListing(x.id); ch=true; }catch(e){} continue; }
      if(x.seller===this.uid){ const h=stable.find(s=>s.listed===x.id);
        if(h&&x.status==='sold'){ stable=stable.filter(s=>s!==h); saveStable(); toast(`マーケット：${esc(h.name)} が ${esc(x.high.name)} さんに ${fmt(x.high.amt)} NOA で落札されました（代金は手数料10%を引いて届きます）`); ch=true; }
        if(h&&(x.status==='expired'||x.status==='cancel')){ delete h.listed; saveStable(); if(x.status==='expired') toast(`マーケット：${esc(h.name)} は入札がなく、出品期間が終了しました`); ch=true; } }
      if(x.status==='sold'&&x.high&&x.high.uid===this.uid&&!x.claimed){ const ref=db.doc('market/'+x.id); let ok=false;
        await db.runTransaction(async t=>{ const s=await t.get(ref); if(s.data().claimed) return; t.update(ref,{claimed:true}); ok=true; }).catch(()=>{});
        if(ok){ const h=JSON.parse(JSON.stringify(x.horse)); h.id='b'+rid(); h.retired=true; delete h.listed; h.bought={from:x.sellerName,price:x.high.amt}; stable.push(h); saveStable(); toast(`マーケット：${esc(h.name)} を ${fmt(x.high.amt)} NOA で落札！ 厩舎に加わりました`); ch=true; } } }
    if(ch){ this.mkAt=0; } return ch; },
  // ------------------------------------------------ マスターの自動処理（誰かの端末が4分ごとに代行）
  async tryTick(){ if(!this.on) return; const ref=db.doc('meta/tick'); let mine=false;
    await db.runTransaction(async t=>{ const s=await t.get(ref); const last=s.exists?s.data().last:0; if(now()-last<TICK_MS) return; t.set(ref,{last:now(),by:this.uid}); mine=true; });
    if(!mine) return; await this.refreshMaster(); await masterTick(); await this.refreshMaster(); }
};

// ---------------------------------------------------------------- 取引ヘルパー（トランザクション内）
function refundBid(t,hi,name){ if(hi.uid.startsWith('bot_')) t.update(db.doc('bots/'+hi.uid),{balance:inc(hi.amt)});
  else t.set(db.collection('players/'+hi.uid+'/inbox').doc(rid()),{amt:hi.amt,kind:'refund',msg:`マーケット：${name} で競り負け、入札額を返金`,t:now()}); }
function creditSale(t,L,amt){ const get=Math.floor(amt*(1-MKT_FEE_N)), fee=amt-get;
  if(L.seller.startsWith('bot_')) t.update(db.doc('bots/'+L.seller),{balance:inc(get)});
  else t.set(db.collection('players/'+L.seller+'/inbox').doc(rid()),{amt:get,kind:'sale',msg:`マーケット：${L.horse.name} が ${fmt(amt)} NOA で落札（手数料10%差引）`,t:now()});
  t.update(db.doc('master/bank'),{balance:inc(fee)}); }
function myStats(){ const st=stable||[]; return {wins:st.reduce((a,h)=>a+(h.wins||0),0),g1w:st.reduce((a,h)=>a+(h.g1w||0),0),earn:(typeof gstat!=='undefined'&&gstat.earn)||0,horses:st.filter(h=>!h.retired).length}; }

// ---------------------------------------------------------------- 運用アカウント
function botHorse(R,lvl){ const S=ROSTER.filter(m=>m[1]==='牡'), D=ROSTER.filter(m=>m[1]==='牝');
  const f=makeFoal(parentObj(S[Math.floor(R()*S.length)]),parentObj(D[Math.floor(R()*D.length)]),R);
  f.id='bh'+rid(); f.name=NPC_NM1[Math.floor(R()*NPC_NM1.length)]+NPC_NM2[Math.floor(R()*NPC_NM2.length)];
  STATS_ALL.forEach(([k])=>f.st[k]=+(f.cap[k]*(lvl||0.8)).toFixed(1)); f.st.hp=f.cap.hp; f.age=3+Math.floor(R()*3); f.races=5+Math.floor(R()*10); f.wins=Math.floor(R()*4); return f; }
async function ensureBots(){ const q=await db.collection('bots').get(); const have=new Set(q.docs.map(d=>d.id)); const b=db.batch(); let made=0;
  for(let i=0;i<BOT_N;i++){ const id='bot_'+String(i+1).padStart(2,'0'); if(have.has(id)) continue; const R=rng(hash(id+'seed'));
    b.set(db.doc('bots/'+id),{name:BOT_NAMES[i],persona:PERSONA[i%4][0],balance:BOT_REFILL,horses:[botHorse(R,0.78),botHorse(R,0.82)],bot:true,created:now()}); made++; }
  if(made){ b.update(db.doc('master/bank'),{balance:inc(-BOT_REFILL*made)}); await b.commit(); }
  const q2=made?await db.collection('bots').get():q; return q2.docs.map(d=>({id:d.id,...d.data()})); }
async function masterTick(){
  const bots=await ensureBots(); const t=now(), keys=onlineDayKeys();
  for(const key of keys){ const sp=onlineSpec(key), ph=onPhase(sp);
    // エントリー
    if(ph==='entry'||ph==='entry2'){ const ex=await db.collection('online/'+key+'/entries').get(); const has=new Set(ex.docs.map(d=>d.id)); const b=db.batch(); let n=0;
      bots.forEach(bt=>{ if(has.has(bt.id)) return; const R=rng(hash(bt.id+key)); if(R()>0.5) return; const h=(bt.horses||[])[Math.floor(R()*(bt.horses||[]).length)]; if(!h) return;
        b.set(db.doc('online/'+key+'/entries/'+bt.id),{name:bt.name,snap:h,t:now(),ts:FV.serverTimestamp(),bot:true}); n++; });
      if(n) await b.commit(); }
    // 馬券
    if(ph==='bet'){ await NET.ensure(key,true); const P=await NET.loadPool(key,true); const did=new Set(P.bets.map(x=>x.uid)); const R0=onlineRace(key);
      const fav=R0.hs.map((h,i)=>({i,o:h.odds})).sort((a,b)=>a.o-b.o); const b=db.batch(); let n=0;
      for(const bt of bots){ if(did.has(bt.id)) continue; const R=rng(hash(bt.id+key+'bet')); if(R()>0.6) continue;
        const amt=Math.max(500,Math.round(bt.balance*(0.01+R()*0.03)/100)*100); if(amt>bt.balance*0.3) continue; let items;
        if(bt.persona==='steady') items=[{type:'fuku',amount:amt,keys:[NET.comboKey('fuku',[fav[0].i])]}];
        else if(bt.persona==='longshot'){ const ls=fav.filter(x=>x.o>=10&&x.o<=60); const p=ls[Math.floor(R()*ls.length)]||fav[fav.length-1]; items=[{type:'tan',amount:amt,keys:[NET.comboKey('tan',[p.i])]}]; }
        else if(bt.persona==='breeder'){ items=[{type:'tan',amount:amt,keys:[NET.comboKey('tan',[fav[Math.floor(R()*3)].i])]}]; }
        else { const half=Math.max(100,Math.round(amt/2/100)*100); items=[{type:'wide',amount:half,keys:[NET.comboKey('wide',[fav[0].i,fav[1].i]),NET.comboKey('wide',[fav[0].i,fav[2].i])]}]; }
        const cost=items.reduce((a,it)=>a+it.amount*it.keys.length,0);
        b.set(db.collection('online/'+key+'/bets').doc(bt.id+'_'+rid()),{uid:bt.id,name:bt.name,items,t:now(),ts:FV.serverTimestamp(),bot:true}); b.update(db.doc('bots/'+bt.id),{balance:inc(-cost)}); n++; }
      if(n) await b.commit(); }
    // 精算（マスターの取り分・BOTの払戻と賞金）
    if(t>=sp.post+30e3){ const ref=db.doc('online/'+key), s=await ref.get(); if(s.exists&&s.data().raked) continue;
      await NET.ensure(key,true); const P=await NET.loadPool(key,true); const o=onlineOutcomeNet(key); if(!o) continue;
      let paid=0; const botPay={}; P.bets.forEach(x=>{ const p=NET.payoutOf(P,x.items,o.ord); paid+=p; if(x.uid.startsWith('bot_')&&p) botPay[x.uid]=(botPay[x.uid]||0)+p; });
      const pool=P.all||0, rake=pool-paid; let botPrize=0; const bp={};
      Object.entries(o.netPlaces||{}).forEach(([uid,pl])=>{ if(!uid.startsWith('bot_')) return; const pr=ON_FEE+Math.round((ON_PRIZE[pl-1]||0)*(sp.legend?2:1)*NET.mult); bp[uid]=pr; botPrize+=pr; });
      let ok=false; await db.runTransaction(async tx=>{ const s2=await tx.get(ref); if(s2.exists&&s2.data().raked) return; tx.set(ref,{raked:true,pool,paid,rake,winner:o.names[0],t:now()},{merge:true});
        tx.update(db.doc('master/bank'),{balance:inc(rake-botPrize)}); Object.keys({...botPay,...bp}).forEach(id=>tx.update(db.doc('bots/'+id),{balance:inc((botPay[id]||0)+(bp[id]||0))})); ok=true; }).catch(e=>console.warn(e)); }
  }
  // マーケット：期限切れの精算・BOTの出品と入札
  const L=await NET.loadMarket(true); for(const x of L){ if(x.status==='open'&&t>=x.ends){ try{ await NET.settleListing(x.id); }catch(e){} } }
  const openBot=L.filter(x=>x.status==='open'&&x.seller.startsWith('bot_')&&t<x.ends).length;
  for(let k=openBot;k<4;k++){ const bt=bots[Math.floor(Math.random()*bots.length)], R=rng(hash(bt.id+t+k)), h=mktNpcHorse(R), est=horseValue(h), cap=mktCapOf(est);
    await db.doc('market/L'+rid()).set({seller:bt.id,sellerName:bt.name,horse:h,est,start:Math.min(cap,Math.max(1000,Math.round(est*(0.85+R()*0.4)/100)*100)),buyout:cap,t0:t,ends:t+MKT_DUR,status:'open',bids:[],high:null,claimed:false}); }
  for(const x of L){ if(x.status!=='open'||t>=x.ends||x.seller.startsWith('bot_')) continue;
    for(const bt of bots){ const R=rng(hash(bt.id+x.id)); const val=Math.round(x.est*(0.7+R()*0.78)/100)*100; const mn=x.high?x.high.amt+mktStep(x.high.amt):x.start;
      if(x.high&&x.high.uid===bt.id) continue; if(R()>0.25) continue; if(val<mn||bt.balance<Math.min(val,x.buyout)) continue;
      const amt=val>=x.buyout?x.buyout:Math.min(val,mn+mktStep(mn)); const ref=db.doc('market/'+x.id);
      await db.runTransaction(async tx=>{ const s=await tx.get(ref); const Lx=s.data(); if(Lx.status!=='open') return; const mn2=Lx.high?Lx.high.amt+mktStep(Lx.high.amt):Lx.start; if(amt<mn2) return;
        if(Lx.high) refundBid(tx,Lx.high,Lx.horse.name); const upd={high:{uid:bt.id,name:bt.name,amt,t:now()},bids:(Lx.bids||[]).concat([{name:bt.name,amt,t:now()}]).slice(-12)};
        if(amt>=Lx.buyout){ upd.status='sold'; upd.closed=now(); creditSale(tx,Lx,amt); } tx.update(ref,upd); tx.update(db.doc('bots/'+bt.id),{balance:inc(-amt)}); }).catch(()=>{}); break; } }
  // BOTが落札した馬は受け取り扱い（BOTの厩舎には入れない）
  for(const x of L){ if(x.status==='sold'&&x.high&&x.high.uid.startsWith('bot_')&&!x.claimed){ await db.doc('market/'+x.id).update({claimed:true}).catch(()=>{}); } }
  // 財布の上限・補充、馬の成長
  const q=await db.collection('bots').get(); const b=db.batch(); let md=0;
  q.docs.forEach(d=>{ const x=d.data(); let bal=x.balance; const upd={};
    if(bal>BOT_CAP){ md+=bal-BOT_CAP; upd.balance=inc(-(bal-BOT_CAP)); } else if(bal<BOT_FLOOR){ md-=BOT_REFILL-bal; upd.balance=inc(BOT_REFILL-bal); }
    const day=jstDay(); if(x.grow!==day){ upd.grow=day; upd.horses=(x.horses||[]).map(h=>{ STATS.forEach(([k])=>h.st[k]=+Math.min(h.cap[k],h.st[k]+(h.cap[k]-h.st[k])*0.06).toFixed(1)); return h; }); }
    if(Object.keys(upd).length) b.update(d.ref,upd); });
  if(md) b.update(db.doc('master/bank'),{balance:inc(md)}); await b.commit();
}
function onlineOutcomeNet(key){ try{ const R=onlineRace(key), sR=RACE, sS=SIM; let out; try{ RACE=R; withSeed(hash(key)+7,()=>setupSim());
    out={order:SIM.order.map(i=>SIM.hs[i].no),names:SIM.order.slice(0,5).map(i=>SIM.hs[i].name),ord:SIM.order.slice(),netPlaces:Object.fromEntries(SIM.hs.filter(h=>h.netUid).map(h=>[h.netUid,SIM.order.indexOf(h.i)+1]))}; } finally{ RACE=sR; SIM=sS; } return out; }catch(e){ console.warn(e); return null; } }
NET.outcome=onlineOutcomeNet;

// ---------------------------------------------------------------- ゲームへの組み込み
function hookGame(){
  const _set=setBal; setBal=function(v,o){ _set(v,o); NET.dirty=true; };
  // オンライン：エントリー・馬券をサーバーへ
  const _entry=onlineEntry; onlineEntry=function(key){ _entry(key);
    document.querySelectorAll('[data-oeh]').forEach(b=>{ const f=b.onclick; b.onclick=async()=>{ const h=stable.find(x=>x.id===b.dataset.oeh); try{ await NET.enter(key,entrySnap(h)); }catch(e){ toast('エントリーできませんでした：'+e.message); return; } f(); }; });
    const c=$('#oeCancel'); if(c){ const f=c.onclick; c.onclick=async()=>{ try{ await NET.unenter(key); }catch(e){} f(); }; } };
  const _bet=onlineBet; onlineBet=async function(key){ try{ await NET.ensure(key,true); await NET.loadPool(key,true); }catch(e){ toast('オッズを読み込めませんでした'); } _bet(key); };
  const _watch=onlineWatch; onlineWatch=async function(key,live){ try{ await NET.ensure(key); }catch(e){} _watch(key,live); };
}
// オンラインの精算（自分の分）：パリミュチュエル払戻＋出走賞金
NET.settleMine=async function(key){ const sp=onlineSpec(key); if(now()<sp.post) return null; if(online.done[key]&&online.done[key].settled) return online.done[key];
  await this.ensure(key,true); const P=await this.loadPool(key,true); const o=onlineOutcomeNet(key); if(!o) return null;
  const mine=P.bets.filter(x=>x.uid===this.uid); let ret=0, spent=0; mine.forEach(x=>{ ret+=this.payoutOf(P,x.items,o.ord); x.items.forEach(it=>spent+=it.amount*it.keys.length); });
  const pl=(o.netPlaces||{})[this.uid]||0; let prize=0; if(pl) prize=Math.round((ON_FEE+(ON_PRIZE[pl-1]||0)*(sp.legend?2:1))*this.mult);
  if(ret){ this.p2p(ret); } setBal(balance+ret+prize);
  online.done[key]={...o,ownPlace:pl,settled:true,ret,spent,prize,drawn:!!pl||!online.entries[key]}; saveOnline();
  if(online.entries[key]&&!pl) toast(`オンライン${sp.hour}時：抽選に外れたため出走できませんでした`);
  if(ret||prize) toast(`オンライン${sp.hour}時のレース確定：払戻 ${fmt(ret)}・出走賞金 ${fmt(prize)} NOA`); this.flush(); return online.done[key]; };

// ---------------------------------------------------------------- 画面（オンラインタブ）
NET.renderTop=async function(){ const el=$('#netTop'); if(!el) return; const M=this.master||{balance:0,total:TOTAL}, r=M.balance/M.total;
  el.innerHTML=`<div class="net-grid">
   <div class="net-card"><small>MASTER</small><b>${fmt(Math.round(M.balance))} <span>NOA</span></b><div class="net-bar"><i style="width:${Math.max(0,Math.min(100,r*100)).toFixed(1)}%"></i></div><div class="hsub">総量 ${fmt(M.total)} のうち ${(r*100).toFixed(1)}% を保有・賞金倍率 <b class="gold">×${this.mult}</b>${this.mult<=0.4?'（ログインボーナス停止中）':''}</div></div>
   <div class="net-card"><small>YOU</small><b style="font-size:17px">${esc(this.name)}</b><div class="hsub">フレンドコード <b class="gold">${this.code}</b>　<a href="#" class="lnk" id="netRename">名前を変更</a></div></div></div>
   <div class="row" style="gap:8px;margin-top:8px"><button class="btn" id="netRankBtn"><i class="ic ic-trophy"></i> ランキング</button><button class="btn" id="netSendBtn"><i class="ic ic-coin"></i> 送金</button></div>`;
  $('#netRename').onclick=e=>{ e.preventDefault(); const n=prompt('表示名（16文字まで）',this.name); if(n&&n.trim()){ this.name=n.trim().slice(0,16); this.dirty=true; this.flush(); this.renderTop(); } };
  $('#netRankBtn').onclick=()=>this.openRank(); $('#netSendBtn').onclick=()=>this.openSend(); };
NET.openRank=async function(){ $('#resBox').innerHTML='<div class="win"><i class="ic ic-trophy"></i> ランキング</div><div class="sub">読み込み中…</div>'; $('#resModal').classList.add('on');
  try{ const R=await this.loadRank(); const S=this.supply, M=this.master;
    $('#resBox').innerHTML=`<div class="win"><i class="ic ic-trophy"></i> 所持金ランキング</div><div class="hsub">流通量：プレイヤー ${fmt(S.players)}・運用アカウント ${fmt(S.bots)}・マスター ${fmt(Math.round(M.balance))}（総量 ${fmt(M.total)}）</div>
    <table class="ent" style="margin-top:8px"><tr><th>#</th><th>名前</th><th class="num">所持金</th><th class="num">勝利</th></tr>${R.slice(0,40).map((x,i)=>`<tr class="${x.id===this.uid?'own':''}"><td>${i+1}</td><td>${esc(x.name)}${x.bot?' <span class="botmk">運用</span>':''}</td><td class="num">${fmt(Math.round(x.balance))}</td><td class="num">${x.stats?x.stats.wins||0:'-'}</td></tr>`).join('')}</table>
    <div class="row" style="justify-content:flex-end;margin-top:10px"><button class="btn gold" id="rkOk">閉じる</button></div>`; $('#rkOk').onclick=()=>$('#resModal').classList.remove('on');
  }catch(e){ $('#resBox').innerHTML=`<div class="sub">読み込めませんでした（${esc(e.message)}）</div><button class="btn gold" onclick="$('#resModal').classList.remove('on')">閉じる</button>`; } };
NET.openSend=function(){ $('#resBox').innerHTML=`<div class="win"><i class="ic ic-coin"></i> 送金</div><div class="sub">相手のフレンドコードを入力して、NOAを送ります。手数料5%はマスターへ（10,000送ると相手に9,500届きます）。</div>
    <label class="mk-in">フレンドコード <input id="sdCode" maxlength="6" style="width:110px;text-transform:uppercase" placeholder="ABC123"></label>
    <label class="mk-in">金額 <input type="number" id="sdAmt" step="100" min="100" value="1000"> NOA</label>
    <label class="mk-in">ひとこと <input id="sdMsg" maxlength="40" style="width:200px" placeholder="馬代です"></label>
    <div class="row" style="justify-content:flex-end;margin-top:12px"><button class="btn" id="sdNo">やめる</button><button class="btn gold" id="sdYes">送金する</button></div>`;
  $('#resModal').classList.add('on'); $('#sdNo').onclick=()=>$('#resModal').classList.remove('on');
  $('#sdYes').onclick=async()=>{ const b=$('#sdYes'); b.disabled=true; try{ const r=await this.send($('#sdCode').value.trim(),+$('#sdAmt').value,$('#sdMsg').value.trim()); $('#resModal').classList.remove('on'); toast(`${esc(r.to)} さんに ${fmt(r.get)} NOA を送金しました（手数料 ${fmt(r.fee)}）`); this.renderTop(); }catch(e){ toast(esc(e.message)); b.disabled=false; } }; };

// ---------------------------------------------------------------- マーケット画面（ネット版）
NET.renderMarket=async function(){ const el=$('#mktList'); if(!el) return; if(!this.mk.length) el.innerHTML='<span class="hsub">読み込み中…</span>';
  try{ const ch=await this.reconcileMarket(); if(ch){ renderFarm(); return; } }catch(e){ console.warn(e); }
  const L=this.mk.filter(x=>x.status==='open'&&now()<x.ends).sort((a,b)=>(b.seller===this.uid)-(a.seller===this.uid)||a.ends-b.ends);
  const left=x=>{ const m=Math.max(0,x.ends-now())/60e3; return m>=60?`残り${Math.floor(m/60)}時間${Math.floor(m%60)}分`:`残り${Math.ceil(m)}分`; };
  el.innerHTML=(L.length?L.map(x=>{ const h=x.horse, mine=x.seller===this.uid, meHi=x.high&&x.high.uid===this.uid;
    return `<div class="fcard mkt ${mine?'mine':''} ${meHi?'lead':''}"><div style="flex:1;min-width:0"><div>${rkBadge(h)} ${attrChip(attrOf(h),true)} <b>${esc(h.name)}</b> <span class="hsub">${h.sex==='牡'?'種牡馬':'繁殖牝馬'}・${h.age}歳・${h.races}戦${h.wins}勝${h.g1w?`・G1 ${h.g1w}勝`:''}</span></div>
      <div class="hsub">${mine?'<b class="gold">あなたの出品</b>':`出品者 ${esc(x.sellerName)}${x.seller.startsWith('bot_')?' <span class="botmk">運用</span>':''}`}・推定 ${fmt(x.est)}・${left(x)}</div>
      <div class="hsub">現在 <b class="${meHi?'plus':'gold'}">${x.high?fmt(x.high.amt)+(meHi?'（あなたが最高額）':'（'+esc(x.high.name)+'）'):'入札なし（開始 '+fmt(x.start)+'）'}</b>　即落札 ${fmt(x.buyout)}</div></div>
      <div class="mk-act"><button class="btn sm" data-nmv="${x.id}">詳細</button>${mine?(x.high?'':`<button class="btn sm" data-nmc="${x.id}">取り下げ</button>`):`<button class="btn sm gold" data-nmb="${x.id}">入札</button>`}</div></div>`; }).join(''):'<span class="hsub">出品はありません</span>');
  el.querySelectorAll('[data-nmv]').forEach(b=>b.onclick=()=>{ const x=this.mk.find(y=>y.id===b.dataset.nmv); viewHorse(x.horse,`出品者 ${esc(x.sellerName)}・推定売却額 ${fmt(x.est)}・開始 ${fmt(x.start)}・即落札 ${fmt(x.buyout)} NOA`); });
  el.querySelectorAll('[data-nmc]').forEach(b=>b.onclick=async()=>{ try{ await this.cancel(b.dataset.nmc); toast('出品を取り下げました'); renderFarm(); }catch(e){ toast(esc(e.message)); } });
  el.querySelectorAll('[data-nmb]').forEach(b=>b.onclick=()=>this.openBid(b.dataset.nmb)); };
NET.openBid=function(id){ const x=this.mk.find(y=>y.id===id); if(!x) return; const mn=x.high?x.high.amt+mktStep(x.high.amt):x.start;
  $('#resBox').innerHTML=`<div class="win"><i class="ic ic-hammer"></i> ${esc(x.horse.name)} に入札</div><div class="sub">出品者 ${esc(x.sellerName)}</div>
    <div class="ownres">現在 <b class="gold">${x.high?fmt(x.high.amt)+' NOA（'+esc(x.high.name)+'）':'入札なし'}</b>　最低入札額 <b>${fmt(mn)} NOA</b>　即落札 <b class="gold">${fmt(x.buyout)} NOA</b></div>
    <label class="mk-in">入札額 <input type="number" id="mkBid" min="${mn}" step="100" value="${Math.min(mn,x.buyout)}"> NOA</label>
    <div class="hsub">入札額は預かりになり、競り負けたら全額返金されます。即落札額以上ならその場で落札です。</div>
    <div class="wlog">${(x.bids||[]).slice(-6).reverse().map(b=>`${esc(b.name)}：${fmt(b.amt)} NOA`).join('<br>')||'まだ入札はありません'}</div>
    <div class="row" style="justify-content:flex-end;margin-top:12px"><button class="btn" id="mbNo">やめる</button><button class="btn" id="mbBuy">即落札 ${fmt(x.buyout)}</button><button class="btn gold" id="mbYes">入札する</button></div>`;
  $('#resModal').classList.add('on'); $('#mbNo').onclick=()=>$('#resModal').classList.remove('on');
  const go=async buy=>{ try{ const r=await this.bid(id,+$('#mkBid').value,buy); $('#resModal').classList.remove('on'); toast(r.sold?'即落札しました！ 馬が厩舎に届きます':`${fmt(r.amt)} NOA で入札しました`); renderFarm(); }catch(e){ toast(esc(e.message)); } };
  $('#mbBuy').onclick=()=>go(true); $('#mbYes').onclick=()=>go(false); };
NET.openList=function(id){ const h=stable.find(x=>x.id===id); if(!h||!h.retired||h.listed) return; const est=horseValue(h), cap=mktCapOf(est);
  $('#resBox').innerHTML=`<div class="win"><i class="ic ic-coin"></i> ${esc(h.name)} をマーケットに出品</div><div class="sub">推定売却額 <b class="gold">${fmt(est)} NOA</b>　みんなのマーケットに並びます</div>
    <label class="mk-in">開始価格 <input type="number" id="mkStart" min="1000" max="${cap}" step="100" value="${est}"> NOA</label>
    <div class="hsub">・開始価格は推定売却額の140%（<b>${fmt(cap)} NOA</b>）まで<br>・${fmt(cap)} NOA 以上の入札で即落札<br>・出品期間24時間。最高額の人が落札、入札なしなら手元に戻る<br>・落札されると馬のデータごと相手へ移籍（手数料10%はマスターへ）<br>・出品中は閲覧のみ</div>
    <div class="row" style="justify-content:flex-end;margin-top:14px"><button class="btn" id="mkNo">やめる</button><button class="btn gold" id="mkYes">出品する</button></div>`;
  $('#resModal').classList.add('on'); $('#mkNo').onclick=()=>$('#resModal').classList.remove('on');
  $('#mkYes').onclick=async()=>{ const v=Math.round(+$('#mkStart').value/100)*100; if(!(v>=1000)){ toast('開始価格は1,000 NOA以上にしてください'); return; }
    try{ await this.list(h,v); $('#resModal').classList.remove('on'); toast(`${esc(h.name)} を ${fmt(v)} NOA から出品しました`); renderFarm(); }catch(e){ toast(esc(e.message)); } }; };
})();
