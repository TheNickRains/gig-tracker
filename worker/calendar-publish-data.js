const { createHash } = require('node:crypto');

const CONFIRMED_COLORS = new Set(['2', '10']); // Google Calendar Sage and Basil.
const HOUR = 3600000;
const CLOCK_ZONES = {
  ET: 'America/New_York', EST: 'America/New_York', EDT: 'America/New_York',
  CT: 'America/Chicago', CST: 'America/Chicago', CDT: 'America/Chicago',
  MT: 'America/Denver', MST: 'America/Denver', MDT: 'America/Denver',
  PT: 'America/Los_Angeles', PST: 'America/Los_Angeles', PDT: 'America/Los_Angeles',
  UTC: 'UTC', GMT: 'UTC',
};
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
  const match = value?.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\s*([a-z]{2,3})?$/i);
  if (!match) return null;
  const zone = match[4]?.toUpperCase();
  if (zone && !Object.hasOwn(CLOCK_ZONES, zone)) return null;
  let hour = Number(match[1]);
  const minutes = Number(match[2] || '0');
  if (match[3]) {
    if (hour < 1 || hour > 12) return null;
    hour = hour % 12 + (match[3].toLowerCase() === 'pm' ? 12 : 0);
  } else if (!match[2] || hour > 23) return null;
  if (minutes > 59) return null;
  const time = [hour, minutes].map(n => String(n).padStart(2, '0')).join(':');
  return { time, zone };
}

function clockRange(value) {
  const normalized = value?.trim().replace(/([ap])\s*\.\s*m\.?/gi, '$1m');
  const parts = (normalized || '').split(/\s*(?:[–—-]|\bto\b)\s*/i);
  const start = clock(parts[0]);
  if (!start || parts.length > 2) return null;
  if (parts.length === 1) return start;
  const end = clock(parts[1]);
  if (!end || (start.zone && end.zone && CLOCK_ZONES[start.zone] !== CLOCK_ZONES[end.zone])) return null;
  return { time: start.time, zone: start.zone || end.zone };
}

function localParts(timestamp, zone) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZoneName: 'short',
  }).formatToParts(timestamp).map(part => [part.type, part.value]));
  return {
    date: [parts.year, parts.month, parts.day].join('-'),
    time: parts.hour + ':' + parts.minute,
    zone: parts.timeZoneName,
  };
}

function matchesClockZone(written, actual) {
  if (!written) return true;
  if (written === 'UTC' || written === 'GMT') return actual === 'UTC' || actual === 'GMT';
  if (written.length === 2) return actual === written[0] + 'ST' || actual === written[0] + 'DT';
  return written === actual;
}

function showInstants(date, clock, timeZone) {
  const wall = Date.parse(date + 'T' + clock.time + ':00Z');
  // Sample on both sides of the day so a DST fold can produce two candidates.
  const offsets = new Set([-24, 24].map(hours => {
    const sample = wall + hours * HOUR;
    const local = localParts(sample, timeZone);
    return Date.parse(local.date + 'T' + local.time + ':00Z') - sample;
  }));
  return [...offsets].map(offset => wall - offset).filter(instant => {
    const local = localParts(instant, timeZone);
    return local.date === date && local.time === clock.time && matchesClockZone(clock.zone, local.zone);
  });
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

function quotedNote(field, value) {
  return '“' + field + ': ' + value.slice(0, 96) + (value.length > 96 ? '…' : '') + '”';
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
      title, type, date: times.date, time: times.time, showAt: showAt.toISOString(),
      exclusion: isHeld ? 'Held, tentative, or marked private in Calendar'
        : String(event.colorId) === '8' ? 'Gray on Calendar' : 'Set the Calendar event color to Sage or Basil',
    });
  }
  let venue = addressFromLocation(event.location, notes);
  const issues = [];
  if (notes['show type'] && !['original', 'cover', 'busking'].includes(type)) {
    issues.push('In the Calendar description, replace ' + quotedNote('Show type', notes['show type']) +
      ' with “Show type: Original”, “Show type: Cover”, or “Show type: Busking”.');
  }
  const doorNote = notes.doors || notes['door time'];
  const showNote = notes['show time'];
  const doors = clockRange(doorNote);
  const advertised = clockRange(showNote);
  const needsVenueZone = (advertised || doors) && !(notes.timezone || notes['time zone'] || advertised?.zone || doors?.zone);
  if (options.resolveVenue && (needsVenueZone || !venue.address || !venue.city || !venue.country || !venue.venue)) {
    const match = await options.resolveVenue(event.location || [notes.venue, notes.city, notes.region].filter(Boolean).join(', '));
    if (match) venue = { ...match, ...Object.fromEntries(Object.entries(venue).filter(([, value]) => value)) };
  }
  const missing = [
    !venue.venue && 'venue name', !venue.city && 'city',
    /^(US|CA)$/i.test(venue.country) && !venue.region && 'state or province', !venue.country && 'country',
  ].filter(Boolean);
  if (missing.length) {
    issues.push('In Calendar → Location, add the missing ' + missing.join(', ') +
      '. Use the venue’s full location, including its name and address.');
  }

  const timeZone = notes.timezone || notes['time zone'] || venue.timeZone ||
    CLOCK_ZONES[advertised?.zone] || CLOCK_ZONES[doors?.zone] || event.start.timeZone || options.timeZone;
  const calendarStart = Date.parse(event.start.dateTime);
  let times;
  let showAt = calendarStart;
  try {
    if (!timeZone) throw new RangeError('Calendar start has no time zone');
    times = localParts(calendarStart, timeZone);
    if (advertised) {
      const candidates = showInstants(times.date, advertised, timeZone);
      const candidate = candidates.length === 1 ? candidates[0] :
        candidates.find(instant => instant === Math.floor(calendarStart / 60000) * 60000);
      if (candidate == null) {
        const note = quotedNote('Show time', showNote);
        if (candidates.length > 1) {
          const zones = candidates.map(instant => localParts(instant, timeZone).zone);
          issues.push('In the Calendar description, add ' + zones.join(' or ') + ' to ' + note +
            ' to specify which occurrence of that time to use.');
        } else {
          issues.push('In the Calendar description, replace ' + note +
            ' with a valid local time on ' + times.date + ' in ' + timeZone + '.');
        }
      } else if (candidate <= options.now) {
        issues.push('In Calendar, update the event date or ' + quotedNote('Show time', showNote) +
          ' to the upcoming show date and time.');
      } else {
        showAt = candidate;
        times = localParts(showAt, timeZone);
      }
    }
    if (doors?.zone && !showInstants(times.date, doors, timeZone).length) {
      issues.push('In the Calendar description, change ' + quotedNote('Doors', doorNote) +
        ' to the venue-local doors time in ' + timeZone + '.');
    }
  } catch {
    issues.push('In Calendar, edit the event’s time zone to match the venue. If the description has a “Time zone:” line, correct it to a name like “America/New_York”.');
  }
  if (showNote && !advertised) {
    const startHint = times ? ' (' + times.time + ' ' + times.zone + ')' : '';
    issues.push('In the Calendar description, replace ' + quotedNote('Show time', showNote) +
      ' with the advertised time, using a format like “Show time: 8:00 PM”. Delete that line to use the Calendar start' + startHint + '.');
  }
  if (doorNote && !doors) {
    issues.push('In the Calendar description, replace ' + quotedNote('Doors', doorNote) +
      ' with a time like “Doors: 7:00 PM”, or delete the line to omit doors from the listing.');
  }
  const issue = issues.length ? issues.join('\n') : null;
  const ticketUrl = publicUrl(notes['ticket url']);
  const listing = {
    title: title || venue.venue, type, ...venue, timeZone: timeZone || null, date: times?.date,
    time: times?.time, showAt: new Date(showAt).toISOString(),
    doors: doors?.time || null, ticketPrice: type === 'busking' ? 'Free' : notes['ticket price'] || '',
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
