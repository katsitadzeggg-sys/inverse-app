'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

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

/**
 * The warehouse in 3D, drawn like the map on inverse.ge: a light floor with
 * a grid, each shelf a box with its shelves and cartons, coloured by state,
 * and its number on a dark tag that always faces you. One rack per letter.
 * It turns slowly until touched; drag to turn, pinch or scroll to zoom, tap a
 * shelf to open it. Shelves in `lit` stay bright (the rest fade); the camera
 * flies to `target`, whose tag turns green and pulses.
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
  const focusRef = useRef<((lit: Set<string>, target: string | null) => void) | null>(null);
  const litKey = lit.join(',');
  const router = useRouter();
  const [hover, setHover] = useState<string | null>(null);
  const routerRef = useRef(router);
  useEffect(() => {
    routerRef.current = router;
  }, [router]);

  // Rebuild only when the shelves or their states change.
  const data = JSON.stringify(rows.flatMap((r) => r.tiles));
  const latest = useRef({ litKey, target });
  useEffect(() => {
    latest.current = { litKey, target };
    focusRef.current?.(new Set(litKey ? litKey.split(',') : []), target);
  }, [litKey, target]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const tiles = JSON.parse(data) as Tile[];
    let disposed = false;
    let cleanup = () => {};

    (async () => {
      const THREE = await import('three');
      const { OrbitControls } = await import('three/examples/jsm/controls/OrbitControls.js');
      if (disposed) return;

      // Racks by letter, shelves by number.
      const racks = new Map<string, { tile: Tile; label: string }[]>();
      for (const t of tiles) {
        const label = shelfLabel(t.code);
        const k = rackOf(label);
        racks.set(k, [...(racks.get(k) ?? []), { tile: t, label }]);
      }
      const lines = [...racks.entries()]
        .sort((a, b) => natural(a[0], b[0]))
        .map(([k, list]) => ({ k, list: list.sort((a, b) => natural(a.label, b.label)) }));

      const w = el.clientWidth;
      const h = el.clientHeight;
      const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      renderer.setSize(w, h);
      el.appendChild(renderer.domElement);

      const scene = new THREE.Scene();
      const camera = new THREE.PerspectiveCamera(40, w / h, 0.1, 2000);
      scene.add(new THREE.HemisphereLight(0xffffff, 0x9fb0a6, 2.2));
      const sun = new THREE.DirectionalLight(0xffffff, 1.4);
      sun.position.set(-20, 40, 30);
      scene.add(sun);

      // Sizes in metres: a shelf 1.0 × 0.6 × 1.3, 1.15 apart; 3 m aisles.
      const SW = 1.0;
      const SD = 0.6;
      const SH = 1.3;
      const STEP = 1.15;
      const AISLE = 3;
      const START = 2.2; // room for the rack letter
      const longest = Math.max(1, ...lines.map((l) => l.list.length));
      const width = START + longest * STEP;
      const depth = Math.max(1, lines.length) * AISLE;
      const cx = width / 2 - 0.5;
      const cz = depth / 2 - AISLE / 2;

      // Floor: pale green with a white grid and a green edge, as on the website.
      const grid = document.createElement('canvas');
      grid.width = grid.height = 64;
      const g = grid.getContext('2d')!;
      g.fillStyle = '#cfe8d9';
      g.fillRect(0, 0, 64, 64);
      g.fillStyle = 'rgba(255,255,255,0.75)';
      g.fillRect(63, 0, 1, 64);
      g.fillRect(0, 63, 64, 1);
      const gridTex = new THREE.CanvasTexture(grid);
      gridTex.wrapS = gridTex.wrapT = THREE.RepeatWrapping;
      const FW = width + 4;
      const FD = depth + 3;
      gridTex.repeat.set(FW / 1.5, FD / 1.5);
      gridTex.colorSpace = THREE.SRGBColorSpace;
      const edge = new THREE.Mesh(
        new THREE.PlaneGeometry(FW + 0.3, FD + 0.3),
        new THREE.MeshBasicMaterial({ color: 0x1f7a4d }),
      );
      edge.rotation.x = -Math.PI / 2;
      edge.position.set(cx, -0.02, cz);
      scene.add(edge);
      const floor = new THREE.Mesh(
        new THREE.PlaneGeometry(FW, FD),
        new THREE.MeshStandardMaterial({ map: gridTex, roughness: 1 }),
      );
      floor.rotation.x = -Math.PI / 2;
      floor.position.set(cx, 0, cz);
      scene.add(floor);

      // A shelf's long face: frame, three shelves and cartons, in its state's colour.
      const faceTex = new Map<Tile['state'], InstanceType<typeof THREE.CanvasTexture>>();
      const face = (s: Tile['state']) => {
        let t = faceTex.get(s);
        if (t) return t;
        const c = document.createElement('canvas');
        c.width = 128;
        c.height = 160;
        const x = c.getContext('2d')!;
        const base = new THREE.Color(COLOR[s]);
        const light = base.clone().lerp(new THREE.Color('#ffffff'), 0.55).getStyle();
        const dark = base.clone().multiplyScalar(0.72).getStyle();
        x.fillStyle = light;
        x.fillRect(0, 0, 128, 160);
        for (let i = 0; i < 3; i++) {
          const y = i * 53;
          for (let b = 0; b < 5; b++) {
            x.fillStyle = b % 2 ? COLOR[s] : base.clone().multiplyScalar(0.88).getStyle();
            x.fillRect(8 + b * 23, y + 14, 19, 36);
          }
          x.fillStyle = dark;
          x.fillRect(0, y + 50, 128, 4);
        }
        x.strokeStyle = dark;
        x.lineWidth = 6;
        x.strokeRect(0, 0, 128, 160);
        t = new THREE.CanvasTexture(c);
        t.colorSpace = THREE.SRGBColorSpace;
        faceTex.set(s, t);
        return t;
      };

      // Number tags: dark, rounded, white bold text — always facing the viewer.
      const tag = (text: string, bg: string, fg = '#ffffff', size = 0.42) => {
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
        const tex = new THREE.CanvasTexture(c);
        tex.colorSpace = THREE.SRGBColorSpace;
        const mat = new THREE.SpriteMaterial({ map: tex, depthTest: false });
        const s = new THREE.Sprite(mat);
        s.scale.set((c.width / c.height) * size, size, 1);
        s.renderOrder = 10;
        return s;
      };

      type Std = InstanceType<typeof THREE.MeshStandardMaterial>;
      type Spr = InstanceType<typeof THREE.Sprite>;
      const boxes: {
        mesh: InstanceType<typeof THREE.Mesh>;
        tile: Tile;
        mats: Std[];
        label: string;
        sprite: Spr;
        found?: Spr;
      }[] = [];
      const geo = new THREE.BoxGeometry(SW, SH, SD);
      const edges = new THREE.EdgesGeometry(geo);
      lines.forEach(({ k, list }, ri) => {
        const z = ri * AISLE;
        const head = tag(k, '#1f7a4d', '#ffffff', 0.7);
        head.position.set(0.4, 0.9, z);
        scene.add(head);
        list.forEach(({ tile, label }, i) => {
          const side = new THREE.MeshStandardMaterial({
            map: face(tile.state),
            roughness: 0.7,
            transparent: true,
          });
          const end = new THREE.MeshStandardMaterial({
            color: new THREE.Color(COLOR[tile.state]).lerp(new THREE.Color('#ffffff'), 0.3),
            roughness: 0.7,
            transparent: true,
          });
          const top = new THREE.MeshStandardMaterial({
            color: new THREE.Color(COLOR[tile.state]).lerp(new THREE.Color('#ffffff'), 0.7),
            roughness: 0.8,
            transparent: true,
          });
          // Box faces: +x, −x, +y, −y, +z, −z.
          const mats = [end, end, top, top, side, side];
          const mesh = new THREE.Mesh(geo, mats);
          const x = START + i * STEP;
          mesh.position.set(x, SH / 2, z);
          const line = new THREE.LineSegments(
            edges,
            new THREE.LineBasicMaterial({ color: 0x7f8f86, transparent: true, opacity: 0.6 }),
          );
          mesh.add(line);
          scene.add(mesh);
          const sprite = tag(label, '#0b1220');
          sprite.position.set(x, SH + 0.45, z);
          scene.add(sprite);
          boxes.push({ mesh, tile, mats: [side, end, top], label, sprite });
        });
      });

      const controls = new OrbitControls(camera, renderer.domElement);
      controls.target.set(cx, 0.6, cz);
      // The website's view: tilted about 58° and turned −30°, slowly turning.
      const dist = Math.max(14, Math.max(width, depth) * 1.05);
      const polar = 0.95;
      const az = -Math.PI / 6;
      camera.position.set(
        cx + dist * Math.sin(polar) * Math.sin(az),
        dist * Math.cos(polar),
        cz + dist * Math.sin(polar) * Math.cos(az),
      );
      controls.enableDamping = true;
      controls.maxPolarAngle = Math.PI / 2.15;
      controls.minDistance = 3;
      controls.maxDistance = dist * 2.5;
      controls.autoRotate = true;
      controls.autoRotateSpeed = 0.5;
      controls.update();
      const stopTurning = () => (controls.autoRotate = false);
      renderer.domElement.addEventListener('pointerdown', stopTurning);
      renderer.domElement.addEventListener('wheel', stopTurning, { passive: true });

      // Search: lit shelves stay, the rest fade; the target's tag turns green and pulses.
      let pulse: Spr | null = null;
      let fly: {
        t: number;
        fromT: InstanceType<typeof THREE.Vector3>;
        toT: InstanceType<typeof THREE.Vector3>;
        fromP: InstanceType<typeof THREE.Vector3>;
        toP: InstanceType<typeof THREE.Vector3>;
      } | null = null;
      focusRef.current = (on, tgt) => {
        pulse = null;
        for (const b of boxes) {
          const isOn = on.has(b.tile.id);
          const o = on.size && !isOn ? 0.15 : 1;
          for (const m of b.mats) m.opacity = o;
          b.sprite.material.opacity = on.size && !isOn ? 0.25 : 1;
          b.mesh.scale.y = isOn ? 1.12 : 1;
          if (b.found) {
            scene.remove(b.found);
            b.found = undefined;
          }
          b.sprite.visible = true;
          if (tgt && b.tile.id === tgt) {
            b.found = tag(b.label, '#2fbf71', '#0b1220', 0.55);
            b.found.position.copy(b.sprite.position).setY(SH + 0.6);
            scene.add(b.found);
            b.sprite.visible = false;
            pulse = b.found;
          }
        }
        const tb = tgt ? boxes.find((b) => b.tile.id === tgt) : undefined;
        if (tb) {
          controls.autoRotate = false;
          const p = tb.mesh.position;
          fly = {
            t: 0,
            fromT: controls.target.clone(),
            toT: new THREE.Vector3(p.x, 0.8, p.z),
            fromP: camera.position.clone(),
            toP: new THREE.Vector3(p.x - 3, 6, p.z + 6.5),
          };
        }
      };
      {
        const { litKey: l, target: t } = latest.current;
        focusRef.current(new Set(l ? l.split(',') : []), t);
      }

      // Hover shows the shelf and its state; a tap opens its result.
      const ray = new THREE.Raycaster();
      const pointer = new THREE.Vector2();
      let downAt = { x: 0, y: 0 };
      const meshes = boxes.map((b) => b.mesh);
      const pick = (ev: PointerEvent) => {
        const rect = renderer.domElement.getBoundingClientRect();
        pointer.set(
          ((ev.clientX - rect.left) / rect.width) * 2 - 1,
          -((ev.clientY - rect.top) / rect.height) * 2 + 1,
        );
        ray.setFromCamera(pointer, camera);
        const hit = ray.intersectObjects(meshes, false)[0];
        return hit ? boxes.find((b) => b.mesh === hit.object) : undefined;
      };
      const onMove = (ev: PointerEvent) => {
        const b = pick(ev);
        setHover(
          b ? `${b.label} · ${STATE[b.tile.state]}${b.tile.who ? ` · ${b.tile.who}` : ''}` : null,
        );
        renderer.domElement.style.cursor = b?.tile.href ? 'pointer' : 'grab';
      };
      const onDown = (ev: PointerEvent) => (downAt = { x: ev.clientX, y: ev.clientY });
      const onUp = (ev: PointerEvent) => {
        if (Math.hypot(ev.clientX - downAt.x, ev.clientY - downAt.y) > 6) return; // a drag
        const b = pick(ev);
        if (b?.tile.href) routerRef.current.push(b.tile.href);
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
      window.addEventListener('resize', onResize);

      let frame = 0;
      const loop = () => {
        frame = requestAnimationFrame(loop);
        const now = performance.now();
        if (fly) {
          fly.t = Math.min(1, fly.t + 0.025);
          const k = 1 - Math.pow(1 - fly.t, 3);
          controls.target.lerpVectors(fly.fromT, fly.toT, k);
          camera.position.lerpVectors(fly.fromP, fly.toP, k);
          if (fly.t >= 1) fly = null;
        }
        if (pulse) {
          const s = 1 + Math.sin(now / 250) * 0.12;
          const base = (pulse.material.map!.image as HTMLCanvasElement).width / 84;
          pulse.scale.set(base * 0.55 * s, 0.55 * s, 1);
        }
        controls.update();
        renderer.render(scene, camera);
      };
      loop();

      cleanup = () => {
        focusRef.current = null;
        cancelAnimationFrame(frame);
        window.removeEventListener('resize', onResize);
        controls.dispose();
        scene.traverse((o) => {
          const m = o as { geometry?: { dispose(): void }; material?: unknown };
          m.geometry?.dispose();
          for (const mat of [m.material].flat() as {
            dispose?(): void;
            map?: { dispose(): void } | null;
          }[]) {
            mat?.map?.dispose();
            mat?.dispose?.();
          }
        });
        renderer.dispose();
        renderer.domElement.remove();
      };
    })();

    return () => {
      disposed = true;
      cleanup();
    };
  }, [data]);

  return (
    <div className="relative overflow-hidden rounded-2xl border border-rule bg-[#eef4f0]">
      <div ref={ref} style={{ height: '70vh', minHeight: 360 }} className="w-full touch-none" />
      {hover && (
        <p className="pointer-events-none absolute left-3 top-3 rounded-md bg-[#0b1220] px-2.5 py-1 text-sm font-semibold text-white">
          {hover}
        </p>
      )}
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
  );
}
