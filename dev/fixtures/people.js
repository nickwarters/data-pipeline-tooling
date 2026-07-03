// @ts-check
/**
 * Directory people for mock mode, backing `searchPeople` (?mock=1).
 * Bare account names only (claims prefix + domain already stripped, per
 * ADR-0013). Deliberately includes people who are NOT site members / personas
 * to mirror the directory-search-finds-non-members scenario.
 *
 * @type {Array<{ loginName: string, displayName: string, email?: string }>}
 */
export const people = [
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
  // Directory user not yet added to this site (ADR-0013 scenario).
  {
    loginName: 'contractor1',
    displayName: 'Wei Chen',
    email: 'wei.chen@contractor.example',
  },
];
