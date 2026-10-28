class Mod {
  n = 1;
}

interface Inserted {
  inserted: boolean;
  moduleRef: Mod;
  label?: string;
}

async function insert(flag: boolean): Promise<Inserted | undefined> {
  return flag ? { inserted: true, moduleRef: new Mod(), label: 'x' } : undefined;
}

function lookup(flag: boolean): Inserted | null {
  return flag ? { inserted: false, moduleRef: new Mod() } : null;
}

async function main(): Promise<void> {
  const { moduleRef: a, inserted: ai, label: al } = (await insert(true)) ?? {};
  const { moduleRef: b, inserted: bi, label: bl = 'none' } = (await insert(false)) ?? {};
  console.log(a?.n, ai, al, b?.n, bi, bl);
  const { inserted, moduleRef } = lookup(true) ?? {};
  const { inserted: missing } = lookup(false) ?? {};
  console.log(inserted, moduleRef?.n, missing);
}

main();
