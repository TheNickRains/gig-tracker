const FORM_PATH = /^\/artists\/3251702\/events?\/new(?:\/add-location)?\/?$/;
const VENUE_GROUP = 'xpath=ancestor::div[div[ul and aside]][1]';
const TIMEOUT = { timeout: 3500 };

function words(text) {
  return String(text || '').normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

const STREET_NUMBER = /^\s*\d+[a-z]?(?:-\d+[a-z]?)?\s+\S/i;

function numberedStreet(text) {
  // Calendar and venue suggestions can include the building name before the street.
  const part = String(text || '').split(/[,\n]+/).find(value => STREET_NUMBER.test(value));
  return words(part).replace(/\bstreet\b/g, 'st').replace(/\bavenue\b/g, 'ave')
    .replace(/\broad\b/g, 'rd').replace(/\bboulevard\b/g, 'blvd').replace(/\bdrive\b/g, 'dr').replace(/\blane\b/g, 'ln');
}

function venueMatchesListing(name, location, listing) {
  const city = words(listing.city);
  const venue = words(listing.venue);
  const address = numberedStreet(listing.address);
  const parts = location.split(/[,\n]+/).map(words).filter(Boolean);
  if (!city || !venue || !parts.some(part => part === city || part.startsWith(city + ' '))) return false;
  const optionStreet = numberedStreet(location);
  const sameStreet = Boolean(address && address === optionStreet);
  if (optionStreet && listing.address && !sameStreet) return false;
  const region = (location.match(/,\s*([A-Z]{2})(?=\s*[,\d]|\s*$)/) || [])[1];
  if (region && listing.region && region !== listing.region && region !== listing.country) return false;
  const place = words(name);
  return place === venue || Boolean(sameStreet && (place + ' ' + city === venue || venue + ' ' + city === place));
}

function splitVenue(value) {
  const [name, ...rest] = value.split(/\s+[-–—]\s+|,\s*/);
  return [name, rest.join(', ')];
}

async function setDate(page, listing, state, guard, stage) {
  stage('reading the start date');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(listing.date || '')) return;
  let field = page.locator('input#eventStartDateField:visible, input[name="start_date"]:visible');
  if (await field.count() !== 1) {
    field = page.getByRole('textbox', { name: /^start date\s*\*?$/i });
  }
  if (await field.count() !== 1 || !await field.isVisible()) return;
  const desired = new Date(listing.date + 'T12:00:00Z');
  if (Number.isNaN(+desired) || desired.toISOString().slice(0, 10) !== listing.date) return;
  const [year, month, dayOfMonth] = listing.date.split('-');
  const placeholder = await field.getAttribute('placeholder', TIMEOUT) || '';
  const dayFirst = /d+\s*\/\s*m+/i.test(placeholder);
  const [first, second] = dayFirst ? [dayOfMonth, month] : [month, dayOfMonth];
  const slashDate = [first, second, year].join('/');
  const formats = new Set([listing.date, slashDate, [Number(first), Number(second), year].join('/'), ...['short', 'long'].map(month => new Intl.DateTimeFormat('en-US', {
    year: 'numeric', month, day: 'numeric', timeZone: 'UTC',
  }).format(desired))]);
  const read = async () => {
    state.date = (await field.inputValue(TIMEOUT)).trim();
    state.dateMatches = formats.has(state.date) && await field.getAttribute('aria-invalid', TIMEOUT) !== 'true';
  };
  await read();
  if (state.dateMatches || !await field.isEnabled(TIMEOUT)) return;
  await guard();
  stage('entering the start date');
  const native = await field.getAttribute('type', TIMEOUT) === 'date';
  if (native || await field.isEditable(TIMEOUT)) {
    const slashFormat = /[dm]+\s*\/\s*[dm]+/i.test(placeholder) || /^\d{1,2}\/\d{1,2}\/\d{4}$/.test(state.date);
    await field.fill(native || !slashFormat ? listing.date : slashDate, TIMEOUT);
    await field.blur(TIMEOUT);
    await read();
    if (state.dateMatches || native) return;
  }
  stage('opening the start date picker');
  const group = field.locator('xpath=ancestor::div[.//*[contains(concat(" ", normalize-space(@class), " "), " date-content ")]][1]');
  const picker = group.locator('.date-content');
  if (await picker.count() !== 1) return;
  if (!await picker.isVisible()) await group.getByRole('button', { name: 'Toggle picker', exact: true }).click(TIMEOUT);
  const monthButton = picker.locator('button.month');
  await monthButton.waitFor({ state: 'visible', ...TIMEOUT });
  const monthFormat = new Intl.DateTimeFormat('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' });
  const expectedMonth = monthFormat.format(desired);
  const currentMonth = (await monthButton.innerText(TIMEOUT)).trim();
  if (currentMonth !== expectedMonth) {
    stage('selecting the start month in the calendar');
    const months = Array.from({ length: 12 }, (_, i) => monthFormat.format(new Date(Date.UTC(2000, i, 1))).split(' ')[0]);
    const [label, currentYear] = currentMonth.split(/\s+/);
    const monthIndex = months.indexOf(label);
    if (monthIndex < 0 || !/^\d{4}$/.test(currentYear)) return;
    const offset = (desired.getUTCFullYear() - Number(currentYear)) * 12 + desired.getUTCMonth() - monthIndex;
    // The standard Add Event calendar accepts dates up to two years ahead.
    if (Math.abs(offset) > 24) return;
    const arrow = monthButton.locator(offset > 0 ? 'xpath=following-sibling::button[1]' : 'xpath=preceding-sibling::button[1]');
    for (let i = 1; i <= Math.abs(offset); i++) {
      await guard();
      await arrow.click(TIMEOUT);
      const label = monthFormat.format(new Date(Date.UTC(Number(currentYear), monthIndex + i * Math.sign(offset), 1)));
      await monthButton.filter({ hasText: label }).waitFor({ state: 'visible', ...TIMEOUT });
    }
  }
  stage('selecting the day on the start date picker');
  const day = picker.getByRole('button', { name: String(desired.getUTCDate()), exact: true });
  if (await day.count() !== 1 || !await day.isEnabled(TIMEOUT)) return;
  await guard();
  await day.click(TIMEOUT);
  await read();
}

async function choosePlace(page, listing, state, guard, stage) {
  stage('reading the selected venue');
  const field = page.locator('input#venueField[name="venue_name"]');
  if (await field.count() !== 1 || !await field.isVisible()) return;
  const group = field.locator(VENUE_GROUP);
  if (await group.count() !== 1) return;
  const clear = group.locator('button[aria-label="Clear value"]');
  const read = async () => {
    state.venue = (await field.inputValue(TIMEOUT)).trim().slice(0, 240);
    const [name, location] = splitVenue(state.venue);
    state.venueMatches = await clear.isVisible() && venueMatchesListing(name, location, listing);
  };
  await read();
  if (await clear.isVisible() || !await field.isEnabled(TIMEOUT) || !listing.venue || !listing.city) return;
  const custom = group.locator('aside button');
  const rows = group.locator('ul > li > button');
  let matches = [];
  // The short name can return places in other cities. Try the booking city
  // before using Bandsintown's custom-location form.
  for (const term of [listing.venue, listing.venue + ', ' + listing.city]) {
    stage('searching venue suggestions');
    await guard();
    if (await field.inputValue(TIMEOUT) !== term || !await custom.isVisible()) {
      // Close results from the previous query. The dashboard otherwise keeps
      // those rows visible while it debounces a new search for one second.
      await field.fill('', TIMEOUT);
      await custom.waitFor({ state: 'hidden', ...TIMEOUT });
      await field.fill(term, TIMEOUT);
    }
    await custom.waitFor({ state: 'visible', timeout: 6500 }).catch(() => {});
    if (!await custom.isVisible()) return;
    const options = await rows.evaluateAll(buttons => buttons.map(button => ({
      name: button.querySelector('.name span')?.textContent || '',
      address: button.querySelector('.info')?.textContent || '',
      label: button.innerText,
    })));
    matches = options.flatMap((option, index) => {
      const [name, address] = option.name ? [option.name, option.address] : splitVenue(option.label);
      return venueMatchesListing(name, address, listing) ? [{ label: option.label, index }] : [];
    });
    if (matches.length === 1) break;
  }
  if (matches.length === 1) {
    stage('selecting the matching venue suggestion');
    const match = matches[0];
    const row = rows.nth(match.index);
    await guard();
    // This panel can clip all but a sliver of a row below its fixed footer.
    // Both managed and Google items commit on mousedown. Dispatch to the
    // verified current button, after checking it is still enabled and visible.
    if (!await row.isVisible() || !await row.isEnabled(TIMEOUT) || await row.innerText(TIMEOUT) !== match.label) return;
    await row.dispatchEvent('mousedown', { button: 0, buttons: 1 }, TIMEOUT);
    stage('confirming the selected venue on the form');
    await clear.waitFor({ state: 'visible', timeout: 6500 }).catch(() => {});
    await read();
  } else if (matches.length === 0 && listing.address && listing.region && listing.country && listing.postcode) {
    stage('opening the custom location form');
    await guard();
    if (!await custom.isVisible() || !await custom.isEnabled(TIMEOUT)) return;
    await custom.dispatchEvent('mousedown', { button: 0, buttons: 1 }, TIMEOUT);
    state.guidance = 'Fill the custom location in the event form with the supplied Calendar address.';
  } else {
    state.guidance = 'Several or insufficiently identified venue choices are available. Match the Calendar city and street address.';
  }
}

async function chooseLocationPart(field, values, guard) {
  if (await field.count() !== 1 || !await field.isVisible() || !await field.isEnabled(TIMEOUT)) return false;
  const allowed = values.map(words);
  if (await field.evaluate(node => node.tagName === 'SELECT')) {
    const options = await field.locator('option').evaluateAll(nodes => nodes.map(node => ({ value: node.value, label: node.text })));
    const match = options.find(item => allowed.includes(words(item.value)) || allowed.includes(words(item.label)));
    if (!match) return false;
    if (await field.inputValue(TIMEOUT) !== match.value) {
      await guard();
      await field.selectOption(match.value, TIMEOUT);
    }
    return await field.inputValue(TIMEOUT) === match.value;
  }
  const group = field.locator('xpath=ancestor::div[contains(concat(" ",normalize-space(@class)," "), " bit-dropdown ")][1]');
  const choices = group.locator('li[role="option"]');
  // These controls keep their previously selected option's label as the
  // filter even while closed; clearing the input reveals the full list.
  const readOptions = () => choices.evaluateAll(nodes => nodes.map(node => ({
    value: node.getAttribute('value'), label: node.textContent.trim(), selected: node.getAttribute('aria-selected') === 'true',
  })));
  const matches = option => allowed.includes(words(option.value)) || allowed.includes(words(option.label));
  let options = await readOptions();
  const selected = options.find(item => item.selected && matches(item));
  if (selected && words(await field.inputValue(TIMEOUT)) === words(selected.label)) return true;
  await guard();
  await field.fill('', TIMEOUT);
  if (!options.some(matches)) {
    // Options refresh after a debounced filter update. Wait for a matching
    // value or label before reading its exact displayed label.
    const pattern = values.filter(Boolean).map(value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
    const byValue = values.filter(value => /^[a-zA-Z0-9 .-]+$/.test(value)).map(value => 'li[role="option"][value="' + value + '"]');
    let option = choices.filter({ hasText: new RegExp('^(?:' + pattern + ')$', 'i') });
    if (byValue.length) option = option.or(group.locator(byValue.join(', ')));
    await option.first().waitFor({ state: 'attached', ...TIMEOUT }).catch(() => {});
    options = await readOptions();
  }
  const match = options.find(matches);
  if (!match?.label) return false;
  await guard();
  await field.fill(match.label, TIMEOUT);
  const button = choices.getByRole('button', { name: match.label, exact: true });
  await button.first().waitFor({ state: 'visible', ...TIMEOUT });
  if (await button.count() !== 1 || !await button.isEnabled(TIMEOUT)) return false;
  await guard();
  await button.dispatchEvent('mousedown', { button: 0, buttons: 1 }, TIMEOUT);
  return words(await field.inputValue(TIMEOUT)) === words(match.label) &&
    (await readOptions()).some(item => item.selected && matches(item));
}

async function submitVenueFields(form, listing, guard, incomplete, stage = () => {}) {
  stage('selecting the venue country');
  const country = /^[A-Z]{2}$/.test(listing.country) ?
    new Intl.DisplayNames('en', { type: 'region' }).of(listing.country) : listing.country;
  if (!country || !await chooseLocationPart(form.locator('#venueFormCountryField'), [country, listing.country], guard)) return false;
  const regionField = form.locator('#venueFormRegionField');
  if (listing.region) {
    stage('selecting the venue state or region');
    await regionField.waitFor({ state: 'visible', ...TIMEOUT }).catch(() => {});
    if (!await chooseLocationPart(regionField, [listing.region], guard)) return false;
  }
  const addressParts = String(listing.address || '').split(/,\s*|\n/);
  const streetIndex = addressParts.findIndex(part => STREET_NUMBER.test(part));
  const address = streetIndex > 0 ? addressParts.slice(streetIndex).join(', ') : listing.address;
  const values = incomplete ? { venue_name: listing.venue, city: listing.city } :
    { name: listing.venue, address, city: listing.city, postal_code: listing.postcode };
  if (incomplete && await form.locator('input[name="address"]:visible').count()) values.address = address;
  for (const [name, value] of Object.entries(values)) {
    stage('entering the venue ' + name.replace(/_/g, ' '));
    const field = form.locator('input[name="' + name + '"]');
    if (!value || await field.count() !== 1 || !await field.isEditable(TIMEOUT)) return false;
    if (await field.inputValue(TIMEOUT) !== value) {
      await guard();
      await field.fill(value, TIMEOUT);
      await field.blur(TIMEOUT);
    }
    if (await field.inputValue(TIMEOUT) !== value) return false;
  }
  stage('submitting the completed venue location');
  const confirm = form.getByRole('button', { name: 'Submit', exact: true });
  if (await confirm.count() !== 1 || !await confirm.isVisible() || !await confirm.isEnabled(TIMEOUT)) return false;
  await guard();
  await confirm.click(TIMEOUT);
  return true;
}

async function fillCustomLocation(page, listing, state, guard, stage) {
  stage('reading the custom location form');
  const form = page.locator('#venueFormnameField').locator('xpath=ancestor::form[1]');
  if (await form.count() !== 1 || !await form.isVisible()) return;
  state.guidance = 'Use the Calendar venue, street, city, region, country, and postal code in the custom location form.';
  if (!await submitVenueFields(form, listing, guard, false, stage)) return;
  // The custom location action attaches the geocoded address to this form.
  await page.waitForURL(url => !url.pathname.endsWith('/add-location'), { timeout: 6500 }).catch(() => {});
  state.guidance = 'Read back the selected custom location on the event form.';
}

function onEventForm(page) {
  const url = new URL(page.url());
  return url.protocol === 'https:' && ['artists.bandsintown.com', 'www.artists.bandsintown.com', 'manager.bandsintown.com'].includes(url.hostname) && FORM_PATH.test(url.pathname);
}

async function submitLocationDialog(page, listing, isCurrent, verified) {
  if (!(verified?.dateMatches && verified.timeMatches && verified.venueMatches && verified.notificationsOff) ||
      !onEventForm(page) || new URL(page.url()).pathname.endsWith('/add-location')) return false;
  // The capitalized ID belongs to the post-Save incomplete venue warning. Its
  // Submit validates the location and resumes the original publication.
  const field = page.locator('input#venueFormNameField[name="venue_name"]:visible, input#venueFormnameField[name="name"]:visible');
  if (await field.count() !== 1) return false;
  const form = field.locator('xpath=ancestor::form[1]');
  if (await form.count() !== 1 || !await form.isVisible() || await form.locator('#venueField, input[name="start_time"]').count()) return false;
  const guard = async () => {
    if (!onEventForm(page) || !await field.isVisible() || !await isCurrent()) throw new Error('Browser job is no longer current');
  };
  return submitVenueFields(form, listing, guard, await field.getAttribute('name') === 'venue_name');
}

async function prepareEventForm(page, listing, isCurrent, stage = () => {}) {
  const state = { dateMatches: false, venueMatches: false };
  if (!onEventForm(page) || !listing) return state;
  const guard = async () => {
    if (!onEventForm(page) || !await isCurrent()) throw new Error('Browser job is no longer current');
  };
  if (new URL(page.url()).pathname.endsWith('/add-location')) {
    await fillCustomLocation(page, listing, state, guard, stage);
  } else {
    await setDate(page, listing, state, guard, stage);
    await choosePlace(page, listing, state, guard, stage);
  }
  return state;
}

module.exports = { prepareEventForm, submitLocationDialog, venueMatchesListing, numberedStreet };
