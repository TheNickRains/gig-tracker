const FORM_PATH = /^\/artists\/3251702\/events?\/new(?:\/add-location)?\/?$/;
const VENUE_GROUP = 'xpath=ancestor::div[div[ul and aside]][1]';
const TIMEOUT = { timeout: 3500 };

function words(text) {
  return String(text || '').normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

function street(text) {
  return words(text).replace(/\bstreet\b/g, 'st').replace(/\bavenue\b/g, 'ave')
    .replace(/\broad\b/g, 'rd').replace(/\bboulevard\b/g, 'blvd').replace(/\bdrive\b/g, 'dr');
}

function venueMatchesListing(name, location, listing) {
  const city = words(listing.city);
  const venue = words(listing.venue);
  const address = street(listing.address);
  const parts = location.split(/[,\n]+/).map(words).filter(Boolean);
  if (!city || !venue || !parts.some(part => part === city || part.startsWith(city + ' '))) return false;
  const addressPart = location.split(/[,\n]+/).find(part => /^\s*\d+[A-Z-]*\s+\S/i.test(part));
  const sameStreet = address && (' ' + street(location) + ' ').includes(' ' + address + ' ');
  if (addressPart && address && !sameStreet) return false;
  const region = (location.match(/,\s*([A-Z]{2})(?=\s*[,\d]|\s*$)/) || [])[1];
  if (region && listing.region && region !== listing.region && region !== listing.country) return false;
  const place = words(name);
  return place === venue || Boolean(sameStreet && (place + ' ' + city === venue || venue + ' ' + city === place));
}

function splitVenue(value) {
  const [name, ...rest] = value.split(/\s+[-–—]\s+|,\s*/);
  return [name, rest.join(', ')];
}

async function setDate(page, listing, state, guard) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(listing.date || '')) return;
  let field = page.locator('input#eventStartDateField:visible, input[name="start_date"]:visible');
  if (await field.count() !== 1) {
    field = page.getByRole('textbox', { name: /^start date\s*\*?$/i });
  }
  if (await field.count() !== 1 || !await field.isVisible()) return;
  const desired = new Date(listing.date + 'T12:00:00Z');
  if (Number.isNaN(+desired) || desired.toISOString().slice(0, 10) !== listing.date) return;
  const [year, month, dayOfMonth] = listing.date.split('-');
  const placeholder = await field.getAttribute('placeholder') || '';
  const dayFirst = /d+\s*\/\s*m+/i.test(placeholder);
  const [first, second] = dayFirst ? [dayOfMonth, month] : [month, dayOfMonth];
  const slashDate = [first, second, year].join('/');
  const formats = new Set([listing.date, slashDate, [Number(first), Number(second), year].join('/'), ...['short', 'long'].map(month => new Intl.DateTimeFormat('en-US', {
    year: 'numeric', month, day: 'numeric', timeZone: 'UTC',
  }).format(desired))]);
  const read = async () => {
    state.date = (await field.inputValue()).trim();
    state.dateMatches = formats.has(state.date) && await field.getAttribute('aria-invalid') !== 'true';
  };
  await read();
  if (state.dateMatches || !await field.isEnabled()) return;
  await guard();
  const native = await field.getAttribute('type') === 'date';
  if (native || await field.isEditable()) {
    const slashFormat = /[dm]+\s*\/\s*[dm]+/i.test(placeholder) || /^\d{1,2}\/\d{1,2}\/\d{4}$/.test(state.date);
    await field.fill(native || !slashFormat ? listing.date : slashDate, TIMEOUT);
    await field.blur();
    await read();
    if (state.dateMatches || native) return;
  }
  const group = field.locator('xpath=ancestor::div[.//*[contains(concat(" ", normalize-space(@class), " "), " date-content ")]][1]');
  const picker = group.locator('.date-content');
  if (await picker.count() !== 1) return;
  if (!await picker.isVisible()) await group.getByRole('button', { name: 'Toggle picker', exact: true }).click(TIMEOUT);
  const monthButton = picker.locator('button.month');
  await monthButton.waitFor({ state: 'visible', ...TIMEOUT });
  const expectedMonth = new Intl.DateTimeFormat('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' }).format(desired);
  if ((await monthButton.innerText()).trim() !== expectedMonth) {
    await guard();
    await monthButton.click(TIMEOUT);
    const edit = picker.locator('input');
    await edit.fill(listing.date, TIMEOUT);
    await edit.press('Tab', TIMEOUT);
    await monthButton.waitFor({ state: 'visible', ...TIMEOUT });
    if ((await monthButton.innerText()).trim() !== expectedMonth) return;
  }
  const day = picker.getByRole('button', { name: String(desired.getUTCDate()), exact: true });
  if (await day.count() !== 1 || !await day.isEnabled()) return;
  await guard();
  await day.click(TIMEOUT);
  await read();
}

async function choosePlace(page, listing, state, guard) {
  const field = page.locator('input#venueField[name="venue_name"]');
  if (await field.count() !== 1 || !await field.isVisible()) return;
  const group = field.locator(VENUE_GROUP);
  if (await group.count() !== 1) return;
  const clear = group.locator('button[aria-label="Clear value"]');
  const read = async () => {
    state.venue = (await field.inputValue()).trim().slice(0, 240);
    const [name, location] = splitVenue(state.venue);
    state.venueMatches = await clear.isVisible() && venueMatchesListing(name, location, listing);
  };
  await read();
  if (await clear.isVisible() || !await field.isEnabled() || !listing.venue || !listing.city) return;
  await guard();
  if (await field.inputValue() !== listing.venue) await field.fill(listing.venue, TIMEOUT);
  const custom = group.locator('aside button');
  // The custom-location link appears after the debounced search returns, including zero results.
  await custom.waitFor({ state: 'visible', timeout: 6500 }).catch(() => {});
  if (!await custom.isVisible()) return;
  const rows = group.locator('ul > li > button');
  const options = await rows.evaluateAll(buttons => buttons.map(button => ({
    name: button.querySelector('.name span')?.textContent || '',
    address: button.querySelector('.info')?.textContent || '',
    label: button.innerText,
  })));
  const matches = options.filter(opt => {
    const [name, address] = opt.name ? [opt.name, opt.address] : splitVenue(opt.label);
    return venueMatchesListing(name, address, listing);
  });
  if (matches.length === 1) {
    // Check the text again because suggestions update while the field has focus.
    const index = options.indexOf(matches[0]);
    const row = rows.nth(index);
    await guard();
    if ((await row.innerText()) !== matches[0].label) return;
    await row.click(TIMEOUT);
    await clear.waitFor({ state: 'visible', ...TIMEOUT }).catch(() => {});
    await read();
  } else if (matches.length === 0 && listing.address && listing.region && listing.country && listing.postcode) {
    await guard();
    await custom.click(TIMEOUT);
    state.guidance = 'Fill the custom location in the event form with the supplied Calendar address.';
  } else {
    state.guidance = 'Several or insufficiently identified venue choices are available. Match the Calendar city and street address.';
  }
}

async function chooseLocationPart(field, values, guard) {
  if (await field.count() !== 1 || !await field.isVisible() || !await field.isEnabled()) return false;
  const allowed = values.map(words);
  if (await field.evaluate(node => node.tagName === 'SELECT')) {
    const options = await field.locator('option').evaluateAll(nodes => nodes.map(node => ({ value: node.value, label: node.text })));
    const match = options.find(item => allowed.includes(words(item.value)) || allowed.includes(words(item.label)));
    if (!match) return false;
    if (await field.inputValue() !== match.value) {
      await guard();
      await field.selectOption(match.value, TIMEOUT);
    }
    return await field.inputValue() === match.value;
  }
  const group = field.locator('xpath=ancestor::div[contains(concat(" ",normalize-space(@class)," "), " bit-dropdown ")][1]');
  const choices = group.locator('li[role="option"]');
  const options = await choices.evaluateAll(nodes => nodes.map(node => ({ value: node.getAttribute('value'), label: node.textContent.trim() })));
  const match = options.find(item => allowed.includes(words(item.value)) || allowed.includes(words(item.label)));
  if (!match || !match.label) return false;
  if (words(await field.inputValue()) !== words(match.label)) {
    await guard();
    await field.fill(match.label, TIMEOUT);
    const button = choices.getByRole('button', { name: match.label, exact: true });
    await button.first().waitFor({ state: 'visible', ...TIMEOUT });
    if (await button.count() !== 1) return false;
    await guard();
    await button.click(TIMEOUT);
  }
  return words(await field.inputValue()) === words(match.label);
}

async function fillCustomLocation(page, listing, state, guard) {
  const form = page.locator('#venueFormnameField').locator('xpath=ancestor::form[1]');
  if (await form.count() !== 1 || !await form.isVisible()) return;
  state.guidance = 'Use the Calendar venue, street, city, region, country, and postal code in the custom location form.';
  const country = /^[A-Z]{2}$/.test(listing.country) ?
    new Intl.DisplayNames('en', { type: 'region' }).of(listing.country) : listing.country;
  if (!country || !await chooseLocationPart(form.locator('#venueFormCountryField'), [country, listing.country], guard)) return;
  if (!await chooseLocationPart(form.locator('#venueFormRegionField'), [listing.region], guard)) return;
  const values = { name: listing.venue, address: listing.address, city: listing.city, postal_code: listing.postcode };
  for (const [name, value] of Object.entries(values)) {
    const field = form.locator('input[name="' + name + '"]');
    if (!value || await field.count() !== 1 || !await field.isEditable()) return;
    if (await field.inputValue() !== value) {
      await guard();
      await field.fill(value, TIMEOUT);
      await field.blur();
    }
    if (await field.inputValue() !== value) return;
  }
  const confirm = form.getByRole('button', { name: 'Submit', exact: true });
  if (await confirm.count() !== 1 || !await confirm.isEnabled()) return;
  await guard();
  await confirm.click(TIMEOUT);
  // The custom location action attaches the geocoded address to this form.
  await page.waitForURL(url => !url.pathname.endsWith('/add-location'), { timeout: 6500 }).catch(() => {});
  state.guidance = 'Read back the selected custom location on the event form.';
}

async function prepareEventForm(page, listing, isCurrent) {
  const state = { dateMatches: false, venueMatches: false };
  const onForm = () => {
    const url = new URL(page.url());
    return url.protocol === 'https:' && ['artists.bandsintown.com', 'www.artists.bandsintown.com', 'manager.bandsintown.com'].includes(url.hostname) && FORM_PATH.test(url.pathname);
  };
  if (!onForm() || !listing) return state;
  const guard = async () => {
    if (!onForm() || !await isCurrent()) throw new Error('Browser job is no longer current');
  };
  if (new URL(page.url()).pathname.endsWith('/add-location')) {
    await fillCustomLocation(page, listing, state, guard);
  } else {
    await setDate(page, listing, state, guard);
    await choosePlace(page, listing, state, guard);
  }
  return state;
}

module.exports = { prepareEventForm, venueMatchesListing };
