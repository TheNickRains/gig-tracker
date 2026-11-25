/**
 * Bind to the destination workbook and copy the current Bandsintown template
 * into a tab named Template. Set script properties SHOW_SYNC_URL and
 * SHOW_SYNC_SHEETS_TOKEN. Optional TEMPLATE_HEADER_ROW defaults to 1.
 */
function onOpen() {
  SpreadsheetApp.getUi().createMenu('Bandsintown')
    .addItem('Prepare next week', 'prepareBandsintownWeek')
    .addItem('Set up Friday refresh', 'installBandsintownWeek')
    .addToUi();
}

function installBandsintownWeek() {
  const book = SpreadsheetApp.getActiveSpreadsheet();
  PropertiesService.getScriptProperties().setProperty('SHOW_SYNC_WORKBOOK_ID', book.getId());
  for (const trigger of ScriptApp.getProjectTriggers()) {
    if (trigger.getHandlerFunction() === 'refreshBandsintownWeek') ScriptApp.deleteTrigger(trigger);
  }
  ScriptApp.newTrigger('refreshBandsintownWeek').timeBased().onWeekDay(ScriptApp.WeekDay.FRIDAY)
    .atHour(9).inTimezone(book.getSpreadsheetTimeZone()).create();
}

function refreshBandsintownWeek() {
  const id = PropertiesService.getScriptProperties().getProperty('SHOW_SYNC_WORKBOOK_ID');
  writeBandsintownWeek_(SpreadsheetApp.openById(id));
}

function prepareBandsintownWeek() {
  const book = SpreadsheetApp.getActiveSpreadsheet();
  const { ready, review } = writeBandsintownWeek_(book);
  book.toast(ready + ' ready, ' + review + ' need review.', 'Bandsintown');
}

function writeBandsintownWeek_(book) {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const properties = PropertiesService.getScriptProperties();
    const template = book.getSheetByName('Template');
    const url = properties.getProperty('SHOW_SYNC_URL');
    const token = properties.getProperty('SHOW_SYNC_SHEETS_TOKEN');
    const headerRow = Number(properties.getProperty('TEMPLATE_HEADER_ROW') || 1);
    if (!template || !url || !token || !Number.isInteger(headerRow) || headerRow < 1) {
      throw new Error('Set up the Template tab and script properties first.');
    }
    const local = Utilities.formatDate(new Date(), book.getSpreadsheetTimeZone(), 'yyyy-MM-dd');
    const week = new Date(local + 'T00:00:00Z');
    const daysToMonday = (8 - week.getUTCDay()) % 7 || 7;
    week.setUTCDate(week.getUTCDate() + daysToMonday);
    const start = week.toISOString().slice(0, 10);
    const response = UrlFetchApp.fetch(url.replace(/\/$/, '') + '/calendar-publish/week?start=' + start, {
      method: 'post', headers: { Authorization: 'Bearer ' + token }, muteHttpExceptions: true,
    });
    if (response.getResponseCode() !== 200) throw new Error('The publishing worker did not return the weekly batch.');
    const { rows } = JSON.parse(response.getContentText());
    const columns = template.getLastColumn();
    const headers = template.getRange(headerRow, 1, 1, columns).getDisplayValues()[0]
      .map(label => label.toLowerCase().replace(/\*/g, '').trim());
    if (!['venue', 'city', 'country', 'start date', 'start time', 'timezone'].every(key => headers.includes(key))) {
      throw new Error('The template headers have changed. Confirm the header row against the current Bandsintown download.');
    }

    const values = rows.filter(row => !row.listing.validationIssue && !['published', 'working'].includes(row.status)).map(({ listing }) => {
      const fields = {
        'venue': listing.venue, 'address': listing.address, 'city': listing.city,
        'region': listing.region, 'country': listing.country, 'postal code': listing.postcode,
        'start date': listing.date, 'start time': listing.time, 'timezone': listing.timeZone,
        'event name': listing.title, 'ticket link': listing.ticketUrl,
        'ticket type': listing.ticketUrl ? 'Tickets' : '',
        'description': [listing.description, listing.doors && 'Doors ' + listing.doors, listing.ticketPrice]
          .filter(Boolean).join(' · '),
      };
      return headers.map(header => safeSheetText_(fields[header]));
    });
    const reviews = rows.filter(row => row.issue).map(row =>
      [row.listing.date, row.listing.title, row.issue].map(safeSheetText_));
    const name = 'Bandsintown ' + start;
    const draft = book.getSheetByName(name) || template.copyTo(book).setName(name);
    const contentRows = Math.max(0, draft.getLastRow() - headerRow);
    if (contentRows) draft.getRange(headerRow + 1, 1, contentRows, columns).clearContent();
    if (values.length) {
      if (draft.getMaxRows() < headerRow + values.length) {
        draft.insertRowsAfter(draft.getMaxRows(), headerRow + values.length - draft.getMaxRows());
      }
      draft.getRange(headerRow + 1, 1, values.length, columns).setValues(values);
    }
    const reviewName = 'Review ' + start;
    const review = book.getSheetByName(reviewName) || book.insertSheet(reviewName);
    review.clearContents();
    const allReviews = [['Date', 'Show', 'Needs review'], ...reviews];
    if (review.getMaxRows() < allReviews.length) {
      review.insertRowsAfter(review.getMaxRows(), allReviews.length - review.getMaxRows());
    }
    review.getRange(1, 1, allReviews.length, 3).setValues(allReviews);
    return { ready: values.length, review: reviews.length };
  } finally {
    lock.releaseLock();
  }
}

function safeSheetText_(value) {
  const text = String(value || '');
  return /^[=+@-]/.test(text) ? "'" + text : text;
}
