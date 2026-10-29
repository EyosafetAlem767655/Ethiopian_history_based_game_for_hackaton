import { defaultAvatar, type AvatarSpec } from '../../../packages/shared/src/customization';
let heads: Promise<{
  image: HTMLImageElement;
  bounds: { x: number; y: number; width: number; height: number }[];
}> | null = null;
/** The painted head for a hero from assets/heads.png, fitted into the same 128x144 box as avatarCanvas. */
export async function heroHeadCanvas(hero: number) {
  heads ??= Promise.all([
    fetch('/assets/manifest.json').then((r) => r.json()),
    new Promise<HTMLImageElement>((ok, fail) => {
      const i = new Image();
      i.onload = () => ok(i);
      i.onerror = fail;
      i.src = '/assets/heads.png';
    }),
  ]).then(([manifest, image]) => ({ image, bounds: manifest.assets.heads.frameBounds }));
  const { image, bounds } = await heads.catch((e) => {
    heads = null;
    throw e;
  });
  const b = bounds[hero] ?? bounds[0],
    canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 144;
  const scale = Math.min(128 / b.width, 136 / b.height),
    w = b.width * scale,
    h = b.height * scale;
  canvas
    .getContext('2d')!
    .drawImage(image, b.x, b.y, b.width, b.height, (128 - w) / 2, 144 - h, w, h);
  return canvas;
}
export function avatarCanvas(spec: AvatarSpec = defaultAvatar) {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 144;
  const c = canvas.getContext('2d')!;
  const skins = {
    deep: '#65412f',
    brown: '#985e3c',
    warm: '#bc8052',
    tan: '#dba67c',
    light: '#edc49f',
  };
  const skin = skins[spec.skin],
    rx = spec.shape === 'round' ? 40 : spec.shape === 'square' ? 39 : 34;
  c.lineWidth = 3;
  c.strokeStyle = '#38251f';
  const ellipse = (x: number, y: number, ex: number, ey: number, color: string) => {
    c.beginPath();
    c.ellipse(x, y, ex, ey, 0, 0, Math.PI * 2);
    c.fillStyle = color;
    c.fill();
    c.stroke();
  };
  c.fillStyle = skin;
  c.fillRect(43, 101, 44, 33);
  ellipse(27, 77, 10, 16, skin);
  const shade = c.createLinearGradient(27, 40, 108, 110);
  shade.addColorStop(0, skin);
  shade.addColorStop(0.65, skin);
  shade.addColorStop(1, '#69452f');
  c.beginPath();
  c.moveTo(64 - rx, 56);
  c.bezierCurveTo(64 - rx, 7, 106, 8, 105, 59);
  c.lineTo(106, 91);
  c.quadraticCurveTo(100, 121, 69, 124);
  c.quadraticCurveTo(30, 117, 26, 84);
  c.closePath();
  c.fillStyle = shade;
  c.fill();
  c.stroke();
  if (spec.hair !== 'bald') {
    c.fillStyle = '#211e22';
    c.beginPath();
    c.ellipse(63, 36, rx + 1, 22, -0.08, Math.PI, Math.PI * 2 + 0.25);
    c.fill();
    if (spec.hair === 'curls')
      for (let i = 0; i < 10; i++) {
        c.beginPath();
        c.arc(28 + i * 8, 29 - Math.sin(i * 0.34) * 10, 9, 0, 7);
        c.fill();
      }
    if (spec.hair === 'braids')
      for (let i = 0; i < 5; i++) {
        c.lineWidth = 7;
        c.strokeStyle = '#211e22';
        c.beginPath();
        c.moveTo(30 + i * 5, 28);
        c.quadraticCurveTo(10 + i * 5, 75, 18 + i * 5, 111);
        c.stroke();
      }
  }
  c.lineWidth = spec.brows === 'bold' ? 5 : 3;
  c.strokeStyle = '#30221f';
  for (const x of [53, 86]) {
    c.beginPath();
    c.moveTo(x - 10, 59);
    c.quadraticCurveTo(x, spec.brows === 'arched' ? 49 : 55, x + 8, 57);
    c.stroke();
  }
  c.lineWidth = 1.8;
  for (const x of [55, 87]) {
    ellipse(x, 70, 10, spec.eyes === 'round' ? 7 : spec.eyes === 'narrow' ? 3.5 : 5, '#fff1da');
    ellipse(x + 3, 70, 3.5, 4, '#3c2820');
  }
  c.strokeStyle = '#69442e';
  c.lineWidth = 2.4;
  c.beginPath();
  c.moveTo(80, 72);
  c.lineTo(89, 88);
  c.lineTo(78, 91);
  c.stroke();
  if (spec.beard !== 'none') {
    c.fillStyle = '#2d2321';
    c.beginPath();
    c.moveTo(32, 91);
    c.quadraticCurveTo(48, 107, 65, 104);
    c.quadraticCurveTo(87, 94, 105, 96);
    c.lineTo(101, 116);
    c.quadraticCurveTo(68, spec.beard === 'full' ? 141 : 128, 39, 113);
    c.closePath();
    c.fill();
  }
  c.strokeStyle = spec.beard === 'none' ? '#744231' : '#c78a61';
  c.lineWidth = 2.5;
  c.beginPath();
  c.moveTo(65, 101);
  c.quadraticCurveTo(80, 105, 92, 100);
  c.stroke();
  return canvas;
}
