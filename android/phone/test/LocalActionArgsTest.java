package app.nexus.phone;

import java.util.LinkedHashMap;
import java.util.Map;

public final class LocalActionArgsTest {
 private static int failures = 0;
 private static void check(boolean ok, String name) { if (!ok) { failures++; System.err.println("FAIL: " + name); } }
 private static Map<String, String> m(String... kv) { Map<String, String> r = new LinkedHashMap<>(); for (int i = 0; i < kv.length; i += 2) r.put(kv[i], kv[i + 1]); return r; }
 private static boolean rejects(String action, Map<String, String> args) { try { LocalActionArgs.normalize(action, args); return false; } catch (IllegalArgumentException e) { return true; } }
 private static String rep(int n) { return new String(new char[n]).replace('\0', 'a'); }

 public static void main(String[] a) {
  // Existing four actions behave as before.
  for (String x : new String[]{"flashlight_on", "flashlight_off", "open_wifi_settings"}) {
   check(LocalActionArgs.normalize(x, m()).isEmpty(), x + " takes no arguments");
   check(rejects(x, m("x", "y")), x + " rejects extra arguments");
  }
  check(LocalActionArgs.normalize("show_map", m("query", "  Des Moines, Iowa ")).get("query").equals("Des Moines, Iowa"), "map query trimmed");
  check(rejects("show_map", m()), "map needs a query");
  check(rejects("show_map", m("query", "   ")), "blank map query");
  check(rejects("show_map", m("query", rep(121))), "map query max 120");
  check(rejects("show_map", m("query", "a", "extra", "b")), "map extra key");

  // Unknown actions.
  check(rejects("send_sms", m("to", "1")), "unknown action");
  check(rejects(null, m()), "null action");
  check(!LocalActionArgs.known("send_sms") && LocalActionArgs.known("send_email"), "known()");

  // Contacts.
  Map<String, String> c = LocalActionArgs.normalize("create_contact", m("first_name", "Mom", "last_name", "", "phone_number", "(515) 555-0100", "email", "mom@example.com"));
  check(c.size() == 3 && !c.containsKey("last_name"), "contact drops empty optionals");
  check(LocalActionArgs.normalize("create_contact", m("last_name", "Smith")).size() == 1, "last name alone is enough");
  check(rejects("create_contact", m("phone_number", "5155550100")), "contact needs a name");
  check(rejects("create_contact", m("first_name", "A", "phone_number", "abc")), "bad phone");
  check(rejects("create_contact", m("first_name", "A", "phone_number", "12")), "short phone");
  check(rejects("create_contact", m("first_name", "A", "email", "not-an-email")), "bad contact email");
  check(rejects("create_contact", m("first_name", rep(61))), "name max 60");
  check(rejects("create_contact", m("first_name", "A", "nickname", "B")), "unknown contact field");

  // Email.
  Map<String, String> e = LocalActionArgs.normalize("send_email", m("to", "a.b+c@example.co", "subject", "Hi", "body", "See you soon"));
  check(e.size() == 3, "email ok");
  check(LocalActionArgs.normalize("send_email", m("to", "a@b.io")).size() == 1, "subject and body optional");
  check(rejects("send_email", m("subject", "Hi")), "email needs recipient");
  check(rejects("send_email", m("to", "a@b.io,c@d.io")), "no second recipient (comma)");
  check(rejects("send_email", m("to", "a@b.io;c@d.io")), "no second recipient (semicolon)");
  check(rejects("send_email", m("to", "a@b.io c@d.io")), "no second recipient (space)");
  check(rejects("send_email", m("to", "a@b")), "recipient needs a domain");
  check(rejects("send_email", m("to", "a@b.io", "subject", "x\r\nBcc: evil@x.io")), "no header injection");
  check(rejects("send_email", m("to", "a@b.io", "body", rep(201))), "body max 200");
  check(rejects("send_email", m("to", "a@b.io", "cc", "c@d.io")), "no cc");
  check(rejects("send_email", m("to", "a@b.io", "body", "<script>")), "no markup");

  // Calendar.
  Map<String, String> ev = LocalActionArgs.normalize("create_calendar_event", m("title", "Dentist", "datetime", "2026-11-05T14:00:00"));
  check(ev.get("datetime").equals("2026-11-05T14:00:00"), "event ok");
  check(LocalActionArgs.normalize("create_calendar_event", m("title", "T", "datetime", "2026-11-05T14:00")).size() == 2, "minutes-only time ok");
  check(rejects("create_calendar_event", m("title", "T")), "event needs time");
  check(rejects("create_calendar_event", m("datetime", "2026-11-05T14:00:00")), "event needs title");
  check(rejects("create_calendar_event", m("title", "T", "datetime", "tomorrow at 2")), "no relative dates");
  check(rejects("create_calendar_event", m("title", "T", "datetime", "2026-13-05T14:00:00")), "month 13");
  check(rejects("create_calendar_event", m("title", "T", "datetime", "2026-02-30T14:00:00")), "Feb 30");
  check(rejects("create_calendar_event", m("title", "T", "datetime", "2026-11-05T25:00:00")), "hour 25");
  check(rejects("create_calendar_event", m("title", "T", "datetime", "1999-11-05T10:00:00")), "year too old");
  check(rejects("create_calendar_event", m("title", "T", "datetime", "2026-11-05T14:00:00Z")), "no timezone suffix");
  check(rejects("create_calendar_event", m("title", rep(101), "datetime", "2026-11-05T14:00:00")), "title max 100");
  check(rejects("create_calendar_event", m("title", "T", "datetime", "2026-11-05T14:00:00", "location", "x")), "no location");

  if (failures > 0) { System.err.println(failures + " test(s) failed"); System.exit(1); }
  System.out.println("LocalActionArgsTest passed");
 }
}
