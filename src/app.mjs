import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { manifest, settingsSchema } from './manifest.mjs';
import { MAX_ANSWER_LENGTH, QUESTION_IDS } from './questions.mjs';
import { hasRole } from './auth.mjs';

const SERVICE_ROLE = 'addon-service';
const DEFAULT_SETTINGS = Object.fromEntries(
	Object.entries(settingsSchema.properties).map(([key, definition]) => [key, definition.default])
);

const send = (res, status, type, body, extra = {}) => {
	res.writeHead(status, { 'Content-Type': type, ...extra });
	res.end(body);
};

const json = (res, status, body) => send(res, status, 'application/json; charset=utf-8', JSON.stringify(body));

const readJson = async (req) => {
	let size = 0;
	const chunks = [];
	for await (const chunk of req) {
		size += chunk.length;
		if (size > 64 * 1024) {
			throw Object.assign(new Error('too large'), { status: 413 });
		}
		chunks.push(chunk);
	}
	try {
		return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
	} catch {
		throw Object.assign(new Error('invalid json'), { status: 400 });
	}
};

/** Answers limited to the known questions, as trimmed text of bounded length. */
export const cleanAnswers = (answers) => {
	if (typeof answers !== 'object' || answers === null || Array.isArray(answers)) {
		throw Object.assign(new Error('answers must be an object'), { status: 400 });
	}
	const clean = {};
	for (const id of QUESTION_IDS) {
		const value = answers[id];
		if (value === undefined || value === null) {
			continue;
		}
		if (typeof value !== 'string' || value.length > MAX_ANSWER_LENGTH) {
			throw Object.assign(new Error(`answer ${id} must be text of at most ${MAX_ANSWER_LENGTH} characters`), {
				status: 400
			});
		}
		if (value.trim()) {
			clean[id] = value;
		}
	}
	return clean;
};

/** The UI bundle and the module with the questions it shares with the server. */
export const UI_FILES = {
	'/ui/entry.js': new URL('../ui/entry.js', import.meta.url),
	'/ui/questions.mjs': new URL('./questions.mjs', import.meta.url)
};

export const createApp = ({ store, verify, settingsUrl, fetchImpl = fetch, uiFiles = UI_FILES }) => {
	const loadSettings = async (claims) => {
		if (!settingsUrl) {
			return DEFAULT_SETTINGS;
		}
		try {
			const response = await fetchImpl(settingsUrl, {
				headers: { Authorization: `Bearer ${claims.token}` },
				signal: AbortSignal.timeout(3000)
			});
			return response.ok ? { ...DEFAULT_SETTINGS, ...(await response.json()) } : DEFAULT_SETTINGS;
		} catch {
			return DEFAULT_SETTINGS;
		}
	};

	const asker = async (req, res, claims, tenantId) => {
		const askerId = claims.sub;
		const release = store.releaseOf(tenantId, askerId);
		if (req.method === 'GET') {
			const settings = await loadSettings(claims);
			const entry = store.entryOf(tenantId, askerId);
			return json(res, 200, {
				released: Boolean(release),
				answers: entry?.answers ?? {},
				shared: entry?.shared ?? false,
				updatedAt: entry?.updatedAt ?? null,
				intro: settings.intro || '',
				allowSharing: settings.allowSharing !== false
			});
		}
		if (req.method === 'PUT') {
			if (!release) {
				return json(res, 403, { error: 'not released' });
			}
			const body = await readJson(req);
			const settings = await loadSettings(claims);
			const shared = settings.allowSharing !== false && body.shared === true;
			const entry = store.saveEntry(tenantId, askerId, cleanAnswers(body.answers), shared);
			return json(res, 200, entry);
		}
		return json(res, 405, { error: 'method not allowed' });
	};

	const counsellor = async (req, res, claims, tenantId, path) => {
		if (!claims.askerId) {
			return json(res, 400, { error: 'no client context' });
		}
		if (path === '/api/goals/client' && req.method === 'GET') {
			const release = store.releaseOf(tenantId, claims.askerId);
			const entry = store.entryOf(tenantId, claims.askerId);
			return json(res, 200, {
				released: Boolean(release),
				releasedAt: release?.releasedAt ?? null,
				started: Boolean(entry),
				updatedAt: entry?.updatedAt ?? null,
				shared: entry?.shared ?? false,
				answers: entry?.shared ? entry.answers : null
			});
		}
		if (path === '/api/goals/client/release' && req.method === 'POST') {
			const release = store.release(tenantId, claims.askerId, claims.sub);
			return json(res, 200, { released: true, releasedAt: release.releasedAt });
		}
		return json(res, 404, { error: 'not found' });
	};

	return createServer(async (req, res) => {
		const url = new URL(req.url, 'http://localhost');
		const path = url.pathname;
		try {
			if (path === '/.well-known/oriso-addon.json') {
				return json(res, 200, manifest);
			}
			if (path === '/schema/settings.json') {
				return json(res, 200, settingsSchema);
			}
			if (path === '/health') {
				return json(res, 200, { status: 'UP' });
			}
			if (Object.hasOwn(uiFiles, path)) {
				return send(res, 200, 'text/javascript; charset=utf-8', await readFile(uiFiles[path]), {
					'Cache-Control': 'no-cache'
				});
			}

			const claims = await verify(req.headers.authorization);
			if (!claims) {
				return json(res, 401, { error: 'invalid token' });
			}
			const tenantId = Number(claims.tenantId);
			if (!Number.isFinite(tenantId)) {
				return json(res, 403, { error: 'no Träger' });
			}

			if (path === '/stats') {
				if (!hasRole(claims, SERVICE_ROLE) || Number(url.searchParams.get('tenantId')) !== tenantId) {
					return json(res, 403, { error: 'forbidden' });
				}
				return json(res, 200, { values: store.statistics(tenantId) });
			}
			if (path === '/api/goals' && hasRole(claims, 'user') && !hasRole(claims, 'consultant')) {
				return await asker(req, res, claims, tenantId);
			}
			if (path.startsWith('/api/goals/client') && hasRole(claims, 'consultant')) {
				return await counsellor(req, res, claims, tenantId, path);
			}
			return json(res, path.startsWith('/api/') ? 403 : 404, { error: 'not allowed' });
		} catch (error) {
			if (error.status) {
				return json(res, error.status, { error: error.message });
			}
			console.error(error);
			return json(res, 500, { error: 'internal error' });
		}
	});
};
