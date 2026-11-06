// Data layer: types, loading and event metadata. Mirrors scripts/preprocess.py.

export const EVENTS = ['Position', 'BotPosition', 'Kill', 'Killed', 'BotKill', 'BotKilled', 'KilledByStorm', 'Loot'] as const
export type EventName = (typeof EVENTS)[number]
export const EV = Object.fromEntries(EVENTS.map((e, i) => [e, i])) as Record<EventName, number>

export const MOVE = new Set([EV.Position, EV.BotPosition])
export const KILL_CODES = new Set([EV.Kill, EV.BotKill])
export const DEATH_CODES = new Set([EV.Killed, EV.BotKilled, EV.KilledByStorm])

export type MapId = 'AmbroseValley' | 'GrandRift' | 'Lockdown'
export const MAP_LABEL: Record<MapId, string> = {
  AmbroseValley: 'Ambrose Valley',
  GrandRift: 'Grand Rift',
  Lockdown: 'Lockdown',
}

export interface MapConfig { scale: number; origin_x: number; origin_z: number; image: string; rows: number; out_of_bounds: number }
export interface MatchSummary {
  id: string; map: MapId; date: string; humans: number; bots: number; duration: number
  events: Partial<Record<EventName, number>>
}
export interface Index { events: string[]; dates: string[]; maps: Record<MapId, MapConfig>; matches: MatchSummary[] }

/** Columnar event table for one map. Coordinates are already minimap pixels (0..1024). */
export interface MapData {
  map: MapId
  matches: string[]
  users: string[]
  humans: number[]
  m: Int32Array; u: Int32Array; e: Int8Array; t: Int32Array; x: Float32Array; y: Float32Array
  matchIndex: Map<string, number>
}

const base = import.meta.env.BASE_URL
export const asset = (p: string) => `${base}${p}`

export async function loadIndex(): Promise<Index> {
  const r = await fetch(asset('data/index.json'))
  return r.json()
}

const cache = new Map<MapId, Promise<MapData>>()
export function loadMap(id: MapId): Promise<MapData> {
  if (!cache.has(id)) {
    cache.set(id, fetch(asset(`data/${id}.json`)).then(r => r.json()).then((j): MapData => ({
      map: j.map, matches: j.matches, users: j.users, humans: j.humans,
      m: Int32Array.from(j.m), u: Int32Array.from(j.u), e: Int8Array.from(j.e),
      t: Int32Array.from(j.t), x: Float32Array.from(j.x), y: Float32Array.from(j.y),
      matchIndex: new Map(j.matches.map((s: string, i: number) => [s, i])),
    })))
  }
  return cache.get(id)!
}

/** README world → minimap pixel conversion (used for verification + tooltips). */
export function worldToPixel(x: number, z: number, cfg: Pick<MapConfig, 'scale' | 'origin_x' | 'origin_z'>) {
  const u = (x - cfg.origin_x) / cfg.scale
  const v = (z - cfg.origin_z) / cfg.scale
  return [u * 1024, (1 - v) * 1024] as const
}

export const fmtTime = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`
export const shortId = (id: string) => id.slice(0, 8)

// ---------- visual language ----------
export interface MarkerStyle { label: string; color: string; shape: 'x' | 'skull' | 'dot' | 'bolt' | 'diamond'; group: MarkerGroup }
export type MarkerGroup = 'kills' | 'deaths' | 'storm' | 'loot'
export const MARKERS: Partial<Record<number, MarkerStyle>> = {
  [EV.Kill]: { label: 'Player kill (PvP)', color: '#ff3b5c', shape: 'x', group: 'kills' },
  [EV.BotKill]: { label: 'Bot kill', color: '#ffb020', shape: 'x', group: 'kills' },
  [EV.Killed]: { label: 'Killed by player', color: '#ff3b5c', shape: 'skull', group: 'deaths' },
  [EV.BotKilled]: { label: 'Killed by bot', color: '#f472b6', shape: 'skull', group: 'deaths' },
  [EV.KilledByStorm]: { label: 'Storm death', color: '#a78bfa', shape: 'bolt', group: 'storm' },
  [EV.Loot]: { label: 'Loot pickup', color: '#4ade80', shape: 'diamond', group: 'loot' },
}

export const HUMAN_COLORS = ['#22d3ee', '#60a5fa', '#34d399', '#e879f9', '#facc15', '#38bdf8', '#a3e635', '#f0abfc']
export const BOT_COLOR = '#fb923c'

export type HeatKind = 'none' | 'traffic' | 'kills' | 'deaths' | 'loot' | 'storm'
export const HEAT_LABEL: Record<HeatKind, string> = {
  none: 'Off', traffic: 'Traffic', kills: 'Kill zones', deaths: 'Death zones', loot: 'Loot', storm: 'Storm deaths',
}
export function heatMatches(kind: HeatKind, e: number): boolean {
  switch (kind) {
    case 'traffic': return MOVE.has(e)
    case 'kills': return KILL_CODES.has(e)
    case 'deaths': return DEATH_CODES.has(e)
    case 'loot': return e === EV.Loot
    case 'storm': return e === EV.KilledByStorm
    default: return false
  }
}
