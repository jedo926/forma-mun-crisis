/*
 * DEMO CONTENT — placeholder data for previewing the released layout.
 * Loaded ONLY when a page is opened with ?demo=1. It is NOT the real crisis,
 * contains no real claims and can be shipped publicly.
 * The real content lives in the Vercel environment variable (see README).
 */
window.FORMA_DEMO_CONTENT = {
  title: 'SAMPLE CRISIS TITLE',
  subtitle: 'Placeholder subtitle — replace with the approved topic line',
  premiseNote: 'DEMO: This text stands in for the premise note. Crisis developments in the real committee are fictional.',
  briefing: {
    overview: ['Placeholder overview paragraph. The approved topic overview from the chairs appears here.', 'A second placeholder paragraph to show spacing.'],
    context: ['Placeholder for verified context.'],
    committeeFormat: 'Placeholder description of the committee format.',
    debateScope: ['Placeholder scope item one', 'Placeholder scope item two', 'Placeholder scope item three'],
    background: ['Placeholder background reading notes.']
  },
  characters: [
    { id: 'alpha', name: 'SAMPLE DELEGATE ALPHA', role: 'Placeholder role', affiliation: 'Sample Group A', faction: 'Sample Faction One', bio: 'Placeholder biography.', look: { skin: '#c68a5c', hair: { style: 'curly', color: '#1c1530' }, outfit: { type: 'suit', jacket: '#00F5FF', tie: '#FF2BD6' } } },
    { id: 'bravo', name: 'SAMPLE DELEGATE BRAVO', role: 'Placeholder role', affiliation: 'Sample Group B', faction: 'Sample Faction Two', bio: 'Placeholder biography.', look: { skin: '#e0b089', hair: { style: 'slick', color: '#3b2a1a' }, outfit: { type: 'suit', jacket: '#7857FF', tie: '#2b2457' } } },
    { id: 'charlie', name: 'SAMPLE DELEGATE CHARLIE', role: 'Placeholder role', affiliation: 'Sample Group A', faction: 'Sample Faction One', bio: 'Placeholder biography.', look: { skin: '#a86f45', hair: { style: 'mop', color: '#e9e4ff' }, outfit: { type: 'suit', jacket: '#FF2BD6', tie: '#00F5FF' } } },
    { id: 'delta', name: 'SAMPLE DELEGATE DELTA', role: 'Placeholder role', affiliation: 'Sample Group C', faction: 'Sample Faction Two', bio: 'Placeholder biography.', look: { skin: '#8e5a38', hair: { style: 'crew', color: '#1c1530' }, outfit: { type: 'suit', jacket: '#FF3B52', tie: '#ffd166' } } },
    { id: 'echo', name: 'SAMPLE DELEGATE ECHO', role: 'Placeholder role', affiliation: 'Sample Group B', faction: 'Sample Faction One', bio: 'Placeholder biography.', look: { skin: '#c68a5c', hair: { style: 'bald' }, outfit: { type: 'suit', jacket: '#2fd18a', tie: '#111326' } } },
    { id: 'foxtrot', name: 'SAMPLE DELEGATE FOXTROT', role: 'Placeholder role', affiliation: 'Sample Group C', faction: 'Sample Faction Two', bio: 'Placeholder biography.', look: { skin: '#f1c9a5', hair: { style: 'side_part', color: '#5a2d0c' }, outfit: { type: 'suit', jacket: '#ffb020', tie: '#7857FF' } } }
  ],
  factions: [
    { id: 'f1', name: 'SAMPLE FACTION ONE', description: 'Placeholder faction description.', members: ['alpha', 'charlie', 'echo'], relations: [{ target: 'f2', type: 'RIVAL', note: 'Placeholder relationship note.' }] },
    { id: 'f2', name: 'SAMPLE FACTION TWO', description: 'Placeholder faction description.', members: ['bravo', 'delta', 'foxtrot'], relations: [] }
  ],
  timeline: [
    { date: 'DATE 01', title: 'Placeholder background event', kind: 'background', detail: 'Placeholder detail.' },
    { date: 'DATE 02', title: 'Placeholder background event', kind: 'background', detail: 'Placeholder detail.' },
    { date: 'DATE 03', title: 'Placeholder crisis divergence', kind: 'crisis', detail: 'Placeholder detail for a fictional development.' }
  ],
  updates: [
    { time: '2027-01-07T22:00:00+02:00', priority: 'critical', title: 'Placeholder official update', detail: 'Placeholder update body.' },
    { time: '2027-01-07T22:05:00+02:00', priority: 'medium', title: 'Placeholder official update', detail: 'Placeholder update body.' }
  ],
  map: { label: 'Sample schematic', note: 'DEMO SCHEMATIC · POSITIONS ARE PLACEHOLDERS' },
  locations: [
    { id: 'l1', name: 'SAMPLE LOCATION A', type: 'SITE', x: 24, y: 40, description: 'Placeholder location description.' },
    { id: 'l2', name: 'SAMPLE LOCATION B', type: 'SITE', x: 62, y: 28, description: 'Placeholder location description.' },
    { id: 'l3', name: 'SAMPLE LOCATION C', type: 'SITE', x: 70, y: 72, description: 'Placeholder location description.' }
  ],
  intel: [
    { codename: 'SAMPLE-01', classification: 'DECLASSIFIED', title: 'Placeholder dossier', body: 'Placeholder public intel text.' }
  ],
  resources: []
};
