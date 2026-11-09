import { createPublicKey, verify } from 'node:crypto';

const decodePart = (part) => JSON.parse(Buffer.from(part, 'base64url').toString('utf8'));

/** Verifies AddonService tokens (RS256) against its JWKS. */
export const createVerifier = ({ jwksUrl, issuer, audience, fetchImpl = fetch }) => {
	let keys = new Map();
	let loadedAt = 0;

	const loadKeys = async (force) => {
		if (!force && keys.size > 0 && Date.now() - loadedAt < 5 * 60_000) {
			return keys;
		}
		const response = await fetchImpl(jwksUrl);
		if (!response.ok) {
			throw new Error(`JWKS ${response.status}`);
		}
		const { keys: jwks } = await response.json();
		keys = new Map(jwks.map((jwk) => [jwk.kid, createPublicKey({ key: jwk, format: 'jwk' })]));
		loadedAt = Date.now();
		return keys;
	};

	return async (authorization) => {
		const token = authorization?.startsWith('Bearer ') ? authorization.slice(7) : null;
		const parts = token?.split('.');
		if (!parts || parts.length !== 3) {
			return null;
		}
		let header;
		let claims;
		try {
			header = decodePart(parts[0]);
			claims = decodePart(parts[1]);
		} catch {
			return null;
		}
		if (header.alg !== 'RS256') {
			return null;
		}
		const key = (await loadKeys(false)).get(header.kid) ?? (await loadKeys(true)).get(header.kid);
		const signed = Buffer.from(`${parts[0]}.${parts[1]}`);
		if (!key || !verify('sha256', signed, key, Buffer.from(parts[2], 'base64url'))) {
			return null;
		}
		const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
		const now = Math.floor(Date.now() / 1000);
		if (claims.iss !== issuer || !audiences.includes(audience) || !(claims.exp > now)) {
			return null;
		}
		return { ...claims, token };
	};
};

export const hasRole = (claims, role) => Array.isArray(claims.roles) && claims.roles.includes(role);
