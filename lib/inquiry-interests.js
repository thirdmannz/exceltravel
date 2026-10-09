'use strict';

/* Visitor-facing service lines. The ids mirror the site's existing top-level
   categories (group-tours, independent-travel, study-tours, cruise,
   flights-visa); 'other' covers visitors who have not decided yet. */
const INTERESTS = [
  { id: 'group-tours', label: 'Group Tours' },
  { id: 'independent-travel', label: 'Independent Travel' },
  { id: 'study-tours', label: 'Study Tours' },
  { id: 'cruise', label: 'Cruises' },
  { id: 'flights-visa', label: 'Flights & Visas' },
  { id: 'other', label: 'Other / not sure yet' },
];
const INTEREST_IDS = INTERESTS.map((i) => i.id);

function interestLabel(id) {
  const hit = INTERESTS.find((i) => i.id === id);
  return hit ? hit.label : '';
}

module.exports = { INTERESTS, INTEREST_IDS, interestLabel };
