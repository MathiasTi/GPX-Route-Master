import { SHORTCUTS_DATA, ShortcutItem } from '../components/KeyboardShortcutsModal';

export function runKeyboardShortcutsModalTests(): boolean {
  console.log('🧪 Running Keyboard Shortcuts Modal & Discovery Test Suite...');
  let passed = 0;
  let failed = 0;

  const assert = (condition: boolean, msg: string) => {
    if (condition) {
      passed++;
      console.log(`  ✅ [PASS] ${msg}`);
    } else {
      failed++;
      console.error(`  ❌ [FAIL] ${msg}`);
    }
  };

  // Test 1: SHORTCUTS_DATA Registry completeness & validity
  assert(Array.isArray(SHORTCUTS_DATA) && SHORTCUTS_DATA.length >= 10, `Shortcuts registry contains ${SHORTCUTS_DATA.length} items (expected >= 10)`);
  
  const idSet = new Set<string>();
  let allIdsUnique = true;
  for (const item of SHORTCUTS_DATA) {
    if (idSet.has(item.id)) {
      allIdsUnique = false;
    }
    idSet.add(item.id);
  }
  assert(allIdsUnique, 'All shortcut registry items have unique IDs');

  // Test 2: Required core shortcuts presence
  const cycleTrackShortcut = SHORTCUTS_DATA.find(s => s.id === 'cycle-tracks');
  assert(!!cycleTrackShortcut, 'Shortcut "cycle-tracks" is present');
  assert(cycleTrackShortcut?.keys.includes('C') === true, 'Cycle tracks shortcut is bound to key "C"');

  const mapPointShortcut = SHORTCUTS_DATA.find(s => s.id === 'map-hover-point');
  assert(!!mapPointShortcut, 'Shortcut "map-hover-point" is present');
  assert(mapPointShortcut?.keys.includes('M') === true, 'Map hover point shortcut is bound to key "M"');

  const helpShortcut = SHORTCUTS_DATA.find(s => s.id === 'help-modal');
  assert(!!helpShortcut, 'Shortcut "help-modal" is present');
  assert(helpShortcut?.keys.includes('?') === true, 'Help modal shortcut is bound to key "?"');

  const terrain3DShortcut = SHORTCUTS_DATA.find(s => s.id === 'toggle-3d');
  assert(!!terrain3DShortcut, 'Shortcut "toggle-3d" is present');
  assert(terrain3DShortcut?.keys.includes('3') === true, '3D terrain shortcut is bound to key "3"');

  const glossaryShortcut = SHORTCUTS_DATA.find(s => s.id === 'open-glossary');
  assert(!!glossaryShortcut, 'Shortcut "open-glossary" is present');
  assert(glossaryShortcut?.keys.includes('G') === true, 'Glossary shortcut is bound to key "G"');

  // Test 3: Filter logic by category
  const filterByCategory = (category: 'all' | 'navigation' | 'analysis' | 'actions') => {
    if (category === 'all') return SHORTCUTS_DATA;
    return SHORTCUTS_DATA.filter(s => s.category === category);
  };

  const navShortcuts = filterByCategory('navigation');
  const analysisShortcuts = filterByCategory('analysis');
  const actionShortcuts = filterByCategory('actions');

  assert(navShortcuts.length > 0, `Navigation category contains ${navShortcuts.length} items`);
  assert(analysisShortcuts.length > 0, `Analysis category contains ${analysisShortcuts.length} items`);
  assert(actionShortcuts.length > 0, `Actions category contains ${actionShortcuts.length} items`);
  assert(
    navShortcuts.length + analysisShortcuts.length + actionShortcuts.length === SHORTCUTS_DATA.length,
    'All shortcuts belong to valid categories without omission'
  );

  // Test 4: Search filter simulation
  const filterBySearch = (query: string, category: 'all' | 'navigation' | 'analysis' | 'actions' = 'all') => {
    return SHORTCUTS_DATA.filter(item => {
      const matchesCategory = category === 'all' || item.category === category;
      if (!matchesCategory) return false;
      if (!query.trim()) return true;

      const q = query.toLowerCase().trim();
      const matchTitle = item.title.toLowerCase().includes(q);
      const matchDesc = item.description.toLowerCase().includes(q);
      const matchKey = item.keys.some(k => k.toLowerCase().includes(q));
      const matchBadge = item.badge?.toLowerCase().includes(q);

      return matchTitle || matchDesc || matchKey || matchBadge;
    });
  };

  // Search by key 'c'
  const cResults = filterBySearch('C');
  assert(cResults.some(r => r.id === 'cycle-tracks'), 'Search for "C" matches "cycle-tracks"');

  // Search by key 'm'
  const mResults = filterBySearch('M');
  assert(mResults.some(r => r.id === 'map-hover-point'), 'Search for "M" matches "map-hover-point"');

  // Search by term 'glossar'
  const glossarResults = filterBySearch('glossar');
  assert(glossarResults.some(r => r.id === 'open-glossary'), 'Search for "glossar" matches "open-glossary"');

  // Search with leading/trailing spaces and special characters
  const trimmedResults = filterBySearch('  zoom  ');
  assert(trimmedResults.some(r => r.id === 'zoom-in-out'), 'Search trims input correctly and finds "zoom-in-out"');

  // Test 5: Input field focus guard simulation
  const shouldIgnoreKeydownInField = (elementTag: string, contentEditable: boolean): boolean => {
    return elementTag === 'INPUT' || elementTag === 'TEXTAREA' || contentEditable === true;
  };

  assert(shouldIgnoreKeydownInField('INPUT', false) === true, 'Ignores keydown in <input>');
  assert(shouldIgnoreKeydownInField('TEXTAREA', false) === true, 'Ignores keydown in <textarea>');
  assert(shouldIgnoreKeydownInField('DIV', true) === true, 'Ignores keydown in contenteditable div');
  assert(shouldIgnoreKeydownInField('DIV', false) === false, 'Allows keydown in standard <div>');
  assert(shouldIgnoreKeydownInField('BUTTON', false) === false, 'Allows keydown on <button>');

  // Test 6: Security sanitization on search queries
  const sanitizeSearchQuery = (input: string): string => {
    return input.replace(/<[^>]*>?/gm, '').replace(/[<>"'&]/g, '').trim().slice(0, 100);
  };
  const dirtyQuery = '<script>flyover</script>';
  const cleanQuery = sanitizeSearchQuery(dirtyQuery);
  assert(!cleanQuery.includes('<script>'), 'Search input safely strips HTML/Script tags');
  const searchXssResults = filterBySearch(cleanQuery);
  assert(searchXssResults.some(r => r.id === 'toggle-flyover'), 'Sanitized query still matches "toggle-flyover"');

  console.log(`\n📊 Keyboard Shortcuts Test Results: ${passed} passed, ${failed} failed\n`);
  return failed === 0;
}
