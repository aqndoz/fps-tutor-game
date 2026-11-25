// Copy this file, rename it (e.g. office.js), edit it, then add it to maps/index.js.
// Legend:  # normal wall   R reinforced wall   X indestructible wall
//          . floor         (space) void        D door barricade
//          W window barricade (crate-height sill below)   b vaultable crate
//          S bomb site     1 / 2 spawn points  ^ stairs (not active yet)
// floors[0] is the ground level; each extra entry is the next level up (3 m higher).
export default {
  id: "template",          // unique; this is what the host broadcasts
  name: "Template",        // shown in the admin dropdown
  floors: [[
    "XXXXXXXXXXXX",
    "X1.....#..SX",
    "X......#...X",
    "X......D...X",
    "X......#.b.X",
    "X..........X",
    "X...###....X",
    "X..........X",
    "X..........X",
    "X..........X",
    "X.........2X",
    "XXXXXXXXXXXX",
  ]],
  // legend: { "#": [1, 2, 2, 2] },  // optional overrides: cell types from the floor slab upward
};
