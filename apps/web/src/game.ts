import Phaser from 'phaser';
import type { Room } from 'colyseus.js';
import {
  WIDTH,
  HEIGHT,
  obstacles,
  artifacts,
  pillars,
  move,
  type Fighter,
  type Input,
  type World,
} from '../../../packages/shared/src/game';
import { useUI } from './store';
export class Arena extends Phaser.Scene {
  sprites = new Map<string, Phaser.GameObjects.Image>();
  bossSprite?: Phaser.GameObjects.Image;
  dodgeQueued = false;
  abilityQueued = false;
  attackQueued = false;
  interactQueued = false;
  room: Room;
  mine: string;
  gfx!: Phaser.GameObjects.Graphics;
  keys!: Record<string, Phaser.Input.Keyboard.Key>;
  labels = new Map<string, Phaser.GameObjects.Text>();
  rendered = new Map<string, { x: number; y: number }>();
  seq = 0;
  lastSend = 0;
  lastTick = -1;
  predicted: Fighter | null = null;
  pending: Input[] = [];
  seen = new Set<string>();
  audio: AudioContext | null = null;
  paused = false;
  constructor(room: Room, mine: string) {
    super('arena');
    this.room = room;
    this.mine = mine;
  }
  preload() {
    this.load.image('warriors', '/assets/warriors.png');
    this.load.image('bosses', '/assets/bosses.png');
  }
  create() {
    this.cameras.main.setBackgroundColor('#18242a');
    this.gfx = this.add.graphics();
    this.keys = this.input.keyboard!.addKeys('W,A,S,D,SPACE,Q,E,ESC,TAB') as Record<
      string,
      Phaser.Input.Keyboard.Key
    >;
    this.input.mouse!.disableContextMenu();
    this.input.keyboard!.addCapture(['SPACE', 'TAB']);
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
    this.keys.SPACE.on('down', () => (this.dodgeQueued = true));
    this.keys.Q.on('down', () => (this.abilityQueued = true));
    this.keys.E.on('down', () => (this.interactQueued = true));
    this.input.on('pointerdown', (p: Phaser.Input.Pointer) => {
      if (p.leftButtonDown()) this.attackQueued = true;
    });
    this.game.canvas.dataset.ready = 'true';
  }
  update(time: number, delta: number) {
    const w = useUI.getState().snapshot;
    if (!w) return;
    if (w.tick === 0 && w.mode !== 'tutorial') {
      this.draw(w, delta);
      return;
    }
    const me = w.players.find((p) => p.id === this.mine),
      pointer = this.input.activePointer;
    if (me) {
      if (this.lastTick !== w.tick) {
        this.lastTick = w.tick;
        this.pending = this.pending.filter((i) => i.seq > me.seq);
        const predicted = { ...me };
        for (const i of this.pending) move(predicted, i, 1 / 30);
        this.predicted = predicted;
      }
      const p = this.predicted ?? me;
      const i: Input = {
        seq: this.seq++,
        x: this.paused ? 0 : Number(this.keys.D.isDown) - Number(this.keys.A.isDown),
        y: this.paused ? 0 : Number(this.keys.S.isDown) - Number(this.keys.W.isDown),
        aim: Math.atan2(pointer.worldY - p.y, pointer.worldX - p.x),
        attack: !this.paused && (pointer.leftButtonDown() || this.attackQueued),
        block: !this.paused && pointer.rightButtonDown(),
        dodge: !this.paused && (this.keys.SPACE.isDown || this.dodgeQueued),
        ability: !this.paused && (this.keys.Q.isDown || this.abilityQueued),
        interact: !this.paused && (this.keys.E.isDown || this.interactQueued),
      };
      if (time - this.lastSend >= 1000 / 30 && !w.finished) {
        this.lastSend = time;
        this.room.send('input', i);
        this.dodgeQueued = false;
        this.abilityQueued = false;
        this.attackQueued = false;
        this.interactQueued = false;
        this.pending.push(i);
        if (this.pending.length > 90) this.pending.shift();
        if (this.predicted) move(this.predicted, i, 1 / 30);
      }
    }
    this.draw(w, delta);
  }
  draw(w: World, delta: number) {
    const g = this.gfx;
    g.clear();
    g.fillStyle(0x112127);
    g.fillRect(0, 0, WIDTH, HEIGHT);
    // Raised sandstone arena, tilework, retaining walls and geometric textile borders.
    g.fillStyle(0x35433d);
    g.fillRoundedRect(42, 62, 1116, 660, 30);
    g.fillStyle(0x9d8662);
    g.fillRoundedRect(58, 78, 1084, 620, 12);
    g.fillStyle(0xb4a17c);
    g.fillRect(80, 100, 1040, 575);
    for (let x = 80; x < 1120; x += 65)
      for (let y = 100; y < 675; y += 58) {
        g.lineStyle(1, 0x7c7056, 0.23);
        g.strokeRect(x, y, 65, 58);
        if ((x + y) % 3 === 0) {
          g.fillStyle(0xc6b38a, 0.3);
          g.fillRect(x + 4, y + 4, 56, 49);
        }
      }
    g.lineStyle(3, 0x7d5635, 0.5);
    g.strokeCircle(600, 380, 160);
    g.strokeCircle(600, 380, 148);
    g.lineStyle(2, 0x7d5635, 0.5);
    for (let n = 0; n < 8; n++) {
      const a = (n * Math.PI) / 4;
      g.lineBetween(
        600 + Math.cos(a) * 70,
        380 + Math.sin(a) * 70,
        600 + Math.cos(a) * 145,
        380 + Math.sin(a) * 145,
      );
    }
    g.strokeCircle(600, 380, 70);
    for (let x = 70; x < 1140; x += 28) {
      g.fillStyle(x % 56 ? 0xd6a64d : 0x295a4b);
      g.fillTriangle(x, 684, x + 12, 697, x + 24, 684);
      g.fillStyle(0xb14b35);
      g.fillTriangle(x, 78, x + 12, 65, x + 24, 78);
    }
    if (w.mode === 'squad')
      w.zones.forEach((z, n) => {
        const c = z.owner === 0 ? 0x56bf9d : z.owner === 1 ? 0xe36c58 : 0xe6c780;
        g.fillStyle(c, 0.18);
        g.fillCircle(z.x, z.y, 94);
        g.lineStyle(3, c, 0.8);
        g.strokeCircle(z.x, z.y, 94);
        g.fillStyle(0x4c3826);
        g.fillRect(z.x - 4, z.y - 48, 8, 68);
        g.fillStyle(c);
        g.fillTriangle(z.x + 4, z.y - 48, z.x + 45, z.y - 34, z.x + 4, z.y - 18);
        this.label('zone' + n, String.fromCharCode(65 + n), z.x, z.y + 65, '#fff2ca', 18);
      });
    for (const o of obstacles) {
      g.fillStyle(0x000000, 0.2);
      g.fillRoundedRect(o.x + 8, o.y + 10, o.w, o.h, 6);
      g.fillStyle(0x675b47);
      g.fillRoundedRect(o.x, o.y, o.w, o.h, 5);
      g.fillStyle(0xc4ab7c);
      g.fillRoundedRect(o.x + 3, o.y + 2, o.w - 6, o.h - 12, 4);
      g.lineStyle(2, 0x8e7552);
      g.strokeRect(o.x + 10, o.y + 8, o.w - 20, o.h - 25);
      g.fillStyle(0x58745a);
      g.fillCircle(o.x + o.w - 4, o.y + o.h - 6, 12);
    }
    for (const x of [95, 1105])
      for (const y of [120, 650]) {
        g.fillStyle(0x6c5941);
        g.fillRect(x - 12, y - 18, 24, 40);
        g.fillStyle(0xe4b953);
        g.fillCircle(x, y - 23, 9 + Math.sin(w.tick / 3) * 2);
        g.fillStyle(0xffe9a1);
        g.fillCircle(x, y - 25, 5);
      }
    if (w.mode === 'quest') this.drawQuest(w);
    for (const a of w.projectiles) {
      g.lineStyle(3, 0xffd67c);
      g.lineBetween(a.x, a.y, a.x - a.vx * 0.025, a.y - a.vy * 0.025);
    }
    for (const p of [...w.players].sort((a, b) => a.y - b.y)) {
      let r = this.rendered.get(p.id);
      const target = p.id === this.mine && this.predicted ? this.predicted : p;
      if (!r) {
        r = { x: target.x, y: target.y };
        this.rendered.set(p.id, r);
      }
      const smooth = Math.min(1, delta / 70);
      r.x += (target.x - r.x) * smooth;
      r.y += (target.y - r.y) * smooth;
      this.warrior(p, r.x, r.y, w.tick);
      this.label(
        p.id,
        p.name + (p.id === this.mine ? ' · YOU' : ''),
        r.x,
        r.y - 51,
        p.team === 0 ? '#e8f7dd' : '#ffe2d0',
        11,
      );
    }
    for (const e of w.events) {
      if (w.tick - e.tick > 20) continue;
      const age = (w.tick - e.tick) / 20;
      if (e.kind === 'hit' || e.kind === 'block') {
        g.lineStyle(3, e.kind === 'block' ? 0x76d9df : 0xffd377, 1 - age);
        g.strokeCircle(e.x, e.y, 12 + age * 28);
        this.label(
          'event' + e.tick + e.actor,
          (e.kind === 'block' ? 'BLOCK ' : '−') + (e.amount ?? ''),
          e.x,
          e.y - 35 - age * 35,
          e.kind === 'block' ? '#b5f4ff' : '#fff1bd',
          16,
          1 - age,
        );
        const key = e.tick + ':' + e.actor + ':' + e.x;
        if (!this.seen.has(key)) {
          this.seen.add(key);
          if (this.seen.size > 500) this.seen.clear();
          this.playImpact();
          if (e.amount! >= 24) this.cameras.main.shake(90, 0.003);
        }
      }
    }
    for (const [id, t] of this.labels)
      if (id.startsWith('event') && Number(id.slice(5).match(/^\d+/)?.[0] ?? 0) < w.tick - 20) {
        t.destroy();
        this.labels.delete(id);
      }
  }
  label(id: string, text: string, x: number, y: number, color: string, size: number, alpha = 1) {
    let t = this.labels.get(id);
    if (!t) {
      t = this.add
        .text(x, y, text, {
          fontFamily: 'Georgia',
          fontSize: size,
          color,
          stroke: '#18231f',
          strokeThickness: 3,
        })
        .setOrigin(0.5)
        .setDepth(30);
      this.labels.set(id, t);
    }
    t.setText(text).setPosition(x, y).setColor(color).setAlpha(alpha);
  }
  warrior(p: Fighter, x: number, y: number, tick: number) {
    const g = this.gfx;
    const alive = p.hp > 0;
    if (!alive) {
      this.sprites.get(p.id)?.setVisible(false);
      g.fillStyle(0x3d2e25, 0.5);
      g.fillEllipse(x, y, 42, 17);
      return;
    }
    const a = p.aim,
      c = p.team === 0 ? 0x29745d : 0xa64537,
      bob = Math.sin(tick * 0.55) * Math.min(2, Math.hypot(p.vx, p.vy) / 100);
    if (this.textures.exists('warriors')) {
      let sprite = this.sprites.get(p.id);
      if (!sprite) {
        const texture = this.textures.get('warriors'),
          source = texture.getSourceImage() as HTMLImageElement;
        const fw = source.width / 2,
          fh = source.height / 2;
        const frame = 'hero' + p.hero;
        if (!texture.has(frame))
          texture.add(frame, 0, (p.hero % 2) * fw, Math.floor(p.hero / 2) * fh, fw, fh);
        sprite = this.add
          .image(x, y, 'warriors', frame)
          .setScale(88 / fw)
          .setDepth(10);
        this.sprites.set(p.id, sprite);
      }
      sprite
        .setPosition(x, y - 6 + bob)
        .setVisible(true)
        .setFlipX(Math.cos(a) < 0)
        .setAlpha(p.invulnerable > 0 ? 0.65 : 1)
        .setRotation(p.attack > 0 ? Math.sin(p.attack * 14) * 0.12 : 0);
      g.fillStyle(0x000000, 0.25);
      g.fillEllipse(x, y + 24, 45, 18);
      g.lineStyle(p.id === this.mine ? 3 : 2, p.team === 0 ? 0x7cdbb1 : 0xf39b72, 0.8);
      g.strokeEllipse(x, y + 23, 48, 22);
      if (p.attack > 0.08) {
        g.lineStyle(9, 0xffdf91, 0.5);
        g.beginPath();
        g.arc(x, y, 65, a - 0.8, a + 1);
        g.strokePath();
      }
      if (p.block) {
        g.lineStyle(5, 0x8ce6df, 0.85);
        g.beginPath();
        g.arc(x, y, 45, a - 1, a + 1);
        g.strokePath();
      }
      g.fillStyle(0x172520);
      g.fillRect(x - 24, y - 43, 48, 5);
      g.fillStyle(p.team === 0 ? 0x7dcc93 : 0xe16d51);
      g.fillRect(x - 23, y - 42, (46 * p.hp) / 100, 3);
      return;
    }
    g.fillStyle(0x000000, 0.25);
    g.fillEllipse(x + 3, y + 13, 48, 23);
    if (p.id === this.mine) {
      g.lineStyle(2, 0xf4cf79, 0.9);
      g.strokeEllipse(x, y + 12, 49, 24);
    }
    if (p.invulnerable > 0) {
      g.lineStyle(3, 0x98e4e7, 0.6);
      g.strokeCircle(x, y, 30);
    }
    g.fillStyle(c);
    g.fillTriangle(x - 20, y + 8, x + 19, y + 9, x - Math.cos(a) * 27, y + 26);
    g.fillStyle(0x362c26);
    g.fillEllipse(x - 9, y + 15 + bob, 13, 14);
    g.fillEllipse(x + 9, y + 15 - bob, 13, 14);
    g.fillStyle(0xb69755);
    g.fillRoundedRect(x - 16, y - 17 + bob, 32, 35, 9);
    g.fillStyle(0xddc27b);
    g.fillRoundedRect(x - 12, y - 15 + bob, 24, 20, 5);
    g.lineStyle(2, 0x725533);
    g.lineBetween(x - 14, y + 6, x + 14, y + 6);
    g.fillStyle(c);
    g.fillRect(x - 4, y - 8 + bob, 8, 22);
    g.fillStyle(0x68452e);
    g.fillCircle(x, y - 19 + bob, 12);
    g.fillStyle(p.hero === 1 ? 0x29201d : 0xd4ad60);
    g.fillEllipse(x, y - 25 + bob, 25, 15);
    g.fillStyle(0xf2d893);
    g.fillRect(x - 12, y - 28 + bob, 24, 4);
    if (p.hero === 0) {
      g.fillTriangle(x - 10, y - 27, x - 7, y - 38, x - 2, y - 27);
      g.fillTriangle(x - 2, y - 27, x + 2, y - 40, x + 7, y - 27);
    }
    if (p.hero === 3) {
      g.fillStyle(0xba4430);
      g.fillEllipse(x + 2, y - 38, 8, 25);
    }
    const sx = x + Math.cos(a + 1.2) * 22,
      sy = y + Math.sin(a + 1.2) * 22;
    g.fillStyle(c);
    g.fillCircle(sx, sy, 15);
    g.lineStyle(3, 0xdcb965);
    g.strokeCircle(sx, sy, 15);
    g.fillStyle(0xe6c77b);
    g.fillCircle(sx, sy, 5);
    if (p.block) {
      g.lineStyle(4, 0xa6e6df, 0.8);
      g.beginPath();
      g.arc(x, y, 37, a - 1.1, a + 1.1);
      g.strokePath();
    }
    const swing = p.attack > 0 ? Math.sin(((0.34 - p.attack) / 0.34) * Math.PI) * 1.6 - 0.8 : 0,
      wa = a + swing;
    const wx = x + Math.cos(wa) * 20,
      wy = y + Math.sin(wa) * 20;
    g.lineStyle(5, 0x705035);
    g.lineBetween(wx, wy, x + Math.cos(wa) * 40, y + Math.sin(wa) * 40);
    g.lineStyle(5, 0xe3dfbe);
    g.lineBetween(
      x + Math.cos(wa) * 38,
      y + Math.sin(wa) * 38,
      x + Math.cos(wa) * 70,
      y + Math.sin(wa) * 70,
    );
    g.lineStyle(3, 0xe5ba5b);
    g.lineBetween(
      x + Math.cos(wa) * 32 - Math.sin(wa) * 9,
      y + Math.sin(wa) * 32 + Math.cos(wa) * 9,
      x + Math.cos(wa) * 32 + Math.sin(wa) * 9,
      y + Math.sin(wa) * 32 - Math.cos(wa) * 9,
    );
    if (p.attack > 0.08) {
      g.lineStyle(12, 0xffe4a0, 0.32);
      g.beginPath();
      g.arc(x, y, 70, wa - 0.7, wa + 0.5);
      g.strokePath();
      g.lineStyle(3, 0xffefbb, 0.85);
      g.beginPath();
      g.arc(x, y, 76, wa - 0.6, wa + 0.4);
      g.strokePath();
    }
    g.fillStyle(0x172520);
    g.fillRoundedRect(x - 23, y - 43, 46, 5, 2);
    g.fillStyle(p.team === 0 ? 0x7dcc93 : 0xe16d51);
    g.fillRoundedRect(x - 22, y - 42, (44 * p.hp) / 100, 3, 1);
  }
  drawQuest(w: World) {
    const g = this.gfx;
    if (w.phase === 'artifacts')
      artifacts.forEach((a, n) => {
        if (w.artifacts[n]) return;
        g.fillStyle(0xf7ca65, 0.15);
        g.fillCircle(a.x, a.y, 35);
        g.fillStyle(0xf2c96b);
        g.fillTriangle(a.x, a.y - 18, a.x - 13, a.y + 9, a.x + 13, a.y + 9);
        this.label('artifact' + n, 'ROYAL SEAL', a.x, a.y + 29, '#ffe2a0', 12);
      });
    else for (let n = 0; n < 3; n++) this.labels.get('artifact' + n)?.setVisible(false);
    if (w.phase === 'puzzle')
      pillars.forEach((a, n) => {
        g.fillStyle(w.puzzle.includes(n) ? 0x59ad8f : 0x6c6253);
        g.fillRect(a.x - 22, a.y - 32, 44, 65);
        g.lineStyle(3, 0xe7c479);
        g.strokeRect(a.x - 22, a.y - 32, 44, 65);
        this.label('pillar' + n, ['☀', '◆', '☾', '✧'][n], a.x, a.y, '#ffe4a1', 26);
      });
    else for (let n = 0; n < 4; n++) this.labels.get('pillar' + n)?.setVisible(false);
    if (this.drawBossSprite(w)) return;
    if (['guardian', 'challenge', 'eclipse'].includes(w.phase)) {
      const x = w.bossX,
        y = w.bossY;
      if (w.telegraph === 'shockwave') {
        g.fillStyle(0xe6533d, 0.2);
        g.fillCircle(x, y, 190);
        g.lineStyle(3, 0xff9e57);
        g.strokeCircle(x, y, 190);
      }
      g.fillStyle(0x000000, 0.3);
      g.fillEllipse(x, y + 24, 110, 40);
      g.fillStyle(w.phase === 'guardian' ? 0xb18743 : 0x482d4e);
      g.fillCircle(x, y, 43);
      g.fillStyle(0xd6ae58);
      g.fillCircle(x, y - 8, 29);
      g.fillStyle(0x6a3b2b);
      g.fillCircle(x, y - 4, 20);
      g.fillStyle(0xffd369);
      g.fillRect(x - 13, y - 12, 8, 4);
      g.fillRect(x + 5, y - 12, 8, 4);
      g.fillStyle(0xf4d57f);
      for (let n = -1; n < 2; n++)
        g.fillTriangle(x + n * 16 - 8, y - 28, x + n * 16, y - 50, x + n * 16 + 8, y - 28);
      this.label(
        'boss',
        w.phase === 'guardian' ? 'THE LION GUARDIAN' : 'THE ENCHANTED KING',
        x,
        y - 70,
        '#ffe5ad',
        14,
      );
    }
  }
  drawBossSprite(w: World) {
    if (!['guardian', 'challenge', 'eclipse'].includes(w.phase)) {
      this.bossSprite?.setVisible(false);
      this.labels.get('boss')?.setVisible(false);
      return false;
    }
    if (!this.textures.exists('bosses')) return false;
    const texture = this.textures.get('bosses'),
      source = texture.getSourceImage() as HTMLImageElement;
    const frame = w.phase === 'guardian' ? 'guardian' : 'king';
    if (!texture.has(frame))
      texture.add(
        frame,
        0,
        w.phase === 'guardian' ? 0 : source.width / 2,
        0,
        source.width / 2,
        source.height,
      );
    if (!this.bossSprite)
      this.bossSprite = this.add.image(w.bossX, w.bossY, 'bosses', frame).setDepth(12);
    this.bossSprite
      .setFrame(frame)
      .setScale(140 / (source.width / 2))
      .setPosition(w.bossX, w.bossY - 10)
      .setVisible(true);
    const g = this.gfx;
    g.fillStyle(0x000000, 0.3);
    g.fillEllipse(w.bossX, w.bossY + 40, 100, 30);
    if (w.telegraph === 'shockwave') {
      g.fillStyle(0xe6533d, 0.2);
      g.fillCircle(w.bossX, w.bossY, 190);
      g.lineStyle(3, 0xff9e57);
      g.strokeCircle(w.bossX, w.bossY, 190);
    }
    this.label(
      'boss',
      w.phase === 'guardian' ? 'THE LION GUARDIAN' : 'THE ENCHANTED KING',
      w.bossX,
      w.bossY - 95,
      '#ffe5ad',
      14,
    );
    return true;
  }
  playImpact() {
    if (useUI.getState().muted) return;
    try {
      this.audio ??= new AudioContext();
      const osc = this.audio.createOscillator(),
        gain = this.audio.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(180, this.audio.currentTime);
      osc.frequency.exponentialRampToValueAtTime(40, this.audio.currentTime + 0.09);
      gain.gain.setValueAtTime(0.08, this.audio.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, this.audio.currentTime + 0.1);
      osc.connect(gain);
      gain.connect(this.audio.destination);
      osc.start();
      osc.stop(this.audio.currentTime + 0.1);
    } catch {
      /* audio unavailable */
    }
  }
}
export function mountGame(el: HTMLElement, room: Room, id: string) {
  const scene = new Arena(room, id);
  return new Phaser.Game({
    type: Phaser.AUTO,
    parent: el,
    width: WIDTH,
    height: HEIGHT,
    scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
    render: { antialias: true },
    scene: [scene],
    audio: { noAudio: true },
  });
}
