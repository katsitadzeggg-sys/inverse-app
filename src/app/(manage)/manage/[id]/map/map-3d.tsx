'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

export type Tile = { code: string; state: 'idle' | 'counting' | 'ok' | 'diff'; who?: string; href?: string };

const COLOR: Record<Tile['state'], number> = { idle: 0x98a2b3, counting: 0xf5a524, ok: 0x22a06b, diff: 0xe5484d };

/**
 * The same shelves in 3D: each row of codes (A-01, A-02 …) becomes a rack
 * along an aisle, each shelf a box coloured by its state. Drag to turn, pinch
 * or scroll to zoom, tap a shelf to open it. The layout comes from the codes,
 * not from a floor plan.
 */
export default function Map3D({ rows }: { rows: { row: string; tiles: Tile[] }[] }) {
  const ref = useRef<HTMLDivElement>(null);
  const router = useRouter();
  const [hover, setHover] = useState<string | null>(null);
  const routerRef = useRef(router);
  useEffect(() => {
    routerRef.current = router;
  }, [router]);

  // Rebuild the scene only when the shelves or their states change, not on
  // every refresh of the page.
  const data = JSON.stringify(rows);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const rows = JSON.parse(data) as { row: string; tiles: Tile[] }[];
    let disposed = false;
    let cleanup = () => {};

    (async () => {
      const THREE = await import('three');
      const { OrbitControls } = await import('three/examples/jsm/controls/OrbitControls.js');
      if (disposed) return;

      const w = el.clientWidth;
      const h = el.clientHeight;
      const renderer = new THREE.WebGLRenderer({ antialias: true });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      renderer.setSize(w, h);
      el.appendChild(renderer.domElement);

      const scene = new THREE.Scene();
      scene.background = new THREE.Color(0x0b1220);
      const camera = new THREE.PerspectiveCamera(45, w / h, 0.1, 500);
      scene.add(new THREE.HemisphereLight(0xffffff, 0x334155, 1.6));
      const sun = new THREE.DirectionalLight(0xffffff, 1.2);
      sun.position.set(10, 20, 8);
      scene.add(sun);

      // Layout: one rack per row of codes, 1.3 m per shelf, 3.5 m aisles.
      const STEP = 1.3;
      const AISLE = 3.5;
      const longest = Math.max(1, ...rows.map((r) => r.tiles.length));
      const width = longest * STEP;
      const depth = rows.length * AISLE;
      const floor = new THREE.Mesh(new THREE.PlaneGeometry(width + 6, depth + 6), new THREE.MeshStandardMaterial({ color: 0x1e293b }));
      floor.rotation.x = -Math.PI / 2;
      floor.position.set(width / 2 - STEP / 2, 0, depth / 2 - AISLE / 2);
      scene.add(floor);

      const label = (text: string, color = '#ffffff', size = 64) => {
        const c = document.createElement('canvas');
        const ctx = c.getContext('2d')!;
        ctx.font = `700 ${size}px -apple-system, "Segoe UI", sans-serif`;
        c.width = Math.ceil(ctx.measureText(text).width) + 24;
        c.height = size + 24;
        ctx.font = `700 ${size}px -apple-system, "Segoe UI", sans-serif`;
        ctx.fillStyle = color;
        ctx.textBaseline = 'middle';
        ctx.fillText(text, 12, c.height / 2);
        const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), depthTest: false }));
        sprite.scale.set((c.width / c.height) * 0.45, 0.45, 1);
        return sprite;
      };

      const boxes: { mesh: InstanceType<typeof THREE.Mesh>; tile: Tile }[] = [];
      const geo = new THREE.BoxGeometry(1.1, 2.2, 0.8);
      rows.forEach((r, ri) => {
        const z = ri * AISLE;
        const rowLabel = label(r.row, '#38bdf8', 90);
        rowLabel.position.set(-1.6, 1.2, z);
        scene.add(rowLabel);
        r.tiles.forEach((t, i) => {
          const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: COLOR[t.state], roughness: 0.6, emissive: t.state === 'counting' ? 0x6b4500 : 0x000000 }));
          mesh.position.set(i * STEP, 1.1, z);
          scene.add(mesh);
          boxes.push({ mesh, tile: t });
          const code = label(t.code.replace(/^[^\d]+[-\s.]*/, '') || t.code);
          code.position.set(i * STEP, 2.55, z);
          scene.add(code);
        });
      });

      const controls = new OrbitControls(camera, renderer.domElement);
      controls.target.set(width / 2 - STEP / 2, 0.8, depth / 2 - AISLE / 2);
      camera.position.set(width / 2, Math.max(8, depth * 0.9), depth + Math.max(6, width * 0.35));
      controls.enableDamping = true;
      controls.maxPolarAngle = Math.PI / 2.1;
      controls.update();

      // Tap a shelf → its result page; hover shows its code and state.
      const ray = new THREE.Raycaster();
      const pointer = new THREE.Vector2();
      let downAt = { x: 0, y: 0 };
      const pick = (ev: PointerEvent) => {
        const rect = renderer.domElement.getBoundingClientRect();
        pointer.set(((ev.clientX - rect.left) / rect.width) * 2 - 1, -((ev.clientY - rect.top) / rect.height) * 2 + 1);
        ray.setFromCamera(pointer, camera);
        const hit = ray.intersectObjects(boxes.map((b) => b.mesh))[0];
        return hit ? boxes.find((b) => b.mesh === hit.object)?.tile : undefined;
      };
      const STATE: Record<Tile['state'], string> = { idle: 'არ გახსნილა', counting: 'ითვლება', ok: 'ემთხვევა', diff: 'სხვაობაა' };
      const onMove = (ev: PointerEvent) => {
        const t = pick(ev);
        setHover(t ? `${t.code} · ${STATE[t.state]}${t.who ? ` · ${t.who}` : ''}` : null);
      };
      const onDown = (ev: PointerEvent) => (downAt = { x: ev.clientX, y: ev.clientY });
      const onUp = (ev: PointerEvent) => {
        if (Math.hypot(ev.clientX - downAt.x, ev.clientY - downAt.y) > 6) return; // a drag, not a tap
        const t = pick(ev);
        if (t?.href) routerRef.current.push(t.href);
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
        controls.update();
        renderer.render(scene, camera);
      };
      loop();

      cleanup = () => {
        cancelAnimationFrame(frame);
        window.removeEventListener('resize', onResize);
        controls.dispose();
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
    <div className="relative">
      <div ref={ref} style={{ height: '60vh', minHeight: 320 }} className="w-full touch-none overflow-hidden rounded-control" />
      {hover && <p className="pointer-events-none absolute left-2 top-2 rounded bg-black/70 px-2 py-1 text-xs text-white">{hover}</p>}
      <p className="mt-1 text-xs text-ink-faint">გადაატრიალე თითით, მიაახლოვე ორი თითით, შეეხე თაროს — გაიხსნება.</p>
    </div>
  );
}
