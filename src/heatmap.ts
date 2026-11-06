// Fast density heatmap: bin points into a grid, separable box-blur (x3 ≈ gaussian),
// then colourise into an offscreen canvas that is stretched over the minimap.

const N = 256 // grid resolution over the 1024px map space
const PALETTE = buildPalette()

function buildPalette(): Uint8ClampedArray {
  // transparent → blue → cyan → yellow → red → white
  const stops: [number, number[]][] = [
    [0.0, [0, 0, 0, 0]], [0.08, [40, 60, 255, 0]], [0.2, [40, 60, 255, 110]], [0.35, [0, 220, 255, 170]],
    [0.6, [255, 230, 0, 200]], [0.85, [255, 60, 30, 225]], [1.0, [255, 255, 255, 240]],
  ]
  const p = new Uint8ClampedArray(256 * 4)
  for (let i = 0; i < 256; i++) {
    const v = i / 255
    let k = 0
    while (k < stops.length - 2 && v > stops[k + 1][0]) k++
    const [a, ca] = stops[k], [b, cb] = stops[k + 1]
    const f = (v - a) / (b - a)
    for (let c = 0; c < 4; c++) p[i * 4 + c] = ca[c] + (cb[c] - ca[c]) * f
  }
  return p
}

function boxBlur(src: Float32Array, r: number) {
  const tmp = new Float32Array(src.length)
  const w = 2 * r + 1
  for (let y = 0; y < N; y++) {
    let acc = 0
    for (let x = -r; x <= r; x++) acc += src[y * N + Math.min(N - 1, Math.max(0, x))]
    for (let x = 0; x < N; x++) {
      tmp[y * N + x] = acc / w
      acc += src[y * N + Math.min(N - 1, x + r + 1)] - src[y * N + Math.max(0, x - r)]
    }
  }
  for (let x = 0; x < N; x++) {
    let acc = 0
    for (let y = -r; y <= r; y++) acc += tmp[Math.min(N - 1, Math.max(0, y)) * N + x]
    for (let y = 0; y < N; y++) {
      src[y * N + x] = acc / w
      acc += tmp[Math.min(N - 1, y + r + 1) * N + x] - tmp[Math.max(0, y - r) * N + x]
    }
  }
}

export interface HeatResult { canvas: HTMLCanvasElement; count: number }

export function buildHeat(xs: ArrayLike<number>, ys: ArrayLike<number>, idx: ArrayLike<number>, radius: number, canvas?: HTMLCanvasElement): HeatResult {
  const grid = new Float32Array(N * N)
  const s = N / 1024
  for (let k = 0; k < idx.length; k++) {
    const i = idx[k]
    const gx = Math.floor(xs[i] * s), gy = Math.floor(ys[i] * s)
    if (gx >= 0 && gy >= 0 && gx < N && gy < N) grid[gy * N + gx] += 1
  }
  for (let p = 0; p < 3; p++) boxBlur(grid, radius)
  // normalise on the 99.5th percentile so a single hotspot does not wash everything out
  const nz: number[] = []
  for (let i = 0; i < grid.length; i++) if (grid[i] > 0) nz.push(grid[i])
  nz.sort((a, b) => a - b)
  const max = nz.length ? nz[Math.floor((nz.length - 1) * 0.995)] : 1
  const c = canvas ?? document.createElement('canvas')
  c.width = N; c.height = N
  const ctx = c.getContext('2d')!
  const img = ctx.createImageData(N, N)
  for (let i = 0; i < grid.length; i++) {
    const v = Math.min(1, Math.sqrt(grid[i] / max))
    const pi = Math.floor(v * 255) * 4
    img.data[i * 4] = PALETTE[pi]; img.data[i * 4 + 1] = PALETTE[pi + 1]
    img.data[i * 4 + 2] = PALETTE[pi + 2]; img.data[i * 4 + 3] = PALETTE[pi + 3]
  }
  ctx.putImageData(img, 0, 0)
  return { canvas: c, count: idx.length }
}
