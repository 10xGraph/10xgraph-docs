// The 3D force graph: three.js scene, bloom, node and link styling, the route trail and the camera.
// three.js and 3d-force-graph load from CDNs on first call, so only desktop visitors download them.
import { S, REDUCED, DATA, byId, nodes, links, secColor, lid, ease, rgba, nodeStyle, linkStyle, linkState, nodeVisible, linkVisible, type GNode, type GLink, type View } from './state';

const THREE_V = '0.187.0';
const CDN = `https://cdn.jsdelivr.net/npm/three@${THREE_V}`;
const IMPORT_MAP = {
  imports: {
    three: `${CDN}/build/three.module.js`,
    'three/webgpu': `${CDN}/build/three.webgpu.js`,
    'three/tsl': `${CDN}/build/three.tsl.js`,
    'three/addons/': `${CDN}/examples/jsm/`,
    'three/examples/jsm/': `${CDN}/examples/jsm/`,
    '3d-force-graph': 'https://esm.sh/3d-force-graph@1.80.2?external=three',
  },
};
// A variable specifier keeps the bundler from resolving these at build time.
const load = (spec: string): Promise<any> => import(/* @vite-ignore */ spec);

export interface Handlers {
  onNodeClick(id: string): void;
  onNodeHover(n: GNode | null): void;
  onBackgroundClick(): void;
  onSettled(): void;
}

const TRAIL = '#7ea6ff';

// Pull the section clusters apart: each section gets an anchor on a sphere and its pages drift to it.
function clusterForce(R: number, k: number) {
  const N = DATA.sections.length;
  const anchor = new Map<string, { x: number; y: number; z: number }>();
  DATA.sections.forEach((s, i) => {
    const y = 1 - (i / (N - 1)) * 2, rad = Math.sqrt(1 - y * y), th = i * 2.399963;
    anchor.set(s.name, { x: Math.cos(th) * rad * R, y: y * R * 0.85, z: Math.sin(th) * rad * R });
  });
  return (alpha: number) => {
    for (const n of nodes as any[]) {
      const p = anchor.get(n.section)!;
      n.vx += (p.x - n.x) * k * alpha;
      n.vy += (p.y - n.y) * k * alpha;
      n.vz += (p.z - n.z) * k * alpha;
    }
  };
}

export async function createGraph(container: HTMLElement, size: { w: number; h: number }, h: Handlers): Promise<View> {
  const map = document.createElement('script');
  map.type = 'importmap';
  map.textContent = JSON.stringify(IMPORT_MAP);
  document.head.append(map);

  const THREE = await load('three');
  const { default: ForceGraph3D } = await load('3d-force-graph');
  const { UnrealBloomPass } = await load('three/addons/postprocessing/UnrealBloomPass.js');
  const { ShaderPass } = await load('three/addons/postprocessing/ShaderPass.js');
  const { GammaCorrectionShader } = await load('three/addons/shaders/GammaCorrectionShader.js');
  const { Line2 } = await load('three/addons/lines/Line2.js');
  const { LineMaterial } = await load('three/addons/lines/LineMaterial.js');
  const { LineGeometry } = await load('three/addons/lines/LineGeometry.js');

  const geo = new THREE.SphereGeometry(1, 14, 10);
  const texture = (draw: (c: CanvasRenderingContext2D) => void) => {
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    draw(c.getContext('2d')!);
    return new THREE.CanvasTexture(c);
  };
  const ringTex = texture((x) => { x.strokeStyle = '#fff'; x.lineWidth = 7; x.beginPath(); x.arc(64, 64, 50, 0, 7); x.stroke(); });
  const glowTex = texture((x) => {
    const gr = x.createRadialGradient(64, 64, 0, 64, 64, 64);
    gr.addColorStop(0, 'rgba(190,210,255,.5)'); gr.addColorStop(0.25, 'rgba(126,166,255,.35)'); gr.addColorStop(1, 'rgba(126,166,255,0)');
    x.fillStyle = gr; x.fillRect(0, 0, 128, 128);
  });

  let fitDist = 500;
  let overview: { p: { x: number; y: number; z: number }; t: { x: number; y: number; z: number } } | null = null;
  let settled = false;

  const g = ForceGraph3D({ controlType: 'orbit', rendererConfig: { antialias: true, powerPreference: 'high-performance' } })(container)
    .backgroundColor('#0b0e13').showNavInfo(false).width(size.w).height(size.h)
    .nodeLabel(() => '')
    .nodeThreeObject((n: GNode) => {
      const grp = new THREE.Group();
      const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: secColor.get(n.section), transparent: true, opacity: 0 }));
      const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: ringTex, transparent: true, opacity: 0, depthWrite: false }));
      grp.add(mesh, halo);
      n.__m = mesh;
      n.__h = halo;
      return grp;
    })
    .nodeThreeObjectExtend(false)
    .linkOpacity(1).linkDirectionalParticleSpeed(0.011).linkDirectionalParticleWidth(0.9)
    .linkDirectionalParticleColor((l: GLink) => (linkState(l) === 'out' ? '#a9c3ff' : '#c9d6f2'))
    .onNodeClick((n: GNode) => h.onNodeClick(n.id))
    .onNodeHover((n: GNode | null) => h.onNodeHover(n))
    .onBackgroundClick(() => h.onBackgroundClick())
    .onEngineTick(() => { S.trailDirty = true; })
    .onEngineStop(() => {
      S.simRunning = false;
      S.trailDirty = true;
      if (!settled) { settled = true; fit(1400); h.onSettled(); }
    })
    .cooldownTime(6500).d3VelocityDecay(0.3).d3AlphaDecay(0.024);

  g.d3Force('charge').strength(-22);
  g.d3Force('link').distance(26).strength((l: GLink) => (byId.get(lid(l.source))!.section === byId.get(lid(l.target))!.section ? 0.12 : 0.008));
  g.d3Force('cluster', clusterForce(230, 0.2));
  g.graphData({ nodes, links });
  g.cameraPosition({ x: 0, y: 60, z: 420 });

  // Distant stars.
  const N = 1400, pos = new Float32Array(N * 3);
  for (let i = 0; i < N; i++) {
    const r = 1400 + Math.random() * 1600, u = Math.random() * 2 - 1, t = Math.random() * 6.283, s = Math.sqrt(1 - u * u);
    pos.set([r * s * Math.cos(t), r * u, r * s * Math.sin(t)], i * 3);
  }
  const starGeo = new THREE.BufferGeometry();
  starGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.scene().add(new THREE.Points(starGeo, new THREE.PointsMaterial({ color: 0x8ea3c9, size: 1.3, sizeAttenuation: false, transparent: true, opacity: 0.45, depthWrite: false })));

  // Bloom: render linear, bloom in linear, then encode once to sRGB (OutputPass would skip this).
  const comp = g.postProcessingComposer();
  g.renderer().outputColorSpace = THREE.LinearSRGBColorSpace;
  comp.addPass(new UnrealBloomPass(new THREE.Vector2(size.w, size.h), 0.55, 0.35, 0.62));
  comp.addPass(new ShaderPass(GammaCorrectionShader));

  const ctl = g.controls();
  ctl.enableDamping = true;
  ctl.dampingFactor = 0.08;
  ctl.rotateSpeed = 0.6;
  ctl.autoRotate = !REDUCED;
  ctl.autoRotateSpeed = 0.45;
  ctl.addEventListener('start', () => { ctl.autoRotate = false; });

  // Route trail: a line through the steps drawn so far, a glow at each step and at the head.
  const lmat = new LineMaterial({ color: new THREE.Color(TRAIL).getHex(), linewidth: 1.8, transparent: true, opacity: 0.8, depthTest: false });
  lmat.resolution.set(size.w, size.h);
  const trail = new THREE.Group();
  trail.renderOrder = 10;
  g.scene().add(trail);
  let line: any = null;
  const marks: any[] = [];
  const glow = () => new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, transparent: true, depthTest: false, blending: THREE.AdditiveBlending }));
  const head = glow();
  head.scale.set(18, 18, 1);
  head.visible = false;
  trail.add(head);
  const tmp = new THREE.Vector3();

  function fit(ms: number) {
    g.zoomToFit(REDUCED ? 0 : ms, 10, nodeVisible);
    setTimeout(() => {
      const c = g.camera(), tg = ctl.target;
      c.position.set(tg.x + (c.position.x - tg.x) * 0.8, tg.y + (c.position.y - tg.y) * 0.8, tg.z + (c.position.z - tg.z) * 0.8);
      fitDist = c.position.length();
      overview = { p: { x: c.position.x, y: c.position.y, z: c.position.z }, t: { x: tg.x, y: tg.y, z: tg.z } };
    }, (REDUCED ? 0 : ms) + 80);
  }

  return {
    styles(t = 0) {
      const k = ease(Math.min(1, S.introV * 1.15));
      for (const n of nodes) {
        if (!n.__m) continue;
        const s = nodeStyle(n, t);
        n.__m.scale.setScalar(s.r * k);
        n.__m.material.color.set(s.color);
        n.__m.material.opacity = s.alpha * Math.min(1, S.introV * 1.6);
        n.__h.visible = s.ring > 0;
        if (s.ring) {
          n.__h.scale.setScalar(s.r * k * (s.ring === 2 ? 3.4 : 2.9));
          n.__h.material.color.set(s.ring === 2 ? '#e6ecf7' : '#7ea6ff');
          n.__h.material.opacity = s.ring === 2 ? 0.7 : 0.5;
        }
      }
    },
    links() {
      g.linkColor((l: GLink) => { const s = linkStyle(l); return rgba(s.color, s.alpha); })
        .linkWidth((l: GLink) => linkStyle(l).width)
        .linkDirectionalParticles((l: GLink) => linkStyle(l).particles);
    },
    visibility() { g.nodeVisibility(nodeVisible).linkVisibility(linkVisible); },
    fly(n) {
      ctl.autoRotate = false;
      const dist = Math.hypot(n.x!, n.y!, n.z!) || 1, r = 1 + 320 / dist;
      g.cameraPosition({ x: n.x! * r, y: n.y! * r + 8, z: n.z! * r }, { x: n.x, y: n.y, z: n.z }, REDUCED ? 0 : 1200);
    },
    home() { if (overview) g.cameraPosition(overview.p, overview.t, REDUCED ? 0 : 1200); },
    project(n) {
      if (n.x === undefined) return null;
      tmp.set(n.x, n.y!, n.z!);
      const cam = g.camera(), d = cam.position.distanceTo(tmp);
      const pr = tmp.clone().project(cam);
      if (pr.z > 1 || Math.abs(pr.x) > 1.05 || Math.abs(pr.y) > 1.05) return null;
      const c = g.graph2ScreenCoords(n.x, n.y, n.z);
      const near = fitDist * 0.45, far = fitDist * 1.4;
      return { x: c.x, y: c.y, fade: Math.max(0.35, Math.min(1, 1.1 - ((d - near) / (far - near)) * 0.7)) };
    },
    resize(w, hgt) { g.width(w).height(hgt); lmat.resolution.set(w, hgt); },
    tick() {
      if (!S.activePath || !S.trailDirty) return;
      S.trailDirty = S.simRunning || S.tweening;
      const P = S.activePath.steps.map((i) => byId.get(i)!);
      const full = Math.min(P.length - 1, Math.floor(S.trailP));
      const arr: number[] = [];
      for (let i = 0; i <= full; i++) arr.push(P[i].x!, P[i].y!, P[i].z!);
      let hx = P[full].x!, hy = P[full].y!, hz = P[full].z!;
      if (full < P.length - 1) {
        const f = S.trailP - full, a = P[full], b = P[full + 1];
        hx = a.x! + (b.x! - a.x!) * f; hy = a.y! + (b.y! - a.y!) * f; hz = a.z! + (b.z! - a.z!) * f;
        arr.push(hx, hy, hz);
      }
      if (line) { trail.remove(line); line.geometry.dispose(); line = null; }
      if (arr.length >= 6) {
        const lg = new LineGeometry();
        lg.setPositions(arr);
        line = new Line2(lg, lmat);
        line.frustumCulled = false;
        line.renderOrder = 10;
        trail.add(line);
      }
      head.position.set(hx, hy, hz);
      head.visible = full < P.length - 1 || S.trailP < P.length;
      marks.forEach((m, i) => {
        m.position.set(P[i].x, P[i].y, P[i].z);
        m.material.opacity = i <= S.trailP ? (i === S.pathIdx ? 0.7 : 0.5) : 0;
        m.scale.setScalar(i === S.pathIdx ? 20 : 11);
      });
    },
    setTrail() {
      marks.splice(0).forEach((m) => trail.remove(m));
      if (line) { trail.remove(line); line.geometry.dispose(); line = null; }
      if (!S.activePath) { head.visible = false; return; }
      S.activePath.steps.forEach(() => {
        const s = glow();
        s.material.opacity = 0;
        s.scale.set(15, 15, 1);
        trail.add(s);
        marks.push(s);
      });
      S.trailDirty = true;
    },
  };
}
