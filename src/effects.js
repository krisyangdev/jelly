import * as THREE from 'three';

// 戳出来的小爱心、星星、闪光和睡觉的 Z，全部是 canvas 画的贴纸
function sticker(draw) {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  g.translate(64, 64);
  g.lineJoin = g.lineCap = 'round';
  draw(g);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

const outline = (g, fill) => {
  g.fillStyle = fill;
  g.fill();
  g.lineWidth = 7;
  g.strokeStyle = 'rgba(255,255,255,0.95)';
  g.stroke();
};

const WHITE = new THREE.Color('#ffffff');

const TEX = {
  heart: sticker((g) => {
    g.beginPath();
    g.moveTo(0, 40);
    g.bezierCurveTo(-70, -5, -35, -60, 0, -25);
    g.bezierCurveTo(35, -60, 70, -5, 0, 40);
    outline(g, '#ff5c8a');
  }),
  star: sticker((g) => {
    g.beginPath();
    for (let i = 0; i < 10; i++) {
      const r = i % 2 ? 22 : 50, a = -Math.PI / 2 + (i * Math.PI) / 5;
      g.lineTo(Math.cos(a) * r, Math.sin(a) * r);
    }
    g.closePath();
    outline(g, '#ffd23f');
  }),
  sparkle: sticker((g) => {
    g.beginPath();
    for (let i = 0; i < 8; i++) {
      const r = i % 2 ? 9 : 52, a = (i * Math.PI) / 4;
      g.lineTo(Math.cos(a) * r, Math.sin(a) * r);
    }
    g.closePath();
    g.fillStyle = '#ffffff';
    g.fill();
  }),
  // 弹走时散开的一团团绒毛
  puff: sticker((g) => {
    const r = g.createRadialGradient(0, 0, 0, 0, 0, 58);
    r.addColorStop(0, 'rgba(255,250,240,1)');
    r.addColorStop(0.55, 'rgba(250,240,224,0.9)');
    r.addColorStop(1, 'rgba(250,240,224,0)');
    g.fillStyle = r;
    g.beginPath();
    g.arc(0, 0, 58, 0, Math.PI * 2);
    g.fill();
  }),
  z: sticker((g) => {
    g.font = 'bold 96px ui-rounded, "Arial Rounded MT Bold", sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.lineWidth = 10;
    g.strokeStyle = '#ffffff';
    g.strokeText('z', 0, 4);
    g.fillStyle = '#7d8cff';
    g.fillText('z', 0, 4);
  }),
};

export function createEffects(scene) {
  const live = [];
  const pool = [];

  function emit(kind, pos, vel, { size = 0.16, life = 0.8, gravity = -3, spin = 0, color } = {}) {
    const s = pool.pop() ?? new THREE.Sprite(new THREE.SpriteMaterial({ transparent: true, depthWrite: false, toneMapped: false }));
    s.material.map = TEX[kind];
    s.material.color.set(color ?? '#ffffff');
    s.material.rotation = Math.random() * 0.6 - 0.3;
    s.material.opacity = 1;
    s.position.copy(pos);
    s.renderOrder = 20;
    s.userData = { vel: vel.clone(), size, life, age: 0, gravity, spin };
    s.scale.setScalar(0.001);
    scene.add(s);
    live.push(s);
    return s;
  }

  const v = new THREE.Vector3();
  return {
    // 戳一下：爱心和闪光往外蹦
    burst(pos, { count = 6, kinds = ['heart', 'sparkle'], speed = 2.4, size = 0.26 } = {}) {
      for (let i = 0; i < count; i++) {
        const a = Math.random() * Math.PI * 2;
        v.set(Math.cos(a), 1.2 + Math.random(), Math.sin(a)).normalize().multiplyScalar(speed * (0.6 + Math.random() * 0.6));
        const kind = kinds[i % kinds.length];
        emit(kind, pos, v, { size: size * (kind === 'sparkle' ? 0.8 : 1) * (0.7 + Math.random() * 0.5), life: 0.6 + Math.random() * 0.4, spin: (Math.random() - 0.5) * 6 });
      }
    },
    // 噗地一下弹走：一圈绒毛团往外散，再加几颗星星
    poof(pos, color) {
      const tint = new THREE.Color(color).lerp(WHITE, 0.6); // 淡一点，免得在暖色背景上发灰
      for (let i = 0; i < 14; i++) {
        const a = (i / 14) * Math.PI * 2 + Math.random() * 0.4;
        v.set(Math.cos(a), 0.4 + Math.random() * 0.8, Math.sin(a)).multiplyScalar(1.8 + Math.random() * 1.4);
        emit('puff', pos, v, { size: 0.42 + Math.random() * 0.24, life: 0.6 + Math.random() * 0.3, gravity: 0.6, color: tint });
      }
      for (let i = 0; i < 6; i++) {
        v.set(Math.random() - 0.5, 1.2, Math.random() - 0.5).normalize().multiplyScalar(2.6);
        emit(i % 2 ? 'star' : 'sparkle', pos, v, { size: 0.22, life: 0.7, spin: (Math.random() - 0.5) * 6 });
      }
    },
    // 睡着时头上冒的 z
    zzz(pos) {
      v.set(0.15 + Math.random() * 0.1, 0.35, 0);
      emit('z', pos.clone().setY(pos.y + 0.15), v, { size: 0.2 + Math.random() * 0.08, life: 2.2, gravity: 0 });
    },
    update(dt) {
      for (let i = live.length - 1; i >= 0; i--) {
        const s = live[i], d = s.userData;
        d.age += dt;
        const k = d.age / d.life;
        if (k >= 1) {
          scene.remove(s);
          live.splice(i, 1);
          pool.push(s);
          continue;
        }
        d.vel.y += d.gravity * dt;
        d.vel.multiplyScalar(Math.exp(-dt * 2.5));
        s.position.addScaledVector(d.vel, dt);
        s.material.rotation += d.spin * dt;
        // 先弹大再慢慢缩小淡出
        const pop = k < 0.15 ? THREE.MathUtils.smootherstep(k / 0.15, 0, 1) * 1.25 : 1.25 - 0.25 * Math.min(1, (k - 0.15) / 0.2);
        s.scale.setScalar(d.size * pop * (1 - 0.3 * k));
        s.material.opacity = k > 0.6 ? 1 - (k - 0.6) / 0.4 : 1;
      }
    },
  };
}

// 晕的时候绕着头转的三颗小星星
export function createDizzyStars(scene) {
  const group = new THREE.Group();
  for (let i = 0; i < 3; i++) {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: TEX.star, transparent: true, depthWrite: false, toneMapped: false }));
    s.scale.setScalar(0.19);
    s.renderOrder = 20;
    group.add(s);
  }
  group.visible = false;
  scene.add(group);
  return {
    update(head, t, on) {
      group.visible = on;
      if (!on) return;
      group.position.copy(head);
      group.children.forEach((s, i) => {
        const a = t * 5 + (i * Math.PI * 2) / 3;
        s.position.set(Math.cos(a) * 0.4, Math.sin(a * 2) * 0.04, Math.sin(a) * 0.4);
      });
    },
    dispose() {
      group.removeFromParent();
      for (const s of group.children) s.material.dispose();
    },
  };
}
