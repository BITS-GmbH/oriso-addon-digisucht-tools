import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import { createApp, cleanAnswers } from '../src/app.mjs';
import { createVerifier } from '../src/auth.mjs';
import { openStore } from '../src/store.mjs';

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
let server;
let base;

const fetchImpl = async (url, init) => {
	if (String(url).endsWith('/jwks.json')) {
		return new Response(JSON.stringify(jwks));
	}
	if (String(url).endsWith('/host/settings')) {
		assert.match(init.headers.Authorization, /^Bearer /);
		return new Response(JSON.stringify(settings));
	}
	throw new Error(`unexpected fetch ${url}`);
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
	const store = openStore(':memory:');
	const verify = createVerifier({
		jwksUrl: 'http://addonservice/addons/.well-known/jwks.json',
		issuer: 'oriso-addonservice',
		audience: 'digisucht-tools',
		fetchImpl
	});
	server = createApp({ store, verify, settingsUrl: 'http://addonservice/addons/host/settings', fetchImpl });
	await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
	base = `http://127.0.0.1:${server.address().port}`;
});

after(() => server.close());

describe('public files', () => {
	it('serves manifest, settings schema and both UI modules', async () => {
		const manifest = await call('/.well-known/oriso-addon.json');
		assert.equal(manifest.body.name, 'digisucht-tools');
		assert.deepEqual(manifest.body.apps[0].slots, ['asker.navigation', 'consultant.session', 'consultant.asker-profile']);
		assert.equal((await call('/schema/settings.json')).body.type, 'object');
		assert.match((await call('/ui/entry.js')).body, /export async function mount/);
		assert.match((await call('/ui/questions.mjs')).body, /export const QUESTIONS/);
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
