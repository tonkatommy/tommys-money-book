// The budget is the daily-driver screen, so `/` is it.
//
// A redirect rather than rendering the overview here, because the overview
// needs the app shell and the shell needs to know which nav item is current —
// keeping one canonical URL per screen is what makes the sidebar's active
// state, and the book toggle's links, correct without special cases.
//
// The sync status page that used to live here is now /sync, where it is one
// nav item among five rather than the front door.

import { redirect } from "next/navigation";

export default function Home() {
  redirect("/budget");
}
