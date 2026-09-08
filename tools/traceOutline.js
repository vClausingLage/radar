// Trace a sprite's alpha silhouette into a Matter-ready polygon.
//
//   node tools/traceOutline.js public/asteroid_2.png [tolerance-px] [alpha-threshold]
//
// Phaser has no shape editor: a Matter body that follows a sprite's outline is
// a vertex list you either draw in a tool like PhysicsEditor and export as
// JSON, or derive from the image itself. This does the latter — marching
// squares over the alpha channel, then Douglas–Peucker simplification — and
// prints the vertices in texture pixel space (origin top-left), which is what
// `setBody({ type: 'fromVertices', verts })` expects. Concave outlines are
// fine for radar geometry (see src/physics/bodyShape.ts). Paste the output
// into src/entities/spriteOutlines.ts.
import fs from 'node:fs';
import zlib from 'node:zlib';

// ── Minimal PNG decoder (non-interlaced, 8/16-bit, grey/RGB/RGBA/grey+alpha) ──
function decodePng(buf) {
    let p = 8;
    const idat = [];
    let w = 0, h = 0, depth = 0, color = 0, interlace = 0;
    while (p < buf.length) {
        const len = buf.readUInt32BE(p);
        const type = buf.toString('ascii', p + 4, p + 8);
        const data = buf.subarray(p + 8, p + 8 + len);
        if (type === 'IHDR') {
            w = data.readUInt32BE(0); h = data.readUInt32BE(4);
            depth = data[8]; color = data[9]; interlace = data[12];
        } else if (type === 'IDAT') idat.push(data);
        p += 12 + len;
    }
    if (interlace) throw new Error('interlaced PNG not supported');
    const channels = { 0: 1, 2: 3, 4: 2, 6: 4 }[color];
    if (!channels) throw new Error('palette PNG not supported');
    const bpp = Math.ceil(channels * depth / 8);
    const stride = Math.ceil(w * channels * depth / 8);
    const raw = zlib.inflateSync(Buffer.concat(idat));
    const out = Buffer.alloc(stride * h);
    let prev = Buffer.alloc(stride);
    for (let y = 0; y < h; y++) {
        const filter = raw[y * (stride + 1)];
        const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
        const cur = out.subarray(y * stride, (y + 1) * stride);
        for (let i = 0; i < stride; i++) {
            const a = i >= bpp ? cur[i - bpp] : 0;
            const b = prev[i];
            const c = i >= bpp ? prev[i - bpp] : 0;
            let v = line[i];
            switch (filter) {
                case 1: v += a; break;
                case 2: v += b; break;
                case 3: v += (a + b) >> 1; break;
                case 4: { const pp = a + b - c; const pa = Math.abs(pp - a), pb = Math.abs(pp - b), pc = Math.abs(pp - c); v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c; break; }
            }
            cur[i] = v & 0xff;
        }
        prev = cur;
    }
    // Alpha (0..1) per pixel; opaque formats count as fully opaque.
    const alpha = new Float32Array(w * h);
    const hasAlpha = color === 4 || color === 6;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        if (!hasAlpha) { alpha[y * w + x] = 1; continue; }
        const px = (y * stride) + (x * channels + channels - 1) * (depth / 8);
        alpha[y * w + x] = depth === 16 ? out.readUInt16BE(px) / 65535 : out[px] / 255;
    }
    return { w, h, alpha };
}

// ── Largest solid region: stray anti-aliased specks must not become the shape ──
function largestRegion({ w, h, alpha }, threshold) {
    const label = new Int32Array(w * h); // 0 = unvisited/transparent
    let best = 0, bestSize = 0, next = 0;
    const stack = [];
    for (let i = 0; i < w * h; i++) {
        if (label[i] || alpha[i] < threshold) continue;
        const id = ++next;
        let size = 0;
        stack.push(i);
        label[i] = id;
        while (stack.length) {
            const j = stack.pop();
            size++;
            const x = j % w, y = (j - x) / w;
            for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
                const nx = x + dx, ny = y + dy;
                if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
                const k = ny * w + nx;
                if (!label[k] && alpha[k] >= threshold) { label[k] = id; stack.push(k); }
            }
        }
        if (size > bestSize) { bestSize = size; best = id; }
    }
    if (!best) throw new Error('no solid pixels above threshold');
    return (x, y) => x >= 0 && y >= 0 && x < w && y < h && label[y * w + x] === best;
}

// ── Contour: walk the boundary of the solid region (Moore neighbour tracing) ──
function traceContour(img, threshold) {
    const { w, h } = img;
    const solid = largestRegion(img, threshold);
    let sx = -1, sy = -1;
    outer: for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (solid(x, y)) { sx = x; sy = y; break outer; }
    // 8-neighbour offsets, clockwise starting from west.
    const dirs = [[-1, 0], [-1, -1], [0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1]];
    const pts = [];
    // The start is the top-left-most solid pixel, so everything west of it is
    // background; pretend we arrived heading north-east so the first sweep
    // begins at west. Walking clockwise keeps the shape on the right-hand side.
    let x = sx, y = sy, dir = 3, firstDir = -1;
    for (;;) {
        // Sweep clockwise from the "outside-behind" direction (135° anticlockwise
        // of the last move): the first solid neighbour is the next boundary pixel.
        let next = -1;
        for (let i = 0; i < 8; i++) {
            const d = (dir + 5 + i) % 8;
            if (solid(x + dirs[d][0], y + dirs[d][1])) { next = d; break; }
        }
        if (next < 0) { pts.push({ x, y }); break; } // isolated pixel
        // Jacob's stopping criterion: the walk is closed once it is back at the
        // start pixel *and* about to leave it the same way it did the first time.
        // Stopping on position alone cuts the trace short wherever the start
        // sits on a one-pixel-wide feature that the walk crosses twice.
        if (x === sx && y === sy) {
            if (firstDir < 0) firstDir = next;
            else if (next === firstDir) break;
        }
        pts.push({ x, y });
        x += dirs[next][0]; y += dirs[next][1]; dir = next;
        if (pts.length > 4 * w * h) throw new Error('contour did not close');
    }
    return pts;
}

// ── Douglas–Peucker simplification ──
function simplify(pts, tol) {
    const sqTol = tol * tol;
    const sqSegDist = (p, a, b) => {
        let x = a.x, y = a.y, dx = b.x - x, dy = b.y - y;
        if (dx || dy) {
            const t = ((p.x - x) * dx + (p.y - y) * dy) / (dx * dx + dy * dy);
            if (t > 1) { x = b.x; y = b.y; } else if (t > 0) { x += dx * t; y += dy * t; }
        }
        dx = p.x - x; dy = p.y - y;
        return dx * dx + dy * dy;
    };
    const keep = new Uint8Array(pts.length);
    keep[0] = keep[pts.length - 1] = 1;
    const stack = [[0, pts.length - 1]];
    while (stack.length) {
        const [first, last] = stack.pop();
        let maxD = 0, idx = -1;
        for (let i = first + 1; i < last; i++) {
            const d = sqSegDist(pts[i], pts[first], pts[last]);
            if (d > maxD) { maxD = d; idx = i; }
        }
        if (maxD > sqTol) { keep[idx] = 1; stack.push([first, idx], [idx, last]); }
    }
    return pts.filter((_, i) => keep[i]);
}

function area(pts) {
    let a = 0;
    for (let i = 0; i < pts.length; i++) { const p = pts[i], q = pts[(i + 1) % pts.length]; a += p.x * q.y - q.x * p.y; }
    return Math.abs(a) / 2;
}

function convexHull(pts) {
    const p = [...pts].sort((a, b) => a.x - b.x || a.y - b.y);
    const cross = (o, a, b) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
    const lower = [], upper = [];
    for (const q of p) { while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], q) <= 0) lower.pop(); lower.push(q); }
    for (const q of p.reverse()) { while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], q) <= 0) upper.pop(); upper.push(q); }
    return lower.slice(0, -1).concat(upper.slice(0, -1));
}

const args = process.argv.slice(2);
const hullOnly = args.includes('--hull');
const [file, tolArg, thrArg] = args.filter(a => a !== '--hull');
if (!file) { console.error('usage: node tools/traceOutline.js <png> [tolerance-px=6] [alpha-threshold=0.5] [--hull]'); process.exit(1); }
const tol = Number(tolArg ?? 6);
const thr = Number(thrArg ?? 0.5);
const img = decodePng(fs.readFileSync(file));
const contour = traceContour(img, thr);
const poly = simplify(contour, tol);
// Closed loop: drop the duplicated end point if simplify kept both.
if (poly.length > 1 && poly[0].x === poly[poly.length - 1].x && poly[0].y === poly[poly.length - 1].y) poly.pop();
const hull = convexHull(poly);
console.error(`${file}: ${img.w}x${img.h}, contour ${contour.length} px → ${poly.length} vertices (tol ${tol}px); ` +
    `area ${Math.round(area(poly))} vs hull ${Math.round(area(hull))} (${(100 * area(poly) / area(hull)).toFixed(1)}% of hull)`);
// The traced outline is printed as is; --hull prints its convex hull instead
// (a single-part body, cheaper to raycast, for shapes that are nearly convex
// anyway).
const out = hullOnly ? hull : poly;
console.error(`printing ${hullOnly ? 'convex hull' : 'concave outline'}: ${out.length} vertices`);
console.log(JSON.stringify(out.map(p => ({ x: p.x, y: p.y }))));
