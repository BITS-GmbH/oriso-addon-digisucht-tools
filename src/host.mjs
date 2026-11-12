/** Calls to the AddonService host API, made with the add-on token of the request being handled. */
export const createHost = ({ url, fetchImpl = fetch, timeoutMs = 2000 }) => {
	const request = (path, claims, init = {}) =>
		fetchImpl(`${url}${path}`, {
			...init,
			headers: { Authorization: `Bearer ${claims.token}`, ...init.headers },
			signal: AbortSignal.timeout(timeoutMs)
		});

	const post = async (path, claims, body) => {
		try {
			const response = await request(path, claims, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(body)
			});
			if (!response.ok) {
				console.warn(`host ${path} answered ${response.status}`);
			}
			return response.ok;
		} catch (error) {
			console.warn(`host ${path} failed: ${error.message}`);
			return false;
		}
	};

	return {
		async settings(claims) {
			try {
				const response = await request('/settings', claims);
				return response.ok ? await response.json() : null;
			} catch {
				return null;
			}
		},
		notify: (claims, notification) => post('/notifications', claims, notification),
		audit: (claims, entry) => post('/audit', claims, entry)
	};
};
