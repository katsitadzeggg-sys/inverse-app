'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';

export type Tile = {
  id: string;
  code: string;
  state: 'idle' | 'counting' | 'ok' | 'diff';
  who?: string;
  href?: string;
};

/** Counted and right — green; a difference — red; still to count — yellow. */
const COLOR: Record<Tile['state'], string> = {
  ok: '#2fbf71',
  diff: '#e5484d',
  counting: '#f5b324',
  idle: '#f7d774',
};
const STATE: Record<Tile['state'], string> = {
  ok: 'დათვლილია, სწორია',
  diff: 'სხვაობაა',
  counting: 'ითვლება',
  idle: 'დასათვლელი',
};

/**
 * Shelf numbering as on the website's map: letters, a dash, the number with
 * two digits — "A--1" → "A-01", "m118" → "M-118", "K02" → "K-02". Codes of
 * another shape keep their parts, joined by single dashes.
 */
export const shelfLabel = (code: string) => {
  const s = code.trim().toUpperCase();
  const m = s.match(/^([A-Zა-ჰ]+)[\s\-._/]*(\d+)$/);
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}`;
  return s.replace(/[\s\-._/]+/g, '-');
};
/** The rack (aisle) a shelf stands in: "A-01" → "A", "D-G-1" → "D-G". */
const rackOf = (label: string) => {
  const parts = label.split('-');
  return parts.length > 1 ? parts.slice(0, -1).join('-') : label.match(/^[^\d]+/)?.[0] || '#';
};
const natural = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true });

// Sizes in metres, as on inverse.ge's demo: a section 1 m wide, 0.9 m deep,
// four levels; racks stand back to back in pairs with a 2.4 m aisle between.
const SEC = 1;
const DEP = 0.9;
const LV = 4;
const LSTEP = 0.62;
const UH = 0.15 + LV * LSTEP;
const AISLE = 2.4;
const CROSS = 3; // the main aisle between blocks
const MAX_RUN = 30; // a longer rack continues on the next line

type Sec = { tile: Tile; label: string; x: number; z: number; rack: string };
type Rack = { k: string; secs: Sec[]; ok: number; diff: number; todo: number };

/**
 * Lays the racks out like a warehouse: racks of up to 30 sections, paired
 * back to back with an aisle between pairs, the pairs in blocks side by side
 * so the floor comes out roughly square. No plan of the real building yet —
 * that will come with saved warehouse layouts.
 */
function layout(tiles: Tile[]) {
  const byRack = new Map<string, { tile: Tile; label: string }[]>();
  for (const t of tiles) {
    const label = shelfLabel(t.code);
    const k = rackOf(label);
    byRack.set(k, [...(byRack.get(k) ?? []), { tile: t, label }]);
  }
  const keys = [...byRack.keys()].sort(natural);
  // Each line: one rack, or a part of a long one.
  const lines: { k: string; list: { tile: Tile; label: string }[] }[] = [];
  for (const k of keys) {
    const list = byRack.get(k)!.sort((a, b) => natural(a.label, b.label));
    for (let i = 0; i < list.length; i += MAX_RUN)
      lines.push({ k, list: list.slice(i, i + MAX_RUN) });
  }
  const run = Math.min(MAX_RUN, Math.max(1, ...lines.map((l) => l.list.length)));
  const pairs = Math.ceil(lines.length / 2);
  const pairDepth = 2 * DEP + AISLE;
  const blocks = Math.max(1, Math.round(Math.sqrt((pairs * pairDepth) / (run * SEC + CROSS))));
  const perBlock = Math.ceil(pairs / blocks);
  const blockW = run * SEC + CROSS;

  const secs: Sec[] = [];
  lines.forEach((line, i) => {
    const pair = Math.floor(i / 2);
    const block = Math.floor(pair / perBlock);
    const inBlock = pair % perBlock;
    const z = inBlock * pairDepth + (i % 2) * DEP;
    const x0 = block * blockW;
    line.list.forEach(({ tile, label }, j) =>
      secs.push({ tile, label, x: x0 + j * SEC + SEC / 2, z, rack: line.k }),
    );
  });
  const W = Math.max(...secs.map((s) => s.x)) + SEC / 2;
  const D = Math.max(...secs.map((s) => s.z)) + DEP / 2;
  const racks: Rack[] = keys.map((k) => {
    const list = secs.filter((s) => s.rack === k);
    return {
      k,
      secs: list,
      ok: list.filter((s) => s.tile.state === 'ok').length,
      diff: list.filter((s) => s.tile.state === 'diff').length,
      todo: list.filter((s) => s.tile.state === 'idle' || s.tile.state === 'counting').length,
    };
  });
  return { secs, racks, W, D };
}

/**
 * The warehouse in 3D, drawn like the demo on inverse.ge: blue uprights,
 * orange beams, wooden shelves and cartons — the cartons in the shelf's state
 * colour. Rack letters always show; section numbers appear as you come close.
 * Beside it, the racks with their counts: a click flies there. Drag to turn,
 * scroll or pinch to zoom, tap a section to open it. A search lights its
 * shelves (the rest fade) and flies to `target`.
 */
export default function Map3D({
  rows,
  lit = [],
  target = null,
}: {
  rows: { row: string; tiles: Tile[] }[];
  lit?: string[];
  target?: string | null;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const api = useRef<{
    focus: (lit: Set<string>, target: string | null) => void;
    view: (v: 'iso' | 'top') => void;
    rack: (k: string) => void;
  } | null>(null);
  const litKey = lit.join(',');
  const router = useRouter();
  const [hover, setHover] = useState<string | null>(null);
  const routerRef = useRef(router);
  useEffect(() => {
    routerRef.current = router;
  }, [router]);

  // Rebuild only when the shelves or their states change.
  const data = JSON.stringify(rows.flatMap((r) => r.tiles));
  const plan = useMemo(() => layout(JSON.parse(data) as Tile[]), [data]);
  const latest = useRef({ litKey, target });
  useEffect(() => {
    latest.current = { litKey, target };
    api.current?.focus(new Set(litKey ? litKey.split(',') : []), target);
  }, [litKey, target]);

  useEffect(() => {
    const el = ref.current;
    if (!el || !plan.secs.length) return;
    const { secs, W, D } = plan;
    let disposed = false;
    let cleanup = () => {};

    (async () => {
      const THREE = await import('three');
      const { OrbitControls } = await import('three/examples/jsm/controls/OrbitControls.js');
      if (disposed) return;

      const w = el.clientWidth;
      const h = el.clientHeight;
      const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      renderer.setSize(w, h);
      el.appendChild(renderer.domElement);

      const scene = new THREE.Scene();
      const camera = new THREE.PerspectiveCamera(45, w / h, 0.1, 2000);
      scene.add(new THREE.HemisphereLight(0xffffff, 0x8a96a8, 2.4));
      const sun = new THREE.DirectionalLight(0xffffff, 1.2);
      sun.position.set(10, 30, 15);
      scene.add(sun);

      // Floor with a faint 1 m grid and an edge.
      const PAD = 2;
      const FW = W + PAD * 2;
      const FD = D + PAD * 2;
      const cx = W / 2;
      const cz = D / 2;
      const grid = document.createElement('canvas');
      grid.width = grid.height = 64;
      const g = grid.getContext('2d')!;
      g.fillStyle = '#dfe5ec';
      g.fillRect(0, 0, 64, 64);
      g.fillStyle = 'rgba(255,255,255,0.8)';
      g.fillRect(63, 0, 1, 64);
      g.fillRect(0, 63, 64, 1);
      const gridTex = new THREE.CanvasTexture(grid);
      gridTex.wrapS = gridTex.wrapT = THREE.RepeatWrapping;
      gridTex.repeat.set(FW, FD);
      gridTex.colorSpace = THREE.SRGBColorSpace;
      const edge = new THREE.Mesh(
        new THREE.PlaneGeometry(FW + 0.3, FD + 0.3),
        new THREE.MeshBasicMaterial({ color: 0x9aa6b6 }),
      );
      edge.rotation.x = -Math.PI / 2;
      edge.position.set(cx, -0.02, cz);
      scene.add(edge);
      const floor = new THREE.Mesh(
        new THREE.PlaneGeometry(FW, FD),
        new THREE.MeshLambertMaterial({ map: gridTex }),
      );
      floor.rotation.x = -Math.PI / 2;
      floor.position.set(cx, 0, cz);
      scene.add(floor);

      // Every box is baked into one mesh per colour (one draw call each).
      const bakeList = new Map<string, number[][]>();
      const bake = (
        col: string,
        bw: number,
        bh: number,
        bd: number,
        x: number,
        y: number,
        z: number,
      ) => bakeList.set(col, [...(bakeList.get(col) ?? []), [bw, bh, bd, x, y, z]]);
      let seed = 11;
      const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
      for (const s of secs) {
        for (const [a, b] of [
          [-1, -1],
          [-1, 1],
          [1, -1],
          [1, 1],
        ])
          bake(
            '#2346B8',
            0.06,
            UH,
            0.06,
            s.x + a * (SEC / 2 - 0.03),
            UH / 2,
            s.z + b * (DEP / 2 - 0.03),
          );
        const base = new THREE.Color(COLOR[s.tile.state]);
        const cols = [0, 0.07, -0.08].map(
          (d) => '#' + base.clone().offsetHSL(0, 0, d).getHexString(),
        );
        for (let l = 0; l < LV; l++) {
          const y = 0.1 + l * LSTEP;
          bake('#D8C29A', SEC - 0.06, 0.03, DEP - 0.04, s.x, y, s.z);
          bake('#F26A1B', SEC - 0.06, 0.06, 0.04, s.x, y - 0.02, s.z + DEP / 2 - 0.02);
          bake('#F26A1B', SEC - 0.06, 0.06, 0.04, s.x, y - 0.02, s.z - DEP / 2 + 0.02);
          let x = -SEC / 2 + 0.05;
          const end = SEC / 2 - 0.05 - rnd() * 0.25;
          while (x < end) {
            const bw = 0.08 + rnd() * 0.14;
            if (x + bw > SEC / 2 - 0.04) break;
            const bh = 0.14 + rnd() * 0.24;
            bake(
              cols[Math.floor(rnd() * 3)],
              bw - 0.015,
              bh,
              DEP - 0.14 - rnd() * 0.1,
              s.x + x + bw / 2,
              y + 0.015 + bh / 2,
              s.z,
            );
            x += bw;
          }
        }
      }
      const unit = new THREE.BoxGeometry(1, 1, 1).toNonIndexed();
      const P = unit.attributes.position.array as Float32Array;
      const N = unit.attributes.normal.array as Float32Array;
      const baked: InstanceType<typeof THREE.MeshLambertMaterial>[] = [];
      for (const [col, list] of bakeList) {
        const n = P.length;
        const pos = new Float32Array(n * list.length);
        const nor = new Float32Array(n * list.length);
        list.forEach(([bw, bh, bd, x, y, z], i) => {
          for (let j = 0; j < n; j += 3) {
            pos[i * n + j] = x + P[j] * bw;
            pos[i * n + j + 1] = y + P[j + 1] * bh;
            pos[i * n + j + 2] = z + P[j + 2] * bd;
            nor[i * n + j] = N[j];
            nor[i * n + j + 1] = N[j + 1];
            nor[i * n + j + 2] = N[j + 2];
          }
        });
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
        geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
        const mat = new THREE.MeshLambertMaterial({ color: col, transparent: true });
        baked.push(mat);
        scene.add(new THREE.Mesh(geo, mat));
      }

      // Tags: rounded, bold, always facing the viewer.
      const texCache = new Map<string, InstanceType<typeof THREE.CanvasTexture>>();
      const tagTex = (text: string, bg: string, fg: string) => {
        const key = `${text}|${bg}|${fg}`;
        let t = texCache.get(key);
        if (t) return t;
        const c = document.createElement('canvas');
        const x = c.getContext('2d')!;
        const font = '800 56px system-ui, -apple-system, "Segoe UI", sans-serif';
        x.font = font;
        c.width = Math.ceil(x.measureText(text).width) + 40;
        c.height = 84;
        x.font = font;
        x.fillStyle = bg;
        x.beginPath();
        x.roundRect(0, 0, c.width, c.height, 16);
        x.fill();
        x.fillStyle = fg;
        x.textAlign = 'center';
        x.textBaseline = 'middle';
        x.fillText(text, c.width / 2, c.height / 2 + 3);
        t = new THREE.CanvasTexture(c);
        t.colorSpace = THREE.SRGBColorSpace;
        texCache.set(key, t);
        return t;
      };
      type Spr = InstanceType<typeof THREE.Sprite>;
      const sprite = (text: string, bg: string, fg: string, size: number) => {
        const map = tagTex(text, bg, fg);
        const s = new THREE.Sprite(new THREE.SpriteMaterial({ map, depthTest: false }));
        const img = map.image as HTMLCanvasElement;
        s.scale.set((img.width / img.height) * size, size, 1);
        s.renderOrder = 10;
        return s;
      };
      // Rack letters (orange, as on the site) at the start of each rack line.
      // Back-to-back racks: the front one is named at its left end, the back
      // one at its right end, so the two letters never sit on each other.
      const ends = new Map<string, { rack: string; z: number; min: number; max: number }>();
      for (const s of secs) {
        const key = `${s.rack}|${s.z}`;
        const e = ends.get(key) ?? { rack: s.rack, z: s.z, min: s.x, max: s.x };
        e.min = Math.min(e.min, s.x);
        e.max = Math.max(e.max, s.x);
        ends.set(key, e);
      }
      for (const e of ends.values()) {
        const back = Math.round((e.z % (2 * DEP + AISLE)) / DEP) === 1;
        const t = sprite(e.rack, '#F5A524', '#0b1220', 0.6);
        t.position.set(back ? e.max + 0.9 : e.min - 0.9, UH + 0.5, e.z);
        scene.add(t);
      }
      // Section numbers: a pool reused for the sections nearest the camera.
      const pool: Spr[] = Array.from({ length: 90 }, () => {
        const s = new THREE.Sprite(new THREE.SpriteMaterial({ depthTest: false }));
        s.renderOrder = 10;
        s.visible = false;
        scene.add(s);
        return s;
      });
      const relabel = () => {
        const c = camera.position;
        const dist = c.distanceTo(controls.target);
        if (dist > 26) {
          for (const p of pool) p.visible = false;
          return;
        }
        const near = secs
          .map((s) => [s, (s.x - c.x) ** 2 + (s.z - c.z) ** 2] as const)
          .filter(([, d]) => d < 900)
          .sort((a, b) => a[1] - b[1])
          .slice(0, pool.length);
        pool.forEach((p, i) => {
          const e = near[i];
          if (!e) {
            p.visible = false;
            return;
          }
          const s = e[0];
          const map = tagTex(s.label, '#0b1220', '#ffffff');
          if (p.material.map !== map) {
            p.material.map = map;
            p.material.needsUpdate = true;
            const img = map.image as HTMLCanvasElement;
            p.scale.set((img.width / img.height) * 0.3, 0.3, 1);
          }
          p.position.set(s.x, UH + 0.25, s.z);
          p.visible = true;
        });
      };

      // Invisible boxes to hit; a glow box for hover and search.
      const hitMat = new THREE.MeshBasicMaterial({ visible: false });
      const cube = new THREE.BoxGeometry(1, 1, 1);
      const hits = secs.map((s) => {
        const m = new THREE.Mesh(cube, hitMat);
        m.scale.set(SEC, UH + 0.1, DEP + 0.08);
        m.position.set(s.x, (UH + 0.1) / 2, s.z);
        m.userData.s = s;
        scene.add(m);
        return m;
      });
      const glowMat = new THREE.MeshBasicMaterial({
        color: '#38BDF8',
        transparent: true,
        opacity: 0.35,
        depthWrite: false,
      });
      const hoverBox = new THREE.Mesh(cube, glowMat);
      hoverBox.visible = false;
      scene.add(hoverBox);
      const glow = (m: InstanceType<typeof THREE.Mesh>, s: Sec) => {
        m.scale.set(SEC + 0.04, UH + 0.14, DEP + 0.12);
        m.position.set(s.x, (UH + 0.1) / 2, s.z);
      };

      const controls = new OrbitControls(camera, renderer.domElement);
      const span = Math.max(W, D, 8);
      const VIEWS = {
        iso: { p: [cx - span * 0.15, span * 0.75, cz + span * 0.75], t: [cx, 0, cz] },
        top: { p: [cx, span * 1.15, cz + 0.01], t: [cx, 0, cz] },
      } as const;
      camera.position.set(...VIEWS.iso.p);
      controls.target.set(...VIEWS.iso.t);
      controls.enableDamping = true;
      controls.maxPolarAngle = Math.PI / 2.1;
      controls.minDistance = 2;
      controls.maxDistance = span * 2.5;
      controls.update();

      type V3 = InstanceType<typeof THREE.Vector3>;
      let fly: { t: number; fromT: V3; toT: V3; fromP: V3; toP: V3 } | null = null;
      const go = (p: V3, t: V3) =>
        (fly = {
          t: 0,
          fromT: controls.target.clone(),
          toT: t,
          fromP: camera.position.clone(),
          toP: p,
        });

      // Search: lit shelves glow, the rest fade; the target's tag pulses green.
      const litBoxes: InstanceType<typeof THREE.Mesh>[] = [];
      let pulse: Spr | null = null;
      const litMat = new THREE.MeshBasicMaterial({
        color: '#38BDF8',
        transparent: true,
        opacity: 0.55,
        depthWrite: false,
      });
      const focus = (on: Set<string>, tgt: string | null) => {
        for (const b of litBoxes) scene.remove(b);
        litBoxes.length = 0;
        if (pulse) scene.remove(pulse);
        pulse = null;
        for (const m of baked) m.opacity = on.size ? 0.25 : 1;
        for (const s of secs) {
          if (!on.has(s.tile.id)) continue;
          const b = new THREE.Mesh(cube, litMat);
          glow(b, s);
          scene.add(b);
          litBoxes.push(b);
        }
        const ts = tgt ? secs.find((s) => s.tile.id === tgt) : undefined;
        if (ts) {
          pulse = sprite(ts.label, '#2fbf71', '#0b1220', 0.55);
          pulse.position.set(ts.x, UH + 0.75, ts.z);
          scene.add(pulse);
          go(new THREE.Vector3(ts.x - 2.5, 5, ts.z + 6), new THREE.Vector3(ts.x, 0.8, ts.z));
        }
      };
      api.current = {
        focus,
        view: (v) => go(new THREE.Vector3(...VIEWS[v].p), new THREE.Vector3(...VIEWS[v].t)),
        rack: (k) => {
          const list = secs.filter((s) => s.rack === k);
          if (!list.length) return;
          const x = list.reduce((a, s) => a + s.x, 0) / list.length;
          const z = list.reduce((a, s) => a + s.z, 0) / list.length;
          const len = Math.max(...list.map((s) => s.x)) - Math.min(...list.map((s) => s.x));
          const d = Math.max(6, len * 0.8);
          go(new THREE.Vector3(x - d * 0.2, d * 0.6, z + d * 0.8), new THREE.Vector3(x, 0.8, z));
        },
      };
      {
        const { litKey: l, target: t } = latest.current;
        focus(new Set(l ? l.split(',') : []), t);
      }

      // Hover shows the section and its state; a tap opens its result.
      const ray = new THREE.Raycaster();
      const pointer = new THREE.Vector2();
      let downAt = { x: 0, y: 0 };
      const pick = (ev: PointerEvent): Sec | undefined => {
        const rect = renderer.domElement.getBoundingClientRect();
        pointer.set(
          ((ev.clientX - rect.left) / rect.width) * 2 - 1,
          -((ev.clientY - rect.top) / rect.height) * 2 + 1,
        );
        ray.setFromCamera(pointer, camera);
        const hit = ray.intersectObjects(hits, false)[0];
        return hit?.object.userData.s as Sec | undefined;
      };
      const onMove = (ev: PointerEvent) => {
        const s = pick(ev);
        setHover(
          s ? `${s.label} · ${STATE[s.tile.state]}${s.tile.who ? ` · ${s.tile.who}` : ''}` : null,
        );
        hoverBox.visible = !!s;
        if (s) glow(hoverBox, s);
        renderer.domElement.style.cursor = s?.tile.href ? 'pointer' : 'grab';
      };
      const onDown = (ev: PointerEvent) => {
        downAt = { x: ev.clientX, y: ev.clientY };
        fly = null;
      };
      const onUp = (ev: PointerEvent) => {
        if (Math.hypot(ev.clientX - downAt.x, ev.clientY - downAt.y) > 6) return; // a drag
        const s = pick(ev);
        if (s?.tile.href) routerRef.current.push(s.tile.href);
      };
      renderer.domElement.addEventListener('pointermove', onMove);
      renderer.domElement.addEventListener('pointerdown', onDown);
      renderer.domElement.addEventListener('pointerup', onUp);

      const onResize = () => {
        const nw = el.clientWidth;
        const nh = el.clientHeight;
        camera.aspect = nw / nh;
        camera.updateProjectionMatrix();
        renderer.setSize(nw, nh);
      };
      const ro = new ResizeObserver(onResize);
      ro.observe(el);

      let frame = 0;
      let lastLabel = 0;
      const loop = () => {
        frame = requestAnimationFrame(loop);
        const now = performance.now();
        if (fly) {
          fly.t = Math.min(1, fly.t + 0.03);
          const k = 1 - Math.pow(1 - fly.t, 3);
          controls.target.lerpVectors(fly.fromT, fly.toT, k);
          camera.position.lerpVectors(fly.fromP, fly.toP, k);
          if (fly.t >= 1) fly = null;
        }
        if (pulse) {
          const s = 1 + Math.sin(now / 250) * 0.12;
          const img = pulse.material.map!.image as HTMLCanvasElement;
          pulse.scale.set((img.width / img.height) * 0.55 * s, 0.55 * s, 1);
        }
        if (now - lastLabel > 250) {
          lastLabel = now;
          relabel();
        }
        controls.update();
        renderer.render(scene, camera);
      };
      loop();

      cleanup = () => {
        api.current = null;
        cancelAnimationFrame(frame);
        ro.disconnect();
        controls.dispose();
        scene.traverse((o) => {
          const m = o as { geometry?: { dispose(): void }; material?: unknown };
          m.geometry?.dispose();
          for (const mat of [m.material].flat() as { dispose?(): void }[]) mat?.dispose?.();
        });
        for (const t of texCache.values()) t.dispose();
        gridTex.dispose();
        renderer.dispose();
        renderer.domElement.remove();
      };
    })();

    return () => {
      disposed = true;
      cleanup();
    };
  }, [plan]);

  const btn =
    'rounded-control border border-rule-strong bg-white/90 px-3 py-1.5 text-xs font-semibold text-ink shadow-sm hover:bg-white';

  return (
    <div className="grid gap-3 lg:grid-cols-[1fr_16rem]">
      <div className="relative overflow-hidden rounded-2xl border border-rule bg-[#eef1f5]">
        <div ref={ref} style={{ height: '72vh', minHeight: 380 }} className="w-full touch-none" />
        {hover && (
          <p className="pointer-events-none absolute left-3 top-3 rounded-md bg-[#0b1220] px-2.5 py-1 text-sm font-semibold text-white">
            {hover}
          </p>
        )}
        <div className="absolute right-3 top-3 flex gap-1.5">
          <button type="button" className={btn} onClick={() => api.current?.view('iso')}>
            პერსპექტივა
          </button>
          <button type="button" className={btn} onClick={() => api.current?.view('top')}>
            ზემოდან
          </button>
        </div>
        <div className="pointer-events-none absolute bottom-3 left-3 flex flex-wrap gap-3 rounded-full bg-white/85 px-3 py-1.5 text-xs font-medium">
          <span className="flex items-center gap-1.5">
            <i className="h-3 w-3 rounded-sm" style={{ background: COLOR.ok }} /> სწორია
          </span>
          <span className="flex items-center gap-1.5">
            <i className="h-3 w-3 rounded-sm" style={{ background: COLOR.diff }} /> სხვაობა
          </span>
          <span className="flex items-center gap-1.5">
            <i className="h-3 w-3 rounded-sm" style={{ background: COLOR.idle }} /> დასათვლელი
          </span>
        </div>
      </div>

      <aside className="overflow-y-auto rounded-2xl border border-rule bg-paper p-2 lg:max-h-[72vh]">
        <p className="px-2 pb-2 pt-1 text-xs text-ink-faint">
          {plan.racks.length} სტელაჟი · {plan.secs.length} სექცია
        </p>
        <ul className="grid gap-1">
          {plan.racks.map((r) => (
            <li key={r.k}>
              <button
                type="button"
                onClick={() => api.current?.rack(r.k)}
                className="flex w-full items-center gap-2 rounded-control border border-rule/70 px-2.5 py-1.5 text-left text-sm hover:border-ink-faint"
              >
                <b className="min-w-8 rounded bg-[#F5A524] px-1.5 text-center text-xs text-[#0b1220]">
                  {r.k}
                </b>
                <span className="flex-1 text-xs text-ink-soft">{r.secs.length} სექცია</span>
                {r.diff > 0 && (
                  <span className="text-xs font-semibold" style={{ color: COLOR.diff }}>
                    {r.diff}
                  </span>
                )}
                {r.ok > 0 && (
                  <span className="text-xs font-semibold" style={{ color: COLOR.ok }}>
                    {r.ok}
                  </span>
                )}
                {r.todo > 0 && <span className="text-xs text-ink-faint">{r.todo}</span>}
              </button>
            </li>
          ))}
        </ul>
      </aside>
    </div>
  );
}
