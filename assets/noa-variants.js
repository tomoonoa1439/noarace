/* NOA競馬 v4 — 15個体の外見仕様と3D装飾。THREE r128。
   外見(HORSE_VARIANTS)と、背景・天候・ポーズ(HORSE_SCENES)は別管理。 */
(function(g){'use strict';
const RB='rainbow';
// ---- 外見仕様（1〜15で固定） ----
const V={
 1:{name:'Rust Thunder',neon:0xff3a2a,armor:0x6a4030,metal:.55,neonPower:.7,hairLength:.7,fibers:6,damage:1.0,flicker:true,parts:[]},
 2:{name:'Moss Relic',neon:0x3aff6a,armor:0x4a6040,metal:.55,neonPower:.9,hairLength:.8,fibers:8,damage:.6,parts:['brokenEar']},
 3:{name:'Blizzard Crystal',neon:0x7fe8ff,armor:0xcfe8ff,metal:.7,neonPower:1.6,hairLength:1.35,fibers:12,parts:['crystal']},
 4:{name:'Night Circuit',neon:0x3a8cff,armor:0x3a5aa8,metal:.75,neonPower:1.7,hairLength:1.0,fibers:10,parts:['fin']},
 5:{name:'Lunar Violet',neon:0xa060ff,armor:0x6a4aa8,metal:.72,neonPower:1.7,hairLength:1.1,fibers:10,parts:['crescent']},
 6:{name:'Sakura Holo',neon:0xff6ad5,armor:0xd890b8,metal:.65,neonPower:1.8,hairLength:1.2,fibers:12,parts:['particles','gem']},
 7:{name:'Desert Sovereign',neon:0xffc23a,armor:0xd8a030,metal:.85,neonPower:2.0,hairLength:1.1,fibers:12,parts:['crown','aura']},
 8:{name:'Nebula Seraph',neon:RB,armor:0xf2f4ff,metal:.8,neonPower:2.2,hairLength:1.4,fibers:14,parts:['wingsFolded','halo','horn']},
 9:{name:'Gate Blaster',neon:0x3a8cff,armor:0x2a3a78,metal:.75,neonPower:1.6,hairLength:.75,fibers:8,body:[.9,1.02,1.02],parts:['dorsal']},
 10:{name:'Magma Charger',neon:0xff3a2a,armor:0x5a2a2a,metal:.7,neonPower:1.9,hairLength:.9,fibers:10,body:[1.12,1,1],parts:['spikes']},
 11:{name:'Forest Climber',neon:0x3aff6a,armor:0x3a6a4a,metal:.7,neonPower:1.6,hairLength:1.0,fibers:10,parts:['antler']},
 12:{name:'Tide Runner',neon:0x7fe8ff,armor:0x3a98a8,metal:.75,neonPower:1.6,hairLength:1.25,fibers:12,parts:['earfins']},
 13:{name:'Cloud Emperor',neon:0xffc23a,armor:0xe0b040,metal:.85,neonPower:2.0,hairLength:1.2,fibers:12,parts:['crownTall']},
 14:{name:'Rain Phantom',neon:0xa060ff,armor:0x3a2a5a,metal:.7,neonPower:1.8,hairLength:1.6,fibers:14,parts:['gem']},
 15:{name:'Cosmic Pegasus',neon:RB,armor:0xf2f4ff,metal:.8,neonPower:2.2,hairLength:1.5,fibers:14,parts:['wingsSpread','halo']},
};
// ---- 背景・天候・ポーズ（外見とは別） ----
const S={1:{bg:'雷雨の夜',weather:'雨',pose:'gallop'},2:{bg:'霧の森',weather:'霧',pose:'gallop'},3:{bg:'雪山の吹雪',weather:'雪',pose:'gallop'},4:{bg:'ネオン競馬場のナイター',weather:'晴',pose:'gallop'},
 5:{bg:'満月の未来都市',weather:'晴',pose:'gallop'},6:{bg:'夜桜の浮島',weather:'晴',pose:'gallop'},7:{bg:'砂漠の夕日',weather:'晴',pose:'gallop'},8:{bg:'宇宙と星雲',weather:'宇宙',pose:'gallop'},
 9:{bg:'ゲート',weather:'晴',pose:'gallop'},10:{bg:'溶岩の荒野',weather:'晴',pose:'gallop'},11:{bg:'森の坂道',weather:'晴',pose:'gallop'},12:{bg:'海辺の波打ち際',weather:'晴',pose:'gallop'},
 13:{bg:'雲の上',weather:'晴',pose:'rear'},14:{bg:'雨の夜の都市',weather:'雨',pose:'lookback'},15:{bg:'宇宙',weather:'宇宙',pose:'gallop'}};
const PART_NAME={crystal:'額の氷結晶',fin:'額のブレードフィン',crescent:'額の三日月',particles:'ホログラムの光の粒',gem:'額の宝石',crown:'冠',aura:'オーラ',wingsFolded:'翼（たたみ）',wingsSpread:'翼（展開）',halo:'光輪',horn:'水晶の角',dorsal:'背びれ',spikes:'肩のスパイク',antler:'枝角',earfins:'耳のフィン',crownTall:'高い冠',brokenEar:'片耳の欠けた装甲キャップ'};

function rainbowAt(t){ const c=new THREE_.Color(); c.setHSL(((t%1)+1)%1,1,.6); return c; }
let THREE_=null;

// 非インデックス化してまとめる（材質ごとに1メッシュ）
function merge(T,items,withColor){ let n=0; const parts=items.map(it=>{ const geo=it.geo.index?it.geo.toNonIndexed():it.geo.clone(); geo.applyMatrix4(it.m); if(!geo.attributes.normal) geo.computeVertexNormals(); n+=geo.attributes.position.count; return {geo,col:it.col}; });
 const pos=new Float32Array(n*3), nor=new Float32Array(n*3), col=withColor?new Float32Array(n*3):null; let o=0;
 parts.forEach(({geo,col:c})=>{ pos.set(geo.attributes.position.array,o*3); nor.set(geo.attributes.normal.array,o*3);
   if(col){ const cnt=geo.attributes.position.count; for(let i=0;i<cnt;i++){ let cc=c; if(typeof c==='function') cc=c(geo.attributes.position.getX(i),geo.attributes.position.getY(i),geo.attributes.position.getZ(i)); col[(o+i)*3]=cc.r; col[(o+i)*3+1]=cc.g; col[(o+i)*3+2]=cc.b; } }
   o+=geo.attributes.position.count; geo.dispose(); });
 items.forEach(it=>it.geo.dispose&&it.geo.dispose());
 const out=new T.BufferGeometry(); out.setAttribute('position',new T.BufferAttribute(pos,3)); out.setAttribute('normal',new T.BufferAttribute(nor,3)); if(col) out.setAttribute('color',new T.BufferAttribute(col,3)); return out; }

function createVariant(T,root,mesh,id,opt={}){
 THREE_=T; const spec=V[id]; if(!spec) throw Error('horseVariantIdは1〜15'); const scene=opt.pose===false?{...S[id],pose:'gallop'}:S[id];
 if(root.userData.horseVariantId!==undefined) throw Error('個体IDは変更できません'); Object.defineProperty(root.userData,'horseVariantId',{value:id,writable:false,enumerable:true});
 const isRB=spec.neon===RB, neonC=new T.Color(isRB?0xffffff:spec.neon);
 // 体格（輪郭差）
 if(spec.body){ mesh.scale.set(mesh.scale.x*spec.body[0],mesh.scale.y*spec.body[1],mesh.scale.z*spec.body[2]); }
 // ---- ポーズ用のピボット ----
 const geo=mesh.geometry; const pa=geo.attributes.position; let zmn=1e9,zmx=-1e9; for(let i=0;i<pa.count;i++){ const z=pa.getZ(i); if(z<zmn)zmn=z; if(z>zmx)zmx=z; } const bb={min:{z:zmn},max:{z:zmx}}, lz=zmx-zmn;
 const Z0=bb.min.z+lz*.58, Z1=bb.max.z;
 const poseU={value:0};
 const deform= scene.pose==='lookback' ? (p)=>{ const bz=Math.min(1,Math.max(0,(p.z-Z0)/(Z1-Z0))); const a=poseU.value*bz*bz; const dx=p.x, dz=p.z-Z0, c=Math.cos(a), s=Math.sin(a); p.x=dx*c+dz*s; p.z=Z0-dx*s+dz*c; } : null;
 const shaderDeform= scene.pose==='lookback' ? `{ float bz=clamp((transformed.z-(${Z0.toFixed(3)}))/(${(Z1-Z0).toFixed(3)}),0.0,1.0); float a=noaPose*bz*bz; float dx=transformed.x, dz=transformed.z-(${Z0.toFixed(3)}); float c=cos(a), s=sin(a); transformed.x=dx*c+dz*s; transformed.z=(${Z0.toFixed(3)})-dx*s+dz*c; }` : null;
 const poseG=new T.Group(), inner=new T.Group(); root.add(poseG); poseG.add(inner); inner.add(mesh);
 // ---- 銀装甲・単色ネオン・毛（v3） ----
 const fx=attachCyberStyle(T,root,{mesh,bodyMeshes:[mesh],color:neonC.getHex(),armorColor:spec.armor,metalness:spec.metal,neonPower:spec.neonPower,silver:true,
   forwardAxis:'x',forwardSign:1,phase:(opt.phase||id*.71),fibers:spec.fibers,hairLength:spec.hairLength,hairWidth:opt.hairWidth||4,damage:spec.damage||0,
   deform,shaderDeform,poseUniform:poseU,hideExistingLines:true,hideObjects:opt.hideObjects||[]});
 if(opt.envMap) [].concat(mesh.material).forEach(m=>{ m.envMap=opt.envMap; m.envMapIntensity=.55; m.needsUpdate=true; });
 // ---- アンカー（モーフ追従） ----
 const pos=geo.attributes.position, morph=geo.morphAttributes.position||[], rel=geo.morphTargetsRelative;
 const inv=new T.Matrix4(), M=new T.Matrix4(), v=new T.Vector3(), b0=new T.Vector3(), d=new T.Vector3();
 const mats=()=>{ root.updateWorldMatrix(true,true); inv.copy(root.matrixWorld).invert(); M.multiplyMatrices(inv,mesh.matrixWorld); };
 const vert=(i,out)=>{ b0.fromBufferAttribute(pos,i); out.copy(b0); const inf=mesh.morphTargetInfluences||[]; for(let k=0;k<morph.length;k++){ const w=inf[k]||0; if(w){ d.fromBufferAttribute(morph[k],i); if(!rel) d.sub(b0); out.addScaledVector(d,w);} } if(deform) deform(out); return out.applyMatrix4(M); };
 mats(); const box=new T.Box3(); for(let i=0;i<pos.count;i++) box.expandByPoint(v.fromBufferAttribute(pos,i).applyMatrix4(M));
 const H=box.max.y-box.min.y, L=box.max.x-box.min.x;
 const nearest=(x,y,z)=>{ let best=0,bd=1e9; const p=new T.Vector3(x,y,z); for(let i=0;i<pos.count;i++){ v.fromBufferAttribute(pos,i).applyMatrix4(M); const q=v.distanceToSquared(p); if(q<bd){bd=q;best=i;} } return best; };
 let nose=0; { let mx=-1e9; for(let i=0;i<pos.count;i++){ v.fromBufferAttribute(pos,i).applyMatrix4(M); if(v.y>box.min.y+H*.55&&v.x>mx){mx=v.x;nose=i;} } }
 let ear=0; { let my=-1e9; for(let i=0;i<pos.count;i++){ v.fromBufferAttribute(pos,i).applyMatrix4(M); if(v.x>box.max.x-L*.3&&v.y>my){my=v.y;ear=i;} } }
 const A={ nose, fore:ear, withers:nearest(box.min.x+L*.6,box.min.y+H*.66,0), croup:nearest(box.min.x+L*.18,box.min.y+H*.64,0), chest:nearest(box.min.x+L*.72,box.min.y+H*.5,0) };
 // ---- 材質（1個体につき最大4種） ----
 const mats_={
  metal:new T.MeshStandardMaterial({color:spec.armor,metalness:.8,roughness:.3,envMap:opt.envMap||null,envMapIntensity:.6}),
  gold:new T.MeshStandardMaterial({color:0xd6a646,metalness:.95,roughness:.28,emissive:0x3a2405,envMap:opt.envMap||null,envMapIntensity:.7}),
  glow:new T.MeshBasicMaterial({color:isRB?0xffffff:spec.neon,vertexColors:isRB,toneMapped:false}),
  crystal:new T.MeshStandardMaterial({color:isRB?0xffffff:spec.neon,vertexColors:isRB,transparent:true,opacity:.82,metalness:.1,roughness:.05,emissive:isRB?0x333333:spec.neon,emissiveIntensity:.6,envMap:opt.envMap||null}) };
 const frames={head:[],back:[],wingL:[],wingR:[],root:[]}; // [{mat,geo,m,col}]
 const add=(frame,mat,geo,p,r,s,col)=>{ if(frame==='face'){ frame='head'; p=[p[0]+.1,p[1]-.09,p[2]]; } else if(frame==='top'){ frame='head'; p=[p[0]+.03,p[1]-.1,p[2]]; } const K=frame==='head'?1.2:1; const m=new T.Matrix4().compose(new T.Vector3(...p).multiplyScalar(H*K),new T.Quaternion().setFromEuler(new T.Euler(...(r||[0,0,0]))),new T.Vector3(...(s||[1,1,1])).multiplyScalar(H*K)); frames[frame].push({mat,geo,m,col}); };
 const rbCol=(x,y,z)=>rainbowAt((x+y*.7+z*.4)/H*1.4);
 const P=new Set([...(spec.parts||[]),...(opt.extraParts||[])]);
 // 頭フレーム: 原点=額、+x=鼻方向、+y=上
 if(P.has('crown')||P.has('crownTall')){ const tall=P.has('crownTall'), n=tall?9:7, R=.085;
   add('top','gold',new T.CylinderGeometry(1,1.05,1,24,1,true),[-.06,.07,0],[0,0,0.25],[R,.035,R]);
   for(let k=0;k<n;k++){ const a=k/n*Math.PI*2, h=(tall?.11:.065)*(k%2?.7:1)*(tall&&k===0?1.5:1); add('top','gold',new T.ConeGeometry(1,1,4),[-.06+Math.cos(a)*R*.95,.09+h/2,Math.sin(a)*R*.95],[0,0,.25],[.016,h,.016]);
     if(k%2===0) add('top','glow',new T.OctahedronGeometry(1,0),[-.06+Math.cos(a)*R*1.03,.075,Math.sin(a)*R*1.03],[0,0,0],[.012,.016,.012]); } }
 if(P.has('halo')) add('head','glow',new T.TorusGeometry(1,.06,8,48),[-.05,.17,0],[Math.PI/2-.25,0,0],[.085,.085,.085],isRB?rbCol:null);
 if(P.has('horn')){ add('face','crystal',new T.ConeGeometry(1,1,6),[.05,.17,0],[0,0,-.85],[.03,.28,.03],isRB?rbCol:null); add('face','gold',new T.CylinderGeometry(1,1,1,12),[.0,.07,0],[0,0,-.85],[.038,.04,.038]); }
 if(P.has('crystal')){ [[0,.09,0,.05,.12],[.03,.06,.03,.03,.08],[.02,.06,-.035,.03,.07],[-.04,.06,0,.025,.06]].forEach(([x,y,z,w,h])=>add('face','crystal',new T.OctahedronGeometry(1,0),[x,y,z],[0,0,-.3],[w,h,w])); }
 if(P.has('fin')){ add('top','metal',new T.BoxGeometry(1,1,1),[-.06,-.03,0],[0,0,1.05],[.24,.04,.012]); add('top','glow',new T.BoxGeometry(1,1,1),[-.05,-.01,0],[0,0,1.05],[.22,.008,.016]); }
 if(P.has('crescent')){ add('face','gold',new T.TorusGeometry(1,.16,8,24,Math.PI*1.25),[-.02,.12,0],[0,0,-Math.PI*.12],[.07,.07,.05]); add('face','glow',new T.SphereGeometry(1,10,8),[-.02,.12,0],[0,0,0],[.018,.018,.018]); }
 if(P.has('gem')){ add('face','gold',new T.CylinderGeometry(1,1,1,6),[0,.02,0],[0,0,Math.PI/2-.3],[.035,.012,.035]); add('face','crystal',new T.OctahedronGeometry(1,0),[.004,.03,0],[0,0,0],[.03,.042,.03]); }
 if(P.has('antler')){ for(const z of [-1,1]){ add('top','metal',new T.CylinderGeometry(.6,1,1,6),[-.05,.06,z*.05],[z*.25,0,.35],[.012,.16,.012]); add('top','metal',new T.CylinderGeometry(.6,1,1,6),[-.01,.1,z*.08],[z*.6,0,-.4],[.009,.09,.009]); add('top','metal',new T.CylinderGeometry(.6,1,1,6),[-.1,.13,z*.07],[z*.5,0,.9],[.009,.08,.009]);
   [[-.1,.14,z*.065],[0,.13,z*.1],[-.14,.15,z*.08]].forEach(p=>add('top','glow',new T.SphereGeometry(1,8,6),p,[0,0,0],[.011,.011,.011])); } }
 if(P.has('earfins')){ for(const z of [-1,1]){ const sh=new T.Shape(); sh.moveTo(0,0); sh.lineTo(-.22,.06); sh.lineTo(-.16,-.02); sh.lineTo(0,-.05); add('top','metal',new T.ExtrudeGeometry(sh,{depth:.008,bevelEnabled:false}),[.02,.0,z*.07],[z*.35,0,1.05],[.7,.7,1]); add('top','glow',new T.BoxGeometry(1,1,1),[-.02,-.06,z*.075],[z*.35,0,1.25],[.14,.008,.01]); } }
 if(P.has('brokenEar')){ add('top','metal',new T.BoxGeometry(1,1,1),[-.04,.02,.05],[.3,0,.5],[.05,.03,.035]); add('top','glow',new T.BoxGeometry(1,1,1),[-.04,.038,.05],[.3,0,.5],[.02,.004,.036]); }
 // 背フレーム: 原点=き甲
 if(P.has('dorsal')){ for(let k=0;k<6;k++){ const sh=new T.Shape(); const h=.09-k*.008; sh.moveTo(0,0); sh.lineTo(-.06,h); sh.lineTo(-.1,0); add('back','metal',new T.ExtrudeGeometry(sh,{depth:.01,bevelEnabled:false}),[-.02-k*.1,.0,-.005],[0,0,0],[1,1,1]); add('back','glow',new T.BoxGeometry(1,1,1),[-.05-k*.1,.004,0],[0,0,0],[.09,.006,.014]); } }
 if(P.has('spikes')){ for(const z of [-1,1]) for(let k=0;k<3;k++){ add('back','metal',new T.ConeGeometry(1,1,5),[.02-k*.08,.04,z*.07],[z*.6,0,.5],[.03,.17-k*.03,.03]); add('back','glow',new T.SphereGeometry(1,8,6),[.02-k*.08,.01,z*.07],[0,0,0],[.02,.02,.02]); } }
 // 翼（左右別フレームで羽ばたく）
 if(P.has('wingsFolded')||P.has('wingsSpread')){ const big=P.has('wingsSpread');
   for(const [fr,z] of [['wingL',1],['wingR',-1]]){ const n=big?7:5;
     add(fr,'metal',new T.BoxGeometry(1,1,1),[-.1,.07,z*.11],[z*.5,0,.3],[.2,.05,.05]); add(fr,'gold',new T.SphereGeometry(1,10,8),[-.04,.08,z*.12],[0,0,0],[.04,.04,.04]);
     for(let k=0;k<n;k++){ const t=k/(n-1), len=(big?.62:.42)*(1-t*.45), ang=(big?1.25:.6)-t*(big?.95:.45);
       const c=[-.1-t*.08,.08,z*(.12+t*.02)], rot=[z*(big?.75:.35),0,-ang];
       const m=new T.Matrix4().makeRotationFromEuler(new T.Euler(...rot)); const dir=new T.Vector3(-1,0,0).applyMatrix4(m);
       const cen=[c[0]+dir.x*len/2,c[1]+dir.y*len/2,c[2]+dir.z*len/2];
       add(fr,'metal',new T.BoxGeometry(1,1,1),cen,rot,[len,.03,.012]);
       add(fr,'glow',new T.BoxGeometry(1,1,1),[cen[0],cen[1]-.017,cen[2]],rot,[len*.95,.006,.016],isRB?rbCol:null); } } }
 // ---- 材質ごとに結合 ----
 const groups={};
 for(const fr of Object.keys(frames)){ if(!frames[fr].length) continue; const gp=new T.Group(); gp.name='NOA_'+fr; root.add(gp); groups[fr]=gp;
   const byMat={}; frames[fr].forEach(it=>{ (byMat[it.mat]=byMat[it.mat]||[]).push(it); });
   Object.entries(byMat).forEach(([mk,items])=>{ const col=items[0].mat==='glow'||items[0].mat==='crystal'; const geo=merge(T,items.map(it=>({geo:it.geo,m:it.m,col:it.col||(isRB?rbCol:new T.Color(0xffffff))})),isRB&&col);
     const me=new T.Mesh(geo,mats_[mk]); me.castShadow=mk!=='glow'; me.userData.noaCyber=true; gp.add(me); }); }
 // オーラ・光の粒（ルート追従、各1描画）
 let aura=null, pts=null;
 if(P.has('aura')){ const c=document.createElement('canvas'); c.width=c.height=128; const x=c.getContext('2d'), gr=x.createRadialGradient(64,64,0,64,64,64); gr.addColorStop(0,'rgba(255,220,120,.9)'); gr.addColorStop(.4,'rgba(255,190,60,.35)'); gr.addColorStop(1,'rgba(255,160,0,0)'); x.fillStyle=gr; x.fillRect(0,0,128,128);
   const tx=new T.CanvasTexture(c); aura=new T.Sprite(new T.SpriteMaterial({map:tx,transparent:true,blending:T.AdditiveBlending,depthWrite:false,opacity:.55})); aura.scale.set(L*1.5,H*1.4,1); aura.position.set(box.min.x+L*.5,box.min.y+H*.55,0); aura.userData.noaCyber=true; root.add(aura); }
 if(P.has('particles')){ const n=60, arr=new Float32Array(n*3), R=()=>Math.random(); for(let i=0;i<n;i++){ arr[i*3]=box.min.x-L*.3+R()*L*1.6; arr[i*3+1]=box.min.y+R()*H*1.4; arr[i*3+2]=(R()-.5)*H*1.2; }
   const pg=new T.BufferGeometry(); pg.setAttribute('position',new T.BufferAttribute(arr,3)); pts=new T.Points(pg,new T.PointsMaterial({color:0xff9be0,size:H*.03,transparent:true,opacity:.85,blending:T.AdditiveBlending,depthWrite:false})); pts.userData.noaCyber=true; root.add(pts); }
 // ---- 更新 ----
 const pN=new T.Vector3(),pF=new T.Vector3(),pW=new T.Vector3(),pC=new T.Vector3(),fwd=new T.Vector3(),up=new T.Vector3(),side=new T.Vector3(),basis=new T.Matrix4();
 let t=0;
 // ポーズ：13は後脚を支点に前を持ち上げる（近似）。
 const hindPivot=new T.Vector3(box.min.x+L*.22,box.min.y,0);
 if(scene.pose==='rear'){ poseG.position.copy(hindPivot); inner.position.copy(hindPivot).multiplyScalar(-1); }
 function update(dt,speed=1,distance=0){ t+=dt;
   if(scene.pose==='rear'){ const k=.5+.5*Math.sin(t*1.6); poseG.rotation.z=.25+.45*k; }
   if(scene.pose==='lookback'){ poseU.value=(1.7+.4*Math.sin(t*.9))*(opt.lookSign||1); }
   if(isRB){ const c=rainbowAt(t*.15); fx.setColor(c); }
   if(spec.flicker){ const f=(Math.sin(t*23)*Math.sin(t*7.3)>.35)?.15:1; const c=new T.Color(spec.neon).multiplyScalar(f); fx.setColor(c); mats_.glow.color.copy(c); }
   fx.update(dt,speed,1,distance);
   mats(); vert(A.nose,pN); vert(A.fore,pF); vert(A.withers,pW); vert(A.croup,pC);
   if(groups.head){ fwd.subVectors(pN,pF).normalize(); up.set(0,1,0); side.crossVectors(fwd,up).normalize(); up.crossVectors(side,fwd).normalize(); basis.makeBasis(fwd,up,side); groups.head.quaternion.setFromRotationMatrix(basis); groups.head.position.copy(pF).addScaledVector(up,-H*.07); }
   const bp=Math.atan2(pW.y-pC.y,pW.x-pC.x);
   for(const k of ['back','wingL','wingR']) if(groups[k]){ groups[k].position.copy(pW); groups[k].rotation.set(0,0,bp); }
   if(groups.wingL){ const fl=Math.sin(t*(P.has('wingsSpread')?5:3))*(P.has('wingsSpread')?.35:.12); groups.wingL.rotation.x=-fl; groups.wingR.rotation.x=fl; }
   if(aura){ aura.material.opacity=.45+.15*Math.sin(t*2.2); }
   if(pts){ pts.rotation.y=t*.15; }
 }
 update(0,0);
 return {spec,scene,fx,update,poseGroup:poseG,
   implemented:[...P].map(p=>PART_NAME[p]).concat([ spec.damage?'損傷（錆・傷の材質表現）':null, spec.flicker?'ネオンの点滅':null, scene.pose==='rear'?'立ち上がり（近似：体全体を後脚支点で起こす）':null, scene.pose==='lookback'?'振り返り（近似：首を頂点変形でひねる）':null]).filter(Boolean),
   dispose(){ fx.dispose(); Object.values(groups).forEach(gp=>{ gp.traverse(o=>{ if(o.geometry) o.geometry.dispose(); }); root.remove(gp); }); Object.values(mats_).forEach(m=>m.dispose()); if(aura){ aura.material.map.dispose(); aura.material.dispose(); root.remove(aura); } if(pts){ pts.geometry.dispose(); pts.material.dispose(); root.remove(pts); } } };
}
g.HORSE_VARIANTS=V; g.HORSE_SCENES=S; g.createHorseVariant=createVariant;
})(typeof window!=='undefined'?window:globalThis);
