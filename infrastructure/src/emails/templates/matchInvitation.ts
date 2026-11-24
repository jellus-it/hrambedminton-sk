import ical, { ICalCalendarMethod } from 'ical-generator';
import { Email, escapeHtml } from '../sendEmail';

export interface MatchInvitationData {
  playerName: string;
  match: {
    id: string;
    name: string;
    description: string;
    place: string;
    court: string;
    startsAt: string;
    timeZone: string;
    duration: number;
  };
  matchUrl: string;
}

/**
 * Email sent to a player (the creator or an invited player) when they are added to a match,
 * with a calendar invitation (.ics) attached.
 */
export function matchInvitation({ playerName, match, matchUrl }: MatchInvitationData): Email {
  const start = new Date(match.startsAt);
  const end = new Date(start.getTime() + match.duration * 60 * 1000);
  const when = new Intl.DateTimeFormat('sk-SK', {
    dateStyle: 'full',
    timeStyle: 'short',
    timeZone: match.timeZone,
  }).format(start);
  const location = `${match.place}, kurt ${match.court}`;

  const calendar = ical({ prodId: '//hrambedminton.sk//Zapasy//SK', method: ICalCalendarMethod.PUBLISH });
  calendar.createEvent({
    // Stable ID, so a later update or cancellation of this match replaces the same calendar entry
    id: `event-${match.id}@hrambedminton.sk`,
    start,
    end,
    summary: match.name,
    description: match.description ? `${match.description}\n\n${matchUrl}` : matchUrl,
    location,
    url: matchUrl,
  });

  const text = [
    `Ahoj ${playerName},`,
    '',
    `bol si pridaný do zápasu ${match.name}.`,
    '',
    `Kedy: ${when} (${match.duration} min)`,
    `Kde: ${location}`,
    ...(match.description ? [`Popis: ${match.description}`] : []),
    '',
    `Zápas: ${matchUrl}`,
    '',
    'Pozvánku do kalendára nájdeš v prílohe.',
  ].join('\n');

  const html = `
    <p>Ahoj ${escapeHtml(playerName)},</p>
    <p>bol si pridaný do zápasu <strong>${escapeHtml(match.name)}</strong>.</p>
    <p>
      <strong>Kedy:</strong> ${escapeHtml(when)} (${match.duration} min)<br>
      <strong>Kde:</strong> ${escapeHtml(location)}
      ${match.description ? `<br><strong>Popis:</strong> ${escapeHtml(match.description)}` : ''}
    </p>
    <p><a href="${escapeHtml(matchUrl)}">Zobraziť zápas</a></p>
    <p>Pozvánku do kalendára nájdeš v prílohe.</p>
  `;

  return {
    subject: `Pozvánka na zápas: ${match.name}`,
    html,
    text,
    attachments: [
      { fileName: 'zapas.ics', contentType: 'text/calendar; method=PUBLISH', content: calendar.toString() },
    ],
  };
}
