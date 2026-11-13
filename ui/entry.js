// "Ausgangssituation und Ziele" for ORISO (contract oriso-addon/v1). No build step: React comes
// from the host on globalThis.__ORISO_ADDON_SHARED__, the questions from the server's module.
import { QUESTIONS, MAX_ANSWER_LENGTH } from './questions.mjs';

const { react: React, reactDomClient } = globalThis.__ORISO_ADDON_SHARED__;
const h = React.createElement;
const { useCallback, useEffect, useState } = React;
const roots = new Map();

const color = (token, fallback) => `var(${token}, ${fallback})`;
const styles = {
	card: {
		border: `1px solid ${color('--m3-outline-variant', '#dbdee2')}`,
		borderRadius: '16px',
		padding: '20px 24px',
		background: color('--m3-surface', '#fff'),
		color: color('--m3-on-surface', '#0d1520'),
		fontSize: '15px',
		lineHeight: 1.5,
		maxWidth: '760px',
		boxSizing: 'border-box'
	},
	muted: { color: color('--m3-on-surface-variant', '#5c6670'), margin: '0 0 12px' },
	label: { display: 'block', fontWeight: 600, margin: '18px 0 6px' },
	textarea: {
		width: '100%',
		minHeight: '84px',
		boxSizing: 'border-box',
		padding: '10px 12px',
		borderRadius: '10px',
		border: `1px solid ${color('--m3-outline', '#8a939c')}`,
		font: 'inherit',
		resize: 'vertical',
		background: color('--m3-surface', '#fff'),
		color: 'inherit'
	},
	row: { display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap', marginTop: '20px' },
	button: {
		border: 'none',
		borderRadius: '999px',
		padding: '10px 20px',
		font: 'inherit',
		fontWeight: 600,
		cursor: 'pointer',
		background: color('--m3-primary', '#009fe3'),
		color: color('--m3-on-primary', '#fff')
	},
	status: { display: 'inline-block', borderRadius: '999px', padding: '2px 12px', fontSize: '13px', fontWeight: 600 },
	answer: { margin: '4px 0 0', whiteSpace: 'pre-wrap' },
	error: { color: color('--m3-error', '#b42318'), margin: '12px 0 0' }
};

const text = (informal, formal, du) => (informal ? du : formal);

const useJson = (api, path) => {
	const [state, setState] = useState({ loading: true, data: null, error: null });
	const reload = useCallback(() => {
		setState((previous) => ({ ...previous, loading: true }));
		return api(path)
			.then((response) => (response.ok ? response.json() : Promise.reject(new Error(`HTTP ${response.status}`))))
			.then(
				(data) => setState({ loading: false, data, error: null }),
				(error) => setState({ loading: false, data: null, error: error.message })
			);
	}, [api, path]);
	useEffect(() => {
		reload();
	}, [reload]);
	return [state, reload, setState];
};

const formatDate = (iso, locale) => (iso ? new Date(iso).toLocaleDateString(locale || 'de') : '');

/**
 * Shows a message through the host's notifications (contract oriso-addon/v1, `notify`). Hosts
 * without `notify` get false back, and the view shows the message inline instead.
 */
const tell = (notify, type, message) => {
	if (typeof notify !== 'function') {
		return false;
	}
	notify({ type, text: message });
	return true;
};

function AskerView({ api, informal, locale, notify }) {
	const [{ loading, data, error }, , setState] = useJson(api, '/goals');
	const [answers, setAnswers] = useState({});
	const [shared, setShared] = useState(false);
	const [saving, setSaving] = useState(false);
	const [saved, setSaved] = useState(null);
	const [saveError, setSaveError] = useState(null);

	useEffect(() => {
		if (data) {
			setAnswers(data.answers ?? {});
			setShared(Boolean(data.shared));
		}
	}, [data]);

	if (loading && !data) {
		return h('div', { style: styles.card }, text(informal, 'Wird geladen …', 'Wird geladen …'));
	}
	if (error) {
		return h('div', { style: styles.card }, h('p', { style: styles.error }, `Das Tool konnte nicht geladen werden (${error}).`));
	}
	if (!data.released) {
		return h(
			'div',
			{ style: styles.card },
			h('p', { style: { margin: 0 } },
				text(
					informal,
					'Dieses Tool schaltet Ihre Beraterin oder Ihr Berater für Sie frei. Sprechen Sie sie oder ihn gern darauf an.',
					'Dieses Tool schaltet deine Beraterin oder dein Berater für dich frei. Sprich sie oder ihn gern darauf an.'
				)
			)
		);
	}

	const save = async (event) => {
		event.preventDefault();
		setSaving(true);
		setSaveError(null);
		try {
			const response = await api('/goals', {
				method: 'PUT',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ answers, shared })
			});
			if (!response.ok) {
				throw new Error(`HTTP ${response.status}`);
			}
			const entry = await response.json();
			setState((previous) => ({ ...previous, data: { ...previous.data, ...entry } }));
			setSaved(entry.updatedAt);
			tell(notify, 'success', text(informal, 'Ihre Antworten sind gespeichert.', 'Deine Antworten sind gespeichert.'));
		} catch (reason) {
			const message = `Speichern hat nicht geklappt (${reason.message}).`;
			if (!tell(notify, 'error', message)) {
				setSaveError(message);
			}
		} finally {
			setSaving(false);
		}
	};

	const intro =
		data.intro ||
		text(
			informal,
			'Beschreiben Sie in eigenen Worten, wo Sie gerade stehen und was Sie sich von der Beratung wünschen. Sie können Ihre Antworten jederzeit ergänzen oder ändern.',
			'Beschreibe in eigenen Worten, wo du gerade stehst und was du dir von der Beratung wünschst. Du kannst deine Antworten jederzeit ergänzen oder ändern.'
		);

	return h(
		'form',
		{ style: styles.card, onSubmit: save },
		h('p', { style: styles.muted }, intro),
		...QUESTIONS.map((question) =>
			h(
				'div',
				{ key: question.id },
				h('label', { style: styles.label, htmlFor: `goals-${question.id}` }, informal ? question.informal : question.formal),
				h('textarea', {
					id: `goals-${question.id}`,
					style: styles.textarea,
					maxLength: MAX_ANSWER_LENGTH,
					value: answers[question.id] ?? '',
					onChange: (event) => setAnswers({ ...answers, [question.id]: event.target.value })
				})
			)
		),
		data.allowSharing &&
			h(
				'label',
				{ style: { ...styles.row, cursor: 'pointer' } },
				h('input', { type: 'checkbox', checked: shared, onChange: (event) => setShared(event.target.checked) }),
				text(informal, 'Antworten mit meiner Beratung teilen', 'Antworten mit meiner Beratung teilen')
			),
		h(
			'div',
			{ style: styles.row },
			h('button', { type: 'submit', style: styles.button, disabled: saving }, saving ? 'Wird gespeichert …' : 'Speichern'),
			saved && h('span', { style: styles.muted }, `Gespeichert am ${formatDate(saved, locale)}`)
		),
		saveError && h('p', { style: styles.error, role: 'alert' }, saveError)
	);
}

function CounsellorView({ api, locale, notify }) {
	const [{ loading, data, error }, reload] = useJson(api, '/goals/client');
	const [releasing, setReleasing] = useState(false);
	const [releaseError, setReleaseError] = useState(null);

	if (loading && !data) {
		return h('div', { style: styles.card }, 'Wird geladen …');
	}
	if (error) {
		return h('div', { style: styles.card }, h('p', { style: styles.error }, `Status nicht verfügbar (${error}).`));
	}

	const release = async () => {
		setReleasing(true);
		setReleaseError(null);
		try {
			const response = await api('/goals/client/release', { method: 'POST' });
			if (response.status === 409) {
				const message =
					'Freigabe gerade nicht möglich: Der Träger hat den aktuellen Auftragsverarbeitungsvertrag noch nicht bestätigt.';
				if (!tell(notify, 'warning', message)) {
					setReleaseError(message);
				}
				return;
			}
			if (!response.ok) {
				throw new Error(`HTTP ${response.status}`);
			}
			await reload();
			tell(notify, 'success', 'Das Tool ist freigegeben. Die ratsuchende Person wird benachrichtigt.');
		} catch (reason) {
			const message = `Freigabe hat nicht geklappt (${reason.message}).`;
			if (!tell(notify, 'error', message)) {
				setReleaseError(message);
			}
		} finally {
			setReleasing(false);
		}
	};

	const status = !data.released
		? ['Nicht freigegeben', color('--m3-surface-container-high', '#eceef0')]
		: !data.started
			? [`Freigegeben am ${formatDate(data.releasedAt, locale)}, noch nicht bearbeitet`, color('--m3-secondary-container', '#e5f5fc')]
			: data.shared
				? [`Geteilt, zuletzt bearbeitet am ${formatDate(data.updatedAt, locale)}`, color('--m3-primary-container', '#bfe6fa')]
				: [`Bearbeitet am ${formatDate(data.updatedAt, locale)}, nicht geteilt`, color('--m3-secondary-container', '#e5f5fc')];

	return h(
		'div',
		{ style: styles.card },
		h('span', { style: { ...styles.status, background: status[1] } }, status[0]),
		!data.released &&
			h(
				'div',
				{ style: styles.row },
				h('button', { type: 'button', style: styles.button, onClick: release, disabled: releasing }, releasing ? 'Wird freigegeben …' : 'Tool freigeben')
			),
		data.answers &&
			QUESTIONS.filter((question) => data.answers[question.id]).map((question) =>
				h(
					'div',
					{ key: question.id },
					h('p', { style: styles.label }, question.formal),
					h('p', { style: styles.answer }, data.answers[question.id])
				)
			),
		releaseError && h('p', { style: styles.error, role: 'alert' }, releaseError)
	);
}

function GoalsTool(props) {
	return props.slot === 'asker.navigation' ? h(AskerView, props) : h(CounsellorView, props);
}

export async function mount(props) {
	const root = reactDomClient.createRoot(props.domElement);
	roots.set(props.domElement, root);
	root.render(h(GoalsTool, props));
}

export async function update(props) {
	roots.get(props.domElement)?.render(h(GoalsTool, props));
}

export async function unmount(props) {
	roots.get(props.domElement)?.unmount();
	roots.delete(props.domElement);
}
