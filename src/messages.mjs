import { QUESTION_IDS } from './questions.mjs';

const APP_ID = 'goals';
const SLOT = 'asker.navigation';
const REMINDER_DELAY_MS = 7 * 24 * 60 * 60 * 1000;

export const isInformal = (claims, settings) =>
	claims.informal === true || claims.formalLanguage === false || settings?.informal === true;

export const releaseNotification = (informal) => ({
	recipient: 'asker',
	appId: APP_ID,
	important: true,
	title: { de: 'Neues Tool freigegeben', en: 'New tool released' },
	text: {
		de: informal
			? 'Deine Beratung hat „Ausgangssituation und Ziele“ für dich freigegeben.'
			: 'Ihre Beratung hat „Ausgangssituation und Ziele“ für Sie freigegeben.',
		en: 'Your counsellor released “Starting point and goals” for you.'
	},
	target: { slot: SLOT }
});

/** To the client's counsellors when the client shares the answers; counsellors are addressed formally. */
export const sharedNotification = () => ({
	recipient: 'counsellors',
	appId: APP_ID,
	important: false,
	title: { de: 'Antworten geteilt', en: 'Answers shared' },
	text: {
		de: 'Eine ratsuchende Person hat ihre Antworten zu „Ausgangssituation und Ziele“ mit Ihnen geteilt.',
		en: 'A client shared their answers to “Starting point and goals” with you.'
	},
	target: { slot: 'consultant.session' }
});

export const RELEASED_AUDIT = {
	action: 'tool.released',
	appId: APP_ID,
	summary: {
		de: 'Tool „Ausgangssituation und Ziele“ freigegeben',
		en: 'Released tool “Starting point and goals”'
	},
	subject: 'asker'
};

export const SHARED_AUDIT = {
	action: 'answers.shared',
	appId: APP_ID,
	summary: {
		de: 'Antworten zu „Ausgangssituation und Ziele“ mit der Beratung geteilt',
		en: 'Shared answers to “Starting point and goals” with counselling'
	},
	subject: 'self'
};

const isDone = (entry) => Boolean(entry?.shared) || QUESTION_IDS.every((id) => entry?.answers[id]);

/** The client's reminder to fill in the tool, due a week after the release until it is shared or complete. */
export const calendarFor = (release, entry) => {
	if (!release || isDone(entry)) {
		return [];
	}
	return [
		{
			id: 'goals-fill-in',
			appId: APP_ID,
			kind: 'reminder',
			title: { de: 'Ausgangssituation und Ziele ausfüllen', en: 'Fill in starting point and goals' },
			start: new Date(Date.parse(release.releasedAt) + REMINDER_DELAY_MS).toISOString(),
			allDay: true,
			link: { slot: SLOT }
		}
	];
};
