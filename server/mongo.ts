import type { NextFunction, Request, Response } from 'express';
import { MongoClient, type AnyBulkWriteOperation, type Db } from 'mongodb';
import fs from 'fs';
import path from 'path';
import { dbStore } from './db.js';
import { modulesStore } from './hrmsModulesStore.js';
import { passwordSetupTokens } from './inviteStore.js';

const DATA_FILE = path.join(process.cwd(), 'data', 'hrms_store.json');

function saveToFile() {
  try {
    const dir = path.dirname(DATA_FILE);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    const storeData: Record<string, any> = {};
    for (const b of bindings) {
      const entries = entriesOf(b);
      storeData[b.name] = entries.map(([key, value]) => ({
        key,
        value,
        seq: stateOf(b.name).seq.get(key),
      }));
    }
    fs.writeFileSync(DATA_FILE, JSON.stringify(storeData, null, 2), 'utf-8');
  } catch (err) {
    console.warn('[fileStore] failed to save data:', (err as Error).message);
  }
}

function loadFromFile(): boolean {
  try {
    if (!fs.existsSync(DATA_FILE)) return false;
    const raw = fs.readFileSync(DATA_FILE, 'utf-8');
    const storeData = JSON.parse(raw);
    for (const b of bindings) {
      const loadedList = storeData[b.name];
      if (!Array.isArray(loadedList)) continue;
      const st = stateOf(b.name);
      st.snapshot = new Map();
      st.seq = new Map();

      const loaded = loadedList.map((item: any) => ({
        key: item.key,
        value: item.value,
        seq: item.seq,
      }));

      for (const l of loaded) {
        if (typeof l.seq === 'number' && l.seq > seqCounter) seqCounter = l.seq;
      }

      const c = b.container();
      if (c instanceof Map) {
        c.clear();
        for (const { key, value } of loaded) {
          c.set(key, value);
          st.snapshot.set(key, JSON.stringify(toBody(key, value)));
        }
      } else {
        loaded.sort((x, y) =>
          b.newestFirst ? (y.seq ?? 0) - (x.seq ?? 0) : (x.seq ?? 0) - (y.seq ?? 0),
        );
        c.length = 0;
        for (const { key, value, seq } of loaded) {
          c.push(value);
          keyOf.set(value, key);
          st.snapshot.set(key, JSON.stringify(toBody(key, value)));
          if (typeof seq === 'number') st.seq.set(key, seq);
        }
      }
    }
    console.log('[fileStore] Loaded data from local JSON file.');
    return true;
  } catch (err) {
    console.warn('[fileStore] failed to load data:', (err as Error).message);
    return false;
  }
}

/**
 * MongoDB persistence for the in-memory stores.
 *
 * - MongoDB is the source of truth. On first boot the seed data is written to it;
 *   on every later boot the data is loaded from it (seed data is NOT re-applied).
 * - The existing stores (dbStore / modulesStore) stay as an in-process cache, so
 *   no route code has to change.
 * - After each write request (and every 15s as a safety net) the collections are
 *   diffed against what was last saved, and only changed documents are written.
 *   This also catches in-place edits such as `emp.status = 'X'`.
 */

type AnyDoc = Record<string, any>;

interface Binding {
  name: string; // MongoDB collection name
  kind: 'map' | 'array';
  newestFirst: boolean; // arrays only: true if the app uses unshift (newest at index 0)
  container: () => Map<string, AnyDoc> | AnyDoc[];
}

const mapOf = (name: string, container: () => Map<string, AnyDoc>): Binding => ({
  name,
  kind: 'map',
  newestFirst: false,
  container,
});

const listOf = (name: string, container: () => AnyDoc[], newestFirst: boolean): Binding => ({
  name,
  kind: 'array',
  newestFirst,
  container,
});

const bindings: Binding[] = [
  // core store (server/db.ts)
  mapOf('users', () => dbStore.users),
  mapOf('employees', () => dbStore.employees),
  mapOf('organizations', () => dbStore.organizations),
  mapOf('departments', () => dbStore.departments),
  mapOf('designations', () => dbStore.designations),
  mapOf('locations', () => dbStore.locations),
  mapOf('onboardingSubmissions', () => dbStore.onboardingSubmissions),
  mapOf('passwordSetupTokens', () => passwordSetupTokens),
  mapOf('documents', () => dbStore.documents),
  mapOf('shifts', () => dbStore.shifts),
  mapOf('attendanceRecords', () => dbStore.attendanceRecords),
  listOf('lifecycleEvents', () => dbStore.lifecycleEvents, true),
  listOf('auditLogs', () => dbStore.auditLogs, true),
  listOf('notifications', () => dbStore.notifications, true),
  // modules store (server/hrmsModulesStore.ts)
  mapOf('leaveBalances', () => modulesStore.leaveBalances),
  mapOf('leaveRequests', () => modulesStore.leaveRequests),
  mapOf('expenseClaims', () => modulesStore.expenseClaims),
  mapOf('payslips', () => modulesStore.payslips),
  mapOf('taxDeclarations', () => modulesStore.taxDeclarations),
  mapOf('policies', () => modulesStore.policies),
  listOf('policyAcknowledgements', () => modulesStore.policyAcknowledgements, false),
  mapOf('poshCases', () => modulesStore.poshCases),
  mapOf('holidays', () => modulesStore.holidays),
  mapOf('announcements', () => modulesStore.announcements),
  mapOf('performanceReviews', () => modulesStore.performanceReviews),
  mapOf('jobOpenings', () => modulesStore.jobOpenings),
  mapOf('jobCandidates', () => modulesStore.jobCandidates),
  mapOf('requirements', () => modulesStore.requirements),
  mapOf('referrals', () => modulesStore.referrals),
  mapOf('assets', () => modulesStore.assets),
  mapOf('hrRequests', () => modulesStore.hrRequests),
  mapOf('fullFinalSettlements', () => modulesStore.fullFinalSettlements),
];

// ---------------------------------------------------------------------------
// Internal state
// ---------------------------------------------------------------------------

interface CollectionState {
  snapshot: Map<string, string>; // key -> JSON of what is saved in Mongo (without __seq)
  seq: Map<string, number>; // arrays only: key -> position used to restore order
}

const states = new Map<string, CollectionState>();
const stateOf = (name: string): CollectionState => {
  let s = states.get(name);
  if (!s) {
    s = { snapshot: new Map(), seq: new Map() };
    states.set(name, s);
  }
  return s;
};

const keyOf = new WeakMap<object, string>(); // stable Mongo _id for array items
let seqCounter = 0;

let client: MongoClient | null = null;
let db: Db | null = null;
let timer: NodeJS.Timeout | undefined;
let interval: NodeJS.Timeout | undefined;
let chain: Promise<void> = Promise.resolve();

// ---------------------------------------------------------------------------
// Document <-> Mongo body conversion
// ---------------------------------------------------------------------------

function toBody(key: string, v: AnyDoc): AnyDoc {
  const { _id, ...rest } = v;
  const body: AnyDoc = { _id: key, ...rest };
  if (_id === undefined) body.__noId = true;
  else if (_id !== key) body.__origId = _id;
  return body;
}

function fromBody(d: AnyDoc): { key: string; value: AnyDoc; seq?: number } {
  const { _id, __origId, __noId, __seq, ...rest } = d;
  const value: AnyDoc = __noId ? rest : { _id: __origId ?? _id, ...rest };
  return { key: String(_id), value, seq: __seq };
}

function entriesOf(b: Binding): Array<[string, AnyDoc]> {
  const c = b.container();
  if (c instanceof Map) return [...c.entries()].map(([k, v]) => [String(k), v]);

  const used = new Set<string>();
  const out: Array<[string, AnyDoc]> = [];
  for (const v of c) {
    let key = keyOf.get(v);
    if (!key || used.has(key)) {
      key = String(v._id ?? `auto_${Math.random().toString(36).slice(2)}`);
      if (used.has(key)) key = `${key}~${Math.random().toString(36).slice(2, 8)}`;
      keyOf.set(v, key);
    }
    used.add(key);
    out.push([key, v]);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Sync: memory -> Mongo (only changed documents)
// ---------------------------------------------------------------------------

async function syncNow(): Promise<void> {
  if (db) {
    for (const b of bindings) {
      const st = stateOf(b.name);
      const entries = entriesOf(b);
      const nextSnapshot = new Map<string, string>();
      const changed: Array<[string, AnyDoc]> = [];
      const newKeys: string[] = [];

      for (const [key, value] of entries) {
        const body = toBody(key, value);
        const json = JSON.stringify(body);
        nextSnapshot.set(key, json);
        if (b.kind === 'array' && !st.seq.has(key)) newKeys.push(key);
        if (st.snapshot.get(key) !== json) changed.push([key, body]);
      }

      // Order for arrays: newest-first lists give index 0 the highest sequence number.
      if (b.kind === 'array' && newKeys.length > 0) {
        const ordered = b.newestFirst ? [...newKeys].reverse() : newKeys;
        for (const key of ordered) st.seq.set(key, ++seqCounter);
      }

      const ops: AnyBulkWriteOperation<AnyDoc>[] = [];
      for (const [key, body] of changed) {
        const replacement = b.kind === 'array' ? { ...body, __seq: st.seq.get(key) } : body;
        ops.push({ replaceOne: { filter: { _id: key as any }, replacement, upsert: true } });
      }
      for (const key of st.snapshot.keys()) {
        if (!nextSnapshot.has(key)) {
          ops.push({ deleteOne: { filter: { _id: key as any } } });
          st.seq.delete(key);
        }
      }

      if (ops.length > 0) {
        await db.collection<AnyDoc>(b.name).bulkWrite(ops, { ordered: false });
      }
      st.snapshot = nextSnapshot;
    }
  }
  saveToFile();
}

function enqueueSync(): Promise<void> {
  chain = chain.then(syncNow).catch((err) => {
    console.error('[mongo] sync failed:', err);
  });
  return chain;
}

export function scheduleSync(delayMs = 250): void {
  if (timer) return;
  timer = setTimeout(() => {
    timer = undefined;
    void enqueueSync();
  }, delayMs);
}

/** Express middleware: persist shortly after every write request. */
export function persistAfterWrites(req: Request, res: Response, next: NextFunction): void {
  if (req.method !== 'GET' && req.method !== 'HEAD' && req.method !== 'OPTIONS') {
    res.on('finish', () => scheduleSync());
  }
  next();
}

// ---------------------------------------------------------------------------
// Load: Mongo -> memory
// ---------------------------------------------------------------------------

async function loadFromMongo(database: Db): Promise<void> {
  for (const b of bindings) {
    const docs = await database.collection<AnyDoc>(b.name).find({}).toArray();
    const st = stateOf(b.name);
    st.snapshot = new Map();
    st.seq = new Map();

    const loaded = docs.map((d) => fromBody(d));
    for (const l of loaded) {
      if (typeof l.seq === 'number' && l.seq > seqCounter) seqCounter = l.seq;
    }

    const c = b.container();
    if (c instanceof Map) {
      c.clear();
      for (const { key, value } of loaded) {
        c.set(key, value);
        st.snapshot.set(key, JSON.stringify(toBody(key, value)));
      }
    } else {
      loaded.sort((x, y) =>
        b.newestFirst ? (y.seq ?? 0) - (x.seq ?? 0) : (x.seq ?? 0) - (y.seq ?? 0),
      );
      c.length = 0;
      for (const { key, value, seq } of loaded) {
        c.push(value);
        keyOf.set(value, key);
        st.snapshot.set(key, JSON.stringify(toBody(key, value)));
        if (typeof seq === 'number') st.seq.set(key, seq);
      }
    }
  }
}

async function ensureIndexes(database: Db): Promise<void> {
  try {
    await database
      .collection('users')
      .createIndex({ email: 1 }, { unique: true, partialFilterExpression: { email: { $type: 'string' } } });
    try {
      await database.collection('employees').dropIndex('employeeCode_1');
    } catch {}
    await database
      .collection('employees')
      .createIndex(
        { employeeCode: 1 },
        { partialFilterExpression: { employeeCode: { $type: 'string' } } },
      );
    await database.collection('employees').createIndex({ workEmail: 1 });
    await database.collection('documents').createIndex({ employeeId: 1 });
    await database.collection('notifications').createIndex({ recipientUserId: 1 });
  } catch (err) {
    console.warn('[mongo] index creation skipped:', (err as Error).message);
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function getDb(): Db {
  if (!db) throw new Error('MongoDB is not connected yet.');
  return db;
}

export async function connectMongo(): Promise<void> {
  // Always try loading from local JSON file first so any previously created employees/data are retained
  loadFromFile();

  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.log('[mongo] MONGODB_URI not set. Operating with local file persistence.');
    interval = setInterval(() => void enqueueSync(), 15_000);
    interval.unref();
    return;
  }
  const dbName = process.env.MONGODB_DB_NAME || 'zenith_hrms';

  // --- diagnostics (remove once connected) ---
  console.log('[mongo] node', process.versions.node, 'openssl', process.versions.openssl);
  console.log('[mongo] target:', uri.replace(/\/\/[^@]*@/, '//***@').split('?')[0]);
  console.log('[mongo] db name:', dbName);
  try {
    const ip = await (await fetch('https://api.ipify.org')).text();
    console.log('[mongo] outbound IPv4:', ip);
  } catch {
    console.log('[mongo] could not detect outbound IPv4');
  }
  // -------------------------------------------

  try {
    client = new MongoClient(uri, {
      serverSelectionTimeoutMS: 5000,
      ignoreUndefined: true,
      family: 4, // force IPv4 so the 0.0.0.0/0 allow-list entry applies
    });
    await client.connect();
    db = client.db(dbName);
    await db.command({ ping: 1 });

    const meta = db.collection<AnyDoc>('_meta');
    const seeded = await meta.findOne({ _id: 'seeded' as any });

    if (!seeded) {
      // First run: the stores currently hold the data (seed or loaded from local file), so save it.
      await syncNow();
      await meta.updateOne(
        { _id: 'seeded' as any },
        { $set: { at: new Date().toISOString() } },
        { upsert: true },
      );
      console.log(`[mongo] First run - data saved to MongoDB ("${dbName}").`);
    } else {
      await loadFromMongo(db);
      console.log(`[mongo] Loaded existing data from MongoDB ("${dbName}").`);
    }

    await ensureIndexes(db);

    interval = setInterval(() => void enqueueSync(), 15_000);
    interval.unref();
  } catch (err) {
    console.warn('[mongo] WARNING: Could not connect to MongoDB. Operating with local file persistence:', (err as Error).message);
    client = null;
    db = null;
    interval = setInterval(() => void enqueueSync(), 15_000);
    interval.unref();
  }
}

export async function flushAndClose(): Promise<void> {
  if (timer) {
    clearTimeout(timer);
    timer = undefined;
  }
  if (interval) clearInterval(interval);
  await enqueueSync();
  await client?.close();
  client = null;
  db = null;
}