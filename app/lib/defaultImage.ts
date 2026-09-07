export type DefaultImageKind =
  | "jacket"
  | "fleece"
  | "pants"
  | "overall"
  | "shirt"
  | "swim"
  | "beanie"
  | "shoes"
  | "bag"
  | "snowboard"
  | "other";

export function defaultImageKind(category?: string | null): DefaultImageKind {
  const value = (category || "").toLocaleLowerCase();

  // Match distinct product families before broad catalog labels such as
  // "tops", "bottoms", and "shorts".
  if (/swim|swimsuit|swimwear|bikini|bathing|rash.?guard|boardshort|泳/.test(value))
    return "swim";
  if (/overall|bib|背带/.test(value)) return "overall";
  if (/snowboard|splitboard|snow.?board|滑雪板|固定器/.test(value))
    return "snowboard";
  if (/fleece|midlayer|抓绒|摇粒绒|卫衣/.test(value)) return "fleece";
  if (/jacket|shell|coat|parka|夹克|冲锋衣|保暖|羽绒|veilance/.test(value))
    return "jacket";
  if (/shoe|boot|footwear|鞋/.test(value)) return "shoes";
  if (/bag|pack|背包/.test(value)) return "bag";
  if (/beanie|hat|cap|headwear|帽|配件|glove|sock/.test(value))
    return "beanie";
  if (/shirt|tee|short[-_ ]?sleeve|long[-_ ]?sleeve|上衣|内衣/.test(value))
    return "shirt";
  if (/pant|trouser|bottom|\bshorts?\b|裤|裙/.test(value)) return "pants";
  if (/\btop(s)?\b/.test(value)) return "shirt";
  return "other";
}
