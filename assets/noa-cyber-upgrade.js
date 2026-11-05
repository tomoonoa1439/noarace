/* MIT. Additive cyber styling for an existing animated horse. THREE r128+. */
(function(global){'use strict';
function attachCyberStyle(THREE,root,opt={}){
 const meshes=[];root.traverse(o=>{if(o.isMesh&&!o.userData.noaCyber)meshes.push(o);});
 if(!meshes.length)throw Error('馬のMeshがありません');
 const source=opt.mesh||meshes.reduce((a,b)=>a.geometry.attributes.position.count>b.geometry.attributes.position.count?a:b);
 if(source.isSkinnedMesh)throw Error('v3はモーフ馬用です。骨格モデルにはボーン追従の実装が必要です。');
 if(meshes.some(m=>m.geometry.isInstancedBufferGeometry))throw Error('インスタンス馬は未対応です');
 const pos=source.geometry.attributes.position, morph=source.geometry.morphAttributes.position||[];
 const invert=new THREE.Matrix4(),mat=new THREE.Matrix4(),v=new THREE.Vector3(),base=new THREE.Vector3(),delta=new THREE.Vector3();
 const bounds=new THREE.Box3();
 function matrices(){root.updateWorldMatrix(true,true);invert.copy(root.matrixWorld).invert();mat.multiplyMatrices(invert,source.matrixWorld);}
 function vertex(i,out){base.fromBufferAttribute(pos,i);out.copy(base);for(let k=0;k<morph.length;k++){const w=(source.morphTargetInfluences||[])[k]||0;if(w){delta.fromBufferAttribute(morph[k],i);if(!source.geometry.morphTargetsRelative)delta.sub(base);out.addScaledVector(delta,w);}}if(opt.deform)opt.deform(out);return out.applyMatrix4(mat);}
 matrices();for(let i=0;i<pos.count;i++)bounds.expandByPoint(v.fromBufferAttribute(pos,i).applyMatrix4(mat));
 const size=bounds.getSize(new THREE.Vector3()),height=size.y;
 if(height<=0)throw Error('モデルの高さが不正です');
 const axis=opt.forwardAxis||'z', sign=opt.forwardSign===-1?-1:1;
 if(axis!=='x'&&axis!=='z')throw Error('forwardAxisはxまたはzです');
 const sideways=axis==='x'?'z':'x', len=size[axis],mid=bounds.getCenter(new THREE.Vector3());
 function nearest(x,y,z){const p=new THREE.Vector3(x,y,z);let best=0,d=Infinity;for(let i=0;i<pos.count;i++){v.fromBufferAttribute(pos,i).applyMatrix4(mat);const d2=v.distanceToSquared(p);if(d2<d){d=d2;best=i;}}return best;}
 function point(f,y,s=0){const p=mid.clone();p[axis]+=sign*len*f;p.y=bounds.min.y+height*y;p[sideways]+=size[sideways]*s;return p;}
 function anchor(f,y,s=0){const p=point(f,y,s);return nearest(p.x,p.y,p.z);}
 // All decorations (hair, outline accents, cores) share ONE LineSegments object.
 const segments=[],a=new THREE.Vector3(),b=new THREE.Vector3();
 function segment(ia,ib,oa,ob){segments.push({ia,ib,oa,ob});}
 function offset(f,y,s){const p=new THREE.Vector3();p[axis]=sign*f*height;p.y=y*height;p[sideways]=s*height;return p;}
 const anchors=opt.anchors||{};
 const mane=anchors.mane||Array.from({length:6},(_,i)=>anchor(.15+i*.045,.65+i*.046));
 const tail=anchors.tail===undefined?anchor(-.34,.57):anchors.tail;
 const fiberCount=Math.max(4,Math.min(16,opt.fibers||10)),steps=12;
 for(let n=0;n<fiberCount;n++){
  const id=mane[n%mane.length];for(let j=0;j<steps;j++)segment(id,id,{hair:true,t:j/steps,n,kind:0},{hair:true,t:(j+1)/steps,n,kind:0});
 }
 for(let n=0;n<Math.max(4,Math.floor(fiberCount*.6));n++)for(let j=0;j<steps;j++)segment(tail,tail,{hair:true,t:j/steps,n,kind:1},{hair:true,t:(j+1)/steps,n,kind:1});
 const nearCount=segments.length*6;
 for(const side of [-.5,.5])for(const f of [-.25,.2]){const id=anchor(f,.6,side);for(let j=0;j<16;j++){const o=t=>offset(.045*Math.cos(t),.045*Math.sin(t),Math.sign(side)*.012);segment(id,id,o(j*Math.PI/8),o((j+1)*Math.PI/8));}}
 const array=new Float32Array(segments.length*18),geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.BufferAttribute(array,3).setUsage(THREE.DynamicDrawUsage));
 const material=new THREE.MeshBasicMaterial({color:opt.color===undefined?0xff354a:opt.color,toneMapped:false,side:THREE.DoubleSide});
 const lines=new THREE.Mesh(geometry,material);lines.name='NOA_CyberFibers';lines.userData.noaCyber=true;lines.frustumCulled=false;root.add(lines);
 const originals=[],owned=[];
 const removed=[];
 const hidden=[];
 // Only style the actual horse body; never infer jockey identity from its size/name.
 const targets=opt.bodyMeshes||[source];
 const neonUniform={value:new THREE.Color(opt.color===undefined?0xff354a:opt.color)};
 if(opt.silver!==false){targets.forEach(m=>{
  const original=m.material,oldGeometry=m.geometry;
  if(!m.geometry.attributes.normal){m.geometry=m.geometry.clone();m.geometry.computeVertexNormals();removed.push([m,oldGeometry,m.geometry]);}
  const localBox=new THREE.Box3().setFromBufferAttribute(m.geometry.attributes.position),sz=localBox.getSize(new THREE.Vector3()),center=localBox.getCenter(new THREE.Vector3());
  const convert=old=>{
   const c=new THREE.MeshStandardMaterial({color:opt.armorColor===undefined?0xd4dfeb:opt.armorColor,metalness:opt.metalness===undefined?.68:opt.metalness,roughness:.3,side:old.side,vertexColors:false,flatShading:false,wireframe:false,morphTargets:!!m.geometry.morphAttributes.position,morphNormals:false});
   c.onBeforeCompile=shader=>{
    shader.uniforms.noaNeon=neonUniform;shader.uniforms.noaCenter={value:center};shader.uniforms.noaSize={value:sz};
    shader.vertexShader='varying vec3 vNoaRest;\n'+shader.vertexShader;
    shader.vertexShader=shader.vertexShader.replace('#include <begin_vertex>','#include <begin_vertex>\nvNoaRest=position;');
    if(opt.shaderDeform){shader.uniforms.noaPose=opt.poseUniform;shader.vertexShader='uniform float noaPose;\n'+shader.vertexShader;shader.vertexShader=shader.vertexShader.replace('#include <morphtarget_vertex>','#include <morphtarget_vertex>\n'+opt.shaderDeform);}
    shader.fragmentShader='#define NOA_NP '+(opt.neonPower||1).toFixed(2)+'\n'+'varying vec3 vNoaRest; uniform vec3 noaNeon; uniform vec3 noaCenter; uniform vec3 noaSize;\n'+shader.fragmentShader;
    shader.fragmentShader=shader.fragmentShader.replace('#include <color_fragment>',`#include <color_fragment>
     vec3 np=(vNoaRest-noaCenter)/max(noaSize,vec3(0.0001));
     float f=np.${axis}; float y=np.y; float side=np.${sideways};
     vec2 plate=vec2(f*7.0+y*1.3,y*6.0);
     vec2 cell=fract(plate);vec2 edge=min(cell,1.0-cell);
     float seam=1.0-smoothstep(0.012,0.035,min(edge.x,edge.y));
     float stripe=1.0-smoothstep(0.008,0.018,abs(fract(f*3.0+y*1.3)-0.5));
     stripe*=smoothstep(0.12,0.24,abs(side));
     float rivet=1.0-smoothstep(0.034,0.058,length(cell-vec2(0.12,0.12)));
     float scuff=0.035*sin(f*410.0+y*16.0)*sin(y*350.0+side*70.0);
     diffuseColor.rgb=mix(diffuseColor.rgb*(0.95+scuff),vec3(0.018,0.026,0.04),seam*0.9);
     diffuseColor.rgb=mix(diffuseColor.rgb,vec3(0.65,0.40,0.12),rivet);
     ${opt.damage?`float rust=smoothstep(0.55,0.9,0.5+0.5*sin(f*37.0+y*23.0)*sin(y*19.0-f*11.0+side*31.0));diffuseColor.rgb=mix(diffuseColor.rgb,vec3(0.32,0.15,0.06),rust*${(+opt.damage).toFixed(2)});float scratch=1.0-smoothstep(0.0,0.02,abs(fract(f*23.0-y*9.0)-0.5));diffuseColor.rgb=mix(diffuseColor.rgb,vec3(0.05),scratch*0.5*${(+opt.damage).toFixed(2)});`:''}
     diffuseColor.rgb=mix(diffuseColor.rgb,noaNeon,min(1.0,stripe*0.55*NOA_NP));
    `);
    shader.fragmentShader=shader.fragmentShader.replace('#include <emissivemap_fragment>','#include <emissivemap_fragment>\ntotalEmissiveRadiance += noaNeon * stripe * 1.4 * NOA_NP;');
   };
   c.customProgramCacheKey=()=> 'NOA_Armor_v3_'+axis+'_'+(opt.neonPower||1).toFixed(2)+(opt.shaderDeform?'_d':'')+(opt.damage?'_x':'');
   owned.push(c);return c;
  };
  m.material=Array.isArray(original)?original.map(convert):convert(original);originals.push([m,original,m.material]);
 });}
 if(opt.hideExistingLines!==false)root.traverse(o=>{if(o!==lines&&(o.isLine||o.isLineSegments)){hidden.push([o,o.visible]);o.visible=false;}});
 (opt.hideObjects||[]).forEach(o=>{hidden.push([o,o.visible]);o.visible=false;});
 let t=opt.phase||0,elapsed=1,disposed=false;
 const cache=new Map(),outA=new THREE.Vector3(),outB=new THREE.Vector3(),off=new THREE.Vector3();
 for(const s of segments){cache.set(s.ia,new THREE.Vector3());cache.set(s.ib,new THREE.Vector3());}
 function endpoint(id,o,out,speed,wind){out.copy(cache.get(id));if(o.hair){const u=o.t,l=(o.kind?.82:.48)*(opt.hairLength||1);off.copy(offset(-u*l,-u*u*(o.kind?.18:.14),(o.n%3-1)*.006));off[sideways]+=height*u*u*.04*wind*Math.sin(t*5-u*4+o.n*.7);off.y+=height*u*.025*wind*Math.sin(t*6-u*5+o.n*.4);off[axis]-=sign*height*u*.07*speed;out.add(off);}else out.add(o);}
 function update(dt,speed=1,wind=1,distance=0){if(disposed)return;dt=Number.isFinite(dt)?Math.max(0,Math.min(.1,dt)):0;speed=Number.isFinite(speed)?Math.max(0,Math.min(2,speed)):0;wind=Number.isFinite(wind)?Math.max(0,Math.min(2,wind)):0;t+=dt;elapsed+=dt;
  lines.visible=distance<45*height;if(!lines.visible)return;
  const far=distance>15*height;geometry.setDrawRange(0,far?nearCount:segments.length*6);
  if(elapsed<(far?1/15:1/30))return;elapsed=0;matrices();cache.forEach((p,i)=>vertex(i,p));
  let k=0;const right=new THREE.Vector3(),tangent=new THREE.Vector3(),up=new THREE.Vector3(0,1,0),aa=new THREE.Vector3(),bb=new THREE.Vector3();
  for(const s of segments){endpoint(s.ia,s.oa,outA,speed,wind);endpoint(s.ib,s.ob,outB,speed,wind);
   tangent.subVectors(outB,outA).normalize();right.crossVectors(tangent,up);if(right.lengthSq()<0.001)right.set(1,0,0);right.normalize();
   const HW=opt.hairWidth||1,wa=height*HW*(s.oa.hair?.0018*(1-s.oa.t*.93):.003),wb=height*HW*(s.ob.hair?.0018*(1-s.ob.t*.93):.003);
   function put(p,side,w){aa.copy(p).addScaledVector(right,side*w);array[k++]=aa.x;array[k++]=aa.y;array[k++]=aa.z;}
   put(outA,-1,wa);put(outB,-1,wb);put(outA,1,wa);put(outA,1,wa);put(outB,-1,wb);put(outB,1,wb);
  }geometry.attributes.position.needsUpdate=true;

 }
 update(0,0,0);
 return {lines,stats:{addedDrawCalls:1,lineSegments:segments.length,anchorVertices:cache.size},setColor(c){material.color.set(c);neonUniform.value.set(c);},update,dispose(){if(disposed)return;disposed=true;root.remove(lines);geometry.dispose();material.dispose();originals.forEach(([m,old,ours])=>{if(m.material===ours)m.material=old;});owned.forEach(m=>m.dispose());removed.forEach(([m,old,ours])=>{if(m.geometry===ours)m.geometry=old;ours.dispose();});hidden.forEach(([o,visible])=>o.visible=visible);}};
}
global.attachCyberStyle=attachCyberStyle;
})(typeof window!=='undefined'?window:globalThis);
