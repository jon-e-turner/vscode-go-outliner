"use strict";

import * as fs from "fs";

export function semVer(a: string, b: string): number {
  a = a.split(" ")[1];
  b = b.split(" ")[1];
  const pa = a.split(".");
  const pb = b.split(".");
  for (let i = 0; i < 3; i++) {
    const na = Number(pa[i]);
    const nb = Number(pb[i]);
    if (na > nb) {
      return 1;
    }
    if (nb > na) {
      return -1;
    }
    if (!isNaN(na) && isNaN(nb)) {
      return 1;
    }
    if (isNaN(na) && !isNaN(nb)) {
      return -1;
    }
  }
  return 0;
}

export function fileExists(filePath: string): boolean {
  try {
    return fs.statSync(filePath).isFile();
  } catch {
    return false;
  }
}
