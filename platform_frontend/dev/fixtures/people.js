// @ts-check
/**
 * Directory people for mock mode, backing `searchPeople` (?mock=1).
 * Bare account names only (claims prefix + domain already stripped).
 * Deliberately includes people who are NOT site members / personas
 * to mirror the directory-search-finds-non-members scenario.
 *
 * Every account the fixture Cases name as their Responsible Party is here, so
 * the picker can find them and a mock write resolves to the same display name a
 * real read would carry back on the row.
 *
 * @type {Array<{ loginName: string, displayName: string, email?: string, manager?: string }>}
 */
export const people = [
  {
    loginName: 'user-reviewer',
    displayName: 'Alex Reviewer',
    email: 'alex.reviewer@contoso.com',
  },
  {
    loginName: 'user-reviewer-2',
    displayName: 'Zara Reviewer',
    email: 'zara.reviewer@contoso.com',
  },
  {
    loginName: 'areviewer',
    displayName: 'Alex Reviewer',
    email: 'alex.reviewer@contoso.com',
  },
  {
    loginName: 'sowner',
    displayName: 'Sam Owner',
    email: 'sam.owner@contoso.com',
  },
  {
    loginName: 'jrp',
    displayName: 'Jordan RP',
    email: 'jordan.rp@contoso.com',
  },
  {
    loginName: 'user-rp',
    displayName: 'Jordan RP',
    email: 'jordan.rp@contoso.com',
    manager: 'user-rp-manager',
  },
  {
    loginName: 'user-rp-manager',
    displayName: 'Priya RP Manager',
    email: 'priya.rp.manager@contoso.com',
  },
  {
    loginName: 'user-agent-a',
    displayName: 'Frankie Agent',
    email: 'frankie.agent@contoso.com',
  },
  {
    loginName: 'user-agent-b',
    displayName: 'Rowan Agent',
    email: 'rowan.agent@contoso.com',
  },
  {
    loginName: 'user-agent-c',
    displayName: 'Noor Agent',
    email: 'noor.agent@contoso.com',
  },
  {
    loginName: 'mmanager',
    displayName: 'Morgan Manager',
    email: 'morgan.manager@contoso.com',
  },
  {
    loginName: 'jsmith',
    displayName: 'John Smith',
    email: 'john.smith@contoso.com',
  },
  {
    loginName: 'asmith',
    displayName: 'Anna Smith',
    email: 'anna.smith@contoso.com',
  },
  {
    loginName: 'bjones',
    displayName: 'Bola Jones',
    email: 'bola.jones@contoso.com',
  },
  {
    loginName: 'pdavies',
    displayName: 'Priya Davies',
    email: 'priya.davies@contoso.com',
  },
  {
    loginName: 'tokafor',
    displayName: 'Tunde Okafor',
    email: 'tunde.okafor@contoso.com',
  },
  // Directory user not yet added to this site.
  {
    loginName: 'contractor1',
    displayName: 'Wei Chen',
    email: 'wei.chen@contractor.example',
  },
];
