// A function value (an arrow bound to a const) used as a template tag.
export const MODULE_INIT = (text: TemplateStringsArray, module: string) =>
  `${module} dependencies initialized (${text.length})`;
const wrap = (strings: TemplateStringsArray, a: number, b: string): string =>
  strings[0] + String(a * 2) + strings[1] + b + strings[2];
const name = "AppModule";
console.log(MODULE_INIT`${name}`);
console.log(wrap`x=${21} y=${"z"}!`);
