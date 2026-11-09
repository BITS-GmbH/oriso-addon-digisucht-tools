import { createApp } from './app.mjs';
import { createVerifier } from './auth.mjs';
import { NAME } from './manifest.mjs';
import { openStore } from './store.mjs';

const ADDONSERVICE = process.env.ADDONSERVICE_URL ?? 'http://addonservice:8090';
const port = Number(process.env.PORT ?? 8080);

const store = openStore(process.env.DATA_FILE ?? '/data/tools.db');
const verify = createVerifier({
	jwksUrl: `${ADDONSERVICE}/addons/.well-known/jwks.json`,
	issuer: process.env.ADDONSERVICE_ISSUER ?? 'oriso-addonservice',
	audience: NAME
});

const server = createApp({
	store,
	verify,
	settingsUrl: `${ADDONSERVICE}/addons/host/settings`
});

server.listen(port, () => console.log(`${NAME} on :${port}, AddonService ${ADDONSERVICE}`));

const stop = () => server.close(() => {
	store.close();
	process.exit(0);
});
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
