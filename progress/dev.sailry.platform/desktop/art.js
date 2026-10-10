import {div} from 'gpui-kit';
import {Image} from 'sailry';
export const ATLAS = 'dev.sailry.platform/desktop/assets/office-atlas.png';
// Kit has no office-scene control. Its image host and rectangular clipping reuse
// one transparent 4x4 texture; standard controls and all copy remain native UI.
export function sprite(id,index,size) {
  return div().id(`${id}-clip`).relative().w(size).h(size).overflow_hidden()
    .child(div().absolute().left(-(index % 4) * size).top(-Math.floor(index / 4) * size)
      .w(size * 4).h(size * 4).child(Image.new(`${id}-art`,{path:ATLAS})));
}
