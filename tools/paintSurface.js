// Paint the campaign's ground strip: public/surface.png.
//
//   node tools/paintSurface.js
//
// Dusty, cratered regolith, dark enough that the scope marks and the RWR stay
// readable on top of it. The picture stays a fully opaque 2500x120 box: the
// strip's Matter body is the texture's rectangle (Structure), so its size is what
// the radar's terrain return and the landing rules act on. Change the size and
// the geometry of the world changes with it. Deterministic (fixed seed).
import fs from 'node:fs';
import zlib from 'node:zlib';

const WIDTH = 2500;
const HEIGHT = 120;
const RIM_PX = 3;

let seed = 1138;
const random = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
};

// ── Value noise: smooth random hills, summed over octaves into rock texture ──
function makeNoise(cell) {
    const columns = Math.ceil(WIDTH / cell) + 2;
    const rows = Math.ceil(HEIGHT / cell) + 2;
    const grid = Float32Array.from({ length: columns * rows }, random);
    const smooth = (t) => t * t * (3 - 2 * t);
    return (x, y) => {
        const gx = x / cell;
        const gy = y / cell;
        const ix = Math.floor(gx);
        const iy = Math.floor(gy);
        const fx = smooth(gx - ix);
        const fy = smooth(gy - iy);
        const at = (cx, cy) => grid[cy * columns + cx];
        const top = at(ix, iy) * (1 - fx) + at(ix + 1, iy) * fx;
        const bottom = at(ix, iy + 1) * (1 - fx) + at(ix + 1, iy + 1) * fx;
        return top * (1 - fy) + bottom * fy;
    };
}

const octaves = [[64, 0.5], [24, 0.25], [8, 0.15], [3, 0.1]].map(([cell, weight]) => ({
    noise: makeNoise(cell),
    weight,
}));

// ── Craters, seen at a low angle: squashed ellipses, lit on the far wall ──
const craters = Array.from({ length: 90 }, () => {
    const radius = 4 + random() ** 2 * 26;
    return { x: random() * WIDTH, y: RIM_PX + random() * (HEIGHT - RIM_PX), radius };
});

function craterShade(x, y) {
    let shade = 0;
    for (const crater of craters) {
        const dx = (x - crater.x) / crater.radius;
        const dy = (y - crater.y) / (crater.radius * 0.45);
        const d = Math.hypot(dx, dy);
        if (d > 1.15) continue;
        if (d < 1) shade += (-0.28 - 0.3 * dy) * (1 - d * d);
        else shade += 0.08;
    }
    return shade;
}

// ── Compose: rock tone, darkening with depth into the ground, and a lit horizon ──
const row = (y) => {
    const line = Buffer.alloc(1 + WIDTH * 3);
    for (let x = 0; x < WIDTH; x++) {
        let rock = 0;
        for (const { noise, weight } of octaves) rock += noise(x, y) * weight;
        const depthFade = 1 - 0.55 * (y / HEIGHT);
        const rim = y < RIM_PX ? 0.5 * (1 - y / RIM_PX) : 0;
        const light = Math.max(0, (0.2 + rock * 0.5 + craterShade(x, y)) * depthFade + rim);
        // A cold grey-blue, to sit under the launchpad's concrete and the dish rock.
        line[1 + x * 3] = Math.min(255, light * 165);
        line[2 + x * 3] = Math.min(255, light * 170);
        line[3 + x * 3] = Math.min(255, light * 182);
    }
    return line;
};

// ── Minimal PNG encoder: 8-bit RGB (no alpha channel, so it cannot be anything but opaque) ──
const crcTable = Uint32Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
});
const crc32 = (buffer) => {
    let c = 0xffffffff;
    for (const byte of buffer) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([length, body, crc]);
};

const header = Buffer.alloc(13);
header.writeUInt32BE(WIDTH, 0);
header.writeUInt32BE(HEIGHT, 4);
header[8] = 8; // bit depth
header[9] = 2; // colour type: RGB

const pixels = Buffer.concat(Array.from({ length: HEIGHT }, (_, y) => row(y)));
fs.writeFileSync('public/surface.png', Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', zlib.deflateSync(pixels, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
]));
