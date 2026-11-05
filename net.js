// =====================================================================
// NOA競馬 ネットワーク層 v2（Firebase Sparkプラン向け・省エネ設計）
//  データ構成（すべて少数のドキュメントにまとめて読み書き回数を減らす）
//   master/v2            マスター（総量・残高）
//   meta/rank            全プレイヤーの行（名前・フレンドコード・所持金・成績）
//   meta/state           自動処理の記録（最後の代行時刻・精算済みレース）
//   bots/all             運用アカウント20個の財布
//   race/{key}           レース1つ＝1ドキュメント（エントリー・馬券の合計額・結果）
//   market/board         マーケット掲示板（出品中の馬すべて）
//   players/{uid}/inbox  受け取り箱（送金・売上・返金）
//  運用アカウントの出走・馬券・持ち馬は「レースごとに決まった計算」で全端末が同じ結果を出すため書き込み不要。
// =====================================================================
(function(){
const db=firebase.firestore(), FV=firebase.firestore.FieldValue, inc=n=>FV.increment(Math.round(n));
const TOTAL=10000000, BOT_N=20, BOT_CAP=200000, BOT_FLOOR=30000, BOT_REFILL=100000, RAKE=0.2, SEND_FEE=0.05, MKT_FEE_N=0.1;
const DAY_CAP=50000;
const FLUSH_MS=5*60e3, MAINT_MS=10*60e3, INBOX_MS=2*60e3, MASTER_MS=5*60e3, BOARD_MS=60e3, RANK_MS=5*60e3;
const now=()=>Date.now();
const esc=s=>String(s==null?'':s).replace(/[<>&"]/g,c=>({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;'}[c]));
const rid=()=>now().toString(36)+Math.floor(Math.random()*1e6).toString(36);
const codeOf=uid=>{ const A='ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; let s=''; for(let i=0;i<6;i++) s+=A[hash(uid+'code'+i)%A.length]; return s; };
const BOT_NAMES=['北斗ファーム','白樺牧場','青葉レーシング','紅葉ホースクラブ','銀河ステーブル','富士見ファーム','星川レーシング','ひまわり牧場','湖畔ステーブル','月影ファーム','ネオン厩舎','クロノス牧場','オリオンレーシング','桜坂ステーブル','雷鳴ファーム','蒼穹レーシング','翡翠牧場','極光ステーブル','流星ファーム','プリズム厩舎'];
const PERSONA=['steady','longshot','breeder','trader'];
const BOTS=Array.from({length:BOT_N},(_,i)=>({id:'bot_'+String(i+1).padStart(2,'0'),name:BOT_NAMES[i],persona:PERSONA[i%4]}));
const ORIGIN=Date.UTC(2026,10,1);
const R_=p=>db.doc(p);

// ---------------------------------------------------------------- 運用アカウントの持ち馬（決まった計算で全端末同じ）
const botHorseCache={};
function botHorses(bt){ const day=Math.floor((now()-ORIGIN)/86400e3); const ck=bt.id+'|'+day; if(botHorseCache[ck]) return botHorseCache[ck];
  const R=rng(hash(bt.id+'horses')), S=ROSTER.filter(m=>m[1]==='牡'), D=ROSTER.filter(m=>m[1]==='牝'), lvl=Math.min(0.95,0.74+day*0.003);
  const hs=[0,1].map(n=>{ const f=makeFoal(parentObj(S[Math.floor(R()*S.length)]),parentObj(D[Math.floor(R()*D.length)]),R);
    f.id=bt.id+'_h'+n; f.name=NPC_NM1[Math.floor(R()*NPC_NM1.length)]+NPC_NM2[Math.floor(R()*NPC_NM2.length)];
    STATS_ALL.forEach(([k])=>f.st[k]=+(f.cap[k]*lvl).toFixed(1)); f.st.hp=f.cap.hp; f.age=3+Math.floor(R()*3); f.races=5+Math.floor(R()*10); f.wins=Math.floor(R()*4); f.cond=0; f.fat=0; delete f.log; return f; });
  return botHorseCache[ck]=hs; }
function botEntries(key){ return BOTS.map(bt=>{ const R=rng(hash(bt.id+key+'entry')); if(R()>0.45) return null; const h=botHorses(bt)[Math.floor(R()*2)]; return {uid:bt.id,owner:bt.name,snap:h,bot:true}; }).filter(Boolean); }
function botBets(key,race){ const fav=race.hs.map((h,i)=>({i,o:h.odds})).sort((a,b)=>a.o-b.o), out=[];
  BOTS.forEach(bt=>{ const R=rng(hash(bt.id+key+'bet')); if(R()>0.6) return; const amt=500+Math.floor(R()*6)*500; let items;
    if(bt.persona==='steady') items=[{type:'fuku',amount:amt,keys:[NET.comboKey('fuku',[fav[0].i])]}];
    else if(bt.persona==='longshot'){ const ls=fav.filter(x=>x.o>=10&&x.o<=60); const p=ls[Math.floor(R()*ls.length)]||fav[fav.length-1]; items=[{type:'tan',amount:amt,keys:[NET.comboKey('tan',[p.i])]}]; }
    else if(bt.persona==='breeder') items=[{type:'tan',amount:amt,keys:[NET.comboKey('tan',[fav[Math.floor(R()*3)].i])]}];
    else { const half=Math.max(100,Math.round(amt/200)*100); items=[{type:'wide',amount:half,keys:[NET.comboKey('wide',[fav[0].i,fav[1].i]),NET.comboKey('wide',[fav[0].i,fav[2].i])]}]; }
    out.push({uid:bt.id,items}); });
  return out; }

const NET=window.NET={on:false,down:0,uid:null,name:'',code:'',master:null,masterAt:0,mult:1,ratio:1,lastBal:0,p2pAcc:0,
  races:{},fields:{},pools:{},board:null,boardAt:0,rankDoc:null,rankAt:0,botsDoc:null,inboxAt:0,
  // ------------------------------------------------ 起動
  async start(user){ this.uid=user.uid; this.code=codeOf(user.uid);
    await this.ensureBase(); await this.loadRank(true);
    const row=(this.rankDoc.rows||{})[this.uid];
    if(row){ this.name=row.name||user.displayName||'プレイヤー'; this.lastBal=+row.balance||0; } else { this.name=(user.displayName||'プレイヤー').slice(0,16); this.lastBal=0; }
    this.on=true; hookGame();
    if(row&&balance>this.lastBal){ const gain=balance-this.lastBal; this._skip=0; _setRaw(this.lastBal); this.capGive(gain,'ログインしていない間に増えた分'); }
    this.release(); await this.flush(true); await this.applyInbox(true);
    setInterval(()=>this.flush().catch(()=>{}),FLUSH_MS);
    setTimeout(()=>this.tryMaint(),3000);
    try{ if($('#s-online').classList.contains('active')) renderOnline(); if($('#s-farm').classList.contains('active')) renderFarm(); }catch(e){} },
  isDown(){ return this.down&&now()<this.down; },
  guard(e){ if(e&&e.code==='resource-exhausted'){ const d=new Date(); this.down=now()+ (((24+17-((d.getUTCHours()+9)%24))%24)||24)*3600e3; toast('今日のオンライン機能の無料枠を使い切りました。17時ごろに復旧します（1人用では遊べます）'); } throw e; },
  async ensureBase(){ const M=R_('master/v2'), B=R_('bots/all');
    await db.runTransaction(async t=>{ const m=await t.get(M), b=await t.get(B);
      if(!m.exists) t.set(M,{total:TOTAL,balance:TOTAL-(b.exists?0:BOT_N*BOT_REFILL),created:now()});
      else if(!b.exists) t.update(M,{balance:inc(-BOT_N*BOT_REFILL)});
      if(!b.exists) t.set(B,{bal:Object.fromEntries(BOTS.map(x=>[x.id,BOT_REFILL]))}); });
    await this.refreshMaster(true); },
  async refreshMaster(force){ if(!force&&(now()-this.masterAt<MASTER_MS||this.isDown())) return; const s=await R_('master/v2').get().catch(e=>this.guard(e)); if(!s.exists) return;
    this.master=s.data(); this.masterAt=now(); this.ratio=this.master.balance/this.master.total; this.mult=this.ratio>=0.5?1:this.ratio>=0.3?0.8:this.ratio>=0.1?0.6:0.4; },
  // ------------------------------------------------ 記帳（5分ごと・画面を閉じたとき・送金などの直後）
  async flush(force){ if(!this.on||this.busy||this.isDown()) return; const bal=balance, d=bal-this.lastBal-this.p2pAcc;
    if(!force&&!d&&this.lastBal===bal&&now()-(this.flushAt||0)<30*60e3) return; this.busy=true; const p2p=this.p2pAcc;
    try{ const b=db.batch(); b.set(R_('meta/rank'),{rows:{[this.uid]:{name:this.name,code:this.code,balance:bal,...myStats(),t:now()}}},{merge:true});
      if(d) b.update(R_('master/v2'),{balance:inc(-d)}); await b.commit(); this.lastBal=bal; this.p2pAcc-=p2p; this.flushAt=now(); if(d&&this.master) this.master.balance-=d;
    }catch(e){ console.warn('flush',e); try{ this.guard(e); }catch(_){} } this.busy=false; },
  p2p(delta){ this.p2pAcc+=Math.round(delta); this._skip=(this._skip||0)+Math.round(delta); },
  // ---- 1日の受け取り上限（マスターからの純受取。日本時間0時リセット）
  led(){ let L=store.get('capled',null); const d=jstDay(); if(!L||L.d!==d) L={d,net:0,pending:L?L.pending||0:0}; return L; },
  saveLed(L){ store.set('capled',L); },
  room(){ const L=this.led(); return Math.max(0,DAY_CAP-L.net); },
  // マスターからの受け取りを上限内で反映し、超えた分は未受取へ
  capGive(amt,why){ if(amt<=0) return; const L=this.led(), ok=Math.min(amt,Math.max(0,DAY_CAP-L.net)), over=amt-ok; L.net+=ok; L.pending+=over; this.saveLed(L); this._inCap=true; try{ if(ok) _setRaw(balance+ok); } finally{ this._inCap=false; }
    if(over) toast(`本日のマスターからの受け取り上限（${fmt(DAY_CAP)} NOA）に達したため、${why?why+'の':''}${fmt(over)} NOA は未受取になりました（明日以降に自動で受け取れます）`); },
  release(){ const L=this.led(); if(!L.pending) return; const x=Math.min(L.pending,Math.max(0,DAY_CAP-L.net)); if(!x) return; L.pending-=x; L.net+=x; this.saveLed(L); this._inCap=true; try{ _setRaw(balance+x); } finally{ this._inCap=false; } toast(`未受取の ${fmt(x)} NOA を受け取りました${L.pending?`（残り ${fmt(L.pending)} NOA は明日以降）`:''}`); },
  async applyInbox(force){ if(!this.on||this.isDown()) return; if(!force&&now()-this.inboxAt<INBOX_MS) return; this.inboxAt=now();
    const q=await db.collection('players/'+this.uid+'/inbox').get().catch(e=>this.guard(e)); if(!q.docs.length) return;
    for(const d of q.docs){ const x=d.data(); try{ await d.ref.delete(); }catch(e){ continue; }
      const amt=Math.round(+x.amt||0); if(amt){ this.p2p(amt); setBal(balance+amt); } toast(`<i class="ic ic-coin"></i> ${esc(x.msg||'NOAを受け取りました')}　+${fmt(amt)} NOA`); }
    await this.flush(true); },
  // ------------------------------------------------ ランキング・送金
  async loadRank(force){ if(!force&&this.rankDoc&&now()-this.rankAt<RANK_MS) return this.rankDoc; const s=await R_('meta/rank').get().catch(e=>this.guard(e)); this.rankDoc=s.exists?s.data():{rows:{}}; this.rankAt=now(); return this.rankDoc; },
  async loadBots(){ const s=await R_('bots/all').get().catch(e=>this.guard(e)); this.botsDoc=s.exists?s.data():{bal:{}}; return this.botsDoc; },
  async send(code,amt,msg){ amt=Math.round(amt/100)*100; if(!(amt>=100)) throw new Error('100 NOA以上で送金してください'); if(amt>balance) throw new Error('NOAが足りません');
    code=code.toUpperCase(); let rows=(await this.loadRank()).rows||{}; let to=Object.entries(rows).find(([u,r])=>r.code===code); if(!to){ rows=(await this.loadRank(true)).rows||{}; to=Object.entries(rows).find(([u,r])=>r.code===code); }
    if(!to) throw new Error('そのフレンドコードの人が見つかりません'); if(to[0]===this.uid) throw new Error('自分には送れません');
    const get=Math.floor(amt*(1-SEND_FEE)), fee=amt-get, b=db.batch();
    b.set(db.collection('players/'+to[0]+'/inbox').doc(rid()),{amt:get,kind:'transfer',msg:`${this.name} さんから送金${msg?'「'+msg.slice(0,40)+'」':''}`,t:now()});
    b.update(R_('master/v2'),{balance:inc(fee)}); await b.commit().catch(e=>this.guard(e));
    this.p2p(-amt); setBal(balance-amt); if(this.master) this.master.balance+=fee; await this.flush(true); return {to:to[1].name,get,fee}; },
  // ------------------------------------------------ オンラインレース
  deadline(key){ return onlineSpec(key).post-15*60e3; },
  closeAt(key){ return onlineSpec(key).post-5*60e3; },
  async race(key,maxAge){ const c=this.races[key], fin=c&&c.at>this.closeAt(key)+30e3; if(c&&(fin||now()-c.at<(maxAge==null?30e3:maxAge))) return c.d;
    const s=await R_('race/'+key).get().catch(e=>this.guard(e)); const d=s.exists?s.data():{}; this.races[key]={d,at:now()}; delete this.fields[key]; delete this.pools[key]; return d; },
  async ensure(key,force){ await this.race(key,force?5000:null); return this.buildField(key); },
  buildField(key){ if(this.fields[key]) return this.fields[key]; const d=(this.races[key]||{}).d||{}, dl=this.deadline(key);
    const hum=Object.entries(d.entries||{}).filter(([u,e])=>{ const ts=e.ts&&e.ts.toMillis?e.ts.toMillis():e.t; return ts<=dl+5000; }).map(([u,e])=>({uid:u,owner:e.name,snap:e.snap,bot:false}));
    let ents=hum.concat(botEntries(key)).sort((a,b)=>a.uid<b.uid?-1:1);
    if(ents.length>16){ const R=rng(hash(key+'lottery')); for(let i=ents.length-1;i>0;i--){ const j=Math.floor(R()*(i+1)); [ents[i],ents[j]]=[ents[j],ents[i]]; } ents=ents.slice(0,16).sort((a,b)=>a.uid<b.uid?-1:1); }
    return this.fields[key]={ents,mine:ents.some(e=>e.uid===this.uid),entered:!!(d.entries||{})[this.uid]}; },
  fieldOf(key){ return this.fields[key]||null; },
  comboKey(type,c){ const u=['tan','fuku','umaren','wide','trio'].includes(type); return type+':'+(u?c.slice().sort((a,b)=>a-b):c).join('-'); },
  winKeys(type,ord){ const [a,b,c]=ord, S=x=>x.slice().sort((p,q)=>p-q).join('-');
    switch(type){ case 'tan': return ['tan:'+a]; case 'fuku': return [a,b,c].map(x=>'fuku:'+x); case 'umaren': return ['umaren:'+S([a,b])];
      case 'wide': return [S([a,b]),S([a,c]),S([b,c])].map(x=>'wide:'+x); case 'umatan': return [`umatan:${a}-${b}`]; case 'trio': return ['trio:'+S([a,b,c])]; case 'tierce': return [`tierce:${a}-${b}-${c}`]; } return []; },
  // 馬券プール＝みんなの馬券の合計（サーバー）＋運用アカウントの馬券（計算）
  pool(key){ if(this.pools[key]) return this.pools[key]; const d=(this.races[key]||{}).d||{}; this.buildField(key);
    const P={stake:{...(d.pool||{})},tot:{...(d.tot||{})},all:+d.all||0,bots:[]};
    try{ const R0=onlineRace(key); P.bots=botBets(key,R0); P.bots.forEach(x=>x.items.forEach(it=>it.keys.forEach(k=>{ P.stake[k]=(P.stake[k]||0)+it.amount; const ty=k.split(':')[0]; P.tot[ty]=(P.tot[ty]||0)+it.amount; P.all+=it.amount; }))); }catch(e){ console.warn(e); }
    return this.pools[key]=P; },
  async loadPool(key,force){ await this.race(key,force?5000:null); return this.pool(key); },
  payRate(P,type,ord,k){ const ks=this.winKeys(type,ord); if(!ks.includes(k)||!P.stake[k]) return 0; return (P.tot[type]||0)*(1-RAKE)/ks.length/P.stake[k]; },
  payoutOf(P,items,ord,exact){ let s=0; (items||[]).forEach(it=>it.keys.forEach(k=>{ const r=this.payRate(P,k.split(':')[0],ord,k); if(r) s+=exact?it.amount*r:Math.floor(it.amount*r); })); return s; },
  paidTotal(P,ord){ let s=0; Object.keys(P.tot).forEach(ty=>{ const ks=this.winKeys(ty,ord), share=(P.tot[ty]||0)*(1-RAKE)/ks.length; ks.forEach(k=>{ if(P.stake[k]) s+=share; }); }); return s; },
  estOdds(key,type,c){ const P=this.pools[key]; if(!P) return null; const k=this.comboKey(type,c), st=P.stake[k], tot=P.tot[type]||0; if(!st||tot<1000) return null;
    const div=type==='fuku'||type==='wide'?3:1; return Math.max(1,Math.floor(tot*(1-RAKE)/div/st*10)/10); },
  wrapOdds(key,base){ const self=this; this.pool(key); try{ RACE.hs.forEach((h,i)=>{ const e=self.estOdds(key,'tan',[i]); if(e!=null) h.odds=e; }); }catch(e){}
    return {get(type,picks){ const e=self.estOdds(key,type,picks); return e==null?base.get(type,picks):e; }}; },
  async placeBets(key,sl){ if(now()>=this.closeAt(key)) throw new Error('投票は締め切られました'); const items=sl.map(b=>({type:b.type,amount:b.amount,keys:b.combos.map(c=>this.comboKey(b.type,c))}));
    const P2={}, T2={}; let all=0; items.forEach(it=>it.keys.forEach(k=>{ P2[k]=(P2[k]||0)+it.amount; T2[it.type]=(T2[it.type]||0)+it.amount; all+=it.amount; }));
    await R_('race/'+key).set({pool:Object.fromEntries(Object.entries(P2).map(([k,v])=>[k,inc(v)])),tot:Object.fromEntries(Object.entries(T2).map(([k,v])=>[k,inc(v)])),all:inc(all)},{merge:true}).catch(e=>this.guard(e));
    this.p2p(-all); delete this.races[key]; delete this.pools[key]; return all; },
  async enter(key,snap){ await R_('race/'+key).set({entries:{[this.uid]:{name:this.name,snap,t:now(),ts:FV.serverTimestamp()}}},{merge:true}).catch(e=>this.guard(e)); delete this.races[key]; delete this.fields[key]; },
  async unenter(key){ await R_('race/'+key).update({['entries.'+this.uid]:FV.delete()}).catch(e=>this.guard(e)); delete this.races[key]; delete this.fields[key]; },
  // ------------------------------------------------ ホースマーケット（掲示板1件）
  async loadBoard(force){ if(!force&&this.board&&now()-this.boardAt<BOARD_MS) return this.board; const s=await R_('market/board').get().catch(e=>this.guard(e)); this.board=s.exists?(s.data().L||{}):{}; this.boardAt=now(); return this.board; },
  async boardTx(fn){ const ref=R_('market/board'); let out; await db.runTransaction(async t=>{ const s=await t.get(ref); const L=s.exists?(s.data().L||{}):{}; out=await fn(t,L); t.set(ref,{L,t:now()}); this.board=L; this.boardAt=now(); }).catch(e=>this.guard(e)); return out; },
  async bid(id,amt,buy){ const res=await this.boardTx(async(t,L)=>{ const x=L[id]; if(!x) throw new Error('出品が見つかりません');
      if(x.status!=='open'||now()>=x.ends) throw new Error('このオークションは終了しました'); if(x.seller===this.uid) throw new Error('自分の出品には入札できません');
      const mn=x.high?x.high.amt+mktStep(x.high.amt):x.start; if(buy) amt=x.buyout; amt=Math.min(Math.round(amt/100)*100,x.buyout); if(amt<mn) throw new Error(`${fmt(mn)} NOA以上で入札してください`);
      if(balance<amt) throw new Error('NOAが足りません');
      if(x.high) refundBid(t,x.high,x.horse.name);
      x.high={uid:this.uid,name:this.name,amt,t:now()}; x.bids=(x.bids||[]).concat([{name:this.name,amt,t:now()}]).slice(-12);
      if(amt>=x.buyout){ x.status='sold'; x.closed=now(); creditSale(t,x,amt); } return {amt,sold:x.status==='sold'}; });
    this.p2p(-res.amt); setBal(balance-res.amt); await this.flush(true); return res; },
  async list(h,start){ const est=horseValue(h), cap=mktCapOf(est); if(start>cap) throw new Error(`推定売却額の140%（${fmt(cap)} NOA）を超える金額は登録できません`);
    const id='L'+rid(), horse=JSON.parse(JSON.stringify(h)); delete horse.log; delete horse.listed;
    await this.boardTx(async(t,L)=>{ L[id]={seller:this.uid,sellerName:this.name,horse,est,start,buyout:cap,t0:now(),ends:now()+MKT_DUR,status:'open',bids:[],high:null,claimed:false}; });
    h.listed=id; saveStable(); return id; },
  async cancel(id){ await this.boardTx(async(t,L)=>{ const x=L[id]; if(!x||x.status!=='open'||x.high) throw new Error('入札が入っている出品は取り下げできません'); x.status='cancel'; x.closed=now(); });
    const h=stable.find(s=>s.listed===id); if(h){ delete h.listed; saveStable(); } },
  // 掲示板を見て、自分に関係する後処理（売れた馬を手放す・落札した馬を受け取る・期限切れの精算）
  async reconcileMarket(){ const L=await this.loadBoard(); let ch=false, need=false;
    for(const [id,x] of Object.entries(L)){
      if(x.status==='open'&&now()>=x.ends) need=true;
      if(x.seller===this.uid){ const h=stable.find(s=>s.listed===id);
        if(h&&x.status==='sold'){ stable=stable.filter(s=>s!==h); saveStable(); toast(`マーケット：${esc(h.name)} が ${esc(x.high.name)} さんに ${fmt(x.high.amt)} NOA で落札されました（代金は手数料10%を引いて届きます）`); ch=true; }
        if(h&&(x.status==='expired'||x.status==='cancel')){ delete h.listed; saveStable(); if(x.status==='expired') toast(`マーケット：${esc(h.name)} は入札がなく、出品期間が終了しました`); ch=true; } }
      if(x.status==='sold'&&x.high&&x.high.uid===this.uid&&!x.claimed) need=true; }
    if(need){ const got=await this.boardTx(async(t,L2)=>{ const mine=[]; settleBoard(t,L2); Object.entries(L2).forEach(([id,x])=>{ if(x.status==='sold'&&x.high&&x.high.uid===this.uid&&!x.claimed){ x.claimed=true; mine.push(x); } }); return mine; });
      (got||[]).forEach(x=>{ const h=JSON.parse(JSON.stringify(x.horse)); h.id='b'+rid(); h.retired=true; delete h.listed; h.bought={from:x.sellerName,price:x.high.amt}; stable.push(h); toast(`マーケット：${esc(h.name)} を ${fmt(x.high.amt)} NOA で落札！ 厩舎に加わりました`); ch=true; });
      if(got&&got.length) saveStable(); }
    return ch; },
  // ------------------------------------------------ マスターの自動処理（10分に1回・誰かの端末が代行）
  async maint(){ if(!this.on||this.isDown()) return; const ref=R_('meta/state'); let st=null;
    await db.runTransaction(async t=>{ const s=await t.get(ref); const d=s.exists?s.data():{}; if(now()-(d.lastMaint||0)<MAINT_MS) return; t.set(ref,{lastMaint:now(),by:this.uid},{merge:true}); st=d; }).catch(e=>this.guard(e));
    if(!st) return; await this.refreshMaster(true); await rakeBacklog(st.lastRaked||''); await marketMaint(); await this.refreshMaster(true); }
};

// ---------------------------------------------------------------- 精算（レース1つにつき1回のトランザクション）
async function rakeBacklog(lastRaked){ const t=now(), days=[jstNow(),new Date(jstNow().getTime()-86400e3)];
  const keys=[...new Set(days.flatMap(d=>ON_HOURS.map(h=>jstKey(d,h))))].filter(k=>k>lastRaked&&t>=onlineSpec(k).post+60e3).sort();
  for(const key of keys){ await NET.race(key,0); const P=NET.pool(key), o=onlineOutcomeNet(key); if(!o) continue; const sp=onlineSpec(key);
    const paid=NET.paidTotal(P,o.ord), botD={}; let botDust=0; P.bots.forEach(x=>{ const cost=x.items.reduce((a,it)=>a+it.amount*it.keys.length,0); const pf=NET.payoutOf(P,x.items,o.ord); botDust+=NET.payoutOf(P,x.items,o.ord,true)-pf; botD[x.uid]=(botD[x.uid]||0)-cost+pf; });
    let botPrize=0; Object.entries(o.netPlaces||{}).forEach(([uid,pl])=>{ if(!uid.startsWith('bot_')) return; const pr=Math.round((ON_FEE+(ON_PRIZE[pl-1]||0)*(sp.legend?2:1))*NET.mult); botD[uid]=(botD[uid]||0)+pr; botPrize+=pr; });
    // 運用アカウントの馬券代は計算上の存在なので、ここで「支払った」ことにしてマスターへ戻す（P.allに含まれる）
    const rake=Math.round(P.all-paid+botDust);
    await db.runTransaction(async tx=>{ const rs=await tx.get(R_('race/'+key)), bs=await tx.get(R_('bots/all')); if(rs.exists&&rs.data().raked) return; const bal={...(bs.exists?bs.data().bal:{})}; let md=rake-botPrize;
      const upd={}; Object.entries(botD).forEach(([id,v])=>{ bal[id]=(bal[id]||0)+v; });
      Object.keys(bal).forEach(id=>{ let v=bal[id]; if(v>BOT_CAP){ md+=v-BOT_CAP; v=BOT_CAP; } else if(v<BOT_FLOOR){ md-=BOT_REFILL-v; v=BOT_REFILL; } bal[id]=Math.round(v); });
      // 運用アカウントの馬券代（計算上）は財布から引いた分だけプールに入っているため、マスター側は rake から運用分の支払いを相殺済み
      tx.set(R_('race/'+key),{raked:true,result:{names:o.names,t:now()}},{merge:true}); tx.set(R_('bots/all'),{bal},{merge:true});
      tx.update(R_('master/v2'),{balance:inc(md)}); tx.set(R_('meta/state'),{lastRaked:key},{merge:true}); }).catch(e=>NET.guard(e)); } }
function onlineOutcomeNet(key){ try{ const R=onlineRace(key), sR=RACE, sS=SIM; let out; try{ RACE=R; withSeed(hash(key)+7,()=>setupSim());
    out={order:SIM.order.map(i=>SIM.hs[i].no),names:SIM.order.slice(0,5).map(i=>SIM.hs[i].name),ord:SIM.order.slice(),netPlaces:Object.fromEntries(SIM.hs.filter(h=>h.netUid).map(h=>[h.netUid,SIM.order.indexOf(h.i)+1]))}; } finally{ RACE=sR; SIM=sS; } return out; }catch(e){ console.warn(e); return null; } }
NET.outcome=onlineOutcomeNet;

// ---------------------------------------------------------------- マーケットの取引ヘルパー
function refundBid(t,hi,name){ if(hi.uid.startsWith('bot_')) t.set(R_('bots/all'),{bal:{[hi.uid]:inc(hi.amt)}},{merge:true});
  else t.set(db.collection('players/'+hi.uid+'/inbox').doc(rid()),{amt:hi.amt,kind:'refund',msg:`マーケット：${name} で競り負け、入札額を返金`,t:now()}); }
function creditSale(t,x,amt){ const get=Math.floor(amt*(1-MKT_FEE_N)), fee=amt-get;
  if(x.seller.startsWith('bot_')) t.set(R_('bots/all'),{bal:{[x.seller]:inc(get)}},{merge:true});
  else t.set(db.collection('players/'+x.seller+'/inbox').doc(rid()),{amt:get,kind:'sale',msg:`マーケット：${x.horse.name} が ${fmt(amt)} NOA で落札（手数料10%差引）`,t:now()});
  t.update(R_('master/v2'),{balance:inc(fee)}); }
function settleBoard(t,L){ const tm=now(); Object.entries(L).forEach(([id,x])=>{
    if(x.status==='open'&&tm>=x.ends){ if(x.high){ x.status='sold'; x.closed=tm; creditSale(t,x,x.high.amt); } else { x.status='expired'; x.closed=tm; } }
    if(x.status==='sold'&&x.high&&x.high.uid.startsWith('bot_')) x.claimed=true;
    if(x.status!=='open'&&(x.claimed||x.status!=='sold')&&tm-(x.closed||tm)>2*86400e3) delete L[id]; }); }
async function marketMaint(){ const bots=(await NET.loadBots()).bal||{}; const tm=now();
  await NET.boardTx(async(t,L)=>{ settleBoard(t,L);
    const open=Object.values(L).filter(x=>x.status==='open'&&x.seller.startsWith('bot_')).length;
    for(let k=open;k<4;k++){ const bt=BOTS[Math.floor(Math.random()*BOT_N)], R=rng(hash(bt.id+tm+k)), h=mktNpcHorse(R), est=horseValue(h), cap=mktCapOf(est); delete h.log;
      L['L'+rid()]={seller:bt.id,sellerName:bt.name,horse:h,est,start:Math.min(cap,Math.max(1000,Math.round(est*(0.85+R()*0.4)/100)*100)),buyout:cap,t0:tm,ends:tm+MKT_DUR,status:'open',bids:[],high:null,claimed:false}; }
    Object.entries(L).forEach(([id,x])=>{ if(x.status!=='open'||tm>=x.ends||x.seller.startsWith('bot_')) return;
      for(const bt of BOTS){ const R=rng(hash(bt.id+id)); const val=Math.round(x.est*(0.7+R()*0.78)/100)*100, mn=x.high?x.high.amt+mktStep(x.high.amt):x.start;
        if((x.high&&x.high.uid===bt.id)||Math.random()>0.2||val<mn) continue; const amt=val>=x.buyout?x.buyout:Math.min(val,mn+mktStep(mn)); if((bots[bt.id]||0)<amt) continue;
        if(x.high) refundBid(t,x.high,x.horse.name); x.high={uid:bt.id,name:bt.name,amt,t:tm}; x.bids=(x.bids||[]).concat([{name:bt.name,amt,t:tm}]).slice(-12);
        t.set(R_('bots/all'),{bal:{[bt.id]:inc(-amt)}},{merge:true}); bots[bt.id]-=amt; if(amt>=x.buyout){ x.status='sold'; x.closed=tm; x.claimed=true; creditSale(t,x,amt); } break; } }); }); }
function myStats(){ const st=stable||[]; return {wins:st.reduce((a,h)=>a+(h.wins||0),0),g1w:st.reduce((a,h)=>a+(h.g1w||0),0),horses:st.filter(h=>!h.retired).length}; }

// ---------------------------------------------------------------- ゲームへの組み込み
let _setRaw=null;
function hookGame(){
  _setRaw=setBal; setBal=function(v){ const old=balance, nv=Math.max(0,Math.round(v)); if(NET._inCap) return _setRaw(nv);
    const delta=nv-old, skip=NET._skip||0; NET._skip=0; const mp=delta-skip;
    if(mp>0){ _setRaw(old+skip); NET.capGive(mp); return; }
    if(mp<0){ const L=NET.led(); L.net+=mp; NET.saveLed(L); }
    _setRaw(nv); if(mp<0) NET.release(); };
  const _entry=onlineEntry; onlineEntry=function(key){ _entry(key);
    document.querySelectorAll('[data-oeh]').forEach(b=>{ const f=b.onclick; b.onclick=async()=>{ const h=stable.find(x=>x.id===b.dataset.oeh); try{ await NET.enter(key,entrySnap(h)); }catch(e){ toast('エントリーできませんでした：'+e.message); return; } f(); }; });
    const c=$('#oeCancel'); if(c){ const f=c.onclick; c.onclick=async()=>{ try{ await NET.unenter(key); }catch(e){} f(); }; } };
  const _bet=onlineBet; onlineBet=async function(key){ try{ await NET.loadPool(key,true); }catch(e){ toast('オッズを読み込めませんでした'); } _bet(key); };
  const _watch=onlineWatch; onlineWatch=async function(key,live){ try{ await NET.ensure(key); }catch(e){} _watch(key,live); };
}
NET.settleMine=async function(key){ const sp=onlineSpec(key); if(now()<sp.post) return null; if(online.done[key]&&online.done[key].settled) return online.done[key];
  await this.race(key,0); const P=this.pool(key), o=onlineOutcomeNet(key); if(!o) return null;
  const mine=(online.bets[key]||[]).map(b=>({type:b.type,amount:b.amount,keys:b.combos.map(c=>this.comboKey(b.type,c))}));
  const ret=this.payoutOf(P,mine,o.ord), spent=mine.reduce((a,it)=>a+it.amount*it.keys.length,0);
  const pl=(o.netPlaces||{})[this.uid]||0; let prize=0; if(pl) prize=Math.round((ON_FEE+(ON_PRIZE[pl-1]||0)*(sp.legend?2:1))*this.mult);
  const dust=Math.round(this.payoutOf(P,mine,o.ord,true)-ret); if(ret||dust) this.p2p(ret+dust); setBal(balance+ret+prize);
  online.done[key]={...o,ownPlace:pl,settled:true,ret,spent,prize}; saveOnline();
  if(online.entries[key]&&!pl) toast(`オンライン${sp.hour}時：抽選に外れたため出走できませんでした`);
  if(ret||prize) toast(`オンライン${sp.hour}時のレース確定：払戻 ${fmt(ret)}・出走賞金 ${fmt(prize)} NOA`); await this.flush(true); return online.done[key]; };

// ---------------------------------------------------------------- 画面
NET.tryMaint=function(){ if(now()-(this.maintTry||0)<2*60e3) return; this.maintTry=now(); this.maint().catch(e=>console.warn('maint',e)); };
NET.renderTop=async function(){ const el=$('#netTop'); if(!el) return; this.release(); this.applyInbox().catch(()=>{}); this.tryMaint(); await this.refreshMaster().catch(()=>{});
  const M=this.master||{balance:0,total:TOTAL}, r=M.balance/M.total, u=USAGE.get();
  el.innerHTML=`<div class="net-grid">
   <div class="net-card"><small>MASTER</small><b>${fmt(Math.round(M.balance))} <span>NOA</span></b><div class="net-bar"><i style="width:${Math.max(0,Math.min(100,r*100)).toFixed(1)}%"></i></div><div class="hsub">総量 ${fmt(M.total)} のうち ${(r*100).toFixed(1)}% を保有・賞金倍率 <b class="gold">×${this.mult}</b>${this.mult<=0.4?'（ログインボーナス停止中）':''}</div></div>
   <div class="net-card"><small>YOU</small><b style="font-size:17px">${esc(this.name)}</b><div class="hsub">フレンドコード <b class="gold">${this.code}</b>　<a href="#" class="lnk" id="netRename">名前を変更</a></div><div class="hsub">今日のマスターからの受け取り：あと <b>${fmt(this.room())}</b> NOA${this.led().pending?`・未受取 <b class="gold">${fmt(this.led().pending)}</b>`:''}</div><div class="hsub">今日の通信：読み ${fmt(u.r)}・書き ${fmt(u.w)}${this.isDown()?'　<b class="bad">無料枠切れ・17時ごろ復旧</b>':''}</div></div></div>
   <div class="row" style="gap:8px;margin-top:8px"><button class="btn" id="netRankBtn"><i class="ic ic-trophy"></i> ランキング</button><button class="btn" id="netSendBtn"><i class="ic ic-coin"></i> 送金</button></div>`;
  $('#netRename').onclick=e=>{ e.preventDefault(); const n=prompt('表示名（16文字まで）',this.name); if(n&&n.trim()){ this.name=n.trim().slice(0,16); this.flush(true); this.renderTop(); } };
  $('#netRankBtn').onclick=()=>this.openRank(); $('#netSendBtn').onclick=()=>this.openSend(); };
NET.openRank=async function(){ $('#resBox').innerHTML='<div class="win"><i class="ic ic-trophy"></i> ランキング</div><div class="sub">読み込み中…</div>'; $('#resModal').classList.add('on');
  try{ await this.flush(true); const [rk,bt]=await Promise.all([this.loadRank(true),this.loadBots()]); const M=this.master||{balance:0,total:TOTAL};
    const R=[...Object.entries(rk.rows||{}).map(([id,x])=>({id,...x})),...BOTS.map(b=>({id:b.id,name:b.name,balance:(bt.bal||{})[b.id]||0,bot:true}))].sort((a,b)=>b.balance-a.balance);
    const sp=R.filter(x=>!x.bot).reduce((a,x)=>a+x.balance,0), sb=R.filter(x=>x.bot).reduce((a,x)=>a+x.balance,0);
    $('#resBox').innerHTML=`<div class="win"><i class="ic ic-trophy"></i> 所持金ランキング</div><div class="hsub">流通量：プレイヤー ${fmt(sp)}・運用アカウント ${fmt(sb)}・マスター ${fmt(Math.round(M.balance))}（総量 ${fmt(M.total)}）</div>
    <table class="ent" style="margin-top:8px"><tr><th>#</th><th>名前</th><th class="num">所持金</th><th class="num">勝利</th></tr>${R.slice(0,40).map((x,i)=>`<tr class="${x.id===this.uid?'own':''}"><td>${i+1}</td><td>${esc(x.name)}${x.bot?' <span class="botmk">運用</span>':''}</td><td class="num">${fmt(Math.round(x.balance))}</td><td class="num">${x.bot?'-':x.wins||0}</td></tr>`).join('')}</table>
    <div class="row" style="justify-content:flex-end;margin-top:10px"><button class="btn gold" id="rkOk">閉じる</button></div>`; $('#rkOk').onclick=()=>$('#resModal').classList.remove('on');
  }catch(e){ $('#resBox').innerHTML=`<div class="sub">読み込めませんでした（${esc(e.message)}）</div><button class="btn gold" onclick="$('#resModal').classList.remove('on')">閉じる</button>`; } };
NET.openSend=function(){ $('#resBox').innerHTML=`<div class="win"><i class="ic ic-coin"></i> 送金</div><div class="sub">相手のフレンドコードを入力して、NOAを送ります。手数料5%はマスターへ（10,000送ると相手に9,500届きます）。相手が次にオンラインタブか牧場を開いたときに届きます。</div>
    <label class="mk-in">フレンドコード <input id="sdCode" maxlength="6" style="width:110px;text-transform:uppercase" placeholder="ABC123"></label>
    <label class="mk-in">金額 <input type="number" id="sdAmt" step="100" min="100" value="1000"> NOA</label>
    <label class="mk-in">ひとこと <input id="sdMsg" maxlength="40" style="width:200px" placeholder="馬代です"></label>
    <div class="row" style="justify-content:flex-end;margin-top:12px"><button class="btn" id="sdNo">やめる</button><button class="btn gold" id="sdYes">送金する</button></div>`;
  $('#resModal').classList.add('on'); $('#sdNo').onclick=()=>$('#resModal').classList.remove('on');
  $('#sdYes').onclick=async()=>{ const b=$('#sdYes'); b.disabled=true; try{ const r=await this.send($('#sdCode').value.trim(),+$('#sdAmt').value,$('#sdMsg').value.trim()); $('#resModal').classList.remove('on'); toast(`${esc(r.to)} さんに ${fmt(r.get)} NOA を送金しました（手数料 ${fmt(r.fee)}）`); this.renderTop(); }catch(e){ toast(esc(e.message)); b.disabled=false; } }; };
NET.renderMarket=async function(){ const el=$('#mktList'); if(!el) return; if(!this.board) el.innerHTML='<span class="hsub">読み込み中…</span>'; this.applyInbox().catch(()=>{}); this.tryMaint();
  try{ const ch=await this.reconcileMarket(); if(ch){ renderFarm(); return; } }catch(e){ console.warn(e); }
  const L=Object.entries(this.board||{}).map(([id,x])=>({id,...x})).filter(x=>x.status==='open'&&now()<x.ends).sort((a,b)=>(b.seller===this.uid)-(a.seller===this.uid)||a.ends-b.ends);
  const left=x=>{ const m=Math.max(0,x.ends-now())/60e3; return m>=60?`残り${Math.floor(m/60)}時間${Math.floor(m%60)}分`:`残り${Math.ceil(m)}分`; };
  el.innerHTML=(L.length?L.map(x=>{ const h=x.horse, mine=x.seller===this.uid, meHi=x.high&&x.high.uid===this.uid;
    return `<div class="fcard mkt ${mine?'mine':''} ${meHi?'lead':''}"><div style="flex:1;min-width:0"><div>${rkBadge(h)} ${attrChip(attrOf(h),true)} <b>${esc(h.name)}</b> <span class="hsub">${h.sex==='牡'?'種牡馬':'繁殖牝馬'}・${h.age}歳・${h.races}戦${h.wins}勝${h.g1w?`・G1 ${h.g1w}勝`:''}</span></div>
      <div class="hsub">${mine?'<b class="gold">あなたの出品</b>':`出品者 ${esc(x.sellerName)}${x.seller.startsWith('bot_')?' <span class="botmk">運用</span>':''}`}・推定 ${fmt(x.est)}・${left(x)}</div>
      <div class="hsub">現在 <b class="${meHi?'plus':'gold'}">${x.high?fmt(x.high.amt)+(meHi?'（あなたが最高額）':'（'+esc(x.high.name)+'）'):'入札なし（開始 '+fmt(x.start)+'）'}</b>　即落札 ${fmt(x.buyout)}</div></div>
      <div class="mk-act"><button class="btn sm" data-nmv="${x.id}">詳細</button>${mine?(x.high?'':`<button class="btn sm" data-nmc="${x.id}">取り下げ</button>`):`<button class="btn sm gold" data-nmb="${x.id}">入札</button>`}</div></div>`; }).join(''):'<span class="hsub">出品はありません</span>')
    +`<div class="row" style="justify-content:flex-end;margin-top:6px"><button class="btn sm" id="nmRe">最新の状態に更新</button></div>`;
  el.querySelectorAll('[data-nmv]').forEach(b=>b.onclick=()=>{ const x=this.board[b.dataset.nmv]; viewHorse(x.horse,`出品者 ${esc(x.sellerName)}・推定売却額 ${fmt(x.est)}・開始 ${fmt(x.start)}・即落札 ${fmt(x.buyout)} NOA`); });
  el.querySelectorAll('[data-nmc]').forEach(b=>b.onclick=async()=>{ try{ await this.cancel(b.dataset.nmc); toast('出品を取り下げました'); renderFarm(); }catch(e){ toast(esc(e.message)); } });
  el.querySelectorAll('[data-nmb]').forEach(b=>b.onclick=()=>this.openBid(b.dataset.nmb));
  $('#nmRe').onclick=async()=>{ await this.loadBoard(true); renderFarm(); }; };
NET.openBid=async function(id){ await this.loadBoard(true); const x=this.board[id]; if(!x||x.status!=='open'){ toast('このオークションは終了しました'); renderFarm(); return; } const mn=x.high?x.high.amt+mktStep(x.high.amt):x.start;
  $('#resBox').innerHTML=`<div class="win"><i class="ic ic-hammer"></i> ${esc(x.horse.name)} に入札</div><div class="sub">出品者 ${esc(x.sellerName)}</div>
    <div class="ownres">現在 <b class="gold">${x.high?fmt(x.high.amt)+' NOA（'+esc(x.high.name)+'）':'入札なし'}</b>　最低入札額 <b>${fmt(mn)} NOA</b>　即落札 <b class="gold">${fmt(x.buyout)} NOA</b></div>
    <label class="mk-in">入札額 <input type="number" id="mkBid" min="${mn}" step="100" value="${Math.min(mn,x.buyout)}"> NOA</label>
    <div class="hsub">入札額は預かりになり、競り負けたら全額返金されます。即落札額以上ならその場で落札です。</div>
    <div class="wlog">${(x.bids||[]).slice(-6).reverse().map(b=>`${esc(b.name)}：${fmt(b.amt)} NOA`).join('<br>')||'まだ入札はありません'}</div>
    <div class="row" style="justify-content:flex-end;margin-top:12px"><button class="btn" id="mbNo">やめる</button><button class="btn" id="mbBuy">即落札 ${fmt(x.buyout)}</button><button class="btn gold" id="mbYes">入札する</button></div>`;
  $('#resModal').classList.add('on'); $('#mbNo').onclick=()=>$('#resModal').classList.remove('on');
  const go=async buy=>{ try{ const r=await this.bid(id,+$('#mkBid').value,buy); $('#resModal').classList.remove('on'); if(r.sold) await this.reconcileMarket(); toast(r.sold?'即落札しました！ 厩舎に加わりました':`${fmt(r.amt)} NOA で入札しました`); renderFarm(); }catch(e){ toast(esc(e.message)); } };
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
