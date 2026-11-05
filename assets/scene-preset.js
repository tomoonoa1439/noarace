/* Optional one-time lighting for the whole race, not once per horse. MIT. */
(function(g){g.installNoaCyberLighting=function(T,scene,renderer){
 const old={toneMapping:renderer.toneMapping,toneMappingExposure:renderer.toneMappingExposure,outputEncoding:renderer.outputEncoding,environment:scene.environment};
 renderer.toneMapping=T.ACESFilmicToneMapping;renderer.toneMappingExposure=1.1;if(T.sRGBEncoding)renderer.outputEncoding=T.sRGBEncoding;
 const hemi=new T.HemisphereLight(0xcbdfff,0x111522,.8),key=new T.DirectionalLight(0xfff2dd,1.8),rim=new T.DirectionalLight(0x89baff,1.2);key.position.set(4,7,3);rim.position.set(-4,4,-5);const lights=[hemi,key,rim];lights.forEach(l=>{l.castShadow=false;scene.add(l);});
 // Bright light cards give silver an actual reflection without any HDR download.
 const studio=new T.Scene();studio.background=new T.Color(0x252e42);const resources=[];
 [[0,5,0,5,1,5,0xe0edff],[4,1,0,.2,5,6,0xa5c4ff],[-4,2,-2,.2,4,4,0xffe4c0]].forEach(([x,y,z,w,h,d,c])=>{const geo=new T.BoxGeometry(w,h,d),mat=new T.MeshBasicMaterial({color:c}),mesh=new T.Mesh(geo,mat);mesh.position.set(x,y,z);studio.add(mesh);resources.push(geo,mat);});
 const pmrem=new T.PMREMGenerator(renderer),target=pmrem.fromScene(studio,.08,.1,100);scene.environment=target.texture;pmrem.dispose();resources.forEach(o=>o.dispose());
 return {dispose(){lights.forEach(l=>scene.remove(l));if(scene.environment===target.texture)scene.environment=old.environment;target.dispose();renderer.toneMapping=old.toneMapping;renderer.toneMappingExposure=old.toneMappingExposure;if(old.outputEncoding!==undefined)renderer.outputEncoding=old.outputEncoding;}};
};})(typeof window!=='undefined'?window:globalThis);
