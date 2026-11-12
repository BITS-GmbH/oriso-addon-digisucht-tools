import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import { createServer } from 'node:http';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createApp, cleanAnswers } from '../src/app.mjs';
import { createVerifier } from '../src/auth.mjs';
import { createHost } from '../src/host.mjs';
import { openStore } from '../src/store.mjs';
import { QUESTION_IDS } from '../src/questions.mjs';

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwks = { keys: [{ ...publicKey.export({ format: 'jwk' }), kid: 'k1', alg: 'RS256', use: 'sig' }] };
const b64 = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');

const token = (claims) => {
	const head = b64({ alg: 'RS256', kid: 'k1', typ: 'JWT' });
	const body = b64({
		iss: 'oriso-addonservice',
		aud: ['digisucht-tools'],
		exp: Math.floor(Date.now() / 1000) + 60,
		tenantId: 1,
		...claims
	});
	return `${head}.${body}.${sign('sha256', Buffer.from(`${head}.${body}`), privateKey).toString('base64url')}`;
};

const asker = token({ sub: 'asker-1', roles: ['user'] });
const otherTenantAsker = token({ sub: 'asker-1', roles: ['user'], tenantId: 2 });
const counsellor = token({ sub: 'consultant-1', roles: ['consultant'], askerId: 'asker-1', sessionId: 5 });
const counsellorWithoutClient = token({ sub: 'consultant-1', roles: ['consultant'] });
const service = token({ sub: 'addonservice', roles: ['addon-service'] });

let settings = { intro: 'Hallo', allowSharing: true };
let hostBehaviour = 'ok';
let hostCalls = [];
let server;
let hostServer;
let base;

const takeHostCalls = () => {
	const calls = hostCalls;
	hostCalls = [];
	return calls;
};

const startHost = () =>
	createServer(async (req, res) => {
		if (req.url === '/addons/host/settings') {
			res.writeHead(200, { 'Content-Type': 'application/json' });
			return res.end(JSON.stringify(settings));
		}
		const chunks = [];
		for await (const chunk of req) {
			chunks.push(chunk);
		}
		hostCalls.push({
			method: req.method,
			path: req.url,
			authorization: req.headers.authorization,
			body: JSON.parse(Buffer.concat(chunks).toString('utf8'))
		});
		if (hostBehaviour === 'hang') {
			return;
		}
		const status = hostBehaviour === 'fail' ? 500 : req.url.endsWith('/audit') ? 201 : 202;
		res.writeHead(status, { 'Content-Type': 'application/json' });
		res.end(JSON.stringify(status === 202 ? { id: 'n1' } : {}));
	});

const fetchImpl = async (url, init) => {
	if (String(url).endsWith('/jwks.json')) {
		return new Response(JSON.stringify(jwks));
	}
	return fetch(url, init);
};

const call = async (path, { auth, method = 'GET', body } = {}) => {
	const response = await fetch(`${base}${path}`, {
		method,
		headers: {
			...(auth ? { Authorization: `Bearer ${auth}` } : {}),
			...(body ? { 'Content-Type': 'application/json' } : {})
		},
		body: body ? JSON.stringify(body) : undefined
	});
	const type = response.headers.get('content-type') ?? '';
	return { status: response.status, body: type.includes('json') ? await response.json() : await response.text() };
};

before(async () => {
	hostServer = startHost();
	await new Promise((resolve) => hostServer.listen(0, '127.0.0.1', resolve));
	const hostUrl = `http://127.0.0.1:${hostServer.address().port}/addons/host`;
	const store = openStore(':memory:');
	const verify = createVerifier({
		jwksUrl: 'http://addonservice/addons/.well-known/jwks.json',
		issuer: 'oriso-addonservice',
		audience: 'digisucht-tools',
		fetchImpl
	});
	server = createApp({ store, verify, host: createHost({ url: hostUrl, fetchImpl, timeoutMs: 300 }) });
	await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
	base = `http://127.0.0.1:${server.address().port}`;
});

after(() => {
	server.close();
	hostServer.closeAllConnections();
	hostServer.close();
});

describe('public files', () => {
	it('serves manifest, settings schema and both UI modules', async () => {
		const manifest = await call('/.well-known/oriso-addon.json');
		assert.equal(manifest.body.name, 'digisucht-tools');
		assert.deepEqual(manifest.body.apps[0].slots, ['asker.navigation', 'consultant.session', 'consultant.asker-profile']);
		assert.equal((await call('/schema/settings.json')).body.type, 'object');
		assert.match((await call('/ui/entry.js')).body, /export async function mount/);
		assert.match((await call('/ui/questions.mjs')).body, /export const QUESTIONS/);
		assert.equal(manifest.body.calendar, '/calendar');
		assert.equal(manifest.body.apps[0].visibility, 'dynamic');
	});
});

describe('the goals tool', () => {
	it('rejects missing or foreign tokens', async () => {
		assert.equal((await call('/api/goals')).status, 401);
		const foreign = token({ sub: 'x', roles: ['user'], aud: ['other'] });
		assert.equal((await call('/api/goals', { auth: foreign })).status, 401);
	});

	it('is closed for clients until a counsellor releases it', async () => {
		const before = await call('/api/goals', { auth: asker });
		assert.equal(before.status, 200);
		assert.equal(before.body.released, false);
		assert.equal(before.body.intro, 'Hallo');
		const write = await call('/api/goals', { auth: asker, method: 'PUT', body: { answers: { goal: 'x' } } });
		assert.equal(write.status, 403);
	});

	it('needs the client from a verified session for counsellors', async () => {
		assert.equal((await call('/api/goals/client', { auth: counsellorWithoutClient })).status, 400);
		assert.equal((await call('/api/goals/client', { auth: asker })).status, 403);
	});

	it('lets counsellors release it and see shared answers only', async () => {
		const released = await call('/api/goals/client/release', { auth: counsellor, method: 'POST' });
		assert.equal(released.body.released, true);
		assert.equal((await call('/api/goals', { auth: asker })).body.released, true);
		assert.equal((await call('/api/goals', { auth: otherTenantAsker })).body.released, false);

		const notShared = await call('/api/goals', {
			auth: asker,
			method: 'PUT',
			body: { answers: { goal: 'Weniger trinken', unknown: 'weg', burden: '   ' }, shared: false }
		});
		assert.equal(notShared.status, 200);
		assert.deepEqual(notShared.body.answers, { goal: 'Weniger trinken' });

		const status = await call('/api/goals/client', { auth: counsellor });
		assert.equal(status.body.started, true);
		assert.equal(status.body.shared, false);
		assert.equal(status.body.answers, null);

		await call('/api/goals', { auth: asker, method: 'PUT', body: { answers: { goal: 'Weniger trinken' }, shared: true } });
		assert.deepEqual((await call('/api/goals/client', { auth: counsellor })).body.answers, { goal: 'Weniger trinken' });
	});

	it('does not share when the Träger switched sharing off', async () => {
		settings = { intro: '', allowSharing: false };
		const saved = await call('/api/goals', { auth: asker, method: 'PUT', body: { answers: { goal: 'a' }, shared: true } });
		assert.equal(saved.body.shared, false);
		assert.equal((await call('/api/goals', { auth: asker })).body.allowSharing, false);
		settings = { intro: 'Hallo', allowSharing: true };
	});

	it('reports statistics to the AddonService for its own Träger only', async () => {
		assert.equal((await call('/stats?tenantId=1', { auth: asker })).status, 403);
		assert.equal((await call('/stats?tenantId=2', { auth: service })).status, 403);
		const stats = await call('/stats?tenantId=1', { auth: service });
		assert.deepEqual(stats.body.values, { released: 1, started: 1, shared: 0 });
	});
});

const counsellorFor = (askerId, claims = {}) =>
	token({ sub: 'consultant-1', roles: ['consultant'], askerId, sessionId: 9, ...claims });
const askerToken = (sub) => token({ sub, roles: ['user'] });
const release = (auth) => call('/api/goals/client/release', { auth, method: 'POST' });

beforeEach(() => {
	takeHostCalls();
	hostBehaviour = 'ok';
});

describe('host notifications and audit entries', () => {
	it('audits a release and notifies the client formally, once', async () => {
		const auth = counsellorFor('asker-10');
		assert.equal((await release(auth)).status, 200);
		const calls = takeHostCalls().sort((a, b) => a.path.localeCompare(b.path));
		assert.deepEqual(calls, [
			{
				method: 'POST',
				path: '/addons/host/audit',
				authorization: `Bearer ${auth}`,
				body: {
					action: 'tool.released',
					appId: 'goals',
					summary: {
						de: 'Tool „Ausgangssituation und Ziele“ freigegeben',
						en: 'Released tool “Starting point and goals”'
					},
					subject: 'asker'
				}
			},
			{
				method: 'POST',
				path: '/addons/host/notifications',
				authorization: `Bearer ${auth}`,
				body: {
					recipient: 'asker',
					appId: 'goals',
					important: true,
					title: { de: 'Neues Tool freigegeben', en: 'New tool released' },
					text: {
						de: 'Ihre Beratung hat „Ausgangssituation und Ziele“ für Sie freigegeben.',
						en: 'Your counsellor released “Starting point and goals” for you.'
					},
					target: { slot: 'asker.navigation' }
				}
			}
		]);

		assert.equal((await release(auth)).status, 200);
		assert.deepEqual(takeHostCalls(), []);
	});

	it('uses informal address when the settings or the token ask for it', async () => {
		settings = { ...settings, informal: true };
		await release(counsellorFor('asker-11'));
		settings = { intro: 'Hallo', allowSharing: true };
		await release(counsellorFor('asker-12', { formalLanguage: false }));
		const texts = takeHostCalls()
			.filter((entry) => entry.path.endsWith('/notifications'))
			.map((entry) => entry.body.text.de);
		assert.deepEqual(texts, [
			'Deine Beratung hat „Ausgangssituation und Ziele“ für dich freigegeben.',
			'Deine Beratung hat „Ausgangssituation und Ziele“ für dich freigegeben.'
		]);
	});

	it('releases even when the host API fails or does not answer', async () => {
		hostBehaviour = 'fail';
		const failed = await release(counsellorFor('asker-13'));
		assert.equal(failed.status, 200);
		assert.equal(failed.body.released, true);

		hostBehaviour = 'hang';
		const started = Date.now();
		const hung = await release(counsellorFor('asker-14'));
		assert.equal(hung.status, 200);
		assert.ok(Date.now() - started < 2000);
		assert.equal(takeHostCalls().length, 4);
	});

	it('audits sharing by the client once and notifies nobody', async () => {
		await release(counsellorFor('asker-15'));
		takeHostCalls();
		const auth = askerToken('asker-15');
		const save = (shared) => call('/api/goals', { auth, method: 'PUT', body: { answers: { goal: 'a' }, shared } });

		await save(false);
		assert.deepEqual(takeHostCalls(), []);

		hostBehaviour = 'fail';
		assert.equal((await save(true)).status, 200);
		assert.deepEqual(takeHostCalls(), [
			{
				method: 'POST',
				path: '/addons/host/audit',
				authorization: `Bearer ${auth}`,
				body: {
					action: 'answers.shared',
					appId: 'goals',
					summary: {
						de: 'Antworten zu „Ausgangssituation und Ziele“ mit der Beratung geteilt',
						en: 'Shared answers to “Starting point and goals” with counselling'
					},
					subject: 'self'
				}
			}
		]);

		await save(true);
		assert.deepEqual(takeHostCalls(), []);
	});
});

describe('calendar', () => {
	const calendar = (auth, query = '') => call(`/calendar${query}`, { auth });
	const DAY = 24 * 60 * 60 * 1000;

	it('needs a token and valid instants', async () => {
		assert.equal((await calendar(undefined)).status, 401);
		assert.equal((await calendar(askerToken('asker-20'), '?from=yesterday')).status, 400);
	});

	it('reminds a released client a week after the release until the answers are shared or complete', async () => {
		const auth = askerToken('asker-20');
		assert.deepEqual((await calendar(auth)).body, { entries: [] });

		const { releasedAt } = (await release(counsellorFor('asker-20'))).body;
		const due = new Date(Date.parse(releasedAt) + 7 * DAY).toISOString();
		const { entries } = (await calendar(auth)).body;
		assert.deepEqual(entries, [
			{
				id: 'goals-fill-in',
				appId: 'goals',
				kind: 'reminder',
				title: { de: 'Ausgangssituation und Ziele ausfüllen', en: 'Fill in starting point and goals' },
				start: due,
				allDay: true,
				link: { slot: 'asker.navigation' }
			}
		]);

		const range = (from, to) => `?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`;
		const now = Date.now();
		const iso = (time) => new Date(time).toISOString();
		assert.equal((await calendar(auth, range(iso(now), iso(now + 30 * DAY)))).body.entries.length, 1);
		assert.equal((await calendar(auth, range(iso(now), iso(now + 2 * DAY)))).body.entries.length, 0);
		assert.equal((await calendar(auth, range(iso(now + 10 * DAY), iso(now + 30 * DAY)))).body.entries.length, 0);
		assert.equal((await calendar(auth, range(due, iso(Date.parse(due) + 1)))).body.entries.length, 1);

		await call('/api/goals', { auth, method: 'PUT', body: { answers: { goal: 'a' }, shared: false } });
		assert.equal((await calendar(auth)).body.entries.length, 1);
		await call('/api/goals', { auth, method: 'PUT', body: { answers: { goal: 'a' }, shared: true } });
		assert.deepEqual((await calendar(auth)).body.entries, []);
	});

	it('counts a complete, unshared answer set as done', async () => {
		const auth = askerToken('asker-21');
		await release(counsellorFor('asker-21'));
		const answers = Object.fromEntries(QUESTION_IDS.map((id) => [id, 'x']));
		await call('/api/goals', { auth, method: 'PUT', body: { answers, shared: false } });
		assert.deepEqual((await calendar(auth)).body.entries, []);
	});

	it('has nothing for counsellors', async () => {
		const auth = token({ sub: 'consultant-1', roles: ['consultant'] });
		assert.deepEqual((await calendar(auth)).body, { entries: [] });
	});
});

describe('visibility', () => {
	const visibility = async (auth) => (await call('/visibility', { auth })).body;

	it('needs a token', async () => {
		assert.equal((await call('/visibility')).status, 401);
	});

	it('shows the tool to a client once released, with a badge until the client opens it', async () => {
		const auth = askerToken('asker-30');
		assert.deepEqual(await visibility(auth), { apps: { goals: { visible: false } } });

		await call('/api/goals', { auth });
		await release(counsellorFor('asker-30'));
		assert.deepEqual(await visibility(auth), { apps: { goals: { visible: true, badge: 1 } } });

		await call('/api/goals', { auth });
		assert.deepEqual(await visibility(auth), { apps: { goals: { visible: true } } });

		await release(counsellorFor('asker-30'));
		assert.deepEqual(await visibility(auth), { apps: { goals: { visible: true } } });
	});

	it('always shows the tool to counsellors, without a badge', async () => {
		assert.deepEqual(await visibility(token({ sub: 'consultant-1', roles: ['consultant'] })), {
			apps: { goals: { visible: true } }
		});
		assert.deepEqual(await visibility(counsellorFor('asker-31')), { apps: { goals: { visible: true } } });
	});
});

describe('store', () => {
	it('adds opened_at to a database created before it existed', () => {
		const file = join(mkdtempSync(join(tmpdir(), 'tools-')), 'tools.db');
		const old = new DatabaseSync(file);
		old.exec(`CREATE TABLE releases (
			tenant_id INTEGER NOT NULL, asker_id TEXT NOT NULL, tool TEXT NOT NULL,
			released_by TEXT NOT NULL, released_at TEXT NOT NULL, PRIMARY KEY (tenant_id, asker_id, tool))`);
		old.prepare('INSERT INTO releases VALUES (1, ?, ?, ?, ?)').run('asker-1', 'goals', 'c-1', '2026-01-01T00:00:00.000Z');
		old.close();

		const store = openStore(file);
		assert.equal(store.releaseOf(1, 'asker-1').openedAt, null);
		store.markOpened(1, 'asker-1');
		const openedAt = store.releaseOf(1, 'asker-1').openedAt;
		assert.ok(openedAt);
		store.markOpened(1, 'asker-1');
		assert.equal(store.releaseOf(1, 'asker-1').openedAt, openedAt);
		store.close();
		assert.equal(openStore(file).releaseOf(1, 'asker-1').openedAt, openedAt);
	});
});

describe('cleanAnswers', () => {
	it('keeps known, non-empty text answers', () => {
		assert.deepEqual(cleanAnswers({ goal: 'a', situation: '', other: 'b' }), { goal: 'a' });
	});

	it('rejects non-text and overlong answers', () => {
		assert.throws(() => cleanAnswers({ goal: 1 }), /must be text/);
		assert.throws(() => cleanAnswers({ goal: 'x'.repeat(4001) }), /at most 4000/);
		assert.throws(() => cleanAnswers(null), /must be an object/);
	});
});
