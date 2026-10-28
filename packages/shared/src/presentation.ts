export const PROTOCOL_VERSION = 2;
export const project = (x: number, y: number, z = 0) => ({
  x: (x - y) * 0.86,
  y: (x + y) * 0.43 - z,
});
export const unproject = (x: number, y: number) => ({
  x: x / 1.72 + y / 0.86,
  y: y / 0.86 - x / 1.72,
});
export function screenMovement(x: number, y: number) {
  const v = unproject(x, y),
    length = Math.hypot(v.x, v.y);
  return length ? { x: v.x / length, y: v.y / length } : { x: 0, y: 0 };
}
export interface Geometry {
  width: number;
  height: number;
  obstacles: { x: number; y: number; w: number; h: number; kind?: 'water' }[];
  friction?: number;
}
export type Biome =
  | 'sandstone'
  | 'highland'
  | 'mist'
  | 'wind'
  | 'mud'
  | 'grassland'
  | 'river'
  | 'citadel'
  | 'night'
  | 'observatory'
  | 'throne';
export const palettes: Record<
  Biome,
  { floor: number; tile: number; wall: number; accent: number }
> = {
  sandstone: { floor: 0xbfa478, tile: 0xceba8d, wall: 0x8d7254, accent: 0xe2ba60 },
  highland: { floor: 0x65765a, tile: 0x819274, wall: 0x727b68, accent: 0xd6bf7f },
  mist: { floor: 0x5b7778, tile: 0x779493, wall: 0x647777, accent: 0xc6ddd0 },
  wind: { floor: 0x9a906d, tile: 0xbab28c, wall: 0x897a5c, accent: 0xe2c37d },
  mud: { floor: 0x725943, tile: 0x8f7051, wall: 0x654c37, accent: 0xc9a66a },
  grassland: { floor: 0x68804d, tile: 0x819558, wall: 0x62734b, accent: 0xe9cc86 },
  river: { floor: 0x527a78, tile: 0x729695, wall: 0x42616c, accent: 0xd5c48e },
  citadel: { floor: 0x9b735c, tile: 0xb68d6b, wall: 0x715143, accent: 0xdac38e },
  night: { floor: 0x454d67, tile: 0x5c6684, wall: 0x343e55, accent: 0xb8a2e2 },
  observatory: { floor: 0x586276, tile: 0x758395, wall: 0x3a4b62, accent: 0xd6c9a0 },
  throne: { floor: 0x6b505f, tile: 0x886776, wall: 0x493648, accent: 0xe6bb70 },
};
