// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDom } from './_dom-stub.js';
import {
  fireEvent,
  getByRole,
  queryAllByRole,
  queryAllByTag,
  queryByRole,
} from './helpers/semantic-dom.js';

installDom();
/** @type {any} */ (globalThis).location = { hash: '' };

const { formsClient, mountFormRoute, openForm } =
  await import('./helpers/form-page.js');
const { makeChrome } = await import('./helpers/fixtures.js');
const { resolveCapabilities } = await import('../src/services/permissions.js');
const { oneToOne } = await import('../form-types/one-to-one.js');
const { formFields, CLOSED_FORM_STATUSES } =
  await import('../form-types/contract.js');

// Capability: one renderer draws a Form from its Form Type's definition, as
// controls for whoever may edit each field and as text for everyone else; it
// saves edits as they are made, and the lifecycle buttons close it for good.

/** Every field the 1-to-1 can show as a control. */
const controls = (/** @type {HTMLElement} */ view) => [
  ...queryAllByRole(view, 'textbox'),
  ...queryAllByRole(view, 'combobox'),
];

/** The text of the element with a class, for the read-only parts of a page. */
function textOf(
  /** @type {HTMLElement} */ view,
  /** @type {string} */ className
) {
  const found = view.querySelector(`.${className}`);
  return found ? (found.textContent ?? '') : null;
}

/** Wait for the queue to settle a save. */
const saved = (/** @type {any} */ page) =>
  page.until(
    (/** @type {any} */ route) =>
      route.saveStatus === 'saved' && route.lastSavedAt !== null
  );

test('the Employee edits their open Form: every field but the manager’s comments is a control', async () => {
  const page = await openForm('forms-employee', '101');
  const view = page.render();

  assert.equal(
    getByRole(view, 'heading', { name: '1-to-1 · Sam Patel' }).tagName,
    'H1'
  );
  for (const name of ['Date of meeting', 'Agenda', 'Individual comments']) {
    assert.ok(getByRole(view, 'textbox', { name }), name);
  }
  assert.ok(getByRole(view, 'textbox', { name: 'Tags (optional)' }));
  for (const name of ['Competency stage', 'Location']) {
    assert.ok(getByRole(view, 'combobox', { name }), name);
  }
  assert.equal(
    queryByRole(view, 'textbox', { name: 'Line manager comments' }),
    null
  );
  assert.match(view.textContent ?? '', /Only Ana Lopez can write here/);
});

test('the current first line manager edits their own comments and reads the Employee’s', async () => {
  const page = await openForm('forms-line-manager', '101');
  const view = page.render();
  assert.ok(getByRole(view, 'textbox', { name: 'Line manager comments' }));
  assert.equal(
    queryByRole(view, 'textbox', { name: 'Individual comments' }),
    null
  );
  assert.match(view.textContent ?? '', /Happy with the plan\./);
  assert.match(view.textContent ?? '', /Only Sam Patel can write here/);
});

test('nobody edits the application’s own columns, whatever their role', async () => {
  const page = await openForm('forms-employee', '101');
  const view = page.render();
  assert.equal(queryByRole(view, 'textbox', { name: 'Due date' }), null);
  assert.match(textOf(view, 'cora-form-strip') ?? '', /Due date30\/09\/2026/);
});

for (const [persona, why] of [
  [
    'forms-second-line-manager',
    /You’re Sam Patel’s second line manager, so you can read this form but not change it\./,
  ],
  [
    'forms-control',
    /You’re in the Forms control group, so you can read this form but not change it\./,
  ],
]) {
  test(`${persona} reads the Form as text, told why, with nothing to press and nothing saved`, async () => {
    const client = formsClient();
    client.patchFormItem = async () => {
      throw new Error('a read-only viewer must never write');
    };
    const page = await openForm(/** @type {string} */ (persona), '101', {
      client,
    });
    const view = page.render();

    assert.match(
      textOf(view, 'cora-form-banner--view') ?? '',
      /** @type {RegExp} */ (why)
    );
    assert.deepEqual(controls(view), []);
    assert.equal(queryByRole(view, 'button', { name: 'Mark complete' }), null);
    assert.match(
      view.textContent ?? '',
      /Quarter review — what’s next|Quarter review — what went well, what’s next\./
    );
    assert.match(view.textContent ?? '', /Nothing recorded/);
    // The queue would announce a status; a viewer without one never has it.
    assert.equal(
      page.actions.some((action) => action.type === 'form/save-status-changed'),
      false
    );
  });
}

test('an empty field reads "Nothing recorded" to someone who cannot edit it', async () => {
  const page = await openForm('forms-second-line-manager', '102');
  const empty = [...page.render().querySelectorAll('.cora-form-empty')].filter(
    (node) => node.textContent === 'Nothing recorded'
  );
  // Form 102 has only its people and its due date filled in.
  const unfilled = formFields(oneToOne).filter(
    (field) =>
      ![
        'Employee',
        'FirstLineManager',
        'SecondLineManager',
        'DueDate',
      ].includes(field.itemField)
  );
  assert.equal(empty.length, unfilled.length);
});

test('an edit is saved after the pause and the header says when', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const page = await openForm('forms-employee', '102');
  fireEvent(getByRole(page.render(), 'textbox', { name: 'Agenda' }), 'change', {
    target: { value: 'Leave planning' },
  });
  assert.equal(page.route.saveStatus, 'saving');
  t.mock.timers.tick(1500);
  await saved(page);

  const stored = await page.client.getFormItem(oneToOne, '102');
  assert.equal(stored?.fields.Agenda, 'Leave planning');
  assert.match(
    textOf(page.render(), 'cora-form-header-status') ?? '',
    /Last saved 15:32/
  );
});

test('a cleared choice is saved as nothing rather than as empty text', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const page = await openForm('forms-employee', '101');
  fireEvent(
    getByRole(page.render(), 'combobox', { name: 'Location' }),
    'change',
    { target: { value: '' } }
  );
  t.mock.timers.tick(1500);
  await saved(page);
  const stored = await page.client.getFormItem(oneToOne, '101');
  assert.equal(stored?.fields.Location, null);
});

test('changing the recorded first line manager never changes who has access', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const page = await openForm('forms-employee', '102');
  fireEvent(
    getByRole(page.render(), 'button', { name: 'Clear First line manager' }),
    'click'
  );
  fireEvent(
    getByRole(page.render(), 'combobox', {
      name: 'Search people for First line manager',
    }),
    'input',
    { target: { value: 'lee' } }
  );
  t.mock.timers.tick(200);
  await page.until(
    (route) => route.peopleSearch.FirstLineManager?.status === 'success'
  );
  fireEvent(
    getByRole(page.render(), 'option', { name: /Lee Morgan/ }),
    'click'
  );
  t.mock.timers.tick(1500);
  await saved(page);

  const stored = /** @type {any} */ (
    await page.client.getFormItem(oneToOne, '102')
  );
  assert.equal(stored.fields.FirstLineManager.displayName, 'Lee Morgan');
  assert.equal(stored.fields.CurrentFirstLineManager.displayName, 'Ana Lopez');
  assert.match(
    textOf(page.render(), 'cora-form-strip') ?? '',
    /Has access now: Ana Lopez/
  );
});

test('each current manager is shown with what they may do', async () => {
  const asEmployee = (await openForm('forms-employee', '101')).render();
  const notes = [...asEmployee.querySelectorAll('.cora-form-strip-note')].map(
    (note) => note.textContent
  );
  assert.deepEqual(notes, ['Can edit', 'View only']);
  const asManager = (await openForm('forms-line-manager', '101')).render();
  assert.equal(
    asManager.querySelector('.cora-form-strip-note')?.textContent,
    'You'
  );
});

/**
 * @param {any} page
 * @param {string} button
 * @param {string} confirm
 */
async function close(page, button, confirm) {
  fireEvent(getByRole(page.render(), 'button', { name: button }), 'click');
  const before = page.actions.length;
  fireEvent(getByRole(page.render(), 'button', { name: confirm }), 'click');
  await page.until(() =>
    page.actions
      .slice(before)
      .some((/** @type {any} */ action) =>
        ['form/closed', 'form/close-failed'].includes(action.type)
      )
  );
}

for (const [button, confirm, status, verb] of [
  ['Mark complete', 'Yes, mark complete', 'Completed', 'Completed'],
  ['Void form', 'Yes, void form', 'Void', 'Voided'],
  ['Cancel form', 'Yes, cancel form', 'Cancelled', 'Cancelled'],
]) {
  test(`${button} locks the Form for everyone, recording when and by whom`, async () => {
    const page = await openForm('forms-employee', '101');
    await close(page, button, confirm);

    const stored = await page.client.getFormItem(oneToOne, '101');
    assert.equal(stored?.fields.Status, status);
    assert.equal(stored?.fields.ClosedDate, '2026-10-10');
    assert.deepEqual(stored?.fields.ClosedBy, {
      loginName: 'user-forms-employee',
      displayName: 'Sam Patel',
    });
    const view = page.render();
    assert.match(
      textOf(view, 'cora-form-banner--locked') ?? '',
      new RegExp(`^${verb} on 10/10/2026\\. This form is locked`)
    );
    assert.deepEqual(controls(view), []);
    assert.equal(queryByRole(view, 'button', { name: button }), null);
  });
}

test('the closing Statuses the buttons write are exactly the ones that lock a Form', async () => {
  /** @type {string[]} */
  const written = [];
  for (const [button, confirm] of [
    ['Mark complete', 'Yes, mark complete'],
    ['Void form', 'Yes, void form'],
    ['Cancel form', 'Yes, cancel form'],
  ]) {
    const page = await openForm('forms-employee', '101');
    await close(page, button, confirm);
    written.push(
      String((await page.client.getFormItem(oneToOne, '101'))?.fields.Status)
    );
  }
  assert.deepEqual([...written].sort(), [...CLOSED_FORM_STATUSES].sort());
});

test('an edit still waiting is saved before the Form closes, and nothing is saved after', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const page = await openForm('forms-employee', '102');
  /** @type {Array<Record<string, unknown>>} */
  const writes = [];
  const patch = page.client.patchFormItem.bind(page.client);
  page.client.patchFormItem = (/** @type {any[]} */ ...args) => {
    writes.push(args[2]);
    return patch(...args);
  };
  fireEvent(getByRole(page.render(), 'textbox', { name: 'Agenda' }), 'change', {
    target: { value: 'Written just before completing' },
  });
  await close(page, 'Mark complete', 'Yes, mark complete');
  t.mock.timers.tick(5000);

  const stored = await page.client.getFormItem(oneToOne, '102');
  assert.equal(stored?.fields.Agenda, 'Written just before completing');
  assert.deepEqual(
    writes.map((fields) => Object.keys(fields)),
    [['Agenda'], ['Status', 'ClosedDate', 'ClosedBy']]
  );
});

test('the confirmation can be withdrawn, and the Form stays open', async () => {
  const page = await openForm('forms-employee', '101');
  fireEvent(getByRole(page.render(), 'button', { name: 'Void form' }), 'click');
  assert.match(
    page.render().textContent ?? '',
    /Void this 1-to-1\? Nobody will be able to change it afterwards\./
  );
  fireEvent(
    getByRole(page.render(), 'button', { name: 'Keep editing' }),
    'click'
  );
  assert.ok(getByRole(page.render(), 'button', { name: 'Mark complete' }));
  assert.equal(
    (await page.client.getFormItem(oneToOne, '101'))?.fields.Status,
    'Pending'
  );
});

test('a Form closed by someone else first is not closed again, and the editor is told', async () => {
  const page = await openForm('forms-employee', '101');
  const other = page.client;
  const fresh = await other.getFormItem(oneToOne, '101');
  await other.patchFormItem(
    oneToOne,
    '101',
    { Status: 'Void', ClosedDate: '2026-10-09', ClosedBy: null },
    fresh.etag
  );
  await close(page, 'Mark complete', 'Yes, mark complete');

  const view = page.render();
  assert.match(
    getByRole(view, 'alert', { name: /could not be closed/ }).textContent ?? '',
    /Reload it and try again/
  );
  assert.match(view.textContent ?? '', /changed by someone else/);
  assert.equal(
    (await other.getFormItem(oneToOne, '101'))?.fields.Status,
    'Void'
  );
});

test('a locked Form shows its current managers, and apart from them who was recorded and who closed it', async () => {
  const view = (await openForm('forms-employee', '103')).render();
  assert.match(
    textOf(view, 'cora-form-banner--locked') ?? '',
    /^Completed on 24\/06\/2026\. This form is locked and can no longer be changed\.$/
  );
  const strip = textOf(view, 'cora-form-strip') ?? '';
  assert.match(strip, /Current first line managerAna Lopez/);
  assert.match(strip, /Current second line managerJo Reid/);
  const recorded = view.querySelector('.cora-form-recorded');
  assert.ok(recorded);
  assert.equal(
    getByRole(recorded, 'heading').textContent,
    'Recorded at completion'
  );
  assert.match(recorded.textContent ?? '', /First line managerLee Morgan/);
  assert.match(
    recorded.textContent ?? '',
    /Completed byLee Morgan, 24\/06\/2026/
  );
  assert.deepEqual(controls(view), []);
});

test('a Void Form records it was voided, and an empty record reads as nothing', async () => {
  const view = (await openForm('forms-employee', '105')).render();
  const recorded = view.querySelector('.cora-form-recorded');
  assert.ok(recorded);
  assert.equal(
    getByRole(recorded, 'heading').textContent,
    'Recorded when voided'
  );
  assert.match(
    recorded.textContent ?? '',
    /First line managerNothing recorded/
  );
  assert.match(recorded.textContent ?? '', /Voided bySam Patel, 03\/07\/2026/);
});

test('a locked Form is reached from the archive, and an open one from the dashboard', async () => {
  const links = async (/** @type {string} */ id) => {
    const view = (await openForm('forms-employee', id)).render();
    const trail = view.querySelector('.cora-form-breadcrumbs');
    return queryAllByTag(trail, 'a').map((link) => link.getAttribute('href'));
  };
  assert.deepEqual(await links('101'), ['#/forms']);
  assert.deepEqual(await links('103'), ['#/forms', '#/forms?tab=archive']);
});

test('the Form Actions are listed as they were recorded', async () => {
  const view = (await openForm('forms-employee', '101')).render();
  const actions = view.querySelector('.cora-form-actions');
  assert.ok(actions);
  assert.match(
    actions.textContent ?? '',
    /Book the SQL courseDue 15\/10\/2026Pending/
  );
  const none = (await openForm('forms-employee', '102')).render();
  assert.match(
    textOf(none, 'cora-form-actions') ?? '',
    /No actions recorded\./
  );
});

test('someone the Form does not name is told they cannot open it', async () => {
  const page = await openForm('forms-employee', '101', {
    chrome: makeChrome({
      currentUser: { id: 'user-forms-former-flm', displayName: 'Lee Morgan' },
      permissions: resolveCapabilities(['Forms']),
    }),
  });
  const view = page.render();
  assert.match(view.textContent ?? '', /You don’t have access to this form\./);
  assert.match(view.textContent ?? '', /^((?!Sam Patel).)*$/s);
});

test('a Form that does not exist, of a type that does not exist, or that cannot be read says so', async () => {
  const missing = await openForm('forms-employee', '999');
  assert.match(
    missing.render().textContent ?? '',
    /This form could not be found\./
  );

  const unknown = await openForm('forms-employee', '101', {
    slug: 'appraisal',
  });
  assert.match(
    unknown.render().textContent ?? '',
    /There is no form of this type\./
  );

  const client = formsClient();
  client.getFormItem = async () => {
    throw new Error('503');
  };
  const failed = await openForm('forms-employee', '101', { client });
  assert.match(
    getByRole(failed.render(), 'alert').textContent ?? '',
    /could not be loaded/
  );
});

test('the page shows it is loading until the Form is read', () => {
  const page = mountFormRoute('forms-employee', { id: '101' });
  assert.match(page.render().textContent ?? '', /Loading form…/);
  page.leave();
});

test('a read answered after the viewer has left changes nothing', async () => {
  /** @type {(value: any) => void} */
  let answer = () => {};
  const client = formsClient();
  client.getFormItem = () => new Promise((resolve) => (answer = resolve));
  const page = mountFormRoute('forms-employee', { id: '101', client });
  page.leave();
  answer(null);
  await Promise.resolve();
  assert.equal(page.route.load, 'loading');
});

test('the save status is drawn only while the Form can be saved', async () => {
  const editor = (await openForm('forms-employee', '101')).render();
  assert.ok(editor.querySelector('.cora-form-header-status'));
  assert.equal(
    (await openForm('forms-control', '101'))
      .render()
      .querySelector('.cora-banner'),
    null
  );
});

/**
 * A client whose Form `id` has had `fields` written to it, as a row edited by
 * hand in the list would be.
 *
 * @param {string} id
 * @param {Record<string, any>} fields
 */
async function clientWith(id, fields) {
  const client = formsClient();
  const item = await client.getFormItem(oneToOne, id);
  await client.patchFormItem(
    oneToOne,
    id,
    fields,
    /** @type {any} */ (item).etag
  );
  return client;
}

test('a Form missing its Employee, Status and second line manager still opens for its first line manager', async () => {
  const client = await clientWith('101', {
    Employee: null,
    Status: null,
    CurrentSecondLineManager: null,
    Actions: null,
  });
  const view = (
    await openForm('forms-line-manager', '101', { client })
  ).render();

  assert.equal(getByRole(view, 'heading', { name: '1-to-1' }).tagName, 'H1');
  assert.equal(
    view.querySelector('.cora-form-header-status .cora-badge'),
    null
  );
  assert.ok(getByRole(view, 'button', { name: 'Mark complete' }));
  assert.doesNotMatch(view.textContent ?? '', /can write here/);
  assert.deepEqual(
    [...view.querySelectorAll('.cora-form-strip-note')].map(
      (note) => note.textContent
    ),
    ['You']
  );
  assert.match(
    textOf(view, 'cora-form-actions') ?? '',
    /No actions recorded\./
  );
});

test('a Form closed by hand, with no closed date or closer, is locked without either being made up', async () => {
  const client = await clientWith('101', {
    Status: 'Completed',
    ClosedDate: null,
    ClosedBy: null,
  });
  const view = (await openForm('forms-employee', '101', { client })).render();
  assert.match(
    textOf(view, 'cora-form-banner--locked') ?? '',
    /^Completed\. This form is locked/
  );
  assert.match(
    textOf(view, 'cora-form-recorded') ?? '',
    /Completed byNothing recorded/
  );
});

test('a recorded first line manager who no longer has access is shown beside the one who does', async () => {
  const client = await clientWith('101', {
    FirstLineManager: { loginName: 'user-lee', displayName: 'Lee Morgan' },
  });
  const notes = async (/** @type {string} */ persona) =>
    textOf(
      (await openForm(persona, '101', { client })).render(),
      'cora-form-strip-note'
    );
  assert.equal(
    await notes('forms-line-manager'),
    'Has access now: Ana Lopez (you)'
  );
  assert.equal(await notes('forms-employee'), 'Has access now: Ana Lopez');
});

/**
 * Hold the Form's next write until released, so a test can look at the page
 * while it is in flight.
 *
 * @param {any} page
 */
function holdWrite(page) {
  const patch = page.client.patchFormItem.bind(page.client);
  /** @type {(value?: unknown) => void} */
  let started = () => {};
  /** @type {() => Promise<unknown>} */
  let release = async () => undefined;
  const writing = new Promise((resolve) => (started = resolve));
  page.client.patchFormItem = (/** @type {any[]} */ ...args) =>
    new Promise((answer) => {
      release = () => {
        const written = patch(...args);
        answer(written);
        return written;
      };
      started();
    });
  return { writing, release: () => release() };
}

test('the confirmation says the Form is being saved while the close is written', async () => {
  const page = await openForm('forms-employee', '101');
  const held = holdWrite(page);
  fireEvent(
    getByRole(page.render(), 'button', { name: 'Mark complete' }),
    'click'
  );
  fireEvent(
    getByRole(page.render(), 'button', { name: 'Yes, mark complete' }),
    'click'
  );
  await held.writing;
  assert.ok(getByRole(page.render(), 'button', { name: 'Saving…' }));
  await held.release();
  await page.until((route) => route.confirming === null);
  assert.match(
    textOf(page.render(), 'cora-form-banner--locked') ?? '',
    /^Completed/
  );
});

test('a close the viewer left before it answered is still written, and the page they left is not redrawn', async () => {
  const page = await openForm('forms-employee', '101');
  const held = holdWrite(page);
  fireEvent(
    getByRole(page.render(), 'button', { name: 'Mark complete' }),
    'click'
  );
  fireEvent(
    getByRole(page.render(), 'button', { name: 'Yes, mark complete' }),
    'click'
  );
  await held.writing;
  page.leave();
  await held.release();
  await page.afterLeave();

  assert.equal(
    (await page.client.getFormItem(oneToOne, '101'))?.fields.Status,
    'Completed'
  );
  assert.equal(
    page.actions.some(
      (/** @type {any} */ action) => action.type === 'form/closed'
    ),
    false
  );
});

test('an action meant for another page leaves the Form as it was', async () => {
  const page = await openForm('forms-employee', '101');
  const before = page.state;
  page.dispatch({ type: 'forms/tab-chosen', tab: 'archive' });
  assert.equal(page.state, before);
});

test('with no Form Types configured, a link to a Form says there is no form of that type', async () => {
  const page = await openForm('forms-employee', '101', { formTypes: null });
  assert.match(
    page.render().textContent ?? '',
    /There is no form of this type\./
  );
});

test('a field of a type no control is drawn for, such as a status, is shown as what is stored', async () => {
  const withOutcome = {
    ...oneToOne,
    sections: [
      {
        sectionType: 'panel',
        panelName: 'Outcome',
        fields: [{ type: 'status', label: 'Outcome', itemField: 'Location' }],
      },
    ],
  };
  const view = (
    await openForm('forms-employee', '101', { formTypes: [withOutcome] })
  ).render();
  assert.equal(controls(view).length, 0);
  assert.match(view.textContent ?? '', /OutcomeIn person/);
});

test('a panel with no declared layout is stacked, each field captioned above its hint', async () => {
  const stacked = {
    ...oneToOne,
    sections: [
      {
        sectionType: 'panel',
        panelName: 'Meeting',
        fields: [
          {
            type: 'date',
            label: 'Date of meeting',
            itemField: 'MeetingDate',
            hint: 'The day you met.',
          },
          {
            type: 'radio',
            label: 'Location',
            itemField: 'Location',
            choices: ['In person', 'Zoom'],
          },
        ],
      },
    ],
  };
  const view = (
    await openForm('forms-employee', '101', { formTypes: [stacked] })
  ).render();
  const panel = /** @type {HTMLElement} */ (
    view.querySelector('.cora-form-panel')
  );
  assert.equal(getByRole(panel, 'heading').textContent, 'Meeting');
  assert.ok(getByRole(panel, 'textbox', { name: 'Date of meeting' }));
  assert.match(textOf(panel, 'cora-form-hint') ?? '', /The day you met\./);
  assert.ok(getByRole(panel, 'group', { name: 'Location' }));
  assert.equal(panel.querySelector('.cora-form-qa-row'), null);
});

test('a strip that records no manager adds nothing to a locked Form for who was recorded', async () => {
  const datesOnly = {
    ...oneToOne,
    sections: [
      {
        sectionType: 'panel',
        panelName: 'Dates',
        layout: 'strip',
        fields: [{ type: 'date', label: 'Due date', itemField: 'DueDate' }],
      },
    ],
  };
  const view = (
    await openForm('forms-employee', '103', { formTypes: [datesOnly] })
  ).render();
  assert.ok(view.querySelector('.cora-form-banner--locked'));
  assert.equal(view.querySelector('.cora-form-recorded'), null);
});

test('an action recorded with only some of its details shows what it has and says what it lacks', async () => {
  const client = await clientWith('101', {
    Actions: [{ id: 'a1', title: '', dueDate: '', status: '', details: '' }],
  });
  const view = (await openForm('forms-employee', '101', { client })).render();
  const card = textOf(view, 'cora-form-action-card') ?? '';
  assert.match(card, /Untitled action/);
  assert.match(card, /No due date/);
});
