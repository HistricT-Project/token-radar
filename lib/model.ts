// Token Radar's model, radar-2: one snapshot of the protocol universe in, one ranked board out.
//
// The board ranks every pre-token protocol the snapshot can call a launch: the watchlist is the floor
// and the early radar adds every other rankable pre-token protocol below it. A protocol is rankable
// when it records no token and is not a wrapped, staked or bridged product of a token that already
// trades, not an exchange and not a versioned pool. Those rules are the house's own watchlist
// definition, applied to the snapshot's ten fields; the protocols they set aside are listed in the
// dashboard with the reason each was set aside, never silently dropped.
//
// Implied value follows only from the snapshot's own figures, through the market's own pricing:
//
//   comp(category) = the category's live-token multiple, shrunk toward a global prior
//   growthMult     = 1 + clamp(change_7d, -60, 120) / 100 x 0.5
//   maturityMult   = 0.65 + 0.35 x min(age_days, 1095) / 1095      (age unknown: 365 days)
//   chainMult      = 1 + 0.04 x min(chains - 1, 5)
//   implied        = max(1, round(tvl_usd x comp x growthMult x maturityMult x chainMult))
//
// The multiple is the market's pricing, not a flat guess: for each category, the aggregate
// market-cap-to-TVL ratio of its live-token protocols (each protocol's ratio winsorized at 5x, so one
// tiny pool with a huge token cannot set the price), shrunk toward the global prior by a $1B TVL
// weight, and capped at 2.0. A category with one small live comp lands near the prior; a category
// with deep live markets keeps its own multiple. Categories with no live comp at all take the prior.
// No protocol name is ever special-cased: the same function scores every row.

/** The snapshot's protocol entry: exactly the ten fields the sealed input carries. */
export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

/** The whole snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** The model's constants, as the dashboard states them and the reader can check them. */
export interface ModelConstants {
  winsor_multiple: number;
  prior_tvl_usd: number;
  comp_cap: number;
  growth_weight: number;
  growth_floor: number;
  growth_cap: number;
  maturity_floor: number;
  maturity_range: number;
  maturity_days: number;
  unknown_age_days: number;
  chain_step: number;
  chain_max_extra: number;
}

export const MODEL: ModelConstants = {
  winsor_multiple: 5,
  prior_tvl_usd: 1_000_000_000,
  comp_cap: 2.0,
  growth_weight: 0.5,
  growth_floor: -60,
  growth_cap: 120,
  maturity_floor: 0.65,
  maturity_range: 0.35,
  maturity_days: 1095,
  unknown_age_days: 365,
  chain_step: 0.04,
  chain_max_extra: 5,
};

/** The model's version label: the dashboard names it and the rules quote it. */
export const MODEL_VERSION = 'radar-2';

/** How many live-token protocols the Live token view carries, by market cap. */
export const LIVE_ROWS = 24;

/** Categories whose product is another token that already trades: not a launch of its own. */
export const NO_LAUNCH_CATEGORIES = new Set([
  'Bridge',
  'Canonical Bridge',
  'Liquid Staking',
  'Liquid Restaking',
  'Restaked BTC',
  'CEX',
]);

/** A farm step: the action, what it costs, and how long it takes. */
export interface FarmStep {
  text: string;
  cost: string;
  time: string;
}

/** One row of board.json: the ranked board's row. */
export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
  token_status: 'pre-token';
  watchlist: boolean;
  age_days: number | null;
  implied_value_usd: number;
  model: {
    comp: number;
    growth_pct: number;
    growth_multiplier: number;
    maturity_multiplier: number;
    chain_multiplier: number;
    age_days: number | null;
  };
  farm_steps: string[];
}

/** The dashboard's compact view of one row, with farm plans generated in the page. */
export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  age_days: number | null;
  implied_value_usd: number;
  watchlist: boolean;
  comp: number;
  growth_multiplier: number;
  maturity_multiplier: number;
  chain_multiplier: number;
}

/** A live-token protocol: it already trades, so the board shows the market's own value, not a model's. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
}

/** A pre-token protocol the board does not rank, and the rule that set it aside. */
export interface SetAsideRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  reason: string;
}

/** One category's live-token multiple, as the model panel shows it. */
export interface CompRow {
  category: string;
  live_count: number;
  live_tvl_usd: number;
  comp: number;
}

/** Everything the dashboard needs: the board, the live set, the set-aside list, and the model. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelConstants;
  model_version: string;
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  set_aside_size: number;
  global_comp: number;
  comps: CompRow[];
  rows: RadarRow[];
  live: LiveRow[];
  set_aside: SetAsideRow[];
}

/** Why the snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;

/** A finite number, else `fallback`. */
function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** A whole day count from `from` to `to`, clamped at zero; null when either date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** DefiLlama's version-marker rule: a name ending in a release is a pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
/** A whole word wrapped, staked or staking in the name: the product is another token. */
const WRAPPED = /\b(wrapped|staked|staking)\b/i;
/** A name beginning with an exchange's name: the product is that exchange's. */
const EXCHANGE = /^(Binance|Coinbase|Bybit|Kraken|Bitget|OKX|Bitfinex|Gemini)\b/i;

/** Whether a protocol records no token at all. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** Why a pre-token protocol is not a launch the board ranks, or null when it is one. */
export function setAsideReason(p: SnapshotProtocol): string | null {
  if (!isPreToken(p)) return 'token already trades';
  if (p.category !== null && NO_LAUNCH_CATEGORIES.has(p.category)) {
    if (p.category === 'CEX') return 'an exchange, not a protocol launch';
    return `a ${p.category.toLowerCase()} product of a token that already trades`;
  }
  if (VERSIONED.test(p.name)) return 'a versioned pool of another protocol';
  if (WRAPPED.test(p.name)) return 'a wrapped or staked product of a token that already trades';
  if (EXCHANGE.test(p.name)) return "an exchange's product, not a protocol launch";
  return null;
}

/** Whether a protocol is one the board may rank: pre-token and a launch of its own. */
export function isRankable(p: SnapshotProtocol): boolean {
  return setAsideReason(p) === null;
}

/** The snapshot's protocol by slug. */
function bySlug(protocols: SnapshotProtocol[]): Map<string, SnapshotProtocol> {
  return new Map(protocols.map((p) => [p.slug, p]));
}

/**
 * The market's multiples: one aggregate mcap/TVL ratio per category over its live-token protocols,
 * each protocol's ratio winsorized at the model's cap, shrunk toward the global prior by the model's
 * TVL weight, and capped. Categories with no live comp take the prior. The prior itself is the
 * winsorized aggregate over live protocols in categories the board ranks, so the market the prior
 * prices is the market of protocols that could launch.
 */
export function compTable(protocols: SnapshotProtocol[], model: ModelConstants = MODEL): { comps: Map<string, number>; global: number; rows: CompRow[] } {
  const live = protocols.filter((p) => !isPreToken(p) && p.mcap_usd !== null && p.tvl_usd > 0);
  const perCategory = new Map<string, { mcap: number; tvl: number; count: number }>();
  let priorMcap = 0;
  let priorTvl = 0;
  for (const p of live) {
    const clipped = Math.min(p.mcap_usd!, model.winsor_multiple * p.tvl_usd);
    const cat = p.category ?? 'Other';
    const entry = perCategory.get(cat) ?? { mcap: 0, tvl: 0, count: 0 };
    entry.mcap += clipped;
    entry.tvl += p.tvl_usd;
    entry.count += 1;
    perCategory.set(cat, entry);
    if (p.category === null || !NO_LAUNCH_CATEGORIES.has(p.category)) {
      priorMcap += clipped;
      priorTvl += p.tvl_usd;
    }
  }
  const global = priorTvl > 0 ? priorMcap / priorTvl : 0.25;
  const comps = new Map<string, number>();
  const rows: CompRow[] = [];
  for (const [cat, entry] of perCategory) {
    const raw = entry.tvl > 0 ? entry.mcap / entry.tvl : global;
    const shrunk = (entry.tvl * raw + model.prior_tvl_usd * global) / (entry.tvl + model.prior_tvl_usd);
    const comp = Math.min(shrunk, model.comp_cap);
    comps.set(cat, comp);
    rows.push({ category: cat, live_count: entry.count, live_tvl_usd: entry.tvl, comp: round4(comp) });
  }
  rows.sort((a, b) => b.live_tvl_usd - a.live_tvl_usd || (a.category < b.category ? -1 : 1));
  return { comps, global, rows };
}

/** The three multipliers and the implied value one protocol gets under `model`. */
export function impliedValue(
  protocol: SnapshotProtocol,
  asOf: string,
  comps: Map<string, number>,
  globalComp: number,
  model: ModelConstants,
): { implied: number; comp: number; growthPct: number; growthMult: number; maturityMult: number; chainMult: number; age: number | null } {
  const age = ageDays(asOf, protocol.listed_at);
  const rawGrowth = finite(protocol.change_7d, 0);
  const growthPct = Math.min(model.growth_cap, Math.max(model.growth_floor, rawGrowth));
  const growthMult = 1 + (growthPct / 100) * model.growth_weight;
  const ageForModel = age ?? model.unknown_age_days;
  const maturityMult =
    model.maturity_floor + (Math.min(Math.max(ageForModel, 0), model.maturity_days) / model.maturity_days) * model.maturity_range;
  const extraChains = Math.min(Math.max(protocol.chains.length - 1, 0), model.chain_max_extra);
  const chainMult = 1 + model.chain_step * extraChains;
  const comp = comps.get(protocol.category ?? 'Other') ?? globalComp;
  const implied = Math.max(1, Math.round(protocol.tvl_usd * comp * growthMult * maturityMult * chainMult));
  return { implied, comp, growthPct, growthMult, maturityMult, chainMult, age };
}

const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

/** The protocols the board ranks, strongest first, with ranks 1..n. */
export function buildBoard(snapshot: Snapshot, model: ModelConstants = MODEL): BoardRow[] {
  const { comps, global } = compTable(snapshot.protocols, model);
  const watchlist = new Set(snapshot.watchlist);
  const scored = snapshot.protocols
    .filter((p) => isRankable(p))
    .map((p) => {
      const s = impliedValue(p, snapshot.as_of, comps, global, model);
      return { p, ...s };
    });
  scored.sort((a, b) => b.implied - a.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  return scored.map((s, i) => ({
    rank: i + 1,
    slug: s.p.slug,
    name: s.p.name,
    category: s.p.category,
    chains: s.p.chains,
    tvl_usd: s.p.tvl_usd,
    change_7d: s.p.change_7d,
    mcap_usd: s.p.mcap_usd,
    listed_at: s.p.listed_at,
    gecko_id: s.p.gecko_id,
    symbol: s.p.symbol,
    token_status: 'pre-token',
    watchlist: watchlist.has(s.p.slug),
    age_days: s.age,
    implied_value_usd: s.implied,
    model: {
      // Full precision on purpose: the dashboard recomputes the row from this comp, and a rounded
      // comp would move the value by thousands of dollars on the largest TVLs.
      comp: s.comp,
      growth_pct: s.growthPct,
      growth_multiplier: round4(s.growthMult),
      maturity_multiplier: round4(s.maturityMult),
      chain_multiplier: round4(s.chainMult),
      age_days: s.age,
    },
    farm_steps: farmSteps(s.p, s.age).map(stepText),
  }));
}

/** A step as one string: its action, then its cost and time, within the gate's 20..600 characters. */
export function stepText(step: FarmStep): string {
  let s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Hold the position and check the protocol's own page.`;
  return s;
}

/** The first chain a protocol names, or a neutral phrase. */
function chainOf(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** How much capital one farm position needs, from the protocol's own TVL. */
function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 5_000_000_000) return 250;
  if (p.tvl_usd >= 1_000_000_000) return 150;
  if (p.tvl_usd >= 100_000_000) return 100;
  return 50;
}

/** How long to hold, from the protocol's age: younger protocols get a longer qualifying window. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 30;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

/** One transaction's gas on a chain, in dollars: an estimate, stated as one in the dashboard. */
export function gasUsd(chain: string): number {
  if (chain === 'Ethereum') return 8;
  if (chain === 'Solana') return 0.01;
  if (chain === 'Bitcoin') return 2;
  if (
    chain === 'Base' ||
    chain === 'Arbitrum' ||
    chain === 'Optimism' ||
    chain === 'zkSync Era' ||
    chain === 'Linea' ||
    chain === 'Blast' ||
    chain === 'Scroll' ||
    chain === 'Mode' ||
    chain === 'Ink' ||
    chain === 'Unichain' ||
    chain === 'Abstract' ||
    chain === 'World Chain' ||
    chain === 'Mantle' ||
    chain === 'Taiko' ||
    chain === 'Soneium'
  ) {
    return 0.3;
  }
  if (
    chain === 'Binance' ||
    chain === 'Polygon' ||
    chain === 'Avalanche' ||
    chain === 'Tron' ||
    chain === 'Fantom' ||
    chain === 'Gnosis' ||
    chain === 'Celo' ||
    chain === 'Sei' ||
    chain === 'Hyperliquid L1' ||
    chain === 'Starknet'
  ) {
    return 0.2;
  }
  return 1;
}

/** A gas figure as the farm plan writes it: $8, $0.30, $0.01, never $0.30000000000000004. */
function gasText(chain: string): string {
  const g = gasUsd(chain);
  return g >= 1 ? `$${g}` : `$${g.toFixed(2)}`;
}

/** The category's one action, in the words a farmer can follow. */
function actionFor(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return `Supply $${capital} of USDC to ${name} on ${chain} and keep the position open.`;
  if (c.includes('dex') || c.includes('amm')) return `Provide $${capital} of liquidity to ${name}'s main pool on ${chain} and keep the position open.`;
  if (c.includes('perpetual') || c.includes('derivative')) return `Deposit $${capital} of USDC as margin on ${name} and open one small hedge.`;
  if (c.includes('prediction')) return `Fund $${capital} and place one market position on ${name}.`;
  if (c.includes('curator') || c.includes('allocator')) return `Deposit $${capital} into a ${name} vault on ${chain} and keep the shares.`;
  if (c.includes('stable')) return `Mint or deposit $${capital} of the stable asset through ${name} on ${chain}.`;
  if (c.includes('rwa')) return `Mint $${capital} of the protocol's yield asset on ${chain} and hold it.`;
  if (c.includes('insurance')) return `Buy $${capital} of cover from ${name} on ${chain} and keep the policy.`;
  if (c.includes('launchpad')) return `Commit $${capital} to the next ${name} launch allocation on ${chain} and finish its tasks.`;
  if (c.includes('option')) return `Buy one ${name} option with $${capital} of premium on ${chain} and hold it to expiry.`;
  if (c.includes('nft')) return `List or buy one NFT through ${name} on ${chain} and keep the receipt.`;
  if (c.includes('ai agent') || c.includes('decentralized ai')) return `Run one paid task through ${name} on ${chain} and keep the receipt.`;
  if (c.includes('index')) return `Buy $${capital} of the ${name} index on ${chain} and hold the position.`;
  if (c.includes('privacy')) return `Run one private transaction through ${name} on ${chain} and keep the receipt.`;
  if (c.includes('token locker')) return `Lock $${capital} of tokens in ${name} on ${chain} for the minimum term.`;
  if (c.includes('liquidity manager')) return `Deposit $${capital} into a ${name} managed position on ${chain} and keep the shares.`;
  if (c.includes('payment')) return `Spend $${capital} through ${name}'s payment flow on ${chain} and keep the receipt.`;
  if (c.includes('staking') || c.includes('restak')) return `Stake $${capital} of the chain's staking asset through ${name} and keep the receipt.`;
  if (c.includes('chain')) return `Bridge $${capital} of USDC onto ${chain} through ${name} and use it in one of its apps.`;
  if (c.includes('yield') || c.includes('farm') || c.includes('leveraged')) return `Deposit $${capital} into ${name}'s highest-yield vault on ${chain} and keep the position open.`;
  return `Deposit $${capital} of USDC into ${name} on ${chain} and keep the position open.`;
}

/**
 * A protocol's farm plan: seven steps, each an action with a cost and a time. The plan is derived
 * from the protocol's own record (category, chains, TVL, age), never from a hand-written list of
 * names. Gas figures are estimates by chain, stated as estimates in the dashboard.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null): FarmStep[] {
  const chain = chainOf(p);
  const second = p.chains.length > 1 ? p.chains[1]! : null;
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const gas = gasText(chain);
  const gas2 = second === null ? gas : gasText(second);
  const half = Math.max(10, Math.floor(capital / 2));
  return [
    {
      text: `Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline.`,
      cost: `about ${gas} of gas for the first transaction`,
      time: '5 minutes',
    },
    {
      text: actionFor(p, capital, chain),
      cost: `$${capital} of capital and about ${gas} of gas`,
      time: '15 minutes to set up',
    },
    {
      text:
        second === null
          ? `Do a second qualifying action on ${nameOf(p)}, such as a swap or a vote, in the same week.`
          : `Repeat a smaller position of $${half} on ${second} so the activity spans two chains.`,
      cost: `about ${gas2} of gas`,
      time: '15 minutes',
    },
    {
      text: `Make one qualifying action each week, such as a deposit, a borrow, a swap or a vote.`,
      cost: `about ${gas} of gas a week`,
      time: '10 minutes a week',
    },
    {
      text: `Hold the position for at least ${hold} days so the activity is counted in more than one snapshot.`,
      cost: `the $${capital} stays in the position`,
      time: `${hold} days`,
    },
    {
      text: `Before you withdraw, open the protocol's own points or rewards page and claim only from the link it publishes.`,
      cost: 'no fee to check, and never pay to claim',
      time: '10 minutes',
    },
    {
      text: `Write the wallet, the dates and every transaction in a farm log, then plan the exit: one withdrawal, and check the slippage first.`,
      cost: `about ${gas} of gas to exit`,
      time: '5 minutes to log, 10 minutes to exit',
    },
  ];
}

function nameOf(p: SnapshotProtocol): string {
  return p.name;
}

/** The live-token protocols, by market cap, for the dashboard's Live token view. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
    .slice(0, LIVE_ROWS)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
    }));
}

/** The pre-token protocols the board sets aside, with the rule that set each one aside. */
export function setAsideRows(snapshot: Snapshot): SetAsideRow[] {
  return snapshot.protocols
    .filter((p) => isPreToken(p) && !isRankable(p))
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      reason: setAsideReason(p) ?? 'not a launch',
    }))
    .sort((a, b) => b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : 1));
}

/** A board row's compact form for data.js, with the farm plan generated in the page. */
export function radarRow(row: BoardRow): RadarRow {
  return {
    rank: row.rank,
    slug: row.slug,
    name: row.name,
    category: row.category,
    chains: row.chains,
    tvl_usd: row.tvl_usd,
    change_7d: row.change_7d,
    mcap_usd: row.mcap_usd,
    listed_at: row.listed_at,
    age_days: row.age_days,
    implied_value_usd: row.implied_value_usd,
    watchlist: row.watchlist,
    comp: row.model.comp,
    growth_multiplier: row.model.growth_multiplier,
    maturity_multiplier: row.model.maturity_multiplier,
    chain_multiplier: row.model.chain_multiplier,
  };
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  const board = buildBoard(snapshot, model);
  const live = liveRows(snapshot);
  const setAside = setAsideRows(snapshot);
  const { global, rows: comps } = compTable(snapshot.protocols, model);
  const early = board.filter((r) => !r.watchlist).length;
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model,
    model_version: MODEL_VERSION,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: early,
    live_size: live.length,
    set_aside_size: setAside.length,
    global_comp: round4(global),
    comps: comps.slice(0, 14),
    rows: board.map(radarRow),
    live,
    set_aside: setAside,
  };
  return { board, radar };
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return {
    as_of: o.as_of,
    source: o.source,
    floor_usd: o.floor_usd,
    protocols,
    watchlist: o.watchlist as string[],
  };
}

/** Why a board is not one the gate will take, or null: coverage, ranks, order, one shared implied value, and farm steps. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value $${board[0]!.implied_value_usd}: a board that ranks nothing by value is not a ranking`;
  }
  for (const r of board) {
    const steps = r.farm_steps;
    if (steps.length < 3 || steps.length > 12) return `${r.slug} has ${steps.length} farm steps`;
    for (const s of steps) if (s.length < 20 || s.length > 600) return `${r.slug} has a farm step of ${s.length} characters`;
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has implied value ${r.implied_value_usd}`;
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
