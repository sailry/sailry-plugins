// Art coordinates are calibrated once; every layer shares this transform.
export const WORLD_WIDTH = 1120;
export const WORLD_HEIGHT = 565;
export const PERSON_SIZE = 40;
export const DESK_WIDTH = 46;
const horizontal = WORLD_WIDTH / 949;
export const point = (x,y) => ({x:x * horizontal,y:y - 35});
export const rect = (x,y,width,height) => ({...point(x,y),width:width * horizontal,height});

// Crops reference the original transparent sheet, without rewriting its alpha.
export const ROOMS = [
  {crop:[62,619,266,191],bounds:rect(63,28,266,183),ink:[153,653,112,35],seats:[164,215,266],rows:[150,191]},
  {crop:[348,619,263,191],bounds:rect(343,28,263,183),ink:[420,653,111,35],seats:[435,486,537],rows:[150,191]},
  {crop:[620,619,270,191],bounds:rect(618,28,270,183),ink:[700,653,96,35],seats:[706,757,808],rows:[150,191]},
  {crop:[25,805,279,190],bounds:rect(25,185,279,171),ink:[108,830,111,34],seats:[125,180,235],rows:[296,337]},
  {crop:[645,805,280,190],bounds:rect(646,185,280,171),ink:[730,830,111,34],seats:[716,771,826],rows:[296,337]},
  {crop:[38,983,281,195],bounds:rect(39,340,281,181),ink:[134,1008,115,35],seats:[147,199,251],rows:[448,487]},
  {crop:[343,983,260,195],bounds:rect(348,340,260,181),ink:[419,1008,112,35],seats:[420,474,528],rows:[448,487]},
  {crop:[643,983,282,195],bounds:rect(646,340,282,181),ink:[715,1008,104,35],seats:[705,757,809],rows:[448,487]},
] .map(value => {
  const [x,y,width,height] = value.ink, [left,top,w,h] = value.crop, bounds = value.bounds;
  return {...value,board:{x:bounds.x + (x - left) / w * bounds.width,
    y:bounds.y + (y - top) / h * bounds.height,width:width / w * bounds.width,height:height / h * bounds.height}};
});
export function seatPosition(room,index) {
  const geometry = ROOMS[room];
  return point(geometry.seats[index % 3],geometry.rows[Math.floor(index / 3)]);
}
export function approvalPosition(index) {
  // People stand inside the stone medallion, clear of plants and benches.
  return point(417 + index % 3 * 60,300 + Math.floor(index / 3) * 44);
}
export const ATRIUM = rect(335,228,278,133);

export const SPRITES = [
  [53,81,216,185],[366,81,216,185],[708,128,150,167],
  [1020,40,141,258],[94,357,140,258],[402,357,140,258],
  [714,359,140,256],[1023,359,139,256],
  [104,661,160,258],[413,665,168,254],[723,663,167,256],
  [1029,661,168,258],[106,968,161,257],[415,971,160,254],
  [722,957,163,269],[1025,981,137,251],
];
export const SEATED = [3,4,5,6,7,15];
// Each standing appearance matches its seated hair/clothing variant.
export const STANDING = [9,11,12,10,13,8];
