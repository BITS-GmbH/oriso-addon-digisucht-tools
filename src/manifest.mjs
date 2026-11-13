export const NAME = 'digisucht-tools';

export const manifest = {
	name: NAME,
	version: '0.1.0',
	contract: 'oriso-addon/v1',
	react: '^19',
	ui: '/ui/entry.js',
	settings: '/schema/settings.json',
	calendar: '/calendar',
	events: ['user.deleted'],
	stats: [
		{ id: 'released', label: { de: 'Freigegeben', en: 'Released' }, type: 'count' },
		{ id: 'started', label: { de: 'Bearbeitet', en: 'Started' }, type: 'count' },
		{ id: 'shared', label: { de: 'Mit der Beratung geteilt', en: 'Shared with counselling' }, type: 'count' }
	],
	apps: [
		{
			id: 'goals',
			title: { de: 'Ausgangssituation und Ziele', en: 'Starting point and goals' },
			slots: ['asker.navigation', 'consultant.session', 'consultant.asker-profile'],
			visibility: 'dynamic'
		}
	],
	health: '/health'
};

export const settingsSchema = {
	type: 'object',
	properties: {
		intro: {
			type: 'string',
			title: 'Einleitung für Ratsuchende',
			description: 'Steht über den Fragen. Leer lassen für den Standardtext.',
			maxLength: 600,
			format: 'textarea',
			default: ''
		},
		allowSharing: {
			type: 'boolean',
			title: 'Ratsuchende können ihre Antworten mit der Beratung teilen',
			default: true
		}
	}
};
