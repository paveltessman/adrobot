import "server-only";

import { cookies } from "next/headers";

import { localeCookie, resolveLocale } from "./index";

export async function getLocale() {
  return resolveLocale((await cookies()).get(localeCookie)?.value);
}
