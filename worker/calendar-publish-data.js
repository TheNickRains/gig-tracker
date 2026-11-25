const { createHash } = require('node:crypto');

const CONFIRMED_COLORS = new Set(['2', '10']); // Google Calendar Sage and Basil.
const PUBLIC_FIELDS = ['show type', 'publish', 'doors', 'door time', 'show time', 'ticket price', 'ticket url', 'public notes', 'venue', 'city', 'region', 'country', 'timezone', 'time zone'];

function publicNotes(description) {
  const result = {};
  const lines = (description || '').replace(/<br\s*\/?\s*>|<\/div>|<\/p>/gi, '\n')
    .replace(/<[^>]*>/g, '').replace(/&nbsp;|&#160;/gi, ' ').replace(/&amp;/gi, '&').split(/\r?\n/);
  for (const line of lines) {
    const match = line.match(/^\s*([\w ]+):\s*(.*)$/);
    if (match && PUBLIC_FIELDS.includes(match[1].trim().toLowerCase())) {
      result[match[1].trim().toLowerCase()] = match[2].trim().slice(0, 800);
    }
  }
  return result;
}

function clock(value) {
  const normalized = value?.trim().replace(/([ap])\s*\.\s*m\.?/gi, '$1m');
  const parts = (normalized || '').split(/\s*(?:[–—-]|\bto\b)\s*/i);
  if (parts.length > 2 || (parts.length === 2 && !clock(parts[1]))) return null;
  const match = parts[0].match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/i);
  if (!match) return null;
  let hour = Number(match[1]);
  const minutes = Number(match[2] || '0');
  if (match[3]) {
    if (hour < 1 || hour > 12) return null;
    hour = hour % 12 + (match[3].toLowerCase() === 'pm' ? 12 : 0);
  } else if (!match[2] || hour > 23) return null;
  if (minutes > 59) return null;
  return [hour, minutes].map(n => String(n).padStart(2, '0')).join(':');
}

function localParts(timestamp, zone) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(timestamp).map(part => [part.type, part.value]));
  return { date: [parts.year, parts.month, parts.day].join('-'), time: parts.hour + ':' + parts.minute };
}

function addressFromLocation(location, notes) {
  const parts = (location || '').split(',').map(s => s.trim()).filter(Boolean);
  const venue = /^\d/.test(parts[0] || '') ? '' : parts.shift() || '';
  const last = parts.at(-1) || '';
  const country = notes.country || (/^(US|USA|United States)$/i.test(last) ? 'US' : /^(CA|Canada)$/i.test(last) ? 'CA' : '');
  if (country && /^(US|USA|United States|CA|Canada)$/i.test(last)) parts.pop();
  const region = (parts.at(-1) || '').match(/^([A-Z]{2})(?:\s+([\w -]+))?$/);
  if (region) parts.pop();
  const parsedCity = parts.length >= 2 ? parts.pop() : '';
  const city = notes.city || parsedCity;
  return {
    venue: notes.venue || venue, address: parts.join(', '), city,
    region: notes.region || region?.[1] || '', postcode: region?.[2] || '',
    country: country || (/^\d{5}(-\d{4})?$/.test(region?.[2] || '') ? 'US' : ''),
  };
}

function publicUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password ? url.href : '';
  } catch { return ''; }
}

function desired(event, operation, listing = null, issue = null) {
  const fingerprint = createHash('sha256').update(JSON.stringify([operation, listing, issue])).digest('hex');
  return {
    event_id: event.id, series_id: event.recurringEventId || null, operation, listing, issue, fingerprint,
    calendar_link: event.htmlLink?.startsWith('https://www.google.com/calendar/') ? event.htmlLink : null,
  };
}

async function projectEvent(event, options) {
  if (event.status === 'cancelled') return desired(event, 'remove');
  if (!event.start?.dateTime) return desired(event, 'remove');
  if (!Number.isFinite(Date.parse(event.start.dateTime)) || Date.parse(event.start.dateTime) <= options.now) return desired(event, 'ignore');
  const notes = publicNotes(event.description);
  if (event.eventType && event.eventType !== 'default') return desired(event, 'remove');
  if (['private', 'confidential'].includes(event.visibility)) return desired(event, 'remove');

  const summary = (event.summary || '').trim();
  const kind = summary.match(/^(Original|Cover|Busking):\s*/i);
  const title = summary.slice(kind?.[0].length || 0)
    .replace(/^(?:Gig:\s*|[$]{2,}\s+)/i, '').replace(/\s*\(Gig Collective\)\s*$/i, '').trim();
  const type = (notes['show type'] || kind?.[1] || '').toLowerCase();
  const isHeld = event.status === 'tentative' || /\b(HOLD|PRIVATE)\b/i.test(summary) || /^no$/i.test(notes.publish || '');
  if (isHeld || !CONFIRMED_COLORS.has(String(event.colorId))) {
    const showAt = new Date(event.start.dateTime);
    const timeZone = event.start.timeZone || options.timeZone || 'UTC';
    let times;
    try { times = localParts(showAt, timeZone); }
    catch { times = localParts(showAt, 'UTC'); }
    return desired(event, 'remove', {
      title, type, ...times, showAt: showAt.toISOString(),
      exclusion: isHeld ? 'Held, tentative, or marked private in Calendar'
        : String(event.colorId) === '8' ? 'Gray on Calendar' : 'Set the Calendar event color to Sage or Basil',
    });
  }
  let venue = addressFromLocation(event.location, notes);
  let issue = notes['show type'] && !['original', 'cover', 'busking'].includes(type) ? 'Choose Original, Cover, or Busking in Calendar.' : null;
  if (options.resolveVenue && (!venue.address || !venue.city || !venue.country || !venue.venue)) {
    const match = await options.resolveVenue(event.location || [notes.venue, notes.city, notes.region].filter(Boolean).join(', '));
    if (match) venue = { ...match, ...Object.fromEntries(Object.entries(venue).filter(([, value]) => value)) };
  }
  if (!venue.venue || !venue.city || !venue.country || (/^(US|CA)$/i.test(venue.country) && !venue.region)) {
    issue ||= 'Add the venue, city, region, and country to the Calendar location.';
  }

  const timeZone = notes.timezone || notes['time zone'] || venue.timeZone || event.start.timeZone || options.timeZone;
  const calendarStart = Date.parse(event.start.dateTime);
  let times;
  try { times = localParts(calendarStart, timeZone); }
  catch { issue ||= 'Confirm the venue time zone in Calendar.'; }
  if (!timeZone) issue ||= 'Confirm the venue time zone in Calendar.';
  const doors = clock(notes.doors || notes['door time']);
  const publicTime = clock(notes['show time']);
  let showAt = calendarStart;
  if (times && publicTime && publicTime !== times.time) {
    const minutes = time => Number(time.slice(0, 2)) * 60 + Number(time.slice(3));
    showAt += (minutes(publicTime) - minutes(times.time)) * 60000;
    const explicit = localParts(showAt, timeZone);
    if (explicit.date !== times.date || explicit.time !== publicTime || showAt <= options.now) {
      issue ||= 'Check the advertised show time against the Calendar start.';
    }
  }
  if (notes['show time'] && !publicTime) issue ||= 'Check the Show time note in Calendar. Use a time like 8:00 PM, or remove the note to use the Calendar start.';
  const ticketUrl = publicUrl(notes['ticket url']);
  const listing = {
    title: title || venue.venue, type, ...venue, timeZone: timeZone || null, date: times?.date,
    time: publicTime || times?.time, showAt: Number.isFinite(showAt) ? new Date(showAt).toISOString() : null,
    doors, ticketPrice: type === 'busking' ? 'Free' : notes['ticket price'] || '',
    ticketUrl: type === 'busking' ? '' : ticketUrl, description: notes['public notes'] || '', validationIssue: !!issue,
  };
  return desired(event, 'upsert', listing, issue);
}

function recurrenceEnd(event, now) {
  const rules = (event.recurrence || []).filter(line => /^RRULE:/i.test(line));
  if (rules.some(line => !/(?:[:;])(?:COUNT|UNTIL)=/i.test(line))) {
    const limit = new Date(now);
    limit.setUTCFullYear(limit.getUTCFullYear() + 1);
    return limit.toISOString();
  }
  return null;
}

module.exports = { desired, projectEvent, recurrenceEnd };
