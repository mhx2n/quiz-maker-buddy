/**
 * Converts AI plain-text math (x^2, H_2O, sqrt(x)) into real Unicode
 * characters so the stored quiz reads correctly in Telegram polls,
 * in the app and in exported PDFs.
 */

const SUP: Record<string, string> = {
  "0": "⁰", "1": "¹", "2": "²", "3": "³", "4": "⁴", "5": "⁵", "6": "⁶", "7": "⁷", "8": "⁸", "9": "⁹",
  "+": "⁺", "-": "⁻", "=": "⁼", "(": "⁽", ")": "⁾",
  a: "ᵃ", b: "ᵇ", c: "ᶜ", d: "ᵈ", e: "ᵉ", f: "ᶠ", g: "ᵍ", h: "ʰ", i: "ⁱ", j: "ʲ", k: "ᵏ",
  l: "ˡ", m: "ᵐ", n: "ⁿ", o: "ᵒ", p: "ᵖ", r: "ʳ", s: "ˢ", t: "ᵗ", u: "ᵘ", v: "ᵛ", w: "ʷ",
  x: "ˣ", y: "ʸ", z: "ᶻ",
  A: "ᴬ", B: "ᴮ", D: "ᴰ", E: "ᴱ", G: "ᴳ", H: "ᴴ", I: "ᴵ", J: "ᴶ", K: "ᴷ", L: "ᴸ", M: "ᴹ",
  N: "ᴺ", O: "ᴼ", P: "ᴾ", R: "ᴿ", T: "ᵀ", U: "ᵁ", V: "ⱽ", W: "ᵂ",
};

const SUB: Record<string, string> = {
  "0": "₀", "1": "₁", "2": "₂", "3": "₃", "4": "₄", "5": "₅", "6": "₆", "7": "₇", "8": "₈", "9": "₉",
  "+": "₊", "-": "₋", "=": "₌", "(": "₍", ")": "₎",
  a: "ₐ", e: "ₑ", h: "ₕ", i: "ᵢ", j: "ⱼ", k: "ₖ", l: "ₗ", m: "ₘ", n: "ₙ", o: "ₒ", p: "ₚ",
  r: "ᵣ", s: "ₛ", t: "ₜ", u: "ᵤ", v: "ᵥ", x: "ₓ",
};

const SUP_VALUES = new Set(Object.values(SUP));
const SUB_VALUES = new Set(Object.values(SUB));

function convert(body: string, map: Record<string, string>, already: Set<string>): string | null {
  let out = "";
  for (const ch of body) {
    if (already.has(ch)) {
      out += ch;
      continue;
    }
    const mapped = map[ch];
    if (!mapped) return null;
    out += mapped;
  }
  return out;
}

function applyMarker(text: string, marker: "^" | "_"): string {
  const map = marker === "^" ? SUP : SUB;
  const already = marker === "^" ? SUP_VALUES : SUB_VALUES;
  const esc = marker === "^" ? "\\^" : "_";
  const digits = marker === "^" ? "⁰¹²³⁴⁵⁶⁷⁸⁹" : "₀₁₂₃₄₅₆₇₈₉";

  let result = text;
  for (let pass = 0; pass < 3; pass++) {
    const before = result;
    result = result
      .replace(new RegExp(`${esc}\\{([^{}]{1,12})\\}`, "g"), (m, body: string) => convert(body, map, already) ?? m)
      .replace(new RegExp(`${esc}\\(([^()]{1,12})\\)`, "g"), (m, body: string) => convert(body, map, already) ?? m)
      .replace(new RegExp(`${esc}(-?[0-9A-Za-z${digits}]{1,4})`, "g"), (m, body: string) => convert(body, map, already) ?? m);
    if (result === before) break;
  }
  return result;
}

export function prettyMath(input: string): string {
  let out = input
    .replace(/\bsqrt\s*\(([^()]{1,40})\)/gi, "√($1)")
    .replace(/\bsqrt\s*([0-9]+)/gi, "√$1");

  out = applyMarker(out, "^");
  out = applyMarker(out, "_");

  return out
    .replace(/(^|[\s(])<=(?=[\s)]|$)/g, "$1≤")
    .replace(/(^|[\s(])>=(?=[\s)]|$)/g, "$1≥")
    .replace(/!=/g, "≠")
    .replace(/\+\/-/g, "±")
    .replace(/->/g, "→")
    .replace(/√\(([0-9A-Za-z²³¹]{1,3})\)/g, "√$1")
    .replace(/\s{2,}/g, " ")
    .trim();
}
