export function envStr(name: string, def?: string): string {
  const v = process.env[name];
  if (v === undefined || v === "") {
    if (def !== undefined) return def;
    throw new Error(`Missing env: ${name}`);
  }
  return v;
}

export function envOptStr(name: string): string | undefined {
  const v = process.env[name];
  if (v === undefined || v === "") return undefined;
  return v;
}

export function envInt(name: string, def?: number): number {
  const v = process.env[name];
  if (v === undefined || v === "") {
    if (def === undefined) throw new Error(`Missing env: ${name}`);
    return def;
  }
  const n = Number(v);
  if (!Number.isFinite(n)) throw new Error(`Env ${name} must be a number`);
  return n;
}

export function envBig(name: string, def?: bigint): bigint {
  const v = process.env[name];
  if (v === undefined || v === "") {
    if (def === undefined) throw new Error(`Missing env: ${name}`);
    return def;
  }
  // допускаем подчеркивания визуальные: "100_000" => "100000"
  const clean = v.replace(/_/g, "");
  return BigInt(clean);
}