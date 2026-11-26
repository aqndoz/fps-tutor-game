// Copy this file, rename it (e.g. office.js), edit it, then add it to maps/index.js.
// Every character is a 0.5 m cell and walls are 1 character thick. Rows run north (top) to south, columns west to east.
// Legend:  #  normal wall      R  reinforced wall (2 hits)      X  indestructible wall      F  frame (indestructible)
//          .  floor            (space) void / no floor          b  crate, 1 m high, vaultable
//          D  door barricade   W  window barricade (vaultable sill below; removed after 2 knife hits or 1/3 destroyed)
//          1  attacker spawn, OUTSIDE the building (can appear several times)
//          S  bomb-room marker: put ONE inside each room. Every round uses a random one; the defender starts there.
//          ^ v < >  stairs rising towards north / south / west / east; a run of 6 in a row climbs one floor
// An opening is 2 characters wide with an F character on each side (see the door and window below).
// floors[0] is the ground level; each further entry is the next level up (3.5 m higher).
export default {
  id: "template",
  name: "Template",
  floors: [
    [
      "XXXXXXXXXXXXXXXXXXXXXXXX",
      "X......................X",
      "X......................X",
      "X......................X",
      "X.........#####FWWF###.X",
      "X.........#..........#.X",
      "X.........#..........#.X",
      "X.........#..........#.X",
      "X.........F..........#.X",
      "X.........D....S.....#.X",
      "X.........D..........#.X",
      "X.........F..........#.X",
      "X..bb.....#..........#.X",
      "X..bb.....#..........#.X",
      "X.........#..........#.X",
      "X.........############.X",
      "X..1...................X",
      "X......................X",
      "X......................X",
      "XXXXXXXXXXXXXXXXXXXXXXXX",
    ],
  ],
};
