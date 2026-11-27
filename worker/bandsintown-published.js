const { numberedStreet, venueMatchesListing } = require('./bandsintown-event-form');

const ARTIST_ID = '3251702';
const ENDPOINT = 'https://rest.bandsintown.com/V3.1/artists/id_' + ARTIST_ID + '/events/';
const WIDGET_APP_ID = 'js_nickrainsmusic.com';
const unavailable = () => ({ status: 'unavailable', issue: 'Bandsintown’s public event list could not be verified.' });

function words(value) {
  return String(value || '').normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase()
    .replace(/[’']/g, '').replace(/&/g, ' and ').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

function country(value) {
  const code = String(value || '').toUpperCase();
  if (code === 'USA') return 'united states';
  return /^[A-Z]{2}$/.test(code) ? words(new Intl.DisplayNames('en', { type: 'region' }).of(code)) : words(value);
}

function localStart(event, timeZone) {
  const value = event.starts_at || event.datetime;
  const match = typeof value === 'string' && value.match(/^(\d{4}-\d{2}-\d{2})[T ]([01]\d|2[0-3]):([0-5]\d)(?::[0-5]\d(?:\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?$/i);
  if (!match) return null;
  if (!match[4]) return match[1] + 'T' + match[2] + ':' + match[3];
  if (!timeZone || !Number.isFinite(Date.parse(value))) return null;
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone, hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  }).formatToParts(new Date(value)).map(({ type, value }) => [type, value]));
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}

function hasExpectedPlace(event, listing) {
  const venue = event.venue;
  const address = numberedStreet(listing.address);
  if (!address || address !== numberedStreet(venue.street_address) || words(venue.city) !== words(listing.city)) return false;
  if (listing.region && venue.region && words(listing.region) !== words(venue.region)) return false;
  if (listing.country && venue.country && country(listing.country) !== country(venue.country)) return false;
  const name = words(venue.name);
  const normalized = { ...listing, venue: words(listing.venue), city: words(listing.city), address };
  if (venueMatchesListing(name, [address, normalized.city].join(', '), normalized)) return true;
  // In Event Name display mode the public API puts the custom title in both fields.
  return Boolean(event.title && name === words(event.title) && name === words(listing.title));
}

function missingDetails(event, listing) {
  const different = [];
  const title = words(listing.title);
  const publicTitle = words(event.title);
  const display = publicTitle || words(event.venue.name);
  const city = words(listing.city);
  // When the venue is displayed as the name, Bandsintown can append the city.
  const venueTitle = !publicTitle && (display === title + ' ' + city || title === display + ' ' + city);
  if (title && display !== title && !venueTitle) different.push('event name');
  if (listing.description && String(event.description || '').trim() !== listing.description.trim()) different.push('description');
  if (listing.ticketUrl && !event.offers?.some(offer => offer?.url === listing.ticketUrl)) different.push('ticket link');
  if (listing.ticketPrice && !(words(listing.ticketPrice) === 'free' && event.free === true)) different.push('ticket price');
  if (listing.doors && localStart({ datetime: event.doors_at }, listing.timeZone)?.slice(11) !== listing.doors) different.push('doors time');
  return different;
}

function matchPublishedEvents(events, listing, expectedId) {
  if (!Array.isArray(events) || !listing || !/^\d{4}-\d{2}-\d{2}$/.test(listing.date) ||
      !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(listing.time) || !listing.venue || !listing.city) return unavailable();
  const start = listing.date + 'T' + listing.time;
  const street = numberedStreet(listing.address);
  const candidates = new Map();
  let changedIdentity = false;
  for (const event of events) {
    if (!event?.venue || String(event.artist_id || event.artist?.id) !== ARTIST_ID ||
        (event.artist?.id && String(event.artist.id) !== ARTIST_ID) || !/^\d{1,30}$/.test(event.id)) return unavailable();
    const id = String(event.id);
    const time = localStart(event, listing.timeZone);
    if (!time) return unavailable();
    const active = !event.cancelled && !event.canceled && (!event.status || /^(?:auto)?published$/i.test(event.status));
    if (id === expectedId && !active) return { status: 'conflict', issue: 'The stored Bandsintown listing is inactive.' };
    const sameCity = words(event.venue.city) === words(listing.city);
    if (time !== start || !sameCity) {
      if (time === start && (!event.venue.city || (street && numberedStreet(event.venue.street_address) === street &&
          words(event.venue.name) === words(listing.venue)))) {
        return { status: 'conflict', issue: 'Check the Bandsintown listing at this start time. Its city could not be confirmed.' };
      }
      if (id === expectedId) changedIdentity = true;
      continue;
    }
    const samePlace = hasExpectedPlace(event, listing);
    if (id === expectedId && !samePlace) {
      changedIdentity = true;
      continue;
    }
    if (!samePlace || (expectedId && id !== expectedId) || !active) {
      return { status: 'conflict', issue: 'Bandsintown has a listing for this artist, city, and start time with conflicting details.' };
    }
    candidates.set(id, event);
  }
  if (changedIdentity) return { status: 'needs-update', id: expectedId, issue: 'The stored Bandsintown listing has a different time or location.' };
  if (!candidates.size) return { status: 'missing' };
  if (candidates.size > 1) return { status: 'conflict', issue: 'Bandsintown has multiple listings for this show.' };
  const [[id, event]] = candidates;
  const different = missingDetails(event, listing);
  return different.length ? { status: 'needs-update', id, issue: 'Verify the ' + different.join(', ') + ' on the existing listing.' } : { status: 'matched', id };
}

async function lookupPublishedEvent(listing, { fetch: request = fetch, signal, appId = WIDGET_APP_ID, expectedId } = {}) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(listing?.date)) return unavailable();
  const url = new URL(ENDPOINT);
  url.searchParams.set('app_id', appId);
  url.searchParams.set('date', listing.date + ',' + listing.date);
  const timeout = AbortSignal.timeout(8000);
  try {
    const response = await request(url, { signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
      headers: { Accept: 'application/json' }, cache: 'no-store', redirect: 'error' });
    if (!response.ok) return unavailable();
    return matchPublishedEvents(await response.json(), listing, expectedId && String(expectedId));
  } catch {
    return unavailable();
  }
}

module.exports = { lookupPublishedEvent, matchPublishedEvents };
