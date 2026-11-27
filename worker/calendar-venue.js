const { numberedStreet } = require('./bandsintown-event-form');

function words(value) {
  return String(value || '').normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase()
    .replace(/&/g, ' and ').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

function addressFromLocation(location, notes) {
  const parts = (location || '').split(/[,\n]+/).map(s => s.trim()).filter(Boolean);
  const first = parts[0] || '';
  // Numeric venue names also occur in Calendar, e.g. "54 Below, 254 W 54th St".
  const venue = !/^\d/.test(first) || numberedStreet(parts[1]) ? parts.shift() || '' : '';
  const last = parts.at(-1) || '';
  const canadian = /^Canada$/i.test(last) || (last === 'CA' && /^(?:AB|BC|MB|NB|NL|NS|NT|NU|ON|PE|QC|SK|YT)(?:\s|$)/.test(parts.at(-2) || ''));
  const suffix = /^(US|USA|United States)$/i.test(last) ? 'US' : canadian ? 'CA' : '';
  if (suffix) parts.pop();
  const region = (parts.at(-1) || '').match(/^([A-Z]{2})(?:\s+([\w -]+))?$/);
  if (region) parts.pop();
  const loneLocality = parts.length === 1 && !/\d|\b(?:st(?:reet)?|ave(?:nue)?|r(?:oa)?d|lane|blvd|boulevard|drive|highway)\.?$/i.test(parts[0]) &&
    (!notes.city || words(parts[0]) === words(notes.city));
  const city = parts.length >= 2 || loneLocality
    ? parts.pop() : '';
  const country = notes.country || suffix;
  return {
    venue: notes.venue || venue, address: parts.join(', '), city: notes.city || city || '',
    region: notes.region || region?.[1] || '', postcode: region?.[2] || '',
    country: /^(US|USA|United States)$/i.test(country) ? 'US' : /^(CA|Canada)$/i.test(country) ? 'CA'
      : country || (/^\d{5}(-\d{4})?$/.test(region?.[2] || '') ? 'US' : ''),
  };
}

function matchingPlace(place, expected, name) {
  const part = kind => place.addressComponents?.find(item => item.types?.includes(kind));
  const city = part('locality') || part('postal_town');
  const region = part('administrative_area_level_1'), country = part('country');
  const venue = place.displayName?.text;
  const venueName = words(venue), inputName = words(name), cityName = words(city?.longText);
  if (!inputName || !venueName || !(inputName === venueName ||
      inputName + ' ' + cityName === venueName || venueName + ' ' + cityName === inputName)) return null;
  // Text Search returns street addresses and other geographic features as well as businesses.
  const geographic = /^(?:geocode|street_address|route|intersection|premise|subpremise|plus_code|country|locality|neighborhood|political|sublocality.*|postal_.*|administrative_area_level_\d+)$/;
  if (![place.primaryType, ...(place.types || [])].some(type => type && !geographic.test(type))) return null;
  for (const [provided, component] of [[expected.city, city], [expected.region, region], [expected.country, country]]) {
    if (provided && ![component?.longText, component?.shortText].some(value => words(value) === words(provided))) return null;
  }
  const address = place.postalAddress?.addressLines?.join(', ') ||
    [part('street_number')?.longText, part('route')?.shortText || part('route')?.longText].filter(Boolean).join(' ');
  const postcode = part('postal_code')?.longText || '';
  const postalKey = value => country?.shortText === 'US' ? value.slice(0, 5) : words(value).replaceAll(' ', '');
  if (expected.postcode && postcode && postalKey(expected.postcode) !== postalKey(postcode)) return null;
  if (expected.address && (numberedStreet(expected.address) || words(expected.address)) !== (numberedStreet(address) || words(address))) return null;
  return {
    venue, address, city: city?.longText || '', region: region?.shortText || '',
    country: country?.shortText || '', postcode, timeZone: place.timeZone?.id,
  };
}

async function resolveShowVenue(expected, title, apiKey, request = fetch) {
  const name = expected.venue || title;
  if (!apiKey || !name || !(expected.venue || expected.address || expected.city)) return null;
  const textQuery = [name, expected.address, expected.city, expected.region, expected.postcode, expected.country].filter(Boolean).join(', ');
  const response = await request('https://places.googleapis.com/v1/places:searchText', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json', 'X-Goog-Api-Key': apiKey,
      'X-Goog-FieldMask': 'places.displayName,places.types,places.primaryType,places.postalAddress,places.addressComponents,places.location,places.timeZone',
    },
    body: JSON.stringify({ textQuery, pageSize: 3 }),
    signal: AbortSignal.timeout(12000),
  });
  if (!response.ok) return null;
  const { places = [] } = await response.json();
  const candidates = places.map(place => ({ place, venue: matchingPlace(place, expected, name) })).filter(match => match.venue);
  if (candidates.length !== 1) return null;
  const { place, venue } = candidates[0];
  if (!venue.timeZone && place.location) {
    const query = new URLSearchParams({
      location: place.location.latitude + ',' + place.location.longitude,
      timestamp: String(Math.floor(Date.now() / 1000)), key: apiKey,
    });
    const zone = await request('https://maps.googleapis.com/maps/api/timezone/json?' + query, { signal: AbortSignal.timeout(12000) }).catch(() => null);
    if (zone?.ok) venue.timeZone = (await zone.json()).timeZoneId;
  }
  return venue;
}

module.exports = { addressFromLocation, resolveShowVenue };
