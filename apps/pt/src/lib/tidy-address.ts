// Some county sources return addresses with gaps where the city should be, e.g.
// "1515 S LOOP 288 , , TX 76208". Collapse the stray spaces and empty commas so it reads
// "1515 S LOOP 288, TX 76208". Only tidies punctuation; never changes real words.
export function tidyAddress(address: string): string {
  return address
    .replace(/\s+,/g, ",")
    .replace(/,(\s*,)+/g, ",")
    .replace(/\s{2,}/g, " ")
    .replace(/,\s*$/, "")
    .trim();
}
