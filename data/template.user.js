// blaze-pedia/data/template.user.js

const LICENSE_KEY = '__BLAZE_LICENSE__';
const API_BASE = '__BLAZE_API__';
const CANARY = '__BLAZE_CANARY__';

const panel = document.createElement('div');
panel.style.cssText = 'position:fixed;left:10px;bottom:34px;z-index:2147483647;color:#ffd27a;font:11px Tahoma,sans-serif;text-shadow:0 1px 2px #000;pointer-events:none;white-space:nowrap';
panel.textContent = 'BLAZE LICENSE: CHECKING';
const mountPanel = () => {
  const parent = document.body || document.documentElement;
  if (panel.parentNode !== parent) parent.appendChild(panel);
};
mountPanel();
if (!document.body) document.addEventListener('DOMContentLoaded', mountPanel, { once: true });

const setNotice = (text, bad) => {
  panel.textContent = text;
  panel.style.color = bad ? '#ff6b7a' : '#8effb0';
};

const deviceId = (() => {
  let seed = '';
  try { seed = localStorage.getItem('blaze_device_seed') || ''; } catch (_) {}
  if (!seed) {
    const bytes = new Uint32Array(2);
    if (window.crypto && crypto.getRandomValues) crypto.getRandomValues(bytes);
    else { bytes[0] = (Math.random() * 4294967295) >>> 0; bytes[1] = (Math.random() * 4294967295) >>> 0; }
    seed = bytes[0].toString(16) + bytes[1].toString(16);
    try { localStorage.setItem('blaze_device_seed', seed); } catch (_) {}
  }
  const raw = [navigator.userAgent, navigator.language, screen.width + 'x' + screen.height,
    (Intl.DateTimeFormat().resolvedOptions().timeZone || ''), seed].join('|');
  let h = 2166136261;
  for (let i = 0; i < raw.length; i++) {
    h ^= raw.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16).padStart(8, '0') + '-' + seed.slice(0, 8);
})();

const cachedLicense = () => {
  try { return JSON.parse(localStorage.getItem('blaze_license_cache') || 'null'); }
  catch (_) { return null; }
};

const runCached = () => {
  const c = cachedLicense();
  if (!c || c.key !== LICENSE_KEY || c.device !== deviceId || !c.expiresAt || Date.parse(c.expiresAt) <= Date.now()) {
    return false;
  }
  setNotice('BLAZE LICENSE: OFFLINE OK');
  setTimeout(() => panel.remove(), 3500);
  return true;
};

const verifyLicense = async () => {
  if (!API_BASE || API_BASE.indexOf('__BLAZE') === 0) {
    setNotice('BLAZE LICENSE: API BELUM DISET', true);
    return false;
  }
  try {
    const response = await fetch(API_BASE + '/api/license/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: LICENSE_KEY, deviceId, canary: CANARY })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.active) {
      if (runCached()) return true;
      const reason = String(data.reason || 'INVALID').toUpperCase();
      setNotice('BLAZE LICENSE: ' + reason, true);
      window.__BLAZE_BLOCKED = reason;
      return false;
    }
    try {
      localStorage.setItem('blaze_license_cache', JSON.stringify({
        key: LICENSE_KEY,
        device: deviceId,
        expiresAt: data.expiresAt
      }));
    } catch (_) {}
    setNotice('BLAZE LICENSE: AKTIF s/d ' + String(data.expiresAt).slice(0, 10));
    setTimeout(() => panel.remove(), 3500);
    return true;
  } catch (_) {
    if (runCached()) return true;
    setNotice('BLAZE LICENSE: SERVER OFFLINE', true);
    window.__BLAZE_BLOCKED = 'SERVER_OFFLINE';
    return false;
  }
};

verifyLicense().then(ok => {
  if (ok) blazeStart();
});

// BP-CANARY: __BLAZE_CANARY__

function blazeStart() {

  'use strict';

  const BUNDLE_PATH = '/static/game/bundle.js';
  const CFG_KEY = 'pb_simple_kit_v1';

  const EXPORT_BLOCK = `
;window.__PBS = {
  get Ye(){ return Ye },
  get ents(){ return _t },
  get cam(){ return F },
  get V3(){ return o.Vector3 },
  get ms(){ return ms },
  get gs(){ return gs },
  get fs(){ return fs },
  get Q(){ return Q },
  get uo(){ return uo },
  get me(){ return Ye.s },
  ready: true
};`;

  let cfg = { aim: true, esp: true, head: true, fov: 42, smooth: 13, maxDist: 190 };
  try {
    const raw = localStorage.getItem(CFG_KEY);
    if (raw) cfg = { ...cfg, ...JSON.parse(raw) };
  } catch (_) {}

  const save = () => {
    try { localStorage.setItem(CFG_KEY, JSON.stringify(cfg)); } catch (_) {}
  };

  const srcDesc = Object.getOwnPropertyDescriptor(HTMLScriptElement.prototype, 'src');
  Object.defineProperty(HTMLScriptElement.prototype, 'src', {
    configurable: true,
    get() { return this.__pbsOriginalSrc || srcDesc.get.call(this); },
    set(value) { srcDesc.set.call(this, value); }
  });

  const rawSrc = el => srcDesc.get.call(el) || '';
  const isBundle = el => el && el.tagName === 'SCRIPT' && rawSrc(el).indexOf(BUNDLE_PATH) !== -1;

  const patchSource = source => {
    const at = source.lastIndexOf('})();');
    if (at < 0) throw new Error('bundle tail not found');
    return source.slice(0, at) + EXPORT_BLOCK + source.slice(at);
  };

  const loadPatched = async script => {
    if (script.__pbsDone) return;
    script.__pbsDone = true;

    const original = rawSrc(script);
    script.type = 'text/plain';
    script.removeAttribute('integrity');
    script.removeAttribute('crossorigin');
    script.__pbsOriginalSrc = original;

    try {
      const response = await fetch(original, { credentials: 'same-origin', cache: 'force-cache' });
      if (!response.ok) throw new Error('HTTP ' + response.status);

      const source = patchSource(await response.text());
      const url = URL.createObjectURL(new Blob([source], { type: 'application/javascript' }));
      const next = document.createElement('script');
      next.__pbsOriginalSrc = original;
      next.async = false;
      next.src = url;
      (document.head || document.documentElement).appendChild(next);
      setTimeout(() => URL.revokeObjectURL(url), 30000);
    } catch (error) {
      console.warn('[kit] patch failed', error);
      script.type = 'text/javascript';
    }
  };

  const watchBundle = () => {
    const root = document.documentElement || document;
    document.querySelectorAll('script[src]').forEach(el => {
      if (isBundle(el)) loadPatched(el);
    });

    const observer = new MutationObserver(records => {
      for (const record of records) {
        if (record.type === 'attributes' && isBundle(record.target)) loadPatched(record.target);
        for (const node of record.addedNodes || []) {
          if (node.nodeType !== 1) continue;
          if (isBundle(node)) loadPatched(node);
          if (node.querySelectorAll) {
            node.querySelectorAll('script[src]').forEach(el => {
              if (isBundle(el)) loadPatched(el);
            });
          }
        }
      }
    });

    observer.observe(root, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['src']
    });
  };

  watchBundle();

  const canvas = document.createElement('canvas');
  canvas.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;pointer-events:none;z-index:2147483646';

  const hud = document.createElement('div');
  hud.style.cssText = 'position:fixed;left:10px;bottom:10px;z-index:2147483647;color:#ffd27a;font:11px Tahoma,sans-serif;text-shadow:0 1px 2px #000;pointer-events:none;white-space:nowrap';
  hud.textContent = 'KIT LOADING';

  const mount = el => {
    const parent = document.body || document.documentElement;
    if (el.parentNode !== parent) parent.appendChild(el);
  };
  mount(canvas);
  mount(hud);

  if (!document.body) {
    document.addEventListener('DOMContentLoaded', () => {
      mount(canvas);
      mount(hud);
      resize();
    }, { once: true });
  }

  const ctx = canvas.getContext('2d');

  let dpr = 1;
  const resize = () => {
    dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.max(1, Math.floor(innerWidth * dpr));
    canvas.height = Math.max(1, Math.floor(innerHeight * dpr));
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  };
  resize();
  addEventListener('resize', resize);

  addEventListener('keydown', event => {
    if (event.code === 'F2') {
      cfg.aim = !cfg.aim;
    } else if (event.code === 'F3') {
      cfg.esp = !cfg.esp;
    } else if (event.code === 'F4') {
      cfg.head = !cfg.head;
    } else {
      return;
    }
    event.preventDefault();
    event.stopImmediatePropagation();
    save();
    updateHud();
  }, true);

  let H = null;
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const wrap = a => Math.atan2(Math.sin(a), Math.cos(a));

  const updateHud = () => {
    hud.textContent = `F2 BIDIK ${cfg.aim ? 'ON' : 'OFF'}  F3 TAMPIL ${cfg.esp ? 'ON' : 'OFF'}  F4 KEPALA ${cfg.head ? 'ON' : 'OFF'}`;
  };
  updateHud();

  const aimPoint = entity => {
    const c = entity.c && entity.c.byName;
    const bone = c && (c.Head || c.Bone_HeadGearAttach);
    if (bone && bone.matrixWorld) {
      return new H.V3().setFromMatrixPosition(bone.matrixWorld);
    }
    const point = H.gs(entity);
    point.y += (entity.hitH || 1.8) - 0.18;
    return point;
  };

  const bodyPoint = entity => {
    const point = H.gs(entity);
    point.y += (entity.hitH || 1.8) * 0.55;
    return point;
  };

  const clearShot = (origin, direction, distance) => {
    const hit = H.Q(origin, direction, distance);
    return !hit || hit.t >= distance - 0.12;
  };

  const pick = () => {
    const me = H.me;
    if (!me || me.dead || !H.ents) return null;

    const eye = H.fs(me);
    const forward = H.ms(me.yaw, me.pitch);
    let best = null;
    let bestScore = Infinity;

    for (let i = 0; i < H.ents.length && i < 128; i++) {
      const entity = H.ents[i];
      if (!entity || entity === me || entity.dead || entity.hp <= 0 || !entity.mover) continue;
      if (!H.uo(entity, me)) continue;

      const point = cfg.head ? aimPoint(entity) : bodyPoint(entity);
      const delta = point.clone().sub(eye);
      const distance = delta.length();
      if (distance < 0.1 || distance > cfg.maxDist) continue;
      delta.divideScalar(distance);

      const hit = entity.hitTest(eye, delta, distance + 1.5);
      if (!hit || !clearShot(eye, delta, hit.t)) continue;

      const angle = Math.acos(clamp(forward.dot(delta), -1, 1)) * 180 / Math.PI;
      if (angle > cfg.fov) continue;

      const score = angle + distance * 0.08;
      if (score < bestScore) {
        bestScore = score;
        best = { point, angle };
      }
    }
    return best;
  };

  const aim = (target, dt) => {
    if (!target) return;
    const me = H.me;
    const delta = target.point.clone().sub(H.fs(me));
    if (delta.lengthSq() < 0.0001) return;
    delta.normalize();

    const yaw = Math.atan2(-delta.x, -delta.z);
    const pitch = Math.asin(clamp(delta.y, -1, 1));
    const alpha = 1 - Math.exp(-cfg.smooth * dt);

    me.yaw = wrap(me.yaw + wrap(yaw - me.yaw) * alpha);
    me.pitch = clamp(me.pitch + (pitch - me.pitch) * alpha, -1.4, 1.4);
  };

  const project = point => {
    const v = point.clone().project(H.cam);
    if (v.z < -1 || v.z > 1) return null;
    if (v.x < -1.2 || v.x > 1.2 || v.y < -1.2 || v.y > 1.2) return null;
    return {
      x: (v.x * 0.5 + 0.5) * innerWidth,
      y: (-v.y * 0.5 + 0.5) * innerHeight
    };
  };

  const drawEsp = () => {
    ctx.clearRect(0, 0, innerWidth, innerHeight);
    if (!cfg.esp || !H || !H.me || !H.ents || !H.cam) return;

    const me = H.me;
    const eye = H.fs(me);
    const look = new H.V3(0, 0, -1).applyQuaternion(H.cam.quaternion);
    ctx.font = '11px Tahoma, sans-serif';
    ctx.textBaseline = 'bottom';

    for (let i = 0; i < H.ents.length && i < 128; i++) {
      const entity = H.ents[i];
      if (!entity || entity === me || entity.dead || entity.hp <= 0 || !entity.mover) continue;
      if (!H.uo(entity, me)) continue;

      const feet = entity.mover.pos.clone();
      if (feet.clone().sub(eye).dot(look) <= 0.15) continue;

      const top = feet.clone();
      top.y += entity.hitH || (entity.mover.crouch ? 1.25 : 1.8);

      const a = project(feet);
      const b = project(top);
      if (!a || !b) continue;

      const distance = eye.distanceTo(feet);
      const width = clamp((b.y - a.y) * 0.42, 8, 90);
      const left = (a.x + b.x) * 0.5 - width * 0.5;
      const height = a.y - b.y;

      const visible = clearShot(eye, top.clone().sub(eye).normalize(), distance);
      ctx.strokeStyle = visible ? '#ff4d5e' : '#9e303a';
      ctx.lineWidth = visible ? 1.6 : 1;
      ctx.strokeRect(left, b.y, width, height);

      const name = String(entity.name || entity.nick || 'alvo');
      const hp = Math.max(0, Math.round(entity.hp || 0));
      ctx.fillStyle = '#ffd9dd';
      ctx.fillText(`${name}  ${hp}  ${distance.toFixed(0)}m`, left, b.y - 3);

      const mark = project(cfg.head ? aimPoint(entity) : bodyPoint(entity));
      if (mark) {
        ctx.fillStyle = '#ffe27a';
        ctx.fillRect(mark.x - 2, mark.y - 2, 4, 4);
      }
    }
  };

  let last = performance.now();
  const frame = now => {
    const dt = Math.min(0.1, Math.max(0, (now - last) / 1000));
    last = now;

    try {
      if (cfg.aim && H && H.me && !H.me.dead) aim(pick(), dt);
    } catch (_) {}

    try {
      drawEsp();
    } catch (_) {}

    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);

  const hook = () => {
    if (window.__PBS && window.__PBS.ready) {
      H = window.__PBS;
      hud.textContent = 'KIT READY';
      setTimeout(updateHud, 800);
      return;
    }
    setTimeout(hook, 40);
  };
  hook();

}
