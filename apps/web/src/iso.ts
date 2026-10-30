import {
  joint,
  gaitFoot,
  runFoot,
  defaultAvatar,
} from '../../../packages/shared/src/customization';
import { avatarCanvas } from './avatar';
import Phaser from 'phaser';
import type { Room } from 'colyseus.js';
import {
  move,
  obstacles as arenaObstacles,
  WIDTH,
  HEIGHT,
  type Fighter,
  type Input,
  type World,
} from '../../../packages/shared/src/game';
import {
  project,
  unproject,
  screenMovement,
  palettes,
  type Biome,
} from '../../../packages/shared/src/presentation';
import { MISSIONS } from '../../../packages/shared/src/missions';
import { useUI } from './store';
import { audio } from './audio';
type Rig = {
  deadAt?: number;
  lastTime?: number;
  attackId: number;
  swingStart: number;
  blockUntil: number;
  springs: Record<string, { x: number; v: number }>;
  phase: number;
  lastX: number;
  lastY: number;
  root: Phaser.GameObjects.Container;
  parts: Record<string, Phaser.GameObjects.Image>;
  shadow: Phaser.GameObjects.Ellipse;
  label: Phaser.GameObjects.Text;
  health: Phaser.GameObjects.Graphics;
};
const SWING_MS = 340;
const NON_TEXT_INPUTS = new Set([
  'checkbox',
  'radio',
  'range',
  'button',
  'submit',
  'reset',
  'color',
  'file',
]);
const ROYAL_FEAST_GOLD = [
  'torso',
  'upperArm',
  'forearm',
  'backUpperArm',
  'backForearm',
  'frontThigh',
  'backThigh',
  'frontShin',
  'backShin',
  'frontBoot',
  'backBoot',
];
const mix = (a: number, b: number, t: number) => a + (b - a) * t;
const smooth = (t: number) => t * t * (3 - 2 * t);
const snap = (t: number) => 1 - (1 - t) ** 3;
type Pose = { u: number; b: number; grip: number; lean: number };
/** Interpolate [time, pose, easing] keyframes. Angles are unwrapped so the arc keeps its direction. */
function keyframes(t: number, frames: [number, Pose, (t: number) => number][]) {
  for (let n = 1; n < frames.length; n++) {
    const [t1, b, ease] = frames[n];
    if (t <= t1) {
      const [t0, a] = frames[n - 1],
        k = ease((t - t0) / (t1 - t0));
      return {
        u: mix(a.u, b.u, k),
        b: mix(a.b, b.b, k),
        grip: mix(a.grip, b.grip, k),
        lean: mix(a.lean, b.lean, k),
      };
    }
  }
  return frames[frames.length - 1][1];
}
const TAU = Math.PI * 2;
/** Sword: wind up over the shoulder, snap through an overhead-to-forward arc, follow through. */
function slashPose(t: number) {
  return keyframes(t, [
    [0, { u: 0.15, b: -0.35, grip: -0.05, lean: 0 }, smooth],
    [0.28, { u: 2.6, b: -1.0, grip: 2.8, lean: -0.08 }, smooth],
    [0.55, { u: 5.35, b: -0.2, grip: Math.PI, lean: 0.16 }, snap],
    [0.72, { u: 5.75, b: -0.35, grip: Math.PI, lean: 0.18 }, smooth],
    [1, { u: 0.15 + TAU, b: -0.35, grip: TAU - 0.05, lean: 0 }, smooth],
  ]);
}
/** Spear and lance: draw back to the chest, drive straight out, recover. */
function thrustPose(t: number) {
  return keyframes(t, [
    [0, { u: 0.15, b: -0.35, grip: -0.02, lean: 0 }, smooth],
    [0.3, { u: 0.55, b: -1.7, grip: 2.72, lean: -0.1 }, smooth],
    [0.5, { u: -1.45, b: -0.05, grip: 3.07, lean: 0.2 }, snap],
    [0.7, { u: -1.35, b: -0.1, grip: 3.07, lean: 0.18 }, smooth],
    [1, { u: 0.15, b: -0.35, grip: -0.02, lean: 0 }, smooth],
  ]);
}
export class IsoArena extends Phaser.Scene {
  room: Room;
  mine: string;
  ground!: Phaser.GameObjects.Graphics;
  fx!: Phaser.GameObjects.Graphics;
  keys!: Record<string, Phaser.Input.Keyboard.Key>;
  rigs = new Map<string, Rig>();
  spears = new Map<number, Phaser.GameObjects.Image>();
  aimAngle = 0;
  labels = new Map<string, Phaser.GameObjects.Text>();
  objects: Phaser.GameObjects.GameObject[] = [];
  rendered = new Map<string, { x: number; y: number }>();
  seen = new Set<string>();
  pending: Input[] = [];
  predicted: Fighter | null = null;
  seq = 0;
  tick = -1;
  lastSend = 0;
  queued = { attack: false, dodge: false, ability: false, interact: false };
  paused = false;
  typing = false;
  mapKey = '';
  boss?: Phaser.GameObjects.Image;
  zoomLevel = 1.45;
  lastHoof = 0;
  legPhase = 0;
  localSwing = -1e9;
  /** Critically damped (zeta=1) or springy (zeta<1) follower; angles take the short way round. */
  spring(rig: Rig, key: string, target: number, omega: number, dt: number, zeta = 1, angle = true) {
    const s = (rig.springs[key] ??= { x: target, v: 0 });
    const steps = Math.max(1, Math.ceil((dt * omega) / 0.4)),
      h = dt / steps;
    for (let n = 0; n < steps; n++) {
      let diff = target - s.x;
      if (angle) diff = Math.atan2(Math.sin(diff), Math.cos(diff));
      s.v += (omega * omega * diff - 2 * zeta * omega * s.v) * h;
      s.x += s.v * h;
    }
    return s.x;
  }
  follow = '';
  constructor(room: Room, id: string) {
    super('isometric-arena');
    this.room = room;
    this.mine = id;
  }
  preload() {
    this.load.json('assetManifest', '/assets/manifest.json');
    for (const name of ['rig-v3', 'rig', 'scenery', 'monsters', 'portraits', 'heads', 'bosses'])
      this.load.image(name, '/assets/' + name + '.png');
  }
  create() {
    const follow = (e: Event) => (this.follow = String((e as CustomEvent).detail ?? ''));
    window.addEventListener('spectate-follow', follow);
    this.events.once(Phaser.Scenes.Events.DESTROY, () =>
      window.removeEventListener('spectate-follow', follow),
    );
    this.cameras.main.setBackgroundColor('#102128');
    this.ground = this.add.graphics().setDepth(-10000);
    this.fx = this.add.graphics().setDepth(20000);
    for (const [name, columns, rows] of [
      ['rig-v3', 4, 4],
      ['rig', 4, 4],
      ['scenery', 2, 2],
      ['monsters', 2, 2],
      ['portraits', 2, 2],
      ['heads', 2, 2],
      ['bosses', 2, 1],
    ] as [string, number, number][]) {
      if (!this.textures.exists(name)) continue;
      const texture = this.textures.get(name),
        source = texture.getSourceImage() as HTMLImageElement,
        fw = source.width / columns,
        fh = source.height / rows;
      const bounds = this.cache.json.get('assetManifest')?.assets?.[name]?.frameBounds;
      for (let n = 0; n < columns * rows; n++) {
        const b = bounds?.[n];
        texture.add(
          'cell' + n,
          0,
          b?.x ?? (n % columns) * fw,
          b?.y ?? Math.floor(n / columns) * fh,
          b?.width ?? fw,
          b?.height ?? fh,
        );
      }
      if (name === 'portraits')
        for (let n = 0; n < 4; n++)
          texture.add(
            'face' + n,
            0,
            (n % 2) * fw + fw * 0.24,
            Math.floor(n / 2) * fh + fh * 0.08,
            fw * 0.52,
            fh * 0.55,
          );
    }
    this.keys = this.input.keyboard!.addKeys(
      'W,A,S,D,UP,DOWN,LEFT,RIGHT,SPACE,Q,E,ESC,TAB,F,PLUS,MINUS',
    ) as Record<string, Phaser.Input.Keyboard.Key>;
    this.input.keyboard!.addCapture(['SPACE', 'UP', 'DOWN', 'LEFT', 'RIGHT', 'TAB']);
    const focus = (target: EventTarget | null) => {
      // Only text entry pauses the controls; checkboxes and sliders (volume, reduced motion) do not.
      const field = target instanceof Element ? target.closest('input') : null;
      this.typing =
        target instanceof Element &&
        (field
          ? !NON_TEXT_INPUTS.has(field.type)
          : !!target.closest('textarea,select,[contenteditable="true"],[data-chat-controls]'));
      this.input.keyboard!.enabled = !this.typing;
      // Phaser captures keys globally; release them so chat receives letters and spaces.
      if (this.typing) this.input.keyboard!.disableGlobalCapture();
      else this.input.keyboard!.enableGlobalCapture();
      this.input.keyboard!.resetKeys();
      this.queued = { attack: false, dodge: false, ability: false, interact: false };
      window.dispatchEvent(new CustomEvent('scoreboard', { detail: false }));
    };
    const focusIn = (event: FocusEvent) => focus(event.target);
    const focusOut = (event: FocusEvent) => focus(event.relatedTarget);
    document.addEventListener('focusin', focusIn);
    document.addEventListener('focusout', focusOut);
    focus(document.activeElement);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      document.removeEventListener('focusin', focusIn);
      document.removeEventListener('focusout', focusOut);
    });
    this.input.mouse!.disableContextMenu();
    // Clicking the field must return focus from chat, sliders and checkboxes.
    this.game.canvas.tabIndex = 0;
    this.game.canvas.setAttribute('aria-label', 'Battle arena. Click to focus game controls.');
    this.cameras.main.setZoom(this.zoomLevel);
    this.keys.SPACE.on('down', () => (this.queued.dodge = true));
    this.keys.Q.on('down', () => (this.queued.ability = true));
    this.keys.E.on('down', () => (this.queued.interact = true));
    this.keys.ESC.on('down', () => {
      this.paused = !this.paused;
      window.dispatchEvent(new CustomEvent('pause', { detail: this.paused }));
    });
    this.keys.TAB.on('down', () =>
      window.dispatchEvent(new CustomEvent('scoreboard', { detail: true })),
    );
    this.keys.TAB.on('up', () =>
      window.dispatchEvent(new CustomEvent('scoreboard', { detail: false })),
    );
    this.keys.F.on('down', () => {
      const target = this.game.canvas.closest<HTMLElement>('.battle-layout') ?? this.game.canvas;
      if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
      else if (target.requestFullscreen) void target.requestFullscreen().catch(() => {});
    });
    this.input.on('pointerdown', (p: Phaser.Input.Pointer) => {
      this.game.canvas.focus({ preventScroll: true });
      audio.unlock();
      if (p.leftButtonDown()) this.queued.attack = true;
    });
    this.input.on('wheel', (_p: unknown, _g: unknown, _x: number, dy: number) => {
      this.zoomLevel = Phaser.Math.Clamp(this.zoomLevel - dy * 0.001, 0.8, 2.3);
      this.cameras.main.setZoom(this.zoomLevel);
    });
    this.keys.PLUS?.on('down', () => {
      this.zoomLevel = Math.min(2.3, this.zoomLevel + 0.15);
      this.cameras.main.setZoom(this.zoomLevel);
    });
    this.keys.MINUS?.on('down', () => {
      this.zoomLevel = Math.max(0.8, this.zoomLevel - 0.15);
      this.cameras.main.setZoom(this.zoomLevel);
    });
    this.game.canvas.dataset.ready = 'true';
    this.game.canvas.dataset.projection = 'isometric';
    this.game.canvas.dataset.renderer =
      this.game.renderer.type === Phaser.CANVAS ? 'canvas' : 'webgl';
  }
  update(time: number, delta: number) {
    const w = useUI.getState().snapshot;
    if (!w) return;
    const key = (w.campaign?.missionId ?? w.mode) + ':' + (w.geometry?.width ?? WIDTH);
    if (key !== this.mapKey) {
      this.mapKey = key;
      this.buildMap(w);
    }
    const me = w.players.find((p) => p.id === this.mine);
    if (me) {
      if (w.tick !== this.tick) {
        this.tick = w.tick;
        this.pending = this.pending.filter((i) => i.seq > me.seq);
        this.predicted = structuredClone(me);
        for (const i of this.pending) move(this.predicted, i, 1 / 30, w.geometry);
      }
      const p = this.predicted ?? me,
        point = project(p.x, p.y);
      this.cameras.main.centerOn(point.x, point.y - 35);
      const mouse = this.input.activePointer.positionToCamera(
          this.cameras.main,
        ) as Phaser.Math.Vector2,
        // Read the cursor at body height, not ground level: riders and thrown spears are drawn
        // above their ground position, so pointing at a rider must aim at that rider.
        aim = unproject(mouse.x, mouse.y + (p.mount ? 60 : 30));
      const direction = screenMovement(
        Number(this.keys.D.isDown || this.keys.RIGHT.isDown) -
          Number(this.keys.A.isDown || this.keys.LEFT.isDown),
        Number(this.keys.S.isDown || this.keys.DOWN.isDown) -
          Number(this.keys.W.isDown || this.keys.UP.isDown),
      );
      const blocked = this.paused || this.typing;
      const i: Input = {
        seq: this.seq++,
        x: blocked ? 0 : direction.x,
        y: blocked ? 0 : direction.y,
        aim: (this.aimAngle = Math.atan2(aim.y - p.y, aim.x - p.x)),
        attack: !blocked && (this.input.activePointer.leftButtonDown() || this.queued.attack),
        block: !blocked && this.input.activePointer.rightButtonDown(),
        dodge: !blocked && (this.keys.SPACE.isDown || this.queued.dodge),
        ability: !blocked && (this.keys.Q.isDown || this.queued.ability),
        interact: !blocked && (this.keys.E.isDown || this.queued.interact),
      };
      if (
        time - this.lastSend >= 1000 / 30 &&
        !w.finished &&
        (w.tick > 0 || w.mode === 'tutorial')
      ) {
        this.lastSend = time;
        if (i.attack && time - this.localSwing > 620 && me.stamina >= 12) this.localSwing = time;
        this.room.send('input', i);
        this.pending.push(i);
        this.queued = { attack: false, dodge: false, ability: false, interact: false };
        if (this.pending.length > 90) this.pending.shift();
        move(this.predicted!, i, 1 / 30, w.geometry);
      }
    } else {
      // Spectators have no fighter: follow the chosen one, else the first living human.
      const target =
        w.players.find((p) => p.id === this.follow) ??
        w.players.find((p) => !p.bot && p.hp > 0) ??
        w.players[0];
      const at = target && this.rendered.get(target.id);
      if (at) {
        const point = project(at.x, at.y);
        this.cameras.main.centerOn(point.x, point.y - 35);
      }
    }
    this.fx.clear();
    const rider = w.players.find((q) => q.id === this.mine && q.mount && q.hp > 0),
      from = rider && this.rendered.get(rider.id);
    if (from) {
      // Mounted aiming guide: the spear leaves along this line (wind bends it slightly).
      this.fx.fillStyle(0xfff1c4, 0.75);
      for (let d = 40; d <= 220; d += 22) {
        const dot = project(
          from.x + Math.cos(this.aimAngle) * d,
          from.y + Math.sin(this.aimAngle) * d,
          30,
        );
        this.fx.fillCircle(dot.x, dot.y, 2.4);
      }
    }
    for (const p of w.players) {
      let r = this.rendered.get(p.id);
      const target = p.id === this.mine && this.predicted ? this.predicted : p;
      if (!r) {
        r = { x: target.x, y: target.y };
        this.rendered.set(p.id, r);
      }
      const blend = Math.min(1, delta / 65);
      r.x += (target.x - r.x) * blend;
      r.y += (target.y - r.y) * blend;
      this.drawActor(p, r.x, r.y, time, w);
    }
    for (const [id, rig] of this.rigs)
      if (!w.players.some((p) => p.id === id)) {
        rig.root.destroy();
        rig.shadow.destroy();
        rig.label.destroy();
        rig.health.destroy();
        this.rigs.delete(id);
      }
    this.drawObjectives(w, time);
    this.drawEffects(w, time);
    this.game.canvas.dataset.tick = String(w.tick);
    this.game.canvas.dataset.zoom = String(this.zoomLevel);
    this.game.canvas.dataset.legPhase = String(this.legPhase.toFixed(2));
    this.game.canvas.dataset.actorHeight = String(113 * 0.78 * this.zoomLevel);
    this.game.canvas.dataset.scrollX = String(this.cameras.main.scrollX);
    this.game.canvas.dataset.scrollY = String(this.cameras.main.scrollY);
    this.game.canvas.dataset.fps = String(this.game.loop.actualFps.toFixed(1));
    this.game.canvas.dataset.audio = audio.context?.state ?? 'locked';
  }
  polygon(points: { x: number; y: number }[], fill: number, alpha = 1, g = this.ground) {
    g.fillStyle(fill, alpha);
    g.fillPoints(points, true);
  }
  block(x: number, y: number, width: number, height: number, raise: number, color: number) {
    const key = `wall-${width}-${height}-${raise}-${color}`,
      minX = -height * 0.86 - 2,
      minY = -raise - 2;
    if (!this.textures.exists(key)) {
      const g = this.add.graphics(),
        point = (x: number, y: number, z = 0) => {
          const p = project(x, y, z);
          return { x: p.x - minX, y: p.y - minY };
        };
      const a = point(0, 0, raise),
        b = point(width, 0, raise),
        c = point(width, height, raise),
        d = point(0, height, raise),
        bf = point(width, 0),
        cf = point(width, height),
        df = point(0, height);
      this.polygon(
        [b, c, cf, bf],
        Phaser.Display.Color.IntegerToColor(color).darken(25).color,
        1,
        g,
      );
      this.polygon(
        [c, d, df, cf],
        Phaser.Display.Color.IntegerToColor(color).darken(40).color,
        1,
        g,
      );
      this.polygon([a, b, c, d], color, 1, g);
      g.lineStyle(1, 0xeed7a3, 0.35);
      g.strokePoints([a, b, c, d], true);
      g.generateTexture(
        key,
        Math.ceil((width + height) * 0.86 + 4),
        Math.ceil((width + height) * 0.43 + raise + 4),
      );
      g.destroy();
    }
    const p = project(x, y),
      image = this.add
        .image(p.x + minX, p.y + minY, key)
        .setOrigin(0)
        .setDepth(project(x + width / 2, y + height / 2).y);
    this.objects.push(image);
  }
  buildMap(w: World) {
    this.ground.clear().setVisible(true);
    for (const o of this.objects) o.destroy();
    this.objects = [];
    const geo = w.geometry ?? { width: WIDTH, height: HEIGHT, obstacles: arenaObstacles },
      biome = w.campaign?.biome ?? (w.mode === 'quest' ? 'citadel' : 'sandstone'),
      palette = palettes[biome];
    const W = geo.width,
      H = geo.height;
    for (let x = 0; x < W; x += 80)
      for (let y = 0; y < H; y += 80) {
        const a = project(x, y),
          b = project(Math.min(W, x + 80), y),
          c = project(Math.min(W, x + 80), Math.min(H, y + 80)),
          d = project(x, Math.min(H, y + 80));
        const variation = ((x * 31 + y * 7) % 9) / 100;
        this.polygon([a, b, c, d], (x + y) % 160 === 0 ? palette.tile : palette.floor, 1);
        this.ground.lineStyle(1, 0x172523, 0.12 + variation);
        this.ground.strokePoints([a, b, c, d], true);
        if (((x / 80) * 3 + (y / 80) * 7) % 5 === 0) {
          const crack = [project(x + 18, y + 30), project(x + 36, y + 36), project(x + 31, y + 48)];
          this.ground.lineStyle(1, 0x4b463a, 0.25);
          this.ground.strokePoints(crack, false);
        }
        if (biome === 'grassland' || biome === 'highland') {
          const p = project(x + 30, y + 40);
          this.ground.lineStyle(1, 0xa7b678, 0.5);
          this.ground.lineBetween(p.x, p.y, p.x + 4, p.y - 7);
          this.ground.lineBetween(p.x + 5, p.y, p.x + 10, p.y - 4);
        }
      }
    const medallion = project(W / 2, H / 2);
    for (const r of [72, 88, 108]) {
      this.ground.lineStyle(2, r === 88 ? 0xa45f3d : 0xc6a965, 0.6);
      this.ground.strokeEllipse(medallion.x, medallion.y, r * 2.43, r * 1.215);
    }
    const star = Array.from({ length: 16 }, (_, n) => {
      const a = (n * Math.PI) / 8,
        r = n % 2 ? 36 : 68;
      return project(W / 2 + Math.cos(a) * r, H / 2 + Math.sin(a) * r);
    });
    this.polygon(star, 0x917a45, 0.5);
    this.ground.lineStyle(2, 0xe1c88c, 0.65);
    this.ground.strokePoints(star, true);
    for (const [x, y] of [
      [100, 280],
      [W - 100, H - 280],
      [W * 0.35, 100],
      [W * 0.65, H - 90],
    ]) {
      const p = project(x, y),
        g = this.add.graphics().setDepth(p.y);
      this.objects.push(g);
      g.lineStyle(3, 0xbba16b);
      g.lineBetween(p.x, p.y, p.x, p.y - 105);
      g.fillStyle(0xb48c43);
      g.fillCircle(p.x, p.y - 107, 4);
      for (let n = 0; n < 3; n++) {
        g.fillStyle([0x497650, 0xd0ae58, 0xa2483c][n]);
        g.fillRect(p.x + 3 + n * 8, p.y - 101, 8, 65);
      }
      g.lineStyle(1, 0xe6ce8c);
      g.strokeRect(p.x + 3, p.y - 101, 24, 65);
      g.lineBetween(p.x + 6, p.y - 72, p.x + 23, p.y - 72);
    }
    if (biome === 'river') {
      for (let y = 80; y < H - 80; y += 25) {
        const a = project(730, y),
          b = project(930, y),
          c = project(930, y + 22),
          d = project(730, y + 22);
        this.polygon([a, b, c, d], 0x367e92, 0.7);
      }
      for (let x = 700; x < 970; x += 35) this.block(x, 400, 33, 130, 7, 0x846748);
    }
    for (const o of geo.obstacles)
      if (!('kind' in o) || o.kind !== 'water') this.block(o.x, o.y, o.w, o.h, 45, palette.wall);
    for (let x = 0; x < W; x += 110) {
      this.block(x, 0, 100, 28, 42, palette.wall);
      this.block(x, H - 28, 100, 28, 35, palette.wall);
    }
    for (let y = 30; y < H - 30; y += 110) {
      this.block(0, y, 28, 100, 40, palette.wall);
      this.block(W - 28, y, 28, 100, 45, palette.wall);
    }
    const props = [
      { x: 120, y: 120, frame: 0, size: 100 },
      { x: W - 130, y: 130, frame: 0, size: 115 },
      { x: W - 130, y: H - 130, frame: 3, size: 70 },
      { x: 120, y: H - 130, frame: 3, size: 70 },
      { x: W / 2, y: 95, frame: 2, size: 155 },
    ];
    if (['highland', 'grassland', 'mud', 'river', 'mist'].includes(biome))
      props.push(
        { x: W * 0.3, y: H * 0.65, frame: 1, size: 120 },
        { x: W * 0.8, y: H * 0.7, frame: 1, size: 145 },
      );
    for (const p of props) {
      const point = project(p.x, p.y);
      const image = this.add
        .image(point.x, point.y, 'scenery', 'cell' + p.frame)
        .setOrigin(0.5, 0.9);
      const frame = image.frame;
      image.setScale(p.size / frame.height).setDepth(point.y - 5);
      this.objects.push(image);
    }
    const minX = -H * 0.86 - 2,
      terrain = this.add
        .renderTexture(minX, -2, Math.ceil((W + H) * 0.86 + 4), Math.ceil((W + H) * 0.43 + 4))
        .setOrigin(0)
        .setDepth(-10000);
    terrain.draw(this.ground, -minX, 2);
    this.ground.setVisible(false);
    this.objects.push(terrain);
    const center = project(W / 2, H / 2);
    this.ground.lineStyle(3, palette.accent, 0.32);
    this.ground.strokeEllipse(center.x, center.y, 250, 125);
    this.ground.strokeEllipse(center.x, center.y, 228, 114);
  }
  part(index: number, width: number, height: number, x: number, y: number) {
    const image = this.add.image(x, y, 'rig-v3', 'cell' + index);
    image.setScale(Math.min(width / image.frame.width, height / image.frame.height));
    return image;
  }
  createRig(p: Fighter) {
    const root = this.add.container(),
      parts: Record<string, Phaser.GameObjects.Image> = {};
    const add = (
      name: string,
      index: number,
      width: number,
      height: number,
      x: number,
      y: number,
      oy = 0.12,
    ) => {
      const i = name.startsWith('horse')
        ? this.add
            .image(x, y, 'rig', 'cell' + index)
            .setDisplaySize(width, height)
            .setOrigin(0.5, oy)
        : this.part(index, width, height, x, y).setOrigin(0.5, oy);
      root.add(i);
      parts[name] = i;
      return i;
    };
    add('cape', 9, 56, 57, 0, -76, 0.06);
    add('backUpperArm', 1, 20, 27, -23, -66, 0.08);
    add('backForearm', 2, 18, 27, -23, -44, 0.08);
    add('backThigh', 4, 24, 31, 11, -34, 0.08);
    add('backShin', 5, 21, 31, 11, -11, 0.08);
    add('backBoot', 6, 27, 18, 11, 10, 0.5);
    add('frontThigh', 4, 24, 31, -11, -34, 0.08);
    add('frontShin', 5, 21, 31, -11, -11, 0.08);
    add('frontBoot', 6, 27, 18, -11, 10, 0.5);
    add('torso', [0, 11, 10, 14][p.hero] ?? 0, 65, 53, 0, -78, 0.08);
    add('upperArm', 1, 24, 29, 23, -66, 0.08);
    add('forearm', 2, 21, 28, 23, -44, 0.08);
    add(
      'weapon',
      p.mount || p.role === 'spear' ? 8 : 7,
      19,
      p.mount || p.role === 'spear' ? 88 : 66,
      23,
      -22,
      0.88,
    );
    add('shield', 3, 35, 43, -26, -40, 0.5);
    const spec = p.avatar ?? {
      ...defaultAvatar,
      beard: p.hero === 1 ? 'none' : defaultAvatar.beard,
    };
    const heroHead = 'cell' + (p.hero ?? 0);
    let face: Phaser.GameObjects.Image;
    if (spec.face !== 'custom' && this.textures.get('heads').has(heroHead)) {
      // Painted hero heads share one scale; the collar is pinned just over the torso top.
      const frame = this.textures.getFrame('heads', heroHead),
        height = frame.height * 0.105;
      face = this.add
        .image(0, -92, 'heads', heroHead)
        .setDisplaySize(frame.width * 0.105, height)
        .setOrigin(0.5, 1 - 16 / height);
    } else {
      const faceKey = 'avatar-' + JSON.stringify(spec);
      if (!this.textures.exists(faceKey)) this.textures.addCanvas(faceKey, avatarCanvas(spec));
      face = this.add.image(0, -92, faceKey).setDisplaySize(39, 44);
    }
    root.add(face);
    parts.head = face;
    const shadow = this.add.ellipse(0, 0, 50, 23, 0x091a1c, 0.3);
    const label = this.add
      .text(0, 0, p.name, {
        fontFamily: 'Noto Serif Ethiopic, Georgia',
        fontSize: 10,
        color: '#fff1d4',
        stroke: '#16251f',
        strokeThickness: 3,
      })
      .setOrigin(0.5);
    const health = this.add.graphics();
    if (p.mount) {
      for (let n = 0; n < 4; n++) {
        add('horseUpper' + n, 13, 17, 28, n < 2 ? -25 : 26, n % 2 ? -2 : -8);
        add('horseLower' + n, 14, 13, 28, n < 2 ? -25 : 26, 13);
      }
      add('horseBody', 10, 105, 60, 0, -35, 0.5);
      add('horseNeck', 12, 45, 55, 39, -40, 0.5);
      add('horseHead', 11, 44, 48, 58, -52, 0.5);
      add('horseTail', 15, 35, 50, -48, -35, 0.2);
      for (const name of [
        'cape',
        'backUpperArm',
        'backForearm',
        'backThigh',
        'backShin',
        'backBoot',
        'frontThigh',
        'frontShin',
        'frontBoot',
        'torso',
        'upperArm',
        'forearm',
        'weapon',
        'shield',
        'head',
      ])
        root.bringToTop(parts[name]);
    }
    return {
      root,
      parts,
      shadow,
      label,
      health,
      phase: 0,
      lastX: p.x,
      lastY: p.y,
      attackId: p.attackId,
      swingStart: -1e9,
      blockUntil: 0,
      springs: {},
    };
  }
  drawActor(p: Fighter, x: number, y: number, time: number, w: World) {
    let rig = this.rigs.get(p.id);
    if (!rig) {
      rig = this.createRig(p);
      this.rigs.set(p.id, rig);
    }
    if (p.hp <= 0) {
      rig.deadAt ??= time;
    } else rig.deadAt = undefined;
    const visible = rig.deadAt === undefined || time - rig.deadAt < 1800;
    rig.root.setVisible(visible);
    rig.shadow.setVisible(visible);
    rig.label.setVisible(visible);
    rig.health.setVisible(visible);
    if (!visible) return;
    const point = project(x, y),
      speed = Math.hypot(p.vx, p.vy),
      moving = speed > 12,
      dt = Phaser.Math.Clamp((time - (rig.lastTime ?? time)) / 1000, 0, 0.05),
      phase = (rig.phase +=
        (Math.min(35, Math.hypot(x - rig.lastX, y - rig.lastY)) * Math.PI) / 48),
      stride = moving ? Math.sin(phase) * 0.48 : 0;
    rig.lastTime = time;
    rig.lastX = x;
    rig.lastY = y;
    this.legPhase = p.id === this.mine ? stride : this.legPhase;
    const alpha = p.hp <= 0 ? 0.35 : p.invulnerable > 0 ? 0.65 : 1;
    rig.root.setPosition(point.x, point.y).setDepth(point.y).setAlpha(alpha);
    rig.shadow.setPosition(point.x, point.y + 6).setDepth(point.y - 1);
    const facing = project(
      Math.cos(p.mount?.heading ?? p.aim),
      Math.sin(p.mount?.heading ?? p.aim),
    );
    rig.root.setScale(facing.x < 0 ? -0.78 : 0.78, 0.78);
    const parts = rig.parts,
      mine = p.id === this.mine,
      offset = p.mount ? -35 : 0,
      alive = p.hp > 0,
      active = moving && alive && p.stun <= 0,
      run = active && !p.mount ? Phaser.Math.Clamp((speed - 90) / 150, 0, 1) : 0,
      spear = p.role === 'spear' || !!p.mount;
    // Swings run on a client clock started by each new attack, so the arc is smooth between
    // 15 Hz snapshots. The local player starts it on click instead of waiting a round trip.
    if (p.attackId !== rig.attackId) {
      rig.attackId = p.attackId;
      if (!(mine && time - rig.swingStart < 450)) rig.swingStart = time;
    }
    if (mine && this.localSwing > rig.swingStart) rig.swingStart = this.localSwing;
    const swingT = (time - rig.swingStart) / SWING_MS,
      swinging = alive && swingT >= 0 && swingT < 1;
    // Your own guard reacts to the predicted input immediately; others hold it briefly so the
    // AI's one-tick blocks read as a guard rather than a flicker.
    const blockNow = alive && (mine && this.predicted ? this.predicted.block : p.block);
    if (blockNow) rig.blockUntil = time + (mine ? 0 : 250);
    const guarding = alive && (blockNow || time < rig.blockUntil);
    const guard = this.spring(rig, 'guard', guarding && !swinging ? 1 : 0, 24, dt, 1, false);
    const dodging = alive && p.invulnerable > 0 && p.dodge > 0.75,
      hurt = alive && p.stun > 0;
    const key = swinging ? (spear ? thrustPose(swingT) : slashPose(swingT)) : null;
    const lean = this.spring(
      rig,
      'lean',
      !alive ? 0 : dodging ? 0.34 : hurt ? -0.2 : run * 0.14 + (key?.lean ?? 0) - guard * 0.05,
      16,
      dt,
    );
    const crouch = guard * 3 + (dodging ? 9 : 0) + (key ? Math.max(0, key.lean) * 12 : 0);
    const limb = (
      upper: string,
      lower: string,
      boot: string,
      hip: { x: number; y: number },
      foot: { x: number; y: number },
      roll: number,
      length = 26,
    ) => {
      const knee = joint(hip, foot, length, length, -1);
      parts[upper]
        .setPosition(hip.x, hip.y)
        .setRotation(Math.atan2(knee.y - hip.y, knee.x - hip.x) - Math.PI / 2);
      parts[lower]
        .setPosition(knee.x, knee.y)
        .setRotation(Math.atan2(foot.y - knee.y, foot.x - knee.x) - Math.PI / 2);
      parts[boot].setPosition(foot.x + 3, foot.y).setRotation(roll);
    };
    // The torso pivots at the shoulders, so a forward lean pushes the hips back.
    const hipX = -lean * 36;
    for (const [side, dx, shift] of [
      ['front', -11, 0],
      ['back', 11, Math.PI],
    ] as const) {
      const f = active
        ? runFoot(phase + shift, run, speed > 240 ? 1 : 0.85)
        : { x: 0, y: 0, roll: 0 };
      // Stance widens under a guard or lunge.
      const brace =
        (guard * 4 + (key ? Math.max(0, key.lean) * 30 : 0)) * (side === 'front' ? -1 : 1);
      limb(
        side + 'Thigh',
        side + 'Shin',
        side + 'Boot',
        { x: dx + hipX, y: -34 + offset + crouch },
        { x: dx + (p.mount ? 7 : f.x + brace), y: p.mount ? -27 : 10 + f.y },
        p.mount ? 0 : f.roll,
      );
    }
    // Pelvis bob at twice the stride frequency; the body rides lower when sprinting.
    const bob = active
      ? Math.cos(phase * 2) * (1 + 1.6 * run) - run * 1.5
      : Math.sin(time * 0.0018) * 0.4;
    const bodyY = offset + bob + crouch;
    parts.torso.setPosition(0, -78 + bodyY).setRotation(lean);
    parts.head.setPosition(lean * 6, -92 + bodyY).setRotation(lean * 0.5);
    const cape = this.spring(
      rig,
      'cape',
      run * 0.4 + lean * 0.6 + (active ? Math.sin(phase) * 0.08 : 0) - (key ? 0.15 : 0),
      9,
      dt,
      0.55,
    );
    parts.cape.setPosition(-5 - lean * 4, -76 + bodyY).setRotation(cape);
    const arm = (upper: string, lower: string, sx: number, rotation: number, bend: number) => {
      const shoulder = { x: sx - lean * 12, y: -66 + bodyY + Math.abs(lean) * 2 },
        elbow = {
          x: shoulder.x - Math.sin(rotation) * 22,
          y: shoulder.y + Math.cos(rotation) * 22,
        };
      const a = rotation + bend;
      parts[upper].setPosition(shoulder.x, shoulder.y).setRotation(rotation);
      parts[lower].setPosition(elbow.x, elbow.y).setRotation(a);
      return { x: elbow.x - Math.sin(a) * 22, y: elbow.y + Math.cos(a) * 22, angle: a };
    };
    // Arms counter-swing the legs; elbows bend more as the warrior speeds up.
    const swingArm = active && !p.mount ? Math.sin(phase) * (0.3 + 0.45 * run) : 0;
    let wU = p.mount ? -0.8 : 0.15 - swingArm,
      wB = p.mount ? -0.25 : -0.35 - 0.9 * run,
      grip = spear ? -0.02 : -0.05,
      sU = p.mount ? -0.5 : 0.05 + swingArm,
      sB = -0.35 - 0.8 * run;
    // Raised guard: shield arm forward with the forearm up, shield square in front of the chest.
    wU = mix(wU, 0.35, guard);
    wB = mix(wB, -1.2, guard);
    sU = mix(sU, -1.3, guard);
    sB = mix(sB, -0.45, guard);
    if (key) {
      wU = key.u;
      wB = key.b;
      grip = key.grip;
      sU = mix(sU, 0.4, 0.6);
    }
    if (!alive) {
      wU = 0.4;
      sU = -0.3;
    }
    const tight = key ? 70 : 20;
    const hand = arm(
      'upperArm',
      'forearm',
      23,
      this.spring(rig, 'wU', wU, tight, dt),
      this.spring(rig, 'wB', wB, tight, dt),
    );
    const shieldHand = arm(
      'backUpperArm',
      'backForearm',
      -23,
      this.spring(rig, 'sU', sU, 22, dt),
      this.spring(rig, 'sB', sB, 22, dt),
    );
    parts.weapon
      .setPosition(hand.x, hand.y)
      .setRotation(hand.angle + this.spring(rig, 'grip', grip, key ? 70 : 24, dt))
      // A thrown spear leaves the hand until it lands; a new one is drawn for the next pass.
      .setVisible(!w.projectiles.some((a) => a.owner === p.id && a.kind === 'spear'));
    parts.shield
      .setPosition(shieldHand.x + guard * 3, shieldHand.y - 7 + guard * 9)
      .setRotation(mix(-swingArm * 0.15, -0.06, guard));
    if (p.mount) {
      for (let n = 0; n < 4; n++) {
        const hip = { x: n < 2 ? -29 : 28, y: -12 + (n % 2 ? -3 : 0) },
          f = active ? gaitFoot(phase + (n === 0 || n === 3 ? 0 : Math.PI), 19) : { x: 0, y: 0 };
        const foot = { x: hip.x + f.x, y: 31 + f.y },
          knee = joint(hip, foot, 24, 24, n < 2 ? 1 : -1);
        parts['horseUpper' + n]
          .setPosition(hip.x, hip.y)
          .setRotation(Math.atan2(knee.y - hip.y, knee.x - hip.x) - Math.PI / 2);
        parts['horseLower' + n]
          .setPosition(knee.x, knee.y)
          .setRotation(Math.atan2(foot.y - knee.y, foot.x - knee.x) - Math.PI / 2);
      }
      parts.horseTail.setRotation(Math.sin(time * 0.005) * 0.15);
      if (
        p.id === this.mine &&
        moving &&
        time - this.lastHoof > Math.max(130, 280 - speed * 0.25)
      ) {
        this.lastHoof = time;
        audio.play('hoof');
      }
    }
    if (p.kind && p.kind !== 'warrior' && p.kind !== 'civilian') {
      for (const part of Object.values(parts)) part.setVisible(false);
      parts.torso.setVisible(true);
      const index = p.kind === 'hyena' ? 0 : p.kind === 'caster' ? 1 : 2;
      parts.torso
        .setTexture('monsters', 'cell' + index)
        .setDisplaySize(p.kind === 'hyena' ? 92 : 84, p.kind === 'hyena' ? 75 : 100)
        .setOrigin(0.5, 0.85)
        .setPosition(0, 0);
      parts.head.setVisible(false);
      parts.weapon.setVisible(false);
      parts.shield.setVisible(false);
      if (p.kind === 'hyena') {
        parts.torso.y = 0;
        parts.torso.setRotation(stride * 0.08);
      }
    }
    if (p.hp <= 0) {
      // Fall over with an eased, accelerating topple instead of snapping flat.
      const t = Math.min(1, (time - (rig.deadAt ?? time)) / 420);
      rig.root.setRotation(1.25 * t * t * (3 - 2 * t));
      for (const part of Object.values(parts)) part.setTint(0x716757);
    } else {
      rig.root.setRotation(hurt ? -0.08 : 0);
      for (const part of Object.values(parts)) part.clearTint();
      parts.torso.setTint(p.hero === 1 ? 0xe0f0cf : p.hero === 2 ? 0xc5d6a0 : 0xffffff);
      if (p.armor === 'royal-feast') {
        // Royal Feast set from the lunch gathering perk: gilded plate, emerald cape.
        for (const name of ROYAL_FEAST_GOLD) parts[name]?.setTint(0xffd36b);
        parts.cape.setTint(0x2fa877);
        parts.shield.setTint(0xffe7a0);
      }
    }
    rig.label
      .setPosition(point.x, point.y - (p.mount ? 135 : 104))
      .setDepth(point.y + 2)
      .setText(p.name + (p.id === this.mine ? ' · YOU' : ''));
    rig.health.clear().setDepth(point.y + 1);
    rig.health.fillStyle(0x10231f);
    rig.health.fillRoundedRect(point.x - 24, point.y - (p.mount ? 124 : 94), 48, 5, 2);
    rig.health.fillStyle(p.team === 0 ? 0x7fe0a7 : 0xf28f7a);
    rig.health.fillRect(
      point.x - 23,
      point.y - (p.mount ? 123 : 93),
      46 * Math.min(1, p.hp / (p.maxHp ?? 100)),
      3,
    );
    if (p.id === this.mine) {
      this.fx.lineStyle(2, 0xf7d58b, 0.8);
      this.fx.strokeEllipse(point.x, point.y + 5, p.mount ? 85 : 55, p.mount ? 35 : 24);
    }
    if (guard > 0.5) {
      this.fx.lineStyle(3, 0x93f5ed, 0.35 + 0.4 * guard);
      this.fx.strokeEllipse(point.x, point.y - 35, 62, 75);
    }
    if (alive && p.armor === 'royal-feast') {
      this.fx.lineStyle(2, 0xffd36b, 0.35 + 0.2 * Math.sin(time * 0.005));
      this.fx.strokeEllipse(point.x, point.y + 5, 48, 21);
    }
    if (swinging && swingT > 0.3 && swingT < 0.85) {
      const a = project(Math.cos(p.aim) * 80, Math.sin(p.aim) * 80);
      this.fx.lineStyle(12, 0xffbf48, 0.2);
      this.fx.lineBetween(point.x, point.y - 35, point.x + a.x, point.y + a.y - 35);
      this.fx.lineStyle(3, 0xfff4bd, 0.95);
      if (p.role === 'spear' || p.mount)
        this.fx.lineBetween(point.x, point.y - 32, point.x + a.x * 1.25, point.y + a.y * 1.25 - 32);
      else {
        this.fx.beginPath();
        this.fx.arc(
          point.x,
          point.y - 32,
          62,
          Math.atan2(a.y, a.x) - 0.8,
          Math.atan2(a.y, a.x) + 1.1,
        );
        this.fx.strokePath();
        const reduced = useUI.getState().reducedMotion,
          angle = Math.atan2(a.y, a.x),
          progress = Phaser.Math.Clamp((swingT - 0.3) / 0.55, 0, 1);
        for (const [width, color, alpha] of [
          [17, 0xc84318, 0.3],
          [10, 0xff7b22, 0.65],
          [4, 0xffe5a0, 0.95],
        ]) {
          this.fx.lineStyle(width, color, reduced ? alpha * 0.5 : alpha);
          this.fx.beginPath();
          this.fx.arc(
            point.x,
            point.y - 32,
            62,
            angle - 0.8 + progress * 0.45,
            angle + 0.3 + progress * 0.8,
          );
          this.fx.strokePath();
        }
        if (!reduced)
          for (let n = 0; n < 7; n++) {
            const t = (progress + n / 9) % 1,
              b = angle - 0.8 + t * 1.8,
              r = 64 + Math.sin(n * 8 + p.attackId) * 7;
            this.fx.fillStyle(n % 2 ? 0xffa02d : 0xffe3a1, (1 - t) * 0.8);
            this.fx.fillTriangle(
              point.x + Math.cos(b) * r,
              point.y - 32 + Math.sin(b) * r - t * 12,
              point.x + Math.cos(b) * r - 3,
              point.y - 32 + Math.sin(b) * r + 3,
              point.x + Math.cos(b) * r + 2,
              point.y - 32 + Math.sin(b) * r + 4,
            );
          }
      }
    }
  }
  text(id: string, text: string, x: number, y: number, color = '#ffe3a4', size = 12) {
    let t = this.labels.get(id);
    if (!t) {
      t = this.add
        .text(x, y, text, {
          fontFamily: 'Noto Serif Ethiopic, Georgia',
          fontSize: size,
          color,
          stroke: '#14241f',
          strokeThickness: 3,
        })
        .setOrigin(0.5)
        .setDepth(21000);
      this.labels.set(id, t);
    }
    t.setText(text).setPosition(x, y).setVisible(true);
    return t;
  }
  drawObjectives(w: World, time: number) {
    for (const [id, t] of this.labels) if (id.startsWith('objective-')) t.setVisible(false);
    if (w.mode === 'squad' || w.campaign?.missionId === 6)
      w.zones.forEach((z, n) => {
        const p = project(z.x, z.y),
          color = z.owner === 0 ? 0x73d5aa : z.owner === 1 ? 0xef846a : 0xf6d78a;
        this.fx.lineStyle(3, color, 0.85);
        this.fx.strokeEllipse(p.x, p.y, 170, 85);
        this.fx.fillStyle(color, 0.13);
        this.fx.fillEllipse(p.x, p.y, 170, 85);
        this.text('objective-zone' + n, String.fromCharCode(65 + n), p.x, p.y - 38);
      });
    const markers =
      w.campaign?.markers ??
      (w.mode === 'quest'
        ? [
            ...(!w.artifacts.every(Boolean)
              ? [
                  {
                    x: 180,
                    y: 170,
                    id: 'a0',
                    label: 'Royal seal',
                    kind: 'seal',
                    done: w.artifacts[0],
                  },
                  {
                    x: 1020,
                    y: 160,
                    id: 'a1',
                    label: 'Royal seal',
                    kind: 'seal',
                    done: w.artifacts[1],
                  },
                  {
                    x: 1040,
                    y: 610,
                    id: 'a2',
                    label: 'Royal seal',
                    kind: 'seal',
                    done: w.artifacts[2],
                  },
                ]
              : []),
          ]
        : []);
    const me = w.players.find((p) => p.id === this.mine);
    for (const m of markers) {
      const p = project(m.x, m.y),
        color = m.done ? 0x65d69f : 0xf4d57d;
      this.fx.lineStyle(3, color, 0.8);
      this.fx.strokeEllipse(p.x, p.y, 70, 35);
      if (m.kind === 'ring') {
        this.fx.strokeEllipse(p.x, p.y - 35, 55, 80);
      } else if (m.kind === 'mirror') {
        const angle = (m as { value?: number }).value ?? 0;
        this.fx.lineStyle(5, 0xbcd8dc);
        this.fx.lineBetween(p.x - 15, p.y - 15, p.x + 15, p.y - 45);
        const a = project(
          Math.cos((angle * Math.PI) / 2) * 130,
          Math.sin((angle * Math.PI) / 2) * 130,
        );
        this.fx.lineStyle(3, 0xfce2a0, 0.75);
        this.fx.lineBetween(p.x, p.y - 25, p.x + a.x, p.y + a.y - 25);
      } else {
        this.fx.fillStyle(color, 0.8);
        this.fx.fillTriangle(p.x, p.y - 42, p.x - 10, p.y - 23, p.x + 10, p.y - 23);
      }
      this.text(
        'objective-' + m.id,
        m.done ? '✓ ' + m.label : m.label,
        p.x,
        p.y - 64,
        m.done ? '#a8e9b9' : '#ffe3a4',
        11,
      );
    }
    const next = markers.find((m) => !m.done);
    if (me && next) {
      const p = project(next.x, next.y),
        cam = this.cameras.main,
        screen = {
          x: (p.x - cam.scrollX - cam.width / 2) * cam.zoom + cam.width / 2,
          y: (p.y - cam.scrollY - cam.height / 2) * cam.zoom + cam.height / 2,
        };
      if (
        screen.x < 70 ||
        screen.y < 70 ||
        screen.x > cam.width - 70 ||
        screen.y > cam.height - 70
      ) {
        const pos = cam.getWorldPoint(
          Phaser.Math.Clamp(screen.x, 80, cam.width - 80),
          Phaser.Math.Clamp(screen.y, 80, cam.height - 80),
        );
        this.text('objective-direction', '◆ ' + next.label, pos.x, pos.y, '#fff1bc', 13);
      }
    }
    if (['guardian', 'challenge', 'eclipse'].includes(w.phase)) {
      const p = project(w.bossX, w.bossY);
      if (!this.boss)
        this.boss = this.add
          .image(p.x, p.y, 'bosses', w.phase === 'guardian' ? 'cell0' : 'cell1')
          .setOrigin(0.5, 0.85);
      this.boss
        .setTexture('bosses', w.phase === 'guardian' ? 'cell0' : 'cell1')
        .setPosition(p.x, p.y)
        .setScale(145 / this.boss.frame.height)
        .setDepth(p.y + 1)
        .setVisible(true);
      if (w.telegraph === 'shockwave') {
        this.fx.lineStyle(3, 0xff7a64, 0.9);
        this.fx.fillStyle(0xef534f, 0.18);
        this.fx.fillEllipse(p.x, p.y, 650, 320);
        this.fx.strokeEllipse(p.x, p.y, 650, 320);
      }
      if (w.telegraph === 'shield' || w.campaign?.shielded) {
        this.fx.lineStyle(5, 0xb9a2f5, 0.8);
        this.fx.strokeEllipse(p.x, p.y - 60, 160, 175);
        this.text(
          'objective-shield',
          w.phase === 'guardian' ? 'WAIT FOR RECOVERY' : 'BREAK THE CROWN WARDS',
          p.x,
          p.y - 170,
          '#d7c4ff',
        );
      }
      if (w.telegraph === 'vulnerable') {
        this.fx.lineStyle(5, 0xffd873, 0.8);
        this.fx.strokeEllipse(p.x, p.y, 140, 70);
      }
    } else this.boss?.setVisible(false);
  }
  drawEffects(w: World, time: number) {
    // Thrown spears fly as the real spear sprite, pointing along their flight path.
    const flying = new Set<number>();
    for (const a of w.projectiles.filter((a) => a.kind === 'spear')) {
      flying.add(a.id);
      let sprite = this.spears.get(a.id);
      if (!sprite) {
        sprite = this.add.image(0, 0, 'rig-v3', 'cell8').setOrigin(0.5, 0.5);
        sprite.setScale(Math.min(19 / sprite.frame.width, 88 / sprite.frame.height) * 0.78);
        this.spears.set(a.id, sprite);
      }
      const at = project(a.x, a.y, 30),
        ahead = project(a.x + a.vx * 0.04, a.y + a.vy * 0.04, 30);
      sprite
        .setPosition(at.x, at.y)
        .setRotation(Math.atan2(ahead.y - at.y, ahead.x - at.x) + Math.PI / 2)
        .setDepth(at.y + 40);
    }
    for (const [id, sprite] of this.spears)
      if (!flying.has(id)) {
        sprite.destroy();
        this.spears.delete(id);
      }
    for (const a of w.projectiles) {
      if (a.kind === 'spear') continue;
      const p = project(a.x, a.y, 30),
        last = project(a.x - a.vx * 0.04, a.y - a.vy * 0.04, 30);
      this.fx.lineStyle(3, a.owner === 'boss' || a.kind === 'magic' ? 0xc49bff : 0xffec9f, 0.9);
      this.fx.lineBetween(p.x, p.y, last.x, last.y);
    }
    for (const e of w.events) {
      const id = `${e.tick}:${e.kind}:${e.actor}:${e.x}:${e.y}`;
      if (w.tick - e.tick > 28) continue;
      if (!this.seen.has(id)) {
        this.seen.add(id);
        audio.play(e.kind);
        if (e.kind === 'hit' && (e.amount ?? 0) >= 24 && !useUI.getState().reducedMotion)
          this.cameras.main.shake(70, 0.002);
      }
      const p = project(e.x, e.y, 35),
        age = (w.tick - e.tick) / 28;
      if (e.kind === 'hit' || e.kind === 'block') {
        this.fx.lineStyle(3, e.kind === 'block' ? 0x8cf6ed : 0xffe4a0, 1 - age);
        this.fx.strokeEllipse(p.x, p.y, 15 + age * 60, 15 + age * 35);
        for (let n = 0; n < 6; n++) {
          const angle = (n * Math.PI) / 3 + e.tick,
            r = age * 45;
          this.fx.fillStyle(0xffdf88, 1 - age);
          this.fx.fillCircle(p.x + Math.cos(angle) * r, p.y + Math.sin(angle) * r - age * 20, 2);
        }
        this.text(
          'hit-' + id,
          e.kind === 'block' ? 'BLOCK' : String(e.amount ?? ''),
          p.x,
          p.y - age * 40,
          '#fff0bd',
          13,
        ).setAlpha(1 - age);
      }
      if (e.kind === 'danger') {
        this.fx.lineStyle(3, 0xef8166, 0.7);
        this.fx.strokeEllipse(p.x, p.y + 35, 180, 90);
      }
    }
    for (const [id, t] of this.labels)
      if (id.startsWith('hit-') && Number(id.slice(4).split(':')[0]) < w.tick - 28) {
        t.destroy();
        this.labels.delete(id);
      }
    if (this.seen.size > 800) this.seen.clear();
  }
}
export function mountGame(el: HTMLElement, room: Room, id: string) {
  return new Phaser.Game({
    type: preferredRenderer(),
    parent: el,
    width: Math.max(640, el.clientWidth),
    height: Math.max(420, el.clientHeight),
    scale: { mode: Phaser.Scale.RESIZE, autoCenter: Phaser.Scale.CENTER_BOTH },
    render: { antialias: true },
    scene: [new IsoArena(room, id)],
    audio: { noAudio: true },
  });
}
// Software WebGL rasterizers are much slower than Canvas for this small 2D scene.
// Hardware-backed browsers retain WebGL; no gameplay rules depend on the renderer.
function preferredRenderer() {
  if (import.meta.env.VITE_RENDERER === 'canvas') return Phaser.CANVAS;
  if (import.meta.env.VITE_RENDERER === 'webgl') return Phaser.WEBGL;
  try {
    const probe = document.createElement('canvas'),
      gl = probe.getContext('webgl');
    if (gl) {
      const info = gl.getExtension('WEBGL_debug_renderer_info'),
        name = info ? String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL)) : '';
      gl.getExtension('WEBGL_lose_context')?.loseContext();
      if (/swiftshader|llvmpipe|software|microsoft basic/i.test(name)) return Phaser.CANVAS;
    }
  } catch {
    /* Phaser handles unavailable contexts. */
  }
  return Phaser.AUTO;
}
