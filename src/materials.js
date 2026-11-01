import * as THREE from 'three';

// 羊毛毡：底面是带深浅斑驳的哑光毛料，外面套几层绒毛壳，轮廓上有一圈细绒。
// 纤维按静止姿态下的 3D 坐标（fiber 属性）分格，戳扁拉长时跟着表面走，也没有贴图接缝。

const NOISE = /* glsl */ `
float fzHash3( vec3 p ) {
  p = fract( p * 0.1031 );
  p += dot( p, p.zyx + 31.32 );
  return fract( ( p.x + p.y ) * p.z );
}
vec3 fzHash33( vec3 p ) {
  p = fract( p * vec3( 0.1031, 0.1030, 0.0973 ) );
  p += dot( p, p.yxz + 33.33 );
  return fract( ( p.xxy + p.yxx ) * p.zyx );
}
float fzNoise( vec3 p ) {
  vec3 i = floor( p ), f = fract( p );
  f = f * f * ( 3.0 - 2.0 * f );
  return mix(
    mix( mix( fzHash3( i ), fzHash3( i + vec3( 1, 0, 0 ) ), f.x ), mix( fzHash3( i + vec3( 0, 1, 0 ) ), fzHash3( i + vec3( 1, 1, 0 ) ), f.x ), f.y ),
    mix( mix( fzHash3( i + vec3( 0, 0, 1 ) ), fzHash3( i + vec3( 1, 0, 1 ) ), f.x ), mix( fzHash3( i + vec3( 0, 1, 1 ) ), fzHash3( i + vec3( 1, 1, 1 ) ), f.x ), f.y ),
    f.z );
}
// 毛料的深浅：大块斑驳加细碎的纤维纹
float feltTone( vec3 p ) {
  return 0.9 + 0.12 * fzNoise( p * 9.0 ) + 0.06 * fzNoise( p * 60.0 );
}
`;

function feltBase(extraVert = '', extraFrag = '') {
  return (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\nattribute vec3 fiber;\nattribute vec3 fiberN;\nvarying vec3 vFiber;\nvarying vec3 vFiberN;\n${extraVert ? extraVert.split('@@')[0] : ''}`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>\nvFiber = fiber;\nvFiberN = fiberN;\n${extraVert ? extraVert.split('@@')[1] : ''}`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\nvarying vec3 vFiber;\nvarying vec3 vFiberN;\n${NOISE}\n${extraFrag ? extraFrag.split('@@')[0] : ''}`)
      .replace('#include <color_fragment>', `#include <color_fragment>\ndiffuseColor.rgb *= feltTone( vFiber );\n${extraFrag ? extraFrag.split('@@')[1] : ''}`);
  };
}

export function feltMaterial() {
  const m = new THREE.MeshPhysicalMaterial({
    color: '#ffffff',
    vertexColors: true,
    roughness: 1,
    metalness: 0,
    sheen: 0.6,
    sheenColor: '#fff4e6',
    sheenRoughness: 0.8,
  });
  m.onBeforeCompile = feltBase();
  m.customProgramCacheKey = () => 'felt';
  return m;
}

const FUZZ_VERT = /* glsl */ `
uniform float uFuzzLength;
uniform float uFuzzLayers;
attribute vec3 comb; // 抚摸留下的倒伏向量（世界空间，几何本身就在世界空间）
varying float vFuzzShell;
varying float vComb;
@@
float fzShell = float( gl_InstanceID + 1 ) / uFuzzLayers;
float fzComb = length( comb );
vFuzzShell = fzShell;
vComb = min( 1.0, fzComb );
transformed += normalize( normal ) * ( uFuzzLength * fzShell * ( 1.0 - 0.7 * vComb ) ); // 梳过的绒毛压得更平
transformed += comb * uFuzzLength * 3.0 * pow( fzShell, 1.5 ); // 顺着手势倒伏，越靠外倒得越多
transformed.y -= 0.35 * uFuzzLength * fzShell * fzShell; // 绒毛尖稍微往下耷拉
`;

const FUZZ_FRAG = /* glsl */ `
uniform float uFuzzDensity;
uniform float uFuzzCover;
varying float vFuzzShell;
varying float vComb;
@@
{
  float s = vFuzzShell;
  vec3 g = vFiber * uFuzzDensity;
  vec3 cell = floor( g );
  vec3 local = fract( g ) - 0.5;

  // 每格最多一根纤维，cover 决定多少格里有
  if ( fzHash3( cell + 3.7 ) > uFuzzCover ) discard;
  float hgt = 0.25 + 0.8 * pow( fzHash3( cell + 11.3 ), 1.4 );
  if ( s > hgt ) discard;

  // 纤维越往外越细，并朝一个随机方向歪；只量切平面里的距离，所以截面是圆的
  float rad = 0.3 * ( 1.0 - 0.8 * ( s / hgt ) );
  vec3 c = ( fzHash33( cell + 5.1 ) - 0.5 ) * 0.3 + ( fzHash33( cell + 9.9 ) - 0.5 ) * 0.5 * s;
  vec3 n = normalize( vFiberN );
  vec3 d = local - c;
  d -= dot( d, n ) * n;
  if ( length( d ) > rad ) discard;

  // 根部稍暗、尖上亮，假装自阴影
  diffuseColor.rgb *= mix( 0.84, 1.06, pow( s, 0.7 ) ) * mix( 0.94, 1.06, fzHash3( cell + 1.9 ) );
  diffuseColor.rgb *= 1.0 + 0.25 * vComb; // 梳顺的绒毛像刷过的羊毛，亮一点
}
`;

// 轮廓上绒毛自带的亮度，所有动物共用；环境暗下来时要跟着调低，不然绒毛比身体亮，满身白点
export const fuzzGlow = { value: 0.35 };

// 绒毛壳：同一份几何画 layers 次，每层沿法线往外推一点，片元里只留细细的纤维
export function addFuzz(mesh, { length = 0.02, density = 110, layers = 5, cover = 0.7 } = {}) {
  const uniforms = {
    uFuzzLength: { value: length },
    uFuzzLayers: { value: layers },
    uFuzzDensity: { value: density },
    uFuzzCover: { value: cover },
  };
  const material = new THREE.MeshLambertMaterial({ color: '#ffffff', vertexColors: true }); // 壳层多，用便宜的光照
  const base = feltBase(FUZZ_VERT, FUZZ_FRAG);
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms, { uFuzzGlow: fuzzGlow });
    base(shader);
    // 轮廓上的绒毛背光，自己带一点亮度，免得一圈脏黑点
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uFuzzGlow;')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += diffuseColor.rgb * uFuzzGlow;');
  };
  material.customProgramCacheKey = () => 'feltFuzz';

  const fuzz = new THREE.InstancedMesh(mesh.geometry, material, layers);
  const identity = new THREE.Matrix4();
  for (let i = 0; i < layers; i++) fuzz.setMatrixAt(i, identity);
  fuzz.instanceMatrix.needsUpdate = true;
  fuzz.receiveShadow = true;
  fuzz.frustumCulled = false;
  mesh.add(fuzz);
  return fuzz;
}
