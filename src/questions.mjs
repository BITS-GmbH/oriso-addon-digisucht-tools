// Placeholder wording until delphi provides the texts of the current DigiSucht tool.
export const QUESTIONS = [
	{
		id: 'situation',
		formal: 'Wie würden Sie Ihre aktuelle Situation beschreiben?',
		informal: 'Wie würdest du deine aktuelle Situation beschreiben?'
	},
	{
		id: 'burden',
		formal: 'Was belastet Sie im Moment am meisten?',
		informal: 'Was belastet dich im Moment am meisten?'
	},
	{
		id: 'reason',
		formal: 'Was hat Sie dazu bewegt, sich jetzt Unterstützung zu holen?',
		informal: 'Was hat dich dazu bewegt, dir jetzt Unterstützung zu holen?'
	},
	{
		id: 'goal',
		formal: 'Was möchten Sie mit der Beratung erreichen?',
		informal: 'Was möchtest du mit der Beratung erreichen?'
	},
	{
		id: 'change',
		formal: 'Woran würden Sie merken, dass sich etwas verändert hat?',
		informal: 'Woran würdest du merken, dass sich etwas verändert hat?'
	}
];

export const QUESTION_IDS = QUESTIONS.map((question) => question.id);

export const MAX_ANSWER_LENGTH = 4000;
